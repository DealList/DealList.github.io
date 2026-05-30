// Numbers Pool — ECM 인포그래픽 (IPO / 유상증자 탭별 차트)
// 시각 설정·다운로드는 DCM 인포그래픽(charts/app.js)과 동일하게 맞춤.
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

  // ===== 데이터라벨 포맷 (DCM 인포그래픽과 동일) =====
  function fmtCount(v){ if(!Number.isFinite(v)||v<=0) return ""; return v.toLocaleString()+"건"; }
  function fmtAmtShort(v){ if(!Number.isFinite(v)||v<=0) return ""; if(v>=10000) return (v/10000).toFixed(1)+"조"; return Math.round(v).toLocaleString()+"억"; }
  function smartDataLabel(value, ctx){
    if(!Number.isFinite(value)||value<=0) return "";
    const cType = ctx.chart.config.type;
    if(cType==="doughnut"||cType==="pie"){
      const t=(ctx.dataset.data||[]).reduce((a,b)=>(Number(a)||0)+(Number(b)||0),0);
      if(t>0 && value/t<0.03) return "";
    }
    return ctx.dataset._isAmount ? fmtAmtShort(value) : fmtCount(value);
  }

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
  function C(){ const d=isDark(); return { label:d?"#e2e8f0":"#0f172a", lineLabel:d?"#93c5fd":"#1e40af", axis:d?"#94a3b8":"#475569", grid:d?"#1e293b":"#eef2f7" }; }

  function renderCharts(ipo, rights) {
    Chart.defaults.font.family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif";
    Chart.defaults.font.size=11;
    const col=C(); Chart.defaults.color=col.axis; Chart.defaults.borderColor=col.grid;
    if (window.ChartDataLabels && !Chart.registry.plugins.get("datalabels")) Chart.register(window.ChartDataLabels);
    // 데이터라벨 글로벌 기본값 (DCM 동일: size 16, 막대 끝 바깥)
    Chart.defaults.set("plugins.datalabels", {
      color: col.label, font:{size:16,weight:"700"},
      anchor:"end", align:"end", offset:4, clip:false,
      formatter: smartDataLabel,
    });
    // 라인 dataset 라벨을 차트 영역 상단에 고정 배치 (막대와 겹침 방지) — DCM 동일
    if (!Chart.registry.plugins.get("lineLabelsAtTop")) {
      Chart.register({
        id:"lineLabelsAtTop",
        afterDatasetsDraw(chart){
          const cctx=chart.ctx;
          chart.data.datasets.forEach((ds,dsIdx)=>{
            if(!ds._labelAtTop) return;
            const meta=chart.getDatasetMeta(dsIdx);
            cctx.save();
            cctx.font=ds._labelFont || '700 12px Pretendard, -apple-system, sans-serif';
            cctx.fillStyle=ds._labelColor || "#1e40af";
            cctx.textAlign="center"; cctx.textBaseline="bottom";
            const topY=chart.chartArea.top-4;
            const fmt=ds._labelFormatter || fmtAmtShort;
            meta.data.forEach((point,i)=>{
              const value=ds.data[i];
              if(!Number.isFinite(value)||value<=0) return;
              cctx.fillText(fmt(value), point.x, topY);
            });
            cctx.restore();
          });
        },
      });
    }
    Object.values(charts).forEach(c=>c&&c.destroy()); charts={};

    // doughnut 공통: 슬라이스 안 흰 글씨(외곽선) + 우측 범례 — DCM 동일
    const doughnutLabelOpts = { color:"#ffffff", font:{size:19,weight:"800"}, anchor:"center", align:"center", textStrokeColor:"rgba(0,0,0,0.55)", textStrokeWidth:4 };
    const doughnutLegend = { position:"right", labels:{ font:{size:14,weight:"600"}, padding:12, boxWidth:18 } };

    // 월별 추이 (최근 13개월 고정, 막대=건수 + 선=발행총액) — DCM ① 스타일
    const monthly = (id, arr, barColor, barLabel) => {
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
      return new Chart($(id), {
        type:"bar",
        data:{ labels, datasets:[
          { type:"bar", label:barLabel, data:counts, backgroundColor:barColor, yAxisID:"y",
            datalabels:{
              anchor:"end",
              align:(ctx)=>{ const s=ctx.chart.scales.y; if(!s)return"start"; const val=ctx.dataset.data[ctx.dataIndex]; const barH=s.bottom-s.getPixelForValue(val); return barH<25?"end":"start"; },
              offset:6,
              color:(ctx)=>{ const s=ctx.chart.scales.y; if(!s)return"#fff"; const val=ctx.dataset.data[ctx.dataIndex]; const barH=s.bottom-s.getPixelForValue(val); return barH<25?col.label:"#ffffff"; },
              font:{size:15,weight:"700"},
            },
          },
          { type:"line", label:"발행총액(억)", data:amts, borderColor:"#f59e0b", backgroundColor:"#f59e0b",
            yAxisID:"y2", tension:0.3, _isAmount:true,
            _labelAtTop:true, _labelColor:col.lineLabel,
            _labelFont:'700 15px Pretendard, -apple-system, "Malgun Gothic", sans-serif',
            _labelFormatter:(v)=>(v/10000).toFixed(1)+"조",
            datalabels:{display:false},
          },
        ]},
        options:{
          maintainAspectRatio:false,
          layout:{ padding:{ top:40, right:12 } },
          plugins:{ legend:{ position:"bottom", labels:{ font:{size:14,weight:"600"}, padding:14, boxWidth:18 } } },
          scales:{
            y:{ type:"linear", position:"left", title:{display:true,text:"건수"} },
            y2:{ type:"linear", position:"right", title:{display:true,text:"발행총액(억)"}, grid:{drawOnChartArea:false} },
          },
        },
      });
    };
    // 발행사 Top 10 (총액, 가로막대) — DCM hbar 스타일 (글로벌 datalabels 16, _isAmount)
    const topIssuers = (id, arr) => {
      const iss={}; arr.forEach(r=>{ iss[r.issuer]=(iss[r.issuer]||0)+total(r); });
      const ti=Object.entries(iss).sort((a,b)=>b[1]-a[1]).slice(0,10);
      return new Chart($(id), { type:"bar",
        data:{ labels:ti.map(x=>x[0]), datasets:[{ label:"발행총액(억)", data:ti.map(x=>Math.round(x[1])), backgroundColor:"#f97316", _isAmount:true }] },
        options:{ indexAxis:"y", maintainAspectRatio:false, layout:{padding:{right:60}}, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}} } } });
    };
    // 주관사 Top 10 (주관 실적, 가로막대)
    const topLeads = (id, arr) => {
      const ld={}; arr.forEach(r=>{ for(const[a,v]of Object.entries(r.leads||{})) ld[a]=(ld[a]||0)+v; });
      const t=Object.entries(ld).sort((a,b)=>b[1]-a[1]).slice(0,10);
      return new Chart($(id), { type:"bar",
        data:{ labels:t.map(x=>dn(x[0])), datasets:[{ label:"주관 실적(억)", data:t.map(x=>Math.round(x[1])), backgroundColor:"#22c55e", _isAmount:true }] },
        options:{ indexAxis:"y", maintainAspectRatio:false, layout:{padding:{right:60}}, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}} } } });
    };

    // 도넛 금액 차트 tooltip (전체 금액 표기)
    const amtTip = { tooltip:{ callbacks:{ label:c=>` ${c.label}: ${fmtAmt(c.raw)}` } } };
    if (tab === "ipo") {
      charts.iy = monthly("ch-ipo-monthly", RAW.ipo.filter(ipoDone), IPO_C, "IPO 건수");  // 최근 13개월 고정(기간필터 무관)
      // IPO 시장별 (건수) + (금액) — 두 도넛 동일 라벨 순서
      const mktC={}, mktA={};
      ipo.forEach(r=>{ const m=r.market||"기타"; mktC[m]=(mktC[m]||0)+1; mktA[m]=(mktA[m]||0)+total(r); });
      const mkOrder=Object.keys(mktC).sort((a,b)=>mktC[b]-mktC[a]);
      charts.mk = new Chart($("ch-ipo-market"), { type:"doughnut",
        data:{ labels:mkOrder, datasets:[{ data:mkOrder.map(m=>mktC[m]), backgroundColor:PALETTE }] },
        options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts } } });
      charts.mka = new Chart($("ch-ipo-market-amt"), { type:"doughnut",
        data:{ labels:mkOrder, datasets:[{ data:mkOrder.map(m=>Math.round(mktA[m])), backgroundColor:PALETTE, _isAmount:true }] },
        options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts, ...amtTip } } });
      // IPO 신주/구주 구성 (건수) + (금액)
      const nsLabels=["100% 신주","신주+구주 혼합","100% 구주매출"], nsColors=["#3b82f6","#a855f7","#f59e0b"];
      const nsC=[0,0,0], nsA=[0,0,0];
      ipo.forEach(r=>{ const n=r.new_ratio; if(n==null)return; const i = n>=0.999?0 : (n<=0.001?2 : 1); nsC[i]++; nsA[i]+=total(r); });
      charts.ns = new Chart($("ch-ipo-newshare"), { type:"doughnut",
        data:{ labels:nsLabels, datasets:[{ data:nsC, backgroundColor:nsColors }] },
        options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts } } });
      charts.nsa = new Chart($("ch-ipo-newshare-amt"), { type:"doughnut",
        data:{ labels:nsLabels, datasets:[{ data:nsA.map(v=>Math.round(v)), backgroundColor:nsColors, _isAmount:true }] },
        options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts, ...amtTip } } });
      charts.ti = topIssuers("ch-ipo-issuers", ipo);
      charts.tl = topLeads("ch-ipo-leads", ipo);
    } else {
      charts.ry = monthly("ch-rt-monthly", RAW.rights.filter(rightsDone), RIGHTS_C, "유상증자 건수");  // 최근 13개월 고정(기간필터 무관)
      // 유상증자 구분별 (건수) + (금액) — 같은 구분 순서(건수 내림차순)
      const tC={}, tA={};
      rights.forEach(r=>{ const t=r.type||"기타"; tC[t]=(tC[t]||0)+1; tA[t]=(tA[t]||0)+total(r); });
      const tOrder=Object.keys(tC).sort((a,b)=>tC[b]-tC[a]);
      charts.tp = new Chart($("ch-rt-type"), { type:"bar",
        data:{ labels:tOrder, datasets:[{ label:"건수", data:tOrder.map(t=>tC[t]), backgroundColor:RIGHTS_C }] },
        options:{ indexAxis:"y", maintainAspectRatio:false, layout:{padding:{right:48}}, plugins:{ legend:{display:false} } } });
      charts.tpa = new Chart($("ch-rt-type-amt"), { type:"bar",
        data:{ labels:tOrder, datasets:[{ label:"발행총액(억)", data:tOrder.map(t=>Math.round(tA[t])), backgroundColor:"#0e7490", _isAmount:true }] },
        options:{ indexAxis:"y", maintainAspectRatio:false, layout:{padding:{right:60}}, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}} } } });
      charts.ti = topIssuers("ch-rt-issuers", rights);
      charts.tl = topLeads("ch-rt-leads", rights);
    }

    attachDownloadButtons();
  }

  // ===== 각 차트 카드에 JPG 다운로드 버튼 부착 (DCM 동일) =====
  function attachDownloadButtons() {
    document.querySelectorAll(".chart-card").forEach((card) => {
      if (card.querySelector(".chart-download-btn")) return;
      const canvas = card.querySelector("canvas");
      if (!canvas) return;
      const chartKey = Object.keys(charts).find((k) => charts[k] && charts[k].canvas === canvas);
      if (!chartKey) return;
      const h3 = card.querySelector("h3");
      const title = h3 ? h3.textContent.replace(/^\s*\d+\s*/, "").trim() : canvas.id;
      const descEl = card.querySelector(".chart-desc");
      const desc = descEl ? descEl.textContent.trim() : "";
      const btn = document.createElement("button");
      btn.className = "chart-download-btn";
      btn.type = "button";
      btn.title = "이 차트를 JPG로 다운로드 (1920×1080)";
      btn.dataset.key = chartKey;
      btn.dataset.label = title;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      btn.addEventListener("click", () => downloadChartAsJPG(chartKey, title, desc));
      card.appendChild(btn);
    });
  }

  // ===== 다운로드 (1920×1080 JPG, 상단 제목+설명 합성) — DCM 동일 =====
  function downloadChartAsJPG(chartKey, title, desc) {
    const src = charts[chartKey];
    if (!src) return;
    const fullTitle = title;

    const isDk = document.documentElement.getAttribute("data-theme") === "dark";
    const COLOR_BG    = isDk ? "#0a0a0a" : "#ffffff";
    const COLOR_TITLE = isDk ? "#f1f5f9" : "#0f172a";
    const COLOR_DESC  = isDk ? "#94a3b8" : "#64748b";

    const W = 1920, H = 1080;
    const PAD_X      = 72;
    const TITLE_TOP  = 92;
    const DESC_TOP   = 152;
    const CHART_Y    = desc ? 200 : 170;
    const CHART_PAD_B = 40;
    const CHART_W    = W;
    const CHART_H    = H - CHART_Y - CHART_PAD_B;

    const mainCanvas = document.createElement("canvas");
    mainCanvas.width = W; mainCanvas.height = H;
    const mctx = mainCanvas.getContext("2d");
    mctx.fillStyle = COLOR_BG; mctx.fillRect(0, 0, W, H);
    const fontFamily = `Pretendard, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    mctx.fillStyle = COLOR_TITLE;
    mctx.font = `700 48px ${fontFamily}`;
    mctx.textBaseline = "alphabetic";
    mctx.fillText(fullTitle, PAD_X, TITLE_TOP);
    if (desc) {
      mctx.fillStyle = COLOR_DESC;
      mctx.font = `400 28px ${fontFamily}`;
      mctx.fillText(desc, PAD_X, DESC_TOP);
    }

    const chartCanvas = document.createElement("canvas");
    chartCanvas.width = CHART_W; chartCanvas.height = CHART_H;
    chartCanvas.style.cssText = "position:fixed;left:-99999px;top:-99999px;";
    document.body.appendChild(chartCanvas);

    const cfg = src.config;
    const clonedData = JSON.parse(JSON.stringify(cfg.data));
    const clonedOptions = JSON.parse(JSON.stringify(cfg.options || {}));
    clonedOptions.animation = false;
    clonedOptions.responsive = false;
    clonedOptions.maintainAspectRatio = false;
    clonedOptions.devicePixelRatio = 1;

    const SCALE = 2.6;
    const baseSize = (Chart.defaults.font && Chart.defaults.font.size) || 11;
    clonedOptions.font = clonedOptions.font || {};
    if (typeof clonedOptions.font.size !== "number") clonedOptions.font.size = baseSize;
    const scaleFonts = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(scaleFonts); return; }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "font" && v && typeof v === "object" && typeof v.size === "number") {
          v.size = Math.round(v.size * SCALE);
        } else if (typeof v === "object") { scaleFonts(v); }
      }
    };
    scaleFonts(clonedOptions);
    scaleFonts(clonedData);
    (clonedData.datasets || []).forEach((ds) => {
      if (typeof ds._labelFont === "string") {
        ds._labelFont = ds._labelFont.replace(/(\d+)px/, (_, sz) => `${Math.round(parseInt(sz,10)*SCALE)}px`);
      }
    });
    clonedOptions.plugins = clonedOptions.plugins || {};
    clonedOptions.plugins.datalabels = clonedOptions.plugins.datalabels || {};
    if (!clonedOptions.plugins.datalabels.font) {
      clonedOptions.plugins.datalabels.font = { size: Math.round(16 * SCALE), weight: "700" };
    }

    const origDefaultsFontSize = (Chart.defaults.font && Chart.defaults.font.size) || 11;
    if (!Chart.defaults.font) Chart.defaults.font = {};
    Chart.defaults.font.size = Math.round(origDefaultsFontSize * SCALE);

    const tempChart = new Chart(chartCanvas, { type: cfg.type, data: clonedData, options: clonedOptions });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        mctx.drawImage(chartCanvas, 0, CHART_Y);
        const dataURL = mainCanvas.toDataURL("image/jpeg", 0.95);
        const today = new Date().toISOString().slice(0, 10);
        const safeTitle = fullTitle.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
        const a = document.createElement("a");
        a.href = dataURL;
        a.download = `NumbersPool_${safeTitle}_${today}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
      } finally {
        tempChart.destroy();
        chartCanvas.remove();
        Chart.defaults.font.size = origDefaultsFontSize;
      }
    }));
  }

  // 테마 토글 시 차트 색 갱신
  new MutationObserver(()=>{ if(Object.keys(charts).length) runQuery(); })
    .observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

  loadAll();
})();
