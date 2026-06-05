"""DCM 자동화 메인 실행.

사용법:
    python main.py 2026-05-01 2026-05-08
    python main.py --probe 20260501000123   # 단일 공시 진단
    python main.py --update output/DCM_master.xlsx 2026-05-01 2026-05-31 \
        -o output/DCM_master_v2.xlsx
        # 기존 엑셀 옆 .meta.json 의 처리된 rcept_no 는 건너뛰고 신규만 fetch.

MVP: 정해진 기간의 채무증권 신고서를 받아 신규 엑셀 생성.
"""
from __future__ import annotations
import argparse
import json
import logging
import sys
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

# Embedded Python 환경에서 스크립트 디렉터리를 자동 path 에 추가하지 않으므로
# (격리 설계) auto/ 모듈들을 import 하려면 명시적으로 sys.path 갱신.
_AUTO_DIR = str(Path(__file__).resolve().parent)
if _AUTO_DIR not in sys.path:
    sys.path.insert(0, _AUTO_DIR)

import config
import dart_client
import parser as dart_parser
import excel_writer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")


def parse_date_arg(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def load_mappings() -> dict:
    if not config.MAPPINGS_JSON.exists():
        log.warning("mappings.json 없음. build_mappings.py 먼저 실행하세요.")
        return {"issuers": {}, "brokers_formal_to_alias": {}}
    return json.loads(config.MAPPINGS_JSON.read_text(encoding="utf-8"))


def _series_base(s: str) -> str:
    return s.split("-")[0] if "-" in s else s


# ============== 3단계 처리: Stage 1 (초기 증권신고서), Stage 2 (첫 [발행조건확정]), Stage 3 (둘째 [발행조건확정]) ==============

_STAGE1_FIELDS = (
    "subscription_date", "issuer_alias", "issuer_full", "series",
    "bond_type", "credit_rating", "maturity",
    "initial_amount", "issue_limit", "rate_target",
)


def _wipe_stage2_fields(rec) -> None:
    """초기 '증권신고서(채무증권)' (Stage 1) record 에서 Stage 2 이상에서만
    확정되는 필드를 제거.

    유지: 청약일, 발행사, 회차, 종류, 신용등급, 만기일, 최초모집, 발행한도, 희망금리,
          **주관사 명단(lead_managers), 인수사 명단(uw_names)** — stage1 부터 잡음
    제거: 수요예측, 최종발행, 회차합산, 수요금리, 최종금리, **인수단 실적 금액(underwriter_alloc)**
    """
    rec.demand_amount = None
    rec.final_amount = None
    rec.series_total = None
    rec.rate_demand = ""
    rec.rate_final = None
    # 명단(lead_managers, uw_names)은 그대로 보존 — stage1 부터 표/기사에 표시.
    rec.underwriter_alloc = {}


def _merge_records(old, new):
    """new 의 non-empty 필드를 old 에 덮어쓰기. (old 만 갖고 있는 값은 보존.)

    Stage 1 record + Stage 2 record (같은 issuer, series) 를 합칠 때 사용.
    호출 측에서 rcept_no asc 정렬 후 호출하면 Stage 2 가 Stage 1 을 덮어쓰는 효과.
    """
    scalar_fields = (
        "subscription_date", "issuer_alias", "issuer_full", "bond_type",
        "credit_rating", "maturity",
        "initial_amount", "issue_limit", "demand_amount", "final_amount",
        "series_total",
        "rate_target", "rate_demand", "rate_final",
        "rcept_no",
    )
    for f in scalar_fields:
        nv = getattr(new, f, None)
        if nv is None:
            continue
        if isinstance(nv, str) and not nv:
            continue
        setattr(old, f, nv)
    if new.lead_managers:
        old.lead_managers = list(new.lead_managers)
    if new.uw_names:
        old.uw_names = list(new.uw_names)
    if new.underwriter_alloc:
        old.underwriter_alloc = dict(new.underwriter_alloc)
    if new.is_foreign:
        old.is_foreign = True
    return old


def _dedup_merge(records: list) -> list:
    """rcept_no asc 정렬 후 (issuer_alias, series) 키로 _merge_records 적용.

    초기 증권신고서 (rcept_no 작음) → [발행조건확정] (rcept_no 큼) 순으로
    처리되어 Stage 2/3 가 Stage 1 의 값을 덮어쓰도록 보장.
    """
    sorted_recs = sorted(records, key=lambda r: r.rcept_no)
    by_key: dict[tuple[str, str], object] = {}
    for r in sorted_recs:
        k = (r.issuer_alias, r.series)
        if k in by_key:
            by_key[k] = _merge_records(by_key[k], r)
        else:
            by_key[k] = r
    return list(by_key.values())


def _fetch_and_parse(filings, mappings):
    """list_filings 결과 → records + sections_cache + unmapped_brokers.

    cmd_run/cmd_update 가 공통 사용. mappings 는 inplace 갱신될 수 있음.
    초기 증권신고서 records 는 Stage 2+ 필드 (수요/최종/주관/인수 등) 자동 제거.

    과거 → 현재 순서로 처리 (1단계 초기 신고서 → 2단계 첫 [발행조건확정]
    → 3단계 두 번째 [발행조건확정]) — 업데이트 흐름과 자연스럽게 일치.
    """
    # rcept_no asc = rcept_dt asc — 같은 발행건 안에서 단계가 시간 순으로 처리됨
    filings = sorted(filings, key=lambda f: f.rcept_no)

    all_records = []
    unmapped_brokers: set[str] = set()
    filing_sections_cache: dict[str, dict] = {}

    for f in filings:
        stage_tag = "1단계 초기" if f.is_initial else ("3단계 가능" if f.is_final else "기타")
        log.info("[%s] %s | %s (%s)", f.rcept_dt, f.corp_name, f.report_nm, stage_tag)
        # 초기 신고서는 본문 트리가 깊어 65+ 섹션. 1단계 데이터 추출에는
        # '모집 또는 매출에 관한 일반사항' 메인 + 그 직속 하위만 fetch 하면 충분.
        title_filter = dart_client.stage1_title_predicate if f.is_initial else None
        try:
            sections = dart_client.fetch_full_document(f.rcept_no,
                                                       title_predicate=title_filter)
        except Exception as e:
            log.error("  본문 fetch 실패: %s", e)
            continue
        filing_sections_cache[f.rcept_no] = sections

        ctx = dart_parser.ParseContext(
            rcept_no=f.rcept_no,
            is_amendment=f.is_amendment,
            is_final=f.is_final,
            corp_name=f.corp_name,
            corp_code=f.corp_code,
        )
        recs = dart_parser.parse_filing(sections, ctx, mappings)

        # Stage 1 (초기 증권신고서) 처리:
        # (a) 일반 케이스 — 이자율 미정 (수요예측 후 결정) → Stage 2+ 필드 제거
        # (b) First-and-final 케이스 — 첫 공시에 이자율(=발행수익률) 이미 명기됨
        #     (수요예측 없는 발행 구조: 예) 제이알글로벌리츠 4회차 등 리츠 사모형).
        #     이 경우 첫 공시 = 최종 발행조건 → lead/underwriter/rate_final 그대로 보존,
        #     final_amount=initial_amount 만 채워서 [발행조건확정] 한 적 없어도 완성.
        if f.is_initial:
            for r in recs:
                if r.rate_final is not None:
                    # rate_final 채워졌으면 first-and-final. final_amount = initial.
                    # 수요예측 없으니 demand_amount / issue_limit / rate_target /
                    # rate_demand 는 자연스럽게 비어있음. series_total 은 post-process.
                    if r.final_amount is None and r.initial_amount is not None:
                        r.final_amount = r.initial_amount
                else:
                    _wipe_stage2_fields(r)

        for r in recs:
            r.issuer_alias = r.issuer_full
            for n in r.notes:
                if "미매핑 증권사" in n:
                    unmapped_brokers.add(n.split(":", 1)[1].strip())
        all_records.extend(recs)
        if recs:
            log.info("  → 트랜치 %d건 [%s]", len(recs),
                     ", ".join(r.series for r in recs))

    return all_records, filing_sections_cache, unmapped_brokers


def _post_process_records(all_records, filings, filing_sections_cache):
    """records 후처리: latest rcept 매핑, 최종금리 보강, 단일트랜치 fallback, 회차합산.

    - records 는 inplace 수정 (rate_final, series_total, rcept_no 등).
    - filings 는 latest_rcept_no 계산 + issuer_finals 그룹화에 사용.
    - filing_sections_cache 는 같은 corp 의 다른 [발행조건확정] 본문에서 최종금리 추출.

    cmd_run / cmd_update 공통 사용.
    """
    # 같은 발행건의 [발행조건확정] 공시가 여러 번 나오는 경우(수요예측결과반영 → 기준금리확정 등),
    # records 는 첫 번째에서만 채워지지만 정렬은 가장 최신 [발행조건확정] 의 rcept_no 기준이
    # 사용자가 보는 DART 공시 순서와 맞음. corp_name 별 LATEST rcept_no 매핑 후 records 업데이트.
    #
    # 단, 같은 corp 가 다른 발행건도 갖고 있을 때 (예: 신한투자증권 의 3/4 회차 = 2024-06,
    # 2604 회차 = 2026-04) 무조건 LATEST 로 덮어쓰면 2024 records 의 rcept 가 2026
    # 으로 잘못 변경됨. 같은 발행건의 후속 [발행조건확정] 은 통상 1-3주 안에 나오므로
    # **30일 이내** 조건을 추가해 다른 발행건과 분리.
    def _date_from_rcept(rc: str):
        if len(rc) >= 8 and rc[:8].isdigit():
            try:
                return date(int(rc[:4]), int(rc[4:6]), int(rc[6:8]))
            except ValueError:
                pass
        return None

    issuer_latest_rcept: dict[str, str] = {}
    for f in filings:
        if not f.is_final:
            continue
        cur = issuer_latest_rcept.get(f.corp_name)
        if cur is None or f.rcept_no > cur:
            issuer_latest_rcept[f.corp_name] = f.rcept_no
    for r in all_records:
        latest = issuer_latest_rcept.get(r.issuer_alias)
        if not (latest and latest > r.rcept_no):
            continue
        cur_dt = _date_from_rcept(r.rcept_no)
        new_dt = _date_from_rcept(latest)
        if cur_dt is None or new_dt is None:
            continue
        if (new_dt - cur_dt).days <= 30:
            r.rcept_no = latest

    # 최종금리 보강 — bond_type 에 따라 적절한 [발행조건확정] 공시 선택:
    #  - 신종자본/후순위채: 첫 [발행조건확정] 공시 (parse_filing 에서 대부분 채워짐, 여기는 보강)
    #  - 일반/보증: 마지막 [발행조건확정] 공시 (기준금리확정용 — 별도 fetch 필요)
    issuer_finals: dict[str, list] = {}
    for f in filings:
        if not f.is_final:
            continue
        issuer_finals.setdefault(f.corp_name, []).append(f)
    for fs in issuer_finals.values():
        fs.sort(key=lambda f: f.rcept_no)

    rate_fill_count = 0
    for r in all_records:
        if r.rate_final is not None:
            continue
        if r.is_foreign:
            continue
        fs = issuer_finals.get(r.issuer_alias, [])
        if not fs:
            continue
        if r.bond_type in ("신종자본", "후순위채"):
            candidate_fs = fs
        else:
            candidate_fs = list(reversed(fs))
        for f in candidate_fs:
            sections = filing_sections_cache.get(f.rcept_no)
            if not sections:
                # On-demand fetch: cache 에 없으면 dart_client 호출해서 받아옴.
                # X003 (같은 corp 일부 회차만 rate_final 누락) 케이스 자동 처리.
                # 같은 corp 의 2차/3차 [발행조건확정] 이 이전 cmd_update 에서 이미
                # processed 라 fetch 안 됐을 때, 여기서 따로 fetch 해서 본문 확보.
                try:
                    sections = dart_client.fetch_full_document(f.rcept_no)
                    filing_sections_cache[f.rcept_no] = sections
                except Exception as e:
                    log.debug("rate_final on-demand fetch 실패 %s: %s", f.rcept_no, e)
                    continue
            rates = dart_parser._extract_rates_by_series(sections)
            if r.series in rates:
                r.rate_final = rates[r.series]
                rate_fill_count += 1
                break
    if rate_fill_count:
        log.info("최종금리 후보 공시(같은 corp 의 다른 [발행조건확정])에서 보강: %d행",
                 rate_fill_count)

    # 신종자본/후순위채 fallback: corp 의 [발행조건확정] 이 2회 이상인데 series 매칭이
    # 안 돼 rate_final 채워지지 않은 경우 (우리은행 270531 류 — record series 가 본문
    # 표기와 다른 명명 형식). 2차 [발행조건확정] 의 단일 rate 사용.
    special_fb_count = 0
    for r in all_records:
        if r.rate_final is not None or r.is_foreign:
            continue
        if r.bond_type not in ("신종자본", "후순위채"):
            continue
        fs = issuer_finals.get(r.issuer_alias, [])
        if len(fs) < 2:
            continue
        same_corp = [x for x in all_records if x.issuer_alias == r.issuer_alias]
        if len(same_corp) != 1:
            continue  # multi-series 면 위험 — single tranche 만 fallback
        # 마지막 (가장 늦은) [발행조건확정] 시도
        last_f = sorted(fs, key=lambda f: f.rcept_no)[-1]
        sections = filing_sections_cache.get(last_f.rcept_no)
        if not sections:
            try:
                sections = dart_client.fetch_full_document(last_f.rcept_no)
                filing_sections_cache[last_f.rcept_no] = sections
            except Exception:
                continue
        rates = dart_parser._extract_rates_by_series(sections)
        if rates:
            # 단일 series 만 있으면 그 값 사용
            if len(rates) == 1:
                single_rate = next(iter(rates.values()))
                if single_rate > 0:
                    r.rate_final = single_rate
                    r.rcept_no = last_f.rcept_no
                    special_fb_count += 1
    if special_fb_count:
        log.info("신종자본/후순위 2차 [발행조건확정] fallback: %d행", special_fb_count)

    # 단일 트랜치 fallback.
    single_fb_count = 0
    for r in all_records:
        if r.rate_final is not None:
            continue
        if r.is_foreign:
            continue
        same_corp = [x for x in all_records if x.issuer_alias == r.issuer_alias]
        if len(same_corp) != 1:
            continue
        fs = issuer_finals.get(r.issuer_alias, [])
        is_special = r.bond_type in ("신종자본", "후순위채")
        if not is_special and len(fs) < 2:
            continue
        candidate_fs = fs if is_special else list(reversed(fs))
        for f in candidate_fs:
            sections = filing_sections_cache.get(f.rcept_no)
            if not sections:
                continue
            rate = dart_parser._extract_first_rate(sections)
            if rate is not None:
                r.rate_final = rate
                single_fb_count += 1
                log.info("  [단일트랜치fallback] %s %s → %s", r.issuer_alias, r.series, rate)
                break
    if single_fb_count:
        log.info("최종금리 단일 트랜치 fallback 적용: %d행", single_fb_count)

    # 회차합산: (발행사, 회차 base) 그룹의 final_amount 합
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for r in all_records:
        groups[(r.issuer_alias, _series_base(r.series))].append(r)

    for group_recs in groups.values():
        non_foreign = [r for r in group_recs if not r.is_foreign]
        if not non_foreign:
            continue
        finals = [r.final_amount for r in non_foreign if r.final_amount is not None]
        if finals:
            total = sum(finals)
            for r in non_foreign:
                r.series_total = total


def _persist_auto_added(mappings: dict) -> None:
    auto_added = mappings.pop("_auto_added_brokers", [])
    if not auto_added:
        return
    log.info("[자동생성] 신규 증권사 alias %d개:", len(auto_added))
    for a in auto_added:
        log.info("  '%s' → '%s' (역할: %s)", a["formal"], a["alias"], a["role"])
    history = mappings.setdefault("_auto_added_history", [])
    history.extend(auto_added)
    config.MAPPINGS_JSON.write_text(
        json.dumps(mappings, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("mappings.json 갱신 완료 (누적 자동생성 %d건)", len(history))


def cmd_run(start: date, end: date, output_path: Path, only_final: bool = True,
            sub_year_month: str | None = None):
    log.info("OpenDART list 조회 %s ~ %s", start, end)
    filings = dart_client.list_filings(start, end)
    log.info("증권신고서(채무증권) 총 %d건", len(filings))

    if only_final:
        # 3단계 시스템: 초기 '증권신고서(채무증권)' + '[발행조건확정]' 모두 처리.
        # '[기재정정]' 은 중간 변동 단계라 skip (변수명 only_final 은 호환성 유지).
        filings = [f for f in filings if f.is_initial or f.is_final]
        initial_n = sum(1 for f in filings if f.is_initial)
        final_n = sum(1 for f in filings if f.is_final)
        log.info("  중 처리 대상 %d건 (초기 %d + [발행조건확정] %d)",
                 len(filings), initial_n, final_n)

    mappings = load_mappings()
    all_records, filing_sections_cache, unmapped_brokers = _fetch_and_parse(filings, mappings)

    if unmapped_brokers:
        log.warning("미매핑 증권사 (mappings.json 보강 필요): %s", sorted(unmapped_brokers))

    # (issuer, series) 동일 건끼리 Stage 1 + Stage 2 records 병합 (rcept_no asc)
    before_n = len(all_records)
    all_records = _dedup_merge(all_records)
    if before_n != len(all_records):
        log.info("Stage 1+2 records 병합: %d → %d행", before_n, len(all_records))

    _post_process_records(all_records, filings, filing_sections_cache)
    _persist_auto_added(mappings)

    if sub_year_month:
        before = len(all_records)
        all_records = [
            r for r in all_records
            if r.subscription_date and r.subscription_date.strftime("%Y-%m") == sub_year_month
        ]
        log.info("청약일 %s 필터링: %d → %d", sub_year_month, before, len(all_records))

    processed_rcepts = [f.rcept_no for f in filings]
    log.info("엑셀 생성: %s (총 %d행)", output_path, len(all_records))
    excel_writer.write(all_records, output_path, processed_rcept_nos=processed_rcepts)
    log.info("완료")


def cmd_update(existing_xlsx: Path, start: date, end: date, output_path: Path):
    """기존 엑셀의 .meta.json 을 읽어 처리된 rcept_no 는 건너뛰고 신규만 추가 + 병합 저장.

    핵심: 최종금리까지 채워진 회차는 다시 fetch 하지 않음 (사용자 의도).
    같은 (issuer, series) 키가 존재하면 새 record 가 기존을 덮어쓴다 (정정/보강 반영).
    """
    log.info("기존 엑셀 메타 로드: %s", existing_xlsx)
    existing_records, processed_rcepts = excel_writer.load_meta(existing_xlsx)
    log.info("  기존 records=%d, 처리된 rcept_no=%d",
             len(existing_records), len(processed_rcepts))
    # 엑셀 실제 행 keys — 데이터가 빠진 발행사는 미처리 상태로 간주해서 다시 fetch
    xlsx_before_keys = excel_writer.read_existing_keys(existing_xlsx)
    log.info("  엑셀 현재 데이터 행: %d행", len(xlsx_before_keys))

    # 엑셀에는 없는데 메타에는 있는 = 빠진 (발행사, 회차) → DART 에서 다시 가져옴.
    # 정밀도: corp 단위가 아니라 (corp, series) 단위로 처리.
    # 이전 버전은 missing 인 발행사의 모든 records 를 일괄 제거했는데, 그러면 같은
    # corp 의 무관한 다른 년도 records (예: S-Oil 62 가 정상인데도) 까지 제거됐다가
    # cmd_update 의 date 범위가 좁으면 다시 채워지지 않는 사고가 났음 (2026-05-14).
    # 개선: missing_keys 매칭되는 record 만 제거 + 그 (corp, series) 의 rcept 만 clear.
    meta_keys = {(r.issuer_alias, r.series) for r in existing_records}
    missing_keys = meta_keys - xlsx_before_keys
    missing_corps: set[str] = {issuer for (issuer, _) in missing_keys}
    missing_corp_count = len(missing_corps)

    # SAFEGUARD: xlsx 가 비어있어 missing_keys 가 비정상적으로 많으면 중단.
    # 이전 cmd_update 실패로 xlsx 만 빈 상태가 됐을 때 missing_corps 로직이
    # 모든 records 를 wipe 하는 사고 (2026-05-15) 방지.
    if len(meta_keys) >= 100 and len(missing_keys) > len(meta_keys) * 0.5:
        log.error("=" * 60)
        log.error("⚠ 안전 정지: xlsx 비정상 상태 의심")
        log.error("  메타 keys=%d, xlsx keys=%d, missing=%d (%.0f%%)",
                  len(meta_keys), len(xlsx_before_keys), len(missing_keys),
                  100 * len(missing_keys) / len(meta_keys))
        log.error("  xlsx 가 비어있거나 손상된 듯. 이대로 진행하면 데이터 wipe 위험.")
        log.error("  복구 절차:")
        log.error("    1. xlsx 파일 정상 확인 (시트별 데이터 행 수)")
        log.error("    2. 필요 시 installer/staging/ 에서 백업 복구")
        log.error("    3. 그 후 cmd_update 재실행")
        log.error("=" * 60)
        return

    if missing_keys:
        log.info("  추가 조회 필요 (corp, series) %d건 (%d 발행사)",
                 len(missing_keys), missing_corp_count)
        for corp, series in sorted(missing_keys):
            log.info("    - %s %s", corp, series)
        # 조회 기간 자동 확장: missing (corp, series) 자체의 rcept 기준 -30일.
        # (해당 series 의 [발행조건확정] rcept 가 이미 메타에 있고, initial 신고서는
        # 보통 1~3주 전이므로 30일 buffer 면 충분.)
        # 주의: 같은 corp 의 *다른* 정상 series 까지 보면 안 됨 — LG전자처럼 2023년
        # 부터 발행 이력이 있는 corp 의 경우 시작일이 몇 년 전까지 확장돼 list 조회가
        # 비정상적으로 길어짐 (2026-05-16 발견).
        earliest_meta_dt: date | None = None
        for r in existing_records:
            if (r.issuer_alias, r.series) in missing_keys and r.rcept_no:
                dt_str = r.rcept_no[:8]
                if dt_str.isdigit():
                    try:
                        d = date(int(dt_str[:4]), int(dt_str[4:6]), int(dt_str[6:8]))
                        if earliest_meta_dt is None or d < earliest_meta_dt:
                            earliest_meta_dt = d
                    except ValueError:
                        pass
        # 정밀 제거: (corp, series) 가 missing 인 record 만 제거. 같은 corp 의 다른
        # series records 는 보존.
        existing_records = [r for r in existing_records
                            if (r.issuer_alias, r.series) not in missing_keys]
        if earliest_meta_dt is not None:
            from datetime import timedelta
            extended_start = earliest_meta_dt - timedelta(days=30)
            if extended_start < start:
                log.info("    → 조회 시작일 자동 확장: %s → %s", start, extended_start)
                start = extended_start

    log.info("OpenDART list 조회 %s ~ %s", start, end)
    filings = dart_client.list_filings(start, end)
    log.info("증권신고서(채무증권) 총 %d건", len(filings))

    # 빠진 (corp, series) 들이 포함된 발행사의 list 결과 rcept_no 를 processed 에서 제거.
    # 정밀화는 했지만 rcept 단계에서는 어느 rcept 가 어느 series 에 매핑될지 알 수
    # 없어 (parser 만 그걸 결정함), missing_corps 의 모든 rcept 를 clear 하되,
    # date 범위 안의 것만 clear (cmd_update 의 start~end 범위로 list 가 이미 제한됨).
    # 결과적으로 범위 밖 records 는 안전.
    if missing_corps:
        list_missing_rcepts = {f.rcept_no for f in filings
                               if f.corp_name in missing_corps}
        processed_rcepts = processed_rcepts - list_missing_rcepts

    # 발행사명 자동 통일 — DART list_filings 의 corp_name 이 source-of-truth.
    # 메타 record 의 issuer_alias 가 list 의 corp_name 과 다르면 (corp_name 변경,
    # 또는 과거 처리 시 다른 표기) corp_code 매칭으로 자동 갱신.
    corp_code_to_name = {f.corp_code: f.corp_name for f in filings if f.corp_code}
    alias_renamed = 0
    for r in existing_records:
        if r.corp_code and r.corp_code in corp_code_to_name:
            latest = corp_code_to_name[r.corp_code]
            if r.issuer_alias != latest:
                r.issuer_alias = latest
                r.issuer_full = latest
                alias_renamed += 1
    if alias_renamed:
        log.info("  발행사명 통일 (DART 최신 표기로): %d행", alias_renamed)

    # 3단계 시스템: 초기 + [발행조건확정] 모두 처리. [기재정정] skip.
    targets = [f for f in filings if f.is_initial or f.is_final]
    initial_total = sum(1 for f in targets if f.is_initial)
    final_total = sum(1 for f in targets if f.is_final)
    log.info("  중 처리 대상 %d건 (초기 %d + [발행조건확정] %d)",
             len(targets), initial_total, final_total)
    new_filings = [f for f in targets if f.rcept_no not in processed_rcepts]
    skipped = len(targets) - len(new_filings)
    new_initial = sum(1 for f in new_filings if f.is_initial)
    new_final = sum(1 for f in new_filings if f.is_final)
    log.info("  중 미처리 신규 %d건 (초기 %d + [발행조건확정] %d, 이미 처리된 %d건 skip)",
             len(new_filings), new_initial, new_final, skipped)

    mappings = load_mappings()

    if new_filings:
        new_records, sections_cache, unmapped_brokers = _fetch_and_parse(new_filings, mappings)
        if unmapped_brokers:
            log.warning("미매핑 증권사 (mappings.json 보강 필요): %s", sorted(unmapped_brokers))
        # 같은 update 사이클 안에서 초기 + [발행조건확정] 둘 다 새로 나온 케이스 병합
        before_n = len(new_records)
        new_records = _dedup_merge(new_records)
        if before_n != len(new_records):
            log.info("  같은 update 사이클 내 Stage 1+2 병합: %d → %d건",
                     before_n, len(new_records))
        # 최종금리/회차합산 후처리.
        # 분기 경계 케이스: 같은 corp 의 첫 [발행조건확정] 이 옛 cycle 에 있고 두 번째
        # [발행조건확정] 이 이번 cycle 에 있을 때, 메타에 기존 record (rate_final=None)
        # 가 있고 이번 cycle 의 본문엔 새 records 생성 안 됨 (bond_basic 없음). 그래도
        # 이번 fetch 한 본문에 rates 가 있으니, 기존 메타 records 중 rate_final=None
        # 이고 같은 corp 가 new_filings 에 있는 것들도 후처리 대상에 포함.
        new_filing_corps = {f.corp_name for f in new_filings if f.is_final}
        carry_recs = [r for r in existing_records
                      if r.rate_final is None
                      and not r.is_foreign
                      and r.issuer_alias in new_filing_corps]
        _post_process_records(list(new_records) + carry_recs, new_filings, sections_cache)
        _persist_auto_added(mappings)
    else:
        new_records = []

    # 병합: (issuer_alias, series) 키. 기존 record 가 있으면 _merge_records (Stage 누적).
    # 새 record 가 Stage 1 (비어있는 Stage 2 필드들) 이면 기존의 Stage 2 데이터 보존.
    # 새 record 가 Stage 2 면 기존 Stage 1 의 비어있던 필드들이 채워지며 갱신.
    by_key: dict[tuple[str, str], object] = {}
    for r in existing_records:
        by_key[(r.issuer_alias, r.series)] = r
    overwritten = 0
    appended = 0
    for r in new_records:
        k = (r.issuer_alias, r.series)
        if k in by_key:
            by_key[k] = _merge_records(by_key[k], r)
            overwritten += 1
        else:
            by_key[k] = r
            appended += 1
    merged = list(by_key.values())
    log.info("  병합: 신규 추가 %d, 기존 갱신 %d → 합계 %d행",
             appended, overwritten, len(merged))

    # 엑셀 변화를 (corp, series) 단위로 집계 — UI 표시용.
    # corp 단위로 집계하면 같은 발행사의 과거 회차가 이미 xlsx 에 있는 경우 (예:
    # LG전자가 100~106회 이미 있고 107-1/2/3 만 신규로 추가) 신규 회차가 있어도
    # '새로 추가된 corp' 집합이 비어 0곳으로 잘못 표시되는 문제 (2026-05-16 발견).
    final_keys = {(r.issuer_alias, r.series) for r in merged}
    newly_added_keys = final_keys - xlsx_before_keys
    newly_added_corps = {issuer for (issuer, _) in newly_added_keys}
    corps_after = {issuer for (issuer, _) in final_keys}
    # 빠져있던 발행사 = DART 에서 다시 가져옴
    refilled_corps = newly_added_corps & missing_corps
    # DART 에서 새로 등장한 발행사 (= 메타에도 없던)
    truly_new_corps = newly_added_corps - missing_corps
    log.info("  업데이트 결과: 새로 발견된 공시로 발행사 %d곳 업데이트 (전체 %d곳)",
             len(truly_new_corps) + len(refilled_corps), len(corps_after))

    # 회차합산 재계산: 신규 record 가 기존 그룹에 추가되면 합계도 갱신.
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for r in merged:
        groups[(r.issuer_alias, _series_base(r.series))].append(r)
    for group_recs in groups.values():
        non_foreign = [r for r in group_recs if not r.is_foreign]
        if not non_foreign:
            continue
        finals_amt = [r.final_amount for r in non_foreign if r.final_amount is not None]
        if finals_amt:
            total = sum(finals_amt)
            for r in non_foreign:
                r.series_total = total

    # 처리된 rcept_no 누적
    all_rcepts = sorted(set(processed_rcepts) | {f.rcept_no for f in new_filings})

    log.info("엑셀 생성: %s (총 %d행)", output_path, len(merged))
    excel_writer.write(merged, output_path, processed_rcept_nos=all_rcepts)

    # 이번 cmd_update 사이클에 새로 처리된 rcept_no 들을 기록
    # → validator 의 --new-only flag 가 읽어서 검증 범위 한정.
    new_rcepts = sorted({f.rcept_no for f in new_filings})
    from datetime import datetime as _dt
    last_update_log = {
        "timestamp": _dt.now().isoformat(),
        "rcept_nos": new_rcepts,
        "count": len(new_rcepts),
    }
    log_path = Path(__file__).resolve().parent / ".last_update.json"
    log_path.write_text(json.dumps(last_update_log, ensure_ascii=False, indent=2),
                         encoding="utf-8")
    log.info("완료 (last_update: %d건 → %s)", len(new_rcepts), log_path.name)


def cmd_probe(rcept_no: str):
    """단일 공시 진단: 섹션·표 개수, 일부 표 head 출력."""
    log.info("probe rcept_no=%s", rcept_no)
    sections = dart_client.list_doc_sections(rcept_no)
    log.info("섹션 %d개:", len(sections))
    for s in sections:
        log.info("  - %s (eleId=%s)", s.title, s.ele_id)

    cache_dir = config.CACHE_DIR / rcept_no
    cache_dir.mkdir(parents=True, exist_ok=True)
    full = dart_client.fetch_full_document(rcept_no)
    for title, html in full.items():
        safe = re.sub(r"[^\w가-힣]", "_", title)[:60]
        (cache_dir / f"{safe}.html").write_text(html, encoding="utf-8")
    log.info("HTML 캐시: %s", cache_dir)

    import pandas as pd
    import io as _io
    for title, html in full.items():
        try:
            tables = pd.read_html(_io.StringIO(html), flavor="lxml")
        except (ValueError, OSError):
            tables = []
        log.info("  [%s] tables=%d", title, len(tables))
        for i, t in enumerate(tables[:5]):
            log.info("    [t%d] shape=%s cols=%s", i, t.shape, list(t.columns)[:6])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("start", nargs="?", help="시작일 YYYY-MM-DD")
    ap.add_argument("end", nargs="?", help="종료일 YYYY-MM-DD")
    ap.add_argument("--probe", help="단일 rcept_no 진단")
    ap.add_argument("--update", help="기존 엑셀 경로 — 그 옆 .meta.json 의 처리된 "
                                     "rcept_no 는 건너뛰고 신규만 추가")
    ap.add_argument("-o", "--output",
                    default=str(config.OUTPUT_DIR / "DCM_auto.xlsx"))
    ap.add_argument("--all-stages", action="store_true",
                    help="[발행조건확정]만 쓰지 않고 모든 단계 처리")
    ap.add_argument("--sub-month", help="청약일 YYYY-MM 으로 결과 필터")
    args = ap.parse_args()

    if args.probe:
        cmd_probe(args.probe)
        return

    if args.update:
        if not args.start or not args.end:
            ap.error("--update 모드도 start, end 필수")
        existing = Path(args.update)
        if not existing.exists():
            ap.error(f"--update 경로 없음: {existing}")
        cmd_update(existing,
                   parse_date_arg(args.start), parse_date_arg(args.end),
                   Path(args.output))
        return

    if not args.start or not args.end:
        ap.error("start, end 필수 (또는 --probe RCEPT_NO / --update 엑셀)")
    cmd_run(parse_date_arg(args.start), parse_date_arg(args.end),
            Path(args.output), only_final=not args.all_stages,
            sub_year_month=args.sub_month)


if __name__ == "__main__":
    main()
