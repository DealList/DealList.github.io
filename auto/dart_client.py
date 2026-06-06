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
    rm: str = ""   # 비고 — DART 표시: "유" / "정" / "철" 등. "철" = 철회된 문서.

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


def _get_with_retry(url: str, params: dict, *, timeout: int = 30, tries: int = 3):
    """일시적 네트워크 오류(연결/읽기 타임아웃·연결 끊김)에 한해 백오프 재시도.

    OpenDART 가 매시간 cron 호출 중 가끔 connect timeout 을 내므로, 한 번의 일시적
    블립으로 run 전체가 죽지 않도록 방어. HTTP 상태 오류(4xx/5xx)는 호출부의
    raise_for_status / status 검사가 처리하므로 여기서 재시도하지 않는다.
    """
    last_err = None
    for attempt in range(1, tries + 1):
        try:
            return requests.get(url, params=params, timeout=timeout, headers=DEFAULT_HEADERS)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_err = e
            if attempt < tries:
                wait = 3 * attempt  # 3s, 6s
                log.warning("OpenDART 연결 실패 %s/%s — %ss 후 재시도: %s", attempt, tries, wait, e)
                time.sleep(wait)
    raise last_err  # tries 회 모두 실패 → 원래 예외 그대로 올림


def _list_filings_chunk(start: date, end: date, corp_code: str = "",
                        pblntf_detail_ty: str = "C002") -> list[Filing]:
    """단일 청크(3개월 이내) 조회. corp_code 지정 시 해당 corp 만 (페이지 ↓ → 속도 ↑).

    DART API 는 corp_code 파라미터 지원: 특정 corp 의 공시만 반환 → 한 corp 의 한 기간
    공시는 보통 5건 이내라 페이지 1 만으로 끝. 검증 refetch 시 필수.

    pblntf_detail_ty: C002=채무증권(DCM 기본), C003=지분증권(ECM). default 는 DCM 호환.
    """
    from datetime import timedelta
    out: list[Filing] = []
    page = 1
    while True:
        params = {
            "crtfc_key": config.DART_API_KEY,
            "bgn_de": start.strftime("%Y%m%d"),
            "end_de": end.strftime("%Y%m%d"),
            "pblntf_detail_ty": pblntf_detail_ty,
            "page_no": page,
            "page_count": 100,
        }
        if corp_code:
            params["corp_code"] = corp_code
        r = _get_with_retry(config.OPENDART_LIST_URL, params)
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
                rm=item.get("rm", ""),  # 비고 — "철" 이면 철회
            ))

        total_page = data.get("total_page", 1)
        if page >= total_page:
            break
        page += 1
        time.sleep(config.REQUEST_SLEEP)
    return out


