"""DART 증권신고서(채무증권) HTML 본문 파싱.

전략:
1. 본문의 모든 표를 추출 후 분류 (회차ID/사채기본/신용등급/인수인/청약일/수요예측)
2. "회차ID" 표 등장을 기준으로 트랜치 그룹핑.
3. [발행조건확정] 신고서는 같은 회차 표 세트가 2번 등장 (정정전=예정/최초모집, 정정후=확정/최종발행).
4. 수요예측 결과 표가 있으면 별도 추출.

발행사마다 표 형식이 미묘하게 다르므로 가장 흔한 패턴 우선 처리.
"""
from __future__ import annotations
import re
import io
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable
import pandas as pd
from bs4 import BeautifulSoup

import config

log = logging.getLogger(__name__)


# 증권사 정식명에서 제거할 접미사 (긴 것부터)
_BROKER_SUFFIXES = (
    "투자증권금융", "투자증권", "금융투자", "증권금융",
    "투자은행", "캐피탈", "증권", "투자",
)


@dataclass
class TrancheRecord:
    """DCM sheet 1행에 해당."""
    subscription_date: date | None = None
    issuer_alias: str = ""
    issuer_full: str = ""
    corp_code: str = ""  # DART OpenAPI corp_code — corp_name 표기 변경 추적용
    series: str = ""
    bond_type: str = ""
    credit_rating: str = ""
    maturity: date | str | None = None
    initial_amount: float | None = None
    issue_limit: float | None = None
    demand_amount: float | None = None
    final_amount: float | None = None
    series_total: float | None = None
    rate_target: str = ""
    rate_demand: str = ""
    rate_final: float | None = None
    # 주관사: 공시의 인수(주선)인 표에서 '대표' 표시된 증권사 약칭 리스트.
    # P~AN 셀에는 직접 금액이 아니라 수식이 들어감 (formulas.build_lead_formula).
    lead_managers: list[str] = field(default_factory=list)
    # 인수사 + 인수금액 (대표·공동·인수단 모두 포함, 공시 그대로) — [발행조건확정] 이후만 채움
    underwriter_alloc: dict[str, float] = field(default_factory=dict)
    # 인수사 명단(이름만, 금액 없음) — stage1 단계부터 채워 표·기사에 명단 표시용.
    # [발행조건확정] 이후엔 underwriter_alloc 의 키가 사실상 동일하므로 보조 역할.
    uw_names: list[str] = field(default_factory=list)
    rcept_no: str = ""
    is_amendment: bool = False
    is_foreign: bool = False  # 외화채(SOFR/USD 등) — 금융 데이터 컬럼 일부 빈칸 처리
    raw_tables_count: int = 0
    notes: list[str] = field(default_factory=list)


# ============== 유틸 ==============

def _norm(s) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def _flat_text(t: pd.DataFrame) -> str:
    """표 내용을 한 문자열로 평탄화."""
    parts = [_norm(c) for c in t.columns]
    parts.extend(_norm(v) for v in t.values.flatten())
    return " | ".join(parts)


def _parse_amount_won(s: str) -> float | None:
    """원 단위 숫자 → float."""
    s = _norm(s).replace(",", "")
    if not s or s in ("-", "—"):
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    return float(m.group(1)) if m else None


def _won_to_eok(won: float | None) -> float | None:
    return None if won is None else won / 1e8


