# -*- coding: utf-8 -*-
"""DCM records 의 최초 증권신고서 공시일(disclosure_date) 백필.

방식 A — OpenDART list API only (본문 스크래핑 0 → IP 차단 무관):
  1. 대상 records 의 고유 corp_code 추출
  2. corp 별로 증권신고서(채무증권) '최초 신고'([기재정정]/[발행조건확정] 제외) 목록을
     list API 로 조회 → 각 신고의 접수일자(rcept_dt = 접수번호 앞 8자리 = 공시일)
  3. records 각 행을 (corp_code, subscription_date) 로 매칭 →
     같은 corp 의 최초 신고서 중 청약일 직전(<=) 가장 가까운 rcept_dt = 최초 공시일
  4. records.disclosure_date 를 batch upsert (PK = issuer_alias,series,subscription_date)

기본은 disclosure_date 가 비어있는 행만 채움(증분). --all 이면 전체 재계산.
워크플로(data-update.yml) 의 export 직전에 호출하면 매 수집 후 신규 건이 자동으로 채워짐.

corp_code 지정 시 DART list API 는 기간 3개월 제한이 풀려 8년치를 한 번에 받을 수 있어
corp 당 1~2 호출이면 충분 (전체 ~수 분, 일일 한도 2만 대비 여유).
"""
from __future__ import annotations
import argparse
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import config
import dart_client
import supabase_client as sb

START = date(2018, 1, 1)  # records 최古(2019~)보다 이르게 — 청약일 직전 신고서 포착


def _compact(iso) -> str:
    """'YYYY-MM-DD' → 'YYYYMMDD'."""
    return str(iso or "")[:10].replace("-", "")


def _iso(compact) -> str:
    """'YYYYMMDD' → 'YYYY-MM-DD'."""
    s = str(compact or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else ""


def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def fetch_records(only_null: bool):
    """records 전체 조회 (PK + corp_code + disclosure_date)."""
    out, off = [], 0
    cols = "issuer_alias,series,subscription_date,corp_code,disclosure_date"
    while True:
        rows = sb.select("records", cols, limit=1000, offset=off)
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 1000:
            break
        off += 1000
    if only_null:
        out = [r for r in out if not r.get("disclosure_date")]
    return out


def build_stage1_index(corp_codes, end):
    """증권신고서(채무증권) 최초신고 → {corp_code: sorted [rcept_dt(YYYYMMDD)]}.

    대상 corp 가 많으면(첫 전체 백필) **전체기간 1회 조회**가 압도적으로 빠름
    (89일 청크 자동분할 ~수십 호출, ~3-5분). corp 별 개별 조회는 corp 수백 개일 때
    수백 호출이 되어 timeout 위험 → 첫 백필은 반드시 전체 조회.
    적으면(매일 증분) 신규 corp 만 개별 조회.
    """
    target = {c for c in corp_codes if c}
    idx = defaultdict(list)

    def _keep(f):
        # 최초 증권신고서(채무증권)만: 접두어([기재정정]/[발행조건확정]) 없고 철회 아님
        return ("증권신고서(채무증권)" in f.report_nm and f.is_initial
                and f.rcept_dt and f.rm != "철")

    if len(target) > 40:
        # 전체기간 한 번에 (corp_code 없이) — 모든 corp 의 stage1 을 한 방에
        print(f"전체 list 조회 (대상 corp {len(target)}개, {START}~{end}) ...")
        filings = dart_client.list_filings(START, end, only_bond_registration=True)
        kept = [f for f in filings if _keep(f) and f.corp_code in target]
        print(f"  채무증권 신고 {len(filings)}건 중 대상 최초신고 {len(kept)}건")
        for f in kept:
            idx[f.corp_code].append(f.rcept_dt)
    else:
        # 증분 — 신규 corp 만 개별 조회 (corp_code 지정 시 기간제한 없이 1회)
        corps = sorted(target)
        print(f"개별 조회 (corp {len(corps)}개) ...")
        for cc in corps:
            try:
                filings = dart_client._list_filings_chunk(START, end, corp_code=cc)
            except Exception as e:
                print(f"  corp={cc} 조회 실패: {e}")
                time.sleep(config.REQUEST_SLEEP)
                continue
            for f in filings:
                if _keep(f):
                    idx[cc].append(f.rcept_dt)
            time.sleep(config.REQUEST_SLEEP)

    for c in idx:
        idx[c].sort()
    return idx


def match(records, idx):
    """각 record → 최초 공시일. 같은 corp 의 최초신고 중 청약일 직전(<=) 가장 가까운 것."""
    updates, miss = [], 0
    for r in records:
        cc = r.get("corp_code")
        sub = _compact(r.get("subscription_date"))
        if not cc or not sub:
            miss += 1
            continue
        cands = [d for d in idx.get(cc, []) if d <= sub]
        if not cands:
            miss += 1
            continue
        updates.append({
            "issuer_alias": r["issuer_alias"],
            "series": r["series"],
            "subscription_date": str(r["subscription_date"])[:10],
            "disclosure_date": _iso(max(cands)),  # 청약일 직전 가장 가까운 최초 신고
        })
    return updates, miss


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="전체 재계산 (기본: disclosure_date 미설정 행만)")
    ap.add_argument("--dry-run", action="store_true",
                    help="DB 미반영 — 매칭 결과만 출력")
    args = ap.parse_args()

    if not sb.health_check():
        raise SystemExit("Supabase 연결 실패")

    records = fetch_records(only_null=not args.all)
    label = "전체" if args.all else "disclosure_date 미설정"
    print(f"대상 records: {len(records)}건 ({label})")
    if not records:
        print("채울 대상 없음 — 종료")
        return

    idx = build_stage1_index([r.get("corp_code") for r in records], date.today())
    updates, miss = match(records, idx)
    print(f"매칭 성공 {len(updates)}건 / 미매칭 {miss}건")

    if args.dry_run:
        for u in updates[:25]:
            print(f"  {u['subscription_date']} {u['issuer_alias']} {u['series']}"
                  f"  ← 공시 {u['disclosure_date']}")
        print("(dry-run — DB 미반영)")
        return

    if not updates:
        print("업데이트할 매칭 없음 — 종료")
        return

    total = 0
    for batch in chunk(updates, 200):
        sb.upsert("records", batch, on_conflict="issuer_alias,series,subscription_date")
        total += len(batch)
        print(f"  upsert {total}/{len(updates)}")
    print(f"[ok] disclosure_date 백필 {total}건")


if __name__ == "__main__":
    main()
