# -*- coding: utf-8 -*-
"""ECM 클라우드 수집기 (DB-native, C안) — DART → Supabase 직접 upsert. xlsx 미사용.

main_ecm 의 파싱 핵심(group_into_deals·process_deal·aggregate_broker_amounts)을 재사용하고,
저장/상태 계층만 Supabase 로 교체:
  - processed_rcepts : Supabase ecm_ipo/ecm_rights 의 rcept_no_* 에서 도출
  - 결과 저장 : DealResult → row dict → upsert (on_conflict stage1[,issue_seq])
  - 보호 : 기존 row 가 verified 면 덮어쓰지 않음 (수동 보정 보존)

사용: py auto/cloud_update_ecm.py <start> <end> [--dry]
   (Actions 일일 실행 = 어제~어제. finalize/KIND 는 cloud_finalize_ecm 에서 별도.)
"""
from __future__ import annotations
import argparse
import sys
from datetime import date, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import main_ecm as M
import parser_ecm
import dart_client
import config_ecm
import supabase_client as sb


def _iso(d):
    if d is None or d == "" or d == "미정":
        return None
    if isinstance(d, (date, datetime)):
        return d.isoformat()[:10]
    s = str(d)
    return s[:10] if len(s) >= 8 else None


def _brokers(m):
    return {a: round(v) for a, v in (m or {}).items() if v and v > 0}


def ipo_row(deal, res) -> dict:
    rec = res.ipo_record
    report = deal.reports[-1].rcept_no if getattr(deal, "reports", None) else None
    has_final = bool(rec.rcept_no_final)
    ld = getattr(rec, "_listing_date", None) or res.listing_date_planned
    return {
        "listing_date": _iso(ld),
        "issuer": rec.issuer, "market": rec.market or None,
        "init_qty": rec.init_qty, "init_price": rec.init_price,
        "final_qty": (rec.final_qty or rec.init_qty) if has_final else None,
        "final_price": rec.final_price if has_final else None,
        "new_share_ratio": rec.new_share_ratio,
        "inst_initial": rec.inst_initial, "inst_subscribed": rec.inst_subscribed,
        "inst_final": rec.inst_final,
        "general_initial": rec.general_initial, "general_subscribed": rec.general_subscribed,
        "general_final": rec.general_final,
        "esop_initial": rec.esop_initial, "esop_final": rec.esop_final,
        "lead_amounts": _brokers(res.lead_perf),
        "uw_amounts": _brokers(res.underwriter_amounts_eok),
        "corp_code": rec.corp_code or None,
        "rcept_no_stage1": rec.rcept_no_stage1 or None,
        "rcept_no_final": rec.rcept_no_final or None,
        "rcept_no_report": report,
    }


def rights_rows(deal, res) -> list[dict]:
    rec = res.rights_record
    report = deal.reports[-1].rcept_no if getattr(deal, "reports", None) else None
    base = {
        "record_date": _iso(rec.record_date), "issuer": rec.issuer,
        "offering_type": rec.offering_type or None, "payment_date": _iso(rec.payment_date),
        "new_qty": rec.new_qty, "existing_qty": rec.existing_qty,
        "init_qty": rec.init_qty, "init_price": rec.init_price,
        "price_1": rec.stage1_price, "price_2": rec.stage2_price, "final_price": rec.final_price,
        "lead_amounts": _brokers(res.lead_perf), "uw_amounts": _brokers(res.underwriter_amounts_eok),
        "issue_seq": 0, "corp_code": rec.corp_code or None,
        "rcept_no_stage1": rec.rcept_no_stage1 or None,
        "rcept_no_final1": rec.rcept_no_final1 or None,
        "rcept_no_final2": rec.rcept_no_final2 or None, "rcept_no_report": report,
    }
    rows = [base]
    for i, extra in enumerate(getattr(rec, "_extra_issues", None) or [], start=1):
        rows.append({
            "record_date": _iso(rec.record_date), "issuer": rec.issuer,
            "offering_type": rec.offering_type or None, "payment_date": _iso(rec.payment_date),
            "new_qty": extra.get("qty"), "existing_qty": None,
            "init_qty": extra.get("qty"), "init_price": extra.get("init_price"),
            "price_1": None, "price_2": None, "final_price": None,
            "lead_amounts": {}, "uw_amounts": {}, "issue_seq": i,
            "corp_code": rec.corp_code or None,
            "rcept_no_stage1": rec.rcept_no_stage1 or None,
            "rcept_no_final1": None, "rcept_no_final2": None, "rcept_no_report": None,
        })
    return rows


def fetch_existing():
    """Supabase 에서 processed_rcepts(set) + verified stage1(set)."""
    processed, verified = set(), set()
    for t, finals in [("ecm_ipo", ["rcept_no_final"]),
                      ("ecm_rights", ["rcept_no_final1", "rcept_no_final2"])]:
        cols = "rcept_no_stage1,rcept_no_report,verified," + ",".join(finals)
        off = 0
        while True:
            chunk = sb.select(t, cols, limit=1000, offset=off)
            if not chunk:
                break
            for r in chunk:
                for k in ["rcept_no_stage1", "rcept_no_report"] + finals:
                    if r.get(k):
                        processed.add(r[k])
                if r.get("verified") and r.get("rcept_no_stage1"):
                    verified.add(r["rcept_no_stage1"])
            if len(chunk) < 1000:
                break
            off += 1000
    return processed, verified


