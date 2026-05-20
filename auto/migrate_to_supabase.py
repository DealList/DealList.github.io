"""DCM Table.meta.json → Supabase records 테이블 일회성 마이그레이션.

흐름:
1. meta.json 의 records 모두 로드
2. Supabase 형식으로 변환 (필드명 일부 매핑)
3. 배치로 upsert (500개씩)
4. processed_rcept_nos 도 별도 테이블로 옮김

--dry-run 옵션으로 실제 insert 없이 변환만 시도 가능.
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
    """date object → ISO 문자열, str 은 그대로, None 은 None."""
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.isoformat()[:10]  # YYYY-MM-DD
    return str(d)


def transform_record(r: dict) -> dict:
    """meta.json record → Supabase records 테이블 row 형식."""
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
    }


def chunk(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="변환만 시도, Supabase insert 안 함")
    ap.add_argument("--batch-size", type=int, default=200,
                    help="한 번에 upsert 할 record 수 (기본 200)")
    args = ap.parse_args()

    if not META_PATH.exists():
        raise SystemExit(f"meta.json 없음: {META_PATH}")

    raw = json.loads(META_PATH.read_text(encoding="utf-8"))
    records = raw.get("records", [])
    processed_rcepts = raw.get("processed_rcept_nos", [])
    print(f"meta.json: records={len(records)}, processed_rcepts={len(processed_rcepts)}")

    # 1) records 변환
    transformed = []
    skipped = 0
    for r in records:
        # subscription_date 필수 (unique key 의 일부)
        if not r.get("subscription_date"):
            skipped += 1
            continue
        if not r.get("issuer_alias") or not r.get("series"):
            skipped += 1
            continue
        transformed.append(transform_record(r))
    print(f"변환 완료: {len(transformed)} (skip {skipped} — subscription_date/issuer/series 누락)")

    if args.dry_run:
        print(f"\n[dry-run] 첫 record 샘플:")
        print(json.dumps(transformed[0], ensure_ascii=False, indent=2, default=str))
        print(f"\n[dry-run] Supabase insert 안 함. 실제 적용은 --dry-run 빼고 실행.")
        return

    # 2) Supabase 연결 (REST API 헬퍼 사용)
    print("\nSupabase 연결 확인 중...")
    import supabase_client
    if not supabase_client.health_check():
        raise SystemExit("연결 실패. .env 또는 네트워크 확인.")

    # 3) records 배치 upsert
    print(f"\nrecords 테이블 upsert 시작 (배치 {args.batch_size}개씩)...")
    total = 0
    failed = 0
    for i, batch in enumerate(chunk(transformed, args.batch_size)):
        try:
            n = supabase_client.upsert(
                "records", batch,
                on_conflict="issuer_alias,series,subscription_date",
            )
            total += n
            print(f"  [{i+1}] upsert {n}건 (누적 {total})")
        except Exception as e:
            failed += len(batch)
            print(f"  [{i+1}] 실패: {e}")
    print(f"records 완료: 성공 {total} / 실패 {failed}")

    # 4) processed_rcepts upsert
    if processed_rcepts:
        print(f"\nprocessed_rcepts 테이블 upsert 시작...")
        rows = [{"rcept_no": r} for r in processed_rcepts]
        try:
            n = supabase_client.upsert("processed_rcepts", rows,
                                       on_conflict="rcept_no")
            print(f"  upsert {n}건")
        except Exception as e:
            print(f"  실패: {e}")

    # 5) 결과 요약
    print("\n=== 마이그레이션 완료 ===")
    print(f"  records 변환: {len(transformed)} / 성공: {total} / 실패: {failed}")
    print(f"  processed_rcepts: {len(processed_rcepts)}")
    print(f"\n다음: Supabase Table Editor 에서 records 테이블 확인.")


if __name__ == "__main__":
    main()