def _parse_korean_date(s: str) -> date | str | None:
    """'2026년 05월 11일' / '2026-05-11' / '2026.05.11' 등을 date로.

    긴 텍스트 (예: 상환기일 셀에 상환방법 문장 통째로) 일 때는 텍스트 안에서
    날짜 패턴 (YYYY년 MM월 DD일 또는 YYYY-MM-DD) 강제 추출.
    """
    s = _norm(s)
    if not s or s in ("-", "—"):
        return None
    if "영구" in s:
        return "-"
    # 긴 텍스트 (50자 초과) 면 안에서 첫 날짜 패턴 추출 시도
    # (에스케이쉴더스 6 류 — 상환기일 셀에 상환방법 문장 통째로 들어옴)
    if len(s) > 50:
        m = re.search(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", s)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
        m = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
        # 추출 실패 — 긴 텍스트 그대로 두지 말고 None 반환
        return None
    s2 = re.sub(r"[년월./]", "-", s).replace("일", "")
    s2 = re.sub(r"\s+", "", s2).strip("-")
    s2 = re.sub(r"-+", "-", s2)
    try:
        return datetime.strptime(s2, "%Y-%m-%d").date()
    except ValueError:
        return s


# ============== 표 분류 ==============

TABLE_SERIES_ID = "series_id"           # 회차 : 6-1
TABLE_BOND_BASIC = "bond_basic"         # 권면총액/모집총액/이자율/상환기일
TABLE_CREDIT = "credit"                 # 평가일/신용평가기관/등급
TABLE_UNDERWRITER = "underwriter"       # 인수(주선)인/인수수량/인수금액
TABLE_SUBSCRIPTION = "subscription"     # 청약기일/납입기일
TABLE_DEMAND = "demand"                 # 수요예측 결과
TABLE_OTHER = "other"


# 회차 ID 매칭 정규식: "회차 : 6-1" 또는 "제6-1회"
_SERIES_PATTERNS = [
    re.compile(r"회차\s*[:：]\s*\|?\s*(\d+(?:-\d+)?)"),
    re.compile(r"제\s*(\d+(?:-\d+)?)\s*회"),
]


def classify_table(t: pd.DataFrame) -> str:
    flat = _flat_text(t)
    flat_ns = flat.replace(" ", "")
    cols = " ".join(_norm(c) for c in t.columns).replace(" ", "")

    # 회차ID: 짧은 표(보통 1-3행)에서 "회차 : N-N" 또는 "제N-N회" 매칭
    if t.shape[0] <= 3:
        for pat in _SERIES_PATTERNS:
            if pat.search(flat):
                return TABLE_SERIES_ID

    if "신용평가기관" in cols or ("평가일" in cols and "등급" in flat):
        return TABLE_CREDIT
    if ("인수(주선)인" in cols
            or ("인수금액" in cols and "인수수량" in cols)
            or ("인수금액" in cols and "인수조건" in cols)):
        return TABLE_UNDERWRITER
    if "청약기일" in cols and "납입기일" in cols:
        return TABLE_SUBSCRIPTION
    # 수요예측 참여 내역 표 — 두 가지 형식:
    # (1) 행이 건수/수량(또는 금액)/경쟁률, 마지막 컬럼 합계 (기존)
    # (2) 단행 형식: cols=참여건수/참여수량/경쟁률 (신한은행 신종자본 류 — "합계" 컬럼 없음)
    if ("건수" in flat_ns
            and ("수량" in flat_ns or "금액" in flat_ns)
            and "경쟁" in flat_ns):
        # 형식 1: '합계' 있는 multi-row
        if "합계" in flat_ns:
            return TABLE_DEMAND
        # 형식 2: '참여건수' + '참여수량'/'참여금액' 컬럼 헤더 + 단행
        if "참여" in flat_ns:
            return TABLE_DEMAND
    if (("권면" in flat_ns and "이자율" in flat_ns) or
            ("전자등록" in flat_ns and "이자율" in flat_ns) or
            ("모집(매출)총액" in flat_ns and "상환기일" in flat_ns)):
        return TABLE_BOND_BASIC
    return TABLE_OTHER


# ============== 표별 추출 ==============

def _extract_series_id(t: pd.DataFrame) -> str:
    """'회차 : 6-1' / '제6-1회' → '6-1'."""
    txt = _flat_text(t)
    for pat in _SERIES_PATTERNS:
        m = pat.search(txt)
        if m:
            return m.group(1).strip()
    return ""


def _extract_demand_amount(t: pd.DataFrame) -> float | None:
    """수요예측 참여 내역 표에서 추출.

    형식 1: 첫 컬럼이 구분 (행이 건수/수량(또는 금액)/경쟁률), 마지막 컬럼 합계
    형식 2: 컬럼 헤더가 '참여건수/참여수량(또는 참여금액)/경쟁률' (신한은행 신종자본 류 단행)

    공시 단위는 '억원'. 모두 '-' 면 0.0 반환 (수요예측 참여 0건).
    """
    nrows, ncols = t.shape
    if nrows == 0 or ncols == 0:
        return None

    # 형식 2: 컬럼 헤더에 '참여수량' / '참여금액' 있으면 그 컬럼의 첫 데이터 행 값
    for c in range(ncols):
        col_str = _norm(t.columns[c]).replace(" ", "")
        if col_str in ("참여수량", "참여금액") or col_str.endswith("'참여수량')") or col_str.endswith("'참여금액')"):
            for r in range(nrows):
                v = _norm(t.iloc[r, c])
                if v and v not in ("-", "—"):
                    try:
                        return float(v.replace(",", ""))
                    except ValueError:
                        continue
            return 0.0

    # 형식 1: row 0 col 0 = '수량' 또는 '금액'
    for r in range(nrows):
        first_cell = _norm(t.iloc[r, 0])
        if first_cell in ("수량", "금액"):
            for c in range(ncols - 1, 0, -1):
                v = _norm(t.iloc[r, c])
                if v and v not in ("-", "—"):
                    try:
                        return float(v.replace(",", ""))
                    except ValueError:
                        continue
            return 0.0
    return None


def _extract_bond_basic(t: pd.DataFrame) -> dict:
    """사채기본정보 표에서 권면총액/모집총액/이자율/상환기일/종류 추출."""
    out = {}
    # 표가 라벨/값 라벨/값 형태(2열짜리)거나 4열짜리(라벨/값/라벨/값)
    pairs = []
    nrows, ncols = t.shape
    # pd.read_html 이 표 첫 행을 header 로 흡수한 경우 (columns 에 '채무증권 명칭' 같은
    # 데이터 라벨 등장) → columns 도 라벨/값 페어 한 줄로 취급.
    # 미해석 시 bond_name 추출 누락 → bond_type 이 '일반' 으로 잘못 fallback (예: 메리츠 8회차).
    cols_list = [_norm(c) for c in t.columns]
    cols_joined_ns = "".join(cols_list).replace(" ", "")
    if any(k in cols_joined_ns for k in ("채무증권명칭", "권면", "이자율", "발행수익률", "상환기일")):
        for i in range(0, len(cols_list) - 1, 2):
            label, val = cols_list[i], cols_list[i + 1]
            if label and val:
                pairs.append((label, val))
    for r in range(nrows):
        row = [_norm(v) for v in t.iloc[r]]
        # 짝수 인덱스 = 라벨, 홀수 = 값
        for i in range(0, len(row) - 1, 2):
            label, val = row[i], row[i + 1]
            if label and val:
                pairs.append((label, val))

    for label, val in pairs:
        L = label.replace(" ", "")
        if "채무증권명칭" in L:
            out["bond_name"] = val
        elif "권면" in L and "총액" in L:
            out["face_total_won"] = _parse_amount_won(val)
        elif "모집" in L and "총액" in L:
            out["offering_total_won"] = _parse_amount_won(val)
        elif L == "이자율":
            out["rate"] = val
        elif "상환기일" in L:
            out["maturity"] = _parse_korean_date(val)
        elif "발행수익률" in L:
            out["yield"] = val

    # 종류 분류 (bond_name 의 띄어쓰기는 무시하고 키워드 포함 여부로 판단)
    name_ns = out.get("bond_name", "").replace(" ", "")
    if "신종자본" in name_ns or "조건부자본증권" in name_ns:
        out["bond_type"] = "신종자본"
    elif "후순위" in name_ns:
        out["bond_type"] = "후순위채"
    elif "보증" in name_ns and "무보증" not in name_ns:
        out["bond_type"] = "보증"
    else:
        out["bond_type"] = "무보증"
    return out


_RATING_GRADE_RE = re.compile(r"\b(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)\b")
_RATING_SIGN_RE = re.compile(r"(AAA|AA|A|BBB|BB|B)([+\-0])?")

# 한국 회사채 신용등급 순위 (낮을수록 높은 등급). CP 등급(A1, A2)은 미포함.
_RATING_RANK = {
    "AAA": 1,
    "AA+": 2, "AA": 3, "AA-": 4,
    "A+": 5,  "A": 6,  "A-": 7,
    "BBB+": 8, "BBB": 9, "BBB-": 10,
    "BB+": 11, "BB": 12, "BB-": 13,
    "B+": 14, "B": 15, "B-": 16,
    "CCC+": 17, "CCC": 18, "CCC-": 19,
    "CC": 20, "C": 21, "D": 22,
}


def _normalize_grade(raw: str) -> str:
    """'AA0' → 'AA', 'A0' → 'A' (등급 뒤의 '0' 제거)."""
    g = raw.strip()
    if g.endswith("0"):
        g = g[:-1]
    return g


def _extract_inline_credit_grades_from_sections(html_sections: dict[str, str]) -> list[str]:
    """본문 전체에서 신용등급 인라인 추출.

    표 식별 실패 시 fallback. 2023 본문 형식 (사채기본정보 셀 안의 인라인 텍스트)
    및 비슷한 경우 처리.

    패턴: 회사채 / 무보증사채 / 신종자본증권 등급(평가기관) 형태.
    예: 'AA0(NICE신용평가(주)) / AA0(한국신용평가(주))'
       '회사채 (AA-)' / '신종자본증권 (A+)'
    """
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)

    grades: list[str] = []
    # 평가기관 키워드 (full name 만 — 일반 단어 false match 방지)
    agency_pat = (r"(?:NICE\s*신용평가|한국\s*신용평가|한국\s*기업평가|"
                  r"KIS\s*자산평가|에프앤\s*자산평가|S&P|Moody|Fitch)")

    # 패턴 0: 직접 '신용등급 ... 등급/등급/등급' (가장 명시적, 농협금융지주 3 류)
    # 예: '신용등급 (신용평가기관) 한국신용평가(주)/NICE신용평가(주)/한국기업평가(주) AA-/AA-/AA-'
    # ⚠️ NICE/CCC 등 평가기관명에 포함된 A-D 문자에 false match 방지를 위해
    #    (1) 등급 끝에 \b 대신 (?!\w) — "A+" 같이 [+\-0] 직후가 non-word 일 때
    #        백트래킹으로 "A"만 캡처되는 버그 차단,
    #    (2) 슬래시 구분된 ≥2개 등급일 때만 매치 (단일 등급은 뒤의 pattern 1/3 이
    #        평가기관 컨텍스트와 함께 정확히 추출).
    m = re.search(
        r"신용등급[^A-D\n]{0,300}?"
        r"(\b[A-D]{1,3}[+\-0]?(?![A-Z0-9])(?:\s*/\s*\b[A-D]{1,3}[+\-0]?(?![A-Z0-9])){1,3})",
        full_text)
    if m:
        for g in re.split(r"\s*/\s*", m.group(1)):
            grades.append(_normalize_grade(g))
        return grades

    # 패턴 3 (먼저 시도): 평가기관 + 50자 이내 등급 (평가기관이 등급보다 앞에 — 표준)
    # 예: '한국신용평가(주)/NICE신용평가(주)/한국기업평가(주) AA-/AA-/AA-'
    #     'NICE신용평가(주) A+ / 한국신용평가(주) A+'
    # — agency-anchored. 정상 표기는 30자 이내. 50자로 제한해 'B'/'A' 가 후속 단락
    #    (수익률 산정 근거 등)에서 false match 되는 것 방지.
    for m in re.finditer(
        rf"{agency_pat}[^A-D\n]{{0,50}}?\b([A-D]{{1,3}}[+\-0]?)(?![A-Z0-9])",
        full_text):
        grades.append(_normalize_grade(m.group(1)))
        if len(grades) >= 4:
            break
    if grades:
        return grades

    # 패턴 1 (fallback): 등급 + 50자 이내 평가기관 (등급과 기관 사이 outlook/괄호 등)
    # 예: 'AA0(NICE신용평가(주))', 'AA0(안정적) 한국기업평가', 'AAA(안정적) (한국신용평가/...)'
    # 끝의 (?!\w) — "A+" 처럼 [+\-0] 가 매치된 후 백트래킹으로 sign 떼어지는 것 방지.
    # 단, 등급이 평가기관 앞에 위치 — 비표준 형식, false match 위험 좀 더 큼.
    for m in re.finditer(
        rf"\b([A-D]{{1,3}}[+\-0]?)(?![A-Z0-9])[^A-D\n]{{0,50}}?{agency_pat}",
        full_text):
        grades.append(_normalize_grade(m.group(1)))
        if len(grades) >= 4:
            break
    if grades:
        return grades

    # 패턴 2: '회사채 (AA-)' / '신종자본증권 (A+)' / '무보증사채 (AAA)' — 일반 괄호 형태
    for m in re.finditer(
        r"(?:회사채|무보증사채|신종자본증권|후순위사채)\s*\(\s*([A-D]{1,3}[+\-0]?)\s*\)",
        full_text):
        grades.append(_normalize_grade(m.group(1)))
        if len(grades) >= 4:
            break
    return grades


