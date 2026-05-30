// Numbers Pool — ECM 정보 페이지 (IPO/유상증자 2탭, 단일 테이블 재렌더)
(function () {
  "use strict";
  const PAGE = 50;
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

  let DATA = { ipo: [], rights: [] };
  let META = null;
  let issuerSet = new Map();  // 현재 탭 발행사 (lowercase → canonical), 정확일치 검증용
  const state = { tab:"ipo", sort:{key:"date",dir:"desc"}, page:1,
    issuers:new Set(), leads:new Set(), uws:new Set(), dateStart:"", dateEnd:"", cat:"", totalMin:0, totalMax:0 };
  const TOTAL_OPTS = [50,100,200,300,500,1000,2000,5000,10000,50000];  // 모집 총액(억원) 범위 브래킷

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmtN = (v) => (typeof v==="number" ? v.toLocaleString() : "-");
  const fmtPct = (v) => (typeof v==="number" ? (v*100).toFixed(1)+"%" : "-");
  const fmtX = (v) => (typeof v==="number" ? v.toLocaleString()+"배" : "-");
  const fmtBig = (eok) => {  // 억 → 조/억 (KPI 금액)
    if (!eok || eok < 0) return "-";
    if (eok >= 10000) { const jo=Math.floor(eok/10000), rest=Math.round(eok%10000);
      return rest>0 ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${jo.toLocaleString()}조`; }
    return `${Math.round(eok).toLocaleString()}억`;
  };
  const fmtMan = (v) => (typeof v==="number" ? Math.round(v/10000).toLocaleString()+"만" : "-");  // 만 단위 반올림 표시
  const fmtManN = (v) => (typeof v==="number" ? Math.round(v/10000).toLocaleString() : "-");  // 만 단위 숫자만 (단위는 헤더)
  const fmtPctN = (v) => (typeof v==="number" ? (v*100).toFixed(1) : "-");  // % 숫자만 (단위는 헤더)
  const fmtDate = (s) => s || "미정";
  function fmtBrokers(map) {
    const e = Object.entries(map||{}).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
    if (!e.length) return "-";
    return `<span class="bk">` + e.map(([a,v])=>`<span title="${esc(BROKER_FULL[a]||a)}">${esc(a)} ${fmtN(Math.round(v))}</span>`).join(", ") + `</span>`;
  }
  function fmtBrokersNames(map) {  // 금액 없이 증권사명만 (IPO·유증 주관/인수) — 금액 desc 순 유지
    const e = Object.entries(map||{}).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
    if (!e.length) return "-";
    return `<span class="bk">` + e.map(([a])=>`<span title="${esc(BROKER_FULL[a]||a)}">${esc(a)}</span>`).join(", ") + `</span>`;
  }
  const brokStr = (m) => Object.entries(m||{}).sort((a,b)=>b[1]-a[1]).map(([a,v])=>`${a} ${Math.round(v)}`).join(", ");

  // 탭별 컬럼: id(정렬키) / label / num / cell(HTML) / val(정렬값) / xls(엑셀값)
  const COLS = {
    ipo: [
      {id:"date",label:"상장일",cell:r=>esc(r.date||"상장 예정"),val:r=>r.date,xls:r=>r.date||"상장 예정"},
      {id:"issuer",label:"회사명",cls:"issuer",cell:r=>esc(r.issuer),val:r=>r.issuer,xls:r=>r.issuer},
      {id:"market",label:"시장",cell:r=>esc(r.market),val:r=>r.market,xls:r=>r.market},
      {id:"qty",label:"모집 수량(만주)",num:1,cell:r=>fmtManN(r.final_qty??r.init_qty),val:r=>r.final_qty??r.init_qty,xls:r=>r.final_qty??r.init_qty??""},
      {id:"price",label:"1주당 모집 가액(원)",num:1,cell:r=>fmtN(r.final_price??r.init_price),val:r=>r.final_price??r.init_price,xls:r=>r.final_price??r.init_price??""},
      {id:"total",label:"모집 총액(억원)",num:1,cell:r=>fmtN(r.final_total??r.init_total),val:r=>r.final_total??r.init_total,xls:r=>r.final_total??r.init_total??""},
      {id:"new_ratio",label:"신주 비율(%)",num:1,cell:r=>fmtPctN(r.new_ratio),val:r=>r.new_ratio,xls:r=>r.new_ratio??""},
      {id:"ic",label:"기관 경쟁률(배)",num:1,cell:r=>fmtN(r.inst&&r.inst.compete),val:r=>(r.inst&&r.inst.compete)||0,xls:r=>(r.inst&&r.inst.compete)??""},
      {id:"gc",label:"일반 경쟁률(배)",num:1,cell:r=>fmtN(r.general&&r.general.compete),val:r=>(r.general&&r.general.compete)||0,xls:r=>(r.general&&r.general.compete)??""},
      {id:"ec",label:"우리사주 청약률(%)",num:1,cell:r=>fmtPctN(r.esop&&r.esop.rate),val:r=>(r.esop&&r.esop.rate)||0,xls:r=>(r.esop&&r.esop.rate)??""},
      {id:"leads",label:"주관사",cls:"brokers-cell",cell:r=>fmtBrokersNames(r.leads),xls:r=>brokStr(r.leads)},
      {id:"uw",label:"인수사",cls:"brokers-cell",cell:r=>fmtBrokersNames(r.uw),xls:r=>brokStr(r.uw)},
    ],
    rights: [
      {id:"date",label:"신주배정기준일",cell:r=>esc(fmtDate(r.date)),val:r=>r.date,xls:r=>fmtDate(r.date)},
      {id:"issuer",label:"회사명",cls:"issuer",cell:r=>esc(r.issuer),val:r=>r.issuer,xls:r=>r.issuer},
      {id:"type",label:"구분",cell:r=>esc(r.type),val:r=>r.type,xls:r=>r.type},
      {id:"payment",label:"납입일",cell:r=>esc(r.payment||"-"),val:r=>r.payment,xls:r=>r.payment||""},
      {id:"new_qty",label:"모집 수량(만주)",num:1,cell:r=>fmtManN(r.new_qty),val:r=>r.new_qty,xls:r=>r.new_qty??""},
      {id:"increase_ratio",label:"증자 비율(%)",num:1,cell:r=>fmtPctN(r.increase_ratio),val:r=>r.increase_ratio,xls:r=>r.increase_ratio??""},
      {id:"init_price",label:"1주당 희망 가액(원)",num:1,cell:r=>fmtN(r.init_price),val:r=>r.init_price,xls:r=>r.init_price??""},
      {id:"price_1",label:"1차 가액(원)",num:1,cell:r=>fmtN(r.price_1),val:r=>r.price_1,xls:r=>r.price_1??""},
      {id:"price_2",label:"2차 가액(원)",num:1,cell:r=>fmtN(r.price_2),val:r=>r.price_2,xls:r=>r.price_2??""},
      {id:"final_price",label:"최종 가액(원)",num:1,cell:r=>fmtN(r.final_price),val:r=>r.final_price,xls:r=>r.final_price??""},
      {id:"final_total",label:"최종 총액(억)",num:1,cell:r=>fmtN(r.final_total),val:r=>r.final_total,xls:r=>r.final_total??""},
      {id:"leads",label:"주관사",cls:"brokers-cell",cell:r=>fmtBrokersNames(r.leads),xls:r=>brokStr(r.leads)},
      {id:"uw",label:"인수사",cls:"brokers-cell",cell:r=>fmtBrokersNames(r.uw),xls:r=>brokStr(r.uw)},
    ],
  };
  const catCfg = { ipo:{field:"market",label:"시장"}, rights:{field:"type",label:"구분"} };

  function filtered() {
    const arr = DATA[state.tab] || [];
    const cf = catCfg[state.tab].field;
    let out = arr.filter(r => {
      if ((state.dateStart || state.dateEnd) && r.date) {
        if (state.dateStart && r.date < state.dateStart) return false;
        if (state.dateEnd && r.date > state.dateEnd) return false;
      }
      if (state.issuers.size && !state.issuers.has(r.issuer)) return false;
      if (state.cat && (r[cf]||"") !== state.cat) return false;
      if (state.tab==="ipo" && (state.totalMin || state.totalMax)) {
        const t = r.final_total ?? r.init_total;
        if (t == null) return false;
        if (state.totalMin && t < state.totalMin) return false;
        if (state.totalMax && t > state.totalMax) return false;
      }
      if (state.leads.size) {
        const lk = Object.keys(r.leads||{});
        if (![...state.leads].some(b => lk.includes(b))) return false;
      }
      if (state.uws.size) {
        const uk = Object.keys(r.uw||{});
        if (![...state.uws].some(b => uk.includes(b))) return false;
      }
      return true;
    });
    const col = COLS[state.tab].find(c => c.id === state.sort.key) || COLS[state.tab][0];
    const sgn = state.sort.dir === "asc" ? 1 : -1;
    out.sort((a,b) => {
      let x = col.val ? col.val(a) : "", y = col.val ? col.val(b) : "";
      if (typeof x === "number" || typeof y === "number") {
        x = typeof x==="number"?x:-Infinity; y = typeof y==="number"?y:-Infinity;
        return (x-y)*sgn;
      }
      const xs = String(x||""), ys = String(y||"");
      // 날짜 컬럼: 빈 값(미정=상장 예정)은 '가장 최신'으로 취급 → date desc 맨 위 / asc 맨 아래
      if (col.id === "date" && (xs === "" || ys === "")) {
        if (xs === "" && ys === "") return 0;
        return (xs === "" ? 1 : -1) * sgn;
      }
      return xs.localeCompare(ys) * sgn;
    });
    return out;
  }

  function updateKPI(list) {  // 조회 기간 주요 정보 위젯 (현재 필터된 목록 기준)
    const grid = $("kpi-grid"); if (!grid) return;
    const tl = state.tab==="ipo" ? "IPO" : "유상증자";
    const amt = r => r.final_total ?? r.init_total ?? 0;
    if (!list.length) {
      grid.innerHTML = `<div class="kpi-cell"><div class="l">조회 기간 ${tl} 건수</div><div class="v">0<small>건</small></div><div class="s">조회 결과 없음</div></div>`;
      return;
    }
    const count = list.length;
    const total = list.reduce((s,r)=>s+amt(r),0);
    const avg = count ? total/count : 0;
    let big=list[0], bigAmt=amt(list[0]);
    for (const r of list){ const a=amt(r); if(a>bigAmt){bigAmt=a;big=r;} }
    const basis = state.tab==="ipo" ? "상장일 기준" : "기준일 기준";
    grid.innerHTML = `
      <div class="kpi-cell"><div class="l">조회 기간 ${tl} 건수</div><div class="v">${count.toLocaleString()}<small>건</small></div><div class="s">${basis}</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 ${tl} 금액</div><div class="v">${fmtBig(total)}</div><div class="s">모집총액 합산</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 평균 ${tl} 규모</div><div class="v">${fmtBig(avg)}</div><div class="s">건당 평균</div></div>
      <div class="kpi-cell"><div class="l">조회 기간 최대 단일 ${tl}</div><div class="v">${esc(big.issuer)}</div><div class="s">${fmtBig(bigAmt)}${big.date?" · "+big.date:""}</div></div>`;
  }

  function render() {
    const cols = COLS[state.tab];
    // thead
    $("ghead").innerHTML = "<tr>" + cols.map(c => {
      const sortCls = state.sort.key === c.id ? (state.sort.dir==="asc"?"sorted-asc":"sorted-desc") : "";
      const cls = [c.num?"num":"", sortCls].filter(Boolean).join(" ");
      return `<th data-col="${c.id}"${cls?` class="${cls}"`:""}>${esc(c.label)}</th>`;
    }).join("") + "</tr>";
    $("ghead").querySelectorAll("th[data-col]").forEach(th =>
      th.addEventListener("click", () => {
        const k = th.dataset.col;
        if (state.sort.key === k) state.sort.dir = state.sort.dir==="asc"?"desc":"asc";
        else state.sort = { key:k, dir: k==="date"?"desc":"asc" };
        render();
      }));
    // rows
    const list = filtered();
    updateKPI(list);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page > pages) state.page = pages;
    const slice = list.slice((state.page-1)*PAGE, state.page*PAGE);
    $("rows").innerHTML = slice.map(r =>
      "<tr>" + cols.map(c => `<td${c.num?' class="num"':(c.cls?` class="${c.cls}"`:"")}>${c.cell(r)}</td>`).join("") + "</tr>"
    ).join("");
    $("empty").classList.toggle("hidden", list.length > 0);
    $("result-count").innerHTML = `<strong>${list.length.toLocaleString()}</strong>건`;
    renderPager(pages);
    document.querySelectorAll(".ecm-tab").forEach(t => t.classList.toggle("active", t.dataset.tab===state.tab));
  }

  function renderPager(pages) {
    const p = $("pager");
    if (pages <= 1) { p.innerHTML = ""; return; }
    const cur = state.page;
    const mk = (n,t,dis,act) => `<button ${dis?"disabled":""} class="${act?"active":""}" data-page="${n}">${t}</button>`;
    let h = mk(cur-1,"‹",cur===1,false);
    const win=[]; for (let i=Math.max(1,cur-2);i<=Math.min(pages,cur+2);i++) win.push(i);
    if (win[0]>1){ h+=mk(1,"1",false,false); if(win[0]>2) h+="<span style='padding:0 4px'>…</span>"; }
    win.forEach(i=>h+=mk(i,i,false,i===cur));
    if (win[win.length-1]<pages){ if(win[win.length-1]<pages-1) h+="<span style='padding:0 4px'>…</span>"; h+=mk(pages,pages,false,false); }
    h += mk(cur+1,"›",cur===pages,false);
    p.innerHTML = h;
    p.querySelectorAll("button[data-page]").forEach(b =>
      b.addEventListener("click", ()=>{ state.page=+b.dataset.page; render(); window.scrollTo(0,0); }));
  }

  function chipBox(boxId, set) {
    const box = $(boxId);
    box.innerHTML = [...set].map(v => `<span class="type-pill">${esc(v)} <button data-v="${esc(v)}" style="border:none;background:none;cursor:pointer;color:inherit">×</button></span>`).join(" ");
    box.querySelectorAll("button").forEach(b => b.addEventListener("click", ()=>{ set.delete(b.dataset.v); chipBox(boxId,set); }));
  }
  function populateCat() {
    const cf = catCfg[state.tab];
    const vals = [...new Set((DATA[state.tab]||[]).map(r=>r[cf.field]).filter(Boolean))].sort();
    $("cat-name").textContent = cf.label;
    $("f-cat").innerHTML = `<option value="">전체</option>` + vals.map(v=>`<option>${esc(v)}</option>`).join("");
    state.cat = "";
  }
  function populateLeads() {  // 주관 증권사 옵션 (r.leads 만)
    const s = new Set();
    (DATA[state.tab]||[]).forEach(r => Object.keys(r.leads||{}).forEach(a=>s.add(a)));
    $("f-lead").innerHTML = `<option value="">추가…</option>` + [...s].sort().map(a=>`<option value="${esc(a)}">${esc(BROKER_FULL[a]||a)}</option>`).join("");
  }
  function populateUws() {  // 인수 증권사 옵션 (r.uw 만)
    const s = new Set();
    (DATA[state.tab]||[]).forEach(r => Object.keys(r.uw||{}).forEach(a=>s.add(a)));
    $("f-uw").innerHTML = `<option value="">추가…</option>` + [...s].sort().map(a=>`<option value="${esc(a)}">${esc(BROKER_FULL[a]||a)}</option>`).join("");
  }
  function populateIssuers() {  // 발행사 datalist 자동완성 + 정확일치용 set (현재 탭)
    const names = [...new Set((DATA[state.tab]||[]).map(r=>r.issuer).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
    issuerSet = new Map(names.map(n=>[n.toLowerCase(), n]));
    const dl = $("issuers-datalist");
    if (dl) dl.innerHTML = names.map(n=>`<option value="${esc(n)}"></option>`).join("");
  }
  function populateTotals() {  // 모집 가액 범위 드롭다운 (1회 채움)
    const opt = v => `<option value="${v}">${v.toLocaleString()}</option>`;
    $("f-total-min").innerHTML = `<option value="">하한 없음</option>` + TOTAL_OPTS.map(opt).join("");
    $("f-total-max").innerHTML = `<option value="">상한 없음</option>` + TOTAL_OPTS.map(opt).join("");
  }
  function dateRange() {  // 현재 탭 데이터의 최소/최대 날짜 (preset 기준)
    const ds = (DATA[state.tab]||[]).map(r=>r.date).filter(Boolean);
    if (!ds.length) return { min:"", max:"" };
    return { min: ds.reduce((a,b)=>b<a?b:a), max: ds.reduce((a,b)=>b>a?b:a) };
  }
  function setActivePreset(p) {  // 프리셋 버튼 active 하이라이트 (p=null 이면 전부 해제)
    document.querySelectorAll(".date-presets button").forEach(b => b.classList.toggle("active", b.dataset.preset === p));
  }
  function applyDefaultRange() {  // 페이지/탭 진입 기본 = 최근 1년 (maxDate 기준) — DCM 동일
    const { max } = dateRange();
    if (max) {
      const s = new Date(max); s.setFullYear(s.getFullYear()-1); s.setDate(s.getDate()+1);
      $("f-date-start").value = s.toISOString().slice(0,10); $("f-date-end").value = max;
    } else { $("f-date-start").value=""; $("f-date-end").value=""; }
    state.dateStart = $("f-date-start").value; state.dateEnd = $("f-date-end").value; state.page = 1;
    setActivePreset("1y");
  }
  function applyFilters() {
    state.dateStart = $("f-date-start").value||""; state.dateEnd = $("f-date-end").value||"";
    state.cat = $("f-cat").value||"";
    state.totalMin = +($("f-total-min").value||0); state.totalMax = +($("f-total-max").value||0);
    state.page = 1; render();
  }
  function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab; state.page = 1; state.sort = {key:"date",dir:"desc"};
    state.leads.clear(); state.uws.clear(); state.issuers.clear();
    chipBox("f-lead-chips",state.leads); chipBox("f-uw-chips",state.uws); chipBox("f-issuer-chips",state.issuers);
    const db=$("date-basis"); if(db) db.textContent = tab==="ipo" ? "상장일" : "신주배정기준일";
    const pf=$("total-filter"); if(pf) pf.style.display = tab==="ipo" ? "" : "none";
    $("f-total-min").value=""; $("f-total-max").value=""; state.totalMin=state.totalMax=0;
    populateCat(); populateLeads(); populateUws(); populateIssuers(); applyDefaultRange(); render();
  }

  function download() {
    if (state.tab === "ipo") { downloadIpoFull(); return; }
    // 유상증자: 웹 컬럼 그대로 (추후 원본화 가능)
    const cols = COLS.rights, list = filtered();
    const aoa = [cols.map(c=>c.label)];
    list.forEach(r => aoa.push(cols.map(c=>c.xls(r))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "유상증자");
    XLSX.writeFile(wb, `NumbersPool_ECM_rights_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // IPO: 원본 ECM Table.xlsx 형태 — 2행 헤더 + 최초/최종/청약 세부 + 주관/인수 broker별 컬럼
  function downloadIpoFull() {
    const list = filtered();
    const leadOrder = (META && META.lead_order) || [];
    const uwOrder   = (META && META.uw_order)   || [];
    const lKnown = new Set(leadOrder), uKnown = new Set(uwOrder);
    const lExtra = new Set(), uExtra = new Set();
    for (const r of list) {
      for (const k of Object.keys(r.leads||{})) if (!lKnown.has(k)) lExtra.add(k);
      for (const k of Object.keys(r.uw||{}))    if (!uKnown.has(k)) uExtra.add(k);
    }
    const LEAD = [...leadOrder, ...lExtra], UW = [...uwOrder, ...uExtra];
    const L0 = 22, U0 = L0 + LEAD.length, TOTAL = U0 + UW.length;

    const row1 = new Array(TOTAL).fill(""), row2 = new Array(TOTAL).fill("");
    row1[0]="상장일"; row1[1]="회사명"; row1[2]="시장";
    row1[3]="최초 희망"; row2[3]="수량"; row2[4]="가액(원)"; row2[5]="총액(억)";
    row1[6]="최종 확정"; row2[6]="수량"; row2[7]="가액(원)"; row2[8]="총액(억)";
    row1[9]="모집방식"; row2[9]="신주비율"; row2[10]="구주비율";
    row1[11]="기관"; row2[11]="최초배정"; row2[12]="청약"; row2[13]="경쟁률"; row2[14]="최종배정";
    row1[15]="일반"; row2[15]="최초배정"; row2[16]="청약"; row2[17]="경쟁률"; row2[18]="최종배정";
    row1[19]="우리사주"; row2[19]="최초배정"; row2[20]="최종배정"; row2[21]="청약률";
    row1[L0]="주관"; LEAD.forEach((b,i)=>row2[L0+i]=b);
    row1[U0]="인수"; UW.forEach((b,i)=>row2[U0+i]=b);

    const dataRows = list.map(r => {
      const a = new Array(TOTAL).fill(null);
      const ins=r.inst||{}, gen=r.general||{}, es=r.esop||{}, la=r.leads||{}, uwm=r.uw||{};
      a[0]=r.date||""; a[1]=r.issuer; a[2]=r.market;
      a[3]=r.init_qty; a[4]=r.init_price; a[5]=r.init_total;
      a[6]=r.final_qty; a[7]=r.final_price; a[8]=r.final_total;
      a[9]=r.new_ratio; a[10]=r.old_ratio;
      a[11]=ins.initial; a[12]=ins.subscribed; a[13]=ins.compete; a[14]=ins.final;
      a[15]=gen.initial; a[16]=gen.subscribed; a[17]=gen.compete; a[18]=gen.final;
      a[19]=es.initial; a[20]=es.final; a[21]=es.rate;
      LEAD.forEach((b,i)=>{ const v=la[b]; if (v) a[L0+i]=v; });
      UW.forEach((b,i)=>{ const v=uwm[b]; if (v) a[U0+i]=v; });
      return a;
    });

    const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...dataRows]);

    const merges = [];
    const grp=(c0,c1)=>merges.push({s:{r:0,c:c0},e:{r:0,c:c1}});
    grp(3,5); grp(6,8); grp(9,10); grp(11,14); grp(15,18); grp(19,21); grp(L0,U0-1); grp(U0,TOTAL-1);
    [0,1,2].forEach(c=>merges.push({s:{r:0,c},e:{r:1,c}}));
    ws["!merges"]=merges;

    const hs = { font:{bold:true}, alignment:{horizontal:"center",vertical:"center"},
      fill:{fgColor:{rgb:"F1F5F9"},patternType:"solid"},
      border:{top:{style:"thin",color:{rgb:"CBD5E1"}},bottom:{style:"thin",color:{rgb:"CBD5E1"}},
              left:{style:"thin",color:{rgb:"CBD5E1"}},right:{style:"thin",color:{rgb:"CBD5E1"}}} };
    for (let c=0;c<TOTAL;c++) for (let r=0;r<2;r++){ const ref=XLSX.utils.encode_cell({r,c}); if(ws[ref]) ws[ref].s=hs; }

    for (let i=0;i<dataRows.length;i++){ const r=i+2;
      [9,10,21].forEach(c=>{ const ref=XLSX.utils.encode_cell({r,c}); if(ws[ref]&&typeof ws[ref].v==="number") ws[ref].z="0.0%"; });
    }

    const cw=new Array(TOTAL).fill({wch:6});
    cw[0]={wch:11}; cw[1]={wch:16}; cw[2]={wch:7};
    [3,4,5,6,7,8,11,12,13,14,15,16,17,18,19,20,21].forEach(c=>cw[c]={wch:11});
    [9,10].forEach(c=>cw[c]={wch:8});
    ws["!cols"]=cw; ws["!rows"]=[{hpt:20},{hpt:18}];

    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IPO");
    XLSX.writeFile(wb, `NumbersPool_ECM_IPO_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function init() {
    try {
      const [data, meta] = await Promise.all([
        fetch("../ecm_data.json").then(r=>r.json()),
        fetch("../ecm_meta.json").then(r=>r.json()).catch(()=>null),
      ]);
      DATA = data;
      META = meta;
      if (meta) {
        const nu = $("nav-updated"); if (nu) nu.textContent = "최종 업데이트 " + meta.updated;
        if ($("updated")) $("updated").textContent = meta.updated;
        if ($("count")) $("count").textContent = `IPO ${meta.ipo_count} · 유증 ${meta.rights_count}`;
      }
    } catch (e) { console.error(e); const nu=$("nav-updated"); if(nu) nu.textContent="데이터 로드 실패"; return; }

    populateCat(); populateLeads(); populateUws(); populateIssuers(); populateTotals();
    document.querySelectorAll(".ecm-tab").forEach(t => t.addEventListener("click", ()=>switchTab(t.dataset.tab)));
    $("f-issuer").addEventListener("keydown", e => {
      if (e.key!=="Enter") return; e.preventDefault();
      const v=$("f-issuer").value.trim(); if(!v) return;
      const canonical = issuerSet.get(v.toLowerCase());
      if (!canonical) { alert("'"+v+"' 발행사를 찾을 수 없습니다.\n\nDART 공시 기준 정확한 회사명을 입력하거나 자동완성 목록에서 선택해 주세요."); return; }
      if (state.issuers.size>=10 || state.issuers.has(canonical)) { $("f-issuer").value=""; return; }
      state.issuers.add(canonical); chipBox("f-issuer-chips",state.issuers); $("f-issuer").value="";
    });
    $("f-lead").addEventListener("change", e => {
      const v=e.target.value; if (v && state.leads.size<5){ state.leads.add(v); chipBox("f-lead-chips",state.leads); } e.target.value="";
    });
    $("f-uw").addEventListener("change", e => {
      const v=e.target.value; if (v && state.uws.size<5){ state.uws.add(v); chipBox("f-uw-chips",state.uws); } e.target.value="";
    });
    document.querySelectorAll(".date-presets button").forEach(b =>
      b.addEventListener("click", ()=>{
        // 프리셋은 날짜 input 만 세팅 — 리스트는 "조회" 버튼 누를 때 반영 (DCM 동일)
        const p=b.dataset.preset;
        setActivePreset(p);
        const {min,max}=dateRange();
        if (p==="all"){ $("f-date-start").value=min||""; $("f-date-end").value=max||""; return; }
        if (!max) return;
        const s=new Date(max);
        if (p==="3m") s.setMonth(s.getMonth()-3);
        else if (p==="6m") s.setMonth(s.getMonth()-6);
        else if (p==="1y") s.setFullYear(s.getFullYear()-1);
        s.setDate(s.getDate()+1);
        $("f-date-end").value=max;
        $("f-date-start").value=s.toISOString().slice(0,10);
      }));
    ["f-date-start","f-date-end"].forEach(id => $(id).addEventListener("change", ()=>setActivePreset(null)));
    $("btn-search").addEventListener("click", () => {  // 짧은 로딩 스피너 후 적용
      const btn = $("btn-search");
      if (btn.dataset.busy) return;
      const orig = btn.innerHTML;
      btn.dataset.busy = "1"; btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>조회 중';
      setTimeout(() => {
        applyFilters();
        btn.disabled = false; btn.innerHTML = orig; delete btn.dataset.busy;
      }, 250);
    });
    $("btn-reset").addEventListener("click", ()=>{
      state.issuers.clear(); state.leads.clear(); state.uws.clear();
      chipBox("f-issuer-chips",state.issuers); chipBox("f-lead-chips",state.leads); chipBox("f-uw-chips",state.uws);
      $("f-issuer").value=""; $("f-cat").value=""; state.cat="";
      $("f-total-min").value=""; $("f-total-max").value=""; state.totalMin=state.totalMax=0;
      applyDefaultRange(); render();
    });
    $("btn-download").addEventListener("click", download);
    applyDefaultRange(); render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