def list_filings(start: date, end: date, only_bond_registration: bool = True,
                 corp_code: str = "", pblntf_detail_ty: str = "C002") -> list[Filing]:
    """발행공시 신고서 목록 조회. 3개월 초과 시 자동 청크 분할.

    pblntf_detail_ty=C002는 발행공시 채무증권 카테고리 전체(증권발행실적보고서,
    일괄신고추가서류, ELS 등)를 반환하므로 only_bond_registration=True인 경우
    report_nm이 '증권신고서(채무증권)'인 것만 필터링.

    pblntf_detail_ty=C003은 지분증권 (ECM). 이 경우 only_bond_registration 은
    의미 없으므로 호출 측에서 False 로 두고 직접 필터링하는 것을 권장.

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
        for f in _list_filings_chunk(chunk_start, chunk_end, corp_code=corp_code,
                                     pblntf_detail_ty=pblntf_detail_ty):
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


def list_ecm_filings(start: date, end: date, corp_code: str = "") -> list[Filing]:
    """ECM (지분증권) 관련 공시 목록 — C001 + C003 통합 + report_nm 필터.

    OpenDART 카테고리 분류 한계 우회:
      - 일부 회사(특히 코스피 대형 발행)의 ECM 공시는 C001(증권신고)에 들어감
      - 다른 회사들은 C003(지분증권)에 들어감
      - 둘 다 받아서 rcept_no dedup 후 report_nm 으로 필터링

    필터링 대상 report_nm (정규화 후 부분 일치):
      - 증권신고서(지분증권)              ← stage1
      - [기재정정]증권신고서(지분증권)    ← amend
      - [발행조건확정]증권신고서(지분증권) ← final
      - 증권발행실적보고서                ← report

    Returns: 시간순 (rcept_no asc) Filing 리스트.
    """
    # 사용자 룰 2026-05-26: 철회신고서도 결과에 포함 (group_into_deals 단계에서
    # deal 단위로 is_withdrawn 표시 → 그 deal 만 skip. corp_code 전체 skip 아님 —
    # 에스투더블유처럼 같은 corp 의 별개 시기 정상 deal 도 살려야 하기 때문).
    out: list[Filing] = []
    seen: set[str] = set()
    for cat in ("C001", "C003"):
        for f in list_filings(start, end, only_bond_registration=False,
                              corp_code=corp_code, pblntf_detail_ty=cat):
            if f.rcept_no in seen:
                continue
            name_norm = (f.report_nm or "").replace(" ", "")
            if ("증권신고서(지분증권)" in name_norm
                    or "증권발행실적보고서" in name_norm
                    or "철회신고서" in name_norm):
                seen.add(f.rcept_no)
                out.append(f)
    out.sort(key=lambda x: x.rcept_no)
    return out


def fetch_deal_filings(any_rcept_no: str, timeout: int = 30) -> list[Filing]:
    """한 ECM 딜의 모든 관련 공시를 main.do "본문선택" dropdown 으로 받기.

    DART 의 main.do?rcpNo=XXX 페이지에는 그 딜의 stage1 ~ report 까지 같은 묶음 안에
    포함된 모든 공시 rcept_no 가 select option 으로 노출. 이를 파싱해서 Filing 리스트로
    반환 — `list_ecm_filings` 의 기간 검색을 우회하여 진짜 stage1 까지 따라 올라가는 용도.

    Args:
        any_rcept_no: 그 딜에 속한 어떤 공시 rcept_no 든 OK (가장 후속도 가능)

    Returns:
        Filing 리스트 (rcept_no asc). corp_name/corp_code 는 빈 값으로 둠
        (caller 가 알고 있는 값 사용). report_nm 은 dropdown 표시 텍스트를 정규화
        — 예: "2026.05.12 [발행조건확정] 증권신고서(지분증권)" → "[발행조건확정]증권신고서(지분증권)"
        단 [기재정정]/[첨부정정]/[첨부추가]/[정정제출요구] 같은 세부 구분은 dropdown 에서
        "[정정]" 으로 단일화되어 표시 — 즉 진짜 stage1 (접두어 없음) 식별만 신뢰 가능.
    """
    r = _request_with_retry(
        config.DART_VIEWER_MAIN, params={"rcpNo": any_rcept_no}, timeout=timeout
    )
    html = r.text

    # 첫 번째 <select> = 본문선택 dropdown
    sel_match = re.search(r"<select[^>]*>.*?</select>", html, re.DOTALL)
    if not sel_match:
        return []

    out: list[Filing] = []
    for m in re.finditer(
        r"<option\s+value=[\"']rcpNo=(\d+)[\"'][^>]*>([^<]*)</option>",
        sel_match.group(0),
    ):
        rcept_no = m.group(1)
        raw_text = m.group(2)
        # 공백·탭·개행·&nbsp; 정리 → 한 줄
        text = raw_text.replace("&nbsp;", " ")
        text = re.sub(r"\s+", " ", text).strip()
        # "2026.05.12 [발행조건확정] 증권신고서(지분증권)"
        date_m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})\s*(.*)$", text)
        if date_m:
            rcept_dt = date_m.group(1) + date_m.group(2) + date_m.group(3)
            report_nm = date_m.group(4).strip().replace(" ", "")
        else:
            rcept_dt = ""
            report_nm = text.replace(" ", "")
        if not report_nm:
            continue
        out.append(Filing(
            rcept_no=rcept_no, corp_name="", corp_code="",
            report_nm=report_nm, rcept_dt=rcept_dt, flr_nm="",
        ))
    out.sort(key=lambda x: x.rcept_no)
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


def _request_with_retry(url, params=None, timeout=30, max_retries=5):
    """SSL/일시적 네트워크 오류 시 재시도. 매 재시도 사이 점차 길어지는 sleep (지수형).

    RemoteDisconnected 는 DART 서버 부하 시 자주 발생 — 즉시 재시도해도 또 끊김.
    backoff: 5s, 10s, 20s, 40s, 80s (총 최대 155초 대기 + 5 회 재시도).
    DART 의 short-window IP throttling 이 풀릴 때까지 충분한 시간 확보.

    **차단 감지 fallback** (2026-05-24 추가):
    5회 retry 모두 ConnectionError 면 IP 차단 (WAF) 가능성 — 30분 대기 후
    1회 더 시도. 그래도 실패면 raise (사용자 개입 필요).
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
                # 지수형 backoff: 5s → 10s → 20s → 40s → 80s
                # DART 의 short-window throttling 회복 대기
                backoff = 5.0 * (2 ** attempt)
                log.warning("DART 요청 실패 (시도 %d/%d, %ds 대기): %s",
                            attempt + 1, max_retries + 1, int(backoff), e)
                time.sleep(backoff)
                continue
            # 모든 retry 실패 — IP 차단 (WAF) 의심. 30분 대기 후 1회 더 시도.
            # Monitor / 사용자가 즉시 인지 가능한 sentinel 출력 (flush=True).
            import sys as _sys
            print("[DART_BLOCKED] 5회 retry 모두 실패 — IP 차단 의심. "
                  "30분 대기 후 재시도. 라우터 리부팅 권장.",
                  file=_sys.stderr, flush=True)
            print("[DART_BLOCKED] 5회 retry 모두 실패 — IP 차단 의심. "
                  "30분 대기 후 재시도. 라우터 리부팅 권장.",
                  flush=True)
            log.warning("DART 5회 retry 모두 실패 — IP 차단 (WAF) 의심. "
                        "30분 대기 후 1회 재시도. (라우터 리부팅으로 IP 갱신 시 즉시 복구)")
            time.sleep(1800)  # 30분
            try:
                r = requests.get(url, params=params, timeout=timeout, headers=DEFAULT_HEADERS)
                r.raise_for_status()
                print("[DART_RECOVERED] 30분 대기 후 재시도 성공 — 작업 계속",
                      flush=True)
                log.info("DART 차단 해제 — 재시도 성공")
                return r
            except Exception as e2:
                print(f"[DART_STILL_BLOCKED] 30분 후에도 실패 — 사용자 개입 필요: {e2}",
                      file=_sys.stderr, flush=True)
                print(f"[DART_STILL_BLOCKED] 30분 후에도 실패 — 사용자 개입 필요: {e2}",
                      flush=True)
                log.error("30분 대기 후에도 실패 — 사용자 개입 필요 "
                          "(라우터 리부팅 또는 시간 더 두고 재시도): %s", e2)
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


