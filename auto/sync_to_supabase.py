"""meta.json → Supabase upsert (사용자 cmd_update 후 호출).

Actions 흐름:
1. sync_from_supabase --build-xlsx → 임시 xlsx + meta.json 복원
2. main.py cmd_update → xlsx + meta.json 갱신
3. sync_to_supabase → 갱신된 meta.json 을 Supabase 로 upsert

migrate_to_supabase.py 와 거의 동일하지만 incremental 운영용.
"""
from __future__ import annotations
import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
META_PATH = PROJECT_ROOT / "DCM Table.meta.json"

sys.path.insert(0, str(ROOT))


def _to_iso(d):
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.isoformat()[:10]
    s = str(d)
    return s[:10] if len(s) >= 10 else s


def transform_record(r: dict) -> dict:
    return {
        "subscription_date": _to_iso(r.get("subscription_date")),
        "issuer_alias": r.get("issuer_alias") or "",
        "issuer_full": r.get("issuer_full") or "",
        "corp_code": r.get("corp_code") or "",
        "series": r.get("series") or "",
        "bond_type": r.get("bond_type") or "",
        "credit_rating": r.get("credit_rating") or "",
        "maturity": (r.get("maturity") if isinstance(r.get("maturity"), str)
                     else _to_iso(r.get("maturity"))),
        "initial_amount": r.get("initial_amount"),
        "issue_limit": r.get("issue_limit"),
        "demand_amount": r.get("demand_amount"),
        "final_amount": r.get("final_amount"),
        "series_total": r.get("series_total"),
        "rate_target": r.get("rate_target") or "",
        "rate_demand": r.get("rate_demand") or "",
        "rate_final": r.get("rate_final"),
        "lead_managers": r.get("lead_managers") or [],
        "underwriter_alloc": r.get("underwriter_alloc") or {},
        "rcept_no": r.get("rcept_no") or "",
        "is_amendment": bool(r.get("is_amendment")),
        "is_foreign": bool(r.get("is_foreign")),
        "raw_tables_count": r.get("raw_tables_count") or 0,
        "notes": r.get("notes") or [],
        "locked_fields": r.get("locked_fields") or [],
    }


def chunk(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


# ============== 관리자 수기 잠금 필드 복원 ==============
# records.locked_fields 에 적힌 칸은 관리자가 편집기에서 수정한 값.
# cmd_update 가 DART 후속 공시로 그 칸을 덮어썼더라도, DB(편집값)로 되돌린다.
# (잠긴 칸만 보존 — 나머지 칸은 정상적으로 후속 공시 값이 채워짐)
RESTORE_COLS = (
    "subscription_date,issuer_alias,series,locked_fields,"
    "issuer_full,bond_type,credit_rating,maturity,"
    "initial_amount,issue_limit,demand_amount,final_amount,series_total,"
    "rate_target,rate_demand,rate_final"
)


def _fetch_locked(sb):
    """locked_fields 가 비어있지 않은 records 행 → {(date,issuer,series): row}."""
    out = {}
    off = 0
    while True:
        try:
            rows = sb.select("records", RESTORE_COLS, limit=1000, offset=off)
        except Exception as e:
            print(f"  [lock] locked_fields 조회 실패 — 복원 생략: {e}")
            return {}
        if not rows:
            break
        for row in rows:
            if row.get("locked_fields"):
                k = (_to_iso(row.get("subscription_date")),
                     row.get("issuer_alias") or "", row.get("series") or "")
                out[k] = row
        if len(rows) < 1000:
            break
        off += 1000
    return out


def _restore_locks(records, locked_map):
    """meta.json records 의 잠긴 칸을 DB(편집)값으로 복원. 복원한 행 수 반환."""
    if not locked_map:
        return 0
    n = 0
    for r in records:
        k = (_to_iso(r.get("subscription_date")),
             r.get("issuer_alias") or "", r.get("series") or "")
        lk = locked_map.get(k)
        if not lk:
            continue
        lf = lk.get("locked_fields") or []
        for field in lf:
            if field in lk:
                r[field] = lk[field]
        r["locked_fields"] = lf
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch-size", type=int, default=200)
    args = ap.parse_args()

    if not META_PATH.exists():
        raise SystemExit(f"meta.json 없음: {META_PATH}")

    raw = json.loads(META_PATH.read_text(encoding="utf-8"))
    records = raw.get("records", [])
    processed_rcepts = raw.get("processed_rcept_nos", [])
    print(f"meta.json: records={len(records)}, processed_rcepts={len(processed_rcepts)}")

    import supabase_client
    if not supabase_client.health_check():
        raise SystemExit("Supabase 연결 실패")

    # ── 관리자 수기 잠금 필드 복원 (DART 덮어쓰기로부터 보호) ──
    # DB 의 locked_fields 값을 meta.json 에 되돌린 뒤 파일도 다시 저장 →
    # 이후 export_web(data.json 생성)도 복원된 값을 사용.
    locked_map = _fetch_locked(supabase_client)
    restored = _restore_locks(records, locked_map)
    if restored:
        raw["records"] = records
        META_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2),
                             encoding="utf-8")
        print(f"  [lock] 수기 잠금 필드 복원: {restored}개 행")

    transformed = []
    skipped = 0
    for r in records:
        if not r.get("subscription_date") or not r.get("issuer_alias") or not r.get("series"):
            skipped += 1
            continue
        transformed.append(transform_record(r))
    if skipped:
        print(f"  skip {skipped} (key 누락)")

    # records upsert
    total = 0
    failed = 0
    for i, batch in enumerate(chunk(transformed, args.batch_size)):
        try:
            n = supabase_client.upsert(
                "records", batch,
                on_conflict="issuer_alias,series,subscription_date",
            )
            total += n
            print(f"  [{i+1}] records upsert {n}건 (누적 {total})")
        except Exception as e:
            failed += len(batch)
            print(f"  [{i+1}] 실패: {e}")

    # processed_rcepts upsert
    if processed_rcepts:
        rows = [{"rcept_no": r} for r in processed_rcepts]
        for i, batch in enumerate(chunk(rows, 1000)):
            try:
                supabase_client.upsert("processed_rcepts", batch,
                                       on_conflict="rcept_no")
                print(f"  processed_rcepts upsert {len(batch)}건")
            except Exception as e:
                print(f"  processed_rcepts 실패: {e}")

    print(f"\n=== sync_to_supabase 완료 ===")
    print(f"  records 성공 {total} / 실패 {failed}")
    print(f"  processed_rcepts {len(processed_rcepts)}")


if __name__ == "__main__":
    main()
