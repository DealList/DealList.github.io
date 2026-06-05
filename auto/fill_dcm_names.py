"""진행 중 DCM 공모채 딜의 주관/인수 '명단' 백필 (rate_final IS NULL & 명단 비어있음).

stage1(최초 증권신고서) 문서를 OpenDART API 로 가져와 parse_filing →
lead_managers / uw_names 추출 → Supabase records 행에 패치.
금액(underwriter_alloc)은 건드리지 않음 — 실적은 [발행조건확정] 후에만 기록.
fetch_full_document(API) 사용, 집/사무실 IP 라 DART 차단 없음.

사용:
  py auto/fill_dcm_names.py --dry      # 미리보기
  py auto/fill_dcm_names.py            # 실제 반영
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import main                      # load_mappings          # noqa: E402
import parser as dart_parser     # parse_filing/ParseContext  # noqa: E402
import dart_client               # noqa: E402
import supabase_client as sb     # noqa: E402


def _targets() -> dict[str, list[dict]]:
    """rate_final 미정(=진행 중) + 명단 비어있는 records 를 rcept_no 별로 묶음."""
    cols = ("id,issuer_alias,series,subscription_date,rcept_no,"
            "lead_managers,uw_names,rate_final,final_amount")
    rows, off = [], 0
    while True:
        chunk = sb.select("records", cols, limit=1000, offset=off)
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        off += 1000
    prog = [r for r in rows
            if r.get("rate_final") in (None, "")
            and r.get("rcept_no")
            and not (r.get("lead_managers") or r.get("uw_names"))]
    by_rcept: dict[str, list[dict]] = {}
    for r in prog:
        by_rcept.setdefault(r["rcept_no"], []).append(r)
    return by_rcept


def _parse_names(rcept: str, mappings: dict) -> dict[str, tuple[list, list]]:
    """stage1 문서 parse → {series: (lead_managers, uw_names)}."""
    secs = dart_client.fetch_full_document(
        rcept, title_predicate=dart_client.stage1_title_predicate)
    ctx = dart_parser.ParseContext(
        rcept_no=rcept, is_amendment=False, is_final=False,
        corp_name="", corp_code="")
    recs = dart_parser.parse_filing(secs, ctx, mappings)
    out: dict[str, tuple[list, list]] = {}
    for r in recs:
        ln = list(r.lead_managers)
        un = list(getattr(r, "uw_names", []))
        if ln or un:
            out[r.series] = (ln, un)
    return out


def run(dry: bool) -> None:
    mappings = main.load_mappings()
    by_rcept = _targets()
    print(f"진행 중 + 명단 비어있는 rcept: {len(by_rcept)}건")
    patched = skipped = failed = 0
    for rcept, rows in by_rcept.items():
        issuer = rows[0].get("issuer_alias") or ""
        try:
            names_by_series = _parse_names(rcept, mappings)
        except Exception as e:
            print(f"  [FAIL] {issuer} ({rcept}) — {e}")
            failed += 1
            continue
        if not names_by_series:
            print(f"  [skip] {issuer} ({rcept}) — 명단 추출 없음")
            skipped += 1
            continue
        for r in rows:
            pair = names_by_series.get(r["series"])
            if not pair:
                continue
            ln, un = pair
            print(f"  [{issuer} {r['series']}] 주관 {ln} / 인수 {un}"
                  + ("   (dry)" if dry else ""))
            if not dry:
                sb.update("records", {"id": "eq." + str(r["id"])},
                          {"lead_managers": ln, "uw_names": un})
            patched += 1
    print(f"명단 채움 {patched} / 스킵 {skipped} / 실패 {failed}"
          + (" (dry-run)" if dry else ""))


def main_():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    print(f"=== DCM 진행 중 딜 명단 백필{' (DRY)' if a.dry else ''} ===")
    run(a.dry)


if __name__ == "__main__":
    main_()
