"""H011 타겟 fix — Pattern C records (demand_amount 있는데 target/alloc 빈 records) 만 처리.

전체 validator 대신 작은 스크립트로 명시적 제어 + dart_client warnings suppress.
"""
import sys
import json
import os
import contextlib
from pathlib import Path
from datetime import date

# stderr 메시지 (DART warnings) 묶음 — PowerShell 우회용
sys.path.insert(0, str(Path(__file__).parent))

import excel_writer
import dart_client
import parser as P
from validator_fixes import FetchContext

XLSX = Path(r'C:\Users\부광우\Dropbox\문서\AI\DCM Table\DCM Table.xlsx')
META = Path(r'C:\Users\부광우\Dropbox\문서\AI\DCM Table\DCM Table.meta.json')


def parse_iso_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return None


def main():
    # meta JSON 직접 로드 (excel_writer.load_meta 가 데이터 의존성 많아서 우회)
    meta = json.loads(META.read_text(encoding='utf-8'))
    records_data = meta['records']

    # Pattern: demand_amount set + (rate_target empty OR underwriter_alloc empty)
    # 2022 records only
    targets = []
    for rd in records_data:
        sub = rd.get('subscription_date', '')
        if not sub.startswith('2022'):
            continue
        if rd.get('demand_amount'):
            if not rd.get('rate_target') or not rd.get('underwriter_alloc'):
                targets.append(rd)
    print(f'[INFO] 2022 targets: {len(targets)}', file=sys.stderr, flush=True)

    mappings = json.loads((Path(__file__).parent / 'mappings.json')
                          .read_text(encoding='utf-8'))

    ctx = FetchContext()
    fixed = 0
    failed = []
    import time

    for i, rd in enumerate(targets, 1):
        issuer = rd['issuer_alias']
        sub_date = parse_iso_date(rd.get('subscription_date'))
        if not sub_date:
            print(f'[{i}/{len(targets)}] [SKIP] {issuer} {rd["series"]}: subscription_date 없음',
                  file=sys.stderr, flush=True)
            continue
        t0 = time.time()
        print(f'[{i}/{len(targets)}] {issuer} {rd["series"]}...', file=sys.stderr, flush=True)

        # corp 의 모든 filings (60일 window) — corp_code 로 DART API 측 필터
        try:
            filings = ctx.list_all_filings_for_corp(
                issuer, sub_date, window_days=60,
                corp_code=rd.get('corp_code', ''))
        except Exception as e:
            print(f'  [FAIL list] {e}', file=sys.stderr, flush=True)
            failed.append(rd)
            continue

        # rcept_no asc 정렬 (초기 신고서 먼저)
        any_change = False
        for filing in sorted(filings, key=lambda f: f.rcept_no):
            try:
                secs = ctx.fetch_document(
                    filing.rcept_no,
                    predicate=dart_client.underwriter_title_predicate,
                    predicate_name="underwriter")
            except Exception as e:
                print(f'  [FAIL fetch] {filing.rcept_no}: {e}', file=sys.stderr, flush=True)
                continue
            if not secs:
                continue
            try:
                parse_ctx = P.ParseContext(
                    rcept_no=filing.rcept_no,
                    is_amendment=False,
                    is_final=filing.is_final,
                    corp_name=issuer,
                    corp_code=rd.get('corp_code', ''),
                )
                parsed = P.parse_filing(secs, parse_ctx, mappings)
            except Exception as e:
                print(f'  [FAIL parse] {filing.rcept_no}: {e}', file=sys.stderr)
                continue

            target_series = rd['series']
            series_base = target_series.split('-')[0] if '-' in target_series else target_series
            match = next((pr for pr in parsed if pr.series == target_series), None)
            if not match:
                match = next((pr for pr in parsed if pr.series == series_base), None)

            # parse_filing 매칭 성공 시: 빈 필드 채움
            if match:
                if not rd.get('rate_target') and match.rate_target:
                    rd['rate_target'] = match.rate_target
                    any_change = True
                if not rd.get('rate_demand') and match.rate_demand:
                    rd['rate_demand'] = match.rate_demand
                    any_change = True
                if not rd.get('underwriter_alloc') and match.underwriter_alloc:
                    rd['underwriter_alloc'] = dict(match.underwriter_alloc)
                    any_change = True
                if not rd.get('lead_managers') and match.lead_managers:
                    rd['lead_managers'] = list(match.lead_managers)
                    any_change = True
                if rd.get('rate_final') is None and match.rate_final is not None:
                    rd['rate_final'] = match.rate_final
                    any_change = True
                if rd.get('final_amount') is None and match.final_amount is not None:
                    rd['final_amount'] = match.final_amount
                    any_change = True

            # parse_filing 매칭 실패해도 hope/demand 는 본문 텍스트에서 직접 추출 시도
            if not rd.get('rate_target'):
                try:
                    hope = P._extract_hope_rate(secs)
                except Exception:
                    hope = ''
                if hope:
                    rd['rate_target'] = hope
                    any_change = True
            if not rd.get('rate_demand'):
                try:
                    demands = P._extract_demand_rates_by_series(secs)
                except Exception:
                    demands = {}
                if target_series in demands:
                    rd['rate_demand'] = demands[target_series]
                    any_change = True
                elif series_base in demands:
                    rd['rate_demand'] = demands[series_base]
                    any_change = True

        elapsed = time.time() - t0
        if any_change:
            fixed += 1
            if 'notes' not in rd:
                rd['notes'] = []
            rd['notes'].append('[H011 타겟] corp filings 종합 복원')
            print(f'  [OK {elapsed:.0f}s] target={rd.get("rate_target")!r}, '
                  f'demand={rd.get("rate_demand")!r}, leads={rd.get("lead_managers")}',
                  file=sys.stderr, flush=True)
        else:
            failed.append(rd)
            print(f'  [NO MATCH {elapsed:.0f}s]', file=sys.stderr, flush=True)
        # 매 record 후 meta 저장 (중간 중단 대비)
        if i % 5 == 0:
            META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')

    # 저장
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n[DONE] fixed={fixed}/{len(targets)}, failed={len(failed)}', file=sys.stderr)


if __name__ == '__main__':
    main()