def _extract_credit_grades(t: pd.DataFrame) -> list[str]:
    """신용등급 표에서 모든 회사채 등급 추출. 등장 순서 보존."""
    txt = _flat_text(t)
    grades: list[str] = []
    # 괄호 형태가 일반적: '(AA-)', '(A+)', '(AA0)'
    for m in re.finditer(r"\(([A-D]{1,3}[+\-0]?)\)", txt):
        grades.append(_normalize_grade(m.group(1)))
    if not grades:
        # fallback: 괄호 없는 형태
        for m in _RATING_SIGN_RE.finditer(txt.replace(" ", "")):
            base = m.group(1)
            sign = m.group(2) or ""
            if sign == "0":
                sign = ""
            grades.append(base + sign)
    return grades


# 발행한도 주석. DART 공시마다 어구가 달라 '수요예측' 앵커 + (\숫자) + 이하/한도/범위 로 매칭.
# 매치 흐름: '수요예측' 출현 → 마침표 없이 500자 이내 (\NNN,NNN,...) → 30자 이내 '이하|한도|범위'
# 중간 괄호(예: '(전자등록)', '(신종자본증권)')는 자동 스킵 — [\d,]{8,} 가 한글을 거부.
_ISSUE_LIMIT_RE = re.compile(
    # anchor: 일반 회사채는 '수요예측' 결과에 따라 ~ 범위 내. first-and-final 케이스
    # (수요예측 없음) 은 '투자자 모집 현황에 따라' 또는 '예정 금액이며' 같은 표현 사용
    # (예: 제이알글로벌리츠 6 회차).
    r"(?:수요예측|투자자\s*모집\s*현황|예정\s*금액이며)[^.]{1,500}?"
    r"\(\s*[\\₩￦＼]?\s*([\d,]{8,})\s*\)"
    r"[^.]{0,30}?(?:이하|한도|범위|까지)",
    re.DOTALL,
)


# 공모희망금리 주석 (정정 전 공시 본문). DART 공시마다 두 형태 중 하나:
# (1) 민평 기준: '... 개별민평 수익률의 산술평균 ... ±X.XX%p. 가산 ...'
# (2) 직접 금리: '... 공모희망금리는 연 X.XX% ~ Y.YY% ...'
_HOPE_RATE_BP_RE = re.compile(
    # '민평' 앞에 '개별/등급/기준' 등 변형이 올 수 있어 prefix 무관하게 '민평' 만 요구
    # %p 대소문자 무관 (공시마다 '%p' / '%P' 혼용 — 예: 폭스바겐파이낸셜 5회차)
    # % 와 p 사이 공백 허용 (예: 울산지피에스 2 '0.47% p.')
    # 소수점 뒤 공백 허용 (예: SK브로드밴드 52 '0. 30%p' — DART OCR 깨짐)
    # 정수부와 소수점 사이 공백 허용 (예: 지역난방공사 46 '0 . 15 %p')
    # sign 과 숫자 사이 공백 허용 (예: 한국금융지주 32 '- 0.20%p')
    r"공모희망금리.{0,500}?민평.{0,200}?"
    r"([+-]?\s*\d+(?:\s*\.\s*\d+)?)\s*%\s*p\.?\s*~\s*([+-]?\s*\d+(?:\s*\.\s*\d+)?)\s*%\s*p",
    re.DOTALL | re.IGNORECASE,
)
# 국고채 기준 가산형 — 일부 발행 (예: 에스이그린에너지 2) 이 민평 대신 국고채 수익률 기준.
# 표기: '국고채±Nbp' 또는 '국고채-N~+Mbp'.
_HOPE_RATE_BP_GOV_RE = re.compile(
    r"공모희망금리.{0,500}?국고채.{0,200}?"
    r"([+-]?\s*\d+(?:\s*\.\s*\d+)?)\s*%\s*p\.?\s*~\s*([+-]?\s*\d+(?:\s*\.\s*\d+)?)\s*%\s*p",
    re.DOTALL | re.IGNORECASE,
)
_HOPE_RATE_PCT_RE = re.compile(
    # '연' 단어는 옵션 (KB금융처럼 '공모희망금리는 X.XX% ~ Y.YY%' 형태도 매칭)
    r"공모희망금리.{0,200}?(?:연\s*)?(\d+(?:\.\d+)?)\s*%\s*~\s*(\d+(?:\.\d+)?)\s*%",
    re.DOTALL,
)


def _format_hope_rate_bp(low_pct: float, high_pct: float) -> str:
    """%p 단위 → bp 표기. 음/양 대칭이면 민평±Nbp, 비대칭이면 민평-N~+Mbp."""
    low_bp = round(low_pct * 100)
    high_bp = round(high_pct * 100)
    if low_bp < 0 < high_bp and abs(low_bp) == high_bp:
        return f"민평±{high_bp}bp"
    return f"민평{low_bp:+d}~{high_bp:+d}bp"


def _format_hope_rate_bp_gov(low_pct: float, high_pct: float) -> str:
    """%p 단위 → 국고채 기준 bp 표기."""
    low_bp = round(low_pct * 100)
    high_bp = round(high_pct * 100)
    if low_bp < 0 < high_bp and abs(low_bp) == high_bp:
        return f"국고채±{high_bp}bp"
    return f"국고채{low_bp:+d}~{high_bp:+d}bp"


def _extract_hope_rate(html_sections: dict[str, str]) -> str:
    """공시 본문에서 공모희망금리 추출 + 표기 문자열로 변환. 못 찾으면 빈 문자열."""
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)

    # 숫자 안 공백 제거 helper — DART OCR '0. 30' 같은 형태 처리
    def _to_float(s):
        return float(s.replace(" ", ""))

    m = _HOPE_RATE_BP_RE.search(full_text)
    if m:
        try:
            return _format_hope_rate_bp(_to_float(m.group(1)), _to_float(m.group(2)))
        except ValueError:
            pass

    # 국고채 기준 가산형 (예: 에스이그린에너지 2 — 1년 만기 국고채 +0~+50bp)
    m = _HOPE_RATE_BP_GOV_RE.search(full_text)
    if m:
        try:
            return _format_hope_rate_bp_gov(_to_float(m.group(1)), _to_float(m.group(2)))
        except ValueError:
            pass

    m = _HOPE_RATE_PCT_RE.search(full_text)
    if m:
        try:
            return f"{_to_float(m.group(1)):.2f}~{_to_float(m.group(2)):.2f}%"
        except ValueError:
            pass

    return ""


