"""메자닌 백필 JSON → Supabase mezz_issuances 적재.

입력: auto/mezz_backfill/mezz_{cb,bw,eb}.json
출력: Supabase mezz_issuances (upsert on rcept_no)

처리:
  - 날짜 클렌징: "2025년 04월 07일" → "2025-04-07"
  - 숫자 클렌징: "2,300,000,000" → 2300000000 / "2.0" → 2.0
  - 빈값: "-", "", "해당사항없음" → None
  - 자금용도: fdpp_op/dtrp/ocsa/fclt/etc 5칸 → fdpp jsonb 한 칸 (운영/시설/채무상환/타법인취득/기타)
  - 변환 필드 매핑: CB(cv_*) / BW(ex_*/expd_*/nstk_*) / EB(ex_*/exrqpd_*/extg_*) → 통합 컬럼
  - raw: 원본 dict 통째 보존
  - upsert(rcept_no): 정정본은 자동 갱신

사용: py -X utf8 mezz_load.py
"""
from __future__ import annotations
import sys
import json
import re
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import supabase_client as sb  # noqa: E402

BACKFILL_DIR = ROOT / "mezz_backfill"
TABLE = "mezz_issuances"
BATCH = 500
EMPTY = {"", "-", "해당사항없음", "해당없음", "없음", "N/A"}


# ── 클렌징 헬퍼 ──────────────────────────────────────────────────
def _clean_str(v) -> str | None:
    """빈값/플레이스홀더는 None. 양옆 공백 제거."""
    if v is None:
        return None
    s = str(v).strip()
    return None if s in EMPTY else s


def to_int(v) -> int | None:
    """`"2,300,000,000"` → 2300000000. 정수 아니면 None."""
    s = _clean_str(v)
    if s is None:
        return None
    s = re.sub(r"[,\s원]", "", s)
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))  # "1.0" 같은 케이스
        except ValueError:
            return None


def to_num(v) -> float | None:
    """소수 허용 (금리·비율). `"2.00"` → 2.0."""
    s = _clean_str(v)
    if s is None:
        return None
    s = re.sub(r"[,\s%]", "", s)
    try:
        return float(s)
    except ValueError:
        return None


_DATE_RE = re.compile(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})")


