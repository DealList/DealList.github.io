"""DART 데이터 수집.

- list_filings: OpenDART API로 채무증권 신고서 목록 조회 (API key 사용)
- fetch_document: 공시 원문을 dart.fss.or.kr 웹뷰어에서 스크래핑 (API 미사용)
"""
from __future__ import annotations
import re
import time
import logging
from dataclasses import dataclass
from datetime import date
import requests

import config

log = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 DCMScraper/1.0"
DEFAULT_HEADERS = {"User-Agent": UA, "Accept-Language": "ko,en;q=0.8"}


@dataclass
class Filing:
    rcept_no: str
    corp_name: str
    corp_code: str
    report_nm: str
    rcept_dt: str  # YYYYMMDD
    flr_nm: str    # 제출인

    @property
    def is_amendment(self) -> bool:
        return "[기재정정]" in self.report_nm

    @property
    def is_final(self) -> bool:
        return "[발행조건확정]" in self.report_nm

    @property
    def is_initial(self) -> bool:
        return not self.is_amendment and not self.is_final

    @property
    def stage(self) -> str:
        if self.is_final: return "final"
        if self.is_amendment: return "amend"
        return "initial"


def _list_filings_chunk(start: date, end: date, corp_code: str = "") -> list[Filing]:
    """단일 청크(3개월 이내) 조회. corp_code 지정 시 해당 corp 만 (페이지 ↓ → 속도 ↑).

    DART API 는 corp_code 파라미터 지원: 특정 corp 의 공시만 반환 → 한 corp 의 한 기간
    공시는 보통 5건 이내라 페이지 1 만으로 끝. 검증 refetch 시 필수.
    """
    from datetime import timedelta
    out: list[Filing] = []
    page = 1
    while True:
        params = {
            "crtfc_key": config.DART_API_KEY,
            "bgn_de": start.strftime("%Y%m%d"),
            "end_de": end.strftime("%Y%m%d"),
            "pblntf_detail_ty": "C002",
            "page_no": page,
            "page_count": 100,
        }
        if corp_code:
            params["corp_code"] = corp_code
        r = requests.get(config.OPENDART_LIST_URL, params=params, timeout=30, headers=DEFAULT_HEADERS)
        r.raise_for_status()
        data = r.json()

        status = data.get("status")
        if status == "013":  # 조회 데이터 없음
            break
        if status != "000":
            raise RuntimeError(f"OpenDART list error status={status} message={data.get('message')}")

        for item in data.get("list", []):
            out.append(Filing(
                rcept_no=item["rcept_no"],
                corp_name=item["corp_name"],
                corp_code=item.get("corp_code", ""),
                report_nm=item["report_nm"],
                rcept_dt=item["rcept_dt"],
                flr_nm=item.get("flr_nm", ""),
            ))

        total_page = data.get("total_page", 1)
        if page >= total_page:
            break
        page += 1
        time.sleep(config.REQUEST_SLEEP)
    return out


def list_filings(start: date, end: date, only_bond_registration: bool = True,
                 corp_code: str = "") -> list[Filing]:
    """채무증권 신고서 목록 조회. 3개월 초과 시 자동 청크 분할.

    pblntf_detail_ty=C002는 발행공시 채무증권 카테고리 전체(증권발행실적보고서,
    일괄신고추가서류, ELS 등)를 반환하므로 only_bond_registration=True인 경우
    report_nm이 '증권신고서(채무증권)'인 것만 필터링.

    DART API 제약: corp_code 없이 조회할 경우 검색 기간은 3개월(약 90일) 이내만 가능.
    그래서 긴 기간은 89일 단위로 청크 분할 후 합친다. 청크 경계 중복은 rcept_no 기준 dedup.

    corp_code: 특정 corp 만 조회 — refetch 시 사용 (페이지 ↓, 응답 ↓, 속도 ↑).
    """
    from datetime import timedelta

    if not config.DART_API_KEY:
        raise RuntimeError("DART_API_KEY 미설정. auto/.env 파일에 DART_API_KEY=... 추가하세요.")

    out: list[Filing] = []
    seen: set[str] = set()
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=89), end)
        for f in _list_filings_chunk(chunk_start, chunk_end, corp_code=corp_code):
            if f.rcept_no in seen:
                continue
            seen.add(f.rcept_no)
            out.append(f)
        if chunk_end >= end:
            break
        chunk_start = chunk_end + timedelta(days=1)

    if only_bond_registration:
        out = [f for f in out if "증권신고서(채무증권)" in f.report_nm]
    return out