# 수요금리: 정정후 표 주석의 단일값 가산. anchor 가 공시마다 달라
# (호텔신라/CJ는 '본 사채의 이자율 및 발행수익률', AJ네트웍스는 '수요예측시 공모희망금리')
# 회차 마커 위치 기반으로 series 별 매칭하는 방식으로 통일.
# 회차 마커: 본문 표현 다양 — '[회 차 : 16-1]', '회차 : 제20-1회', '[제77-1회 무보증사채]' 등.
# 대괄호 옵션화 + '제' 옵션 + '회' 옵션화로 광범위 매칭.
_DEMAND_RATE_SERIES_MARKER_RE = re.compile(
    r"(?:회\s*차\s*[:：]\s*(?:제\s*)?(\d+(?:\s*-\s*\d+)?)\s*회?"
    r"|\[(?:\s*제)?\s*(\d+(?:\s*-\s*\d+)?)\s*회"
    r"|\s*제\s*(\d+(?:\s*-\s*\d+)?)\s*회)"
)
# 단일값 가산: 'X.XX%p.를 가산'. 부호 옵션화 (포스코퓨처엠 처럼 '0.18%p.를 가산' 형태 포함).
# 범위형 후반부 ('%p. ~ +Y.YY%p.를 가산') 는 직전 20자에 '~' 검사로 caller 에서 제외.
# %p 대소문자 무관 (예: 폭스바겐파이낸셜 5회차 '-0.45%P.를 가산').
# % 와 p 사이 공백 허용 (울산지피에스 2 류 '0.47% p.').
# 소수점 뒤 공백 허용 (SK브로드밴드 52 류 '0. 02%p' — DART OCR 깨짐).
_DEMAND_RATE_GASSAN_RE = re.compile(
    r"([+-]?\s*\d+(?:\s*\.\s*\d+)?)\s*%\s*p\.?\s*를?\s*가산",
    re.IGNORECASE,
)
# flat 케이스: 가산 없이 '민평 수익률 ... 산술평균(...)' 만으로 결정 → ±0bp.
# 부정 lookahead: '산술평균' 직후 100자 안에 'X%p' (가산값) 이 없을 때만 매칭.
# (호텔롯데처럼 같은 본문에 가산/flat 트랜치 혼재 시, flat 패턴이 가산 텍스트도 매칭해
# 잘못 트랜치에 ±0bp 가 attach 되는 문제 방지)
# OCR 공백 깨짐 대비: 숫자 안 공백 허용.
_DEMAND_RATE_FLAT_RE = re.compile(
    # '수익률' 다음 '(%)' 옵션 + '의/을' 옵션 + '산술평균' + 다음 100자 안에 가산값 없을 때
    r"민평\s*수익률\s*(?:\(\s*%\s*\))?\s*[을의]?\s*산술평균"
    r"(?![^.]{0,100}?[+-]?\d+(?:\.\s*\d+)?\s*%\s*p)",
    re.DOTALL | re.IGNORECASE,
)


def _format_demand_rate_bp(pct: float) -> str:
    """%p → bp 변환 + 부호 표기. 0 은 '±0bp'."""
    bp = round(pct * 100)
    if bp == 0:
        return "±0bp"
    return f"{bp:+d}bp"


def _extract_demand_rates_by_series(html_sections: dict[str, str]) -> dict[str, str]:
    """본문 회차 마커 + 정정후 단일값 가산(or flat) 패턴을 위치 기반으로 매칭.

    1) 회차 마커 '[회 차 : N-N]' 위치 모두 수집.
    2) 각 단일값 가산 매칭에 대해 직전 마커의 series 에 첫 매칭만 attach.
       정정 전 범위형의 후반부('%p. ~ +Y.YY%p.를 가산')는 직전 20자에 '~' 가
       있으므로 제외.
    3) flat 매칭은 가산이 잡히지 않은 series 에 대해서만 ±0bp 로 attach.
    """
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)

    # 캡처된 series 의 공백 strip ('130 -1' → '130-1' — LS 130 류 본문 표기 호환)
    markers = [(m.start(), (m.group(1) or m.group(2) or m.group(3)).replace(" ", ""))
               for m in _DEMAND_RATE_SERIES_MARKER_RE.finditer(full_text)]

    def _nearest_series(pos: int) -> str | None:
        for mp, ms in reversed(markers):
            if mp < pos:
                return ms
        return None

    # GASSAN + FLAT 매칭을 위치 순으로 통합 처리. 첫 매칭이 해당 series 결과를 결정.
    # 한 series 의 정정후 주석이 본문 앞쪽에 등장하고, 같은 가산값의 재인용이 다른 series
    # 마커 뒤에 있는 경우 (호텔롯데처럼) 잘못된 series 에 attach 되는 문제 방지.
    events: list[tuple[int, str, str | None]] = []
    for m in _DEMAND_RATE_GASSAN_RE.finditer(full_text):
        if "~" in full_text[max(0, m.start() - 20):m.start()]:
            continue
        events.append((m.start(), "gassan", m.group(1)))
    for m in _DEMAND_RATE_FLAT_RE.finditer(full_text):
        events.append((m.start(), "flat", None))
    events.sort()

    results: dict[str, str] = {}
    for pos, kind, val in events:
        series = _nearest_series(pos)
        if not series or series in results:
            continue
        if kind == "gassan":
            try:
                # 숫자 안 공백 제거 (DART OCR '0. 02' 처리)
                results[series] = _format_demand_rate_bp(float(val.replace(" ", "")))
            except (ValueError, TypeError):
                continue
        else:  # flat
            results[series] = "±0bp"

    return results


# 최종금리: 본문에서 series 별 절대 금리 추출
# 패턴: '이자율 : X.XXX%' 또는 '발행수익률 : X.XXX%' (정정후 사채기본정보 표 텍스트)
_FINAL_RATE_RE = re.compile(r"(?:이자율|발행수익률)\s*[:：]\s*(\d+\.\d+)\s*%?")


def _extract_rates_by_series(html_sections: dict[str, str]) -> dict[str, float]:
    """본문 회차 마커 + '이자율/발행수익률 : X.XXX%' 패턴으로 series 별 최종금리 추출.

    동일 series 의 첫 매칭만 사용. 정정 전 표는 'X.XXX' 자체가 없거나 '-' 라서
    자연 skip. 정정 후 표(또는 그 텍스트 표현)의 X.XXX% 만 매칭.
    """
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)

    # 캡처된 series 의 공백 strip ('130 -1' → '130-1' — LS 130 류 본문 표기 호환)
    markers = [(m.start(), (m.group(1) or m.group(2) or m.group(3)).replace(" ", ""))
               for m in _DEMAND_RATE_SERIES_MARKER_RE.finditer(full_text)]

    def _nearest_series(pos: int) -> str | None:
        for mp, ms in reversed(markers):
            if mp < pos:
                return ms
        return None

    results: dict[str, float] = {}
    for m in _FINAL_RATE_RE.finditer(full_text):
        series = _nearest_series(m.start())
        if not series or series in results:
            continue
        try:
            results[series] = float(m.group(1))
        except ValueError:
            continue

    # Inline fallback: 'N-N회 이자율: X.XXX' 또는 'N-N회 발행수익률: X.XXX' 형식 매칭
    # (GS칼텍스 142 / SK이노베이션 7 류 — 대괄호 / '제' 없는 정정 후 표 형식).
    # _nearest_series 가 잘못된 marker 매칭하는 케이스 — inline 결과로 덮어씀
    # (inline 매칭은 series 가 직접 같은 줄에 있어 정확).
    for m in re.finditer(
        r"(\d+(?:\s*-\s*\d+)?)\s*회\s*(?:이자율|발행수익률)\s*[:：]\s*(\d+\.\d+)",
        full_text):
        series = m.group(1).replace(" ", "")
        try:
            val = float(m.group(2))
            if val > 0:
                results[series] = val   # 덮어씀 — inline 이 더 정확
        except ValueError:
            continue

    return results


def _is_foreign_currency_filing(html_sections: dict[str, str]) -> bool:
    """본문에 외화 발행 지표가 있으면 외화채로 판단.

    USD 단순 카운트는 부정확 (예: 한화에어로스페이스는 회사 부채 내역에 '환율 적용' 같은
    환율 표기로 USD 다수 등장하지만 본 발행은 원화). 사용자 지시: "모집 또는 매출에 관한
    일반사항에 USD 원화 환산 문구가 나오는 경우에만 외화채".
    그래서 다음 키워드만 외화로 판단:
    - SOFR 5회 이상 (외화 변동금리 기준)
    - '달러화표시채권' 또는 '미국 달러화' (본 발행이 외화임을 명시)
    """
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)
    if full_text.count("SOFR") >= 5:
        return True
    if "달러화표시채권" in full_text or "미국 달러화" in full_text:
        return True
    return False


