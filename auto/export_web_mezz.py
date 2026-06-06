# -*- coding: utf-8 -*-
"""Supabase mezz_issuances → web/mezz_data.json (+ meta).

페이지가 fetch 할 단일 JSON:
  { cb: [...], bw: [...], eb: [...] }
모든 type 을 한 파일에 묶어 탭 전환 시 추가 fetch 없이 클라이언트에서 분기.
규모 = 3,715행 * 가벼운 필드 → 압축 전 ~800KB, gzip ~150KB 수준.

요청 시 별도 mezz_meta.json (마지막 업데이트·건수) 도 함께 떨굼.
Storage 업로드는 별도(사용자 수동 또는 향후 자동 스크립트).
"""
from __future__ import annotations
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import supabase_client as sb  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
WEB = ROOT.parent / "web"
WEB.mkdir(exist_ok=True)
TABLE = "mezz_issuances"
MARKET = {"Y": "코스피", "K": "코스닥", "N": "코넥스", "E": "기타"}


def _now() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def fetch_all() -> list[dict]:
    out, off = [], 0
    while True:
        c = sb.select(TABLE, "*", limit=1000, offset=off)
        if not c:
            break
        out.extend(c)
        if len(c) < 1000:
            break
        off += 1000
    return out


def _eok(v):
    """원 → 억원 (소수점 1자리). bd_fta(bigint, 원) 변환."""
    if v is None:
        return None
    try:
        return round(int(v) / 1e8, 1)
    except (ValueError, TypeError):
        return None


def _meaningful(w: dict) -> bool:
    """페이지 표에 의미 있는 행: 핵심 필드 중 최소 1개라도 채워져 있어야 함.
    DART 발행결정 API 가 사모 일부 케이스에서 '회차·종류·사모'만 있고 발행조건 전부 빈
    껍데기 응답을 줌(약 3%). 그 행은 표에서 잡음이라 제외.
    """
    return any(w.get(k) is not None for k in ("bddd", "bd_fta_eok", "sbd", "pymd", "bd_mtd", "intr_ex", "conv_prc"))


def to_web(r: dict) -> dict:
    """페이지가 쓰는 가벼운 필드 셋. 한국어 컬럼명은 그대로 두고 영문 키로 노출."""
    return {
        # 분류 / DART 링크
        "rcept": r.get("rcept_no") or "",
        "type": r.get("type"),
        # 발행사 / 시장
        "corp_code": r.get("corp_code"),
        "issuer": r.get("corp_name") or "",
        "market": MARKET.get(r.get("corp_cls") or "", r.get("corp_cls") or "-"),
        # 일자
        "bddd": r.get("bddd"),
        "sbd": r.get("sbd"),
        "pymd": r.get("pymd"),
        "bd_mtd": r.get("bd_mtd"),
        # 사채 기본
        "bd_tm": r.get("bd_tm"),
        "bd_knd": r.get("bd_knd"),
        "bd_fta_eok": _eok(r.get("bd_fta")),
        "bdis_mthn": r.get("bdis_mthn"),
        "intr_ex": r.get("bd_intr_ex"),
        "intr_sf": r.get("bd_intr_sf"),
        "rpmcmp": r.get("rpmcmp"),
        # 자금용도
        "fdpp": r.get("fdpp"),
        # 변환 통합
        "conv_prc": r.get("변환가"),
        "conv_rt": r.get("변환비율"),
        "conv_bgd": r.get("변환기간_시작"),
        "conv_edd": r.get("변환기간_종료"),
        "conv_qty": r.get("변환주식수"),
        "conv_vs": r.get("변환주식_총수_대비_비율"),
    }


def main():
    print(f"=== export_web_mezz @ {_now()} ===")
    rows = fetch_all()
    print(f"  fetched: {len(rows)}건")

    buckets = {"cb": [], "bw": [], "eb": []}
    skipped = {"cb": 0, "bw": 0, "eb": 0}
    for r in rows:
        t = r.get("type")
        if t in buckets:
            w = to_web(r)
            if _meaningful(w):
                buckets[t].append(w)
            else:
                skipped[t] += 1

    # 기본 정렬: 이사회결의일 desc (페이지에서 다시 정렬해도 무관, 초기 렌더 빠르게)
    for k in buckets:
        buckets[k].sort(key=lambda x: x.get("bddd") or "", reverse=True)
        print(f"  {k.upper()}: {len(buckets[k])}건 (잡음 제외 {skipped[k]}건)")

    data = {"cb": buckets["cb"], "bw": buckets["bw"], "eb": buckets["eb"]}
    out = WEB / "mezz_data.json"
    out.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  → {out} ({out.stat().st_size / 1024:.1f} KB)")

    meta = {
        "updated_at": _now(),
        "counts": {k: len(v) for k, v in buckets.items()},
        "total": sum(len(v) for v in buckets.values()),
    }
    meta_path = WEB / "mezz_meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → {meta_path}")
    print("\n다음: Supabase Storage 'site-data' 버킷에 mezz_data.json + mezz_meta.json 업로드")


if __name__ == "__main__":
    main()
