"""Layer 1 finding 별 auto-fix 전략 + 적용 함수.

전략 분류:
  - 'patch':   record 의 필드 직접 수정 (DART 재조회 불필요, 고신뢰도)
  - 'refetch': 해당 record 의 DART 본문 만 fetch 해서 필요한 필드 재추출 (target fetch)
  - 'manual':  사용자 판단 필요 (자동 처리 위험)

시나리오 A+ 핵심:
  refetch 액션이 단순 flag 가 아니라 실제 fetch → parser 재추출 → 필드 update.
  list_filings 전체 호출 없이 finding 된 그 record 의 rcept_no 만 핀포인트 처리.

호출 패턴:
  patched, fetch_patched, manual, failed = apply_auto_fixes(records, findings, fetch_enabled=True)
  → records 가 in-place 수정됨. caller 가 excel_writer.write() 로 저장.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date, timedelta
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validator_rules import Finding, _series_base  # type: ignore
import dart_client  # type: ignore
import parser as dart_parser  # type: ignore


# rule_id → action
AUTO_FIX_STRATEGIES: dict[str, str] = {
    # 직접 patch (고신뢰도, 명확한 잔재 패턴)
    "H001": "patch",     # rate_target='' AND rate_demand!='' → rate_demand=''
    "S004": "patch",     # is_foreign=True AND no foreign marker → is_foreign=False
    "X001a": "patch",    # multi-tranche series_total 누락 → Σ(final)
    "X001b": "patch",    # multi-tranche series_total 불일치 → Σ(final)

    # DART 본문 재조회 필요 (현재 데이터로는 정답 모름)
    "H002": "refetch",   # 수요금리 누락 → 본문에서 수요예측 결과 표 재추출
    "H004": "refetch",   # final_amount 누락 — 본문 fallback regex 로 시도
    "H005": "refetch",   # lead_managers 누락 → 인수단 표 재추출
    "H006": "refetch",   # subscription_date 누락 → 청약기일 재추출
    "H009": "refetch",   # 공모희망금리 추출 실패 → parser 보강 + 재조회
    "H010": "refetch",   # [발행조건확정] 처리 누락 — parse_filing 으로 전체 보강 (키움증권 17 류)
    "X002": "refetch",   # multi-tranche issue_limit 누락
    "X003": "refetch",   # 같은 corp 일부만 rate_final 없음 (분기 경계 누락 가능)
    "X005": "patch",     # series_total > issue_limit → Σ(final) 재계산
    "H011": "refetch",   # 수요예측 진행됐는데 alloc/target/demand 누락 — corp 모든 filings 종합
    "H013": "refetch",   # rate_demand 가산 형태인데 demand_amount 누락 — 같은 handler
    "H003": "refetch",   # final_amount ≠ Σ(인수단) — 정정 후 표 누락, corp filings 재탐색
    "H014": "refetch",   # 신용등급 빈 칸 — 본문/부모 신고서에서 inline 추출
    "H015": "patch",     # 미래 청약일 + 수요예측 전 데이터 — 직접 비움

    # 사용자 판단 필요
    "H007": "manual",    # bond_type 무효 — record 제거? 분류 수정?
    "H008": "manual",    # 날짜 순서 — parser 버그 가능, 진단 필요
    "S001": "manual",    # phantom record — 진짜 phantom 인지 확인 후 제거
    "S002": "refetch",   # rate_final 이상치 — rcept_no 매핑 버그 잔재 케이스 다수 (SK 314-2 류).
                          # subscription_date 근처 corp 의 [발행조건확정] 본문 시도해서 정확한 값 복원.
    "S003": "manual",    # 단기 만기 — 정상 발행 가능
    "S005": "manual",    # rate_demand vs target 범위 — 미묘
    "X004": "manual",    # 중복 record — 어느 것을 keep?
}


def _can_set_demand_rate(r) -> bool:
    """rate_target 이 직접금리형 ('X.XX~Y.YY%' 만, 가산 키워드 없음) 이면
    rate_demand 세팅 안 함 (의미 없음 + parser false match 방지).

    가산 키워드 없는 % 형식 = 신종자본/후순위 직접금리형 — 수요예측 결과가
    rate_final 에 직접 반영, rate_demand 개념 없음.
    """
    tgt = r.rate_target
    if not tgt:
        return True  # target 없으면 (가산형 추출 전) 허용
    SPREAD_KW = ("민평", "국고채", "SOFR", "KOFR", "LIBOR")
    if "%" in tgt and not any(kw in tgt for kw in SPREAD_KW):
        return False  # 직접금리형 — skip
    return True


def _find_record(records, f: Finding):
    """(record_key, rcept_no) 로 record 검색. 동일 키 + 동일 rcept_no 는 unique 가정."""
    for r in records:
        rk = f"{r.issuer_alias} {r.series}"
        if rk == f.record_key and r.rcept_no == f.rcept_no:
            return r
    return None


def _compute_series_total(records, target) -> float | None:
    """target record 와 같은 (issuer, series_base, subscription_date) 의 final_amount 합산.

    그룹 키 변경 (rcept_no → subscription_date): rcept_no 매핑 버그와 무관하게
    안정적. 청약일이 같은 트랜치만 한 묶음으로 봄.
    """
    if target.subscription_date is None:
        return None
    base = _series_base(target.series)
    siblings = [r for r in records
                if r.issuer_alias == target.issuer_alias
                and _series_base(r.series) == base
                and r.subscription_date == target.subscription_date
                and r.final_amount is not None]
    if not siblings:
        return None
    return sum(r.final_amount for r in siblings)


def _patch_h001(records, f: Finding) -> bool:
    """rate_target='' AND rate_demand!='' → rate_demand=''."""
    r = _find_record(records, f)
    if not r:
        return False
    r.rate_demand = ""
    return True


def _patch_s004(records, f: Finding) -> bool:
    """is_foreign=True AND no foreign marker → is_foreign=False."""
    r = _find_record(records, f)
    if not r:
        return False
    r.is_foreign = False
    return True


def _patch_x001(records, f: Finding) -> bool:
    """series_total ← Σ(같은 issuer + series_base + subscription_date 의 final_amount)."""
    r = _find_record(records, f)
    if not r:
        return False
    total = _compute_series_total(records, r)
    if total is None:
        return False
    # 같은 그룹 모든 record 의 series_total 동기화
    base = _series_base(r.series)
    sub = r.subscription_date
    for x in records:
        if (x.issuer_alias == r.issuer_alias
                and _series_base(x.series) == base
                and x.subscription_date == sub):
            x.series_total = total
    return True


def _patch_h015(records, f: Finding) -> bool:
    """H015: 미래 청약일인데 수요예측 전 미존재 데이터 — 비움."""
    r = _find_record(records, f)
    if not r:
        return False
    changed = False
    if r.rate_demand:
        r.rate_demand = ""
        changed = True
    if r.underwriter_alloc:
        r.underwriter_alloc = {}
        changed = True
    if r.lead_managers:
        r.lead_managers = []
        changed = True
    if changed:
        r.notes.append("[H015] 미래 청약일 — 수요예측 전 미존재 데이터 비움")
    return changed


PATCH_HANDLERS = {
    "H001": _patch_h001,
    "S004": _patch_s004,
    "X001a": _patch_x001,
    "X001b": _patch_x001,
    "X005": _patch_x001,   # 한도 초과는 series_total 재계산으로 해결
    "H015": _patch_h015,   # 미래 청약일 — rate_demand/alloc/leads 비움
}


# ============== Target Fetch (시나리오 A+) ==============

class FetchContext:
    """validator run 안에서 DART fetch 중복 방지 캐시."""
    def __init__(self):
        # cache key = (rcept_no, predicate_name). predicate 별 별도 캐시.
        self.sections_cache: dict[tuple, dict] = {}
        self.filings_cache: dict[tuple, list] = {}    # (start, end) → filings

    def fetch_document(self, rcept_no: str, predicate=None, predicate_name=""):
        """predicate 지정 시 매칭 섹션만 fetch (DART 부하 감소).

        predicate_name: cache 구분용 라벨 (같은 rcept 라도 predicate 다르면 별도 cache).
        """
        key = (rcept_no, predicate_name)
        if key not in self.sections_cache:
            try:
                self.sections_cache[key] = dart_client.fetch_full_document(
                    rcept_no, title_predicate=predicate)
            except Exception:
                self.sections_cache[key] = None
        return self.sections_cache[key]

    def list_filings_for_corp(self, corp_name: str, center: date,
                               window_days: int = 60,
                               corp_code: str = ""):
        """corp 의 [발행조건확정] (is_final) filings 만 반환.

        corp_code 지정 시 해당 corp 만 (페이지/응답 ↓).
        """
        start = center - timedelta(days=window_days)
        end = center + timedelta(days=window_days)
        key = (start, end, corp_code)
        if key not in self.filings_cache:
            try:
                self.filings_cache[key] = dart_client.list_filings(
                    start, end, corp_code=corp_code)
            except Exception:
                self.filings_cache[key] = []
        return [f for f in self.filings_cache[key]
                if f.corp_name == corp_name and f.is_final]

    def list_all_filings_for_corp(self, corp_name: str, center: date,
                                    window_days: int = 60,
                                    corp_code: str = ""):
        """corp 의 모든 filings (initial + final + 정정) 반환.

        hope rate 추출 시 initial 신고서를 봐야 하는 케이스 (주택도시보증공사 류).
        [발행조건확정] body 에는 정정 후 단일값만 있고 range form 없음.

        corp_code 지정 시 DART API 가 해당 corp 만 반환 → 응답/페이지 ↓ (필수 권장).
        """
        start = center - timedelta(days=window_days)
        end = center + timedelta(days=window_days)
        # cache key 에 corp_code 포함 — corp_code 지정/미지정 별도 cache
        key = (start, end, corp_code)
        if key not in self.filings_cache:
            try:
                self.filings_cache[key] = dart_client.list_filings(
                    start, end, corp_code=corp_code)
            except Exception:
                self.filings_cache[key] = []
        return [f for f in self.filings_cache[key]
                if f.corp_name == corp_name]


def _fetch_extract_final_amount(records, f: Finding, ctx: FetchContext) -> bool:
    """H004: final_amount 누락 record 보강.

    여러 패턴 시도:
      1) bond_basic 표: '모집(매출)총액 NNN,NNN,NNN 발행가액'
      2) 본문 초입부 회차 명시: '제N-N회 금 X억원(\\NNN,NNN,NNN)' — 정정사유 컬럼 표
         없는 케이스 (예스코 / 한신공영 / DN오토모티브 류). multi-tranche 도 처리.
      3) 본문 초입부 회차 없음: '3. 모집 또는 매출금액 : 금 X억원(\\NNN,NNN,NNN)' —
         single tranche 직접공모 케이스 (현대차증권 4 류).
    final_amount 보강 후 같은 발행 그룹의 series_total 도 재계산.
    """
    import re as _re
    r = _find_record(records, f)
    if not r or not r.rcept_no:
        return False
    secs = ctx.fetch_document(r.rcept_no)
    if not secs:
        return False
    full = ""
    for v in secs.values():
        try:
            from bs4 import BeautifulSoup as _BS
            full += "\n" + _BS(v, "lxml").get_text(" ", strip=True)
        except Exception:
            continue

    same_group = [x for x in records
                  if x.issuer_alias == r.issuer_alias
                  and x.subscription_date == r.subscription_date
                  and _series_base(x.series) == _series_base(r.series)]

    # Pattern 1: bond_basic 표 안 '모집(매출)총액 N 발행가액'
    m1 = _re.findall(
        r"모집\(매출\)\s*총액\s+(\d{1,3}(?:,\d{3})+)\s+발행가액",
        full)
    if m1 and len(same_group) == 1 and len(set(m1)) == 1:
        won = float(m1[0].replace(",", ""))
        r.final_amount = won / 1e8
        return True

    # Pattern 2: 본문 초입부 multi-tranche '제N-N회 금 X(\NNN,NNN,NNN)'
    series_to_amount: dict[str, float] = {}
    for m in _re.finditer(
        r"제\s*(\d+(?:\s*-\s*\d+)?)\s*회[^원\n]{0,100}?"
        r"금\s*[가-힣]+원\s*\(\s*[\\₩]?\s*(\d{1,3}(?:,\d{3})+)",
        full):
        series = m.group(1).replace(" ", "")
        won_str = m.group(2).replace(",", "")
        try:
            series_to_amount[series] = float(won_str) / 1e8
        except ValueError:
            continue
    if r.series in series_to_amount:
        r.final_amount = series_to_amount[r.series]
        # 같은 그룹의 다른 record 도 보강 + series_total 재계산
        for x in same_group:
            if x.final_amount is None and x.series in series_to_amount:
                x.final_amount = series_to_amount[x.series]
        finals = [x.final_amount for x in same_group if x.final_amount is not None]
        if len(finals) == len(same_group):
            total = sum(finals)
            for x in same_group:
                x.series_total = total
        return True

    # Pattern 3: 본문 초입부 single tranche.
    # 두 가지 형식 모두 처리:
    #   '3. 모집 또는 매출금액 : 금 X억원(\\NNN,NNN,NNN)' (DN오토모티브 류, 한글)
    #   '3. 모집 또는 매출금액 : NNN,NNN,NNN원' (예스코 류, 숫자 직접)
    if len(same_group) == 1:
        m3 = _re.search(
            r"3\.\s*모집\s*또는\s*매출금액\s*[:：][^원\n]{0,200}?"
            r"(?:금\s*[가-힣]+원\s*\(\s*[\\₩]?\s*)?(\d{1,3}(?:,\d{3})+)\s*원?",
            full)
        if m3:
            won = float(m3.group(1).replace(",", ""))
            r.final_amount = won / 1e8
            r.series_total = r.final_amount
            return True

    # Pattern 4 fallback — initial_amount 설정됨. 정정 형식 본문에 매출금액 표기가 없는
    # 경우 (CJ프레시웨이 11 / 미래에셋자산운용 7 / 여천NCC 74 류). face-value 발행이
    # 통상이므로 initial 이 곧 final. multi-tranche 도 각 record 의 initial 으로 채움.
    if r.initial_amount:
        r.final_amount = r.initial_amount
        # series_total 재계산 — 같은 그룹 모든 record 의 initial 합산
        if len(same_group) > 1:
            initials = [x.initial_amount for x in same_group if x.initial_amount]
            if len(initials) == len(same_group):
                total = sum(initials)
                for x in same_group:
                    if x.final_amount is None and x.initial_amount:
                        x.final_amount = x.initial_amount
                    x.series_total = total
        else:
            r.series_total = r.final_amount
        r.notes.append("[H004] final_amount = initial_amount fallback")
        return True

    return False


def _fetch_extract_rate_demand(records, f: Finding, ctx: FetchContext) -> bool:
    """H002: record 의 rcept 본문에서 rate_demand 재추출.

    1차: 자체 rcept body 에서 series 또는 series_base 매칭
    2차: corp 의 다른 filings (초기/정정 신고서) 까지 fallback — 발행조건확정 본문에
         demand 표기 없는 경우 (울산지피에스 2-1 류).
    """
    r = _find_record(records, f)
    if not r or not r.rcept_no:
        return False
    series_base = r.series.split("-")[0] if "-" in r.series else r.series

    # 직접금리형 (신종자본/후순위 % 만) 은 rate_demand 의미 없음 → skip
    if not _can_set_demand_rate(r):
        return False
    secs = ctx.fetch_document(r.rcept_no)
    if secs:
        demands = dart_parser._extract_demand_rates_by_series(secs)
        if r.series in demands:
            r.rate_demand = demands[r.series]
            return True
        if series_base in demands:
            r.rate_demand = demands[series_base]
            return True

    # corp 의 다른 filings fallback
    if not isinstance(r.subscription_date, date):
        return False
    related = ctx.list_all_filings_for_corp(r.issuer_alias, r.subscription_date,
                                             window_days=60,
                                             corp_code=r.corp_code or "")
    for filing in related:
        if filing.rcept_no == r.rcept_no:
            continue
        sub_secs = ctx.fetch_document(filing.rcept_no)
        if not sub_secs:
            continue
        demands = dart_parser._extract_demand_rates_by_series(sub_secs)
        if r.series in demands:
            r.rate_demand = demands[r.series]
            r.notes.append(f"[H002] demand (다른 rcept: {filing.rcept_no})")
            return True
        if series_base in demands:
            r.rate_demand = demands[series_base]
            r.notes.append(f"[H002] demand (다른 rcept: {filing.rcept_no})")
            return True
    return False


def _extract_rate_loose(secs) -> float | None:
    """본문에서 발행수익률/연리이자율/이자율 + 숫자 패턴 추출 (colon 없는 형태 포함).

    하나금융지주 11 류: '이자율 - 발행수익률 4.55', '연리이자율(%) 4.55' 등.
    안전을 위해:
      - 숫자 직전 글자가 '-' (range/누락 표기) 이면 skip
      - 숫자 직후 글자가 '%P' (가산금리 표기) 이면 skip
      - 1.0 ~ 15.0 범위 (현실적 채권 금리) 외 값 skip
    """
    import re as _re
    from bs4 import BeautifulSoup as _BS
    candidates: list[float] = []
    for html in secs.values():
        try:
            txt = _BS(html, "lxml").get_text(" ", strip=True)
        except Exception:
            continue
        # 키워드 + (옵션 (%)/콜론 + 공백) + 숫자
        pattern = _re.compile(
            r"(?:발행수익률|연리이자율|이자율)"
            r"(?:\s*\(\s*%\s*\))?"
            r"\s*[:：]?\s+"
            r"(\d+\.\d+)"
            r"(?!\s*%?\s*[pP])"  # 직후 %P 가산금리 표기 제외
        )
        for m in pattern.finditer(txt):
            val = float(m.group(1))
            if 1.0 <= val <= 15.0:
                candidates.append(val)
    if not candidates:
        return None
    # 가장 흔한 값 — 같은 rate 가 여러 번 등장하는 경우가 정답일 가능성 높음
    from collections import Counter
    return Counter(candidates).most_common(1)[0][0]


def _fetch_complete_finalization(records, f: Finding, ctx: FetchContext) -> bool:
    """H010: [발행조건확정] 누락 record 의 모든 stage 2/3 필드 보강.

    corp 의 모든 [발행조건확정] 공시 (1차 = 수요예측 결과 + 2차 = 기준금리 확정 등)
    순회하며 누적 update. 각 stage 가 다른 필드 채울 수 있음:
      - 1차: rate_demand, final_amount, lead, underwriter_alloc
      - 2차: rate_final
    """
    r = _find_record(records, f)
    if not r:
        return False
    if not isinstance(r.subscription_date, date):
        return False

    import json as _json
    try:
        mappings_path = Path(__file__).resolve().parent / "mappings.json"
        mappings = _json.loads(mappings_path.read_text(encoding="utf-8"))
    except Exception:
        mappings = {}

    any_changed = False
    latest_rcept = None

    # corp 의 모든 [발행조건확정] 순회 (rcept_no 기준 정렬 — 후속 stage 가 rate_final 채움)
    candidates = sorted(
        ctx.list_filings_for_corp(r.issuer_alias, r.subscription_date,
                                  corp_code=r.corp_code or ""),
        key=lambda f: f.rcept_no,
    )
    for filing in candidates:
        secs = ctx.fetch_document(filing.rcept_no)
        if not secs:
            continue
        # 변동금리 / SOFR 연동 채권 detect
        try:
            from bs4 import BeautifulSoup as _BS
            txt = ""
            for html in secs.values():
                txt += "\n" + _BS(html, "lxml").get_text(" ", strip=True)
            if "SOFR" in txt and "이자율 변동" in txt:
                marker = "SOFR FRN"
                if marker not in (r.notes or []):
                    r.notes.append(marker)
                    any_changed = True
                latest_rcept = filing.rcept_no
                # rate_final 은 본질적으로 추출 불가 — continue (다음 filing 시도 의미 X)
                break
        except Exception:
            pass

        try:
            parse_ctx = dart_parser.ParseContext(
                rcept_no=filing.rcept_no,
                is_amendment=False,
                is_final=True,
                corp_name=r.issuer_alias,
                corp_code=r.corp_code,
            )
            parsed_records = dart_parser.parse_filing(secs, parse_ctx, mappings)
        except Exception:
            parsed_records = []

        match = next((pr for pr in parsed_records if pr.series == r.series), None)
        filing_changed = False
        if match:
            # parse_filing 성공 → 모든 필드 보강
            if r.rate_final is None and match.rate_final is not None:
                r.rate_final = match.rate_final
                filing_changed = True
            if not r.rate_demand and match.rate_demand and _can_set_demand_rate(r):
                r.rate_demand = match.rate_demand
                filing_changed = True
            if r.final_amount is None and match.final_amount is not None:
                r.final_amount = match.final_amount
                filing_changed = True
            if r.series_total is None and match.series_total is not None:
                r.series_total = match.series_total
                filing_changed = True
            if not r.lead_managers and match.lead_managers:
                r.lead_managers = list(match.lead_managers)
                filing_changed = True
            if not r.underwriter_alloc and match.underwriter_alloc:
                r.underwriter_alloc = dict(match.underwriter_alloc)
                filing_changed = True
        else:
            # parse_filing 실패 → 2차 [발행조건확정] 등 정정 형식 본문. _extract_rates_by_series
            # fallback 으로 rate_final 만이라도 추출.
            # series 매칭: '7-1' 매칭 안 되면 base '7' 도 시도 (multi-tranche 가 같은
            # 회차 기본금리만 본문에 기재하는 경우 — 미래에셋자산운용 7-1/-2 등).
            series_base = r.series.split("-")[0] if "-" in r.series else r.series
            if r.rate_final is None:
                rates = dart_parser._extract_rates_by_series(secs)
                rate_val = None
                if r.series in rates and rates[r.series] > 0:
                    rate_val = rates[r.series]
                elif series_base in rates and rates[series_base] > 0:
                    rate_val = rates[series_base]
                else:
                    # 본문 전체 텍스트에서 colon 없는 형태도 탐색
                    # (하나금융지주 11 류: "발행수익률 4.55", "연리이자율(%) 4.55")
                    rate_val = _extract_rate_loose(secs)
                if rate_val:
                    r.rate_final = rate_val
                    filing_changed = True
            if not r.rate_demand and _can_set_demand_rate(r):
                demands = dart_parser._extract_demand_rates_by_series(secs)
                if r.series in demands:
                    r.rate_demand = demands[r.series]
                    filing_changed = True
                elif series_base in demands:
                    r.rate_demand = demands[series_base]
                    filing_changed = True

        if filing_changed:
            any_changed = True
            latest_rcept = filing.rcept_no
        # rate_final 까지 채워졌으면 멈춤
        if r.rate_final is not None:
            break

    if any_changed and latest_rcept:
        r.rcept_no = latest_rcept
    return any_changed


def _fetch_extract_hope_rate(records, f: Finding, ctx: FetchContext) -> bool:
    """H009: rate_target (희망금리) 추출.

    [발행조건확정] body 에는 정정 후 단일값만 있는 경우가 많아 (주택도시보증공사 류),
    corp 의 INITIAL 신고서 (또는 [기재정정]) body 까지 시도해서 range form 추출.

    parser._extract_hope_rate 는 본문 전체에서 첫 매치만 사용. corp 본문이 단일
    series 만 다루는 경우 자연스럽게 작동. multi-series 인 경우는 첫 series 의 값
    이 같은 corp 의 모든 records 에 적용됨 (보통 같은 발행건의 hope range 는 동일).
    """
    r = _find_record(records, f)
    if not r:
        return False
    if not isinstance(r.subscription_date, date):
        return False
    # corp 의 모든 filings (initial 포함) 시도
    for filing in ctx.list_all_filings_for_corp(r.issuer_alias, r.subscription_date,
                                                 corp_code=r.corp_code or ""):
        secs = ctx.fetch_document(filing.rcept_no)
        if not secs:
            continue
        hope = dart_parser._extract_hope_rate(secs)
        if hope:
            r.rate_target = hope
            return True
    return False


def _fetch_extract_rate_final(records, f: Finding, ctx: FetchContext) -> bool:
    """H004/X003/S002: corp 의 [발행조건확정] 본문에서 rate_final 재추출.

    rcept_no 매핑 버그 잔재 케이스 (SK 314-2 류) 도 처리:
    record.rcept_no 가 다른 발행건의 rcept 로 잘못 덮어씌워진 경우, 자기 rcept body
    에는 우리 series 가 없을 것. subscription_date 기준 corp 의 다른 [발행조건확정]
    들을 순회해서 r.series 가 있는 본문 찾음.

    우선순위:
      1. 자기 rcept body — 결과가 r.series 에 대응 + > 0 이면 채택
      2. subscription_date ± 60일 범위의 corp 의 [발행조건확정] 들 순회
    """
    r = _find_record(records, f)
    if not r:
        return False
    # 자기 rcept 먼저
    if r.rcept_no:
        secs = ctx.fetch_document(r.rcept_no)
        if secs:
            rates = dart_parser._extract_rates_by_series(secs)
            if r.series in rates and rates[r.series] > 0:
                r.rate_final = rates[r.series]
                return True
    # 같은 corp 의 다른 [발행조건확정] 시도 (subscription_date 기준)
    if isinstance(r.subscription_date, date):
        all_finals = ctx.list_filings_for_corp(r.issuer_alias, r.subscription_date,
                                               corp_code=r.corp_code or "")
        for filing in all_finals:
            # 자기 rcept 와 같으면 skip (이미 위에서 시도)
            if filing.rcept_no == r.rcept_no:
                continue
            secs = ctx.fetch_document(filing.rcept_no)
            if not secs:
                continue
            rates = dart_parser._extract_rates_by_series(secs)
            if r.series in rates and rates[r.series] > 0:
                r.rate_final = rates[r.series]
                return True
        # 신종자본/후순위채 fallback: series 매칭 실패 시 마지막 [발행조건확정] 의
        # 단일 rate 사용 (우리은행 270531 류 — record series 가 본문과 다른 명명 형식)
        if (r.bond_type in ("신종자본", "후순위채") and len(all_finals) >= 2
                and len([x for x in records if x.issuer_alias == r.issuer_alias
                         and x.subscription_date == r.subscription_date]) == 1):
            last_f = sorted(all_finals, key=lambda f: f.rcept_no)[-1]
            secs = ctx.fetch_document(last_f.rcept_no)
            if secs:
                rates = dart_parser._extract_rates_by_series(secs)
                if len(rates) == 1:
                    single_rate = next(iter(rates.values()))
                    if single_rate > 0:
                        r.rate_final = single_rate
                        return True
    return False


def _h005_collect_candidates(secs, mappings) -> list:
    """sections 의 모든 표 → underwriter 후보 리스트.
    각 entry = (alias_role_amt list, total_eok).
    """
    import io
    import pandas as pd
    out = []
    for html in secs.values():
        try:
            tables = pd.read_html(io.StringIO(html))
        except Exception:
            continue
        for t in tables:
            uws = dart_parser._extract_underwriters(t)
            if not uws:
                continue
            alias_role_amt = []
            for u in uws:
                alias = dart_parser.map_broker(u["firm"], mappings)
                if not alias:
                    continue
                amt_eok = (u.get("amount_won", 0) or 0) / 1e8
                alias_role_amt.append((alias, (u.get("role") or "").strip(), amt_eok))
            if not alias_role_amt:
                continue
            total_eok = sum(amt for _, _, amt in alias_role_amt)
            out.append((alias_role_amt, total_eok))
    return out


def _h005_apply_match(r, alias_role_amt, replace_alloc: bool) -> bool:
    """매칭된 표 → record 의 lead_managers (+ optionally alloc) 갱신."""
    new_leads = []
    for alias, role, _ in alias_role_amt:
        is_lead = role in ("대표", "공동") or "대표" in role or "공동" in role
        if is_lead and alias not in new_leads:
            new_leads.append(alias)
    if replace_alloc:
        new_alloc = {}
        for alias, _, amt_eok in alias_role_amt:
            new_alloc[alias] = new_alloc.get(alias, 0) + amt_eok
        r.underwriter_alloc = new_alloc
    if new_leads:
        r.lead_managers = new_leads
        return True
    return False


def _fetch_extract_lead_managers(records, f: Finding, ctx: FetchContext) -> bool:
    """H005: 본문 인수단 표에서 대표/공동 표시된 firm 추출.

    세 가지 시나리오:
    1) 정상 alloc + rcept body: firm set 일치 표 찾아 role 매칭
    2) 손상 alloc + rcept body: alloc 키에 role 텍스트 → final_amount 기준 재구성
    3) [발행조건확정] 본문에 표 없음: corp 의 초기/정정 신고서 fallback
       (세아창원특수강 37 류 — 발행조건확정에 정정사항만 있고 인수단 표는 초기에)
    """
    r = _find_record(records, f)
    if not r or not r.rcept_no:
        return False
    if not r.underwriter_alloc:
        return False

    import json as _json
    try:
        mappings_path = Path(__file__).resolve().parent / "mappings.json"
        mappings = _json.loads(mappings_path.read_text(encoding="utf-8"))
    except Exception:
        mappings = {}

    ROLE_KEYS = {"대표", "공동", "인수"}
    alloc_corrupted = bool(set(r.underwriter_alloc.keys()) & ROLE_KEYS)
    expected = set(r.underwriter_alloc.keys())

    # 1차 + 2차: 현재 rcept body
    primary_secs = ctx.fetch_document(r.rcept_no)
    primary_candidates = _h005_collect_candidates(primary_secs, mappings) if primary_secs else []

    # 시나리오 1 — 정상 alloc: firm set 일치 표에서 lead 추출
    if not alloc_corrupted:
        for cand in primary_candidates:
            alias_role_amt, _ = cand
            table_aliases = {a for a, _, _ in alias_role_amt}
            if expected.issubset(table_aliases):
                # 매칭 — 단 expected 안의 firm 만 보고 lead 결정
                filtered = [(a, role, amt) for a, role, amt in alias_role_amt
                            if a in expected]
                if _h005_apply_match(r, filtered, replace_alloc=False):
                    return True

    # 시나리오 2 — 손상 alloc: final_amount 기준
    if alloc_corrupted and primary_candidates and r.final_amount:
        best = min(primary_candidates,
                   key=lambda c: abs(c[1] - r.final_amount))
        if abs(best[1] - r.final_amount) < 1:
            if _h005_apply_match(r, best[0], replace_alloc=True):
                r.notes.append("[H005 손상 복구] alloc + leads 재구성")
                return True

    # 시나리오 3 — 1·2 실패 시 corp 의 다른 filings (초기/정정 신고서) fallback
    if not r.subscription_date:
        return False
    related = ctx.list_all_filings_for_corp(r.issuer_alias, r.subscription_date,
                                             window_days=60,
                                             corp_code=r.corp_code or "")
    # 같은 corp 의 다른 rcept (이미 시도한 r.rcept_no 제외)
    for filing in related:
        if filing.rcept_no == r.rcept_no:
            continue
        secs = ctx.fetch_document(filing.rcept_no)
        if not secs:
            continue
        candidates = _h005_collect_candidates(secs, mappings)

        # 시나리오 1 시도
        if not alloc_corrupted:
            for cand in candidates:
                alias_role_amt, _ = cand
                table_aliases = {a for a, _, _ in alias_role_amt}
                if expected.issubset(table_aliases):
                    filtered = [(a, role, amt) for a, role, amt in alias_role_amt
                                if a in expected]
                    if _h005_apply_match(r, filtered, replace_alloc=False):
                        r.notes.append(f"[H005] lead 보강 (다른 rcept: {filing.rcept_no})")
                        return True

        # 시나리오 2 시도
        if alloc_corrupted and candidates and r.final_amount:
            best = min(candidates, key=lambda c: abs(c[1] - r.final_amount))
            if abs(best[1] - r.final_amount) < 1:
                if _h005_apply_match(r, best[0], replace_alloc=True):
                    r.notes.append(f"[H005 손상 복구] alloc+leads (다른 rcept: {filing.rcept_no})")
                    return True
    return False


def _fetch_complete_underwriting_data(records, f: Finding, ctx: FetchContext) -> bool:
    """H011: 수요예측 진행됐는데 인수단/희망금리/수요금리 누락 — corp 모든 filings 순회.

    SK브로드밴드 52 류: 두 번째 [발행조건확정] 만 처리되고 첫 번째 (인수단 정보 보유)
    가 처리됐어도 데이터 누락된 케이스. corp 의 모든 filings (초기 + 정정 + 1차 +
    2차 [발행조건확정]) 를 모두 fetch + parse 해서 빈 필드만 채움.

    ⚠️ 미래 청약일 (아직 [발행조건확정] 전) 인 경우 발동 안 함 — 1단계 신고서의
       인수/주관 표는 "예정" 정보일 뿐, 실제 인수는 청약 후 결정.
    """
    r = _find_record(records, f)
    if not r:
        return False
    if not isinstance(r.subscription_date, date):
        return False
    if r.subscription_date > date.today():
        return False

    import json as _json
    try:
        mappings_path = Path(__file__).resolve().parent / "mappings.json"
        mappings = _json.loads(mappings_path.read_text(encoding="utf-8"))
    except Exception:
        mappings = {}

    any_changed = False
    related = ctx.list_all_filings_for_corp(r.issuer_alias, r.subscription_date,
                                             window_days=60,
                                             corp_code=r.corp_code or "")
    # rcept_no 작은 것부터 (초기 → 정정 → [발행조건확정] 순)
    # 인수단/희망금리 관련 섹션만 fetch — DART 부하 감소
    for filing in sorted(related, key=lambda x: x.rcept_no):
        secs = ctx.fetch_document(
            filing.rcept_no,
            predicate=dart_client.underwriter_title_predicate,
            predicate_name="underwriter")
        if not secs:
            continue
        try:
            parse_ctx = dart_parser.ParseContext(
                rcept_no=filing.rcept_no,
                is_amendment=False,
                is_final=filing.is_final,
                corp_name=r.issuer_alias,
                corp_code=r.corp_code,
            )
            parsed_records = dart_parser.parse_filing(secs, parse_ctx, mappings)
        except Exception:
            parsed_records = []
        match = next((pr for pr in parsed_records if pr.series == r.series), None)
        if not match:
            # series_base 도 시도
            base = r.series.split("-")[0] if "-" in r.series else r.series
            match = next((pr for pr in parsed_records if pr.series == base), None)

        if match:
            # 빈 필드만 채움 (기존 값 보호)
            if not r.rate_target and match.rate_target:
                r.rate_target = match.rate_target
                any_changed = True
            if not r.rate_demand and match.rate_demand and _can_set_demand_rate(r):
                r.rate_demand = match.rate_demand
                any_changed = True
            if r.rate_final is None and match.rate_final is not None:
                r.rate_final = match.rate_final
                any_changed = True
            if not r.underwriter_alloc and match.underwriter_alloc:
                r.underwriter_alloc = dict(match.underwriter_alloc)
                any_changed = True
            if not r.lead_managers and match.lead_managers:
                r.lead_managers = list(match.lead_managers)
                any_changed = True
            if r.final_amount is None and match.final_amount is not None:
                r.final_amount = match.final_amount
                any_changed = True
            # H013/issue_limit 관련 — 빈 필드만
            if r.demand_amount is None and match.demand_amount is not None:
                r.demand_amount = match.demand_amount
                any_changed = True
            if r.issue_limit is None and match.issue_limit is not None:
                r.issue_limit = match.issue_limit
                any_changed = True

        # parse_filing series 매핑 실패해도 hope/demand 는 본문 텍스트에서 직접 추출 가능.
        # SK브로드밴드 52, 에이치디현대케미칼 4, 현대트랜시스 43 류 — 본문 형식이
        # 회차ID 표가 인수단 섹션 밖에 있어 parse_filing 매칭 실패하지만 hope/demand
        # 텍스트는 본문에 정상적으로 있음 (2026-05-16 추가).
        series_base = r.series.split("-")[0] if "-" in r.series else r.series
        if not r.rate_target:
            try:
                hope = dart_parser._extract_hope_rate(secs)
            except Exception:
                hope = ""
            if hope:
                r.rate_target = hope
                any_changed = True
        if not r.rate_demand and _can_set_demand_rate(r):
            try:
                demands = dart_parser._extract_demand_rates_by_series(secs)
            except Exception:
                demands = {}
            if r.series in demands:
                r.rate_demand = demands[r.series]
                any_changed = True
            elif series_base in demands:
                r.rate_demand = demands[series_base]
                any_changed = True
        # demand_amount 도 직접 추출 fallback (parse_filing 실패 시 기아 284 류)
        if r.demand_amount is None:
            try:
                damts = dart_parser.extract_demand_amounts_by_series(secs)
            except Exception:
                damts = {}
            if r.series in damts:
                r.demand_amount = damts[r.series]
                any_changed = True
            elif series_base in damts:
                r.demand_amount = damts[series_base]
                any_changed = True

    # 자동 marker — corp 의 모든 filings 다 봤는데 demand_amount 못 채웠으면
    # 본문에 수요예측 표 자체가 없는 case (사모/직접발행 신종자본 류 — 하나증권 6).
    # notes 에 marker 추가 → H013 detection 시 skip.
    if r.demand_amount is None and "수요예측 표 없음" not in " ".join(r.notes or []):
        r.notes.append("[자동] 수요예측 표 없음 (corp filings 다 봤음)")
        any_changed = True

    if any_changed:
        r.notes.append("[H011] corp filings 종합 복원")
    return any_changed


def _fetch_correct_underwriter_alloc(records, f: Finding, ctx: FetchContext) -> bool:
    """H003: final_amount ≠ Σ(인수단) 불일치 — 정정 후 인수단 표 누락 케이스.

    corp 의 모든 filings 의 인수단 표 dump → Σ = final_amount 인 표 찾아 alloc 덮어씀.
    H005 손상 복구 로직과 동일하지만 trigger 조건이 다름 (alloc 자체는 있는데 합산 불일치).

    추가: final_amount=1.15 같은 명백한 오류 케이스 — alloc 합이 합리적이면 final 보정.
    """
    r = _find_record(records, f)
    if not r or not r.rcept_no:
        return False
    if r.final_amount is None or not r.underwriter_alloc:
        return False
    if not isinstance(r.subscription_date, date):
        return False

    import json as _json
    try:
        mappings_path = Path(__file__).resolve().parent / "mappings.json"
        mappings = _json.loads(mappings_path.read_text(encoding="utf-8"))
    except Exception:
        mappings = {}

    # 명백한 final_amount 단위 오류: |final - Σ| / Σ > 100% AND final < 10
    # (한국금융지주 33 류: final=1.15 vs Σ=1100 — 발행수익률을 final 로 잘못 매핑)
    alloc_sum = sum(r.underwriter_alloc.values())
    if alloc_sum > 0 and r.final_amount < 10 and abs(r.final_amount - alloc_sum) / max(alloc_sum, 1) > 0.9:
        r.final_amount = alloc_sum
        r.series_total = alloc_sum
        r.notes.append(f"[H003] final_amount 단위 오류 보정 → Σ(인수단)={alloc_sum}")
        return True

    # corp 의 모든 filings 의 인수단 표 종합 → Σ = final 인 표 찾기
    related = ctx.list_all_filings_for_corp(r.issuer_alias, r.subscription_date,
                                             window_days=60,
                                             corp_code=r.corp_code or "")
    target = r.final_amount
    best_cand: list = None
    best_diff = None
    for filing in sorted(related, key=lambda x: x.rcept_no):
        secs = ctx.fetch_document(
            filing.rcept_no,
            predicate=dart_client.underwriter_title_predicate,
            predicate_name="underwriter")
        if not secs:
            continue
        candidates = _h005_collect_candidates(secs, mappings)
        for cand in candidates:
            alias_role_amt, total_eok = cand
            diff = abs(total_eok - target)
            if best_diff is None or diff < best_diff:
                best_diff = diff
                best_cand = alias_role_amt

    # 1억 이하 매칭만 채택
    if best_cand is not None and best_diff is not None and best_diff < 1:
        new_alloc = {}
        new_leads = []
        for alias, role, amt_eok in best_cand:
            new_alloc[alias] = new_alloc.get(alias, 0) + amt_eok
            is_lead = role in ("대표", "공동") or "대표" in role or "공동" in role
            if is_lead and alias not in new_leads:
                new_leads.append(alias)
        r.underwriter_alloc = new_alloc
        if new_leads:
            r.lead_managers = new_leads
        r.notes.append(f"[H003] 정정 후 alloc 재구성 (Σ={sum(new_alloc.values()):.0f}억)")
        return True
    return False


def _fetch_extract_credit_rating(records, f: Finding, ctx: FetchContext) -> bool:
    """H014: 신용등급 빈 칸 — 본문 / 부모 증권신고서 fetch 해서 재추출.

    1) record 의 rcept_no (보통 발행조건확정) 본문에서 inline 추출 시도
    2) 실패 시 corp_code + sub_date 기준 부모 증권신고서 (non-[발행조건확정])
       찾아 inline 추출 시도

    parser._extract_inline_credit_grades_from_sections 직접 호출 (parse_filing
    전체 흐름은 불필요 — 등급만 정확히 보강).
    """
    r = _find_record(records, f)
    if not r or not r.rcept_no:
        return False
    if r.credit_rating:
        return True  # 이미 채워짐 (다른 handler 가 먼저 처리)

    from parser import (_extract_inline_credit_grades_from_sections,
                         _format_credit_grades)  # type: ignore

    # 1) 발행조건확정 본문 시도
    secs = ctx.fetch_document(r.rcept_no, predicate_name="full")
    if secs:
        grades = _extract_inline_credit_grades_from_sections(secs)
        if grades:
            rating = _format_credit_grades(grades)
            if rating:
                r.credit_rating = rating
                r.notes.append(f"[H014] 신용등급 본문에서 추출: {rating}")
                return True

    # 2) 부모 증권신고서 (non-[발행조건확정]) 시도
    if not (r.corp_code and isinstance(r.subscription_date, date)):
        return False
    all_filings = ctx.list_all_filings_for_corp(
        r.issuer_alias, r.subscription_date, window_days=120,
        corp_code=r.corp_code)
    # 청약일 이전 + non-[발행조건확정] 만 (이후 신고서는 다른 회차의 신고서이므로 제외)
    sub_yyyymmdd = r.subscription_date.strftime("%Y%m%d")
    parents = [x for x in all_filings
               if not x.report_nm.startswith("[발행조건확정]")
               and x.rcept_no[:8] <= sub_yyyymmdd]
    if not parents:
        return False
    # rcept_no 큰 순 = 청약일에 가장 가까운 최신 신고서 (= 본 회차의 부모)
    parents.sort(key=lambda x: x.rcept_no, reverse=True)
    parent_rcept = parents[0].rcept_no
    secs = ctx.fetch_document(parent_rcept,
                                predicate=dart_client.stage1_title_predicate,
                                predicate_name="stage1")
    if not secs:
        return False
    grades = _extract_inline_credit_grades_from_sections(secs)
    if not grades:
        return False
    rating = _format_credit_grades(grades)
    if not rating:
        return False
    r.credit_rating = rating
    r.notes.append(f"[H014] 신용등급 부모 신고서({parent_rcept})에서 추출: {rating}")
    return True


# rule_id → fetch handler
FETCH_HANDLERS = {
    "H002": _fetch_extract_rate_demand,
    "H003": _fetch_correct_underwriter_alloc,
    "H004": _fetch_extract_final_amount,
    "H005": _fetch_extract_lead_managers,
    "H009": _fetch_extract_hope_rate,    # H009 는 rate_target (희망금리) 추출. initial 신고서까지 시도.
    "H010": _fetch_complete_finalization,   # [발행조건확정] 누락 — parse_filing 으로 전체 보강
    "H011": _fetch_complete_underwriting_data,  # 수요예측 진행 후 데이터 누락
    "H013": _fetch_complete_underwriting_data,  # rate_demand 가산 형태 + demand_amount 누락
    "H014": _fetch_extract_credit_rating,  # 신용등급 빈 칸 → 본문/부모 신고서에서 추출
    "X003": _fetch_extract_rate_final,
    "S002": _fetch_extract_rate_final,   # rate_final 이상치 (0% / >15%) — X003 와 동일 동작
    # X002 (issue_limit 누락) 는 deprecated → skip
    # H006 (subscription_date 누락) 은 record 가 기타 탭으로 빠진 상태라 복잡 → skip
}


def apply_auto_fixes(records, findings: list[Finding], fetch_enabled: bool = True):
    """Auto-fix 적용. records 를 in-place 수정.

    Args:
        records: TrancheRecord 리스트
        findings: Layer 1 검출 결과
        fetch_enabled: True 면 시나리오 A+ (refetch 액션 시 DART 본문 fetch).
                        False 면 시나리오 A (메모리 patch 만).

    Returns:
        (patched, fetch_patched, manual, failed)
          - patched: in-memory 직접 patch 성공 finding
          - fetch_patched: DART fetch 후 patch 성공 finding
          - manual: 사용자 판단 필요 finding
          - failed: 처리 실패 (record not found / 추출 실패 등)
    """
    patched: list[Finding] = []
    fetch_patched: list[Finding] = []
    manual: list[Finding] = []
    failed: list[tuple[Finding, str]] = []
    ctx = FetchContext()

    for f in findings:
        action = AUTO_FIX_STRATEGIES.get(f.rule_id, "manual")
        if action == "patch":
            handler = PATCH_HANDLERS.get(f.rule_id)
            if handler is None:
                manual.append(f)
                continue
            try:
                ok = handler(records, f)
                if ok:
                    patched.append(f)
                else:
                    failed.append((f, "record not found"))
                    manual.append(f)
            except Exception as e:
                failed.append((f, str(e)))
                manual.append(f)
        elif action == "refetch":
            if not fetch_enabled:
                manual.append(f)
                continue
            handler = FETCH_HANDLERS.get(f.rule_id)
            if handler is None:
                manual.append(f)
                continue
            try:
                ok = handler(records, f, ctx)
                if ok:
                    fetch_patched.append(f)
                else:
                    failed.append((f, "fetch/extract 실패"))
                    manual.append(f)
            except Exception as e:
                failed.append((f, str(e)))
                manual.append(f)
        else:
            manual.append(f)

    return patched, fetch_patched, manual, failed
