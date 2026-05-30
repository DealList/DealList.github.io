# -*- coding: utf-8 -*-
"""ECM 클라우드 finalize + KIND recheck (DB-native).

main_ecm 의 _finalize_overdue_ipo_reports / _recheck_kind_for_unfinalized_ipo 를
Supabase 대상으로 포팅:
  - finalize: 미마감 IPO(보고서 미수집+발행조건확정 도달) → 증권발행실적보고서 검색 →
              parse_ipo_report → row PATCH (확정 상장일·청약결과·broker fallback·rcept_no_report)
  - KIND: 미마감 IPO → KIND 상장예정일 재확인 → listing_date PATCH
  - verified row 는 모두 skip (수동 보정 보존)

사용: py auto/cloud_finalize_ecm.py [--dry]
"""
from __future__ import annotations
import argparse
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import dart_client
import parser_ecm
import kind_client
import supabase_client as sb


def _d(s):
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except (ValueError, TypeError):
        return None


def fetch_ipo():
    out, off = [], 0
    while True:
        c = sb.select("ecm_ipo", "*", limit=1000, offset=off)
        if not c:
            break
        out.extend(c)
        if len(c) < 1000:
            break
        off += 1000
    return out


def is_finalized_by_data(r):
    return (r.get("inst_initial") is not None or r.get("general_initial") is not None
            or r.get("esop_initial") is not None)


def finalize(today, dry=False):
    rows = fetch_ipo()
    n = 0
    for r in rows:
        if r.get("verified") or r.get("rcept_no_report"):
            continue
        if not r.get("rcept_no_final") or not r.get("corp_code"):
            continue
        a_un = not r.get("listing_date")
        l_empty = r.get("inst_initial") is None
        brokers_empty = not (r.get("lead_amounts") or r.get("uw_amounts"))
        if not (a_un or l_empty or brokers_empty):
            continue
        ld = _d(r.get("listing_date"))
        if ld:
            if ld > today + timedelta(days=7):
                continue
            ss, se = ld - timedelta(days=7), min(today + timedelta(days=7), ld + timedelta(days=90))
        else:
            f = r["rcept_no_final"]
            if len(f) < 8:
                continue
            try:
                fd = date(int(f[:4]), int(f[4:6]), int(f[6:8]))
            except ValueError:
                continue
            if fd + timedelta(days=60) < today:
                continue
            ss, se = fd, min(today + timedelta(days=7), fd + timedelta(days=90))
        try:
            filings = dart_client.list_ecm_filings(start=ss, end=se, corp_code=r["corp_code"])
        except Exception as e:
            print(f"  [WARN] {r['issuer']} 보고서 검색 실패: {e}")
            continue
        report_f = next((f for f in filings
                         if "증권발행실적보고서" in (f.report_nm or "").replace(" ", "")), None)
        if not report_f:
            print(f"  [PENDING] {r['issuer']} 실적보고서 아직 없음")
            continue
        try:
            secs = dart_client.fetch_full_document(
                report_f.rcept_no, title_predicate=dart_client.ecm_report_strict_predicate)
        except Exception as e:
            print(f"  [WARN] {r['issuer']} report fetch 실패: {e}")
            continue
        report = parser_ecm.parse_ipo_report(secs, report_f.rcept_no)
        patch = {}
        lc = report.get("listing_date_confirmed")
        if lc and r.get("rcept_no_stage1"):
            lc = parser_ecm._maybe_fix_listing_date_typo(lc, r["rcept_no_stage1"])
        if lc:
            patch["listing_date"] = lc.isoformat()[:10]
        # 주의: inst_subscribed(M, 기관 수요예측 수량)는 보고서로 덮지 않는다.
        # 사용자 룰 2026-05-25 — M 은 [발행조건확정] 수요예측 합만 사용.
        # 보고서의 청약현황수량(=배정수량)으로 덮으면 기관 경쟁률이 1.0 으로 망가짐.
        for k in ("inst_initial", "inst_final",
                  "general_initial", "general_subscribed", "general_final",
                  "esop_initial", "esop_final"):
            if report.get(k) is not None:
                patch[k] = report[k]
        if brokers_empty and report.get("underwriter_amounts"):
            from collections import defaultdict
            agg = defaultdict(float)
            for ua in report["underwriter_amounts"]:
                alias = parser_ecm.broker_alias(ua.get("name", ""))
                amt = ua.get("amount_won") or 0
                if alias and amt:
                    agg[alias] += amt / 1e8
            if agg:
                m = {a: round(v) for a, v in agg.items() if v > 0}
                patch["lead_amounts"] = m
                patch["uw_amounts"] = m
        patch["rcept_no_report"] = report_f.rcept_no
        if not dry:
            sb.update("ecm_ipo", {"id": "eq." + str(r["id"])}, patch)
        n += 1
        print(f"  [FIX] {r['issuer']} → report={report_f.rcept_no}, "
              f"상장일={patch.get('listing_date','(유지)')}")
    print(f"  finalize: {n}건 마감")
    return n


_kind_cache = {}
def recheck_kind(dry=False):
    rows = fetch_ipo()
    checked = updated = 0
    for r in rows:
        if r.get("verified") or r.get("rcept_no_report"):
            continue
        if is_finalized_by_data(r):
            continue
        name = r.get("issuer")
        if not name:
            continue
        checked += 1
        if name not in _kind_cache:
            try:
                sch = kind_client.fetch_listing_schedule(name)
                _kind_cache[name] = sch.listing_date_planned if sch else None
            except Exception:
                _kind_cache[name] = None
        kd = _kind_cache[name]
        if not kd:
            continue
        cur = _d(r.get("listing_date"))
        if cur == kd:
            continue
        if not dry:
            sb.update("ecm_ipo", {"id": "eq." + str(r["id"])}, {"listing_date": kd.isoformat()[:10]})
        updated += 1
        print(f"  [KIND] {name}: {cur or '미정'} → {kd}")
    print(f"  KIND 재확인: {checked}건 조회 / {updated}건 갱신")
    return updated


def warn_suspicious_inst():
    """기관청약(M)==기관최초배정(L) IPO 경고 — 보고서가 M 을 덮어쓴 시그니처(기관경쟁률 1.0).

    2026-05-30 버그(보고서 청약현황수량이 M 덮어씀)의 재발 조기경보. verified 는 제외.
    Actions 로그에 [DATA_WARN] 으로 노출.
    """
    rows = fetch_ipo()
    hits = [r for r in rows
            if not r.get("verified")
            and isinstance(r.get("inst_initial"), (int, float))
            and isinstance(r.get("inst_subscribed"), (int, float))
            and r["inst_initial"] > 0
            and r["inst_subscribed"] == r["inst_initial"]]
    if hits:
        print(f"  [DATA_WARN] 기관청약==기관최초배정 의심 {len(hits)}건 "
              f"(기관경쟁률 1.0 — 보고서가 M 덮어쓴 흔적? [발행조건확정] 값으로 복구 필요):",
              flush=True)
        for r in hits:
            print(f"    - {r.get('issuer')} (id={r.get('id')}): "
                  f"L=M={r.get('inst_initial'):,}", flush=True)
    else:
        print("  [check] 기관청약 이상 없음 (M==L IPO 0건)")
    return len(hits)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    if not sb.health_check():
        raise SystemExit("Supabase 연결 실패")
    today = date.today()
    print(f"=== ECM finalize + KIND (today={today}) ===")
    finalize(today, dry=a.dry)
    recheck_kind(dry=a.dry)
    warn_suspicious_inst()


if __name__ == "__main__":
    main()
