"""Supabase → meta.json + DCM Table.xlsx 다운로드.

GitHub Actions 환경에서 매 cmd_update 시작 전 호출.
기존 main.py 의 cmd_update 가 xlsx + meta.json 을 읽으므로,
Supabase 의 현재 상태를 그 두 파일로 먼저 만들어준다.

로컬 디버깅에도 사용 가능 (Supabase 의 최신 상태 → 로컬 xlsx 복원).
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
XLSX_PATH = PROJECT_ROOT / "DCM Table.xlsx"

sys.path.insert(0, str(ROOT))


def _parse_date(s):
    """ISO 문자열 → date object. 빈 값은 None."""
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


def supabase_record_to_meta(r: dict) -> dict:
    """Supabase row → meta.json record 형식 (parser.TrancheRecord 와 호환)."""
    # subscription_date 는 date object 로 (excel_writer 가 date 로 다룸)
    return {
        "subscription_date": r.get("subscription_date"),  # 문자열 그대로 (json 저장용)
        "issuer_alias": r.get("issuer_alias") or "",
        "issuer_full": r.get("issuer_full") or "",
        "corp_code": r.get("corp_code") or "",
        "series": r.get("series") or "",
        "bond_type": r.get("bond_type") or "",
        "credit_rating": r.get("credit_rating") or "",
        "maturity": r.get("maturity"),
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


def fetch_all_records():
    """페이지 단위로 전체 records 조회. Supabase 기본 1000개 제한 고려."""
    import supabase_client
    PAGE = 1000
    out = []
    offset = 0
    while True:
        chunk = supabase_client.select(
            "records", columns="*",
            order="subscription_date.desc",
            limit=PAGE,
            offset=offset,
        )
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return out


def fetch_all_processed_rcepts():
    import supabase_client
    out = []
    offset = 0
    PAGE = 1000
    while True:
        chunk = supabase_client.select(
            "processed_rcepts", columns="rcept_no",
            limit=PAGE,
            offset=offset,
        )
        if not chunk:
            break
        out.extend(c["rcept_no"] for c in chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-xlsx", action="store_true",
                    help="xlsx 도 함께 빌드 (cmd_update 가 필요로 함)")
    args = ap.parse_args()

    print("Supabase → records 조회 중...")
    records = fetch_all_records()
    print(f"  records {len(records)}건")

    print("Supabase → processed_rcepts 조회 중...")
    processed_rcepts = fetch_all_processed_rcepts()
    print(f"  processed_rcepts {len(processed_rcepts)}건")

    # meta.json 형식으로 저장
    meta_records = [supabase_record_to_meta(r) for r in records]
    raw = {
        "records": meta_records,
        "processed_rcept_nos": processed_rcepts,
    }
    META_PATH.write_text(
        json.dumps(raw, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[ok] meta.json 저장 ({META_PATH})")

    if args.build_xlsx:
        # xlsx 도 다시 빌드 (cmd_update 의 read_existing_keys 가 xlsx 읽음)
        print("xlsx 빌드 중...")
        import excel_writer
        from parser import TrancheRecord

        # meta dict → TrancheRecord 객체
        objs = []
        for m in meta_records:
            # subscription_date / maturity 를 date object 로 변환
            sd = _parse_date(m.get("subscription_date"))
            mat = m.get("maturity")
            if isinstance(mat, str) and len(mat) >= 8:
                parsed_mat = _parse_date(mat)
                mat = parsed_mat if parsed_mat else mat
            obj = TrancheRecord(
                subscription_date=sd,
                issuer_alias=m.get("issuer_alias", ""),
                issuer_full=m.get("issuer_full", ""),
                corp_code=m.get("corp_code", ""),
                series=m.get("series", ""),
                bond_type=m.get("bond_type", ""),
                credit_rating=m.get("credit_rating", ""),
                maturity=mat,
                initial_amount=m.get("initial_amount"),
                issue_limit=m.get("issue_limit"),
                demand_amount=m.get("demand_amount"),
                final_amount=m.get("final_amount"),
                series_total=m.get("series_total"),
                rate_target=m.get("rate_target", ""),
                rate_demand=m.get("rate_demand", ""),
                rate_final=m.get("rate_final"),
                lead_managers=list(m.get("lead_managers") or []),
                underwriter_alloc=dict(m.get("underwriter_alloc") or {}),
                rcept_no=m.get("rcept_no", ""),
                is_amendment=bool(m.get("is_amendment")),
                is_foreign=bool(m.get("is_foreign")),
                raw_tables_count=m.get("raw_tables_count") or 0,
                notes=list(m.get("notes") or []),
            )
            objs.append(obj)
        excel_writer.write(objs, XLSX_PATH, processed_rcept_nos=processed_rcepts)
        print(f"[ok] xlsx 빌드 ({XLSX_PATH})")


if __name__ == "__main__":
    main()
