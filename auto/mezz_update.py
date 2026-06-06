"""메자닌 증분 업데이트 — 어제 1일치(자동) 또는 지정 기간(수동).

흐름:
  [1] list_major(pblntf_ty=B, 기간) → CB/BW/EB 발행사 corp_code 추출
  [2] 유형별·회사별 발행결정 API 호출 → upsert (bddd 보존 로직 활용)
  [3] 회사 동기화: 그 회사+유형의 응답 rcept_no 에 없는 옛 행은
      bd_fta(권면총액)를 NULL 처리 → export 필터로 자동 페이지 제외
      (정정 통합으로 옛 rcept_no 가 응답에서 사라지는 케이스 대응)

용법:
  py -u mezz_update.py                       # 기본: 어제 1일치
  py -u mezz_update.py 2026-06-01 2026-06-06 # 수동 기간
  py -u mezz_update.py --dry                 # 드라이런 (DB 변경 없음)
"""
from __future__ import annotations
import sys, json, time, argparse
from collections import OrderedDict, defaultdict
from datetime import date, timedelta
from pathlib import Path
import requests

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import config            # noqa: E402
import supabase_client as sb  # noqa: E402
from mezz_load import to_row, _preserve_existing_bddd, TABLE  # noqa: E402

KEY = config.DART_API_KEY
LIST_URL = config.OPENDART_LIST_URL
SLEEP = 0.25
HEAD = {"User-Agent": "Mozilla/5.0 MezzUpdate/1.0", "Accept-Language": "ko"}

TYPES = OrderedDict([
    ("cb", ("전환사채권발행결정",        "https://opendart.fss.or.kr/api/cvbdIsDecsn.json")),
    ("bw", ("신주인수권부사채권발행결정", "https://opendart.fss.or.kr/api/bdwtIsDecsn.json")),
    ("eb", ("교환사채권발행결정",        "https://opendart.fss.or.kr/api/exbdIsDecsn.json")),
])


def log(*a):
    print(*a, flush=True)


