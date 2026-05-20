"""3단계 시스템 Stage 1 (초기 증권신고서) 만 처리한 샘플 엑셀 생성.

5월에 [발행조건확정] 된 corps 의 초기 '증권신고서(채무증권)' 공시만 fetch + parse
→ Stage 2 필드 (수요/최종/주관/인수) 자동 제거 → 샘플 xlsx 저장.

사용 시나리오: 실제 시장에선 이미 [발행조건확정] 까지 진행된 발행건이라도,
"만약 아직 초기 신고서 단계라면" 1단계 데이터가 어떻게 보일지 검증.
"""
from __future__ import annotations
import logging
import sys
from datetime import date
from pathlib import Path

# auto/ 디렉터리 import path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dart_client
import excel_writer
from main import (
    _fetch_and_parse,
    _dedup_merge,
    _post_process_records,
    load_mappings,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("test_stage1")


def main():
    # 1) 광범위 list 조회 (5월 [발행조건확정] 의 초기 공시는 보통 4월에 있음)
    start = date(2026, 4, 1)
    end = date(2026, 5, 12)
    log.info("OpenDART list 조회 %s ~ %s", start, end)
    all_filings = dart_client.list_filings(start, end)
    log.info("증권신고서(채무증권) 총 %d건", len(all_filings))

    # 2) 5월에 [발행조건확정] 된 corp_code 찾기 — 이게 "올해 5월 들어 나온 공시" 대상
    may_final_corps: set[str] = set()
    for f in all_filings:
        if f.is_final and f.rcept_dt.startswith("202605"):
            may_final_corps.add(f.corp_code)
    log.info("5월 [발행조건확정] 발생 corp 수: %d", len(may_final_corps))

    # 3) 그 corp 들의 초기 '증권신고서(채무증권)' 공시만 추출
    #    (corp 당 여러 개 있을 수 있으니 모두 처리 후 _dedup_merge 가 (corp, series) 단위로 합침)
    initials = [
        f for f in all_filings
        if f.is_initial and f.corp_code in may_final_corps
    ]
    log.info("대상 초기 증권신고서: %d건", len(initials))
    if not initials:
        log.warning("초기 공시 못 찾음. 조회 기간을 더 넓혀야 할 수 있음.")
        return

    for f in initials:
        log.info("  [%s] %s (%s)", f.rcept_dt, f.corp_name, f.rcept_no)

    # 4) fetch + parse — Stage 1 모드 (is_initial=True 라 _wipe_stage2_fields 자동 호출됨)
    mappings = load_mappings()
    records, sections_cache, unmapped = _fetch_and_parse(initials, mappings)
    log.info("파싱 결과 records: %d건", len(records))

    # 5) 병합 (같은 corp+series 중복 제거)
    records = _dedup_merge(records)
    log.info("dedup 후 records: %d건", len(records))

    # 6) 후처리 — 이 케이스는 [발행조건확정] 없으니 최종금리 보강 / 회차합산 모두 no-op
    _post_process_records(records, initials, sections_cache)

    # 7) 저장
    output = Path(__file__).resolve().parent / "output" / "sample_stage1_only.xlsx"
    excel_writer.write(records, output,
                       processed_rcept_nos=[f.rcept_no for f in initials])
    log.info("저장 완료: %s (총 %d행)", output, len(records))


if __name__ == "__main__":
    main()
