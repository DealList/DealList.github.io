"""Stage 2 시뮬레이션 — 각 corp 의 '첫 번째 [발행조건확정]' 공시만 가져와서
기존 Stage 1 sample 에 merge.

기존: sample_stage1_only.xlsx (Stage 1 만 11 records)
대상: 5월 [발행조건확정] 한 corps 의 각 corp 별 가장 빠른 [발행조건확정] 공시 (rcept_no asc)
결과: sample_stage12.xlsx (Stage 1 + Stage 2 merged)
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
log = logging.getLogger("test_stage2")


def main():
    OUTPUT_BASE = Path(__file__).resolve().parent / "output"
    STAGE1_XLSX = OUTPUT_BASE / "sample_stage1_only.xlsx"
    OUTPUT_XLSX = OUTPUT_BASE / "sample_stage12.xlsx"

    # 1) Stage 1 sample 로드
    existing_records, processed_rcepts = excel_writer.load_meta(STAGE1_XLSX)
    log.info("Stage 1 sample 로드: %d records, processed rcept %d건",
             len(existing_records), len(processed_rcepts))

    # 2) Apr-May 조회
    start = date(2026, 4, 1)
    end = date(2026, 5, 12)
    log.info("OpenDART list 조회 %s ~ %s", start, end)
    all_filings = dart_client.list_filings(start, end)
    log.info("증권신고서(채무증권) 총 %d건", len(all_filings))

    # 3) 5월 [발행조건확정] 한 corp_code 추출
    may_final_corps: set[str] = set()
    for f in all_filings:
        if f.is_final and f.rcept_dt.startswith("202605"):
            may_final_corps.add(f.corp_code)
    log.info("5월 [발행조건확정] 발생 corp: %d개", len(may_final_corps))

    # 4) 각 corp 의 모든 [발행조건확정] 중 첫 번째 (rcept_no 가장 작음) 만 추출
    corp_first_final: dict[str, object] = {}
    for f in all_filings:
        if not f.is_final or f.corp_code not in may_final_corps:
            continue
        cur = corp_first_final.get(f.corp_code)
        if cur is None or f.rcept_no < cur.rcept_no:
            corp_first_final[f.corp_code] = f

    first_finals = list(corp_first_final.values())
    log.info("처리 대상 (각 corp 의 첫 [발행조건확정]): %d건", len(first_finals))
    for f in first_finals:
        log.info("  [%s] %s | %s", f.rcept_dt, f.corp_name, f.rcept_no)

    if not first_finals:
        log.warning("대상 [발행조건확정] 공시 없음")
        return

    # 5) fetch + parse (is_final=True 라 _fetch_and_parse 가 자동으로 풀 fetch — 섹션 필터 X)
    mappings = load_mappings()
    new_records, sections_cache, unmapped = _fetch_and_parse(first_finals, mappings)
    log.info("new records: %d건", len(new_records))
    if unmapped:
        log.warning("미매핑 증권사: %s", sorted(unmapped))

    # 6) 후처리 — 같은 update 사이클 내 [발행조건확정] 만 모인 상태라 보통 series_total 계산만 동작
    _post_process_records(new_records, first_finals, sections_cache)

    # 7) 같은 cycle Stage 1+2 merge (이 케이스는 first_finals 만 fetch 했으니 사실 no-op)
    new_records = _dedup_merge(new_records)
    log.info("dedup 후 new records: %d건", len(new_records))

    _persist_auto_added(mappings)

    # 8) Stage 1 existing + Stage 2 new merge
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

    # 9) 저장
    all_rcepts = sorted(set(processed_rcepts) | {f.rcept_no for f in first_finals})
    excel_writer.write(merged, OUTPUT_XLSX, processed_rcept_nos=all_rcepts)
    log.info("저장 완료: %s (총 %d행)", OUTPUT_XLSX, len(merged))


if __name__ == "__main__":
    main()