def _d(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def list_major(bgn: str, end: str) -> list[dict]:
    """주요사항보고서(B) 목록. corp_code 미지정이라 90일 청크."""
    out, s, e = [], _d(bgn), _d(end)
    cs = s
    while cs <= e:
        ce = min(cs + timedelta(days=89), e)
        page = 1
        while True:
            params = {
                "crtfc_key": KEY, "bgn_de": cs.strftime("%Y%m%d"),
                "end_de": ce.strftime("%Y%m%d"), "pblntf_ty": "B",
                "page_no": page, "page_count": 100,
            }
            r = requests.get(LIST_URL, params=params, timeout=30, headers=HEAD)
            r.raise_for_status()
            d = r.json()
            st = d.get("status")
            if st == "013":
                break
            if st != "000":
                raise RuntimeError(f"list err {st} {d.get('message')}")
            out.extend(d.get("list", []))
            if page >= int(d.get("total_page", 1)):
                break
            page += 1
            time.sleep(SLEEP)
        cs = ce + timedelta(days=1)
        time.sleep(SLEEP)
    return out


def fetch_decisions(url: str, corp_code: str, bgn: str, end: str) -> list[dict]:
    """발행결정 API 호출 (corp_code 기준이라 기간 무제한)."""
    # API 가 일자 필터 받지만 정정 통합 응답을 위해 넓게: 회사의 모든 활성 발행결정
    params = {"crtfc_key": KEY, "corp_code": corp_code, "bgn_de": "20180101", "end_de": end}
    r = requests.get(url, params=params, timeout=30, headers=HEAD)
    r.raise_for_status()
    d = r.json()
    st = d.get("status")
    if st == "013":
        return []
    if st != "000":
        log(f"  [warn] {corp_code} api err {st} {d.get('message')}")
        return []
    return d.get("list", []) or []


def sync_corp(corp_code: str, kind: str, response_rcepts: set, dry: bool) -> int:
    """그 회사+유형의 DB 행 중 응답에 없는 옛 rcept_no 는 bd_fta=NULL 처리.
    정정 통합으로 응답에서 사라진 옛 발행결정을 페이지에서 제외(export 필터로).
    응답이 비면(=회사가 더 이상 발행 안 함) 동기화 안 함(안전).
    """
    if not response_rcepts:
        return 0
    db_rows = sb.select(
        TABLE, "rcept_no,bd_fta",
        filters={"corp_code": f"eq.{corp_code}", "type": f"eq.{kind}"},
        limit=1000,
    ) or []
    obsolete = [r for r in db_rows
                if r["rcept_no"] not in response_rcepts and r.get("bd_fta") is not None]
    if not obsolete:
        return 0
    if dry:
        log(f"    [dry] sync {corp_code}/{kind}: bd_fta→NULL {len(obsolete)}건"
            f" (rcepts: {[r['rcept_no'] for r in obsolete[:3]]}{'...' if len(obsolete)>3 else ''})")
        return len(obsolete)
    for r in obsolete:
        sb.update(TABLE, filters={"rcept_no": f"eq.{r['rcept_no']}"},
                  values={"bd_fta": None})
    return len(obsolete)


def update_range(bgn: str, end: str, dry: bool) -> None:
    log(f"=== mezz_update {bgn}~{end} {'(DRY)' if dry else ''} ===\n")
    if not KEY:
        log("DART_API_KEY 미설정"); return

    log("[1] 주요사항보고서(B) 목록 조회 …")
    major = list_major(bgn, end)
    log(f"    조회 {len(major)}건")

    buckets = {k: OrderedDict() for k in TYPES}
    for x in major:
        rn = x.get("report_nm", "")
        for k, (kw, _) in TYPES.items():
            if kw in rn:
                buckets[k].setdefault(x["corp_code"], x["corp_name"])
                break
    for k in TYPES:
        log(f"    {k.upper()} 발행사 {len(buckets[k])}곳")

    grand_up = 0
    grand_sync = 0
    for k, (kw, url) in TYPES.items():
        corps = list(buckets[k])
        if not corps:
            log(f"\n[2-{k.upper()}] 발행사 없음 — 건너뜀")
            continue
        log(f"\n[2-{k.upper()}] {len(corps)}곳 호출 ({url.split('/')[-1]}) …")
        for i, cc in enumerate(corps, 1):
            try:
                recs = fetch_decisions(url, cc, bgn, end)
            except Exception as e:
                log(f"  [err] {cc}: {e}"); continue
            if not recs:
                continue

            # upsert (bddd 보존 + 회사 동기화)
            rows = [to_row(k, r) for r in recs
                    if r.get("rcept_no") and r.get("corp_code")]
            if not rows:
                continue
            _preserve_existing_bddd(rows)
            if dry:
                log(f"    [dry] {cc}: upsert {len(rows)}건 "
                    f"(rcepts: {[r['rcept_no'] for r in rows[:3]]}{'...' if len(rows)>3 else ''})")
            else:
                for j in range(0, len(rows), 200):
                    sb.upsert(TABLE, rows[j:j+200], on_conflict="rcept_no")
            grand_up += len(rows)

            # 회사 동기화 (응답에 없는 옛 rcept_no 의 bd_fta NULL)
            response_rcepts = {r.get("rcept_no") for r in recs if r.get("rcept_no")}
            grand_sync += sync_corp(cc, k, response_rcepts, dry)

            if i % 25 == 0:
                log(f"    {i}/{len(corps)} … 누적 upsert {grand_up} / sync {grand_sync}")
            time.sleep(SLEEP)

    log(f"\n=== 완료 — upsert {grand_up}건 / 동기화 NULL 처리 {grand_sync}건"
        f" {'(DRY · 변경 없음)' if dry else ''} ===")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("start", nargs="?", help="시작일 YYYY-MM-DD (기본: 어제)")
    ap.add_argument("end",   nargs="?", help="종료일 YYYY-MM-DD (기본: 어제)")
    ap.add_argument("--dry", action="store_true", help="드라이런 (DB 변경 없음)")
    a = ap.parse_args()
    if not a.start and not a.end:
        yesterday = (date.today() - timedelta(days=1)).strftime("%Y%m%d")
        bgn = end = yesterday
    else:
        bgn = (a.start or a.end).replace("-", "")
        end = (a.end   or a.start).replace("-", "")
    update_range(bgn, end, a.dry)


if __name__ == "__main__":
    main()
