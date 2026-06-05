"""DCM Table.xlsx (실제 행) + meta.json (record 본체) → web/data.json 변환.

xlsx 가 source of truth. 사용자가 xlsx 에서 행을 삭제하면 그 record 는 web 에서도
즉시 빠짐. meta.json 에만 있고 xlsx 에는 없는 record 는 제외.

웹 페이지가 fetch 로 읽을 단일 JSON 파일 생성.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def _now_kst_str() -> str:
    """KST 기준 'YYYY-MM-DD HH:MM' 문자열.

    Actions runner 가 UTC 라서 naive datetime.now() 를 쓰면 9시간 늦게 표시됨.
    """
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")

ROOT = Path(__file__).resolve().parent.parent  # .../DCM Table
META_PATH = ROOT / "DCM Table.meta.json"
XLSX_PATH = ROOT / "DCM Table.xlsx"
WEB_DIR = ROOT / "web"
OUT_DATA = WEB_DIR / "data.json"
OUT_META = WEB_DIR / "meta.json"
OUT_SUMMARY = WEB_DIR / "summary.json"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import excel_writer  # type: ignore


def _to_number_or_none(v):
    """소수점 없는 정수로 반올림 (Excel 과 동일)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(v)
    return None


def compute_lead_amounts(lead_managers: list, underwriter_alloc: dict) -> dict:
    """주관사별 실적 산식 — formulas.build_lead_formula 와 동일.

    주관사 1곳: 전체 인수합 ← 그 1곳이 모두 받음
    주관사 N곳: 본인 인수금액 + (전체 인수합 − 모든 주관사 인수합) / N

    Excel 셀에 들어있는 수식이 평가하는 값과 100% 동일.
    """
    if not lead_managers:
        return {}
    alloc = underwriter_alloc or {}
    n = len(lead_managers)
    total = sum(alloc.values())
    if n == 1:
        return {lead_managers[0]: total}
    leads_own = sum(alloc.get(a, 0) for a in lead_managers)
    extra_per_lead = (total - leads_own) / n
    return {a: alloc.get(a, 0) + extra_per_lead for a in lead_managers}


def _disc_key(r: dict) -> tuple:
    """records PK (issuer_alias, series, subscription_date) — disclosure_date 매칭용."""
    return (r.get("issuer_alias") or "", r.get("series") or "",
            str(r.get("subscription_date") or "")[:10])


def _clean_record(r: dict, disc_map: dict | None = None) -> dict:
    """레코드를 웹 표시용으로 정리."""
    leads = r.get("lead_managers") or []
    alloc = r.get("underwriter_alloc") or {}
    # 주관사 실적 (산식: build_lead_formula 와 동일) — brokers 페이지가 합산에 사용
    lead_amt = compute_lead_amounts(leads, alloc)
    return {
        # 최초 증권신고서 공시일 — records.disclosure_date (백필/증분 채움) 에서 주입
        "disclosure_date": (disc_map or {}).get(_disc_key(r), ""),
        "date": r.get("subscription_date") or "",
        "issuer": r.get("issuer_alias") or "",
        "issuer_full": r.get("issuer_full") or "",
        "series": r.get("series") or "",
        "type": r.get("bond_type") or "",
        "rating": r.get("credit_rating") or "",
        "maturity": r.get("maturity") if isinstance(r.get("maturity"), str) else "",
        "init": _to_number_or_none(r.get("initial_amount")),
        "limit": _to_number_or_none(r.get("issue_limit")),
        "demand": _to_number_or_none(r.get("demand_amount")),
        "final": _to_number_or_none(r.get("final_amount")),
        "series_total": _to_number_or_none(r.get("series_total")),
        "r_target": r.get("rate_target") or "",
        "r_demand": r.get("rate_demand") or "",
        "r_final": r.get("rate_final"),
        "leads": leads,
        "uw": {k: _to_number_or_none(v) for k, v in alloc.items()},
        "uw_names": r.get("uw_names") or [],  # 인수사 명단(stage1 부터). uw 가 비었을 때 표시 폴백.
        # 주관사별 실적 (산식 결과). brokers 페이지에서 기간별 증권사 합산에 사용.
        # 소수점 그대로 보존 — broker 합산 후 한 번만 round (엑셀과 100% 일치).
        "lead_amt": {k: (round(v, 4) if v is not None else None)
                     for k, v in lead_amt.items()},
        "rcept": r.get("rcept_no") or "",
        "foreign": bool(r.get("is_foreign")),
    }


