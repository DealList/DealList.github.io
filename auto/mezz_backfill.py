"""메자닌 백필 — 2020-01-01 ~ 현재, CB/BW/EB 발행결정 수집 (OpenDART API).

흐름:
  [1] list.json(pblntf_ty=B) 89일 청크로 전체 주요사항보고서 목록 1회 수집
      → report_nm 키워드로 CB/BW/EB 발행사(corp_code) 3개 버킷 분류
  [2] 유형별·회사별 발행결정 API 호출(전체기간 1콜, 실패 시 연도청크 폴백)
      → rcept_no 기준 dedup
  결과: auto/mezz_backfill/mezz_{cb,bw,eb}.json + 요약

실시간 로그: py -u mezz_backfill.py
"""
from __future__ import annotations
import sys
import json
import time
from collections import Counter, OrderedDict
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import requests          # noqa: E402
import config            # noqa: E402

KEY = config.DART_API_KEY
LIST_URL = config.OPENDART_LIST_URL
SLEEP = 0.25
HEAD = {"User-Agent": "Mozilla/5.0 MezzBackfill/1.0", "Accept-Language": "ko"}

BGN = "20200101"
END = date.today().strftime("%Y%m%d")
OUTDIR = ROOT / "mezz_backfill"
OUTDIR.mkdir(exist_ok=True)

# 유형: 키 → (report_nm 포함 키워드, 발행결정 API URL)
TYPES = OrderedDict([
    ("cb", ("전환사채권발행결정",        "https://opendart.fss.or.kr/api/cvbdIsDecsn.json")),
    ("bw", ("신주인수권부사채권발행결정", "https://opendart.fss.or.kr/api/bdwtIsDecsn.json")),
    ("eb", ("교환사채권발행결정",        "https://opendart.fss.or.kr/api/exbdIsDecsn.json")),
])
EMPTY = {"", "-", "해당사항없음", "해당없음", "없음", None}


def log(*a):
    print(*a, flush=True)


def _d(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def list_major(bgn: str, end: str) -> list[dict]:
    """주요사항보고서(B) 전체 목록 — corp_code 미지정이라 89일 청크 + 페이징."""
    out, s, e = [], _d(bgn), _d(end)
    cs = s
    nchunk = 0
    while cs <= e:
        ce = min(cs + timedelta(days=89), e)
        nchunk += 1
        page, got = 1, 0
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
            lst = d.get("list", [])
            out.extend(lst)
            got += len(lst)
            tp = int(d.get("total_page", 1))
            if page >= tp:
                break
            page += 1
            time.sleep(SLEEP)
        log(f"    chunk {nchunk} {cs}~{ce}: {got}건 (누적 {len(out)})")
        cs = ce + timedelta(days=1)
        time.sleep(SLEEP)
    return out


def _call(url: str, corp: str, bgn: str, end: str) -> tuple[str, list[dict]]:
    params = {"crtfc_key": KEY, "corp_code": corp, "bgn_de": bgn, "end_de": end}
    r = requests.get(url, params=params, timeout=30, headers=HEAD)
    r.raise_for_status()
    d = r.json()
    return d.get("status"), d.get("list", []) or []


def fetch_corp(url: str, corp: str) -> list[dict]:
    """전체기간 1콜. 비정상 상태면 연도청크로 폴백."""
    try:
        st, lst = _call(url, corp, BGN, END)
        if st in ("000",):
            return lst
        if st == "013":
            return []
        # 기간 초과 등 → 연도 청크 폴백
    except Exception as e:
        log(f"      [retry] {corp} full-range 실패({e}) → 연도청크")
    recs, seen = [], set()
    for y in range(int(BGN[:4]), int(END[:4]) + 1):
        yb, ye = f"{y}0101", min(f"{y}1231", END)
        try:
            st, lst = _call(url, corp, yb, ye)
            if st == "000":
                for x in lst:
                    if x.get("rcept_no") not in seen:
                        seen.add(x.get("rcept_no")); recs.append(x)
        except Exception as e:
            log(f"      [err] {corp} {y}: {e}")
        time.sleep(SLEEP)
    return recs


def filled(v) -> bool:
    return (str(v).strip() if v is not None else "") not in EMPTY


def main():
    log(f"=== 메자닌 백필 {BGN}~{END} (CB/BW/EB) ===")
    if not KEY:
        log("DART_API_KEY 미설정"); return

    log("\n[1] 주요사항보고서(B) 목록 수집 …")
    major = list_major(BGN, END)
    log(f"    주요사항보고서 총 {len(major)}건")

    # 유형별 corp 버킷
    buckets = {k: OrderedDict() for k in TYPES}
    for x in major:
        rn = x.get("report_nm", "")
        for k, (kw, _) in TYPES.items():
            if kw in rn:
                buckets[k].setdefault(x["corp_code"], x["corp_name"])
                break
    for k in TYPES:
        log(f"    {k.upper()} 발행사 {len(buckets[k])}곳")

    grand = {}
    for k, (kw, url) in TYPES.items():
        corps = list(buckets[k])
        log(f"\n[2-{k.upper()}] {len(corps)}곳 호출 ({url.split('/')[-1]}) …")
        recs, seen = [], set()
        for i, cc in enumerate(corps, 1):
            for x in fetch_corp(url, cc):
                rno = x.get("rcept_no")
                if rno and rno not in seen:
                    seen.add(rno); recs.append(x)
            if i % 50 == 0:
                log(f"    {i}/{len(corps)} … 누적 {len(recs)}건")
            time.sleep(SLEEP)
        out = OUTDIR / f"mezz_{k}.json"
        out.write_text(json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8")
        grand[k] = recs
        # 요약
        method = Counter((r.get("bdis_mthn") or "?").strip() for r in recs)
        rpm = sum(1 for r in recs if filled(r.get("rpmcmp")))
        log(f"    → {k.upper()} {len(recs)}건 저장: {out.name}")
        log(f"       공모/사모: {dict(method)} / 대표주관 채움 {rpm}/{len(recs)}")

    log("\n=== 백필 완료 ===")
    for k in TYPES:
        log(f"  {k.upper()}: {len(grand[k])}건")
    log(f"  저장 위치: {OUTDIR}")


if __name__ == "__main__":
    main()