def fetch_ecm_stage1_document(rcept_no: str) -> dict[str, str]:
    """ECM 증권신고서(지분증권) 1단계 본문 fetch — 2단 필터:
    1. 제2부 순서 기반 컷오프 (기존)
    2. **ecm_stage1_strict_predicate** 로 제1부 안에서도 parser 가 진짜 쓰는 섹션만
       (2026-05-24 추가, DART WAF 부하 감소 위함)

    감축 효과:
      - 원본: 총 66 섹션
      - 제2부 컷오프: ~20 섹션 (1/3)
      - + strict predicate: **~3-5 섹션** (1/15)
      - 한 공시당 fetch 시간: ~60초 → ~10초

    필요 섹션: I. 모집 또는 매출에 관한 사항 + 하위 공모개요/공모방법/공모가격
              결정방법/모집매출절차/인수등 + III. 투자위험요소 + 요약정보/핵심투자위험.
    """
    sections = list_doc_sections(rcept_no)
    keep = []
    for s in sections:
        t = (s.title or "").replace(" ", "")
        # '제2부' 가 제목 시작에 등장하면 거기서 stop.
        if t.startswith("제2부") or "제2부발행인" in t:
            break
        # strict predicate — 제1부 안에서도 parser 가 진짜 쓰는 섹션만
        if not ecm_stage1_strict_predicate(s.title or ""):
            continue
        keep.append(s)
    out = {}
    for sec in keep:
        try:
            html = fetch_section_html(sec)
            out[sec.title] = html
            time.sleep(config.REQUEST_SLEEP)
        except Exception as e:
            log.warning("ECM stage1 섹션 fetch 실패 rcept_no=%s title=%s: %s",
                        rcept_no, sec.title, e)
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


def ecm_stage1_strict_predicate(title: str) -> bool:
    """ECM stage1 (증권신고서 지분증권 / 정정) — parser 가 진짜 쓰는 섹션만 fetch.

    사용자 확인 (2026-05-24): 진짜 필요한 건 단 2 섹션.
      1. "요약정보 / 2. 모집 또는 매출에 관한 일반사항"
         → 모집 표 (모집수량/가액/방법) + 인수단 표 + 일정 표 (배정기준일/납입일)
         → method, market, init_qty, init_price, record_date, payment_date,
           underwriter_rows 모두 추출
      2. "제1부 모집 또는 매출에 관한 사항 / I. 모집 또는 매출에 관한 일반사항 / 2. 공모방법"
         → 유증의 [구주주 1주당 배정비율 산출근거] 표 = 발행주식총수 (existing_qty)

    일반공모/제3자배정 의 특수 케이스에서는 위 2 섹션에 existing_qty 없을 수
    있음 → main_ecm._process_rights 가 lazy fallback 으로 III. 투자위험요소
    추가 fetch (ecm_risk_factors_predicate 사용).

    부하: 기존 fetch_ecm_stage1_document 가 제2부 컷오프로 ~20 섹션 → 이 predicate
    적용 후 **2 섹션** (1/10 감소).
    """
    norm = title.replace(" ", "")
    # (1) 요약정보 안의 일반사항 — 핵심
    if "2.모집또는매출에관한일반사항" in norm:
        return True
    # (2) I. 모집 또는 매출에 관한 일반사항 / 2. 공모방법
    if "2.공모방법" in norm:
        return True
    return False


