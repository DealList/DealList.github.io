"""Stage 3 시뮬레이션 — 각 corp 의 '두 번째 [발행조건확정]' 공시 가져와서
기존 Stage 1+2 sample 에 merge (= 최종금리 보강).

기존: sample_stage12.xlsx (Stage 1+2)
대상: 5월 [발행조건확정] 한 corps 중 [발행조건확정] 이 2건 이상인 corps 의
       두 번째 [발행조건확정] (rcept_no 두 번째 작음)
신종자본/후순위채는 [발행조건확정] 1번이므로 대상에서 자동 제외.
결과: sample_stage123.xlsx
"""
from __future__ import annotations
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dart_client
import excel_writer
from main import (
    _fetch_and_parse,
    _dedup_merge,
    _merge_records,
    _post_process_records,
    _persist_auto_added,
    load_mappings,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("test_stage3")


def main():
    OUTPUT_BASE = Path(__file__).resolve().parent / "output"
    STAGE12_XLSX = OUTPUT_BASE / "sample_stage12.xlsx"
    OUTPUT_XLSX = OUTPUT_BASE / "sample_stage123.xlsx"

    existing_records, processed_rcepts = excel_writer.load_meta(STAGE12_XLSX)
    log.info("Stage 1+2 sample 로드: %d records, processed rcept %d건",
             len(existing_records), len(processed_rcepts))

    start = date(2026, 4, 1)
    end = date(2026, 5, 12)
    log.info("OpenDART list 조회 %s ~ %s", start, end)
    all_filings = dart_client.list_filings(start, end)
    log.info("증권신고서(채무증권) 총 %d건", len(all_filings))

    # 5월 [발행조건확정] 한 corp_code
    may_final_corps: set[str] = set()
    for f in all_filings:
        if f.is_final and f.rcept_dt.startswith("202605"):
            may_final_corps.add(f.corp_code)
    log.info("5월 [발행조건확정] 발생 corp: %d개", len(may_final_corps))

    # 각 corp 의 모든 [발행조건확정] rcept_no asc 정렬 → 두 번째 추출
    corp_finals: dict[str, list] = {}
    for f in all_filings:
        if f.is_final and f.corp_code in may_final_corps:
            corp_finals.setdefault(f.corp_code, []).append(f)
    for code in corp_finals:
        corp_finals[code].sort(key=lambda f: f.rcept_no)

    second_finals = []
    skipped = []
    for code, fs in corp_finals.items():
        if len(fs) >= 2:
            second_finals.append(fs[1])
        else:
            skipped.append(fs[0])

    log.info("[발행조건확정] 2건 이상 corps (Stage 3 대상): %d개", len(second_finals))
    for f in second_finals:
        log.info("  [%s] %s | %s", f.rcept_dt, f.corp_name, f.rcept_no)
    if skipped:
        log.info("[발행조건확정] 1건만 있는 corps (Stage 3 제외 — 신종자본/후순위): %d개",
                 len(skipped))
        for f in skipped:
            log.info("  - %s (rcept_no=%s)", f.corp_name, f.rcept_no)

    if not second_finals:
        log.warning("Stage 3 대상 공시 없음 — 모두 단일 [발행조건확정]")
        return

    mappings = load_mappings()
    new_records, sections_cache, unmapped = _fetch_and_parse(second_finals, mappings)
    log.info("new records (Stage 3 본문에서 파싱된 트랜치): %d건", len(new_records))
    if unmapped:
        log.warning("미매핑 증권사: %s", sorted(unmapped))

    # 후처리: 같은 corp 의 다른 [발행조건확정] 본문에서 series 별 최종금리 추출.
    # second_finals 만 fetch 했으니 same-corp 의 다른 본문 search 는 second 자체만 search.
    # parse_filing 단계에서 이미 rate_final 이 채워질 수 있고, 단일 트랜치 fallback 도 동작.
    _post_process_records(new_records, second_finals, sections_cache)

    new_records = _dedup_merge(new_records)
    log.info("dedup 후 new records: %d건", len(new_records))

    _persist_auto_added(mappings)

    # existing 과 merge
    by_key = {}
    for r in existing_records:
        by_key[(r.issuer_alias, r.series)] = r
    appended = 0
    overwritten = 0
    for r in new_records:
        k = (r.issuer_alias, r.series)
        if k in by_key:
            by_key[k] = _merge_records(by_key[k], r)
            overwritten += 1
        else:
            by_key[k] = r
            appended += 1
    merged = list(by_key.values())
    log.info("병합: 새 추가 %d, 기존 갱신 %d → 합계 %d", appended, overwritten, len(merged))

    # 최종금리 후속 보강 — 두 번째 [발행조건확정] 본문에서 series 별 추출이 parse_filing
    # 단계에서 안 됐을 가능성 대비. (parse_filing 은 정정전/정정후 group 이 둘 다 있어야
    # 트랜치 record 생성. 두 번째 [발행조건확정] 본문에 정정후만 있는 경우 추출 실패.)
    # 그래서 별도 함수로 series→rate 매핑 추출 후 existing record 의 rate_final 채움.
    from parser import _extract_rates_by_series
    boost_count = 0
    for f in second_finals:
        sections = sections_cache.get(f.rcept_no)
        if not sections:
            continue
        rates = _extract_rates_by_series(sections)
        for rec in merged:
            if rec.rate_final is not None:
                continue
            if rec.bond_type in ("신종자본", "후순위채"):
                continue
            if rec.issuer_full != f.corp_name:
                continue
            if rec.series in rates:
                rec.rate_final = rates[rec.series]
                boost_count += 1
    if boost_count:
        log.info("두 번째 [발행조건확정] 본문에서 최종금리 보강: %d행", boost_count)

    all_rcepts = sorted(set(processed_rcepts) | {f.rcept_no for f in second_finals})
    excel_writer.write(merged, OUTPUT_XLSX, processed_rcept_nos=all_rcepts)
    log.info("저장 완료: %s (총 %d행)", OUTPUT_XLSX, len(merged))


if __name__ == "__main__":
    main()
