"""step1-only(=rcept_no_final IS NULL) ECM 딜의 주관/인수 '명단' 채움.

list_ecm_filings 결과에 빠진 stage1 rcept도 DB 직접 조회로 빠짐없이 처리.
fetch_ecm_stage1_document(OpenDART API, 정상 수집과 같은 경로) 사용 — 집 IP라 차단 없음.

사용:
  py auto/fill_step1_names.py --dry              # 미리보기
  py auto/fill_step1_names.py                    # 실제 반영 (IPO + 유증 둘 다)
  py auto/fill_step1_names.py --kind ipo         # IPO 만
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import parser_ecm        # noqa: E402
import dart_client       # noqa: E402
import supabase_client as sb  # noqa: E402
from cloud_update_ecm import _names_from_uw_rows  # noqa: E402


def _targets(table: str, final_cols: list[str], force: bool = False) -> list[dict]:
    cols = "id,issuer,corp_code,rcept_no_stage1,lead_names,uw_names," + ",".join(final_cols)
    out, off = [], 0
    while True:
        chunk = sb.select(table, cols, limit=1000, offset=off)
        if not chunk:
            break
        for r in chunk:
            if r.get("rcept_no_stage1") and not any(r.get(c) for c in final_cols):
                # 기본: 이미 명단 채워진 건 스킵. --force: 전부 재파싱(잘못 들어간 값 교정용).
                if not force and (r.get("lead_names") or r.get("uw_names")):
                    continue
                out.append(r)
        if len(chunk) < 1000:
            break
        off += 1000
    return out


def run(table: str, final_cols: list[str], kind: str, dry: bool, force: bool) -> int:
    targets = _targets(table, final_cols, force)
    print(f"\n[{table}] step1-only 대상 {len(targets)}건" + (" (force)" if force else ""))
    upd = same = fail = 0
    for r in targets:
        s1 = r["rcept_no_stage1"]
        issuer = r.get("issuer") or ""
        try:
            secs = dart_client.fetch_ecm_stage1_document(s1)
            if kind == "ipo":
                rec = parser_ecm.parse_ipo_stage1(
                    secs or {}, rcept_no=s1, corp_name=issuer, corp_code=r.get("corp_code") or "")
            else:
                rec = parser_ecm.parse_rights_stage1(
                    secs or {}, rcept_no=s1, corp_name=issuer, corp_code=r.get("corp_code") or "")
            uw_rows = getattr(rec, "_underwriter_rows", []) if rec else []
            ln, un = _names_from_uw_rows(uw_rows)
        except Exception as e:
            print(f"  [FAIL] {issuer} ({s1}) — {e}")
            fail += 1
            continue
        cur_l = r.get("lead_names") or []
        cur_u = r.get("uw_names") or []
        if sorted(ln) == sorted(cur_l) and sorted(un) == sorted(cur_u):
            same += 1
            continue
        mark = "(교정→비움)" if (not ln and not un) else ""
        print(f"  [{issuer}] 주관 {cur_l}→{ln} / 인수 {cur_u}→{un} {mark}" + ("   (dry)" if dry else ""))
        if not dry:
            sb.update(table, {"id": "eq." + str(r["id"])},
                      {"lead_names": ln, "uw_names": un})
        upd += 1
    print(f"[{table}] 갱신 {upd} / 변화없음 {same} / 실패 {fail}")
    return upd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="이미 명단 있는 건도 재파싱(잘못 들어간 값 교정용)")
    ap.add_argument("--kind", choices=["ipo", "rights", "both"], default="both")
    a = ap.parse_args()
    print(f"=== step1-only 명단 채우기{' (DRY)' if a.dry else ''}"
          f"{' FORCE' if a.force else ''} ===")
    if a.kind in ("ipo", "both"):
        run("ecm_ipo", ["rcept_no_final"], "ipo", a.dry, a.force)
    if a.kind in ("rights", "both"):
        run("ecm_rights", ["rcept_no_final1", "rcept_no_final2"], "rights", a.dry, a.force)


if __name__ == "__main__":
    main()
