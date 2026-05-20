"""Layer 1 검증 룰 — 순수 Python 결정론적 룰.

각 룰은 TrancheRecord 리스트를 받아 Finding 리스트를 반환.
Severity:
  - 'hard': 산술 미일치 / 필수필드 누락 / 정해진 값 위반 → 거의 확실한 사고
  - 'soft': 이상치 / 의심 패턴 → 사용자 review 필요

룰 ID 규칙: H#### (hard) / S#### (soft) / X#### (cross-record).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime
from collections import defaultdict
import re

# Type-only import — runtime cycle 회피
try:
    from parser import TrancheRecord  # type: ignore
except Exception:
    TrancheRecord = object  # type: ignore


# ============== Finding 모델 ==============

@dataclass
class Finding:
    rule_id: str
    severity: str           # 'hard' | 'soft'
    record_key: str         # '<issuer> <series>'
    rcept_no: str
    description: str
    suggested_fix: str = ""
    metadata: dict = field(default_factory=dict)


# ============== 헬퍼 ==============

VALID_BOND_TYPES = {"무보증", "보증", "신종자본", "후순위채"}
FOREIGN_MARKERS = ("USD", "SOFR", "외화", "달러", "EUR", "JPY", "KOFR")

_SUM_TOLERANCE_EOK = 0.5  # 0.5억 = 5천만원. 인수단 합계 산정 시 반올림 오차 허용


def _key(r) -> str:
    return f"{r.issuer_alias} {r.series}"


def _series_base(s: str) -> str:
    return s.split("-")[0] if "-" in s else s


def _bp_range_from_target(target: str) -> tuple[float, float] | None:
    """rate_target 문자열에서 bp 범위 추출.

    예: '민평±30bp' → (-30, +30)
        '민평-10~+50bp' → (-10, +50)
        '국고채±50bp' → (-50, +50)
        '국고채-20~+30bp' → (-20, +30)
    매칭 실패 시 None.
    """
    if not target:
        return None
    m = re.search(r"±\s*(\d+(?:\.\d+)?)\s*bp", target)
    if m:
        n = float(m.group(1))
        return (-n, +n)
    m = re.search(r"([+-]?\d+(?:\.\d+)?)\s*~\s*([+-]?\d+(?:\.\d+)?)\s*bp", target)
    if m:
        return (float(m.group(1)), float(m.group(2)))
    return None


# ============== Hard Rules (single record) ==============

def rule_H001_first_and_final_zero_bp(r) -> list[Finding]:
    """first-and-final 케이스 (수요예측 없음) 인데 rate_demand 에 ±0bp 잔재.
    parser 가 빈 수요예측 결과 표에서 ±0bp 를 잘못 넣었던 사고.
    시그너처: rate_target='' AND rate_demand 가 정확히 '±0bp'.

    주의: rate_demand 가 실제 bp 값 (예 '+60bp', '-30bp') 인 경우는 H009 (parser
    가 hope rate 못 잡음) 로 분류. 같은 record 가 두 룰에 동시에 잡히지 않게 분리.
    """
    if r.rate_target == "" and r.rate_demand == "±0bp":
        return [Finding(
            rule_id="H001",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"rate_target 빈칸 (first-and-final) 인데 rate_demand='±0bp' 잔재",
            suggested_fix="rate_demand=''로 patch",
            metadata={"rate_target": r.rate_target, "rate_demand": r.rate_demand},
        )]
    return []


def rule_H010_finalization_missing(r) -> list[Finding]:
    """청약일이 이미 지났는데 rate_final 누락 — [발행조건확정] 처리 빠진 것 의심.

    Stage 1 (초기 신고서) 만 처리되고 Stage 2/3 ([발행조건확정]) 가 cmd_update
    에서 누락된 case (키움증권 17-1/2 류). subscription_date 가 미래면 정상 (아직
    발행 전) — 오늘 이전인 경우만 catch.

    제외 케이스:
      - 변동금리 채권 (SOFR/변동금리 연동): rate_final 자체가 본질적으로 미정.
        notes 에 marker 가 있으면 skip (롯데물산 16 SOFR FRN 류).
    """
    if r.rate_final is not None:
        return []
    if not isinstance(r.subscription_date, date):
        return []
    if r.subscription_date >= date.today():
        return []  # 아직 발행 안 됨 — 정상
    # 변동금리/SOFR 채권 제외
    notes_str = " ".join(r.notes or [])
    if any(kw in notes_str for kw in ("변동금리", "SOFR FRN", "SOFR 연동")):
        return []
    # 가산형 (민평/국고채 등 변동 기준) + demand 확정됐으면 정상.
    # rate_final 절대값은 매 영업일 민평 변동으로 미정 (제주은행 210426-03 류).
    if (r.rate_target and r.rate_demand
            and any(kw in r.rate_target
                    for kw in ("민평", "국고채", "SOFR", "KOFR", "LIBOR"))):
        return []
    return [Finding(
        rule_id="H010",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"청약일 ({r.subscription_date}) 이 이미 지났는데 rate_final 누락 — [발행조건확정] 처리 빠진 것 의심",
        suggested_fix="corp 의 [발행조건확정] 공시 fetch + parser 적용",
        metadata={"subscription_date": str(r.subscription_date)},
    )]


def rule_H009_hope_rate_missing(r) -> list[Finding]:
    """rate_target 빈칸 + rate_demand 에 실제 bp 값 → parser 가 희망금리 추출 실패.

    수요예측이 진행된 발행 (rate_demand 의 +Nbp / -Nbp / ±Nbp 가 진짜 값) 인데
    rate_target 가 빈칸 = parser 가 본문에서 공모희망금리 주석을 못 잡음.
    뉴스테이허브 / 민간임대허브 같은 REIT 의 국고채 가산형 형식이거나 새로운 포맷.
    """
    if (r.rate_target == "" and r.rate_demand and r.rate_demand != ""
            and r.rate_demand != "±0bp"):
        # 실제 bp 값 패턴 매칭
        import re as _re
        if _re.match(r"[+-]?\d+(?:\.\d+)?\s*~?\s*[+-]?\d*(?:\.\d+)?\s*bp", r.rate_demand) \
                or _re.match(r"±\d+(?:\.\d+)?\s*bp", r.rate_demand):
            return [Finding(
                rule_id="H009",
                severity="hard",
                record_key=_key(r), rcept_no=r.rcept_no,
                description=f"rate_target 빈칸인데 rate_demand={r.rate_demand!r} (실제 수요예측 결과). parser 가 공모희망금리 추출 실패",
                suggested_fix="DART 본문 재조회 + parser 보강 (국고채 가산형 등 새 포맷 인식)",
                metadata={"rate_demand": r.rate_demand},
            )]
    return []


def rule_H002_rate_target_set_but_demand_missing(r) -> list[Finding]:
    """가산형 수요예측 대상인데 rate_demand 누락 + rate_final 설정.

    가산형 (민평/국고채/SOFR 기준 + ±Nbp): rate_demand 가 확정 가산금리 (예 '+30bp')
    로 채워져야 함. 비어있으면 추출 실패.

    직접금리형 (예 '4.20~4.80%') 는 제외: 수요예측 결과가 rate_final 에 직접 반영되며,
    rate_demand 라는 별도 가산금리 개념이 없음 (신종자본/후순위채/캐피탈 등 흔함).

    제외 케이스:
      - rate_target='' (first-and-final)
      - rate_target 가 직접금리 범위 ('%' 만 포함)
    """
    if not (r.rate_target and r.rate_final is not None and not r.rate_demand):
        return []
    rt = r.rate_target
    # 가산형 기준 키워드 확인
    is_spread_based = ("민평" in rt or "국고채" in rt or "SOFR" in rt
                       or "KOFR" in rt or "LIBOR" in rt)
    if not is_spread_based:
        return []  # 직접금리 형은 정상
    # 후순위채 + demand_amount=0 (수요예측 없음 명시) = first-and-final 변동금리,
    # 수요예측 자체 안 했으므로 rate_demand 누락 정상 (한화투자증권 28 류).
    if r.bond_type == "후순위채" and r.demand_amount == 0:
        return []
    return [Finding(
        rule_id="H002",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"가산형 수요예측 대상 (rate_target={rt!r}) 인데 rate_demand 누락 (rate_final={r.rate_final} 설정됨)",
        suggested_fix="DART 본문 재조회 + 수요예측 결과 표 추출 보강",
        metadata={"rate_target": rt, "rate_final": r.rate_final},
    )]


def rule_H003_final_vs_underwriter_sum(r) -> list[Finding]:
    """final_amount = Σ(인수단 인수금액). 키움에프앤아이 4 사고 catch."""
    if r.final_amount is None or not r.underwriter_alloc:
        return []
    s = sum(r.underwriter_alloc.values())
    if abs(s - r.final_amount) > _SUM_TOLERANCE_EOK:
        return [Finding(
            rule_id="H003",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"final_amount={r.final_amount} 와 Σ(인수단)={s} 불일치 (Δ={s-r.final_amount:+.2f}억)",
            suggested_fix="인수단 표 재추출 또는 final_amount 재확인",
            metadata={"final_amount": r.final_amount, "underwriter_sum": s},
        )]
    return []


def rule_H004_final_amount_missing_when_finalized(r) -> list[Finding]:
    """rate_final 채워졌으면 final_amount 도 채워져야. 예스코 28 정정사유 컬럼 사고 류."""
    if r.rate_final is not None and r.final_amount is None:
        return [Finding(
            rule_id="H004",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description="rate_final 설정됐는데 final_amount 누락",
            suggested_fix="[발행조건확정] 본문 또는 [정정] 신고서 본문에서 최종발행액 재추출",
            metadata={"rate_final": r.rate_final},
        )]
    return []


def rule_H005_lead_managers_empty_when_finalized(r) -> list[Finding]:
    """rate_final 채워졌으면 lead_managers 비어있으면 안 됨.

    예외 (직접공모): underwriter_alloc 도 비어있으면 = "직접공모" 케이스로 추정.
    주관사/인수사 자체가 없는 발행이라 lead_managers 비어있는 게 정상.
    (예: 아이엠증권 4 후순위채 — 신고서에 '인수(주선) 여부: 직접공모' 표기)
    """
    if r.rate_final is None:
        return []
    if r.lead_managers:
        return []
    # 직접공모 추정: 인수단도 비어있음 → 정상
    if not r.underwriter_alloc:
        return []
    # 인수단은 있는데 대표만 비어있음 → parser 가 '대표/공동' 표기 못 잡은 케이스
    return [Finding(
        rule_id="H005",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"rate_final 설정됐고 인수단 {len(r.underwriter_alloc)}개 있는데 lead_managers 비어있음",
        suggested_fix="DART 본문의 인수(주선)인 표 '대표/공동' 표기 재추출",
        metadata={"rate_final": r.rate_final,
                  "underwriter_count": len(r.underwriter_alloc)},
    )]


# H012 (3-way 합산 일치) 룰 폐기 (2026-05-17):
# - 사용자 케이스 (HD현대오일뱅크 125-3 류): 대표주관사 KB가 특정 트랜치에는 인수 없이
#   주관만 함. 이 경우 record 의 lead=[]/alloc 에 KB 없음 = 정상.
# - 주관사 실적 산식 결과 검증은 의미 없음 — H003 (final = Σ(인수단)) 만 유효.


def _is_securities_firm_self_issue(r) -> bool:
    """발행사 자체가 증권사 → 자체발행 (직접공모) 가능성 높음.

    mappings.json 의 brokers_formal_to_alias 의 formal 이름과 issuer_alias 매칭.
    """
    import json as _json
    from pathlib import Path as _Path
    try:
        mp = _json.loads((_Path(__file__).resolve().parent / "mappings.json")
                         .read_text(encoding="utf-8"))
    except Exception:
        return False
    formals = set(mp.get("brokers_formal_to_alias", {}).keys())
    # issuer_alias 가 formal 이름이거나 alias 표기로 들어있으면 증권사
    iss = (r.issuer_alias or "").strip()
    if iss in formals:
        return True
    # alias 표기로 단축돼 들어온 경우 (예: '메리츠증권' 대신 '메리츠')
    aliases = set(mp.get("brokers_formal_to_alias", {}).values())
    if iss in aliases:
        return True
    # '증권' 어미만 보고 추정 — 보수적 fallback
    if iss.endswith("증권"):
        return True
    return False


def rule_H013_demand_rate_set_but_amount_missing(r) -> list[Finding]:
    """수요예측 진행됐는데 demand_amount 누락.

    수요예측이 진행됐다는 판단 근거:
      1) rate_demand 가 가산 형태 (+/-/±Nbp) — 가산형 수요예측 결과
      2) rate_target 채워짐 (가산형 '민평±Nbp' 또는 직접금리형 'X.XX~Y.YY%') —
         수요예측 안내가 있었다는 뜻
      3) rate_final 채워짐 + bond_type 이 'CP/단기사채' 외 (수요예측 거치는 일반/
         신종자본/후순위 모두 대상)

    예외:
      - first-and-final 케이스 (target='' AND rate_final 있음)
      - 변동금리 (변동금리/SOFR FRN/SOFR 연동)
    """
    if r.demand_amount is not None:
        return []
    if not (r.rate_demand or r.rate_target):
        return []
    # 변동금리 제외
    notes_str = " ".join(r.notes or [])
    if any(kw in notes_str for kw in ("변동금리", "SOFR FRN", "SOFR 연동")):
        return []
    # 수요예측 진행 안 함 manual marker — demand_amount 비움이 정상
    # (수요예측 없는 신종자본/후순위 사모 발행. 0 과 다름: 0=참여 0건 vs 비움=진행 안 함)
    if "수요예측 진행 안 함" in notes_str or "수요예측 표 없음" in notes_str:
        return []
    # 미래 청약일 제외 (아직 발행 전 — 수요예측도 미진행 가능)
    if isinstance(r.subscription_date, date) and r.subscription_date > date.today():
        return []
    return [Finding(
        rule_id="H013",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"수요예측 진행됨 (target={r.rate_target!r}, demand={r.rate_demand!r}) "
                    f"인데 demand_amount 누락",
        suggested_fix="DART 본문의 수요예측 참여내역 표 재추출. "
                      "본문에 '수요예측 참여사항 없음' 명시되면 demand_amount=0",
        metadata={"rate_demand": r.rate_demand, "rate_target": r.rate_target},
    )]


def rule_H011_underwritten_but_data_missing(r) -> list[Finding]:
    """수요예측 진행됐는데 (demand_amount set) 인수단/희망금리 누락.

    수요예측이 있었다는 건 인수단도 있다는 뜻. alloc 비어있거나 target 비어있으면
    parser 가 추출 실패 (예: SK브로드밴드 52 — 두 번째 [발행조건확정] 만 처리되고
    첫 번째 가 누락된 케이스).

    제외:
      - 증권사 자체발행 (alloc 비어있어도 정상)
      - 직접금리형 (target='X.XX~Y.YY%' 형태) — rate_demand 라는 별도 가산금리
        개념 없음 (신종자본/후순위채 — 은행/지주/보험사 자체발행 다수)
    """
    if not r.demand_amount:
        return []
    if _is_securities_firm_self_issue(r):
        return []
    # 직접금리형 (rate_target 이 '%' 만 포함, '민평'/'국고채'/'SOFR' 등 가산 기준 없음) →
    # rate_demand 누락은 정상.
    is_direct_pct = (r.rate_target
                     and "%" in r.rate_target
                     and not any(kw in r.rate_target
                                 for kw in ("민평", "국고채", "SOFR", "KOFR", "LIBOR")))
    missing = []
    if not r.underwriter_alloc:
        missing.append("underwriter_alloc")
    if not r.rate_target:
        missing.append("rate_target")
    if not r.rate_demand and not is_direct_pct:
        missing.append("rate_demand")
    if not missing:
        return []
    return [Finding(
        rule_id="H011",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"수요예측 진행됨 (demand_amount={r.demand_amount}) 인데 {', '.join(missing)} 누락",
        suggested_fix="corp 의 초기/정정 신고서까지 fetch + 인수단/희망금리 재추출",
        metadata={"missing_fields": missing, "demand_amount": r.demand_amount},
    )]


def rule_H015_future_date_premature_data(r) -> list[Finding]:
    """미래 청약일 (아직 [발행조건확정] 전) 인데 인수/주관/수요금리가 채워진 케이스.

    1단계 신고서 (증권신고서(채무증권)) 만 올라온 상태는 수요예측 전이라:
      - 수요금리 (rate_demand): 존재 불가
      - 인수금액/주관사 (underwriter_alloc, lead_managers): 1단계 신고서의 인수 표는
        "예정" 정보일 뿐. 청약 후 정정 신고서/[발행조건확정] 에서 확정됨.

    이런 데이터가 채워져 있으면 이전 버전 parser/handler 의 잔재. 비워야 정확.
    """
    if not isinstance(r.subscription_date, date):
        return []
    if r.subscription_date <= date.today():
        return []
    # 발행조건확정 후 (final_amount 있음) 라면 정상 — 수요예측 끝났으니 인수정보 있어야.
    if r.final_amount is not None:
        return []
    issues = []
    if r.rate_demand:
        issues.append(f"rate_demand={r.rate_demand!r}")
    if r.underwriter_alloc:
        issues.append(f"underwriter_alloc={len(r.underwriter_alloc)}개")
    if r.lead_managers:
        issues.append(f"lead_managers={r.lead_managers}")
    if not issues:
        return []
    return [Finding(
        rule_id="H015",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"미래 청약일 ({r.subscription_date}) 인데 수요예측 전 미존재 데이터: "
                    + ", ".join(issues),
        suggested_fix="rate_demand, underwriter_alloc, lead_managers 모두 비움",
        metadata={"subscription_date": str(r.subscription_date)},
    )]


def rule_H014_credit_rating_missing(r) -> list[Finding]:
    """신용등급 빈 칸 — 사용자 합의 룰: 어떤 경우에도 빈 칸 불가.

    parser 가 발행조건확정 본문에서 직접 추출 실패한 케이스 (e.g. 후순위채 류
    또는 표 형식 변형). handler 가 부모 증권신고서 fetch 해서 자동 보완.
    """
    if r.credit_rating:
        return []
    return [Finding(
        rule_id="H014",
        severity="hard",
        record_key=_key(r), rcept_no=r.rcept_no,
        description=f"신용등급 빈 칸 (사용자 룰 위반 — 무조건 채워야 함)",
        suggested_fix="발행조건확정 본문 또는 부모 증권신고서(채무증권)에서 재추출",
        metadata={"corp_code": r.corp_code,
                  "subscription_date": str(r.subscription_date) if r.subscription_date else ""},
    )]


def rule_H006_subscription_date_missing_when_finalized(r) -> list[Finding]:
    """rate_final 채워졌으면 subscription_date 도 있어야 함. 없으면 기타 탭으로 빠짐."""
    if r.rate_final is not None and r.subscription_date is None:
        return [Finding(
            rule_id="H006",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description="rate_final 설정됐는데 subscription_date 누락 → 기타 탭으로 분류됨",
            suggested_fix="청약기일 표 재추출",
            metadata={"rate_final": r.rate_final},
        )]
    return []


def rule_H007_bond_type_invalid(r) -> list[Finding]:
    """bond_type 정상 범주 (일반/보증/신종자본/후순위채) 외. CB/EB/BW 가 흘러들어왔다면 catch."""
    if r.bond_type and r.bond_type not in VALID_BOND_TYPES:
        return [Finding(
            rule_id="H007",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"bond_type={r.bond_type!r} 가 정상 범주 (일반/보증/신종자본/후순위채) 외",
            suggested_fix="parser exclude 키워드 확인. CB/EB/BW/CP 면 record 제거",
            metadata={"bond_type": r.bond_type},
        )]
    return []


def rule_H008_date_ordering(r) -> list[Finding]:
    """subscription_date ≤ maturity (date 타입일 때만)."""
    if (isinstance(r.subscription_date, date)
            and isinstance(r.maturity, date)
            and r.subscription_date > r.maturity):
        return [Finding(
            rule_id="H008",
            severity="hard",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"subscription_date={r.subscription_date} > maturity={r.maturity}",
            suggested_fix="청약일/만기일 추출 로직 확인",
            metadata={"subscription_date": str(r.subscription_date),
                      "maturity": str(r.maturity)},
        )]
    return []


# ============== Soft Rules (single record) ==============

def rule_S001_phantom_record(r) -> list[Finding]:
    """Phantom record 의심: 데이터가 통째로 비어있음.
    (lead_managers=[] AND underwriter_alloc={} AND subscription_date=None
     AND final_amount=None) → parser 가 historical 사채 참조 등에서 잘못 추출.
    대성에너지 6 case 의 시그너처.
    """
    if (not r.lead_managers and not r.underwriter_alloc
            and r.subscription_date is None and r.final_amount is None):
        return [Finding(
            rule_id="S001",
            severity="soft",
            record_key=_key(r), rcept_no=r.rcept_no,
            description="lead_managers/underwriter/subscription_date/final_amount 모두 비어있음 — phantom record 의심",
            suggested_fix="해당 rcept_no 본문 확인. historical 사채 참조 (재무제표 주석 등) 에서 잘못 추출된 phantom 일 가능성. record 제거 검토.",
            metadata={},
        )]
    return []


def rule_S002_unusual_rate_final(r) -> list[Finding]:
    """rate_final 이 일반 회사채 정상 범위 (1.0 ~ 15.0%) 외."""
    if r.rate_final is not None and (r.rate_final < 1.0 or r.rate_final > 15.0):
        return [Finding(
            rule_id="S002",
            severity="soft",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"rate_final={r.rate_final}% — 일반 회사채 범위 (1~15%) 외",
            metadata={"rate_final": r.rate_final},
        )]
    return []


def rule_S003_unusual_maturity_short(r) -> list[Finding]:
    """maturity - subscription_date < 360 일 → 단기사채 의심.
    1년 만기 (364/365일) 발행은 정상 (SK리츠 등). threshold 360 일로 완화.
    """
    if not isinstance(r.subscription_date, date) or not isinstance(r.maturity, date):
        return []
    days = (r.maturity - r.subscription_date).days
    if days < 360:
        return [Finding(
            rule_id="S003",
            severity="soft",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"만기 - 청약일 = {days}일 (<360일). 단기사채/특수 발행 의심",
            metadata={"days_to_maturity": days},
        )]
    return []


def rule_S004_is_foreign_no_marker(r) -> list[Finding]:
    """is_foreign=True 인데 notes 에 외화 marker 없음. 5/12 이전 is_foreign 잔재 catch."""
    if not r.is_foreign:
        return []
    notes_str = " ".join(r.notes or [])
    has_marker = any(m in notes_str.upper() for m in (mk.upper() for mk in FOREIGN_MARKERS))
    if not has_marker:
        return [Finding(
            rule_id="S004",
            severity="soft",
            record_key=_key(r), rcept_no=r.rcept_no,
            description="is_foreign=True 인데 notes 에 외화 (USD/SOFR/외화 등) marker 없음. 잘못된 is_foreign 잔재 의심",
            suggested_fix="is_foreign=False 로 patch 검토. series_total 자동 재계산됨.",
            metadata={"is_foreign": True, "notes": r.notes},
        )]
    return []


def rule_S005_rate_demand_outside_target(r) -> list[Finding]:
    """rate_target 의 bp 범위와 rate_demand 가 어긋남."""
    if not r.rate_demand or not r.rate_target:
        return []
    target_range = _bp_range_from_target(r.rate_target)
    demand_range = _bp_range_from_target(r.rate_demand)
    if not target_range or not demand_range:
        return []
    lo_t, hi_t = target_range
    lo_d, hi_d = demand_range
    if lo_d < lo_t - 1 or hi_d > hi_t + 1:
        return [Finding(
            rule_id="S005",
            severity="soft",
            record_key=_key(r), rcept_no=r.rcept_no,
            description=f"rate_demand={r.rate_demand} 가 rate_target={r.rate_target} 범위를 벗어남",
            metadata={"rate_target": r.rate_target, "rate_demand": r.rate_demand},
        )]
    return []


# ============== Cross-record rules (batch) ==============

def rule_X001_multi_tranche_series_total(records) -> list[Finding]:
    """series_total = Σ(같은 발행 그룹의 tranche.final_amount).

    그룹 키: (issuer, series_base, subscription_date). 같은 청약일로 묶인 트랜치만
    하나의 발행으로 봄. rcept_no 매핑 버그와 무관하게 안정적인 그룹화.
    (대신증권 24-1/2 는 2024-04-29 청약, 24-3 은 2024-10-18 청약 → 별도 그룹.)

    - X001a: 그룹의 모든 final 있는데 series_total 누락
    - X001b: 그룹의 series_total 과 Σ(final) 가 1억 이상 차이 (single tranche 도 검증)
    """
    findings = []
    groups = defaultdict(list)
    for r in records:
        if not r.issuer_alias or not r.series or r.subscription_date is None:
            continue
        groups[(r.issuer_alias, _series_base(r.series), r.subscription_date)].append(r)

    for key, group in groups.items():
        # 모든 record 의 final_amount 가 있을 때만 검증
        finals = [r.final_amount for r in group]
        if any(f is None for f in finals):
            continue
        actual_sum = sum(finals)
        for r in group:
            if r.series_total is None:
                # multi-tranche 일 때만 X001a (single tranche 에서 series_total=None 은 정상)
                if len(group) >= 2:
                    findings.append(Finding(
                        rule_id="X001a",
                        severity="hard",
                        record_key=_key(r), rcept_no=r.rcept_no,
                        description=f"multi-tranche (총 {len(group)}회차) 인데 series_total 누락. Σ(final)={actual_sum}",
                        suggested_fix=f"series_total={actual_sum} 로 patch",
                        metadata={"tranches": len(group), "actual_sum": actual_sum},
                    ))
            elif abs(r.series_total - actual_sum) > _SUM_TOLERANCE_EOK:
                findings.append(Finding(
                    rule_id="X001b",
                    severity="hard",
                    record_key=_key(r), rcept_no=r.rcept_no,
                    description=f"series_total={r.series_total} 와 Σ(같은 발행 tranche.final)={actual_sum} 불일치 (Δ={actual_sum-r.series_total:+.2f})",
                    suggested_fix=f"series_total={actual_sum} 로 patch (같은 rcept_no + series_base 의 final 합산)",
                    metadata={"series_total": r.series_total, "actual_sum": actual_sum,
                              "group_size": len(group)},
                ))
    return findings


def rule_X005_series_total_exceeds_issue_limit(records) -> list[Finding]:
    """같은 발행 그룹의 series_total > issue_limit → 불가능.

    그룹 키: (issuer, series_base, subscription_date). X001 와 동일.
    발행한도 (issue_limit) 는 청약일 묶음으로 발행 가능한 최대 한도. series_total
    (실제 발행액 합산) 이 한도를 넘어가는 건 데이터 오류.
    """
    findings = []
    groups = defaultdict(list)
    for r in records:
        if not r.issuer_alias or not r.series or r.subscription_date is None:
            continue
        groups[(r.issuer_alias, _series_base(r.series), r.subscription_date)].append(r)

    for key, group in groups.items():
        # 그룹 내 issue_limit 가 일관되게 있는 경우만 (보통 multi-tranche 모두 같은 한도)
        limits = [r.issue_limit for r in group if r.issue_limit is not None]
        totals = [r.series_total for r in group if r.series_total is not None]
        if not limits or not totals:
            continue
        # 그룹 대표값
        limit = max(limits)  # 보수적
        total = max(totals)
        if total > limit + _SUM_TOLERANCE_EOK:
            for r in group:
                findings.append(Finding(
                    rule_id="X005",
                    severity="hard",
                    record_key=_key(r), rcept_no=r.rcept_no,
                    description=f"series_total={total} > issue_limit={limit} (발행한도 초과 = 데이터 오류)",
                    suggested_fix="같은 청약일 그룹의 Σ(final) 재계산하여 series_total patch",
                    metadata={"series_total": total, "issue_limit": limit},
                ))
    return findings


def rule_X002_multi_tranche_missing_issue_limit(records) -> list[Finding]:
    """[DEPRECATED] multi-tranche 인데 issue_limit 누락.

    발행한도가 실제로 명기되지 않는 발행이 흔함 (한국자산신탁 8, 한국토지신탁 45 류).
    Parser 가 추출 못한 케이스와 실제 명기 없는 케이스를 구분 불가. false positive
    과다로 룰 제거.

    Issue_limit 검증은 X005 (한도 초과) 로 충분.
    """
    return []


def rule_X003_same_corp_inconsistent_finalization(records) -> list[Finding]:
    """같은 corp_code 의 인접 발행건들 중 일부만 rate_final 채워졌고 일부 누락.

    분기 경계 사고 (넥센타이어 59 등) catch.

    제외:
      - 청약일이 미래 (오늘 이후) 인 record — 아직 발행 전이므로 rate_final 누락 정상.
      - 가산형 (민평/국고채 등) + demand 확정: rate_final 절대값 미정 정상 (제주은행 210426-03 류).
    """
    findings = []
    today = date.today()
    by_corp = defaultdict(list)
    for r in records:
        if r.corp_code:
            by_corp[r.corp_code].append(r)

    def _is_spread_form(r):
        return (r.rate_target and r.rate_demand
                and any(kw in r.rate_target
                        for kw in ("민평", "국고채", "SOFR", "KOFR", "LIBOR")))

    for corp, group in by_corp.items():
        if len(group) < 2:
            continue
        # rate_final 채워진 / 빈 갯수
        finalized = [r for r in group if r.rate_final is not None]
        # 미래 청약일 + 가산형 제외
        unfinalized = [r for r in group
                       if r.rate_final is None
                       and (not isinstance(r.subscription_date, date)
                            or r.subscription_date <= today)
                       and not _is_spread_form(r)]
        # 양쪽 다 있고, 미완료 비율이 작으면 (다수가 완료) suspicious
        if finalized and unfinalized and len(finalized) >= len(unfinalized):
            for r in unfinalized:
                findings.append(Finding(
                    rule_id="X003",
                    severity="soft",
                    record_key=_key(r), rcept_no=r.rcept_no,
                    description=(f"같은 발행사의 다른 회차 ({len(finalized)}건) 는 rate_final 설정됐는데 "
                                 f"이 회차만 누락. 분기 경계 처리 누락 의심"),
                    suggested_fix="cmd_update 후처리 분기 경계 보강 확인",
                    metadata={"corp_code": corp,
                              "finalized_siblings": len(finalized),
                              "unfinalized_siblings": len(unfinalized)},
                ))
    return findings


def rule_X004_duplicate_records(records) -> list[Finding]:
    """같은 (issuer, series) 중복 record 검출."""
    findings = []
    seen = defaultdict(list)
    for i, r in enumerate(records):
        seen[(r.issuer_alias, r.series)].append((i, r))
    for key, items in seen.items():
        if len(items) > 1:
            for i, r in items:
                findings.append(Finding(
                    rule_id="X004",
                    severity="hard",
                    record_key=_key(r), rcept_no=r.rcept_no,
                    description=f"중복 record: ({r.issuer_alias} {r.series}) 가 {len(items)}회 존재",
                    metadata={"count": len(items)},
                ))
    return findings


# ============== 룰 디스패처 ==============

SINGLE_RECORD_RULES = [
    rule_H001_first_and_final_zero_bp,
    rule_H002_rate_target_set_but_demand_missing,
    rule_H003_final_vs_underwriter_sum,
    rule_H004_final_amount_missing_when_finalized,
    rule_H005_lead_managers_empty_when_finalized,
    rule_H006_subscription_date_missing_when_finalized,
    rule_H007_bond_type_invalid,
    rule_H008_date_ordering,
    rule_H009_hope_rate_missing,
    rule_H010_finalization_missing,
    rule_H011_underwritten_but_data_missing,
    rule_H013_demand_rate_set_but_amount_missing,
    rule_H014_credit_rating_missing,
    rule_H015_future_date_premature_data,
    rule_S001_phantom_record,
    rule_S002_unusual_rate_final,
    rule_S003_unusual_maturity_short,
    rule_S004_is_foreign_no_marker,
    rule_S005_rate_demand_outside_target,
]

BATCH_RULES = [
    rule_X001_multi_tranche_series_total,
    rule_X002_multi_tranche_missing_issue_limit,
    rule_X003_same_corp_inconsistent_finalization,
    rule_X004_duplicate_records,
    rule_X005_series_total_exceeds_issue_limit,
]


def run_all(records: list) -> list[Finding]:
    """모든 룰 실행 후 findings 리스트 반환."""
    findings: list[Finding] = []
    for r in records:
        for rule in SINGLE_RECORD_RULES:
            findings.extend(rule(r))
    for rule in BATCH_RULES:
        findings.extend(rule(records))

    # H005 후처리 — sibling tranche 의 lead 가 본 record alloc 에 없으면
    # "lead 정상 없음" 으로 catch 제외. multi-tranche 발행에서 대표주관사가 일부
    # 트랜치만 인수하는 패턴 (HD현대오일뱅크 125-3 류).
    findings = _filter_h005_sibling_lead_absent(findings, records)
    return findings


def _filter_h005_sibling_lead_absent(findings: list, records: list) -> list:
    """H005 finding 중 sibling tranche 의 lead 가 본 record alloc 에 없으면 제거."""
    # (issuer, series_base) → list[record]
    by_group = defaultdict(list)
    for r in records:
        base = r.series.split("-")[0] if "-" in r.series else r.series
        by_group[(r.issuer_alias, base)].append(r)

    # record_key → record (for finding lookup)
    by_rec_key = {_key(r): r for r in records}

    out = []
    for f in findings:
        if f.rule_id != "H005":
            out.append(f)
            continue
        r = by_rec_key.get(f.record_key)
        if r is None:
            out.append(f)
            continue
        base = r.series.split("-")[0] if "-" in r.series else r.series
        siblings = [s for s in by_group[(r.issuer_alias, base)]
                    if s.series != r.series]
        if not siblings:
            out.append(f)
            continue
        # sibling 들의 lead union
        sibling_leads = set()
        for s in siblings:
            sibling_leads.update(s.lead_managers)
        if not sibling_leads:
            out.append(f)
            continue
        # sibling lead 중 본 record alloc 에 있는 게 있으면 → 진짜 lead 누락
        # 하나도 없으면 → 본 트랜치는 sibling lead 가 인수 안 함, lead=[] 정상
        if any(l in r.underwriter_alloc for l in sibling_leads):
            out.append(f)
        # else: skip — 정상 케이스
    return out
