"""ECM (지분증권) 공시 파서 — IPO + 유상증자.

DCM parser.py 와 분리 유지. 같은 dart_client 의 fetch 함수는 재사용.

공시 종류별 처리:
  - IPO:
    · 증권신고서(지분증권)         → 회사명, 시장, 모집방식, 최초 희망, 주관·인수단(예상)
    · [발행조건확정]증권신고서(지분증권) → 최종 가액, 배정 결과(기관/일반/우리사주)
  - 유상증자:
    · 증권신고서(지분증권)         → 회사명, 구분, 신주배정기준일, 납입일, 증자비율, 최초 희망
    · 1차 [발행조건확정]           → 1차 발행가액
    · 2차 [발행조건확정]           → 2차 발행가액 + 최종 발행가액

IPO 와 유상증자 구분은 공시 본문의 "공모방법" / "구분" 텍스트로.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Optional


# ============== 데이터 모델 ==============

@dataclass
class IPORecord:
    """IPO 한 건 — IPO 시트 한 row 에 대응."""
    # 핵심 식별
    issuer: str = ""          # 회사명
    corp_code: str = ""

    # 일정
    listing_date: Optional[date] = None  # 상장일
    market: str = ""           # KOSPI / KOSDAQ

    # 최초 희망 (증권신고서 단계)
    init_qty: Optional[int] = None       # 최초 모집 수량
    init_price_low: Optional[int] = None  # 최초 희망 가액 (low ~ high 범위 평균? 또는 mid)
    init_price_high: Optional[int] = None
    init_price: Optional[int] = None     # 단일값으로 쓸 때 (또는 high)

    # 최종 ([발행조건확정] 단계)
    final_qty: Optional[int] = None
    final_price: Optional[int] = None

    # 모집 방식
    new_share_ratio: Optional[float] = None  # 신주 비율 (0.0 ~ 1.0)
    # 구주 비율 = 1 - new_share_ratio

    # 기관 투자자 배정 / 청약 결과
    inst_initial: Optional[int] = None    # 기관 최초배정
    inst_subscribed: Optional[int] = None # 기관 청약 수량
    inst_final: Optional[int] = None      # 기관 최종배정

    # 일반 투자자
    general_initial: Optional[int] = None
    general_subscribed: Optional[int] = None
    general_final: Optional[int] = None

    # 우리사주
    esop_initial: Optional[int] = None
    esop_final: Optional[int] = None

    # 주관·인수 분배 (broker code → 수량)
    lead_managers: dict[str, int] = field(default_factory=dict)
    underwriters: dict[str, int] = field(default_factory=dict)

    # 식별 메타
    rcept_no_stage1: str = ""   # 최초 신고서 rcept_no
    rcept_no_final: str = ""    # [발행조건확정] rcept_no
    is_spac: bool = False       # SPAC 여부


@dataclass
class RightsRecord:
    """유상증자 한 건 — 유상증자 시트 한 row 에 대응."""
    issuer: str = ""
    corp_code: str = ""

    # 일정
    record_date: Optional[date] = None    # 신주 배정 기준일 (A)
    payment_date: Optional[date] = None   # 납입일 (D)
    offering_type: str = ""                # 구분 (C) — "주주배정 후 실권주 일반공모" 등

    # 증자 비율
    new_qty: Optional[int] = None          # 모집 수량 (E)
    existing_qty: Optional[int] = None     # 기존 주식 수 (F)
    # 비율 G = E/F (계산식)

    # 최초 희망 — stage1 시점 값. 정정 단계에서 변경 안 됨 (사용자 룰 2026-05-25).
    init_qty: Optional[int] = None         # 최초 모집 수량 (H)
    init_price: Optional[int] = None       # 가액 (I)

    # 1차 [발행조건확정]
    stage1_price: Optional[int] = None     # 가액 (K)

    # 2차 [발행조건확정] (앞부분)
    stage2_price: Optional[int] = None     # 가액 (M)
    # 2차 [발행조건확정] (최종)
    final_price: Optional[int] = None      # 가액 (O)

    # 주관·인수 분배 (수량 — 가액 곱하면 금액)
    lead_managers: dict[str, int] = field(default_factory=dict)
    underwriters: dict[str, int] = field(default_factory=dict)

    # 식별 메타
    rcept_no_stage1: str = ""
    rcept_no_final1: str = ""              # 1차 [발행조건확정]
    rcept_no_final2: str = ""              # 2차 [발행조건확정]

    # multi-issue 대응 — 같은 stage1 에 보통주 + 우선주 등 N건 동시 발행.
    # 메인 record 는 첫 issue (Table A row 0). 나머지는 여기 저장 → caller 가 추가 row 작성.
    # 각 dict: {"type": str, "qty": int, "init_price": int, "init_total": int,
    #          "stage1_price": int, "stage2_price": int, "final_price": int,
    #          "method": str}
    _extra_issues: list = field(default_factory=list)


# ============== 표 헤더 정규화 ==============

def _promote_header(t):
    """pandas.read_html 이 multi-row 헤더를 인식 못해 columns 가 정수 (0,1,2,...) 일 때
    row 0 의 값을 헤더로 promote.

    카나프테라퓨틱스 final (rcept=20260304001111) 케이스 — 헤더가 병합돼 있어
    read_html 의 자동 헤더 감지 실패 → columns=[0,1,2,3,4,5] → 모집(매출)방법 매칭 실패.
    """
    try:
        if all(isinstance(c, int) for c in t.columns) and len(t) >= 1:
            new_cols = [str(v) for v in t.iloc[0]]
            t2 = t.iloc[1:].reset_index(drop=True)
            t2.columns = new_cols
            return t2
    except Exception:
        pass
    return t


# ============== Filing 종류 분류 ==============

def classify_filing(report_nm: str) -> str:
    """공시 report_nm 텍스트로 종류 분류.

    **사용자 룰 2026-05-29 (단순화)**: DCM 처럼 stage1 + final + report 만 수집.
    amend / stage1_backfill / 첨부정정 모두 ignore.

    Returns:
      "stage1"   — 순수 증권신고서(지분증권) (접두어 [XXX] 없음)
      "final"    — [발행조건확정] 증권신고서(지분증권)
      "report"   — 증권발행실적보고서
      "withdrawn"— 철회신고서 (deal 자체 skip)
      "ignore"   — 그 외 모든 [...] 접두어 (amend / 첨부 / 정정요구 등)
    """
    name = (report_nm or "").replace(" ", "")
    # 철회
    if "철회신고서" in name:
        return "withdrawn"
    # [발행조건확정]
    if name.startswith("[발행조건확정]") and "증권신고서(지분증권)" in name:
        return "final"
    # 증권발행실적보고서
    if "증권발행실적보고서" in name:
        return "report"
    # 순수 stage1 — 접두어 없는 [증권신고서(지분증권)] 만
    if "[" not in name and "증권신고서(지분증권)" in name:
        return "stage1"
    # 나머지 (amend/stage1_backfill/첨부 등) 모두 무시
    return "ignore"


def parse_offering_summary(html_sections: dict[str, str]) -> dict:
    """증권신고서(지분증권) 의 "2. 모집 또는 매출에 관한 일반사항" 표를 읽어
    IPO/유상증자 분류 + 시장/방법 메타 추출.

    DART 공시는 IPO든 유상증자든 똑같이 "증권신고서(지분증권)" 이름으로 올라오므로
    본문의 두 핵심 표로 구분한다:

      Table A (1행 × 6열) — 증권의 종류 | 증권수량 | 액면가액 | 모집(매출)가액
                          | 모집(매출)총액 | **모집(매출)방법**
        - IPO       : 일반공모
        - 유상증자  : 주주배정후 실권주 일반공모 / 주주우선공모 / 제3자배정 등

      Table B (1행 × 4열) — 인수(주선) 여부 | **지분증권 등 상장을 위한 공모여부** ×3
        - IPO       : 예 / 코스닥시장(또는 유가증권시장) / 신규상장
        - 유상증자  : 아니오 / 해당없음 / 해당없음

    분류 룰:
      Table B 의 셀 어디라도 "코스닥" / "코스피" / "유가증권" / "신규상장" 단어가
      등장하면 IPO, 그렇지 않고 "해당없음" / "아니오" 만 있으면 유상증자.

    Returns:
      {
        "kind": "ipo" / "rights" / "unknown",
        "method": "일반공모" / "주주배정후 실권주 일반공모" / ...,  # 모집(매출)방법 원문
        "market": "코스피" / "코스닥" / "코넥스" / "",       # IPO 시장명
        "listing_kind": "신규상장" / "재상장" / "",          # IPO 상장 종류
        "raw_listing_cells": [예/아니오, 시장명/해당없음, 신규상장/해당없음],
      }
    """
    import pandas as pd
    import io

    out = {"kind": "unknown", "method": "", "market": "",
           "listing_kind": "", "raw_listing_cells": [],
           # Table A 의 가격·수량까지 추출 — IPO/유상증자 stage1 의 단일가액 케이스 (SPAC 등)
           # 및 [발행조건확정] 정정 후 표에서 직접 값 가져오기 위함.
           "init_qty": None, "init_price": None, "init_total": None}

    # Table A / Table B 는 "2. 모집 또는 매출에 관한 일반사항" 섹션의 1·2번째 의미있는 표
    target_html = None
    for title, html in html_sections.items():
        if "모집" in title and "매출" in title and "일반사항" in title:
            target_html = html
            break
    # fallback: 어느 섹션이든 두 표를 찾음
    htmls = [target_html] if target_html else list(html_sections.values())

    method_text = ""
    listing_cells: list[str] = []
    qty_val = None
    price_val = None
    total_val = None
    issues: list[dict] = []  # multi-issue 대응 — Table A 모든 row
    for html in htmls:
        if not html:
            continue
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            # multi-row 헤더 promote (columns 가 정수면 row 0 을 헤더로)
            t = _promote_header(t)
            cols_joined = " ".join(str(c) for c in t.columns)
            cols_norm = re.sub(r"\s+", "", cols_joined)
            # Table A — "모집(매출) 방법" 컬럼 보유
            if "모집(매출)방법" in cols_norm:
                if len(t) >= 1:
                    # 모든 row 순회 (multi-issue 대응 — 솔루스첨단소재 2022-04 케이스)
                    for ri in range(len(t)):
                        issue = {"type": "", "qty": None, "price": None,
                                 "total": None, "method": ""}
                        for c in t.columns:
                            cn = str(c).replace(" ", "")
                            v = str(t.iloc[ri][c]).strip()
                            if not v or v.lower() == "nan":
                                continue
                            if "증권의종류" in cn or "증권종류" in cn:
                                issue["type"] = v
                            elif cn.endswith("방법"):
                                issue["method"] = v
                            elif "증권수량" in cn:
                                try:
                                    issue["qty"] = int(v.replace(",", "").split(".")[0])
                                except ValueError:
                                    pass
                            elif "모집(매출)가액" in cn:
                                try:
                                    issue["price"] = int(v.replace(",", "").split(".")[0])
                                except ValueError:
                                    pass
                            elif "모집(매출)총액" in cn:
                                try:
                                    issue["total"] = int(v.replace(",", "").split(".")[0])
                                except ValueError:
                                    pass
                        if issue["qty"] or issue["price"] or issue["type"]:
                            issues.append(issue)
                        # 첫 row 값을 기존 init_qty/init_price/init_total 로 (backward compat)
                        if ri == 0:
                            if issue["qty"] and qty_val is None: qty_val = issue["qty"]
                            if issue["price"] and price_val is None: price_val = issue["price"]
                            if issue["total"] and total_val is None: total_val = issue["total"]
                            if issue["method"] and not method_text: method_text = issue["method"]
            # Table B — "지분증권 등 상장을 위한 공모여부" 컬럼 보유
            if "지분증권 등 상장을 위한 공모여부" in cols_joined or \
               "지분증권등상장을위한공모여부" in cols_norm:
                if not listing_cells and len(t) >= 1:
                    for c in t.columns:
                        if "공모여부" in str(c):
                            v = str(t.iloc[0][c]).strip()
                            listing_cells.append(v)
        if method_text and listing_cells and qty_val is not None and price_val is not None:
            break

    out["method"] = method_text
    out["raw_listing_cells"] = listing_cells
    # 가액 ↔ 총액 swap 자동 교정 (젠큐릭스 케이스)
    price_val, total_val = _maybe_swap_price_total(
        qty_val, price_val, total_val, context="parse_offering_summary")
    # 수량 자릿수 오기 자동 보정 (아이진 2025-12 케이스: stage1 본문 표에
    # init_qty=16,200,000,000 같은 3자릿수 over-stated 오기).
    # 검증: qty × price ≈ total 이 정상. 안 맞고 total / price 가 깔끔한 정수면
    # 그것을 정상 qty 로 채택.
    qty_val = _maybe_fix_qty_typo(
        qty_val, price_val, total_val, context="parse_offering_summary")
    out["init_qty"] = qty_val
    out["init_price"] = price_val
    out["init_total"] = total_val
    # multi-issue 대응 — Table A 에 row 2+ 이면 추가 발행 건 (솔루스첨단소재 2022-04
    # 케이스: 보통주 + 1우선주 + 2우선주 동시 발행). 첫 row 외 나머지는 caller 가
    # _extra_issues 로 처리.
    out["issues"] = issues

    # 분류
    listing_joined = " ".join(listing_cells).replace(" ", "")
    if any(kw in listing_joined for kw in ["코스닥", "코스피", "유가증권", "코넥스", "신규상장", "재상장"]):
        out["kind"] = "ipo"
        # 시장명
        if "코스피" in listing_joined or "유가증권" in listing_joined:
            out["market"] = "코스피"
        elif "코스닥" in listing_joined:
            out["market"] = "코스닥"
        elif "코넥스" in listing_joined:
            out["market"] = "코넥스"
        # 상장 종류
        for v in listing_cells:
            v2 = v.replace(" ", "")
            if "신규상장" in v2:
                out["listing_kind"] = "신규상장"
                break
            if "재상장" in v2:
                out["listing_kind"] = "재상장"
                break
    elif listing_cells:
        # "아니오" / "해당없음" 만 — 유상증자
        out["kind"] = "rights"
    else:
        # listing_cells 자체가 비어있음 (Table B "지분증권 등 상장을 위한 공모여부"
        # 표가 본문에 없는 경우). 2022년 이전 본문 형식이 이런 경우 多.
        # method + 본문 텍스트 키워드 fallback. 사용자 룰 2026-05-26.
        method_norm = method_text.replace(" ", "")
        full_text_norm = re.sub(r"\s+", "", _full_text(html_sections))
        has_rights_kw = ("주주배정" in method_norm or "주주우선" in method_norm or
                         "제3자배정" in method_norm or "구주주" in method_norm)
        has_listing_kw = any(kw in full_text_norm for kw in (
            "상장주선인", "상장예비심사청구서", "지분증권등상장을위한",
            "코스닥시장상장규정", "유가증권시장상장규정"))
        # 사용자 룰 2026-05-27: **강한 IPO 신호** (유증 본문엔 절대 안 등장하는 키워드)
        # 가 있으면 method 키워드 무시하고 IPO 우선 분류.
        # 핀텔 케이스: 본문 모집(매출)방법 셀이 잘못 "주주배정" 으로 추출됐지만
        # 실제로는 IPO ("상장주선인의 의무 취득분", "지분증권 등 상장을 위한 공모"
        # 키워드 본문 등장).
        strong_ipo_kws = ("상장주선인", "상장예비심사", "지분증권등상장을위한공모",
                          "코스닥시장상장공모", "유가증권시장상장공모",
                          "코넥스시장상장공모")
        has_strong_ipo = any(kw in full_text_norm for kw in strong_ipo_kws)

        # 사용자 룰 2026-05-27 (추가): **Rule A — 유증 강한 신호**.
        # stage1 본문 "2. 모집 또는 매출에 관한 일반사항" 섹션에 "주요사항보고서
        # (유상증자결정)" 링크가 있으면 = 유증 확실. method 추출 잘못이나 다른 신호
        # 모두 무시하고 rights 분류 (해성산업/DL/이지홀딩스/솔디펜스 케이스).
        has_msr_rights = "주요사항보고서(유상증자결정)" in full_text_norm

        # 사용자 룰 2026-05-27 (추가): **Rule B — IPO 강한 신호**.
        # stage1 본문 "2. 공모방법" 섹션의 첫 줄에 "코스닥/코스피/유가증권시장/코넥스
        # 상장공모는 ..." 식 문구가 있으면 = IPO 확실. 뒷부분 표현은 다양
        # ("신주모집" / "일반공모의 방법으로 모집방식을 통해 진행" / "일반공모방식" 등)
        # 이므로 "상장공모는" 까지로 잡는다.
        # 사례: 하나머스트7호 / 모비데이즈 / 하이제7호기업인수목적 (SPAC) 등.
        ipo_phrase = any(kw in full_text_norm for kw in (
            "코스닥상장공모는", "코스피상장공모는",
            "유가증권시장상장공모는", "코넥스상장공모는",
            "코스닥시장상장공모는", "유가증권시장의상장공모는"))

        # 우선순위 (2026-05-27 v2 — Rule B 우선 보정):
        #   1) **Rule B (상장공모는 텍스트)** — IPO 가장 명확한 신호. IPO 증권신고서
        #      본문에 "주요사항보고서(유상증자결정)" 라벨이 흔히 함께 등장하므로
        #      (LG에너지솔루션/에브리봇 케이스: 회사가 IPO 신주모집을 유상증자결정
        #      주요사항보고서로 제출) Rule A 보다 Rule B 우선.
        #   2) 기존 strong_ipo_kws (상장주선인 등) — IPO 강한 신호
        #   3) Rule A (주요사항보고서(유상증자결정)) — 유증 신호. Rule B 없을 때만.
        #   4) rights_kw (주주배정/구주주 등)
        #   5) has_listing_kw (상장규정 등 약한 신호)
        if ipo_phrase or has_strong_ipo:
            out["kind"] = "ipo"
        elif has_msr_rights:
            out["kind"] = "rights"
        elif has_rights_kw:
            out["kind"] = "rights"
        elif has_listing_kw:
            out["kind"] = "ipo"
        # IPO 분류 시 시장명 + listing_kind 추출
        if out["kind"] == "ipo":
            if "유가증권시장" in full_text_norm or "코스피시장" in full_text_norm:
                out["market"] = "코스피"
            elif "코스닥시장" in full_text_norm:
                out["market"] = "코스닥"
            elif "코넥스시장" in full_text_norm:
                out["market"] = "코넥스"
            if "재상장" in full_text_norm:
                out["listing_kind"] = "재상장"
            else:
                out["listing_kind"] = "신규상장"  # 기본 가정

    return out


def classify_offering(html_sections: dict[str, str]) -> str:
    """parse_offering_summary 의 'kind' 만 반환 — 하위호환."""
    return parse_offering_summary(html_sections).get("kind", "unknown")


# ============== 본문 파싱 함수 (skeleton — 다음 단계에서 본격 구현) ==============

def _full_text(html_sections: dict[str, str]) -> str:
    """모든 섹션 HTML 을 텍스트로 합쳐 반환."""
    from bs4 import BeautifulSoup
    parts = []
    for html in html_sections.values():
        try:
            parts.append(BeautifulSoup(html, "lxml").get_text(" ", strip=True))
        except Exception:
            continue
    return "\n\n".join(parts)


def parse_ipo_stage1(html_sections: dict[str, str], rcept_no: str = "",
                     corp_name: str = "", corp_code: str = "") -> Optional[IPORecord]:
    """최초 증권신고서(지분증권) → IPORecord 부분 채움.

    1차 구현: 텍스트 패턴 매칭으로 핵심 메타만 추출.
    상세 인수단 표 파싱은 별도 함수에서 진행 (TODO).
    """
    rec = IPORecord(
        issuer=corp_name,
        corp_code=corp_code,
        rcept_no_stage1=rcept_no,
        is_spac="스팩" in (corp_name or ""),
    )
    text = _full_text(html_sections)

    # 시장 + Table 1 의 가격·수량 통합 추출
    summ = parse_offering_summary(html_sections)
    if summ.get("market"):
        rec.market = summ["market"]
    else:
        # fallback — 본문 텍스트 휴리스틱
        if "코스닥시장 상장" in text or "코스닥시장상장" in text.replace(" ", ""):
            rec.market = "코스닥"
        elif "유가증권시장 상장" in text or "유가증권시장상장" in text.replace(" ", ""):
            rec.market = "코스피"
        elif "코넥스시장" in text:
            rec.market = "코넥스"

    # **사용자 룰**: IPO 의 최초 희망 수량·가액은 "2. 모집 또는 매출에 관한 일반사항"의
    # Table A (= 증권의 종류 | 증권수량 | 액면가액 | 모집(매출)가액 | 모집(매출)총액 |
    # 모집(매출)방법) 만 보고 추출. 일반 IPO 도 SPAC 도 단일값으로 표에 명시되어 있음.
    # **잘못된 위치**: 평가의견서/공모가격결정방법 본문의 "공모희망가액 X원 ~ Y원" 범위
    #                표현은 추출 대상 아님 (사용자 룰 명시 — 그 표만 보자).
    if summ.get("init_qty") is not None:
        rec.init_qty = summ["init_qty"]
    if summ.get("init_price") is not None:
        rec.init_price = summ["init_price"]
        # low/high 필드는 하위호환 유지 — 단일값으로 동기화 (범위 추출은 더 이상 안 함)
        rec.init_price_low = summ["init_price"]
        rec.init_price_high = summ["init_price"]

    # 신주 비율 — **사용자 룰 2026-05-29 (Robust)**: 공백 정규화 후 신주모집/구주매출
    # 수량을 직접 추출해 비율 계산. 구주매출 언급이 없을 때만 1.0(신주100%), 구주매출은
    # 있는데 비율 추출 실패 시 None(빈칸→검증에서 잡힘). 기존 정규식이 "공모 주식의"
    # (공백 변형) 를 못 잡아 1.0 으로 떨어뜨린 버그(빅웨이브로보틱스) 교정.
    text_ns = re.sub(r"\s+", "", text)  # "공모 주식의" → "공모주식의"

    def _qty(pat):
        mm = re.search(pat, text_ns)
        if mm:
            try:
                return int(mm.group(1).replace(",", ""))
            except ValueError:
                return None
        return None

    new_qty = _qty(r"신주모집([\d,]+)주")
    old_qty = _qty(r"구주매출([\d,]+)주")
    m_new_pct = re.search(r"신주모집[\d,]+주\(공모주식의([\d.]+)%\)", text_ns)
    m_old_pct = re.search(r"구주매출[\d,]+주\(공모주식의([\d.]+)%\)", text_ns)
    has_old_token = "구주매출" in text_ns
    if new_qty is not None and old_qty is not None and (new_qty + old_qty) > 0:
        # 신주+구주 혼합 — 수량 기반 비율 (가장 신뢰도 높음). 빅웨이브: 1.9M/(1.9M+0.1M)=0.95
        rec.new_share_ratio = round(new_qty / (new_qty + old_qty), 4)
    elif m_new_pct:
        # 신주모집 괄호 % 직접 사용 (수량 계산 실패 시 대체)
        rec.new_share_ratio = round(float(m_new_pct.group(1)) / 100.0, 4)
    elif m_old_pct is not None:
        # 구주매출 괄호 % → 신주비율 = 1 - 구주%. (구주 100% → 신주 0%).
        # "신주모집" 단어가 다른 맥락에 있어도 영향 없음 (전진건설로봇/이뮨온시아 케이스).
        rec.new_share_ratio = round(1 - float(m_old_pct.group(1)) / 100.0, 4)
    elif old_qty is not None and new_qty is None:
        # 구주매출 수량만 있고 신주모집 수량 없음 → 100% 구주매출 (신주 0%).
        # 서울보증보험 등 괄호 % 미기재 전량 구주매출 케이스.
        rec.new_share_ratio = 0.0
    elif not has_old_token and rec.init_qty is not None:
        # 구주매출 언급 자체가 없음 → 신주 100% (일반 IPO + SPAC)
        rec.new_share_ratio = 1.0
    else:
        # 신주모집 수량/비율 추출 실패 + 구주매출 동반 → 모호 → None (검증 대상)
        rec.new_share_ratio = None

    # init_qty fallback — Table A 에서도 못 잡았으면 텍스트 패턴 시도
    if rec.init_qty is None:
        m = re.search(r"보통주\s*([\d,]+)\s*주", text)
        if m:
            rec.init_qty = int(m.group(1).replace(",", ""))

    # 인수단 표 — 인수(주선)인(역할) / 인수인.1(증권사) / 증권의 종류 / 인수수량 ...
    # 최초 신고서엔 인수금액이 없을 수 있음 → 역할·증권사명·수량만 추출(_underwriter_rows).
    # 금액 없는 '주관/인수 명단'(lead_names/uw_names)은 cloud_update_ecm 이 역할로 분류해 산출.
    import pandas as pd
    import io
    underwriter_rows: list[dict] = []
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            t = _promote_header(t)
            cols = [str(c) for c in t.columns]
            cols_joined = " ".join(cols)
            if not (("인수인" in cols_joined or "인수(주선)인" in cols_joined)
                    and "인수수량" in cols_joined):
                continue
            role_col = name_col = qty_col = None
            for ci, c in enumerate(cols):
                cs = str(c).replace(" ", "")
                if cs in ("인수인", "인수(주선)인") and role_col is None:
                    role_col = ci
                elif (cs.startswith("인수인") or cs.startswith("인수(주선)인")) \
                        and name_col is None and ci != role_col:
                    name_col = ci
                elif "인수수량" in cs:
                    qty_col = ci
            if role_col is None or name_col is None:
                continue
            for _, row in t.iterrows():
                role = str(row.iloc[role_col]).replace(" ", "")
                name = str(row.iloc[name_col]).replace(" ", "")
                if not name or name in ("nan", "None", "계", "합계", "소계"):
                    continue
                qty = None
                if qty_col is not None:
                    try:
                        qty = int(str(row.iloc[qty_col]).replace(",", "").split(".")[0])
                    except (ValueError, TypeError):
                        qty = None
                underwriter_rows.append({"role": role, "name": name, "qty": qty})
            if underwriter_rows:
                break  # 첫 매칭 표 사용 (최초 신고서는 정정 전/후 구분 없음)
        if underwriter_rows:
            break
    setattr(rec, "_underwriter_rows", underwriter_rows)
    return rec


def parse_ipo_final(html_sections: dict[str, str], rcept_no: str = "") -> dict:
    """[발행조건확정] 증권신고서(지분증권) → IPO 의 최종 가액·수량만 추출.

    추출 대상 (이 함수에서):
      - final_qty (정정 후 모집 수량)
      - final_price (정정 후 모집(매출)가액)
      - underwriters_qty_dict (인수단 표 — broker별 인수 수량)

    Note: 청약/배정 결과 (기관/일반/우리사주) 와 broker별 인수금액 (억원) 은
          parse_ipo_report() 에서 처리. 이 함수는 final 공시에서만 추출 가능한
          가액·수량·인수단 수량만 책임.

    Returns: dict — caller 가 IPORecord 에 merge.
    """
    text = _full_text(html_sections)
    out: dict = {"rcept_no_final": rcept_no}

    # 1순위: 본문 안의 "(주1) 정정 후" 표 (Table 1 = 모집(매출)표) 에서 직접 추출.
    #   [발행조건확정] 본문은 정정 전/후 표 두 벌 → 두 번째 (정정 후) 의 값 사용.
    #   SPAC 단일가액 케이스 (= "X원 ~ Y원" 패턴 없음) 도 표에서 정확히 추출됨.
    import pandas as pd
    import io
    offering_tables = []  # 모집(매출)표 (정정 전/후 쌍)
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            t = _promote_header(t)  # multi-row 헤더 정규화 (카나프 케이스)
            cols_norm = re.sub(r"\s+", "", " ".join(str(c) for c in t.columns))
            if "증권수량" in cols_norm and "모집(매출)가액" in cols_norm \
               and "모집(매출)방법" in cols_norm and len(t) >= 1:
                offering_tables.append(t)
    # 두 번째 등장이 정정 후, 한 벌만 있으면 그것 사용
    target_t = offering_tables[1] if len(offering_tables) >= 2 else \
               (offering_tables[0] if offering_tables else None)
    final_total_tmp: Optional[int] = None  # swap 검증용 (반환은 하지 않음)
    if target_t is not None:
        for c in target_t.columns:
            cn = re.sub(r"\s+", "", str(c))
            v = str(target_t.iloc[0][c]).strip()
            if not v or v.lower() == "nan":
                continue
            if cn == "증권수량" or cn.endswith("증권수량"):
                try:
                    out["final_qty"] = int(v.replace(",", "").split(".")[0])
                except ValueError:
                    pass
            elif "모집(매출)가액" in cn:
                try:
                    out["final_price"] = int(v.replace(",", "").split(".")[0])
                except ValueError:
                    pass
            elif "모집(매출)총액" in cn:
                try:
                    final_total_tmp = int(v.replace(",", "").split(".")[0])
                except ValueError:
                    pass

    # 가액 ↔ 총액 swap 자동 교정 (젠큐릭스 케이스)
    if out.get("final_qty") and out.get("final_price") and final_total_tmp:
        fixed_price, _ = _maybe_swap_price_total(
            out["final_qty"], out["final_price"], final_total_tmp,
            context=f"parse_ipo_amend rcept={rcept_no}")
        out["final_price"] = fixed_price

    # \xa0 정규화
    text = text.replace("\xa0", " ")

    # 2순위 (fallback): 본문 텍스트 패턴 — 표 추출 실패한 경우
    if out.get("final_price") is None:
        m = re.search(r"-\s*모집\s*\(\s*매출\s*\)\s*가액\s*:\s*([\d,]+)\s*원", text)
        if m:
            out["final_price"] = int(m.group(1).replace(",", ""))

    # ============ Fallback: "확정공모가액 NNN원" 패턴 (티이엠씨/노브랜드/와이즈넛/알지노믹스 등) ============
    # 본문 안에 여러 번 반복 등장. 정정 후 영역 단일 값이라 false positive 위험 낮음.
    # 패턴 변종: "확정공모가액 28,000원", "확정공모가액인 28,000원", "확정공모가액을 14,000원"
    if out.get("final_price") is None:
        m = re.search(
            r"확정\s*공모\s*가액[을인은]?\s*([\d,]+)\s*원", text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if 100 <= val <= 10_000_000:
                    out["final_price"] = val
            except ValueError:
                pass

    # ============ Fallback: "확정가액: NNN원" 패턴 (노브랜드/알지노믹스) ============
    # 본문 상단 "공통 정정사항 ... - 확정가액: 14,000원 - 확정총액: ..." 형태
    if out.get("final_price") is None:
        m = re.search(r"확정\s*가액\s*[:：]\s*([\d,]+)\s*원", text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if 100 <= val <= 10_000_000:
                    out["final_price"] = val
            except ValueError:
                pass

    # ============ Fallback: "모집(매출)가액(예정) : NNN원" 두 번째 매칭 (티이엠씨 본문 상단) ============
    # 본문 상단 "공통 정정사항" 표 안에서 첫 매칭 = 정정 전, 두 번째 = 정정 후.
    # 예) "모집(매출)가액(예정) : 32,000원 ~ 38,000원" / "모집(매출)가액(예정) : 28,000원"
    if out.get("final_price") is None:
        matches = list(re.finditer(
            r"모집\s*\(\s*매출\s*\)\s*가액\s*\(예정\)\s*[:：]\s*([\d,]+)", text))
        # sanity 통과한 값만 (단일 값이라 1만~1000만원 범위)
        valid = []
        for m in matches:
            try:
                v = int(m.group(1).replace(",", ""))
                if 100 <= v <= 10_000_000:
                    valid.append(v)
            except ValueError:
                pass
        if len(valid) >= 2:
            out["final_price"] = valid[1]

    # ============ final_qty fallback ============
    # 본문 상단: "2. 모집 또는 매출 증권의 종류 : 기명식 보통주 1,800,000 주"
    # 기존 패턴은 "기명식" 안 들어가 매칭 실패 → 한국어 1~5자 옵션으로 확장
    if out.get("final_qty") is None:
        m = re.search(
            r"모집\s*또는\s*매출\s*증권의\s*종류\s*[:：]\s*[가-힣]{0,5}\s*보통주\s*([\d,]+)\s*주",
            text)
        if m:
            try:
                out["final_qty"] = int(m.group(1).replace(",", ""))
            except ValueError:
                pass

    # ============ Fallback: 가액 = 매출금액 / 수량 계산 (스톰테크 케이스) ============
    # 본문 상단에 "기명식 보통주 NNN주 / 3. 모집 또는 매출금액 : NNN원" 만 있고 표
    # 추출 실패한 경우 — 두 값으로 단가 역산.
    if out.get("final_price") is None and out.get("final_qty"):
        qty = out["final_qty"]
        m = re.search(
            r"모집\s*또는\s*매출\s*금?\s*액\s*[:：]\s*([\d,]+)\s*원", text)
        if m and qty > 0:
            try:
                total = int(m.group(1).replace(",", ""))
                cand = total / qty
                if abs(cand - round(cand)) < 0.5:
                    cand_int = int(round(cand))
                    if 100 <= cand_int <= 10_000_000:
                        out["final_price"] = cand_int
            except ValueError:
                pass

    # 인수단 표 — pandas read_html 로 모든 표 추출 후 "인수인" + "인수수량" 컬럼 가진
    # 표 찾음. 컬럼: 인수인(역할) / 인수인.1(증권사) / 증권의 종류 / 인수수량 / 인수금액 / 인수대가 / 인수방법
    # [발행조건확정] 본문은 (주1) 정정 전 / (주1) 정정 후 두 영역으로 인수단 표도
    # 2개 등장 — **두 번째 (정정 후) 채택**. 사용자 룰: [발행조건확정] 의 주목적
    # 자체가 정정 후 정보 추출. (LG씨엔에스 2025-01 케이스로 검증)
    import pandas as pd
    import io
    underwriter_tables: list = []  # 정정 전·후 매칭 표들
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            t = _promote_header(t)
            cols = [str(c) for c in t.columns]
            cols_joined = " ".join(cols)
            if not (("인수인" in cols_joined or "인수(주선)인" in cols_joined)
                    and "인수수량" in cols_joined):
                continue
            underwriter_tables.append(t)

    # 두 번째 매칭 = 정정 후 / 한 벌만 있으면 그것 사용
    target_t = underwriter_tables[1] if len(underwriter_tables) >= 2 else \
               (underwriter_tables[0] if underwriter_tables else None)

    underwriter_rows: list[dict] = []
    if target_t is not None:
        cols = [str(c) for c in target_t.columns]
        role_col, name_col, qty_col, amt_col = None, None, None, None
        for ci, c in enumerate(cols):
            cs = str(c).replace(" ", "")
            if cs in ("인수인", "인수(주선)인") and role_col is None:
                role_col = ci
            elif (cs.startswith("인수인") or cs.startswith("인수(주선)인")) \
                    and name_col is None and ci != role_col:
                name_col = ci
            elif "인수수량" in cs:
                qty_col = ci
            elif "인수금액" in cs and amt_col is None:
                amt_col = ci
        if role_col is not None and name_col is not None and qty_col is not None:
            for _, row in target_t.iterrows():
                role = str(row.iloc[role_col]).replace(" ", "")
                name = str(row.iloc[name_col]).replace(" ", "")
                qty = row.iloc[qty_col]
                try:
                    qty_int = int(str(qty).replace(",", ""))
                except (ValueError, TypeError):
                    continue
                if not name or name in ("nan", "None", "계", "합계"):
                    continue
                amt_won = None
                if amt_col is not None:
                    try:
                        # 정정 후 표는 "46,350,000,000원" 형태 (콤마 + "원" 포함 문자열).
                        # "원"·공백·콤마 모두 제거 후 정수 변환. (컨텍 IPO 케이스)
                        raw = str(row.iloc[amt_col]).replace(",", "").replace("원", "").strip()
                        amt_won = int(raw.split(".")[0])
                    except (ValueError, TypeError):
                        amt_won = None
                underwriter_rows.append({
                    "role": role,
                    "name": name,
                    "qty": qty_int,
                    "amount_won": amt_won,
                })
    out["underwriter_rows"] = underwriter_rows

    # 기관투자자 수요예측 청약 수량 — 헬퍼 함수로 위임 (재사용 가능)
    out["inst_subscribed_demand"] = extract_inst_demand_qty(html_sections)
    return out


def extract_inst_demand_qty(html_sections: dict[str, str]) -> Optional[int]:
    """수요예측 결과 표에서 기관청약 합계 수량 추출 — 3단계 fallback.

    parse_ipo_final 의 inst_subscribed_demand 추출 룰을 함수로 추출 — main_ecm
    이 [정정]투자설명서 같은 별도 본문에서 재추출 시 동일 룰 재사용 (사용자
    룰 2026-05-26: [발행조건확정] 에서 못 잡은 경우에만 한정).
    """
    import pandas as pd
    import io
    demand_qty: Optional[int] = None
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            try:
                first_col_vals = [str(v).replace(" ", "") for v in t.iloc[:, 0]]
            except Exception:
                continue
            # 2022년 이전 본문은 첫 컬럼 라벨이 "참여기관/전체/경쟁률" (수량 대신 "전체"),
            # 2023+ 본문은 "건수/수량/경쟁률". 두 형식 모두 인식.
            has_geonsu  = any("건수" in v or "참여기관" in v for v in first_col_vals)
            has_suryang = any(v == "수량" or v == "전체" for v in first_col_vals)
            has_compete = any("경쟁률" in v for v in first_col_vals)
            if not (has_geonsu and has_suryang and has_compete):
                continue
            # "수량" 또는 "전체" 행의 마지막 컬럼 (= 합계) 값
            for ri in range(len(t)):
                v = str(t.iloc[ri, 0]).replace(" ", "")
                if v == "수량" or v == "전체":
                    last_val = t.iloc[ri, -1]
                    try:
                        demand_qty = int(str(last_val).replace(",", "").split(".")[0])
                    except (ValueError, TypeError):
                        pass
                    break
            if demand_qty is not None:
                break
        if demand_qty is not None:
            break
    # Fallback: 단일 행 표 (참여건수(건) / 신청수량(주) / 단순경쟁률) — 교보14호스팩 등.
    # 첫 컬럼에 "건수/수량/경쟁률" 행이 없고, 컬럼 헤더에 "참여건수+신청수량" 둘 다 있음.
    if demand_qty is None:
        for html in html_sections.values():
            try:
                tables = pd.read_html(io.StringIO(html), flavor="lxml")
            except Exception:
                continue
            for t in tables:
                cols = [str(c).replace(" ", "") for c in t.columns]
                cols_joined = " ".join(cols)
                if "신청수량" not in cols_joined or "참여건수" not in cols_joined:
                    continue
                # 잡음 차단: 인수단/배정/가격분포 표 제외
                if "인수인" in cols_joined or "배정" in cols_joined or "비율" in cols_joined:
                    # 가격분포 표 (참여건수 기준+신청수량 기준) — 합계 row 만 인정
                    if len(t) >= 2:
                        last_first = str(t.iloc[-1, 0]).replace(" ", "")
                        if "합계" in last_first or "합 계" in str(t.iloc[-1, 0]) or last_first == "계":
                            # 신청수량 컬럼 찾기
                            for ci, c in enumerate(cols):
                                if "신청수량(주)" in c or c == "신청수량":
                                    try:
                                        v = int(str(t.iloc[-1, ci]).replace(",", "").split(".")[0])
                                        if v > 0:
                                            demand_qty = v
                                            break
                                    except (ValueError, TypeError):
                                        pass
                    continue
                # 단순 표 (단일 데이터 row)
                if len(t) != 1:
                    continue
                for ci, c in enumerate(cols):
                    if "신청수량" in c:
                        try:
                            v = int(str(t.iloc[0, ci]).replace(",", "").split(".")[0])
                            if v > 0:
                                demand_qty = v
                                break
                        except (ValueError, TypeError):
                            pass
                if demand_qty is not None:
                    break
            if demand_qty is not None:
                break

    # Fallback 2 — 텍스트 패턴: read_html 이 표 인식 실패한 케이스 (한화플러스제4호 등)
    # "참여건수(건) 신청수량(주) 단순경쟁률 NNN NNN,NNN,NNN NNN.NN" 직접 매칭
    if demand_qty is None:
        text = _full_text(html_sections).replace("\xa0", " ")
        m = re.search(
            r"참여건수\s*\(\s*건\s*\)\s*신청수량\s*\(\s*주\s*\)\s*단순\s*경쟁률\s+"
            r"[\d,]+\s+([\d,]+)\s+[\d.]+",
            text)
        if m:
            try:
                demand_qty = int(m.group(1).replace(",", ""))
            except ValueError:
                pass

    return demand_qty


# ============== 표 추출 헬퍼 (IPO report) ==============

def _find_allocation_table(html_sections: dict[str, str]):
    """report 의 "Ⅱ. 청약 및 배정에 관한 사항" 섹션에서
    구분|최초배정|청약현황|최종배정 행짜리 표 찾기.

    행 구성: 우리사주조합 + 기관투자자 + 일반투자자 (+ 계).
    일부 IPO (나노팀 등) 는 우리사주조합 배정 없음 → 2행 (기관 + 일반).
    조건 완화: 우리사주조합/기관투자자/일반투자자 중 하나라도 첫 컬럼에 있고,
              컬럼 헤더에 "최초 배정" 포함 (다른 표 false positive 차단).

    Returns: pandas DataFrame 또는 None
    """
    import pandas as pd
    import io
    for sec_key, html in html_sections.items():
        if "청약" not in sec_key and "배정" not in sec_key:
            continue
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            try:
                first_col_vals = [str(v).replace(" ", "") for v in t.iloc[:, 0]]
            except Exception:
                continue
            has_alloc_row = any(
                ("우리사주조합" in v) or ("기관투자자" in v)
                or ("일반투자자" in v) or ("일반공모" in v)
                or ("개인청약자" in v) or ("일반청약자" in v)
                for v in first_col_vals)
            if not has_alloc_row:
                continue
            # 컬럼 헤더에 "최초 배정" 확인 — false positive 차단
            cols_str = " ".join(str(c) for c in t.columns)
            cols_norm = cols_str.replace(" ", "").replace("(", "").replace(")", "")
            # "최종배정" / "최종 배정" / "배정현황" — 2020 IPO 보고서는 "배정현황"
            # 컬럼명 사용. 케이비제20호기업인수목적 (2020-01) 케이스.
            if ("최초배정" in cols_norm or "최초 배정" in cols_str) \
                    and ("최종배정" in cols_norm or "최종 배정" in cols_str
                         or "배정현황" in cols_norm):
                return t
    return None


def _find_underwriter_amount_table(html_sections: dict[str, str]):
    """report 의 "Ⅱ. 청약 및 배정에 관한 사항" 섹션 안 "2. 인수기관별 인수금액" 표
    (확정 인수금액 — 단위 원).

    행: 증권사 1개씩 (마지막 "계" 제외).
    컬럼: 인수기관 / 인수수량 / 인수금액 / 비율(%) / 비고
    """
    import pandas as pd
    import io
    for sec_key, html in html_sections.items():
        if "청약" not in sec_key and "배정" not in sec_key:
            continue
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            cols = " ".join(str(c) for c in t.columns).replace(" ", "")
            if "인수기관" in cols and "인수금액" in cols:
                return t
    return None


def parse_ipo_report(html_sections: dict[str, str], rcept_no: str = "") -> dict:
    """증권발행실적보고서 → 청약/배정 결과 + 확정 인수금액 추출.

    Returns: dict — caller 가 IPORecord 에 merge.
      keys:
        rcept_no_report
        inst_initial / inst_subscribed / inst_final
        general_initial / general_subscribed / general_final
        esop_initial / esop_final
        underwriter_amounts: list[dict] — [{"name": ..., "amount_won": ..., "qty": ...}, ...]
    """
    out: dict = {"rcept_no_report": rcept_no}

    # 1. 청약/배정 표
    alloc = _find_allocation_table(html_sections)
    if alloc is not None:
        # 행 인덱싱: 구분 컬럼에서 행 찾기
        def _row_for(keywords):
            """keywords: list[str] — 순서대로 매칭 시도."""
            if isinstance(keywords, str):
                keywords = [keywords]
            for kw in keywords:
                for ri in range(len(alloc)):
                    v = str(alloc.iloc[ri, 0]).replace(" ", "")
                    # "계"/"합계" 행은 제외 (전체 합계 행이 keyword 와 헷갈리지 않게)
                    if v in ("계", "합계", "합 계"):
                        continue
                    if kw in v:
                        return alloc.iloc[ri]
            return None

        def _to_int(v):
            try:
                return int(str(v).replace(",", "").replace(".0", ""))
            except (ValueError, TypeError):
                return None

        # 컬럼 인덱스 추정 (multi-level header 가 flatten 됐다고 가정)
        # 기대 컬럼 순서:
        #   0: 구분  1: 최초배정 수량  2: 최초배정 비율
        #   3: 청약현황 건수  4: 청약현황 수량  5: 청약현황 금액  6: 청약현황 비율
        #   7: 최종배정 건수  8: 최종배정 수량  9: 최종배정 금액  10: 최종배정 비율
        IDX_INIT_QTY, IDX_SUB_QTY, IDX_FINAL_QTY = 1, 4, 8

        # keyword 변종 지원 — 회사마다 라벨 다름:
        #   esop:    "우리사주조합" / "우리사주"
        #   inst:    "기관투자자" / "기관" (단 "외국기관" 같은 sub-row 와 헷갈릴 위험)
        #   general: "일반투자자" / "일반청약자" / "일반합계" (나우로보틱스 케이스)
        for keywords, prefix in [
            (["우리사주조합", "우리사주"], "esop"),
            (["기관투자자"], "inst"),
            # "일반공모" / "개인청약자" 추가 — 2020 일부 보고서 변종 라벨
            # (켄코아/드림씨아이에스/SK바이오팜/하이브 → "일반공모",
            #  신영해피투모로우 → "개인청약자")
            (["일반투자자", "일반청약자", "일반합계", "일반공모", "개인청약자"],
             "general"),
        ]:
            row = _row_for(keywords)
            if row is None:
                continue
            init = _to_int(row.iloc[IDX_INIT_QTY])
            sub  = _to_int(row.iloc[IDX_SUB_QTY])
            fin  = _to_int(row.iloc[IDX_FINAL_QTY])
            # 사용자 룰 2026-05-27 (정정): 우리사주 (esop)
            #   - init == 0: IPO 에 우리사주 배정 자체 없음 → 전체 None (빈 셀)
            #   - init > 0 인데 sub/fin == 0: 배정 받았으나 청약 zero (핀텔 2022-10) →
            #     0 보존 (자동 청약률 0% 계산)
            if prefix == "esop":
                if init == 0:
                    init = sub = fin = None
                # init > 0 + sub/fin = 0 → 0 그대로 보존 (이전 룰처럼 None 으로 안 만듦)
            if init is not None:  out[f"{prefix}_initial"] = init
            if sub is not None:   out[f"{prefix}_subscribed"] = sub
            if fin is not None:   out[f"{prefix}_final"] = fin
            # report 본문에 sub/fin 이 "-" 등으로 추출 실패 (None) 인 경우 — esop
            # 초배정 있으면 청약 없음으로 간주 (0). 핀텔 케이스 (init=100k, final 행이
            # 표에서 추출 안 됨): 사용자 검증 결과 우리사주 청약 zero 가 정확.
            if prefix == "esop" and out.get("esop_initial"):
                if out.get("esop_subscribed") is None:
                    out["esop_subscribed"] = 0
                if out.get("esop_final") is None:
                    out["esop_final"] = 0

    # 2. 인수기관별 인수금액 표
    uw_tbl = _find_underwriter_amount_table(html_sections)
    underwriter_amounts: list[dict] = []
    if uw_tbl is not None:
        # 컬럼: 인수기관 / 인수수량 / 인수금액 / 비율 / 비고
        cols = [str(c).replace(" ", "") for c in uw_tbl.columns]
        col_name = col_qty = col_amt = None
        for ci, c in enumerate(cols):
            if "인수기관" in c and col_name is None:
                col_name = ci
            elif "인수수량" in c:
                col_qty = ci
            elif "인수금액" in c:
                col_amt = ci
        if col_name is not None and col_amt is not None:
            for _, row in uw_tbl.iterrows():
                name = str(row.iloc[col_name]).replace(" ", "")
                if not name or name in ("nan", "None", "계", "합계"):
                    continue
                try:
                    # "46,350,000,000원" / "46,350,000,000 원" 형태 호환.
                    amt = int(str(row.iloc[col_amt]).replace(",", "").replace("원", "").strip())
                except (ValueError, TypeError):
                    continue
                qty = None
                if col_qty is not None:
                    try:
                        qty = int(str(row.iloc[col_qty]).replace(",", "").replace("주", "").strip())
                    except (ValueError, TypeError):
                        qty = None
                underwriter_amounts.append({
                    "name": name,
                    "amount_won": amt,
                    "qty": qty,
                })
    out["underwriter_amounts"] = underwriter_amounts

    # 3. 확정 상장일 — "Ⅳ. 증권교부일 등" 의 "3. 상장일(매매개시일)" 셀.
    #    사용자 룰: 청약 결과 후 발표되는 증권발행실적보고서가 이 IPO 의 진짜 상장일을
    #    확정함. KIND 의 예정일을 이 값으로 덮어쓰는 것이 IPO 데이터 마무리의 핵심.
    listing_date = None
    full_text = ""
    for html in html_sections.values():
        try:
            from bs4 import BeautifulSoup as _BS
            full_text += "\n" + _BS(html, "lxml").get_text(" ", strip=True)
        except Exception:
            continue
    # 패턴 1: "3. 상장일(매매개시일) : YYYY년 MM월 DD일" 또는 "YYYY-MM-DD" / "YYYY.MM.DD"
    m = re.search(
        r"상장일\s*\(\s*매매개시일\s*\)\s*[:\-]?\s*"
        r"(?:(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일"
        r"|(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}))",
        full_text,
    )
    if m:
        if m.group(1):
            y, mo, d = m.group(1), m.group(2), m.group(3)
        else:
            y, mo, d = m.group(4), m.group(5), m.group(6)
        try:
            listing_date = date(int(y), int(mo), int(d))
        except ValueError:
            listing_date = None
    if listing_date is not None:
        out["listing_date_confirmed"] = listing_date
    return out


# ============== broker 컬럼 리스트 — config_ecm.LEAD_ECM/UW_ECM 단일화 ==============
# 이전: parser_ecm.IPO_LEAD_BROKERS / IPO_UW_BROKERS / RIGHTS_LEAD_BROKERS / RIGHTS_UW_BROKERS
#       4개 리스트가 별도 정의되어 있었으나, IPO/유상증자 시트의 broker 영역이 통일되어
#       config_ecm.LEAD_ECM / UW_ECM 단일 리스트로 통합됨.
# 하위호환을 위해 아래 4개 alias 를 유지 — 모두 같은 객체를 가리킴.
import config_ecm as _config_ecm
IPO_LEAD_BROKERS = _config_ecm.LEAD_ECM
IPO_UW_BROKERS = _config_ecm.UW_ECM


# ============== broker alias 정규화 ==============
# DCM 의 brokers_formal_to_alias 를 재사용 + ECM 외국계 추가.
# 공시 본문의 정식명을 alias 로 변환. 부분 일치 (formal 이 본문에 포함되면 매칭).
_BROKER_FORMAL_TO_ALIAS_ECM: dict[str, str] = {}

def _load_broker_aliases():
    """auto/mappings.json 의 brokers_formal_to_alias 로드 + ECM 외국계 추가."""
    global _BROKER_FORMAL_TO_ALIAS_ECM
    if _BROKER_FORMAL_TO_ALIAS_ECM:
        return _BROKER_FORMAL_TO_ALIAS_ECM
    import json
    from pathlib import Path
    mp = Path(__file__).parent / "mappings.json"
    try:
        m = json.loads(mp.read_text(encoding="utf-8"))
        formal_to_alias = m.get("brokers_formal_to_alias", {})
    except Exception:
        formal_to_alias = {}
    # ECM 추가 외국계 (DCM 에는 없음)
    formal_to_alias.update({
        "JP모간증권": "JP모간",
        "JP모건증권": "JP모간",
        "JP모간": "JP모간",
        "JPMorgan": "JP모간",
        "UBS": "UBS",
        "USB증권": "UBS",  # 과거 오타 alias 호환 — 본문에 "USB증권" 등장 시 UBS 로 매핑
        "UBS증권": "UBS",
        "메릴린치": "메릴린치",
        "메릴린치증권": "메릴린치",
        "모간스탠리": "모간스탠리",
        "Morgan Stanley": "모간스탠리",
        "엔에이치투자증권": "NH",  # report 표에서 한글 풀네임으로 나오는 케이스
        "유진투자증권": "유진",
        "유안타증권": "유안타",
    })
    _BROKER_FORMAL_TO_ALIAS_ECM = formal_to_alias
    return _BROKER_FORMAL_TO_ALIAS_ECM


def broker_alias(formal_name: str) -> Optional[str]:
    """공시 본문의 증권사 정식 명칭 → alias 매핑. 못 찾으면 None."""
    if not formal_name:
        return None
    name = formal_name.replace(" ", "")
    mp = _load_broker_aliases()
    # 1) 직접 일치
    if name in mp:
        return mp[name]
    # 2) 부분 일치 (정식명이 본문 이름에 포함)
    for formal, alias in mp.items():
        f = formal.replace(" ", "")
        if f and (f in name or name in f):
            return alias
    return None


# ============== 신규 broker 자동 등록 ==============
# DCM 의 parser.auto_register_broker 와 동일 흐름 — config_ecm.LEAD_ECM/UW_ECM 에 inplace 추가.
# 자동 약어 생성은 DCM 의 _auto_alias 재활용 (parser.py 의 _BROKER_SUFFIXES 와 동일 룰).
_BROKER_SUFFIXES_ECM = (
    "투자증권금융", "투자증권", "금융투자", "증권금융",
    "투자은행", "캐피탈", "증권", "투자",
)


def _auto_alias_ecm(formal_name: str) -> str:
    """정식 증권사명 → 자동 약칭. 접미사 제거 후 핵심 이름.

    예: '삼성증권' → '삼성', '한화투자증권' → '한화', '메리츠증권' → '메리츠'
    """
    name = re.sub(r"[\(\)\s주식회사㈜]+", "", formal_name or "").strip()
    if not name:
        return ""
    for suf in _BROKER_SUFFIXES_ECM:
        if name.endswith(suf) and len(name) > len(suf):
            return name[:-len(suf)]
    return name


def auto_register_broker_ecm(formal_name: str, role: str, mappings: dict) -> str:
    """ECM 본문에서 미매핑 증권사 발견 시 자동 alias 생성 + 모든 곳에 등록.

    동작:
      1. _auto_alias_ecm 으로 약어 생성
      2. mappings["brokers_formal_to_alias"][formal_name] = alias
      3. role 에 "대표"/"주관" 포함 시 mappings["lead_managers"] + config_ecm.LEAD_ECM 추가
      4. mappings["underwriters"] + config_ecm.UW_ECM 항상 추가
      5. mappings["_auto_added_brokers"] 기록 (main_ecm._persist_auto_added 가 저장)
      6. _BROKER_FORMAL_TO_ALIAS_ECM 캐시도 갱신 (다음 broker_alias 호출에 즉시 반영)

    Returns: alias 문자열 (실패 시 빈 문자열)
    """
    import config_ecm

    alias = _auto_alias_ecm(formal_name)
    if not alias:
        return ""

    # 1) mappings.json 의 정식 매핑 등록
    mappings.setdefault("brokers_formal_to_alias", {})[formal_name] = alias

    is_lead = "대표" in (role or "") or "주관" in (role or "")
    # 2) lead_managers (대표/주관 만)
    if is_lead:
        leads = mappings.setdefault("lead_managers", [])
        if alias not in leads:
            leads.append(alias)
        if alias not in config_ecm.LEAD_ECM:
            config_ecm.LEAD_ECM.append(alias)
    # 3) underwriters (항상)
    uws = mappings.setdefault("underwriters", [])
    if alias not in uws:
        uws.append(alias)
    if alias not in config_ecm.UW_ECM:
        config_ecm.UW_ECM.append(alias)

    # 4) 자동등록 history (main_ecm._persist_auto_added 가 mappings.json 저장 시 분리)
    mappings.setdefault("_auto_added_brokers", []).append({
        "formal": formal_name, "alias": alias, "role": role,
        "source": "ecm",
    })

    # 5) 캐시 즉시 갱신 — 다음 broker_alias 호출에서 잡히도록
    _load_broker_aliases()
    _BROKER_FORMAL_TO_ALIAS_ECM[formal_name] = alias

    return alias


def ensure_lead_alias(alias: str, role: str, mappings: dict) -> bool:
    """기존에 등록된 broker alias 가 새 deal 의 lead role 로 등장 시 LEAD_ECM 보강.

    auto_register_broker_ecm 은 신규 alias 만 등록 — 이미 alias 가 있는데 UW
    영역만 등록된 상태에서 새 deal 의 role 이 lead 인 경우 (예: 메릴린치/
    모간스탠리 같은 외국계가 신규 IPO 에서 대표주관 역할), LEAD_ECM 에
    자동 추가 + mappings.json 영구 저장.

    호출 위치: main_ecm 의 broker aggregate 흐름 (_process_ipo/_process_rights)
              + validator_ecm_fixes 의 H016 fix handler.

    Returns: 추가됐으면 True, 이미 있거나 lead 아니면 False.
    """
    import config_ecm
    if not alias:
        return False
    if "대표" not in (role or "") and "주관" not in (role or ""):
        return False
    if alias in config_ecm.LEAD_ECM:
        return False  # 이미 등록됨
    # 등록
    config_ecm.LEAD_ECM.append(alias)
    leads = mappings.setdefault("lead_managers", [])
    if alias not in leads:
        leads.append(alias)
    # _auto_added_brokers 에 기록 → persist_auto_added 가 mappings.json 영구 저장
    mappings.setdefault("_auto_added_brokers", []).append({
        "formal": "", "alias": alias, "role": role,
        "source": "ecm_lead_upgrade",
    })
    return True


# ============== 주관 실적 산식 ==============

def compute_lead_performance(
    underwriter_amounts_eok: dict[str, float],   # broker_alias → 인수금액 (억원)
    lead_aliases: set[str],                       # 주관사로 분류된 alias set
) -> dict[str, float]:
    """DCM 동일 산식:
       주관 실적 = 본인 인수금액 + (전체 인수합 − 모든 주관사 인수합) ÷ 주관사 수

    Returns: alias → 주관 실적 (억원). 주관 아닌 broker 는 dict 에 미포함.

    **잔차 보정** (2026-05-26): _write_ipo_row 등에서 broker 셀에 적을 때
    round(v) 정수화하므로, share 가 비정수면 누적 round-down 으로 H017 발생
    (예: HD현대마린솔루션 share 74.4 × 5명 = 372 → 5×74 = 370, 2 손실).
    raw 합과 round 합의 차이를 가장 잔여분 큰 lead 부터 ±1 분배해 보정.
    """
    if not lead_aliases:
        return {}
    total = sum(underwriter_amounts_eok.values())
    leads_sum = sum(v for k, v in underwriter_amounts_eok.items() if k in lead_aliases)
    residual = total - leads_sum
    share = residual / len(lead_aliases)
    raw = {alias: underwriter_amounts_eok.get(alias, 0) + share for alias in lead_aliases}
    # 정수 잔차 보정 — round 합이 round(target=leads_sum+residual)=round(total)
    # 과 일치하도록 ±1 분배.
    target_int = round(leads_sum + residual)
    rounded = {alias: round(v) for alias, v in raw.items()}
    diff = target_int - sum(rounded.values())
    if diff != 0:
        # round-up 잔여분 큰 순(diff>0) 또는 round-down 잔여분 큰 순(diff<0) 정렬
        sorted_a = sorted(lead_aliases,
                          key=lambda a: raw[a] - rounded[a],
                          reverse=(diff > 0))
        for alias in sorted_a[:abs(diff)]:
            rounded[alias] += 1 if diff > 0 else -1
    return rounded


def parse_rights_stage1(html_sections: dict[str, str], rcept_no: str = "",
                        corp_name: str = "", corp_code: str = "") -> Optional[RightsRecord]:
    """최초 증권신고서(지분증권) — 유상증자 → RightsRecord 부분 채움.

    추출 대상:
      - issuer, offering_type (구분, parse_offering_summary 사용)
      - record_date (배정기준일), payment_date (납입일)
      - new_qty (모집 수량), existing_qty (발행주식 총수)
      - init_price (최초 희망가)
      - underwriter_rows (인수단 — 주관/인수 구분)

    핵심 데이터 위치 (경남제약 stage1 기준 검증):
      - "2. 모집 또는 매출에 관한 일반사항" 의
          Table 1 (1×6): 증권수량 | 액면가액 | 모집(매출)가액 | 총액 | 방법
          Table 3 (1×7): 인수(주선)인 - 대표/공동대표/인수 + 사명
          Table 4 (1×5): 청약기일 | 납입기일 | 청약공고일 | 배정공고일 | 배정기준일
      - existing_qty: 본문 텍스트의 "C. 발행주식총수(A+B) X,XXX,XXX주" 또는
                       "기발행주식총수 X,XXX,XXX주" 패턴.
    """
    import pandas as pd
    import io

    rec = RightsRecord(
        issuer=corp_name,
        corp_code=corp_code,
        rcept_no_stage1=rcept_no,
    )

    # 1) 분류 + offering_type (구분 C)
    summ = parse_offering_summary(html_sections)
    rec.offering_type = summ.get("method", "")

    # 2) "2. 모집 또는 매출에 관한 일반사항" 섹션의 표들에서 핵심 정보 추출
    target_html = None
    for title, html in html_sections.items():
        if "모집" in title and "매출" in title and "일반사항" in title:
            target_html = html
            break

    underwriter_rows: list[dict] = []
    if target_html:
        try:
            tables = pd.read_html(io.StringIO(target_html), flavor="lxml")
        except Exception:
            tables = []

        for t in tables:
            t = _promote_header(t)  # multi-row 헤더 정규화
            cols_joined = " ".join(str(c) for c in t.columns)
            cols_norm = re.sub(r"\s+", "", cols_joined)

            # Table 1: 증권수량 / 모집(매출)가액 → new_qty, init_qty, init_price
            # **사용자 룰 (2026-05-25)**: H (최초_수량) / I (최초_가액) 는 최초
            # 증권신고서(지분증권) 시점 값. 정정 단계에서 변경 안 됨.
            # → stage1 시점의 증권수량을 init_qty 에 별도 저장 (new_qty 와 동시에).
            #   이후 amend/final 에서 rec.new_qty 만 갱신, init_qty 는 불변.
            if "증권수량" in cols_norm and "모집(매출)가액" in cols_norm and len(t) >= 1:
                for c in t.columns:
                    cn = str(c).replace(" ", "")
                    if cn == "증권수량" or cn.endswith("증권수량"):
                        try:
                            qty_val = int(str(t.iloc[0][c]).replace(",", "").split(".")[0])
                            rec.new_qty = qty_val
                            rec.init_qty = qty_val
                        except (ValueError, TypeError):
                            pass
                    elif "모집(매출)가액" in cn:
                        try:
                            rec.init_price = int(str(t.iloc[0][c]).replace(",", "").split(".")[0])
                        except (ValueError, TypeError):
                            pass

            # Table 3: 인수단 — 인수(주선)인 (대표/공동대표/인수) + 사명
            if "인수(주선)인" in cols_norm and "인수수량" in cols_norm and len(t) >= 1:
                # 컬럼: 인수(주선)인 / 인수(주선)인.1 / 증권의 종류 / 인수수량 / ...
                # 첫 두 컬럼이 role / name
                role_col = None
                name_col = None
                qty_col = None
                for c in t.columns:
                    cn = str(c).replace(" ", "")
                    if cn == "인수(주선)인" and role_col is None:
                        role_col = c
                    elif cn.startswith("인수(주선)인") and name_col is None:
                        name_col = c
                    elif cn == "인수수량" or cn.endswith("인수수량"):
                        qty_col = c
                if role_col is not None and name_col is not None:
                    for ri in range(len(t)):
                        role = str(t.iloc[ri][role_col]).strip()
                        name = str(t.iloc[ri][name_col]).strip()
                        try:
                            qty = int(str(t.iloc[ri][qty_col]).replace(",", "").split(".")[0]) \
                                  if qty_col is not None else None
                        except (ValueError, TypeError):
                            qty = None
                        if name and name.lower() != "nan":
                            underwriter_rows.append({"role": role, "name": name, "qty": qty})

            # Table 4: 청약기일 / 납입기일 / 배정기준일
            if "납입기일" in cols_norm and "배정기준일" in cols_norm and len(t) >= 1:
                subscribe_first_date = None  # 청약기일 첫 날 (일반공모 fallback 용)
                for c in t.columns:
                    cn = str(c).replace(" ", "")
                    v = str(t.iloc[0][c]).strip()
                    if cn == "납입기일":
                        rec.payment_date = _parse_korean_date(v)
                    elif cn == "배정기준일":
                        rec.record_date = _parse_korean_date(v)
                    elif cn == "청약기일":
                        # 첫 날만 추출 — 다양한 형식 지원:
                        #   "2026년 01월 23일 ~ 2026년 01월 26일"  (한국어)
                        #   "2024.07.02 2024.07.02"                (단일)
                        #   "2023.06.19 ~ 2023.06.20"              (범위)
                        # "~" 앞 부분만 → _parse_korean_date 통과 (YYYY.MM.DD / YYYY-MM-DD / 한국어 모두 처리)
                        first_part = v.split("~")[0].strip() if "~" in v else v
                        parsed = _parse_korean_date(first_part)
                        if parsed is None:
                            # _parse_korean_date 가 못 잡으면 정규식 fallback
                            m = re.search(
                                r"(\d{4})[.\-년/]\s*(\d{1,2})[.\-월/]\s*(\d{1,2})",
                                first_part)
                            if m:
                                try:
                                    parsed = date(int(m.group(1)),
                                                   int(m.group(2)),
                                                   int(m.group(3)))
                                except ValueError:
                                    parsed = None
                        if parsed is not None:
                            subscribe_first_date = parsed
                # 일반공모는 배정기준일이 없음 (=신주배정 절차 없음) → 청약기일 첫 날 사용.
                # 사용자 룰: "일반공모 유상증자의 경우 A행은 청약기일의 첫 날로 기입"
                if rec.record_date is None and subscribe_first_date is not None \
                        and rec.offering_type == "일반공모":
                    rec.record_date = subscribe_first_date

    # parse_offering_summary 백업 셋팅 — Table 1 매칭 실패한 케이스에서 init_qty/
    # init_price 보강. swap_fix 도 거기서 적용된 결과 사용.
    if rec.init_qty is None and summ.get("init_qty") is not None:
        rec.init_qty = summ["init_qty"]
    if rec.new_qty is None and summ.get("init_qty") is not None:
        rec.new_qty = summ["init_qty"]
    if rec.init_price is None and summ.get("init_price") is not None:
        rec.init_price = summ["init_price"]

    # 제3자배정: 배정기준일 표에도 일자 없음 → 이사회 결의일 사용.
    # 사용자 룰: "제3자배정의 경우 표 아래 주석에 '이사회 결의' 텍스트와 함께
    # 결의일이 명시돼있음".
    #
    # 실측 변종:
    #   (1) "2026년 3월 26일 개최된 이사회 결의에 따라..."        ← 기존
    #   (2) "2023년 6월 7일 당사 이사회를 통하여 결정하였습니다"  ← 마더스제약
    #   (3) "2024년 X월 X일자 이사회에서 결의하였습니다"
    # 공통: 일자 직후 10자 이내 "이사회" 키워드 등장. 더 너그러운 패턴으로 통합.
    if rec.record_date is None and rec.offering_type == "제3자배정":
        text_for_meeting = _full_text(html_sections)
        m = re.search(
            r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[\s\S]{0,10}?이사회",
            text_for_meeting)
        if m:
            try:
                rec.record_date = date(
                    int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass

    rec.lead_managers = {}  # 인수단 정보는 별도 저장
    rec.underwriters = {}
    # IPO 와 마찬가지로 stage1 단계에서는 인수단 수량만 저장 — 금액은 final 이후
    # underwriter_rows 를 rec 의 metadata 형식으로 임시 저장 (caller 가 활용)
    setattr(rec, "_underwriter_rows", underwriter_rows)

    # 일정 sanity check + 연도 오기 자동 보정 (대성창투 케이스).
    # 회사가 신고서 표에 배정기준일/납입일 연도 오기 (예: 2023 → 2022) 시,
    # 추출값이 공시일보다 과거. 연도 +1 한 값이 공시일+6개월 이내면 자동 보정.
    rec.record_date = _maybe_fix_year_typo(rcept_no, rec.record_date)
    rec.payment_date = _maybe_fix_year_typo(rcept_no, rec.payment_date)

    # 3) existing_qty (발행주식 총수) — 본문 텍스트 패턴 매칭
    text = _full_text(html_sections)
    text_norm = text.replace(" ", "")
    # 패턴 1: "C. 발행주식총수(A+B) 15,629,471주" — "구주주 1주당 배정비율 산출근거" 표.
    # 표 셀에서 추출된 텍스트는 끝에 "주" 가 없을 수도 있음 (라온피플 케이스). → optional.
    # 변종: "C. 자기주식을 제외한 발행주식총수 (A - B)" (현대아산 2023.03.09 케이스)
    #       → 라벨 자유 텍스트 + (A±B) 둘 다 매칭.
    m = re.search(r"C\.\s*[^()]*?발행주식\s*총수\s*\(\s*A\s*[\+\-]\s*B\s*\)\s*([\d,]+)", text)
    if not m:
        m = re.search(r"C\.[^()]*?발행주식총수\(A[\+\-]B\)([\d,]+)", text_norm)
    if m:
        try:
            rec.existing_qty = int(m.group(1).replace(",", ""))
        except ValueError:
            pass
    else:
        # 패턴 2: 요약정보 등의 "기발행주식총수 15,629,471주"
        m = re.search(r"기발행주식\s*총수\s*([\d,]+)\s*주?", text)
        if m:
            try:
                rec.existing_qty = int(m.group(1).replace(",", ""))
            except ValueError:
                pass
        else:
            # 패턴 3 (일반공모용): [당사 주가 및 유상증자에 따른 발행주식수 및 가격]
            # 표의 "현재 발행주식총수 55,730,013" 형태 (아미코젠 케이스).
            # \s+ 로 공백 1개 이상 강제 → "발행주식총수의 1.2%" 같은 자유 텍스트 회피.
            m = re.search(r"현재\s*발행주식\s*총수\s+([\d,]{4,})", text)
            if m:
                try:
                    rec.existing_qty = int(m.group(1).replace(",", ""))
                except ValueError:
                    pass
            else:
                # 패턴 4 (제3자배정용): III. 투자위험요소 - [나. 유통주식수 증가에
                # 관한 위험] 주석의 "발행주식 총수인 36,996,760주(보통주 기준)" 형태
                # (금호건설 케이스). 조사 "인" 강제 + "주" 강제 → "총수의 50%" 같은
                # 자유 텍스트 차단.
                m = re.search(r"발행주식\s*총수\s*인\s+([\d,]{6,})\s*주", text)
                if m:
                    try:
                        rec.existing_qty = int(m.group(1).replace(",", ""))
                    except ValueError:
                        pass

    # ============ multi-issue 감지 (솔루스첨단소재 2022-04 케이스) ============
    # parse_offering_summary 가 추출한 issues 리스트 (Table A 의 모든 row).
    # 2건 이상이면 첫 issue 는 메인 record (이미 init_qty/init_price 채워짐),
    # 나머지는 _extra_issues 로 caller (write_results) 가 추가 row 작성.
    issues = summ.get("issues", []) if isinstance(summ, dict) else []
    if len(issues) > 1:
        # 첫 issue 외 — 종류 무관 (보통주만 N건이든, 우선주만 N건이든, 혼합이든)
        for issue in issues[1:]:
            rec._extra_issues.append({
                "type": issue.get("type", ""),
                "qty": issue.get("qty"),
                "init_price": issue.get("price"),
                "init_total": issue.get("total"),
                "method": issue.get("method", ""),
            })
        print(f"  [INFO] {rec.issuer}: multi-issue 감지 {len(issues)}건 — "
              f"메인 + extra {len(rec._extra_issues)}건 자동 row 작성 예정")

    return rec


def extract_underwriters_from_stage1_fee_pattern(
        html_sections: dict[str, str],
        offering_total: int) -> list[dict]:
    """stage1 본문의 "인수인" 표에서 broker 명단 + 인수수수료 기반 인수금액 추출.

    **사용자 룰 2026-05-27**:
    "주주배정후 실권주 일반공모" 이면서 [발행조건확정] 본문에 broker 정보 없을 때
    최초 증권신고서(지분증권) 의 "2. 모집 또는 매출에 관한 일반사항" 표를 fallback 으로 사용.

    표 컬럼: 인수인 / 인수인.1 (이름) / 증권의 종류 / 인수수량 / 인수금액 / 인수대가 / 인수방법

    stage1 단계에서는 **인수수량/인수금액이 "-" 로 미확정** 이므로, "인수대가" 컬럼의
    인수수수료 텍스트에서 broker별 배분 비율을 계산한다.

    인수대가 텍스트 두 가지 패턴:
      (A) **비율 표기** (두산에너빌리티 식):
          "인수수수료: 모집총액의 0.4% 中 20%" → 그 broker 의 인수수수료 분담 비율 = 20%
          모든 broker 의 비율 합 = 100% (가정).
      (B) **절대 금액** (대한항공 식):
          "인수수수료: 900,000,000원" → 절대값. 모든 broker 합산 후 각 broker 비율 계산.

    단독 broker: 자동으로 비율 100% → amount = offering_total

    "대표주관수수료" / "실권수수료" 는 무시. **"인수수수료" 만 사용**.

    Args:
        html_sections: stage1 본문 sections dict
        offering_total: 모집총액 (원 단위) — 비율 × 이 값 = 각 broker amount
    Returns:
        list of {"role": str ('대표'|'인수'), "name": str, "qty": int, "amount_won": int}
        - qty 는 0 (인수실적 amount 만 의미)
        - 추출 실패 시 빈 list
    """
    import pandas as pd
    import io as _io

    if not offering_total or offering_total <= 0:
        return []

    # 1) 인수단 표 찾기
    target_table = None
    for html in html_sections.values():
        if not html:
            continue
        try:
            tables = pd.read_html(_io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            t = _promote_header(t)
            cols = [str(c) for c in t.columns]
            cols_joined = " ".join(cols).replace(" ", "")
            if ("인수인" in cols_joined or "인수(주선)인" in cols_joined) \
                    and "인수대가" in cols_joined:
                target_table = t
                break
        if target_table is not None:
            break

    if target_table is None:
        return []

    # 2) 컬럼 위치 식별
    cols = [str(c) for c in target_table.columns]
    role_col = name_col = fee_col = None
    for ci, c in enumerate(cols):
        cs = str(c).replace(" ", "")
        if cs in ("인수인", "인수(주선)인") and role_col is None:
            role_col = ci
        elif (cs.startswith("인수인") or cs.startswith("인수(주선)인")) \
                and name_col is None and ci != role_col:
            name_col = ci
        elif "인수대가" in cs:
            fee_col = ci
    if role_col is None or name_col is None or fee_col is None:
        return []

    # 3) row 추출 + 인수수수료 텍스트 파싱
    # 패턴 가지각색:
    #   "인수수수료:" / "기본수수료:" (코스맥스) — 인수실적 분담 기준
    #   "中" / "x" / "×" / "X" (에어부산) — 비율 표기 구분자
    #   "모집주선수수료" 만 있는 broker — 인수실적 무관 (skip)
    brokers = []
    for ri in range(len(target_table)):
        role = str(target_table.iloc[ri, role_col]).replace(" ", "").strip()
        name = str(target_table.iloc[ri, name_col]).replace(" ", "").strip()
        fee_text = str(target_table.iloc[ri, fee_col])
        if not name or name in ("nan", "None", "계", "합계"):
            continue
        # 텍스트 정규화: 줄바꿈/스페이스 통합
        fee_norm = re.sub(r"\s+", " ", fee_text)
        fee_compact = fee_norm.replace(" ", "")
        # 모집주선 broker (인수실적 없음) 만 skip — "모집주선" 키워드 있고
        # "인수수수료/기본수수료" 키워드 없는 경우.
        # 국도화학처럼 단독 broker 인데 fee 표기 다른 케이스 ("금 삼억..." 등) 는
        # 통과시켜야 단독 fallback (100% 할당) 작동.
        has_uw_fee = ("인수수수료" in fee_compact or "기본수수료" in fee_compact)
        only_mosa = ("모집주선" in fee_compact and not has_uw_fee)
        if only_mosa:
            continue
        # (A) 비율 패턴 "(인수|기본)수수료:(모집총액|인수금액)의N%(中|x|×|X)M%"
        # 두산에너빌리티 케이스: "인수수수료: 인수금액의 0.6% 中 30%"
        m_ratio = re.search(
            r"(?:인수수수료|기본수수료)\s*[:：]\s*(?:모집총액|인수금액)의?\s*[\d.]+\s*%"
            r"\s*[중中xX×]\s*([\d.]+)\s*%",
            fee_compact)
        # (B) 인수비율(N분의M) 패턴 — 체시스 케이스
        #   "인수수수료: 모집총액 × 1.1% × 인수비율(100분의 50)" → 50/100 = 50%
        m_ratio_2 = None
        if not m_ratio:
            m_ratio_2 = re.search(
                r"(?:인수수수료|기본수수료)\s*[:：][^\n]*?"
                r"인수비율\s*\(\s*(\d+)\s*분의\s*(\d+)\s*\)",
                fee_norm)
        # (C) 절대 금액 패턴 "(인수|기본)수수료:A,BCD,EFG원"
        m_amount = re.search(
            r"(?:인수수수료|기본수수료)\s*[:：]\s*([\d,]+)\s*원",
            fee_norm)
        ratio_pct = None
        fee_amount = None
        if m_ratio:
            try:
                ratio_pct = float(m_ratio.group(1))
            except ValueError:
                pass
        elif m_ratio_2:
            try:
                denom = float(m_ratio_2.group(1))
                num = float(m_ratio_2.group(2))
                if denom > 0:
                    ratio_pct = num / denom * 100
            except (ValueError, ZeroDivisionError):
                pass
        if m_amount:
            try:
                fee_amount = int(m_amount.group(1).replace(",", ""))
            except ValueError:
                pass
        brokers.append({
            "role": role, "name": name,
            "ratio_pct": ratio_pct, "fee_amount": fee_amount,
        })

    if not brokers:
        return []

    # 4) 단독 broker 케이스 — 비율 100%
    if len(brokers) == 1:
        b = brokers[0]
        return [{
            "role": b["role"], "name": b["name"], "qty": 0,
            "amount_won": offering_total,
        }]

    # 5) 비율 패턴 우선 — 모든 broker 의 ratio_pct 있으면 그대로 사용
    if all(b["ratio_pct"] is not None for b in brokers):
        # 비율 합 검증 (100% ± 5% 허용)
        total_pct = sum(b["ratio_pct"] for b in brokers)
        if 95 <= total_pct <= 105:
            return [{
                "role": b["role"], "name": b["name"], "qty": 0,
                "amount_won": round(offering_total * b["ratio_pct"] / 100),
            } for b in brokers]

    # 6) 절대 금액 패턴 — 모든 broker 의 fee_amount 있으면 합산 후 비율 계산
    if all(b["fee_amount"] is not None for b in brokers):
        total_fee = sum(b["fee_amount"] for b in brokers)
        if total_fee > 0:
            return [{
                "role": b["role"], "name": b["name"], "qty": 0,
                "amount_won": round(offering_total * b["fee_amount"] / total_fee),
            } for b in brokers]

    # 7) 둘 다 실패 — 추출 불가
    return []


def extract_msr_rcept_no(html_sections: dict[str, str]) -> Optional[str]:
    """stage1 본문 HTML 에서 "주요사항보고서(유상증자결정)" rcept_no 추출.

    "2. 모집 또는 매출에 관한 일반사항" 표 아래에 일반적으로 링크 있음:
      <A href="javascript:top.openReportViewerMain('20240306000650');" ...>
            주요사항보고서(유상증자결정)-2024.03.06</A>

    Returns: rcept_no (str, 14자리) 또는 None.
    """
    for title, html in html_sections.items():
        if not html:
            continue
        m = re.search(
            r"openReportViewerMain\(\s*'(\d+)'\s*\)[^<]*</A>[^<]*?주요사항보고서",
            html, re.DOTALL)
        if m:
            return m.group(1)
        # 변종 — 텍스트가 a 태그 안에 있는 경우
        m = re.search(
            r"openReportViewerMain\(\s*'(\d+)'\s*\)[^>]*>[^<]*?주요사항보고서[^<]*?유상증자결정",
            html, re.DOTALL)
        if m:
            return m.group(1)
    return None


def extract_board_resolution_date_from_msr(
        html_sections: dict[str, str]) -> Optional[date]:
    """주요사항보고서 본문에서 "이사회결의일(결정일)" 추출.

    윙입푸드 2024-03 케이스 검증: "15. 이사회결의일(결정일) 2024.03.06"
    형식 일관 — 정형화된 주요사항보고서 형식.
    """
    text = _full_text(html_sections)
    m = re.search(
        r"이사회결의일[^\d]{0,30}(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})",
        text)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return None


def extract_existing_qty_from_total_shares(html_sections: dict[str, str]) -> Optional[int]:
    """제2부 발행인에 관한 사항 / I. 회사의 개요 / 4. 주식의 총수 등 표에서
    "IV. 발행주식의 총수 (II-III)" 행 값 추출.

    fallback 흐름:
      stage1 의 "2. 공모방법" 에서 "구주주 1주당 배정비율 산출근거" 표 추출 실패 시
      (일반공모/제3자배정 유증) → _process_rights 가 이 섹션 1개만
      ecm_total_shares_predicate 로 추가 fetch → 이 함수로 발행주식 총수 추출.

    OCI홀딩스 2023-07-28 케이스 (캡처):
      | 구분                          | 보통주     | 우선주 | 합계       | 비고 |
      | I. 발행할 주식의 총수            | 100,000,000 | -    | 100,000,000 | -   |
      | II. 현재까지 발행한 주식의 총수    | 43,398,246  | -    | 43,398,246  | -   |
      | III. 현재까지 감소한 주식의 총수   | 26,985,604  | -    | 26,985,604  | -   |
      | IV. 발행주식의 총수 (II - III)   | 16,412,642  | -    | 16,412,642  | -   | ← 추출
      | V. 자기주식수                  | 248,732    | -    | 248,732    | ...  |
      | VI. 유통주식수 (IV-V)          | 16,163,910  | -    | 16,163,910  |     |

    추출 패턴: "IV. 발행주식의 총수 (II-III)" 다음 첫 숫자 (= 보통주 컬럼).
    우선주 있는 회사는 보통주 컬럼만 채택 — 유증 대상이 보통주이므로 의도 일치.

    Returns: 발행주식 총수 (int) — 못 찾으면 None.
    """
    text = _full_text(html_sections)
    # OCI홀딩스 본문 실측: 유니코드 로마 숫자 (Ⅰ Ⅱ Ⅲ Ⅳ) 사용. 영문 (I II III IV) 가
    # 사용된 회사도 있을 수 있으므로 두 가지 모두 매칭.
    #
    # 표 컬럼 순서가 회사마다 다름:
    #   OCI홀딩스       — [구분 / 보통주 / 우선주 / 합계 / 비고]   (우선주 0)
    #   시알홀딩스      — [구분 / 비고 / 우선주 / 보통주 / 합계]  (우선주 0)
    #   금호건설        — [구분 / 보통주 / 우선주 / 합계 / 비고]   (우선주 292,266 있음!)
    # → 보통주만 가져오면 우선주 있는 회사는 합계와 다름. **합계 = 보통주 + 우선주**.
    # 알고리즘: ")" 다음 다음 행(Ⅴ. 자기주식수) 직전까지의 모든 큰 숫자 중 max = 합계.
    # (합계 ≥ 보통주, 합계 ≥ 우선주 항상 성립)
    m = re.search(
        r"(?:IV|Ⅳ)\.\s*발행주식\s*의?\s*총수\s*"
        r"\(\s*(?:II|Ⅱ)\s*[-‐−]\s*(?:III|Ⅲ)\s*\)"
        r"([\s\S]{0,300}?)(?=(?:V|Ⅴ)\.\s*자기주식|$)",
        text)
    if m:
        region = m.group(1)
        nums = []
        for nm in re.finditer(r"([\d,]{4,})", region):
            try:
                nums.append(int(nm.group(1).replace(",", "")))
            except ValueError:
                pass
        if nums:
            return max(nums)
    return None


def _maybe_fix_listing_date_typo(listing_date: Optional[date],
                                  stage1_rcept: str) -> Optional[date]:
    """IPO 상장일 연도 오기 자동 보정.

    신성에스티 케이스: 보고서 본문에 "2022.10.19" 라고 단순 오기 →
    엑셀 A 셀이 2022-10-19 로 들어감. 실제는 2023-10-19 (stage1 보다 1년 후).

    조건: 상장일 < stage1 공시일 → 명백히 비정상 (상장이 공시보다 먼저일 수 없음).
    → 연도 +1 보정 시도 + stage1 ~ stage1+1년 범위면 채택.

    Args:
        listing_date: 보고서에서 추출한 상장일
        stage1_rcept: stage1 공시 rcept_no (YYYYMMDD)
    Returns:
        보정된 date 또는 원본 (None / 보정 불가 시 원본 유지)
    """
    if not listing_date or not stage1_rcept or len(stage1_rcept) < 8:
        return listing_date
    try:
        stage1_date = date(
            int(stage1_rcept[:4]), int(stage1_rcept[4:6]), int(stage1_rcept[6:8]))
    except ValueError:
        return listing_date
    if listing_date >= stage1_date:
        return listing_date  # 정상 — 공시일 이후
    # 비정상 — 연도 +1 보정 시도
    try:
        corrected = listing_date.replace(year=listing_date.year + 1)
    except ValueError:
        return listing_date  # 윤년 등
    from datetime import timedelta
    if stage1_date <= corrected <= stage1_date + timedelta(days=365):
        return corrected
    return listing_date  # 보정도 비정상 → 원본 유지


def _maybe_fix_year_typo(rcept_no: str, parsed_date: Optional[date]) -> Optional[date]:
    """공시 본문의 일정 (배정기준일/납입일) 연도 오기 자동 보정.

    대성창투 케이스: 회사가 2023 → 2022 로 연도 오기 → 추출값이 공시일보다 과거.
    연도 +1 한 값이 공시일~공시일+6개월 범위 안이면 채택, 아니면 원본 유지.

    Args:
        rcept_no: 공시 접수번호 (첫 8자리 = 공시일 YYYYMMDD)
        parsed_date: 본문에서 추출한 date
    Returns:
        보정된 date (또는 원본 그대로 / None)
    """
    if not parsed_date or not rcept_no or len(rcept_no) < 8:
        return parsed_date
    try:
        filing_date = date(
            int(rcept_no[:4]), int(rcept_no[4:6]), int(rcept_no[6:8]))
    except ValueError:
        return parsed_date
    if parsed_date >= filing_date:
        return parsed_date  # 정상 — 공시일 이후
    # 비정상 — 공시일보다 과거. 연도 +1 시도.
    try:
        corrected = parsed_date.replace(year=parsed_date.year + 1)
    except ValueError:
        return parsed_date  # 2/29 같은 윤년 케이스 등
    from datetime import timedelta
    if filing_date <= corrected <= filing_date + timedelta(days=180):
        return corrected
    return parsed_date  # 보정값도 비정상 → 원본 유지


def _maybe_swap_price_total(qty: Optional[int],
                            price: Optional[int],
                            total: Optional[int],
                            context: str = "") -> tuple[Optional[int], Optional[int]]:
    """모집(매출)가액 ↔ 총액 swap 자동 교정.

    DART 본문 표에서 두 컬럼 값이 서로 뒤바뀐 케이스 (젠큐릭스 2023.03.06
    유상증자 [발행조건확정] — 가액 19,810,440,000 / 총액 3,060 처럼 위치만
    뒤바뀐 오기) 를 곱셈 관계로 자동 인지·교정.

    교정 조건 (모두 만족):
      - qty, price, total 모두 양의 정수
      - qty × price ≠ total (1% 초과 어긋남) — 정상 관계 깨짐
      - qty × total ≈ price (1% 이내 일치)     — swap 가설 검증

    이 두 조건이 같이 성립할 확률 = 우연으로는 거의 0 (수치 자릿수 다름).
    false positive 위험 최소.

    Returns: (corrected_price, corrected_total) — swap 시 두 값을 맞바꾼 결과.
    """
    if not qty or not price or not total:
        return price, total
    if qty <= 0 or price <= 0 or total <= 0:
        return price, total
    expected_total = qty * price
    if expected_total > 0:
        diff_pct = abs(expected_total - total) / max(expected_total, total)
        if diff_pct <= 0.01:
            return price, total  # 정상 관계 성립 — 교정 불필요
    # 정상 관계 깨짐 → swap 가설 검증
    expected_price = qty * total
    if expected_price > 0:
        diff_pct2 = abs(expected_price - price) / max(expected_price, price)
        if diff_pct2 <= 0.01:
            print(f"[SWAP_FIX] 모집(매출)가액↔총액 자동 교정"
                  f"{(' (' + context + ')') if context else ''}: "
                  f"price {price:,} → {total:,}, "
                  f"total {total:,} → {price:,}  "
                  f"(qty={qty:,}, qty*new_price={qty * total:,})")
            return total, price
    # 둘 다 안 맞음 — 그냥 원본 유지 (다른 종류의 오류일 수 있음, 임의 교정 금지)
    return price, total


def _maybe_fix_qty_typo(qty: Optional[int],
                       price: Optional[int],
                       total: Optional[int],
                       context: str = "") -> Optional[int]:
    """수량 자릿수 오기 자동 보정 (아이진 2025-12 케이스).

    DART 본문 표에 회사가 수량을 잘못 적은 경우 (예: 16,200,000 → 16,200,000,000
    처럼 0이 추가됨). qty × price ≠ total 이고 total / price 가 깔끔한 정수면
    그 값을 정상 qty 로 채택.

    교정 조건 (모두 만족):
      - qty, price, total 모두 양의 정수
      - qty × price ≠ total (1% 초과 어긋남)
      - total / price 가 깔끔한 정수 (절대 차이 < 0.5)
      - 보정된 qty 가 1 ~ 100억 범위 (현실적)

    Returns: 교정된 qty (또는 원본 qty).
    """
    if not qty or not price or not total:
        return qty
    if qty <= 0 or price <= 0 or total <= 0:
        return qty
    expected_total = qty * price
    if expected_total > 0:
        diff_pct = abs(expected_total - total) / max(expected_total, total)
        if diff_pct <= 0.01:
            return qty  # 정상 — 교정 불필요
    # qty 오기 가설 검증: total / price 가 깔끔한 정수인가?
    cand = total / price
    if abs(cand - round(cand)) >= 0.5:
        return qty  # 깔끔한 정수 아님 → 교정 거부 (다른 오류일 수 있음)
    cand_int = int(round(cand))
    # sanity: 보정값이 100주 미만이면 거부 (다른 종류의 오류 — 예: swap 이 처리
    # 못한 케이스에서 잘못 매칭). 100억주 초과도 거부.
    if not (100 <= cand_int <= 10_000_000_000):
        return qty
    print(f"[QTY_FIX] 수량 자릿수 오기 자동 보정"
          f"{(' (' + context + ')') if context else ''}: "
          f"qty {qty:,} → {cand_int:,}  "
          f"(price={price:,}, total={total:,}, total/price={cand_int:,})")
    return cand_int


def _parse_korean_date(s: str) -> Optional[date]:
    """'2026년 08월 11일' 또는 '2026.08.11' 또는 '2026-08-11' → date."""
    if not s:
        return None
    s = s.strip()
    # YYYY년 MM월 DD일
    m = re.match(r"\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    # YYYY.MM.DD / YYYY-MM-DD
    m = re.match(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def parse_rights_final(html_sections: dict[str, str], rcept_no: str = "",
                       which: str = "stage1") -> dict:
    """[발행조건확정] 증권신고서(지분증권) — 유상증자.

    which="stage1" (1차)  → 'price' (1차 가액) + 정정 후 일정/수량/인수단
    which="stage2" (2차)  → 'price' (최종 가액) + 'stage2_price' (2차 산정 가액)
                            + 정정 후 일정/수량/인수단

    [발행조건확정] 본문 구조:
      "(주1) 정정 전" / "(주1) 정정 후" 표시와 함께 같은 양식 표가 두 벌 순서대로 등장.
      Table A (모집·매출 표), Table B (인수단 표), Table C (일정 표)
      각각 정정 전/후 한 쌍씩. **두 번째 등장 = 정정 후** → 데이터로 사용.

    Returns dict:
      {
        "rcept_no": ...,
        "price": int,              # 정정 후 모집(매출)가액 (1차 → K, 2차 → O)
        "updated_qty": int,        # 정정 후 증권수량 (caller 가 E 갱신 판단)
        "record_date": date,       # 정정 후 배정기준일
        "payment_date": date,      # 정정 후 납입일
        "underwriter_amounts": [   # 정정 후 인수단 5행 가량
            {"role": ..., "name": ..., "qty": int, "amount_won": int},
            ...
        ],
        "stage2_price": int,       # (which="stage2" only) "2차 발행가액 산정표" 의 결과
      }
    """
    import pandas as pd
    import io

    out: dict = {"rcept_no": rcept_no}
    text = _full_text(html_sections)
    # \xa0 (non-breaking space) 정규화 — 후성/엑시콘/하나마이크론 케이스에서
    # 본문에 \xa0 가 끼어있어 \s 매칭 실패하던 패턴들이 일관되게 동작하도록.
    text = text.replace("\xa0", " ")

    # 본문 (보통 단일 섹션 '증권발행조건확정')
    target_htmls = list(html_sections.values())

    # 모든 표 추출, 정정 전/후 쌍 매칭
    offering_tables: list = []     # 증권수량 + 모집(매출) 가액 들어있는 표
    underwriter_tables: list = []  # 인수(주선)인 + 인수수량 들어있는 표
    schedule_tables: list = []     # 납입기일 + 배정기준일 들어있는 표

    for html in target_htmls:
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except Exception:
            continue
        for t in tables:
            t = _promote_header(t)  # multi-row 헤더 정규화
            t = _promote_header(t)  # multi-row 헤더 정규화
            cols_norm = re.sub(r"\s+", "", " ".join(str(c) for c in t.columns))
            if "증권수량" in cols_norm and "모집(매출)가액" in cols_norm \
               and "모집(매출)방법" in cols_norm and len(t) >= 1:
                offering_tables.append(t)
            elif "인수(주선)인" in cols_norm and "인수수량" in cols_norm \
                 and "인수금액" in cols_norm and len(t) >= 1:
                underwriter_tables.append(t)
            elif "납입기일" in cols_norm and "배정기준일" in cols_norm and len(t) >= 1:
                schedule_tables.append(t)

    # 정정 후 = 같은 패턴 표의 2번째 등장 (index 1)
    def _second_or_first(lst):
        if len(lst) >= 2:
            return lst[1]
        if len(lst) == 1:
            return lst[0]
        return None

    off_t = _second_or_first(offering_tables)
    rights_total_tmp: Optional[int] = None  # swap 검증용 (반환은 하지 않음)
    if off_t is not None:
        for c in off_t.columns:
            cn = str(c).replace(" ", "")
            v = str(off_t.iloc[0][c]).strip()
            if cn == "증권수량" or cn.endswith("증권수량"):
                try:
                    out["updated_qty"] = int(v.replace(",", "").split(".")[0])
                except (ValueError, TypeError):
                    pass
            elif "모집(매출)가액" in cn:
                try:
                    out["price"] = int(v.replace(",", "").split(".")[0])
                except (ValueError, TypeError):
                    pass
            elif "모집(매출)총액" in cn:
                try:
                    rights_total_tmp = int(v.replace(",", "").split(".")[0])
                except (ValueError, TypeError):
                    pass

    # 가액 ↔ 총액 swap 자동 교정 (젠큐릭스 2023.03.06 케이스)
    if out.get("updated_qty") and out.get("price") and rights_total_tmp:
        fixed_price, _ = _maybe_swap_price_total(
            out["updated_qty"], out["price"], rights_total_tmp,
            context=f"parse_rights_final which={which} rcept={rcept_no}")
        out["price"] = fixed_price

    sch_t = _second_or_first(schedule_tables)
    if sch_t is not None:
        for c in sch_t.columns:
            cn = str(c).replace(" ", "")
            v = str(sch_t.iloc[0][c]).strip()
            if cn == "납입기일":
                out["payment_date"] = _parse_korean_date(v)
            elif cn == "배정기준일":
                out["record_date"] = _parse_korean_date(v)
            elif cn == "청약기일":
                # 일반공모 fallback 용 — parse_rights_stage1 의 룰과 동일.
                # 사용자 룰: "일반공모 유상증자의 A행은 청약기일의 첫 날"
                first_part = v.split("~")[0].strip() if "~" in v else v
                parsed = _parse_korean_date(first_part)
                if parsed is None:
                    m = re.search(
                        r"(\d{4})[.\-년/]\s*(\d{1,2})[.\-월/]\s*(\d{1,2})",
                        first_part)
                    if m:
                        try:
                            parsed = date(int(m.group(1)),
                                           int(m.group(2)),
                                           int(m.group(3)))
                        except ValueError:
                            parsed = None
                if parsed is not None:
                    out["subscribe_first_date"] = parsed

    underwriter_amounts: list[dict] = []
    uw_t = _second_or_first(underwriter_tables)
    if uw_t is not None:
        # 컬럼: 인수(주선)인 / 인수(주선)인.1 / 증권의 종류 / 인수수량 / 인수금액 / ...
        role_col = name_col = qty_col = amt_col = None
        for c in uw_t.columns:
            cn = str(c).replace(" ", "")
            if cn == "인수(주선)인" and role_col is None:
                role_col = c
            elif cn.startswith("인수(주선)인") and name_col is None:
                name_col = c
            elif cn == "인수수량" or cn.endswith("인수수량"):
                qty_col = c
            elif cn == "인수금액" or cn.endswith("인수금액"):
                amt_col = c
        if role_col is not None and name_col is not None:
            for ri in range(len(uw_t)):
                role = str(uw_t.iloc[ri][role_col]).strip()
                name = str(uw_t.iloc[ri][name_col]).strip()
                try:
                    qty_raw = str(uw_t.iloc[ri][qty_col]).replace(",", "").replace("주", "").strip()
                    qty = int(qty_raw.split(".")[0]) if qty_col is not None else None
                except (ValueError, TypeError):
                    qty = None
                try:
                    # "원" 포함 문자열 ("46,350,000,000원") 케이스도 처리.
                    amt_raw = str(uw_t.iloc[ri][amt_col]).replace(",", "").replace("원", "").strip()
                    amt = int(amt_raw.split(".")[0]) if amt_col is not None else None
                except (ValueError, TypeError):
                    amt = None
                if name and name.lower() != "nan":
                    underwriter_amounts.append({
                        "role": role, "name": name, "qty": qty, "amount_won": amt,
                    })
    out["underwriter_amounts"] = underwriter_amounts

    # ============ Fallback 추출: [2차 및 확정발행가액 산정표] / [확정발행가액 산정표] ============
    # 인베니아처럼 "주주배정" 유상증자는 정정 후 모집(매출)표가 표 형식이 아니라 텍스트로만
    # 표시되고, 대신 "2차 및 확정발행가액 산정표" 라는 별도 표에 1차/2차/확정 가액이
    # 한 번에 정리됨. 우리가 모집표를 못 잡은 경우 이 산정표를 fallback 으로 사용.
    if out.get("price") is None or (which == "stage2" and out.get("stage2_price") is None):
        for html in target_htmls:
            if not html:
                continue
            try:
                tables = pd.read_html(io.StringIO(html), flavor="lxml")
            except Exception:
                continue
            for t in tables:
                t = _promote_header(t)
                # 산정표 식별: 첫 컬럼에 "확정발행가액" / "2차 발행가액" / "1차 발행가액" 행 모두
                try:
                    first_col_vals = [
                        re.sub(r"\s+", "", str(v))
                        for v in t.iloc[:, 0]
                    ]
                except Exception:
                    continue
                has_final = any("확정발행가액" in v for v in first_col_vals)
                has_2 = any("2차발행가액" in v for v in first_col_vals)
                has_1 = any("1차발행가액" in v for v in first_col_vals)
                # 산정표 인식: 인베니아처럼 한 표에 1차/2차/확정 모두 있는 경우 +
                # 루닛처럼 1차/2차/확정 각각 별도 표인 경우 모두 인식 (OR 조건).
                if not (has_final or has_2 or has_1):
                    continue
                # 각 행의 값 추출 — col 0 은 라벨, 값은 col 1 또는 그 이후 컬럼.
                # 형지엘리트처럼 multi-header 잔재로 col 0/1 동일 라벨인 경우 값이 col 2 에.
                # → 라벨 외 모든 컬럼에서 첫 "온전한 숫자 표기" 셀 사용.
                for ri in range(len(t)):
                    label = re.sub(r"\s+", "", str(t.iloc[ri, 0]))
                    v = None
                    for ci in range(1, t.shape[1]):
                        val_str = str(t.iloc[ri, ci]).strip()
                        # 라벨 중복 (예: "2차 발행가액") 이면 skip — 숫자만 매칭
                        m = re.match(
                            r"^\s*([\d,]+)(?:\.\d+)?\s*원?\s*$", val_str)
                        if m:
                            try:
                                v = int(m.group(1).replace(",", ""))
                                break
                            except ValueError:
                                continue
                    if v is None:
                        continue
                    # sanity: 비현실적 가격 (액면가 100원 미만) skip — "2" 같은
                    # 잡음(예: 표 안의 행 번호/연번/할인율 등) 방지
                    if v < 100:
                        continue
                    if "확정발행가액" in label and out.get("price") is None:
                        out["price"] = v
                    elif "2차발행가액" in label and which == "stage2" \
                            and out.get("stage2_price") is None:
                        out["stage2_price"] = v
                # 산정표가 1차/2차/확정 분리 표일 수 있으니 break 하지 않고 다음 표 검사.
            if out.get("price") is not None and \
               (which != "stage2" or out.get("stage2_price") is not None):
                break

    # 2차 [발행조건확정] — 텍스트 패턴 fallback (산정표도 못 찾은 경우)
    if which == "stage2" and out.get("stage2_price") is None:
        m = re.search(r"2\s*차\s*발행\s*가액\s*[^\d]{0,40}?([\d,]+)(?:\.\d+)?\s*원?",
                      text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                # sanity: 액면가 100원 미만 잡음 무시
                if val >= 100:
                    out["stage2_price"] = val
            except ValueError:
                pass

    # ============ Fallback: "확정되지 아니한 금액" 키워드 기반 정정 후 식별 ============
    # 동국홀딩스/시알홀딩스/현대지에프홀딩스 2023 케이스: [발행조건확정] 본문 표 구조
    # [항목 | 정정 전 | 정정 후]. 셀들의 row-major 추출 텍스트 순서는:
    #   (정정 전 셀: 가액X / 총액 / 발행제비용 / [기타] "확정되지 아니한 금액입니다.")
    #   → (정정 후 셀: "증권수량: Y / 가액Z / 총액 / 발행제비용 / [기타] 확정된 금액")
    # 즉 "확정되지 아니한 금액입니다." 는 정정 전 셀의 마지막 문장이고, 그 직후
    # 정정 후 셀의 첫 부분 (증권수량 + 가액) 이 등장. → "확정되지 아니한" 다음에
    # 매칭되는 첫 가액 = **정정 후 = 확정값**.
    if out.get("price") is None:
        m_after_unfixed_price = re.search(
            r"확정되지\s*아니한[\s\S]{0,150}?모집\s*\(\s*매출\s*\)\s*가액\s*[:：]?\s*([\d,]+)",
            text)
        if m_after_unfixed_price:
            try:
                val = int(m_after_unfixed_price.group(1).replace(",", ""))
                if 100 <= val <= 1_000_000:
                    out["price"] = val
            except ValueError:
                pass

        # updated_qty 도 같은 위치 (정정 후 셀 첫 부분의 "증권수량: Y")
        if out.get("updated_qty") is None and out.get("price") is not None:
            m_after_unfixed_qty = re.search(
                r"확정되지\s*아니한[\s\S]{0,100}?증권\s*수량\s*[:：]?\s*([\d,]+)", text)
            if m_after_unfixed_qty:
                try:
                    out["updated_qty"] = int(
                        m_after_unfixed_qty.group(1).replace(",", ""))
                except ValueError:
                    pass

    # ============ Fallback: "(1주당 NNN원) 4. 정정사유 : 1차 발행가액 확정" (자비스 케이스) ============
    # [발행조건확정] 본문 최상단 헤더에 정정 후 가액이 "(1주당 NNN원)" 형태로 직접
    # 명시되는 케이스. "정정사유 : 1차 발행가액 확정" 또는 "발행가액 확정" 텍스트가
    # 인접 → 정정 후 값으로 확정.
    if out.get("price") is None:
        m = re.search(
            r"\(\s*1주당\s*([\d,]+)\s*원\s*\)[\s\S]{0,100}?정정사유\s*[:：][\s\S]{0,30}?"
            r"(?:1차\s*발행\s*가액\s*확정|발행\s*가액\s*확정)",
            text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if 100 <= val <= 1_000_000:
                    out["price"] = val
            except ValueError:
                pass

    # ============ Fallback: "1차발행가액 결정" 표의 정정 후 (자비스 케이스 2) ============
    # 본문 텍스트 흐름: "1차발행가액 결정 ... 주당 모집가액 ... 1,850원 (정정 전) ...
    #                  주당 모집가액 ... 1,881원 (정정 후)"
    # → "1차발행가액 결정" 키워드 다음 두 번째 "주당 모집가액 ... NNN원" 매칭.
    if out.get("price") is None:
        m = re.search(
            r"1차\s*발행\s*가액\s*결정[\s\S]{0,100}?"
            r"주당\s*모집\s*가액[^원]{0,80}?([\d,]+)\s*원"
            r"[\s\S]{0,200}?"
            r"주당\s*모집\s*가액[^원]{0,80}?([\d,]+)\s*원",
            text)
        if m:
            try:
                val_after = int(m.group(2).replace(",", ""))
                if 100 <= val_after <= 1_000_000:
                    out["price"] = val_after
            except ValueError:
                pass

    # ============ Fallback: "예정가액 NNN 확정가액" 표의 두 번째 매칭 (풍전약품/후성/LK삼양) ============
    # 정정사항 표 안에 "주당 모집가액 ... 예정가액 NNN 확정가액 -" 형태가 두 번 등장:
    #   첫 번째 = 정정 전 (예전 예정가액)
    #   두 번째 = 정정 후 (= 1차 발행가액 = 새 예정가액)
    # 1차 [발행조건확정] 시점이라 "확정가액" 컬럼은 "-" 그대로 (2차에서 확정).
    if out.get("price") is None:
        # 베셀 케이스: "예정가액 2,685원 확정가액" — 숫자 뒤 "원" 옵션.
        # 매칭이 4개일 수 있음 (주당가액 / 모집총액 각 2번씩, 정정 전·후).
        # → sanity (100~100만원) 통과한 후보 중 두 번째 = 정정 후 주당 가액.
        matches = list(re.finditer(
            r"예정\s*가액\s*[:：]?\s*([\d,]+)\s*원?\s*확정\s*가액", text))
        valid = []
        for m in matches:
            try:
                v = int(m.group(1).replace(",", ""))
                if 100 <= v <= 1_000_000:
                    valid.append(v)
            except ValueError:
                pass
        if len(valid) >= 2:
            out["price"] = valid[1]
        elif len(valid) == 1:
            # 정정 전·후 가액이 같은 케이스 — 매칭이 단일하게 잡혔을 수도
            out["price"] = valid[0]

    # ============ Fallback: "예정발행가액인 NNN원과 동일하게 산정" (상지건설 권리락가) ============
    # 상지건설 2025-03 케이스: "권리락가 산정을 위한 예정발행가액 확정. 권리락가
    # 산정 전 예정발행가액인 5,000원과 동일하게 산정되었습니다."
    # → 1차 발행가액 = 5,000원 (정정 전과 동일).
    if out.get("price") is None:
        m = re.search(
            r"예정\s*발행\s*가액인?\s*([\d,]+)\s*원과?\s*동일", text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if 100 <= val <= 1_000_000:
                    out["price"] = val
            except ValueError:
                pass

    # ============ Fallback: 본문 상단 "모집(매출)가액 : NNN원" 두 번째 매칭 (셀바스AI) ============
    # 본문 최상단 텍스트에 "모집(매출)가액 : 19,710원 모집(매출)가액 : 14,280원" 같이
    # 정정 전·정정 후 가액이 연속 명시. 두 번째 = 정정 후.
    if out.get("price") is None:
        matches = list(re.finditer(
            r"모집\s*\(\s*매출\s*\)\s*가액\s*[:：]\s*([\d,]+)\s*원", text))
        if len(matches) >= 2:
            try:
                val = int(matches[1].group(1).replace(",", ""))
                if 100 <= val <= 1_000_000:
                    out["price"] = val
            except ValueError:
                pass

    # ============ Fallback: "X원을 발행가액으로 결정하였습니다" (금호건설 제3자배정) ============
    # 금호건설 2025-04 케이스: 정정사항 표 안에 "(중략)" 만 있고 가액은 자유 텍스트
    # "160,900원을 발행가액으로 결정하였습니다" 형태로 본문에 산재.
    #
    # 본문 구조: "주1) 정정 전" / "주1) 정정 후" / "주2) 정정 전" / "주2) 정정 후" 반복.
    # 각 정정 후 마커부터 다음 정정 전 마커 (또는 본문 끝) 까지가 정정 후 영역.
    # 정정 후 영역들만 모아서 매칭 → 정정 전 값이 노이즈로 끼지 않음.
    if out.get("price") is None:
        # 정정 후 / 정정 전 마커 위치 추출
        after_starts = [m.start() for m in re.finditer(r"정\s*정\s*후", text)]
        before_starts = [m.start() for m in re.finditer(r"정\s*정\s*전", text)]
        # 각 정정 후 마커의 segment 추출 (다음 정정 전 마커까지)
        after_segments = []
        for start in after_starts:
            end = len(text)
            for before_start in before_starts:
                if before_start > start:
                    end = before_start
                    break
            after_segments.append(text[start:end])
        scope = "\n".join(after_segments) if after_segments else text

        decided_vals = []
        for mm in re.finditer(
                r"([\d,]+)\s*원을?\s*발행가액으로\s*결정하였습니다", scope):
            try:
                v = int(mm.group(1).replace(",", ""))
                if 100 <= v <= 1_000_000:
                    decided_vals.append(v)
            except ValueError:
                pass
        if decided_vals:
            from collections import Counter as _Counter
            out["price"] = _Counter(decided_vals).most_common(1)[0][0]

    # ============ Fallback: "확정가액 ... 보통주 기준 : NNN원" (윙입푸드 ADR 케이스) ============
    # 본문에 "확정가액 : ADR 기준 : 5,602원 보통주 기준 : 5,602원" 패턴.
    # [\s\S] (newline 포함 any) 로 첫 '원' 에서 안 끊기게.
    if out.get("price") is None:
        m = re.search(
            r"확정가액[\s\S]{0,300}?보통주\s*기준\s*[:：]?\s*([\d,]+)\s*원", text)
        if m:
            try:
                val = int(m.group(1).replace(",", ""))
                if 100 <= val <= 1_000_000:
                    out["price"] = val
            except ValueError:
                pass

    # final_price 텍스트 fallback — "[확정 발행가액]모집(매출)가액 : 855원"
    if out.get("price") is None:
        m = re.search(
            r"\[\s*확정\s*발행\s*가액\s*\]\s*모집\s*\(\s*매출\s*\)\s*가액\s*:?\s*([\d,]+)\s*원",
            text)
        if m:
            try:
                out["price"] = int(m.group(1).replace(",", ""))
            except ValueError:
                pass

    # updated_qty fallback — "모집 또는 매출 증권의 종류 : 기명식 보통주 X주"
    if out.get("updated_qty") is None:
        m = re.search(
            r"모집\s*또는\s*매출\s*증권의\s*종류\s*:\s*[가-힣]+\s*보통주\s*([\d,]+)\s*주",
            text)
        if m:
            try:
                out["updated_qty"] = int(m.group(1).replace(",", ""))
            except ValueError:
                pass

    # ============ existing_qty (발행주식총수) 변경 추출 (자비스 2023-03 케이스) ============
    # [발행조건확정] 정정 후 영역에 "신주인수권 행사로 인한 발행주식총수 변동" 표시:
    #   "- 증자 전 발행주식총수: 22,182,217주" (정정 전)
    #   "- 증자 후 발행주식총수: 22,343,136주" (정정 후) ← 새 base
    # 신주인수권 행사 등으로 발행주식수가 변동되면 F (기존주식) 갱신 필요.
    # → caller (main_ecm._process_rights) 가 rcept_no 우선순위로 F 갱신.
    m = re.search(
        r"증자\s*후\s*발행주식\s*총수[^주]*?([\d,]+)\s*주", text)
    if m:
        try:
            out["existing_qty"] = int(m.group(1).replace(",", ""))
        except ValueError:
            pass

    return out


# RIGHTS_* broker 리스트도 LEAD_ECM/UW_ECM 단일화 (위쪽 IPO_* 와 동일 참조)
RIGHTS_LEAD_BROKERS = _config_ecm.LEAD_ECM
RIGHTS_UW_BROKERS = _config_ecm.UW_ECM