def _extract_first_rate(html_sections: dict[str, str]) -> float | None:
    """본문에서 첫 절대금리(X.XXX%) 추출 — 단일 트랜치 케이스용 fallback.

    series 마커가 본문에 등장 안 하는 단일 회차 공시(예: 해태제과식품 21)에서
    series 매핑이 불가능하므로, 본문 첫 매칭을 그 단일 record 에 적용.
    """
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)
    m = _FINAL_RATE_RE.search(full_text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def _extract_issue_limit_won(html_sections: dict[str, str]) -> float | None:
    """공시 본문 주석에서 '전자등록총액 합계 금 ... 이하' 의 발행한도(원) 추출."""
    full_text = ""
    for html in html_sections.values():
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            continue
        full_text += "\n" + soup.get_text(" ", strip=True)
    m = _ISSUE_LIMIT_RE.search(full_text)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _format_credit_grades(grades: list[str]) -> str:
    """여러 등급 → '제일 낮은 등급~제일 높은 등급' 표기. 단일/미판독은 그대로."""
    valid = [g for g in grades if g in _RATING_RANK]
    if not valid:
        return ""
    unique = sorted(set(valid), key=lambda g: _RATING_RANK[g])
    if len(unique) == 1:
        return unique[0]
    # rank 작을수록 상위. unique[0] = 최상위, unique[-1] = 최하위.
    return f"{unique[-1]}~{unique[0]}"


def _extract_underwriters(t: pd.DataFrame) -> list[dict]:
    """인수인 표 → [{'role':'대표', 'firm':'한국투자증권', 'amount_won':2.0e10}, ...].

    두 가지 표 형태 모두 처리:
    1) 단일 헤더: ['인수(주선)인', '인수(주선)인.1', '인수수량', '인수금액', ...]
    2) MultiIndex 헤더 (정정 후 사채의 인수): [('인수인','구분'), ('인수인','명칭'), ...,
       ('인수금액 및 수수료율','인수금액'), ('인수조건','인수조건')]
    """
    out = []
    cols_ns = [_norm(c).replace(" ", "") for c in t.columns]
    role_idx = firm_idx = amt_idx = None

    # Case 1: '인수(주선)인' 또는 '인수인' 형태 (2022 발행건은 후자가 다수)
    # 두 형태 모두 첫 컬럼이 role ('대표'/'공동'), 두 번째 컬럼이 firm 이름.
    for i, c in enumerate(cols_ns):
        if c in ("인수(주선)인", "인수인") and role_idx is None:
            role_idx = i
        elif (c.startswith("인수(주선)인") or c.startswith("인수인.")) and firm_idx is None:
            firm_idx = i
        elif "인수금액" in c and "수수료" not in c and amt_idx is None:
            amt_idx = i

    # Case 2: MultiIndex 헤더 형태. cols_ns 가 "('인수인','구분')" 같은 튜플 string 일 때
    # 마지막 요소(서브헤더)가 '구분' / '명칭' / '인수금액' 인지 검사.
    # ('인수금액및수수료율','수수료(정액)') 처럼 외부 그룹에 '수수료' 가 있어도 끝나는 게
    # "'수수료(정액)')" 라서 amt_idx 와 충돌하지 않음.
    # 2022 한화솔루션 279 형태: cols 에 '명칭', '명칭.1' 두 컬럼 존재. 첫 것이 role
    # ('대표'/'인수'), 두 번째가 firm. 두 컬럼이 모두 있으면 첫 '명칭' = role 로 처리.
    if role_idx is None or firm_idx is None:
        # 두 '명칭' 컬럼 존재 여부 미리 확인
        myeongchik_indices = [i for i, c in enumerate(cols_ns)
                               if c.endswith("'명칭')") or c == "명칭"
                               or c.endswith("'명칭.1')") or c == "명칭.1"]
        has_dual_myeongchik = len(myeongchik_indices) >= 2
        for i, c in enumerate(cols_ns):
            if role_idx is None and (c.endswith("'구분')") or c == "구분"):
                role_idx = i
            elif role_idx is None and has_dual_myeongchik and (c.endswith("'명칭')") or c == "명칭"):
                role_idx = i
            elif firm_idx is None and has_dual_myeongchik and (c.endswith("'명칭.1')") or c == "명칭.1"):
                firm_idx = i
            elif firm_idx is None and not has_dual_myeongchik and (c.endswith("'명칭')") or c == "명칭"):
                firm_idx = i
            if amt_idx is None and (c.endswith("'인수금액')") or c == "인수금액"):
                amt_idx = i

    # role 컬럼은 옵션. 한국해외인프라공사처럼 단일 인수자(1행) 표는 '구분' 없는 경우 있음.
    if firm_idx is None or amt_idx is None:
        return out

    for r in range(t.shape[0]):
        row = [_norm(v) for v in t.iloc[r]]
        max_idx = max(firm_idx, amt_idx, role_idx or 0)
        if max_idx >= len(row):
            continue
        role = row[role_idx] if role_idx is not None else ""
        firm = row[firm_idx]
        amt = _parse_amount_won(row[amt_idx])
        if firm and amt:
            out.append({"role": role, "firm": firm, "amount_won": amt})
    return out


def _extract_subscription_date(t: pd.DataFrame) -> date | None:
    """청약기일 표 → 첫 청약일."""
    cols = [_norm(c) for c in t.columns]
    if "청약기일" not in cols:
        return None
    idx = cols.index("청약기일")
    for r in range(t.shape[0]):
        v = _norm(t.iloc[r, idx])
        d = _parse_korean_date(v)
        if isinstance(d, date):
            return d
    return None


# ============== 증권사 매핑 ==============

def _auto_alias(formal_name: str) -> str:
    """정식 증권사명 → 자동 약칭. 흔한 접미사를 제거하고 남은 핵심 이름을 반환.

    예: '삼성증권' → '삼성', '한화투자증권' → '한화', 'KB증권' → 'KB',
        '코리아에셋투자증권' → '코리아에셋'
    """
    name = re.sub(r"[\(\)\s주식회사㈜]+", "", formal_name).strip()
    for suf in _BROKER_SUFFIXES:
        if name.endswith(suf) and len(name) > len(suf):
            return name[:-len(suf)]
    return name


def map_broker(formal_name: str, mappings: dict) -> str:
    """DART 정식명 → DCM 약칭. 매핑이 없으면 빈 문자열 반환."""
    name = re.sub(r"[\(\)\s주식회사㈜]+", "", formal_name)
    table = mappings.get("brokers_formal_to_alias", {})
    # 정확 매칭 우선
    for k, v in table.items():
        if k.replace(" ", "") == name:
            return v
    # 포함 관계
    for k, v in table.items():
        kn = k.replace(" ", "")
        if kn in name or name in kn:
            return v
    return ""


def auto_register_broker(formal_name: str, role: str, mappings: dict) -> str:
    """미매핑 증권사를 자동 약어 생성 + mappings/리스트에 등록.

    role: '대표' 또는 그 외 (인수단). '대표'면 lead_managers에도 추가.
    config.LEAD_MANAGERS / config.UNDERWRITERS 모듈 변수도 함께 갱신.
    이번 실행 기록은 mappings['_auto_added_brokers']에 누적 (main.py가 저장 시 분리).
    """
    alias = _auto_alias(formal_name)
    if not alias:
        return ""

    mappings.setdefault("brokers_formal_to_alias", {})[formal_name] = alias

    if role == "대표":
        leads = mappings.setdefault("lead_managers", [])
        if alias not in leads:
            leads.append(alias)
        if alias not in config.LEAD_MANAGERS:
            config.LEAD_MANAGERS.append(alias)

    uws = mappings.setdefault("underwriters", [])
    if alias not in uws:
        uws.append(alias)
    if alias not in config.UNDERWRITERS:
        config.UNDERWRITERS.append(alias)

    mappings.setdefault("_auto_added_brokers", []).append({
        "formal": formal_name, "alias": alias, "role": role,
    })
    return alias


# ============== 메인 파싱 함수 ==============

@dataclass
class ParseContext:
    rcept_no: str = ""
    is_amendment: bool = False
    is_final: bool = False
    corp_name: str = ""
    corp_code: str = ""


_TABLE_OPEN_RE = re.compile(r"<table\b", re.IGNORECASE)


def extract_demand_amounts_by_series(html_sections: dict[str, str]) -> dict[str, float]:
    """본문 회차 마커 + 수요예측 참여 내역 표 → series 별 demand_amount 매핑.

    parse_filing 이 bond_basic 표 추출 실패해서 records=0 반환하는 케이스 (기아 284 류) 용
    fallback. 회차ID 와 demand 표 위치 (table 글로벌 idx) 기반 매칭.

    세 가지 표 형태 지원:
      1) 단일 series 표: row 0 col 0 = '건수'/'수량'/'경쟁률' (위치는 table_to_series 로 매칭)
      2) Multi-tranche 단일 표: col 0 = 회차 (예 '223-1'), col 1 = 구분 (SK하이닉스 223 류)
      3) 본문 텍스트 fallback: '[제N회 ...] 총 참여신청금액: X,XXX억원' (현대비앤지스틸 204 류)
    """
    table_to_series = _build_table_series_map(html_sections)
    out: dict[str, float] = {}
    table_idx = 0
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except (ValueError, OSError):
            tables = []
        for t in tables:
            if classify_table(t) == TABLE_DEMAND:
                # Multi-tranche 표 시도 — 첫 컬럼 헤더에 '회차' 또는 첫 row col 0 이 series ID 형식
                multi = _extract_demand_multi_series_from_table(t)
                if multi:
                    for s, a in multi.items():
                        if s not in out:
                            out[s] = a
                else:
                    # 단일 series 표
                    amt = _extract_demand_amount(t)
                    if amt is not None:
                        series = table_to_series.get(table_idx, "")
                        if series and series not in out:
                            out[series] = amt
            table_idx += 1

    # Fallback: 본문 텍스트에서 '총 참여신청금액: X,XXX억원' 패턴.
    # 직전 series 마커 위치 기반 매칭 (가장 가까운 회차에 attach).
    # 마커 형식: '[제N회', '[제N-N회', '①제N-N회', '② 제N-N회 무보증사채' 등.
    from bs4 import BeautifulSoup as _BS
    # 회차 마커 — 형식 다양:
    # - [제N회], [제N-N회], [제2402-01-1회] (multi-dash)
    # - [회 차 : 제N-N회] / [회차: 제N회] (회차 prefix + 콜론, 공백/없음)
    # - ① 제N회, ② 제N-N회 무보증사채 (원숫자)
    series_marker_re = re.compile(
        r"(?:\[|[①-⑳])\s*(?:회\s*차\s*[:：]\s*)?(?:제\s*)?"
        r"(\d+(?:\s*-\s*\d+){0,2})\s*회")
    amount_re = re.compile(
        r"총\s*참여(?:신청)?\s*금액\s*[:：]?\s*([\d,]+)\s*억")
    # 수요예측 참여 0건 패턴
    zero_re = re.compile(r"수요예측\s*참여사항\s*없음")
    for html in html_sections.values():
        try:
            txt = _BS(html, "lxml").get_text(" ", strip=True)
        except Exception:
            continue
        markers = [(m.start(), m.end(), m.group(1).replace(" ", ""))
                   for m in series_marker_re.finditer(txt)]
        for m in amount_re.finditer(txt):
            # 직전 마커 찾기
            series = None
            for mp, me, ms in reversed(markers):
                if mp < m.start() and (m.start() - mp) < 500:
                    series = ms
                    break
            if not series:
                continue
            try:
                amt = float(m.group(1).replace(",", ""))
                if series not in out:
                    out[series] = amt
            except ValueError:
                continue
        # '수요예측 참여사항 없음' → 마커 forward 매칭.
        # 회차 마커 직후 100자 이내 '없음' 있으면 그 회차에 0 매핑.
        # (회차 마커 → 본문 → '없음' 순서. backward 매칭은 잘못된 series 잡을 위험)
        for mp, me, ms in markers:
            # 마커 직후 100자 안에 '없음' 있는지
            chunk = txt[me:me + 150]
            if zero_re.search(chunk):
                if ms not in out:
                    out[ms] = 0.0
    return out


def _extract_demand_multi_series_from_table(t: pd.DataFrame) -> dict[str, float]:
    """Multi-tranche 단일 표 처리. 첫 컬럼이 회차, 마지막 컬럼이 합계.

    SK하이닉스 223 류: 표 안에 4 trance 모두 행으로. 같은 series 가 3행 (건수/수량/경쟁율).
    """
    nrows, ncols = t.shape
    if ncols < 3:
        return {}
    # 첫 컬럼 헤더 또는 첫 row col 0 가 회차 형식인지 확인
    col0_header = str(t.columns[0]) if len(t.columns) > 0 else ""
    if "회차" not in col0_header.replace(" ", ""):
        # 첫 row col 0 가 series ID 형식 (NNN 또는 NNN-N)
        if nrows > 0:
            first = _norm(t.iloc[0, 0])
            if not re.match(r"^\d+(?:-\d+)?$", first):
                return {}

    out: dict[str, float] = {}
    for r in range(nrows):
        col0 = _norm(t.iloc[r, 0])
        if not re.match(r"^\d+(?:-\d+)?$", col0):
            continue
        # col 1 = 구분 (수량/금액)
        col1 = _norm(t.iloc[r, 1])
        if col1 not in ("수량", "금액"):
            continue
        # 마지막 유효 cell = 합계
        for c in range(ncols - 1, 1, -1):
            v = _norm(t.iloc[r, c])
            if v and v not in ("-", "—"):
                try:
                    out[col0] = float(v.replace(",", ""))
                    break
                except ValueError:
                    continue
    return out


def _build_table_series_map(html_sections: dict[str, str]) -> dict[int, str]:
    """각 <table> 직전 HTML 위치에서 가장 가까운 회차 마커 텍스트 → 글로벌 table idx → series.

    구현: raw HTML 의 byte offset 기준으로 <table> 시작 위치와 마커 텍스트 위치를 추출하고
    각 table 에 대해 직전(작은 offset) 마커를 매핑. BeautifulSoup descendants 는 깊이 우선
    순회라 nested table 모두 먼저 나오고 외부 마커 텍스트가 나중에 등장해 부정확.

    pd.read_html 은 <table> 마다 (nested 포함) DataFrame 생성하므로 모든 <table> 카운트.
    """
    result: dict[int, str] = {}
    series_re = _DEMAND_RATE_SERIES_MARKER_RE
    global_idx = 0
    for html in html_sections.values():
        table_positions = [m.start() for m in _TABLE_OPEN_RE.finditer(html)]
        markers = [(m.start(), (m.group(1) or m.group(2) or m.group(3)).replace(" ", ""))
                   for m in series_re.finditer(html)]
        mi = 0
        last_series = ""
        for tpos in table_positions:
            while mi < len(markers) and markers[mi][0] < tpos:
                last_series = markers[mi][1] or last_series
                mi += 1
            result[global_idx] = last_series
            global_idx += 1
    return result


def parse_filing(html_sections: dict[str, str], ctx: ParseContext, mappings: dict) -> list[TrancheRecord]:
    """공시 본문 → TrancheRecord 리스트.

    회차ID 표 등장을 트랜치 시작점으로 사용.
    [발행조건확정]에서 같은 회차가 2번 등장하면 첫 번째=정정전(최초모집), 두 번째=정정후(최종발행).
    """
    # 표 글로벌 index → 직전 텍스트의 series 마커 매핑 (인수 후보 매칭에 사용)
    table_to_series = _build_table_series_map(html_sections)

    # 모든 표 + 분류 수집 (등장 순서 유지). table_idx 도 함께 보관.
    all_classified: list[tuple[str, pd.DataFrame, int]] = []
    table_idx = 0
    for html in html_sections.values():
        try:
            tables = pd.read_html(io.StringIO(html), flavor="lxml")
        except (ValueError, OSError):
            tables = []
        for t in tables:
            all_classified.append((classify_table(t), t, table_idx))
            table_idx += 1

    # 트랜치 그룹핑: 회차ID 표 등장 사이의 표들을 한 그룹으로
    @dataclass
    class TrancheGroup:
        series: str = ""
        bond_basic: dict | None = None
        credit_grades: list[str] = field(default_factory=list)
        underwriters: list[dict] = field(default_factory=list)
        # 같은 group 안에서 여러 인수 표가 나올 수 있음 (정정 후 위탁표 → 정정 후 인수표 등).
        # 합계가 final_amount 와 가장 잘 맞는 후보를 record 에서 선택.
        underwriter_candidates: list[list[dict]] = field(default_factory=list)
        subscription_date: date | None = None
        order: int = 0  # 같은 series 내 등장 순서 (0=정정전, 1=정정후)

    raw_groups: list[TrancheGroup] = []
    cur: TrancheGroup | None = None

    # 수요예측 참여 내역은 채권 본문(bond_basic) 섹션과 다른 위치에 나오므로
    # TrancheGroup 과 별도로 트래킹. 직전 series_id 마커 + 등장 순서로 base 그룹 안에서 매칭.
    # 사유: 일부 공시는 수요예측 섹션의 회차 마커가 표가 아닌 텍스트로 들어가서
    # last_seen 만으로는 두 번째 트랜치를 구분하지 못함. 그래서 등장 순서를 이용.
    demand_amounts_in_order: list[tuple[str, float]] = []
    last_seen_series_id = ""
    # series 별 전역 인수단 후보 (TrancheGroup 의 flush 여부 무관).
    series_uw_candidates: dict[str, list[list[dict]]] = defaultdict(list)
    # 본문 전체의 인수단 표 후보 (series 매핑 부정확할 때 fallback)
    all_uw_candidates: list[list[dict]] = []

    def _flush(g):
        # 권면/모집총액이 추출된 그룹만 유효 (목차/요약 등 부속 표 제외)
        if g is None or g.bond_basic is None:
            return
        if not g.bond_basic.get("offering_total_won"):
            return
        # 일반 공모 회사채만 수집. 다음 채무증권은 제외:
        # - CP / 기업어음증권 / 일반CP / 단기사채
        # - 담보부사채: 부동산/자산 담보 기반이라 신용 수요예측 구조 아닌 사실상 담보대출
        #   성격 (예: 롯데리츠 8회차 — 담보물 건물 명기됨).
        # - 신주인수권부사채 (BW), 전환사채 (CB), 교환사채 (EB): 주식 전환/교환/인수권
        #   옵션 결합형. 일반 공모채 신용 수요예측 구조와 다름 (예: 엔켐 14 CB,
        #   유니켐 41 BW 등 — 보통 BB 등급 high yield 발행).
        name = g.bond_basic.get("bond_name", "")
        if name:
            name_ns = name.replace(" ", "")
            if any(kw in name_ns for kw in
                   ("기업어음증권", "일반CP", "단기사채", "담보부사채",
                    "신주인수권", "전환사채", "교환사채")):
                return
        raw_groups.append(g)

    for kind, t, tidx in all_classified:
        if kind == TABLE_SERIES_ID:
            sid = _extract_series_id(t)
            last_seen_series_id = sid
            _flush(cur)
            cur = TrancheGroup(series=sid)
        elif kind == TABLE_DEMAND:
            # 수요예측 표: 등장 순서대로 누적 (post-processing 에서 base 그룹 매칭)
            if last_seen_series_id:
                d = _extract_demand_amount(t)
                if d is not None:
                    demand_amounts_in_order.append((last_seen_series_id, d))
        elif cur is None:
            continue
        elif kind == TABLE_BOND_BASIC and cur.bond_basic is None:
            cur.bond_basic = _extract_bond_basic(t)
        elif kind == TABLE_CREDIT:
            # 신용평가기관별 등급 표가 여러 개일 수 있어 모두 누적
            cur.credit_grades.extend(_extract_credit_grades(t))
        elif kind == TABLE_UNDERWRITER:
            candidate = _extract_underwriters(t)
            if candidate:
                cur.underwriter_candidates.append(candidate)
                if not cur.underwriters:
                    cur.underwriters = candidate  # 첫 매칭이 기본 (검증 후 교체 가능)
                # series 우선순위: HTML 텍스트 기반 매핑 > main loop 의 last_seen_series_id
                # (외부 텍스트 회차 마커는 series_id 표로 분류 안 되므로 보강 필요)
                real_series = table_to_series.get(tidx) or last_seen_series_id
                if real_series:
                    series_uw_candidates[real_series].append(candidate)
                all_uw_candidates.append(candidate)
        elif kind == TABLE_SUBSCRIPTION and cur.subscription_date is None:
            cur.subscription_date = _extract_subscription_date(t)
    _flush(cur)

    # 같은 series가 2번 등장하면 order 부여
    series_seen: dict[str, int] = defaultdict(int)
    for g in raw_groups:
        g.order = series_seen[g.series]
        series_seen[g.series] += 1

    # series별로 정정전/정정후 머지
    by_series: dict[str, list[TrancheGroup]] = defaultdict(list)
    for g in raw_groups:
        by_series[g.series].append(g)

    records: list[TrancheRecord] = []
    for series, groups in by_series.items():
        if not series:
            continue
        groups.sort(key=lambda x: x.order)
        first = groups[0]   # 정정전 (예정금액)
        last = groups[-1]   # 정정후 (확정금액). 그룹 1개면 둘이 같음.

        rec = TrancheRecord(
            issuer_full=ctx.corp_name,
            corp_code=ctx.corp_code,
            series=series,
            rcept_no=ctx.rcept_no,
            is_amendment=ctx.is_amendment,
            raw_tables_count=len(all_classified),
        )

        # 종류, 신용등급은 마지막 기준 (마지막에 없으면 첫 그룹 fallback)
        if last.bond_basic:
            rec.bond_type = last.bond_basic.get("bond_type", "")
            rec.maturity = last.bond_basic.get("maturity")
            # 최종금리: 정정후 bond_basic 의 rate 필드 직접 사용
            # (KB금융/흥국화재처럼 [발행조건확정] 1번만 올라오는 케이스 + 직접 % 희망금리 케이스 처리)
            rate_str = str(last.bond_basic.get("rate", "")).strip()
            # 일부 신종자본/후순위 발행 (하나금융지주 11 류) 은 '이자율 -' / '발행수익률 4.55'
            # 형태. rate 가 '-' 이면 yield 필드 fallback.
            if (not rate_str or rate_str == "-") and last.bond_basic.get("yield"):
                rate_str = str(last.bond_basic.get("yield", "")).strip()
            if rate_str and rate_str != "-":
                rm = re.search(r"(\d+\.\d+)", rate_str)
                if rm:
                    try:
                        rec.rate_final = float(rm.group(1))
                    except ValueError:
                        pass
        rec.credit_rating = _format_credit_grades(
            last.credit_grades or first.credit_grades
        )
        # Fallback: 신용등급 표 식별 실패 시 (2023 본문 형식 — 사채기본정보 셀에
        # 인라인 텍스트로 들어있는 케이스). 본문 전체에서 패턴 추출.
        if not rec.credit_rating:
            inline_grades = _extract_inline_credit_grades_from_sections(html_sections)
            if inline_grades:
                rec.credit_rating = _format_credit_grades(inline_grades)

        # 청약일 (마지막 그룹 기준)
        rec.subscription_date = last.subscription_date or first.subscription_date

        # 금액: 정정전 = 최초모집 / 정정후 = 최종발행
        if first.bond_basic:
            rec.initial_amount = _won_to_eok(first.bond_basic.get("offering_total_won"))
        if last.bond_basic and len(groups) > 1:
            rec.final_amount = _won_to_eok(last.bond_basic.get("offering_total_won"))
        # 단일 그룹인 경우 (최초 신고서) → final_amount 미정

        # 인수인 분배: 정정후 기준 (인수금액은 공시 그대로)
        # 합계 검증: rec.final_amount 와 인수단 합계가 일치하지 않으면 같은 series 의 다른
        # underwriter 표 후보 (group 내 + 본문 전역) 중 합계가 가장 잘 맞는 것을 선택.
        # 사례: CJ대한통운 104-2 — 정정 후 [회차:104-2] 표(SK 90억, 합 2190) 다음에
        # (주4) 정정 후 가. 사채의 인수 [회차:104-2] 표(SK 900억, 합 3000)가 별도 위치에
        # 등장. 후자 표가 flush 안 되는 group 에 속해도 합계 검증으로 채택 가능.
        # — 1단계 신고서의 인수단 표도 사용 — '명단(이름)' 은 stage1 부터 잡고,
        #   '실적(금액)' 은 [발행조건확정] 이후에만 underwriter_alloc 에 기록(아래 분기).
        #   사용자 지시: 발행조건확정 전엔 실적 금액 비움. 명단은 stage1 부터.
        chosen_underwriters = last.underwriters
        # 검증식 후보: group 내 + same-series 외부 + 본문 전역 (dedup). 마지막 series 매핑이
        # 부정확한 경우 (CJ대한통운 (주4) 정정 후 섹션 등) 전역 후보로 정확한 표 발견 가능.
        if rec.final_amount:
            candidates = (list(last.underwriter_candidates)
                          + list(series_uw_candidates.get(series, []))
                          + list(all_uw_candidates))
            seen_ids = set()
            unique = []
            for c in candidates:
                if id(c) in seen_ids:
                    continue
                seen_ids.add(id(c))
                unique.append(c)
            if unique:
                target = rec.final_amount
                best_diff = None
                best_cand = None
                for cand in unique:
                    total = sum((_won_to_eok(u.get("amount_won", 0)) or 0) for u in cand)
                    diff = abs(total - target)
                    if best_diff is None or diff < best_diff:
                        best_diff = diff
                        best_cand = cand
                # 1억 이하 차이만 채택 (전역 검색이라도 정확 일치 요구)
                if best_cand is not None and best_diff is not None and best_diff < 1:
                    chosen_underwriters = best_cand

        # 주관사 명단은 '대표' 또는 '공동' 표시된 증권사들의 약칭 리스트.
        # '공동' 표기는 공동대표주관사 — 메리츠화재해상보험 11 후순위채 케이스.
        # '대표' 와 '공동' 이 한 표에 같이 있을 수도 있고, '공동' 만 있는 경우도 있음.
        # 인수표에 '구분' 컬럼이 없는 case (MultiIndex `('인수인','명칭')` 형태) 가
        # 단일 인수자일 때 — 한국해외인프라공사 5-2 정정후 케이스 — 그 회사가 곧 대표.
        def _is_lead_role(role: str) -> bool:
            r = (role or "").strip()
            return r in ("대표", "공동") or "대표" in r or "공동" in r

        # Lead role 보강 — 2022 공시처럼 같은 트랜치에 두 형태 (정정전 Case 1: '구분'
        # 컬럼 있음, 정정후 Case 2: MultiIndex 명칭만) 공존하는 경우. amount diff 기준
        # 으로 Case 2 가 선택되면 role 정보 손실. 같은 firm set 가진 다른 candidate
        # (Case 1) 에 role 정보 있으면 그것으로 chosen 의 role 채움.
        # 2026-05-16 추가 — LG유플러스/케이티/SK 등 2022 발행 71건 lead 누락 케이스.
        chosen_has_lead = any(_is_lead_role(u["role"]) for u in chosen_underwriters)
        if not chosen_has_lead and chosen_underwriters:
            chosen_firm_set = {u["firm"] for u in chosen_underwriters}
            # 후보 풀 — chosen 이 아닌 다른 candidates 중 firm set 일치하는 것
            other_candidates = (list(last.underwriter_candidates)
                                + list(series_uw_candidates.get(series, []))
                                + list(all_uw_candidates))
            for cand in other_candidates:
                if not cand or cand is chosen_underwriters:
                    continue
                cand_firm_set = {u["firm"] for u in cand}
                if cand_firm_set != chosen_firm_set:
                    continue
                cand_has_lead = any(_is_lead_role(u["role"]) for u in cand)
                if not cand_has_lead:
                    continue
                # firm → role 맵 (cand 에서)
                firm_to_role = {u["firm"]: u["role"] for u in cand
                                if _is_lead_role(u["role"])}
                # chosen 의 role 보강 (원본 dict 수정하지 않게 복사)
                enriched = []
                for u in chosen_underwriters:
                    new_u = dict(u)
                    if u["firm"] in firm_to_role and not _is_lead_role(u["role"]):
                        new_u["role"] = firm_to_role[u["firm"]]
                    enriched.append(new_u)
                chosen_underwriters = enriched
                break

        unique_firms = {u["firm"] for u in chosen_underwriters}
        has_any_lead = any(_is_lead_role(u["role"]) for u in chosen_underwriters)
        promote_sole_to_lead = (not has_any_lead and len(unique_firms) == 1
                                and len(chosen_underwriters) >= 1)
        for u in chosen_underwriters:
            alias = map_broker(u["firm"], mappings)
            if not alias:
                role_for_reg = "대표" if (_is_lead_role(u["role"]) or promote_sole_to_lead) else u["role"]
                alias = auto_register_broker(u["firm"], role_for_reg, mappings)
                if not alias:
                    rec.notes.append(f"미매핑 증권사 (alias 생성 실패): {u['firm']}")
                    continue
                rec.notes.append(f"[자동생성] {u['firm']} → {alias}")
            amt_eok = _won_to_eok(u["amount_won"])
            is_lead = _is_lead_role(u["role"]) or promote_sole_to_lead
            if is_lead and alias not in rec.lead_managers:
                rec.lead_managers.append(alias)
            if alias not in rec.uw_names:
                rec.uw_names.append(alias)
            # 실적(금액)은 [발행조건확정] 이후에만 기록 — stage1 에선 underwriter_alloc 비움.
            if ctx.is_final:
                rec.underwriter_alloc[alias] = rec.underwriter_alloc.get(alias, 0) + (amt_eok or 0)

        records.append(rec)

    # 수요예측 금액: 같은 base 그룹의 records 와 demand 표를 등장 순서대로 zip
    def _series_base(s: str) -> str:
        return s.split("-")[0] if "-" in s else s

    def _series_sort_key(s: str):
        parts = s.split("-")
        if all(p.isdigit() for p in parts):
            return tuple(int(p) for p in parts)
        return (s,)

    demand_by_base: dict[str, list[float]] = defaultdict(list)
    for last_seen, amount in demand_amounts_in_order:
        demand_by_base[_series_base(last_seen)].append(amount)

    records_by_base: dict[str, list[TrancheRecord]] = defaultdict(list)
    for rec in records:
        records_by_base[_series_base(rec.series)].append(rec)

    for base, rec_list in records_by_base.items():
        rec_list.sort(key=lambda r: _series_sort_key(r.series))
        demands = demand_by_base.get(base, [])
        for rec, dem in zip(rec_list, demands):
            rec.demand_amount = dem

    # 발행한도: 공시 본문 주석에서 추출 → 같은 신고서의 모든 트랜치에 동일 적용
    issue_limit_won = _extract_issue_limit_won(html_sections)
    if issue_limit_won is not None:
        eok = _won_to_eok(issue_limit_won)
        for rec in records:
            rec.issue_limit = eok

    # 공모희망금리: 정정 전 주석에서 추출 → 같은 신고서 모든 트랜치에 동일 적용
    # (트랜치별로 만기/희망금리가 다른 케이스는 향후 사용자 검증 후 보완)
    hope_rate = _extract_hope_rate(html_sections)
    if hope_rate:
        for rec in records:
            rec.rate_target = hope_rate

    # 수요금리: series 별 정정후 가산값(또는 flat) 매핑 → records 의 series 와 직접 매칭.
    # 단, 신종자본/후순위채는 [발행조건확정] 1번에 최종금리 절대값이 박혀서 마무리되므로
    # 수요금리 가산 개념이 없음 → 빈칸 유지 (사용자 지시).
    # ⚠️ 1단계 신고서 (is_final=False) 는 수요예측 전이라 rate_demand 자체가 존재할 수
    #    없는 상태. 본문에 "민평±0bp" 같은 형식 텍스트가 있어도 record 에 채우지 않음.
    if ctx.is_final:
        demand_rates = _extract_demand_rates_by_series(html_sections)
        for rec in records:
            # 수요금리 채울 조건: rate_target 에 '민평' 포함 (가산형) 만.
            # - 가산형 (예: '민평±30bp', '민평+30~+70bp') → 채움. 신종자본/후순위도 가산 구조면 채움.
            # - 직접금리 (예: '3.30~3.80%') → 빈칸 유지.
            # - rate_target 빈칸 (수요예측 없는 first-and-final 케이스, 예: 아이엠증권 4) → 빈칸 유지.
            if "민평" not in rec.rate_target:
                continue
            if rec.series in demand_rates:
                rec.rate_demand = demand_rates[rec.series]

    # 외화채(SOFR/USD): 한도/수요예측/희망금리/수요금리/최종금리 컬럼은 의미 없으니 빈칸.
    # 사용자 의도: "원화로 입력 가능한 부분만 적고 나머지는 빈칸". 메타 정보와 원화 환산
    # 권면총액(최초/최종) 은 유지.
    if _is_foreign_currency_filing(html_sections):
        for rec in records:
            rec.is_foreign = True
            rec.issue_limit = None
            rec.demand_amount = None
            rec.rate_target = ""
            rec.rate_demand = ""
            rec.rate_final = None

    # 최종금리: 현재 공시의 bond_basic 표 또는 본문 텍스트에서 series 별 절대 금리 추출.
    # 신종자본/후순위채는 보통 1번의 [발행조건확정] 공시에 이자율이 박혀 있어 이 단계로 채워짐.
    # 일반/보증은 두 번째 [발행조건확정] 공시 (기준금리확정용) 에서 채워야 해서 cmd_run 후처리.
    final_rates = _extract_rates_by_series(html_sections)
    for rec in records:
        if rec.series in final_rates:
            rec.rate_final = final_rates[rec.series]

    return records