def _backfill(deals):
    """cmd_update 와 동일 — dropdown 으로 stage1/finals 누락 보강."""
    for d in deals:
        need = (d.stage1 is None
                or parser_ecm.classify_filing(d.stage1.report_nm) != "stage1"
                or len(d.finals) == 1)
        if not need:
            continue
        sample = d.stage1 or next((a[0] for a in (d.amends, d.finals, d.reports) if a), None)
        if sample is None:
            continue
        try:
            dropdown = dart_client.fetch_deal_filings(sample.rcept_no)
        except Exception as e:
            print(f"      [WARN] {d.corp_name} dropdown 실패: {e}")
            continue
        true_s1 = next((f for f in dropdown
                        if parser_ecm.classify_filing(f.report_nm) == "stage1"), None)
        exist = {ff.rcept_no for ff in d.finals}
        for f in dropdown:
            if f.rcept_no in exist:
                continue
            if parser_ecm.classify_filing(f.report_nm) == "final":
                f.corp_name, f.corp_code = d.corp_name, d.corp_code
                d.finals.append(f)
        d.finals.sort(key=lambda x: x.rcept_no)
        if true_s1 and d.stage1 is None:
            true_s1.corp_name, true_s1.corp_code = d.corp_name, d.corp_code
            d.stage1 = true_s1


def run_update(start: date, end: date, dry: bool = False, force: bool = False) -> dict:
    if not sb.health_check():
        raise SystemExit("Supabase 연결 실패")
    mappings = M.load_mappings()
    processed, verified = fetch_existing()
    print(f"  기존 Supabase: processed_rcept {len(processed)} / verified deal {len(verified)}")

    print(f"  [1] DART fetch: {start} ~ {end}")
    primary = dart_client.list_ecm_filings(start, end)
    new_primary = primary if force else [f for f in primary if f.rcept_no not in processed]
    print(f"      ECM 공시 {len(primary)} → 신규 {len(new_primary)}"
          + ("  [--force: 전체 재처리]" if force else ""))
    if not new_primary:
        print("  신규 공시 없음")
        return {"ipo": 0, "rights": 0, "skipped_verified": 0}

    deals = M.group_into_deals(new_primary)
    _backfill(deals)
    print(f"  [2] 딜 그룹 {len(deals)}")

    ipo_n = rt_n = skipped = errors = 0
    for deal in deals:
        if getattr(deal, "is_withdrawn", False):
            continue
        try:
            res = M.process_deal(deal)
        except Exception as e:
            print(f"    [ERROR] {deal.corp_name}: {e}")
            errors += 1
            continue
        if res is None:
            continue
        if res.kind == "ipo" and res.ipo_record is not None:
            fr = getattr(res.ipo_record, "_final_underwriter_rows", [])
            eok, leads, perf = M.aggregate_broker_amounts(fr, mappings=mappings)
            res.underwriter_amounts_eok, res.lead_aliases, res.lead_perf = eok, leads, perf
            res.listing_date_planned = getattr(res.ipo_record, "_listing_date", None)
            s1 = res.ipo_record.rcept_no_stage1
            if not s1:
                print(f"    [SKIP] {deal.corp_name} stage1 없음")
                continue
            if s1 in verified:
                print(f"    [verified 보호] {deal.corp_name} — upsert skip")
                skipped += 1
                continue
            row = ipo_row(deal, res)
            if not dry:
                sb.delete("ecm_ipo", {"rcept_no_stage1": "eq." + s1})
                sb.insert("ecm_ipo", [row])
            ipo_n += 1
            print(f"    [IPO] {row['issuer']} (stage1={s1}) → upsert")
        elif res.kind == "rights" and res.rights_record is not None:
            uw = getattr(res.rights_record, "_final_underwriter_amounts", [])
            eok, leads, perf = M.aggregate_broker_amounts(uw, mappings=mappings)
            res.underwriter_amounts_eok, res.lead_aliases, res.lead_perf = eok, leads, perf
            s1 = res.rights_record.rcept_no_stage1
            if not s1:
                print(f"    [SKIP] {deal.corp_name} stage1 없음")
                continue
            if s1 in verified:
                print(f"    [verified 보호] {deal.corp_name} — upsert skip")
                skipped += 1
                continue
            rows = rights_rows(deal, res)
            if not dry:
                sb.delete("ecm_rights", {"rcept_no_stage1": "eq." + s1})
                sb.insert("ecm_rights", rows)
            rt_n += 1
            print(f"    [유증] {rows[0]['issuer']} (stage1={s1}, {len(rows)}행) → upsert")

    if not dry:
        M.persist_auto_added(mappings)
    print(f"\n  === 완료 === IPO {ipo_n} / 유증 {rt_n} upsert / verified보호 {skipped} / 오류 {errors}")
    return {"ipo": ipo_n, "rights": rt_n, "skipped_verified": skipped, "errors": errors}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("start")
    ap.add_argument("end")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true", help="이미 처리된 딜도 재처리 (테스트용)")
    a = ap.parse_args()
    s = datetime.strptime(a.start, "%Y-%m-%d").date()
    e = datetime.strptime(a.end, "%Y-%m-%d").date()
    run_update(s, e, dry=a.dry, force=a.force)


if __name__ == "__main__":
    main()
