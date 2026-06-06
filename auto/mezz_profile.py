"""백필 결과 프로파일 — 스키마 설계용. 로컬 JSON만 읽음(네트워크 X)."""
import sys, json
from collections import Counter
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
D = ROOT / "mezz_backfill"
EMPTY = {"", "-", "해당사항없음", "해당없음", "없음", None}

def filled(v): return (str(v).strip() if v is not None else "") not in EMPTY

CHECK = {
  "cb": ["bd_tm","bd_knd","bd_fta","bdis_mthn","bd_intr_ex","bd_intr_sf","bd_mtd",
         "cv_prc","cv_rt","cvrqpd_bgd","cvrqpd_edd","cvisstk_cnt","cvisstk_tisstk_vs",
         "act_mktprcfl_cvprc_lwtrsprc","sbd","pymd","bddd","rpmcmp",
         "fdpp_op","fdpp_dtrp","fdpp_ocsa","fdpp_fclt","fdpp_etc"],
  "bw": ["bd_tm","bd_fta","bdis_mthn","bd_intr_ex","bd_intr_sf","bd_mtd",
         "ex_prc","expd_bgd","expd_edd","ex_rt","nstk_isstk_cnt","bdwt_div_atn",
         "sbd","pymd","bddd","rpmcmp"],
  "eb": ["bd_tm","bd_fta","bdis_mthn","bd_intr_ex","bd_intr_sf","bd_mtd",
         "extg","extg_stkcnt","extg_tisstk_vs","ex_rt","ex_prc","exrqpd_bgd","exrqpd_edd",
         "sbd","pymd","bddd","rpmcmp"],
}

for k in ("cb","bw","eb"):
    p = D / f"mezz_{k}.json"
    recs = json.loads(p.read_text(encoding="utf-8"))
    print(f"\n{'='*64}\n{k.upper()} — {len(recs)}건  ({p.name})\n{'='*64}")
    if not recs: continue
    keys = list(recs[0].keys())
    print(f"[필드 키 {len(keys)}개] {keys}")
    cls = Counter({"Y":"코스피","K":"코스닥","N":"코넥스","E":"기타"}.get(r.get('corp_cls'),'?') for r in recs)
    print(f"[시장] {dict(cls)}")
    yrs = Counter((r.get('bddd') or '')[:4] for r in recs)
    print(f"[연도(bddd)] {dict(sorted(yrs.items()))}")
    print(f"[커버리지]")
    for f in CHECK[k]:
        if f in keys:
            cov = sum(1 for r in recs if filled(r.get(f)))*100//len(recs)
            print(f"   {f:<26} {cov:>3}%")
        else:
            print(f"   {f:<26}  (키 없음!)")
    # 샘플 1건(공모 우선, 없으면 첫 건)
    samp = next((r for r in recs if '공모' in (r.get('bdis_mthn') or '')), recs[0])
    print(f"[샘플 1건] ({samp.get('bdis_mthn')})")
    print(json.dumps(samp, ensure_ascii=False, indent=2))
