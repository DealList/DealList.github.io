// Numbers Pool — 메자닌(CB/BW/EB) 인포그래픽
// 데이터: mezz_data.json {cb,bw,eb}. 날짜=이사회결의일(bddd), 금액=권면총액(bd_fta_eok, 억).
// 시각·다운로드 설정은 ECM 인포그래픽(ecm-charts/app.js)과 동일하게 맞춤.
(function () {
  "use strict";
  const PALETTE = ["#c9a24a","#34466e","#a07d2c","#5a6f9c","#7d6a3a","#8595b0","#c4973a","#2c3e63","#9a8550","#b0bdd4"];
  // 탭(유형)별 막대/라인 색 — CB 골드 / BW 슬레이트 / EB 브론즈
  const TYPE_COLORS = {
    cb: { bar:"#c9a24a", line:"#3f5b8a", inside:"#1a1408" },
    bw: { bar:"#3f5b8a", line:"#c9a24a", inside:"#ffffff" },
    eb: { bar:"#a07d2c", line:"#34466e", inside:"#ffffff" },
  };
  const TYPE_LABEL = { cb:"CB", bw:"BW", eb:"EB" };
  const FDPP_CATS = ["운영","시설","채무상환","타법인취득","기타"];
  const RATE_BUCKETS = [
    { label:"0%",      test:(v)=>v===0 },
    { label:"0~2%",    test:(v)=>v>0 && v<=2 },
    { label:"2~4%",    test:(v)=>v>2 && v<=4 },
    { label:"4~6%",    test:(v)=>v>4 && v<=6 },
    { label:"6% 초과", test:(v)=>v>6 },
  ];
  // 각 유형 탭에 표시할 차트 정의 (canvas id = ch-<type>-<key>)
  const CHART_DEFS = [
    { key:"monthly",    title:"월별 추이",          desc:"이사회결의일 기준 · 발행 건수와 권면총액", wide:true },
    { key:"method",     title:"공모·사모 (건수)" },
    { key:"method-amt", title:"공모·사모 (금액)" },
    { key:"market",     title:"시장별 (건수)" },
    { key:"fdpp",       title:"자금 사용 목적 (금액)", desc:"운영·시설·채무상환·타법인취득·기타 합산" },
    { key:"issuers",    title:"발행사 Top 10",       desc:"권면총액 기준" },
    { key:"rate",       title:"표면금리 분포 (건수)" },
  ];

  let RAW = { cb:[], bw:[], eb:[] }, META = {}, charts = {}, tab = "cb";
  try { const _t = new URLSearchParams(location.search).get("tab"); if (_t==="cb"||_t==="bw"||_t==="eb") tab=_t; } catch(_){}
  const $ = (id) => document.getElementById(id);
  const D = (r) => r.bddd || "";                        // 날짜 = 이사회결의일
  const total = (r) => (typeof r.bd_fta_eok === "number" ? r.bd_fta_eok : 0);  // 권면총액(억)
  const fmtAmt = (e) => e>=10000 ? `${Math.floor(e/10000).toLocaleString()}조 ${Math.round(e%10000).toLocaleString()}억` : `${Math.round(e).toLocaleString()}억`;

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

  // ===== 패널(탭별 차트 카드) 동적 생성 =====
  function buildPanels() {
    const wrap = $("charts-wrap");
    if (!wrap || wrap.dataset.built) return;
    let html = "";
    for (const t of ["cb","bw","eb"]) {
      html += `<div class="charts-grid" data-panel="${t}"${t===tab?"":" hidden"}>`;
      CHART_DEFS.forEach((d, i) => {
        const descHtml = d.desc ? `<div class="chart-desc">${d.desc}</div>` : "";
        html += `<div class="chart-card${d.wide?" wide":""}">
          <h3><span class="num">${i+1}</span> ${d.title}</h3>
          ${descHtml}
          <div class="chart-wrap"><canvas id="ch-${t}-${d.key}"></canvas></div>
        </div>`;
      });
      html += `</div>`;
    }
    wrap.innerHTML = html;
    wrap.dataset.built = "1";
  }

  async function loadAll() {
    buildPanels();
    try {
      const [d,m] = await Promise.all([
        NP_loadData("mezz_data.json"),
        NP_loadData("mezz_meta.json").catch(()=>({})),
      ]);
      RAW = { cb:(d&&d.cb)||[], bw:(d&&d.bw)||[], eb:(d&&d.eb)||[] };
      META = m || {};
      const nu=$("nav-updated"); if(nu) nu.textContent=`최종 업데이트 ${META.updated_at||"-"}`;
      initFilters(); runQuery();
    } catch(e){ console.error(e); const nu=$("nav-updated"); if(nu) nu.textContent="데이터 로드 실패"; }
  }

  function allDates(){ const ds=[...RAW.cb,...RAW.bw,...RAW.eb].map(D).filter(Boolean); return {min:ds.reduce((a,b)=>(!a||b<a)?b:a,""),max:ds.reduce((a,b)=>b>a?b:a,"")}; }
  function initFilters() {
    const {min,max}=allDates();
    applyPreset("1y",max,min);
    ["f-date-start","f-date-end"].forEach(id=>$(id).addEventListener("change",clearPreset));
    document.querySelectorAll(".date-presets button[data-preset]").forEach(b=>b.addEventListener("click",()=>applyPreset(b.dataset.preset,max,min)));
    $("btn-search").addEventListener("click",()=>{
      const btn=$("btn-search");
      if (btn.dataset.busy) return;
      const orig=btn.innerHTML;
      btn.dataset.busy="1"; btn.disabled=true;
      btn.innerHTML='<span class="spinner"></span>조회 중';
      setTimeout(()=>{ runQuery(); btn.disabled=false; btn.innerHTML=orig; delete btn.dataset.busy; },250);
    });
    $("btn-reset").addEventListener("click",()=>{ applyPreset("1y",max,min); runQuery(); });
    // 탭 전환 (CB / BW / EB)
    document.querySelectorAll(".ecm-tab").forEach(x=>x.classList.toggle("active", x.dataset.tab===tab));
    document.querySelectorAll(".charts-grid").forEach(g=>{ g.hidden = g.dataset.panel!==tab; });
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
    const _pr=$("period-range"); if(_pr) _pr.textContent="";
    const inR=(r)=>{ const dt=D(r); return dt && (!ds||dt>=ds) && (!de||dt<=de); };
    const list = RAW[tab].filter(inR);
    const amt = list.reduce((s,r)=>s+total(r),0);
    $("result-count").innerHTML=`${TYPE_LABEL[tab]} <strong>${list.length.toLocaleString()}</strong>건 · 권면총액 ${fmtAmt(amt)}`;
    renderCharts(tab, list);
  }

  function isDark(){ return document.documentElement.getAttribute("data-theme")==="dark"; }
  function C(){ const d=isDark(); return { label:d?"#e2e8f0":"#0f172a", lineLabel:d?"#e7ddc6":"#1f2d4d", axis:d?"#94a3b8":"#475569", grid:d?"#1e293b":"#eef2f7", gold:"#c9a24a", bronze:d?"#c4973a":"#a07d2c", navy:d?"#4a5d85":"#1f2d4d", slate:d?"#6b7fa8":"#34466e" }; }

  function renderCharts(type, list) {
    Chart.defaults.font.family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif";
    Chart.defaults.font.size=11;
    const col=C(); Chart.defaults.color=col.axis; Chart.defaults.borderColor=col.grid;
    if (window.ChartDataLabels && !Chart.registry.plugins.get("datalabels")) Chart.register(window.ChartDataLabels);
    Chart.defaults.set("plugins.datalabels", {
      color: col.label, font:{size:16,weight:"700"},
      anchor:"end", align:"end", offset:4, clip:false,
      formatter: smartDataLabel,
    });
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
            cctx.fillStyle=ds._labelColor || "#1f2d4d";
            cctx.textAlign="center"; cctx.textBaseline="bottom";
            const topY=chart.chartArea.top-4;
            const fmt = ds._labelUnit==="jo" ? ((v)=>(v/10000).toFixed(1)+"조") : (ds._labelFormatter || fmtAmtShort);
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

    const tc = TYPE_COLORS[type];
    const doughnutLabelOpts = { color:"#ffffff", font:{size:19,weight:"800"}, anchor:"center", align:"center", textStrokeColor:"rgba(0,0,0,0.55)", textStrokeWidth:4 };
    const doughnutLegend = { position:"right", labels:{ font:{size:14,weight:"600"}, padding:12, boxWidth:18 } };
    const amtTip = { tooltip:{ callbacks:{ label:c=>` ${c.label}: ${fmtAmt(c.raw)}` } } };
    const hbarMax = (vals, isAmount) => { const m=Math.max(0,...vals.map(v=>+v||0)); return m>0 ? Math.ceil(m*(isAmount?1.3:1.15)) : undefined; };
    const id = (k) => `ch-${type}-${k}`;

    // ── 1) 월별 추이 (건수 막대 + 권면총액 라인) ──
    const is1y = !!document.querySelector('.date-presets button[data-preset="1y"].active');
    (function monthly(){
      const m=new Map();
      list.forEach(r=>{ const ym=D(r).slice(0,7); if(!ym)return; const v=m.get(ym)||{c:0,a:0}; v.c++; v.a+=total(r); m.set(ym,v); });
      const keys=[...m.keys()].sort();
      let labels=[],counts=[],amts=[];
      if (keys.length){
        if (is1y) {
          let [y,mo]=keys[keys.length-1].split("-").map(Number); const seq=[];
          for(let i=0;i<13;i++){ seq.push(`${y}-${String(mo).padStart(2,"0")}`); if(--mo===0){mo=12;y--;} }
          seq.reverse(); labels=seq;
          counts=seq.map(k=>(m.get(k)||{c:0}).c);
          amts=seq.map(k=>Math.round((m.get(k)||{a:0}).a));
        } else {
          const [sy,sm]=keys[0].split("-").map(Number), [ey,em]=keys[keys.length-1].split("-").map(Number);
          let y=sy, mo=sm;
          while (y<ey || (y===ey && mo<=em)) {
            const k=`${y}-${String(mo).padStart(2,"0")}`;
            labels.push(k); const v=m.get(k)||{c:0,a:0}; counts.push(v.c); amts.push(Math.round(v.a));
            if (++mo>12) { mo=1; y++; }
          }
        }
      }
      charts.monthly = new Chart($(id("monthly")), {
        type:"bar",
        data:{ labels, datasets:[
          { type:"bar", label:`${TYPE_LABEL[type]} 건수`, data:counts, backgroundColor:tc.bar, yAxisID:"y",
            datalabels:{
              anchor:"end",
              align:(ctx)=>{ const s=ctx.chart.scales.y; if(!s)return"start"; const val=ctx.dataset.data[ctx.dataIndex]; const barH=s.bottom-s.getPixelForValue(val); return barH<25?"end":"start"; },
              offset:6,
              color:(ctx)=>{ const s=ctx.chart.scales.y; if(!s)return"#fff"; const val=ctx.dataset.data[ctx.dataIndex]; const barH=s.bottom-s.getPixelForValue(val); return barH<25?col.label:tc.inside; },
              font:{size:15,weight:"700"},
            },
          },
          { type:"line", label:"권면총액(억)", data:amts, borderColor:tc.line, backgroundColor:tc.line,
            yAxisID:"y2", tension:0.3, _isAmount:true,
            _labelAtTop:true, _labelColor:col.lineLabel,
            _labelFont:'700 15px Pretendard, -apple-system, "Malgun Gothic", sans-serif',
            _labelUnit:"jo",
            datalabels:{display:false},
          },
        ]},
        options:{
          maintainAspectRatio:false,
          layout:{ padding:{ top:40, right:12 } },
          plugins:{ legend:{ position:"bottom", labels:{ font:{size:14,weight:"600"}, padding:14, boxWidth:18 } } },
          scales:{
            y:{ type:"linear", position:"left", title:{display:true,text:"건수"} },
            y2:{ type:"linear", position:"right", title:{display:true,text:"권면총액(억)"}, grid:{drawOnChartArea:false} },
          },
        },
      });
    })();

    // ── 2/3) 공모·사모 (건수 / 금액) 도넛 ──
    const mthC={}, mthA={};
    list.forEach(r=>{ const k=r.bdis_mthn||"기타"; mthC[k]=(mthC[k]||0)+1; mthA[k]=(mthA[k]||0)+total(r); });
    const mthOrder=Object.keys(mthC).sort((a,b)=>mthC[b]-mthC[a]);
    charts.method = new Chart($(id("method")), { type:"doughnut",
      data:{ labels:mthOrder, datasets:[{ data:mthOrder.map(k=>mthC[k]), backgroundColor:PALETTE }] },
      options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts } } });
    charts.methodAmt = new Chart($(id("method-amt")), { type:"doughnut",
      data:{ labels:mthOrder, datasets:[{ data:mthOrder.map(k=>Math.round(mthA[k])), backgroundColor:PALETTE, _isAmount:true }] },
      options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts, ...amtTip } } });

    // ── 4) 시장별 (건수) 도넛 ──
    const mkC={};
    list.forEach(r=>{ const k=r.market||"기타"; mkC[k]=(mkC[k]||0)+1; });
    const mkOrder=Object.keys(mkC).sort((a,b)=>mkC[b]-mkC[a]);
    charts.market = new Chart($(id("market")), { type:"doughnut",
      data:{ labels:mkOrder, datasets:[{ data:mkOrder.map(k=>mkC[k]), backgroundColor:PALETTE }] },
      options:{ maintainAspectRatio:false, plugins:{ legend:doughnutLegend, datalabels:doughnutLabelOpts } } });

    // ── 5) 자금 사용 목적 (금액, 가로막대) — fdpp 원→억 합산 ──
    const fd={}; FDPP_CATS.forEach(c=>fd[c]=0);
    list.forEach(r=>{ const f=r.fdpp; if(!f||typeof f!=="object")return; FDPP_CATS.forEach(c=>{ const v=f[c]; if(typeof v==="number") fd[c]+=v; }); });
    const fdData=FDPP_CATS.map(c=>Math.round(fd[c]/1e8));
    charts.fdpp = new Chart($(id("fdpp")), { type:"bar",
      data:{ labels:FDPP_CATS, datasets:[{ label:"금액(억)", data:fdData, backgroundColor:col.navy, _isAmount:true }] },
      options:{ indexAxis:"y", maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}} }, scales:{ x:{ max:hbarMax(fdData,true) } } } });

    // ── 6) 발행사 Top 10 (권면총액, 가로막대) ──
    const iss={}; list.forEach(r=>{ const n=r.issuer||"-"; iss[n]=(iss[n]||0)+total(r); });
    const ti=Object.entries(iss).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const tiData=ti.map(x=>Math.round(x[1]));
    charts.issuers = new Chart($(id("issuers")), { type:"bar",
      data:{ labels:ti.map(x=>x[0]), datasets:[{ label:"권면총액(억)", data:tiData, backgroundColor:tc.bar, _isAmount:true }] },
      options:{ indexAxis:"y", maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtAmt(c.raw)}`}} }, scales:{ x:{ max:hbarMax(tiData,true) } } } });

    // ── 7) 표면금리 분포 (건수, 세로막대) ──
    const rc=RATE_BUCKETS.map(()=>0);
    list.forEach(r=>{ const v=r.intr_ex; if(typeof v!=="number")return; const i=RATE_BUCKETS.findIndex(b=>b.test(v)); if(i>=0)rc[i]++; });
    charts.rate = new Chart($(id("rate")), { type:"bar",
      data:{ labels:RATE_BUCKETS.map(b=>b.label), datasets:[{ label:"건수", data:rc, backgroundColor:tc.bar }] },
      options:{ maintainAspectRatio:false, layout:{ padding:{ top:28 } }, plugins:{ legend:{display:false} },
        scales:{ y:{ beginAtZero:true, grace:"15%", title:{display:true,text:"건수"} } } } });

    attachDownloadButtons();
  }

  // ===== 각 차트 카드에 JPG 다운로드 버튼 부착 (ECM 동일) =====
  function attachDownloadButtons() {
    document.querySelectorAll(".charts-grid:not([hidden]) .chart-card").forEach((card) => {
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
      const prefix = TYPE_LABEL[tab] || "메자닌";
      const showPeriod = !canvas.id.includes("monthly");
      btn.addEventListener("click", () => downloadChartAsJPG(chartKey, title, desc, prefix, showPeriod));
      card.appendChild(btn);
    });
  }

  // ===== 다운로드 (1920×1080 JPG, 상단 제목+설명 합성) — ECM 동일 =====
  function downloadChartAsJPG(chartKey, title, desc, prefix, showPeriod) {
    const src = charts[chartKey];
    if (!src) return;
    const fullTitle = prefix ? `${prefix} ${title}` : title;

    const isDk = document.documentElement.getAttribute("data-theme") === "dark";
    const COLOR_BG    = isDk ? "#0a0a0a" : "#ffffff";
    const COLOR_TITLE = isDk ? "#f1f5f9" : "#0f172a";
    const COLOR_DESC  = isDk ? "#94a3b8" : "#64748b";

    const descLines = [];
    if (showPeriod) {
      const ds = $("f-date-start").value || "처음", de = $("f-date-end").value || "끝";
      descLines.push(`조회 기간: ${ds} ~ ${de}`);
    }
    if (desc) descLines.push(desc);

    const W = 1920, H = 1080;
    const PAD_X      = 72;
    const TITLE_TOP  = 92;
    const DESC_TOP   = 152;
    const DESC_LH    = 40;
    const CHART_Y    = descLines.length ? (DESC_TOP + (descLines.length - 1) * DESC_LH + 48) : 170;
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
    mctx.fillStyle = COLOR_DESC;
    mctx.font = `400 28px ${fontFamily}`;
    descLines.forEach((line, i) => mctx.fillText(line, PAD_X, DESC_TOP + i * DESC_LH));

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