def to_date(v) -> str | None:
    """`"2025년 04월 07일"` → "2025-04-07". 못 파싱하면 None."""
    s = _clean_str(v)
    if s is None:
        return None
    m = _DATE_RE.search(s)
    if not m:
        return None
    y, mo, d = m.groups()
    try:
        y, mo, d = int(y), int(mo), int(d)
        if not (1900 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
            return None
        return f"{y:04d}-{mo:02d}-{d:02d}"
    except ValueError:
        return None


# ── 매핑 ────────────────────────────────────────────────────────
def _fdpp(r: dict) -> dict | None:
    """fdpp_op/dtrp/ocsa/fclt/etc → {운영, 시설, 채무상환, 타법인취득, 기타}. 모두 0/null이면 None."""
    out = {
        "운영":       to_int(r.get("fdpp_op")),
        "시설":       to_int(r.get("fdpp_fclt")),
        "채무상환":   to_int(r.get("fdpp_dtrp")),
        "타법인취득": to_int(r.get("fdpp_ocsa")),
        "기타":       to_int(r.get("fdpp_etc")),
    }
    if all(v is None for v in out.values()):
        return None
    return out


# 유형별 변환 필드 키 매핑
CONV_KEYS = {
    "cb": ("cv_prc",  "cv_rt",  "cvrqpd_bgd", "cvrqpd_edd", "cvisstk_cnt",   "cvisstk_tisstk_vs"),
    "bw": ("ex_prc",  "ex_rt",  "expd_bgd",   "expd_edd",   "nstk_isstk_cnt", "nstk_isstk_tisstk_vs"),
    "eb": ("ex_prc",  "ex_rt",  "exrqpd_bgd", "exrqpd_edd", "extg_stkcnt",   "extg_tisstk_vs"),
}


def to_row(kind: str, r: dict) -> dict:
    pk_prc, pk_rt, pk_bgd, pk_edd, pk_cnt, pk_vs = CONV_KEYS[kind]
    return {
        "rcept_no":   r.get("rcept_no"),
        "type":       kind,
        "corp_code":  r.get("corp_code"),
        "corp_name":  r.get("corp_name"),
        "corp_cls":   _clean_str(r.get("corp_cls")),
        "bddd":       to_date(r.get("bddd")),
        "sbd":        to_date(r.get("sbd")),
        "pymd":       to_date(r.get("pymd")),
        "bd_mtd":     to_date(r.get("bd_mtd")),
        "bd_tm":      to_int(r.get("bd_tm")),
        "bd_knd":     _clean_str(r.get("bd_knd")),
        "bd_fta":     to_int(r.get("bd_fta")),
        "bdis_mthn":  _clean_str(r.get("bdis_mthn")),
        "bd_intr_ex": to_num(r.get("bd_intr_ex")),
        "bd_intr_sf": to_num(r.get("bd_intr_sf")),
        "rpmcmp":     _clean_str(r.get("rpmcmp")),
        "fdpp":       _fdpp(r),
        "변환가":                  to_num(r.get(pk_prc)),
        "변환비율":                to_num(r.get(pk_rt)),
        "변환기간_시작":           to_date(r.get(pk_bgd)),
        "변환기간_종료":           to_date(r.get(pk_edd)),
        "변환주식수":              to_int(r.get(pk_cnt)),
        "변환주식_총수_대비_비율": to_num(r.get(pk_vs)),
        "raw": r,
    }


# ── 불변 필드 보존 ──────────────────────────────────────────────
def _preserve_existing_bddd(rows: list[dict]) -> int:
    """upsert 전: 새 응답의 bddd 가 None 이면 DB 의 기존 bddd 값으로 보존.

    이사회결의일은 '결정한 날짜'로 불변 사실. 정정공시에 미기입되면 발행결정 API 가
    빈값으로 갱신하는데, 그 케이스에 한해 옛 값을 지키기 위함.
    - 새 응답 bddd 있음 → 그대로 (덮어쓰기)
    - 새 응답 bddd 빈값 + DB 에 값 있음 → DB 값 유지
    - 새 응답·DB 모두 빈값 → 그대로 None
    """
    none_ids = [r["rcept_no"] for r in rows
                if r.get("bddd") is None and r.get("rcept_no")]
    if not none_ids:
        return 0
    keep = {}
    CHUNK = 200  # URL 길이 제한 회피
    for i in range(0, len(none_ids), CHUNK):
        batch = none_ids[i:i + CHUNK]
        existing = sb.select(
            TABLE, "rcept_no,bddd",
            filters={"rcept_no": f"in.({','.join(batch)})"},
            limit=len(batch),
        )
        for row in existing or []:
            if row.get("bddd"):
                keep[row["rcept_no"]] = row["bddd"]
    if not keep:
        return 0
    n = 0
    for r in rows:
        if r.get("bddd") is None and keep.get(r.get("rcept_no")):
            r["bddd"] = keep[r["rcept_no"]]
            n += 1
    return n


def _preserve_locked(rows: list[dict]) -> int:
    """upsert 전: 관리자가 수기 잠금한 칸은 DB 의 locked_values 값으로 복원.

    관리자페이지(/admin/data/)에서 어떤 칸을 수정·저장하면 그 칸이 locked_fields 에
    기록되고 수정값이 locked_values 에 보관된다. 자동수집(DART)은 매시간 같은 회차를
    재upsert 하므로, 잠근 칸을 새 API 값으로 덮어쓰지 않도록 여기서 DB 보관값으로
    되돌린다. (잠그지 않은 칸은 정상적으로 최신 공시값으로 갱신.)
    locked_fields/locked_values 컬럼 자체는 to_row 에 없어 upsert SET 대상이 아니므로
    DB 값이 그대로 유지된다(별도 보존 불필요).
    """
    ids = [r["rcept_no"] for r in rows if r.get("rcept_no")]
    if not ids:
        return 0
    locks = {}
    CHUNK = 200
    for i in range(0, len(ids), CHUNK):
        batch = ids[i:i + CHUNK]
        existing = sb.select(
            TABLE, "rcept_no,locked_fields,locked_values",
            filters={"rcept_no": f"in.({','.join(batch)})"},
            limit=len(batch),
        )
        for row in existing or []:
            lf = row.get("locked_fields") or []
            if lf:
                locks[row["rcept_no"]] = (lf, row.get("locked_values") or {})
    if not locks:
        return 0
    n = 0
    for r in rows:
        lock = locks.get(r.get("rcept_no"))
        if not lock:
            continue
        lf, lv = lock
        for k in lf:
            if k in lv:            # 잠근 칸을 관리자 보관값으로 복원
                r[k] = lv[k]
                n += 1
    return n


# ── 메인 ────────────────────────────────────────────────────────
def load_kind(kind: str) -> int:
    path = BACKFILL_DIR / f"mezz_{kind}.json"
    if not path.exists():
        print(f"  [skip] {path} 없음")
        return 0
    records = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    skip_no_pk = 0
    for r in records:
        if not r.get("rcept_no") or not r.get("corp_code"):
            skip_no_pk += 1
            continue
        rows.append(to_row(kind, r))
    print(f"[{kind.upper()}] 원본 {len(records)} → 적재 대상 {len(rows)} (PK 누락 {skip_no_pk})")
    kept = _preserve_existing_bddd(rows)
    if kept:
        print(f"  [bddd 보존] {kept}건 — 정정공시로 빠진 이사회결의일 DB 값 유지")
    locked = _preserve_locked(rows)
    if locked:
        print(f"  [잠금 보존] {locked}칸 — 관리자 수정값 유지")
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        sb.upsert(TABLE, chunk, on_conflict="rcept_no")
        total += len(chunk)
        print(f"  upsert {i + len(chunk)}/{len(rows)}")
    return total


def main():
    print(f"=== mezz_load → {TABLE} (upsert on rcept_no) ===\n")
    grand = 0
    for k in ("cb", "bw", "eb"):
        grand += load_kind(k)
        print()
    print(f"=== 완료: 총 {grand}건 upsert ===")


if __name__ == "__main__":
    main()
