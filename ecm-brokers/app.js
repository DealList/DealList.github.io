// Numbers Pool — ECM 증권사 League Table (통합/IPO/유증 × 주관/인수)
(function () {
  "use strict";
  const BROKER_FULL = {
    "BNK":"BNK투자증권","DB":"DB금융투자","IBK":"IBK투자증권","KB":"KB증권","KR":"KR투자증권","LS":"LS증권",
    "NH":"NH투자증권","SK":"SK증권","iM":"iM증권","교보":"교보증권","다올":"다올투자증권","대신":"대신증권",
    "디에스":"DS투자증권","리딩":"리딩투자증권","메리츠":"메리츠증권","미래":"미래에셋증권","부국":"부국증권",
    "산은":"한국산업은행","삼성":"삼성증권","상상인":"상상인증권","신영":"신영증권","신한":"신한투자증권",
    "우리":"우리투자증권","유안타":"유안타증권","유진":"유진투자증권","케이프":"케이프투자증권",
    "코리아에셋":"코리아에셋투자증권","키움":"키움증권","하나":"하나증권","한양":"한양증권","한투":"한국투자증권",
    "한화":"한화투자증권","현차":"현대차증권","흥국":"흥국증권","JP모간":"JP모간","UBS":"UBS","메릴린치":"메릴린치",
    "모간스탠리":"모간스탠리","크레디트스위스":"크레디트스위스","골드만삭스증권서울지점":"골드만삭스","씨티그룹글로벌마켓":"씨티그룹"
  };
  const MAX_CHIPS = 10;

  let RAW = { ipo: [], rights: [] };
  let META = {};
  let scope = "all";        // all | ipo | rights
  let activeTab = "lead";   // lead | uw
  let brokerKeywords = [];
  let aggregated = [];
  let sortKey = "amount", sortDir = "desc";

  const $ = (id) => document.getElementById(id);
  const displayName = (a) => BROKER_FULL[a] || a;
  const esc = (s) => s==null?"":String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmtAmount = (eok) => eok>=10000 ? `${Math.floor(eok/10000).toLocaleString()}조 ${Math.round(eok%10000).toLocaleString()}억` : `${Math.round(eok).toLocaleString()}억`;

  function dealTotal(r) {
    return (r.final_total!=null?r.final_total:(r.init_total!=null?r.init_total:0)) || 0;
  }
  // 주관/인수 실적 집계 대상 = "완료된 딜"만 (미완료 딜의 모집총액·배정액은 실적에서 제외)
  //  · IPO: 청약 데이터(기관·일반 경쟁률)까지 입력된 건
  //  · 유상증자: 1차 발행가액 이상 확정된 건 (최종가액 수집 건 포함, 최초희망까지만인 건 제외)
  const isNum = (v) => typeof v === "number";
  function ipoComplete(r){ return !!(r.inst && isNum(r.inst.compete) && r.general && isNum(r.general.compete)); }
  function rightsComplete(r){ return isNum(r.price_1) || isNum(r.final_price); }
  function scopeDeals() {
    const ipo = RAW.ipo.filter(ipoComplete), rights = RAW.rights.filter(rightsComplete);
    const arr = scope==="ipo" ? ipo : scope==="rights" ? rights : ipo.concat(rights);
    return arr.map(r => ({ date:r.date||"", issuer:r.issuer, leads:r.leads||{}, uw:r.uw||{}, total:dealTotal(r) }));
  }

  async function loadAll() {
    try {
      const [d, m] = await Promise.all([
        fetch("../ecm_data.json",{cache:"no-store"}).then(r=>r.json()),
        fetch("../ecm_meta.json",{cache:"no-store"}).then(r=>r.json()).catch(()=>({})),
      ]);
      RAW = d; META = m;
      const nu = $("nav-updated");
      if (nu) nu.textContent = `최종 업데이트 ${META.updated||"-"}`;
      initFilters();
      runQuery();
    } catch (e) { console.error(e); const nu=$("nav-updated"); if(nu) nu.textContent="데이터 로드 실패"; }
  }

  function allDates() {
    const ds = [...RAW.ipo, ...RAW.rights].map(r=>r.date).filter(Boolean);
    return { min: ds.reduce((a,b)=>(!a||b<a)?b:a,""), max: ds.reduce((a,b)=>b>a?b:a,"") };
  }

  function initFilters() {
    const set = new Set(META.brokers || []);
    if (!set.size) [...RAW.ipo,...RAW.rights].forEach(r=>{Object.keys(r.leads||{}).forEach(a=>set.add(a));Object.keys(r.uw||{}).forEach(a=>set.add(a));});
    const sel = $("f-broker-select");
    sel.innerHTML = '<option value="">선택</option>' + [...set].sort((a,b)=>displayName(a).localeCompare(displayName(b),"ko")).map(v=>`<option value="${esc(v)}">${esc(displayName(v))}</option>`).join("");
    const {min,max} = allDates();
    applyPreset("ytd", max, min);

    ["f-date-start","f-date-end"].forEach(id=>$(id).addEventListener("change",clearPreset));
    document.querySelectorAll(".date-presets button[data-preset]").forEach(b=>b.addEventListener("click",()=>applyPreset(b.dataset.preset,max,min)));
    sel.addEventListener("change",()=>{ const v=sel.value; if(!v)return; if(brokerKeywords.length>=MAX_CHIPS||brokerKeywords.includes(v)){sel.value="";return;} brokerKeywords.push(v); sel.value=""; renderChips(); });
    // scope 탭
    document.querySelectorAll(".ecm-scope-tab").forEach(t=>t.addEventListener("click",()=>{
      document.querySelectorAll(".ecm-scope-tab").forEach(x=>x.classList.remove("active"));
      t.classList.add("active"); scope=t.dataset.scope; runQuery();
    }));
    // 주관/인수 탭
    document.querySelectorAll(".result-tabs .tab").forEach(tab=>tab.addEventListener("click",()=>{
      document.querySelectorAll(".result-tabs .tab").forEach(x=>x.classList.remove("active"));
      tab.classList.add("active"); activeTab=tab.dataset.tab;
      $("th-amount-label").textContent = activeTab==="lead"?"주관 실적":"인수 실적";
      $("th-name-label").textContent = activeTab==="lead"?"주관사":"인수사";
      $("th-issuers-label").textContent = activeTab==="lead"?"주요 주관 딜(억원)":"주요 인수 딜(억원)";
      runQuery();
    }));
    document.querySelectorAll("#grid thead th[data-sort]").forEach(th=>th.addEventListener("click",()=>{
      const k=th.dataset.sort; if(sortKey===k) sortDir=sortDir==="asc"?"desc":"asc"; else {sortKey=k; sortDir=k==="name"?"asc":"desc";} renderTable();
    }));
    $("btn-search").addEventListener("click",()=>{  // 짧은 로딩 스피너 후 적용
      const btn=$("btn-search");
      if (btn.dataset.busy) return;
      const orig=btn.innerHTML;
      btn.dataset.busy="1"; btn.disabled=true;
      btn.innerHTML='<span class="spinner"></span>조회 중';
      setTimeout(()=>{ runQuery(); btn.disabled=false; btn.innerHTML=orig; delete btn.dataset.busy; },250);
    });
    $("btn-reset").addEventListener("click",()=>{ brokerKeywords=[]; renderChips(); $("f-broker-select").value=""; applyPreset("ytd",max,min); runQuery(); });
    $("btn-download").addEventListener("click",downloadExcel);
  }

  function clearPreset(){ document.querySelectorAll(".date-presets button").forEach(b=>b.classList.remove("active")); }
  function applyPreset(p, max, min) {
    clearPreset();
    const btn=document.querySelector(`.date-presets button[data-preset="${p}"]`); if(btn) btn.classList.add("active");
    if (p==="all"){ $("f-date-start").value=min||""; $("f-date-end").value=max||""; return; }
    if (!max) return;
    if (p==="ytd"){ const t=new Date(); const yr=(t.getMonth()+1)===1?t.getFullYear()-1:t.getFullYear(); $("f-date-start").value=`${yr}-01-01`; $("f-date-end").value=max; return; }
    const d=new Date(max), s=new Date(d);
    if (p==="1y") s.setFullYear(s.getFullYear()-1); else if (p==="3y") s.setFullYear(s.getFullYear()-3);
    s.setDate(s.getDate()+1); $("f-date-end").value=max; $("f-date-start").value=s.toISOString().slice(0,10);
  }

  function renderChips() {
    const w=$("f-broker-chips"); w.innerHTML="";
    brokerKeywords.forEach(kw=>{
      const c=document.createElement("span"); c.className="issuer-chip";
      c.innerHTML=esc(displayName(kw))+'<button type="button" class="remove" title="제거">×</button>';
      c.querySelector(".remove").addEventListener("click",()=>{ brokerKeywords=brokerKeywords.filter(k=>k!==kw); renderChips(); });
      w.appendChild(c);
    });
  }

  function runQuery() {
    const ds=$("f-date-start").value||"", de=$("f-date-end").value||"";
    // 기간 표기 제거 (사용자 요청, 2026-05-31)
    const _pr = $("period-range"); if (_pr) _pr.textContent = "";
    const deals = scopeDeals().filter(r=>{
      if (ds && r.date && r.date<ds) return false;
      if (de && r.date && r.date>de) return false;
      return true;
    });
    const marketTotal = deals.reduce((s,d)=>s+d.total,0);
    const map = new Map();
    for (const deal of deals) {
      const src = activeTab==="lead"?deal.leads:deal.uw;
      for (const [a,amt] of Object.entries(src)) {
        if (!amt) continue;
        if (!map.has(a)) map.set(a,{alias:a,count:0,amount:0,dealList:[]});
        const g=map.get(a); g.count+=1; g.amount+=Number(amt)||0; g.dealList.push({issuer:deal.issuer,amount:amt});
      }
    }
    const brokerTotal = [...map.values()].reduce((s,g)=>s+g.amount,0);
    aggregated = [...map.values()].map(g=>({
      alias:g.alias, name:displayName(g.alias), count:g.count, amount:Math.round(g.amount),
      share: brokerTotal>0?(g.amount/brokerTotal)*100:0,
      issuers: [...g.dealList].sort((a,b)=>b.amount-a.amount).map(d=>({issuer:d.issuer,amount:Math.round(d.amount)})),
    }));
    adjustShares(aggregated);
    if (brokerKeywords.length){ const set=new Set(brokerKeywords); aggregated=aggregated.filter(g=>set.has(g.alias)); }
    $("result-count").innerHTML = `증권사 <strong>${aggregated.length}</strong>개 · 발행 ${deals.filter(d=>d.total>0).length}건 · 실적합 ${fmtAmount(brokerTotal)}`;
    updateKPI(deals, marketTotal);
    renderTable();
  }

  function updateKPI(deals, marketTotal) {
    const grid=$("kpi-grid"); if(!grid) return;
    if (!deals.length){ grid.innerHTML=""; return; }
    const leadSum=new Map(), uwSum=new Map();
    deals.forEach(d=>{ for(const[a,v]of Object.entries(d.leads))leadSum.set(a,(leadSum.get(a)||0)+v); for(const[a,v]of Object.entries(d.uw))uwSum.set(a,(uwSum.get(a)||0)+v); });
    const tl=[...leadSum.entries()].sort((a,b)=>b[1]-a[1])[0], tu=[...uwSum.entries()].sort((a,b)=>b[1]-a[1])[0];
    const lt=[...leadSum.values()].reduce((s,v)=>s+v,0), ut=[...uwSum.values()].reduce((s,v)=>s+v,0);
    const dealCnt = deals.filter(d=>d.total>0).length;
    const scopeLabel = scope==="ipo"?"완료 IPO":scope==="rights"?"유상증자":"IPO+유상증자";
    const scopeNote = scope==="rights"?"(최소 1차 발행가액 확정 기준)":"";
    grid.innerHTML = `
      <div class="kpi-cell"><div class="l">조회 기간 내 ${scopeLabel} 건수${scopeNote}</div><div class="v">${dealCnt.toLocaleString()}<small>건</small></div><div class="s">거래 건수 기준</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 내 ${scopeLabel} 총액${scopeNote}</div><div class="v">${fmtAmount(marketTotal)}</div><div class="s">시장 규모</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 내 ${scopeLabel} 주관 1위${scopeNote}</div><div class="v">${esc(displayName(tl?tl[0]:""))}</div><div class="s">${tl?fmtAmount(tl[1])+" · "+(lt>0?(tl[1]/lt*100).toFixed(1):"0")+"%":""}</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 내 ${scopeLabel} 인수 1위${scopeNote}</div><div class="v">${esc(displayName(tu?tu[0]:""))}</div><div class="s">${tu?fmtAmount(tu[1])+" · "+(ut>0?(tu[1]/ut*100).toFixed(1):"0")+"%":""}</div></div>`;
  }

  function renderTable() {
    const k=sortKey, dir=sortDir==="asc"?1:-1;
    aggregated.sort((a,b)=>{ const va=a[k],vb=b[k]; if(typeof va==="number")return(va-vb)*dir; return String(va).localeCompare(String(vb),"ko")*dir; });
    document.querySelectorAll("#grid thead th").forEach(th=>{ th.classList.remove("sorted-asc","sorted-desc"); if(th.dataset.sort===k) th.classList.add(sortDir==="asc"?"sorted-asc":"sorted-desc"); });
    const tb=$("rows"); const frag=document.createDocumentFragment();
    aggregated.forEach((g,i)=>{
      const tr=document.createElement("tr");
      const txt=formatIssuers(g.issuers), full=g.issuers.map(x=>`${x.issuer}(${x.amount})`).join(", ");
      tr.innerHTML = `<td class="num">${i+1}</td><td>${esc(g.name)}</td><td class="num">${g.count.toLocaleString()}</td><td class="num strong">${g.amount.toLocaleString()}</td><td class="num">${g.share.toFixed(2)}%</td><td class="rel-issuers" title="${esc(full)}">${esc(txt)}</td>`;
      frag.appendChild(tr);
    });
    if (aggregated.length){
      const tc=aggregated.reduce((s,g)=>s+g.count,0), ta=aggregated.reduce((s,g)=>s+g.amount,0), ts=aggregated.reduce((s,g)=>s+g.share,0);
      const tr=document.createElement("tr"); tr.className="total-row";
      tr.innerHTML=`<td colspan="2" class="center">합계</td><td class="num">${tc.toLocaleString()}</td><td class="num strong">${ta.toLocaleString()}</td><td class="num">${ts.toFixed(2)}%</td><td></td>`;
      frag.appendChild(tr);
    }
    tb.innerHTML=""; tb.appendChild(frag);
    $("empty").classList.toggle("hidden", aggregated.length>0);
  }

  function formatIssuers(items){ if(!items.length)return""; const h=items.slice(0,5).map(x=>`${x.issuer}(${x.amount})`).join(", "); return items.length<=5?h:h+` 외 ${items.length-5}건`; }
  function adjustShares(items){ if(!items.length)return; const SCALE=10000; const sc=items.map(g=>Math.floor(g.share*100)); const tot=sc.reduce((s,x)=>s+x,0); let diff=SCALE-tot; if(diff!==0){ const rem=items.map((g,i)=>({i,frac:g.share*100-sc[i]})).sort((a,b)=>diff>0?b.frac-a.frac:a.frac-b.frac); const step=diff>0?1:-1; for(let k=0;k<Math.abs(diff);k++){ sc[rem[k%rem.length].i]+=step; } } items.forEach((g,i)=>g.share=sc[i]/100); }

  function downloadExcel() {
    if (!aggregated.length){ alert("다운로드할 데이터가 없습니다."); return; }
    const nm=activeTab==="lead"?"주관사":"인수사", am=activeTab==="lead"?"주관 실적(억원)":"인수 실적(억원)", il=activeTab==="lead"?"주요 주관 딜(억원)":"주요 인수 딜(억원)";
    const rows=aggregated.map((g,i)=>({순위:i+1,[nm]:g.name,건수:g.count,[am]:g.amount,점유율:g.share.toFixed(2)+"%",[il]:g.issuers.map(x=>`${x.issuer}(${x.amount})`).join(", ")}));
    const tc=aggregated.reduce((s,g)=>s+g.count,0), ta=aggregated.reduce((s,g)=>s+g.amount,0), ts=aggregated.reduce((s,g)=>s+g.share,0);
    rows.push({순위:"합계",[nm]:"",건수:tc,[am]:ta,점유율:ts.toFixed(2)+"%",[il]:""});
    const ws=XLSX.utils.json_to_sheet(rows), wb=XLSX.utils.book_new();
    const sc=scope==="ipo"?"IPO":scope==="rights"?"유증":"ECM통합";
    XLSX.utils.book_append_sheet(wb,ws,`${sc}_${activeTab==="lead"?"주관":"인수"}`);
    XLSX.writeFile(wb,`NumbersPool_ECM_${sc}_${activeTab==="lead"?"주관":"인수"}실적_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  loadAll();
})();