@dataclass
class DocSection:
    title: str
    rcp_no: str
    dcm_no: str
    ele_id: str
    offset: str
    length: str
    dtd: str

    @property
    def viewer_url(self) -> str:
        return (
            f"{config.DART_VIEWER_DOC}?rcpNo={self.rcp_no}&dcmNo={self.dcm_no}"
            f"&eleId={self.ele_id}&offset={self.offset}&length={self.length}&dtd={self.dtd}"
        )


# DART 뷰어는 트리 데이터를 JS 객체로 노출:
#   var node1 = {};
#   node1['text'] = "증권발행조건확정";
#   node1['rcpNo'] = "20260504000416";
#   node1['dcmNo'] = "11362365";
#   node1['eleId'] = "1";
#   node1['offset'] = "861";
#   node1['length'] = "655174";
#   node1['dtd'] = "dart4.xsd";
NODE_BLOCK_RE = re.compile(r"var\s+(node\d+)\s*=\s*\{\s*\}")
NODE_ATTR_RE = re.compile(
    r"(node\d+)\[\s*'(\w+)'\s*\]\s*=\s*['\"]([^'\"]*)['\"]"
)


def list_doc_sections(rcept_no: str) -> list[DocSection]:
    """공시 메인 페이지에서 본문 섹션(트리 노드들) 추출.

    DART 뷰어 JS 트리는 같은 변수명 (`node1`, `node2`, `node3`) 을 계층마다 재선언함.
    예시:
        var node1 = {};                  # 최상위 doc
        node1['text'] = '제1부';
        node1['eleId'] = '...';
        var node2 = {};                  # 하위 섹션
        node2['text'] = 'I. 모집 또는 매출에 관한 일반사항';
        var node2 = {};                  # 다음 형제 섹션 (같은 변수명 재사용)
        node2['text'] = 'II. 증권의 주요 권리내용';
        ...
    각 `var nodeN = {}` 등장 시점이 새 노드의 시작이므로, 그 위치 이후 다음 `var` 직전까지의
    attr 할당만 그 노드의 것으로 본다. 그 다음 노드 시작 시 직전 노드를 DocSection 으로 flush.

    [발행조건확정] 처럼 트리 1단짜리 단순 문서는 우연히 동작하지만, 초기 '증권신고서(채무증권)'
    처럼 트리가 깊으면 같은 변수명 다중 선언 때문에 전역 dict 가 덮어쓰여 중간 섹션들이 모두
    누락됨 — 이 버그를 해결.
    """
    r = _request_with_retry(
        config.DART_VIEWER_MAIN, params={"rcpNo": rcept_no}, timeout=30
    )
    html = r.text

    # 철회된 공시 — 발행이 실제로 이뤄지지 않은 건이므로 수집 대상 외.
    # main.do 페이지가 자바스크립트로 "철회된 문서입니다. 관련문서의 철회신고서를 참고하십시요."
    # alert 띄우고, 관련문서 dropdown 에 "철회신고서" 항목 포함됨.
    if "철회된 문서입니다" in html:
        log.info("rcept_no=%s 철회된 공시 — skip", rcept_no)
        return []

    # 등장 순서로 이벤트 수집: ('var', nodeName) 또는 ('attr', nodeName, key, val)
    events = []
    for m in NODE_BLOCK_RE.finditer(html):
        events.append((m.start(), "var", m.group(1)))
    for m in NODE_ATTR_RE.finditer(html):
        events.append((m.start(), "attr", m.group(1), m.group(2), m.group(3)))
    events.sort(key=lambda e: e[0])

    sections: list[DocSection] = []
    cur_var: str | None = None
    cur_attrs: dict[str, str] = {}

    def _emit():
        if cur_var is None:
            return
        if not all(k in cur_attrs for k in
                   ("rcpNo", "dcmNo", "eleId", "offset", "length", "dtd")):
            return
        sections.append(DocSection(
            title=cur_attrs.get("text", cur_var),
            rcp_no=cur_attrs["rcpNo"], dcm_no=cur_attrs["dcmNo"],
            ele_id=cur_attrs["eleId"], offset=cur_attrs["offset"],
            length=cur_attrs["length"], dtd=cur_attrs["dtd"],
        ))

    for ev in events:
        if ev[1] == "var":
            _emit()  # 직전 노드 누적 attr 들로 한 섹션 완성
            cur_var = ev[2]
            cur_attrs = {}
        elif ev[1] == "attr":
            name, key, val = ev[2], ev[3], ev[4]
            if name == cur_var:
                cur_attrs[key] = val
    _emit()  # 마지막 노드도 flush

    # 중복 제거 (같은 ele_id+offset+length 의 노드는 한 번만)
    seen = set()
    unique = []
    for s in sections:
        sig = (s.ele_id, s.offset, s.length, s.rcp_no, s.dcm_no)
        if sig in seen:
            continue
        seen.add(sig)
        unique.append(s)
    return unique


