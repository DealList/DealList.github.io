"""ECM 주관/인수 '명단' 백필 — 발행조건확정 전(step1-only) 딜만.

최초 증권신고서까지만 잡힌(아직 발행조건확정 미도달) 유증/IPO 딜만 골라
stage1 문서를 재파싱해 lead_names / uw_names (금액 없는 주관·인수 명단)를 채운다.
완료된 딜은 lead_amounts/uw_amounts 키로 이미 명단이 있으므로 건드리지 않는다.

  - rights: rcept_no_final1 / rcept_no_final2 둘 다 비어있는 row
  - ipo   : rcept_no_final 이 비어있는 row (단 IPO stage1 인수단 파서는 2단계 구현 예정 →
            현재는 명단이 비어 [skip] 될 수 있음)

사용:
  py auto/backfill_ecm_names.py --dry              # 미리보기(쓰기 X), rights
  py auto/backfill_ecm_names.py                    # 실제 반영, rights
  py auto/backfill_ecm_names.py --kind both        # rights + ipo
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main_ecm as M           # noqa: E402
import dart_client             # noqa: E402
import supabase_client as sb   # noqa: E402
from cloud_update_ecm import _names_from_uw_rows  # noqa: E402


def _fetch_targets(table: str, final_cols: list[str]) -> list[dict]:
    """final 컬럼이 모두 비어있는(=step1-only) row 만 추린다."""
    cols = "id,issuer,rcept_no_stage1,lead_names," + ",".join(final_cols)
    out, off = [], 0
    while True:
        chunk = sb.select(table, cols, limit=1000, offset=off)
        if not chunk:
            break
        for r in chunk:
            if r.get("rcept_no_stage1") and not any(r.get(c) for c in final_cols):
                out.append(r)
        if len(chunk) < 1000:
            break
        off += 1000
    return out


def _names_for_stage1(s1: str):
    """stage1 rcept 로 딜을 재구성해 (lead_names, uw_names) 산출. 실패 시 None."""
    filings = dart_client.fetch_deal_filings(s1)
    if not filings:
        return None
    for deal in M.group_into_deals(filings):
        res = M.process_deal(deal)
        if res is None:
            continue
        rec = (res.rights_record if res.kind == "rights"
               else res.ipo_record if res.kind == "ipo" else None)
        if rec is None:
            continue
        if (getattr(rec, "rcept_no_stage1", "") or "") == s1:
            return _names_from_uw_rows(getattr(rec, "_underwriter_rows", []))
    return None


def backfill(table: str, final_cols: list[str], dry: bool) -> int:
    targets = _fetch_targets(table, final_cols)
    print(f"\n[{table}] step1-only(발행조건확정 전) 대상 {len(targets)}건")
    n = 0
    for r in targets:
        s1 = r["rcept_no_stage1"]
        try:
            names = _names_for_stage1(s1)
        except Exception as e:
            print(f"  [WARN] {r.get('issuer')} ({s1}) 실패: {e}")
            continue
        if not names or not (names[0] or names[1]):
            print(f"  [skip] {r.get('issuer')} ({s1}) — 명단 추출 없음")
            continue
        ln, un = names
        print(f"  [{r.get('issuer')}] 주관 {ln} / 인수 {un}" + ("   (dry)" if dry else ""))
        if not dry:
            sb.update(table, {"id": "eq." + str(r["id"])},
                      {"lead_names": ln, "uw_names": un})
        n += 1
    print(f"[{table}] {n}건 {'반영 예정(dry)' if dry else '업데이트 완료'}")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="미리보기(DB 쓰기 안 함)")
    ap.add_argument("--kind", choices=["rights", "ipo", "both"], default="rights")
    a = ap.parse_args()

    print(f"=== ECM 주관/인수 명단 백필 (step1-only{', DRY' if a.dry else ''}) ===")
    try:
        M.load_mappings()
    except Exception:
        pass
    if a.kind in ("rights", "both"):
        backfill("ecm_rights", ["rcept_no_final1", "rcept_no_final2"], a.dry)
    if a.kind in ("ipo", "both"):
        backfill("ecm_ipo", ["rcept_no_final"], a.dry)


if __name__ == "__main__":
    main()