def _load_disclosure_map() -> dict:
    """records 테이블에서 disclosure_date 를 (issuer_alias, series, subscription_date) → 'YYYY-MM-DD'.
    컬럼 미생성/연결 실패 시 빈 맵 반환 (graceful — disclosure 만 빈값, export 는 계속).
    """
    out = {}
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import supabase_client as sb
        off = 0
        while True:
            rows = sb.select("records", "issuer_alias,series,subscription_date,disclosure_date",
                             limit=1000, offset=off)
            if not rows:
                break
            for row in rows:
                dd = row.get("disclosure_date")
                if dd:
                    k = (row.get("issuer_alias") or "", row.get("series") or "",
                         str(row.get("subscription_date") or "")[:10])
                    out[k] = str(dd)[:10]
            if len(rows) < 1000:
                break
            off += 1000
    except Exception as e:
        print(f"[warn] disclosure_date 로딩 실패 — 빈값 처리 (컬럼 미생성?): {e}")
    return out


def _compute_summary(cleaned_records: list) -> dict:
    """메인 페이지 KPI 4개 — 이번 달 발행건수/총액, 최근 1년 주관 1위, 최대 단일 발행.

    회차 단위 그룹화 후 계산 (record = 트랜치 단위).
    """
    from collections import defaultdict
    from datetime import date, timedelta

    # 회차 단위 그룹화
    deals_map = {}
    for r in cleaned_records:
        if r.get("final") is None:
            continue
        if not r.get("date"):
            continue
        series_base = (r.get("series") or "").split("-")[0]
        key = (r["issuer"], series_base, r["date"])
        if key not in deals_map:
            deals_map[key] = {
                "issuer": r["issuer"],
                "series": series_base,
                "date": r["date"],
                "final": 0,
                "lead_amt": defaultdict(float),
            }
        d = deals_map[key]
        d["final"] += r["final"] or 0
        for alias, amt in (r.get("lead_amt") or {}).items():
            d["lead_amt"][alias] += amt or 0

    deals = list(deals_map.values())
    if not deals:
        return {"updated": "", "kpi": []}

    # 가장 최근 발행일
    max_d = max(d["date"] for d in deals)
    y, m = max_d[:4], max_d[5:7]
    this_month = f"{y}-{m}"
    # 전월
    pm_dt = date(int(y), int(m), 1) - timedelta(days=1)
    prev_month = pm_dt.strftime("%Y-%m")

    this_deals = [d for d in deals if d["date"].startswith(this_month)]
    prev_deals = [d for d in deals if d["date"].startswith(prev_month)]
    this_count = len(this_deals)
    this_amt = sum(d["final"] for d in this_deals)
    prev_count = len(prev_deals)
    prev_amt = sum(d["final"] for d in prev_deals)

    def _pct(cur, prev):
        if not prev:
            return None
        return round((cur - prev) / prev * 100, 1)

    count_chg = _pct(this_count, prev_count)
    amt_chg = _pct(this_amt, prev_amt)

    # 올해 (1월 1일 ~ max_date) 주관 1위
    year_start = f"{y}-01-01"
    this_year_deals = [d for d in deals if d["date"] >= year_start]
    this_year_total = sum(d["final"] for d in this_year_deals)
    lead_sum = defaultdict(float)
    for d in this_year_deals:
        for a, v in d["lead_amt"].items():
            lead_sum[a] += v
    top_alias, top_amt = (sorted(lead_sum.items(), key=lambda x: -x[1])[:1] +
                          [("", 0)])[0]
    top_share = (top_amt / this_year_total * 100) if this_year_total else 0

    # 올해 최대 단일 발행 (회차 final 기준)
    biggest = max(this_year_deals, key=lambda d: d["final"]) if this_year_deals else None

    return {
        "updated": _now_kst_str(),
        "max_date": max_d,
        "year": y,
        "this_month_label": this_month,
        "this_month_count": this_count,
        "this_month_amount": round(this_amt),
        "this_month_count_change": count_chg,
        "this_month_amount_change": amt_chg,
        "this_year_top_broker": top_alias,
        "this_year_top_amount": round(top_amt),
        "this_year_top_share": round(top_share, 2),
        "this_year_biggest_issuer": biggest["issuer"] if biggest else "",
        "this_year_biggest_series": biggest["series"] if biggest else "",
        "this_year_biggest_amount": round(biggest["final"]) if biggest else 0,
        "this_year_biggest_date": biggest["date"] if biggest else "",
    }