def ecm_amend_strict_predicate(title: str) -> bool:
    """amend (정정 신고서) — 일정/발행주식총수 변경 확인 2 섹션.

    (1) "요약정보 / 2. 모집 또는 매출에 관한 일반사항"
        → 배정기준일/납입일 (일정) 변경
    (2) "제1부 모집 또는 매출에 관한 사항 / I. 모집 또는 매출에 관한 일반사항
        / 2. 공모방법"
        → 발행주식총수(자기주식) 변경 → 증자비율 갱신 (현대아산 2023.03.30 케이스)

    부하: amend 당 2 섹션 fetch (기존 11 → 2, 2/11 ≈ 1/5 감소).
    stage1 strict 와 동일 수준.
    """
    norm = title.replace(" ", "")
    # (1) 일정 변경
    if "2.모집또는매출에관한일반사항" in norm:
        return True
    # (2) 발행주식총수(자기주식) 변경 → existing_qty / 증자비율 갱신
    if "2.공모방법" in norm:
        return True
    return False


def ecm_total_shares_predicate(title: str) -> bool:
    """일반공모/제3자배정 fallback — 제2부 발행인에 관한 사항 / I. 회사의 개요 /
    4. 주식의 총수 등 표에서 "IV. 발행주식의 총수 (II-III)" 행 추출용.

    OCI홀딩스 2023-08-31 케이스: 일반공모 → "I. 모집 또는 매출에 관한 일반사항 /
    2. 공모방법" 에 "구주주 1주당 배정비율 산출근거" 표 없음 → 발행주식수 추출 실패.
    "4. 주식의 총수 등" 표의 IV 행 값을 사용 (캡처: 16,412,642).

    main_ecm._process_rights 가 stage1 첫 fetch 후 existing_qty None 이고
    offering_type 이 일반공모/제3자배정 이면 추가로 이 predicate 로 fetch.

    부담: 1 섹션만 추가 — 제2부 안의 다른 섹션은 절대 열지 않음.
    (이전: III. 투자위험요소 fallback — 분량 너무 커 폐기.)
    """
    norm = title.replace(" ", "")
    # "4. 주식의 총수 등" 또는 변종 "4. 주식의 총수"
    return "4.주식의총수" in norm


def ecm_risk_factors_predicate(title: str) -> bool:
    """3차 fallback (옵션 A — 2026-05-25 복원): "4. 주식의 총수 등" 본문이 회사 측
    생략된 케이스 (아미코젠 2025-12: "기재를 생략하였으며 반기보고서 참고") 대비.

    III. 투자위험요소 의 sub-section (사업위험/회사위험/기타위험) 에 [당사 주가 및
    유상증자에 따른 발행주식수 및 가격] 또는 [유통주식수 증가] 표가 있고 거기서
    "현재 발행주식총수" 패턴 매칭 가능. parse_rights_stage1 의 패턴 3/4 가 잡음.

    분량 분담 최소화 — III. 자체 (overview) 는 안 받고 sub-section 만 fetch.
    호출 조건 (main_ecm._process_rights):
        existing_qty None + "4. 주식의 총수 등" fallback 도 None → 이 predicate 시도.
    """
    norm = title.replace(" ", "")
    # III. 의 sub-section 만 fetch (overview 는 정보 거의 없고 분량만 크므로 skip)
    # 보통 "회사위험" 에 [당사 주가 및 유상증자에 따른 발행주식수 및 가격] 표 위치.
    if re.match(r"^\d+\.", title.strip()):
        for kw in ("사업위험", "회사위험", "기타위험"):
            if kw in norm:
                return True
    return False


def ecm_final_strict_predicate(title: str) -> bool:
    """ECM final ([발행조건확정] 증권신고서) — '증권발행조건확정' 섹션만."""
    norm = title.replace(" ", "")
    return "발행조건확정" in norm or "증권발행조건" in norm


def ecm_report_strict_predicate(title: str) -> bool:
    """ECM IPO 증권발행실적보고서 — 청약/배정 + 증권교부일 섹션만."""
    norm = title.replace(" ", "")
    # 메인 chapter
    if "청약및배정에관한사항" in norm or "청약및배정" in norm:
        return True
    if "증권교부일" in norm:
        return True
    # 숫자/로마자 prefix + 키워드
    if re.match(r"^[\dIVX]+\.", title.strip()):
        for kw in ("청약", "배정", "교부일", "인수기관"):
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
