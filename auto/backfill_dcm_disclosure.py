# -*- coding: utf-8 -*-
"""DCM records 의 최초 증권신고서 공시일(disclosure_date) 백필.

방식 A — OpenDART list API only (본문 스크래핑 0 → IP 차단 무관):
  1. 전체기간 증권신고서(채무증권) '최초신고'([기재정정]/[발행조건확정]/철회 제외) 목록 수집
  2. corp_code 인덱스 + 발행사명(정규화) 인덱스 둘 다 구성
  3. records 매칭: corp_code 우선, 없으면(옛 엑셀 마이그레이션 건) issuer_full → issuer_alias
     를 발행사명으로 매칭 → 같은 발행사의 최초신고 중 청약일 직전(<=) 가장 가까운
     rcept_dt(접수일 = 접수번호 앞 8자리) = 최초 공시일
  4. records.disclosure_date 를 batch upsert (PK = issuer_alias,series,subscription_date)

기본은 disclosure_date 미설정 행만(증분). --all 전체 재계산. --dry-run 미반영.
전체기간 1회 조회(89일 청크 자동분할) ~수 분, list API only 라 IP 차단 무관.
"""
from __future__ import annotations
import argparse
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent))

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


def _norm(name) -> str:
    """발행사명 정규화 — 공백/㈜/(주)/(유)/주식회사 제거 + 소문자 (issuer ↔ DART corp_name 매칭)."""
    return re.sub(r"\s|㈜|\(주\)|\(유\)|주식회사", "", str(name or "")).lower()


def _keep(f) -> bool:
    """최초 증권신고서(채무증권)만: 접두어([기재정정]/[발행조건확정]) 없고 철회 아님."""
    return ("증권신고서(채무증권)" in f.report_nm and f.is_initial
            and f.rcept_dt and f.rm != "철")


def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def fetch_records(only_null: bool):
    """records 조회 (PK + issuer_full + corp_code + disclosure_date)."""
    out, off = [], 0
    cols = "issuer_alias,issuer_full,series,subscription_date,corp_code,disclosure_date"
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


def build_indexes(end):
    """전체기간 증권신고서(채무증권) 최초신고 → (by_corp, by_name).

    corp_code 인덱스(자동수집 건) + 발행사명 정규화 인덱스(옛 엑셀 건 = corp_code 없음).
    """
    print(f"전체 list 조회 ({START} ~ {end}) ...")
    filings = dart_client.list_filings(START, end, only_bond_registration=True)
    by_corp, by_name = defaultdict(list), defaultdict(list)
    n = 0
    for f in filings:
        if not _keep(f):
            continue
        n += 1
        if f.corp_code:
            by_corp[f.corp_code].append(f.rcept_dt)
        nm = _norm(f.corp_name)
        if nm:
            by_name[nm].append(f.rcept_dt)
    print(f"  채무증권 신고 {len(filings)}건 중 최초신고 {n}건 "
          f"(corp {len(by_corp)} / 발행사명 {len(by_name)})")
    for d in (by_corp, by_name):
        for k in list(d):
            d[k].sort()
    return by_corp, by_name


def match(records, by_corp, by_name):
    """corp_code 우선, 없으면 issuer_full → issuer_alias(정규화). 청약일 직전 최초신고."""
    updates, miss, via_name = [], 0, 0
    for r in records:
        sub = _compact(r.get("subscription_date"))
        if not sub:
            miss += 1
            continue
        cc = r.get("corp_code")
        cands = [d for d in by_corp.get(cc, []) if d <= sub] if cc else []
        if not cands:
            # corp_code 없는 옛 엑셀 건 → 발행사명으로 매칭
            for nm in (r.get("issuer_full"), r.get("issuer_alias")):
                key = _norm(nm)
                if key and key in by_name:
                    c2 = [d for d in by_name[key] if d <= sub]
                    if c2:
                        cands = c2
                        via_name += 1
                        break
        if not cands:
            miss += 1
            continue
        updates.append({
            "issuer_alias": r["issuer_alias"],
            "series": r["series"],
            "subscription_date": str(r["subscription_date"])[:10],
            "disclosure_date": _iso(max(cands)),  # 청약일 직전 가장 가까운 최초신고
        })
    if via_name:
        print(f"  (발행사명으로 보강 매칭: {via_name}건)")
    return updates, miss


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="전체 재계산 (기본: disclosure_date 미설정 행만)")
    ap.add_argument("--dry-run", action="store_true", help="DB 미반영 — 매칭만 출력")
    args = ap.parse_args()

    if not sb.health_check():
        raise SystemExit("Supabase 연결 실패")

    records = fetch_records(only_null=not args.all)
    print(f"대상 records: {len(records)}건 ({'전체' if args.all else 'disclosure_date 미설정'})")
    if not records:
        print("채울 대상 없음 — 종료")
        return

    by_corp, by_name = build_indexes(date.today())
    updates, miss = match(records, by_corp, by_name)
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
