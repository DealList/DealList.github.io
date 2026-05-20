"""Supabase REST API 헬퍼 (라이브러리 의존 X — requests 로 직접 호출).

장점:
- supabase-py 미설치 (pyiceberg 등 Windows 빌드 이슈 회피)
- 의존성 최소 (이미 사용 중인 requests 만)
- 디버깅 쉬움

사용:
    from supabase_client import select, upsert, insert, delete, count, health_check
"""
from __future__ import annotations
import os
from pathlib import Path
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def _get_config():
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 미설정. "
            "auto/.env 확인."
        )
    return url, key


def _headers(key: str, *, prefer: str | None = None,
             json_body: bool = False) -> dict:
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if json_body:
        h["Content-Type"] = "application/json"
    if prefer:
        h["Prefer"] = prefer
    return h


# ============== SELECT ==============
def select(table: str, columns: str = "*",
           filters: dict | None = None,
           order: str | None = None,
           limit: int | None = None,
           offset: int | None = None,
           range_header: str | None = None) -> list[dict]:
    """SELECT. filters 예: {'id': 'eq.123', 'status': 'eq.active'}.

    페이지네이션:
        limit + offset (권장, PostgREST 표준 쿼리 파라미터)
        range_header 는 deprecated — limit/offset 와 함께 쓰면 416 발생.
    """
    url, key = _get_config()
    params = {"select": columns}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit is not None:
        params["limit"] = str(limit)
    if offset is not None:
        params["offset"] = str(offset)
    hd = _headers(key)
    if range_header:
        # 호환성용 — limit/offset 와 동시 사용 금지
        hd["Range"] = range_header
    r = requests.get(f"{url}/rest/v1/{table}", headers=hd, params=params, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(
            f"select {table} 실패 {r.status_code}: {r.text[:500]}"
        )
    return r.json()


# ============== UPSERT ==============
def upsert(table: str, rows: list[dict], on_conflict: str | None = None,
           returning: str = "minimal") -> int:
    """UPSERT (insert + on_conflict update). on_conflict='col1,col2' 형식."""
    if not rows:
        return 0
    url, key = _get_config()
    prefer = f"resolution=merge-duplicates,return={returning}"
    params = {}
    if on_conflict:
        params["on_conflict"] = on_conflict
    r = requests.post(f"{url}/rest/v1/{table}",
                      headers=_headers(key, prefer=prefer, json_body=True),
                      params=params, json=rows, timeout=120)
    if r.status_code >= 400:
        raise RuntimeError(f"upsert {table} 실패 {r.status_code}: {r.text[:500]}")
    return len(rows)


# ============== INSERT ==============
def insert(table: str, rows: list[dict], returning: str = "minimal") -> int:
    if not rows:
        return 0
    url, key = _get_config()
    r = requests.post(f"{url}/rest/v1/{table}",
                      headers=_headers(key, prefer=f"return={returning}",
                                       json_body=True),
                      json=rows, timeout=120)
    if r.status_code >= 400:
        raise RuntimeError(f"insert {table} 실패 {r.status_code}: {r.text[:500]}")
    return len(rows)


# ============== UPDATE ==============
def update(table: str, filters: dict, values: dict) -> int:
    url, key = _get_config()
    r = requests.patch(f"{url}/rest/v1/{table}",
                       headers=_headers(key, prefer="return=minimal",
                                        json_body=True),
                       params=filters, json=values, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"update {table} 실패 {r.status_code}: {r.text[:500]}")
    return 1


# ============== DELETE ==============
def delete(table: str, filters: dict) -> int:
    url, key = _get_config()
    r = requests.delete(f"{url}/rest/v1/{table}",
                        headers=_headers(key, prefer="return=minimal"),
                        params=filters, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"delete {table} 실패 {r.status_code}: {r.text[:500]}")
    return 1


# ============== COUNT ==============
def count(table: str, filters: dict | None = None) -> int:
    """row 수 카운트 (Content-Range 헤더 활용)."""
    url, key = _get_config()
    params = {"select": "*"}
    if filters:
        params.update(filters)
    hd = _headers(key, prefer="count=exact")
    hd["Range"] = "0-0"
    r = requests.get(f"{url}/rest/v1/{table}", headers=hd, params=params, timeout=30)
    r.raise_for_status()
    cr = r.headers.get("Content-Range", "")
    if "/" in cr:
        return int(cr.split("/")[-1])
    return 0


# ============== HEALTH CHECK ==============
def health_check() -> bool:
    try:
        n = count("records")
        print(f"[ok] Supabase 연결 정상. records 테이블 현재 {n}건")
        return True
    except Exception as e:
        print(f"[error] Supabase 연결 실패: {e}")
        return False


if __name__ == "__main__":
    health_check()
