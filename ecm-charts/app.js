// Numbers Pool — ECM 인포그래픽 (IPO / 유상증자 탭별 차트)
(function () {
  "use strict";
  const BROKER_FULL = {
    "BNK":"BNK투자증권","DB":"DB금융투자","IBK":"IBK투자증권","KB":"KB증권","KR":"KR투자증권","LS":"LS증권",
    "NH":"NH투자증권","SK":"SK증권","iM":"iM증권","교보":"교보증권","다올":"다올투자증권","대신":"대신증권",
    "디에스":"DS투자증권","리딩":"리딩투자증권","메리츠":"메리츠증권","미래":"미래에셋증권","부국":"부국증권",
    "산은":"한국산업은행","삼성":"삼성증권","상상인":"상상인증권","신영":"신영증권","신한":"신한투자증권",
    "우리":"우리투자증권","유안타":"유안타증권","유진":"유진투자증권","케이프":"케이프투자증권",
    "코리아에셋":"코리아에셋투자증권","키움":"키움증권","하나":"하나증권","한양":"한양증권","한투":"한국투자증권",
    "한화":"한화투자증권","현차":"현대차증권","흥국":"흥국증권","골드만삭스증권서울지점":"골드만삭스","씨티그룹글로벌마켓":"씨티그룹"
  };
  const PALETTE = ["#3b82f6","#14b8a6","#f59e0b","#a855f7","#ef4444","#10b981","#6366f1","#ec4899","#eab308","#06b6d4"];
  const IPO_C = "#3b82f6", RIGHTS_C = "#14b8a6";

  let RAW = { ipo:[], rights:[] }, META = {}, charts = {}, tab = "ipo";
  const $ = (id) => document.getElementById(id);
  const dn = (a) => BROKER_FULL[a] || a;
  const total = (r) => (r.final_total!=null?r.final_total:(r.init_total!=null?r.init_total:0))||0;
  const fmtAmt = (e) => e>=10000 ? `${Math.floor(e/10000).toLocaleString()}조 ${Math.round(e%10000).toLocaleString()}억` : `${Math.round(e).toLocaleString()}억`;
  // 완료 딜만 집계 — IPO: 청약 현황(기관·일반 경쟁률) 채워짐 / 유증: 1차 발행가액 또는 최종가액 확정
  const ipoDone = (r) => r.inst && typeof r.inst.compete==="number" && r.general && typeof r.general.compete==="number";
  const rightsDone = (r) => typeof r.price_1==="number" || typeof r.final_price==="number";

  async function loadAll() {
    try {
      const [d,m] = await Promise.all([
        fetch("../ecm_data.json",{cache:"no-store"}).then(r=>r.json()),
        fetch("../ecm_meta.json",{cache:"no-store"}).then(r=>r.json()).catch(()=>({})),
      ]);
      RAW = d; META = m;
      const nu=$("nav-updated"); if(nu) nu.textContent=`최종 업데이트 ${META.updated||"-"} · IPO ${META.ipo_count||RAW.ipo.length} · 유증 ${META.rights_count||RAW.rights.length}`;
      initFilters(); runQuery();
    } catch(e){ console.error(e); const nu=$("nav-updated"); if(nu) nu.textContent="데이터 로드 실패"; }
  }

  function allDates(){ const ds=[...RAW.ipo,...RAW.rights].map(r=>r.date).filter(Boolean); return {min:ds.reduce((a,b)=>(!a||b<a)?b:a,""),max:ds.reduce((a,b)=>b>a?b:a,"")}; }
  function initFilters() {
    const {min,max}=allDates();
    applyPreset("1y",max,min);
    ["f-date-start","f-date-end"].forEach(id=>$(id).addEventListener("change",clearPreset));
    document.querySelectorAll(".date-presets button[data-preset]").forEach(b=>b.addEventListener("click",()=>applyPreset(b.dataset.preset,max,min)));
    $("btn-search").addEventListener("click",()=>{  // 짧은 로딩 스피너 후 적용
      const btn=$("btn-search");
      if (btn.dataset.busy) return;
      const orig=btn.innerHTML;
      btn.dataset.busy="1"; btn.disabled=true;
      btn.innerHTML='<span class="spinner"></span>조회 중';
      setTimeout(()=>{ runQuery(); btn.disabled=false; btn.innerHTML=orig; delete btn.dataset.busy; },250);
    });
    $("btn-reset").addEventListener("click",()=>{ applyPreset("1y",max,min); runQuery(); });
    // 탭 전환 (IPO / 유상증자)
    document.querySelectorAll(".ecm-tab").forEach(t=>t.addEventListener("click",()=>{
      if (t.dataset.tab===tab) return;
      document.querySelectorAll(".ecm-tab").forEach(x=>x.classList.remove("active"));
      t.classList.add("active"); tab=t.dataset.tab;
      document.querySelectorAll(".charts-grid").forEach(g=>{ g.hidden = g.dataset.panel!==tab; });
      runQuery();
    }));
  }
  function clearPreset(){ document.querySelectorAll(".date-presets button").forEach(b=>b.classList.remove("active")); }
  function applyPreset(p,max,min){
    clearPreset(); const b=document.querySelector(`.date-presets button[data-preset="${p}"]`); if(b)b.classList.add("active");
    if(p==="all"){ $("f-date-start").value=min||""; $("f-date-end").value=max||""; return; }
    if(!max)return;
    if(p==="ytd"){ const t=new Date(); const yr=(t.getMonth()+1)===1?t.getFullYear()-1:t.getFullYear(); $("f-date-start").value=`${yr}-01-01`; $("f-date-end").value=max; return; }
    const d=new Date(max),s=new Date(d);
    if(p==="1y")s.setFullYear(s.getFullYear()-1); else if(p==="3y")s.setFullYear(s.getFullYear()-3);
    s.setDate(s.getDate()+1); $("f-date-end").value=max; $("f-date-start").value=s.toISOString().slice(0,10);
  }

  function runQuery() {
    const ds=$("f-date-start").value||"", de=$("f-date-end").value||"";
    $("period-range").textContent=`조회 기간: ${ds||"처음"} ~ ${de||"끝"}`;
    const inR=(r)=> r.date && (!ds||r.date>=ds) && (!de||r.date<=de);
    const ipo=RAW.ipo.filter(r=>inR(r)&&ipoDone(r)), rights=RAW.rights.filter(r=>inR(r)&&rightsDone(r));
    const list = tab==="ipo"?ipo:rights, tl = tab==="ipo"?"IPO":"유상증자";
    const amt = list.reduce((s,r)=>s+total(r),0);
    $("result-count").innerHTML=`${tl} <strong>${list.length.toLocaleString()}</strong>건 · 발행총액 ${fmtAmt(amt)}`;
    renderCharts(ipo,rights);
  }

  function isDark(){ return document.documentElement.getAttribute("data-theme")==="dark"; }
  function C(){ const d=isDark(); return { label:d?"#e2e8f0":"#0f172a", axis:d?"#94a3b8":"#475569", grid:d?"#1e293b":"#eef2f7" }; }

  function renderCharts(ipo, rights) {
    Chart.defaults.font.family="Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    Chart.defaults.font.size=11;
    const col=C(); Chart.defaults.color=col.axis; Chart.defaults.borderColor=col.grid;
    if (window.ChartDataLabels && !Chart.registry.plugins.get("datalabels")) Chart.register(window.ChartDataLabels);
    Object.values(charts).forEach(c=>c&&c.destroy()); charts={};

    const dl = (fmt) => ({ color:col.label, font:{size:11,weight:"700"}, formatter:fmt });
    const cntL = (v)=> v>0? v.toLocaleString()+"건":"";
    const amtL = (v)=> v>0? (v>=10000?(v/10000).toFixed(1)+"조":Math.round(v).toLocaleString()+"억"):"";
    const pct = (v,ctx)=>{ const t=(ctx.dataset.data||[]).reduce((a,b)=>a+(+b||0),0); return t>0 && v/t>=0.03 ? Math.round(v/t*100)+"%":""; };
    const noGrid = { grid:{display:false} };

    // 월별 추이 (최근 13개월 연속 축, 해당 유형 건수 bar + 발행총액 line)
    const monthly = (id, arr, color, barLabel) => {
      const m=new Map();
      arr.forEach(r=>{ const ym=(r.date||"").slice(0,7); if(!ym)return; const v=m.get(ym)||{c:0,a:0}; v.c++; v.a+=total(r); m.set(ym,v); });
      const keys=[...m.keys()].sort(), end=keys.length?keys[keys.length-1]:null;
      let labels=[],counts=[],amts=[];
      if (end){
        let [y,mo]=end.split("-").map(Number); const seq=[];
        for(let i=0;i<13;i++){ seq.push(`${y}-${String(mo).padStart(2,"0")}`); if(--mo===0){mo=12;y--;} }
        seq.reverse(); labels=seq;
        counts=seq.map(k=>(m.get(k)||{c:0}).c);
        amts=seq.map(k=>Math.round((m.get(k)||{a:0}).a));
      }
      return new Chart($(id), { data:{ labels, datasets:[
        {type:"bar",label:barLabel,data:counts,backgroundColor:color,yAxisID:"y",datalabels:dl(cntL)},
        {type:"line",label:"발행총액",data:amts,borderColor:"#f59e0b",backgroundColor:"#f59e0b",yAxisID:"y1",tension:0.3,datalabels:{display:false}},
      ]}, options:{ responsive:true,maintainAspectRatio:false, plugins:{legend:{position:"bottom"}}, scales:{ y:{position:"left",...noGrid,title:{display:true,text:"건수"}}, y1:{position:"right",grid:{display:false},title:{display:true,text:"억원"},ticks:{callback:v=>amtL(v)}} } } });
    };
    // 발행사 Top 10 (총액) — 해당 유형
    const topIssuers = (id, arr) => {
      const iss={}; arr.forEach(r=>{ iss[r.issuer]=(iss[r.issuer]||0)+total(r); });
      const ti=Object.entries(iss).sort((a,b)=>b[1]-a[1]).slice(0,10);
      return new Chart($(id), { type:"bar", data:{ labels:ti.map(x=>x[0]), datasets:[{data:ti.map(x=>Math.round(x[1])),backgroundColor:"#6366f1",datalabels:{...dl(amtL),anchor:"end",align:"end"}}] }, options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}}},scales:{x:{...noGrid,ticks:{callback:v=>amtL(v)}},y:noGrid}} });
    };
    // 주관사 Top 10 (주관 실적) — 해당 유형
    const topLeads = (id, arr) => {
      const ld={}; arr.forEach(r=>{ for(const[a,v]of Object.entries(r.leads||{})) ld[a]=(ld[a]||0)+v; });
      const tl=Object.entries(ld).sort((a,b)=>b[1]-a[1]).slice(0,10);
      return new Chart($(id), { type:"bar", data:{ labels:tl.map(x=>dn(x[0])), datasets:[{data:tl.map(x=>Math.round(x[1])),backgroundColor:"#0ea5e9",datalabels:{...dl(amtL),anchor:"end",align:"end"}}] }, options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}}},scales:{x:{...noGrid,ticks:{callback:v=>amtL(v)}},y:noGrid}} });
    };

    if (tab === "ipo") {
      charts.iy = monthly("ch-ipo-monthly", RAW.ipo.filter(ipoDone), IPO_C, "IPO 건수");  // 최근 13개월 고정(기간필터 무관)
      // IPO 시장별 (건수)
      const mkts={}; ipo.forEach(r=>{ const m=r.market||"기타"; mkts[m]=(mkts[m]||0)+1; });
      const mk=Object.entries(mkts).sort((a,b)=>b[1]-a[1]);
      charts.mk = new Chart($("ch-ipo-market"), { type:"doughnut", data:{ labels:mk.map(x=>x[0]), datasets:[{data:mk.map(x=>x[1]),backgroundColor:PALETTE,datalabels:dl(pct)}] }, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}} });
      // IPO 신주/구주 구성
      let pure=0,mix=0,old=0;
      ipo.forEach(r=>{ const n=r.new_ratio; if(n==null)return; if(n>=0.999)pure++; else if(n<=0.001)old++; else mix++; });
      charts.ns = new Chart($("ch-ipo-newshare"), { type:"doughnut", data:{ labels:["100% 신주","신주+구주 혼합","100% 구주매출"], datasets:[{data:[pure,mix,old],backgroundColor:["#3b82f6","#a855f7","#f59e0b"],datalabels:dl(pct)}] }, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}} });
      charts.ti = topIssuers("ch-ipo-issuers", ipo);
      charts.tl = topLeads("ch-ipo-leads", ipo);
    } else {
      charts.ry = monthly("ch-rt-monthly", RAW.rights.filter(rightsDone), RIGHTS_C, "유상증자 건수");  // 최근 13개월 고정(기간필터 무관)
      // 유상증자 구분별 (건수, 가로 막대)
      const tps={}; rights.forEach(r=>{ const t=r.type||"기타"; tps[t]=(tps[t]||0)+1; });
      const tp=Object.entries(tps).sort((a,b)=>b[1]-a[1]);
      charts.tp = new Chart($("ch-rt-type"), { type:"bar", data:{ labels:tp.map(x=>x[0]), datasets:[{data:tp.map(x=>x[1]),backgroundColor:RIGHTS_C,datalabels:{...dl(cntL),anchor:"end",align:"end"}}] }, options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{...noGrid},y:noGrid}} });
      charts.ti = topIssuers("ch-rt-issuers", rights);
      charts.tl = topLeads("ch-rt-leads", rights);
    }
  }

  // 테마 토글 시 차트 색 갱신
  new MutationObserver(()=>{ if(Object.keys(charts).length) runQuery(); })
    .observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

  loadAll();
})();