def main():
    if not META_PATH.exists():
        raise SystemExit(f"meta.json not found: {META_PATH}")

    raw = json.loads(META_PATH.read_text(encoding="utf-8"))
    records = raw.get("records", [])

    # 최초 공시일 맵 (records.disclosure_date) — DB 에서 직접 로딩 (meta 흐름과 독립)
    disc_map = _load_disclosure_map()
    print(f"[disc] disclosure_date {len(disc_map)}건 로딩")

    # xlsx 의 실제 행 (issuer_alias, series) keys — 진정한 source of truth.
    # meta.json 에는 있어도 xlsx 에 없는 record (사용자가 직접 삭제) 는 web 에서 제외.
    if XLSX_PATH.exists():
        xlsx_keys = excel_writer.read_existing_keys(XLSX_PATH)
        print(f"[xlsx] {len(xlsx_keys)} rows present (source of truth)")
    else:
        xlsx_keys = None
        print(f"[warn] xlsx 없음 — meta.json 전체 사용")

    cleaned = []
    issuers = set()
    leads = set()
    uws = set()
    ratings = set()
    types = set()
    years = set()
    skipped = 0

    for r in records:
        key = (r.get("issuer_alias", ""), r.get("series", ""))
        if xlsx_keys is not None and key not in xlsx_keys:
            skipped += 1
            continue
        rec = _clean_record(r, disc_map)
        cleaned.append(rec)
        if rec["issuer"]:
            issuers.add(rec["issuer"])
        for lm in rec["leads"]:
            leads.add(lm)
        for u in rec["uw"].keys():
            uws.add(u)
        if rec["rating"]:
            ratings.add(rec["rating"])
        if rec["type"]:
            types.add(rec["type"])
        if rec["date"]:
            years.add(rec["date"][:4])

    # 발행일 내림차순 정렬
    cleaned.sort(key=lambda x: x["date"], reverse=True)

    WEB_DIR.mkdir(exist_ok=True)
    OUT_DATA.write_text(
        json.dumps(cleaned, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    meta = {
        "updated": _now_kst_str(),
        "count": len(cleaned),
        "years": sorted(years, reverse=True),
        "issuers": sorted(issuers),
        "leads": sorted(leads),
        "underwriters": sorted(uws),
        "ratings": sorted(ratings),
        "types": sorted(types),
    }
    OUT_META.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 메인 페이지 KPI 용 summary.json
    summary = _compute_summary(cleaned)
    OUT_SUMMARY.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"[ok] data.json {len(cleaned)} records ({OUT_DATA.stat().st_size/1024:.0f} KB)")
    if skipped:
        print(f"     ({skipped}건 meta-only, xlsx 에서 삭제됨 → web 제외)")
    print(f"[ok] meta.json (issuers={len(issuers)}, leads={len(leads)}, "
          f"uw={len(uws)}, years={len(years)})")


if __name__ == "__main__":
    main()
