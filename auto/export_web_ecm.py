# -*- coding: utf-8 -*-
"""Supabase ecm_ipo / ecm_rights → web/ecm_data.json (+ meta, summary).

C안: Supabase 가 master. 여기서 직접 읽어 파생값(총액·경쟁률·비율) 계산 후
정적 JSON 으로 떨군다. 웹 페이지(정보/실적/인포그래픽)가 이 JSON 을 fetch.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import supabase_client as sb
import config_ecm

KST = ZoneInfo("Asia/Seoul")
WEB = ROOT.parent / "web"


def _now():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def fetch_all(table):
    out, off = [], 0
    while True:
        c = sb.select(table, "*", limit=1000, offset=off)
        if not c:
            break
        out.extend(c)
        if len(c) < 1000:
            break
        off += 1000
    return out


def _n(v):
    return v if isinstance(v, (int, float)) else None


def _eok(qty, price):
    """억원 총액 = round(qty*price/1e8)."""
    if isinstance(qty, (int, float)) and isinstance(price, (int, float)):
        return round(qty * price / 1e8)
    return None


def _ratio(num, den):
    if isinstance(num, (int, float)) and isinstance(den, (int, float)) and den:
        return round(num / den, 2)
    return None


def ipo_record(r: dict) -> dict:
    iq, ip = _n(r.get("init_qty")), _n(r.get("init_price"))
    fq, fp = _n(r.get("final_qty")), _n(r.get("final_price"))
    nr = _n(r.get("new_share_ratio"))
    li, ls, lf = _n(r.get("inst_initial")), _n(r.get("inst_subscribed")), _n(r.get("inst_final"))
    gi, gs, gf = _n(r.get("general_initial")), _n(r.get("general_subscribed")), _n(r.get("general_final"))
    ei, ef = _n(r.get("esop_initial")), _n(r.get("esop_final"))
    return {
        "date": r.get("listing_date") or "",        # 상장일 ("" = 미정)
        "issuer": r.get("issuer") or "",
        "market": r.get("market") or "",
        "init_qty": iq, "init_price": ip, "init_total": _eok(iq, ip),
        "final_qty": fq, "final_price": fp, "final_total": _eok(fq, fp),
        "new_ratio": nr, "old_ratio": (round(1 - nr, 4) if nr is not None else None),
        "inst": {"initial": li, "subscribed": ls, "compete": _ratio(ls, li), "final": lf},
        "general": {"initial": gi, "subscribed": gs, "compete": _ratio(gs, gi), "final": gf},
        "esop": {"initial": ei, "final": ef, "rate": _ratio(ef, ei)},
        "leads": r.get("lead_amounts") or {},
        "uw": r.get("uw_amounts") or {},
        "rcept": r.get("rcept_no_stage1") or "",
    }


def rights_record(r: dict) -> dict:
    e, f = _n(r.get("new_qty")), _n(r.get("existing_qty"))
    iq, ip = _n(r.get("init_qty")), _n(r.get("init_price"))
    k, m, o = _n(r.get("price_1")), _n(r.get("price_2")), _n(r.get("final_price"))
    return {
        "date": r.get("record_date") or "",         # 신주배정기준일
        "issuer": r.get("issuer") or "",
        "type": r.get("offering_type") or "",
        "payment": r.get("payment_date") or "",
        "new_qty": e, "existing_qty": f,
        "increase_ratio": _ratio(e, f),
        "init_qty": iq, "init_price": ip, "init_total": _eok(iq, ip),
        "price_1": k, "total_1": _eok(e, k),
        "price_2": m, "total_2": _eok(e, m),
        "final_price": o, "final_total": _eok(e, o),
        "leads": r.get("lead_amounts") or {},
        "uw": r.get("uw_amounts") or {},
        "seq": r.get("issue_seq") or 0,
        "rcept": r.get("rcept_no_stage1") or "",
    }


def main():
    print("Supabase → ecm_ipo / ecm_rights 조회...")
    ipo_raw = fetch_all("ecm_ipo")
    rt_raw = fetch_all("ecm_rights")
    print(f"  ipo {len(ipo_raw)} / rights {len(rt_raw)}")

    ipo = [ipo_record(r) for r in ipo_raw]
    rt = [rights_record(r) for r in rt_raw]

    # 정렬: 날짜 내림차순 (미정/빈날짜는 맨 위 = 진행 중/최신)
    ipo.sort(key=lambda x: (x["date"] != "", x["date"]), reverse=True)
    rt.sort(key=lambda x: (x["date"] != "", x["date"]), reverse=True)

    WEB.mkdir(exist_ok=True)
    data = {"ipo": ipo, "rights": rt}
    (WEB / "ecm_data.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # meta — 필터 옵션
    def collect(recs, *keys):
        s = set()
        for r in recs:
            for k in keys:
                v = r.get(k)
                if v:
                    s.add(v)
        return sorted(s)

    def brokers(recs):
        s = set()
        for r in recs:
            s |= set(r["leads"].keys()) | set(r["uw"].keys())
        return sorted(s)

    years = sorted({(r["date"][:4]) for r in (ipo + rt) if r["date"]}, reverse=True)
    meta = {
        "updated": _now(),
        "ipo_count": len(ipo), "rights_count": len(rt),
        "years": years,
        "markets": collect(ipo, "market"),
        "types": collect(rt, "type"),
        "brokers": brokers(ipo + rt),
        "lead_order": config_ecm.LEAD_ECM,  # 원본 xlsx 주관 컬럼 순서 (Excel 다운로드용)
        "uw_order": config_ecm.UW_ECM,      # 원본 xlsx 인수 컬럼 순서
    }
    (WEB / "ecm_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # summary — 통합 주관 실적 상위 등 (랜딩 KPI 용 최소치)
    from collections import defaultdict
    lead_total = defaultdict(float)
    for r in ipo + rt:
        for a, v in r["leads"].items():
            lead_total[a] += v
    top = sorted(lead_total.items(), key=lambda x: -x[1])[:5]
    this_year = years[0] if years else ""
    summary = {
        "updated": _now(),
        "ipo_count": len(ipo), "rights_count": len(rt),
        "this_year": this_year,
        "this_year_ipo": sum(1 for r in ipo if r["date"][:4] == this_year),
        "this_year_rights": sum(1 for r in rt if r["date"][:4] == this_year),
        "top_leads": [{"alias": a, "amount": round(v)} for a, v in top],
    }
    (WEB / "ecm_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[ok] ecm_data.json (ipo {len(ipo)} + rights {len(rt)})")
    print(f"[ok] ecm_meta.json (years={len(years)}, brokers={len(meta['brokers'])})")
    print(f"[ok] ecm_summary.json (통합 주관 1위: {top[0] if top else None})")


if __name__ == "__main__":
    main()
