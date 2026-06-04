# -*- coding: utf-8 -*-
"""DCM records 의 최초 증권신고서 공시일(disclosure_date) 백필.

방식 A — OpenDART list API only (본문 0건 → IP 차단 무관). 전체 8년 목록을 받지 않고,
대상 발행사만 corp_code 로 콕 집어 조회 → 빠름.

  1. records 전체에서 issuer → corp_code 맵 구성 (corp_code 있는 자동수집 건에서)
  2. corp_code 없는 옛 엑셀 건은 발행사명으로 corp_code 를 빌려옴
  3. 대상의 고유 corp_code 만 개별 조회 (corp_code 지정 → 기간제한 없이 1회, corp당 1~2 페이지)
     → 증권신고서(채무증권) 최초신고([기재정정]/[발행조건확정]/철회 제외) 의 rcept_dt
  4. records 매칭: 같은 corp 의 최초신고 중 청약일 직전(<=) 가장 가까운 것 = 최초 공시일
  5. records.disclosure_date batch upsert (PK = issuer_alias,series,subscription_date)

기본은 disclosure_date 미설정 행만(증분). --all 전체 재계산. --dry-run 미반영.
"""
from __future__ import annotations
import argparse
import re
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

START = date(2018, 1, 1)  # records 최古(2019~)보다 이르게


def _compact(iso) -> str:
    return str(iso or "")[:10].replace("-", "")


def _iso(compact) -> str:
    s = str(compact or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 and s[:8].isdigit() else ""


def _norm(name) -> str:
    """발행사명 정규화 — 공백/㈜/(주)/(유)/주식회사 제거 + 소문자."""
    return re.sub(r"\s|㈜|\(주\)|\(유\)|주식회사", "", str(name or "")).lower()


def _keep(f) -> bool:
    """최초 증권신고서(채무증권)만: 접두어([기재정정]/[발행조건확정]) 없고 철회 아님."""
    return ("증권신고서(채무증권)" in f.report_nm and f.is_initial
            and f.rcept_dt and f.rm != "철")


def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def fetch_records():
    """records 전체 조회 (PK + issuer_full + corp_code + disclosure_date)."""
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
    return out


def build_issuer_corp_map(all_records):
    """corp_code 있는 행에서 norm(issuer) → corp_code (옛 엑셀 건이 빌려 씀)."""
    m = {}
    for r in all_records:
        cc = r.get("corp_code")
        if not cc:
            continue
        for nm in (r.get("issuer_full"), r.get("issuer_alias")):
            key = _norm(nm)
            if key and key not in m:
                m[key] = cc
    return m


def resolve_corp(r, issuer_corp):
    """행의 corp_code (없으면 발행사명으로 빌림)."""
    cc = r.get("corp_code")
    if cc:
        return cc
    for nm in (r.get("issuer_full"), r.get("issuer_alias")):
        cc = issuer_corp.get(_norm(nm))
        if cc:
            return cc
    return None


def build_corp_index(corp_codes, end):
    """대상 corp 들의 증권신고서(채무증권) 최초신고 → {corp_code: sorted [rcept_dt]}.

    corp_code 지정 → 기간제한 없이 1회 조회 (corp당 보통 1~2 페이지) → 전체 목록 대비 훨씬 빠름.
    """
    idx = defaultdict(list)
    corps = sorted({c for c in corp_codes if c})
    print(f"DART 조회: {len(corps)}개 발행사의 증권신고서(채무증권) 최초신고 ...")
    fail = 0
    for i, cc in enumerate(corps, 1):
        try:
            filings = dart_client._list_filings_chunk(START, end, corp_code=cc)
        except Exception as e:
            fail += 1
            print(f"  corp={cc} 조회 실패: {e}")
            time.sleep(config.REQUEST_SLEEP)
            continue
        for f in filings:
            if _keep(f):
                idx[cc].append(f.rcept_dt)
        if i % 50 == 0:
            print(f"  {i}/{len(corps)} ...")
        time.sleep(config.REQUEST_SLEEP)
    for c in idx:
        idx[c].sort()
    if fail:
        print(f"  (조회 실패 corp {fail}개)")
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="전체 재계산 (기본: disclosure_date 미설정 행만)")
    ap.add_argument("--dry-run", action="store_true", help="DB 미반영 — 매칭만 출력")
    args = ap.parse_args()

    if not sb.health_check():
        raise SystemExit("Supabase 연결 실패")

    all_records = fetch_records()
    issuer_corp = build_issuer_corp_map(all_records)
    targets = all_records if args.all else [r for r in all_records if not r.get("disclosure_date")]
    print(f"대상 records: {len(targets)}건 ({'전체' if args.all else 'disclosure_date 미설정'})")
    if not targets:
        print("채울 대상 없음 — 종료")
        return

    # 각 대상의 corp_code 해석 (없으면 발행사명으로 빌림)
    resolved, no_corp = [], 0
    for r in targets:
        cc = resolve_corp(r, issuer_corp)
        if cc:
            r["_corp"] = cc
            resolved.append(r)
        else:
            no_corp += 1
    print(f"  corp 해석 {len(resolved)}건 / corp 못 찾음 {no_corp}건")
    if not resolved:
        print("조회할 corp 없음 — 종료")
        return

    idx = build_corp_index([r["_corp"] for r in resolved], date.today())

    updates, miss = [], 0
    for r in resolved:
        sub = _compact(r.get("subscription_date"))
        cands = [d for d in idx.get(r["_corp"], []) if d and sub and d <= sub]
        if not cands:
            miss += 1
            continue
        updates.append({
            "issuer_alias": r["issuer_alias"],
            "series": r["series"],
            "subscription_date": str(r["subscription_date"])[:10],
            "disclosure_date": _iso(max(cands)),
        })
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