def _decode_safely(content: bytes) -> str:
    """DART 본문은 EUC-KR/CP949인 경우가 많음. UTF-8 우선 시도 후 fallback."""
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def fetch_section_html(section: DocSection) -> str:
    """뷰어 본문 HTML 가져오기 (재시도 포함)."""
    r = _request_with_retry(section.viewer_url, timeout=30)
    return _decode_safely(r.content)


def _request_with_retry(url, params=None, timeout=30, max_retries=2):
    """SSL/일시적 네트워크 오류 시 재시도. 매 재시도 사이 짧은 sleep.

    RemoteDisconnected 는 DART 서버 부하 시 자주 발생 — 즉시 재시도해도 또 끊김.
    backoff 길이 늘려 (3s, 6s) DART 가 회복할 시간 확보.
    """
    import requests as _req
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers=DEFAULT_HEADERS)
            r.raise_for_status()
            return r
        except (_req.exceptions.SSLError, _req.exceptions.ConnectionError,
                _req.exceptions.ChunkedEncodingError) as e:
            last_exc = e
            if attempt < max_retries:
                # backoff 늘림: 3s, 6s (기존 1s, 2s 보다 길게 — DART 회복 대기)
                time.sleep(3.0 * (attempt + 1))
                continue
            raise


def fetch_full_document(rcept_no: str, title_predicate=None) -> dict[str, str]:
    """공시 모든 섹션 HTML을 dict {section_title: html}로 반환.

    title_predicate: callable(title)->bool. 지정 시 매칭하는 섹션만 fetch.
    초기 '증권신고서(채무증권)' 처럼 본문 트리가 깊어 65+ 섹션을 모두 fetch 하면
    수십초 ~ 1분 가까이 소요되는데, 1단계 데이터에 필요한 섹션만 골라 fetch하는 용도.
    """
    sections = list_doc_sections(rcept_no)
    if title_predicate is not None:
        sections = [s for s in sections if title_predicate(s.title)]
    out = {}
    for sec in sections:
        try:
            html = fetch_section_html(sec)
            out[sec.title] = html
            time.sleep(config.REQUEST_SLEEP)
        except Exception as e:
            log.warning("섹션 fetch 실패 rcept_no=%s title=%s: %s", rcept_no, sec.title, e)
    return out


def stage1_title_predicate(title: str) -> bool:
    """초기 '증권신고서(채무증권)' 에서 1단계 데이터 (청약일/회차/만기/등급/
    최초모집/발행한도/희망금리) 추출에 필요한 섹션만 매칭.

    한국 증권신고서 구조: 1단계 데이터는 '모집 또는 매출에 관한 일반사항' 메인 섹션
    및 그 직속 하위 (모집개요, 공모방법, 모집가격결정방법, 모집조건, 인수) 안에 존재.
    """
    norm = title.replace(" ", "").replace(" ", "")
    # 메인 chapter (예: '2. 모집 또는 매출에 관한 일반사항', 'I. 모집 또는 매출에 관한 일반사항')
    if "모집또는매출에관한일반사항" in norm:
        return True
    # 직속 하위 섹션 (1~5 번) — corp 마다 표기 변형 (모집개요/공모개요 등) 대비 generic 매칭.
    # 숫자로 시작 + 채권 관련 키워드 있으면 매칭.
    if re.match(r"^\d+\.", title.strip()):
        for kw in ("모집", "공모", "인수", "사채", "발행", "청약"):
            if kw in norm:
                return True
    return False


def underwriter_title_predicate(title: str) -> bool:
    """H011/H005/H009 refetch 용 — 인수단/희망금리/수요금리 관련 섹션만 매칭.

    적용 대상:
      - 초기 증권신고서 / 정정 신고서 / [발행조건확정] 모두 가능
      - 전체 65+ 섹션 중 채권 발행/인수 관련 ~10개만 골라 fetch → 6배 이상 단축
    """
    norm = title.replace(" ", "").replace(" ", "")
    # 메인 섹션 — 채권 발행 본문이 들어있을 만한 모든 챕터
    if ("모집또는매출에관한일반사항" in norm
            or "증권발행조건확정" in norm
            or "증권의주요권리내용" in norm
            or "인수인의의견" in norm
            or "인수인의무" in norm
            or "분석기관의평가의견" in norm):
        return True
    # 숫자/로마자 prefix 의 인수/모집/사채 관련 직속 하위 섹션
    if re.match(r"^[\dIVX]+\.", title.strip()):
        for kw in ("모집", "공모", "인수", "사채", "발행", "청약", "수요예측",
                    "권리내용", "이자", "수익률"):
            if kw in norm:
                return True
    return False
