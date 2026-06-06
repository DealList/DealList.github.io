"""PoC — 2025 Q2 전환사채권(CB) 발행결정 수집 (OpenDART API).

흐름:
  [1] list.json (pblntf_ty=B, 주요사항보고서) 목록 조회 → report_nm 에 '전환사채권발행결정'
      포함 공시만 필터 → 고유 발행사(corp_code) 추출
  [2] 회사별 cvbdIsDecsn.json (DS005 CB 발행결정) 호출 → 구조화 JSON 수집
  [3] 실제 필드 키 / 공모·사모 / 주관사 채움률 / corp_cls / 권면총액 / 필드 커버리지 통계
  결과: poc_cb_2025q2.json (raw) + 콘솔 요약
"""
from __future__ import annotations
import sys
import json
import time
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import requests          # noqa: E402
import config            # noqa: E402

KEY = config.DART_API_KEY
LIST_URL = config.OPENDART_LIST_URL
CB_URL = "https://opendart.fss.or.kr/api/cvbdIsDecsn.json"
SLEEP = 0.3
HEAD = {"User-Agent": "Mozilla/5.0 MezzPoC/1.0", "Accept-Language": "ko"}

BGN, END = "20250401", "20250630"
REPORT_KW = "전환사채권발행결정"
EMPTY = {"", "-", "해당사항없음", "해당없음", "없음", None}


def _d(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def list_major(bgn: str, end: str) -> list[dict]:
    """주요사항보고서(pblntf_ty=B) 전체 목록 — corp_code 미지정이라 90일 이내 청크로."""
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
            tp = int(d.get("total_page", 1))
            if page >= tp:
                break
            page += 1
            time.sleep(SLEEP)
        cs = ce + timedelta(days=1)
    return out


def cb_decisions(corp_code: str, bgn: str, end: str) -> list[dict]:
    params = {"crtfc_key": KEY, "corp_code": corp_code, "bgn_de": bgn, "end_de": end}
    r = requests.get(CB_URL, params=params, timeout=30, headers=HEAD)
    r.raise_for_status()
    d = r.json()
    st = d.get("status")
    if st == "013":
        return []
    if st != "000":
        print(f"  [warn] {corp_code} CB err {st} {d.get('message')}")
        return []
    return d.get("list", [])


def filled(v) -> bool:
    return (str(v).strip() if v is not None else "") not in EMPTY


def to_int(v):
    try:
        return int(str(v).replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def main():
    print(f"=== PoC: CB(전환사채권) 발행결정 {BGN}~{END} ===\n")
    if not KEY:
        print("DART_API_KEY 미설정 (auto/.env)"); return

    print("[1] 주요사항보고서(B) 목록 조회 …")
    major = list_major(BGN, END)
    print(f"    주요사항보고서 총 {len(major)}건")
    rn_counter = Counter(x.get("report_nm", "").replace("[기재정정]", "").strip() for x in major)
    print("    보고서명 상위 10:")
    for nm, c in rn_counter.most_common(10):
        print(f"      {c:>5}  {nm}")

    cb_pub = [x for x in major if REPORT_KW in x.get("report_nm", "")]
    amend = [x for x in cb_pub if "[기재정정]" in x.get("report_nm", "")]
    print(f"\n    → '전환사채권발행결정' 공시 {len(cb_pub)}건 (정정 {len(amend)}건 포함)")
    corps = {}
    for x in cb_pub:
        corps.setdefault(x["corp_code"], x["corp_name"])
    print(f"    → 고유 발행사 {len(corps)}곳")

    print(f"\n[2] 회사별 cvbdIsDecsn.json 호출 ({len(corps)}곳) …")
    records, fail = [], 0
    for i, cc in enumerate(corps, 1):
        try:
            records.extend(cb_decisions(cc, BGN, END))
        except Exception as e:
            fail += 1
            print(f"  [err] {cc}: {e}")
        if i % 25 == 0:
            print(f"    {i}/{len(corps)} … 누적 {len(records)}건")
        time.sleep(SLEEP)
    print(f"    cvbdIsDecsn 레코드 총 {len(records)}건 (호출 실패 {fail})")

    if not records:
        print("\n레코드 0건 — pblntf_ty/필터 점검 필요."); return

    # 저장
    out_path = ROOT / "poc_cb_2025q2.json"
    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n    raw 저장: {out_path}")

    # ── 통계 ──
    print("\n=== 통계 ===")
    keys = list(records[0].keys())
    print(f"[필드 키 {len(keys)}개] {keys}\n")

    cls_map = {"Y": "코스피", "K": "코스닥", "N": "코넥스", "E": "기타"}
    cls = Counter(cls_map.get(r.get("corp_cls", ""), r.get("corp_cls", "?")) for r in records)
    print(f"[시장] {dict(cls)}")

    method = Counter((r.get("bdis_mthn") or "?").strip() for r in records)
    print(f"[공모/사모(bdis_mthn)] {dict(method)}")

    rpm_all = sum(1 for r in records if filled(r.get("rpmcmp")))
    pub_recs = [r for r in records if "공모" in (r.get("bdis_mthn") or "")]
    rpm_pub = sum(1 for r in pub_recs if filled(r.get("rpmcmp")))
    print(f"[대표주관(rpmcmp) 채움] 전체 {rpm_all}/{len(records)}"
          f" ({rpm_all*100//max(1,len(records))}%) / 공모 {rpm_pub}/{len(pub_recs)}")
    print("   대표주관 예시:", [r.get("rpmcmp") for r in records if filled(r.get("rpmcmp"))][:8])

    fta = [to_int(r.get("bd_fta")) for r in records]
    fta = sorted(v for v in fta if v)
    if fta:
        tot = sum(fta); med = fta[len(fta)//2]
        print(f"[권면총액(bd_fta)] 합계 {tot/1e8:,.0f}억 / 중앙값 {med/1e8:,.1f}억"
              f" / 최소 {fta[0]/1e8:,.1f}억 / 최대 {fta[-1]/1e8:,.0f}억")

    print("\n[필드 커버리지 (non-empty %)]")
    check = ["bdis_mthn", "rpmcmp", "bd_intr_ex", "bd_intr_sf", "bd_mtd",
             "cv_prc", "cv_rt", "cvrqpd_bgd", "cvrqpd_edd", "sbd", "pymd", "bddd", "bd_fta"]
    for k in check:
        if k in keys:
            cov = sum(1 for r in records if filled(r.get(k))) * 100 // len(records)
            print(f"   {k:<14} {cov:>3}%")
        else:
            print(f"   {k:<14}  (키 없음)")

    print("\n=== 샘플 레코드 2건 (전체 필드) ===")
    for r in records[:2]:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        print("-" * 60)


if __name__ == "__main__":
    main()
