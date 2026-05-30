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
  const state = { tab:"ipo", sort:{key:"date",dir:"desc"}, page:1,
    issuers:new Set(), leads:new Set(), dateStart:"", dateEnd:"", cat:"" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmtN = (v) => (typeof v==="number" ? v.toLocaleString() : "-");
  const fmtPct = (v) => (typeof v==="number" ? (v*100).toFixed(1)+"%" : "-");
  const fmtX = (v) => (typeof v==="number" ? v.toLocaleString()+"배" : "-");
  const fmtDate = (s) => s || "미정";
  function fmtBrokers(map) {
    const e = Object.entries(map||{}).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
    if (!e.length) return "-";
    return `<span class="bk">` + e.map(([a,v])=>`<span title="${esc(BROKER_FULL[a]||a)}">${esc(a)} ${fmtN(Math.round(v))}</span>`).join(", ") + `</span>`;
  }
  const brokStr = (m) => Object.entries(m||{}).sort((a,b)=>b[1]-a[1]).map(([a,v])=>`${a} ${Math.round(v)}`).join(", ");

  // 탭별 컬럼: id(정렬키) / label / num / cell(HTML) / val(정렬값) / xls(엑셀값)
  const COLS = {
    ipo: [
      {id:"date",label:"상장일",cell:r=>esc(r.date||"상장 예정"),val:r=>r.date,xls:r=>r.date||"상장 예정"},
      {id:"issuer",label:"발행사",cls:"issuer",cell:r=>esc(r.issuer),val:r=>r.issuer,xls:r=>r.issuer},
      {id:"market",label:"시장",cell:r=>esc(r.market),val:r=>r.market,xls:r=>r.market},
      {id:"qty",label:"공모수량",num:1,cell:r=>fmtN(r.final_qty??r.init_qty),val:r=>r.final_qty??r.init_qty,xls:r=>r.final_qty??r.init_qty??""},
      {id:"price",label:"공모가(원)",num:1,cell:r=>fmtN(r.final_price??r.init_price),val:r=>r.final_price??r.init_price,xls:r=>r.final_price??r.init_price??""},
      {id:"total",label:"공모총액(억)",num:1,cell:r=>fmtN(r.final_total??r.init_total),val:r=>r.final_total??r.init_total,xls:r=>r.final_total??r.init_total??""},
      {id:"new_ratio",label:"신주비율",num:1,cell:r=>fmtPct(r.new_ratio),val:r=>r.new_ratio,xls:r=>r.new_ratio??""},
      {id:"ic",label:"기관경쟁률",num:1,cell:r=>fmtX(r.inst&&r.inst.compete),val:r=>(r.inst&&r.inst.compete)||0,xls:r=>(r.inst&&r.inst.compete)??""},
      {id:"gc",label:"일반경쟁률",num:1,cell:r=>fmtX(r.general&&r.general.compete),val:r=>(r.general&&r.general.compete)||0,xls:r=>(r.general&&r.general.compete)??""},
      {id:"leads",label:"주관사",cls:"brokers-cell",cell:r=>fmtBrokers(r.leads),xls:r=>brokStr(r.leads)},
      {id:"uw",label:"인수사",cls:"brokers-cell",cell:r=>fmtBrokers(r.uw),xls:r=>brokStr(r.uw)},
    ],
    rights: [
      {id:"date",label:"신주배정기준일",cell:r=>esc(fmtDate(r.date)),val:r=>r.date,xls:r=>fmtDate(r.date)},
      {id:"issuer",label:"발행사",cls:"issuer",cell:r=>esc(r.issuer),val:r=>r.issuer,xls:r=>r.issuer},
      {id:"type",label:"구분",cell:r=>`<span class="type-pill">${esc(r.type)}</span>`,val:r=>r.type,xls:r=>r.type},
      {id:"payment",label:"납입일",cell:r=>esc(r.payment||"-"),val:r=>r.payment,xls:r=>r.payment||""},
      {id:"new_qty",label:"모집수량",num:1,cell:r=>fmtN(r.new_qty),val:r=>r.new_qty,xls:r=>r.new_qty??""},
      {id:"increase_ratio",label:"증자비율",num:1,cell:r=>fmtPct(r.increase_ratio),val:r=>r.increase_ratio,xls:r=>r.increase_ratio??""},
      {id:"final_price",label:"최종가액(원)",num:1,cell:r=>fmtN(r.final_price),val:r=>r.final_price,xls:r=>r.final_price??""},
      {id:"final_total",label:"최종총액(억)",num:1,cell:r=>fmtN(r.final_total),val:r=>r.final_total,xls:r=>r.final_total??""},
      {id:"leads",label:"주관사",cls:"brokers-cell",cell:r=>fmtBrokers(r.leads),xls:r=>brokStr(r.leads)},
      {id:"uw",label:"인수사",cls:"brokers-cell",cell:r=>fmtBrokers(r.uw),xls:r=>brokStr(r.uw)},
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
      if (state.issuers.size && ![...state.issuers].some(q => r.issuer.includes(q))) return false;
      if (state.cat && (r[cf]||"") !== state.cat) return false;
      if (state.leads.size) {
        const ks = new Set([...Object.keys(r.leads||{}), ...Object.keys(r.uw||{})]);
        if (![...state.leads].some(b => ks.has(b))) return false;
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
  function populateLeads() {
    const s = new Set();
    (DATA[state.tab]||[]).forEach(r => { Object.keys(r.leads||{}).forEach(a=>s.add(a)); Object.keys(r.uw||{}).forEach(a=>s.add(a)); });
    $("f-lead").innerHTML = `<option value="">추가…</option>` + [...s].sort().map(a=>`<option value="${esc(a)}">${esc(BROKER_FULL[a]||a)}</option>`).join("");
  }
  function applyFilters() {
    state.dateStart = $("f-date-start").value||""; state.dateEnd = $("f-date-end").value||"";
    state.cat = $("f-cat").value||""; state.page = 1; render();
  }
  function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab; state.page = 1; state.sort = {key:"date",dir:"desc"};
    state.leads.clear(); state.issuers.clear();
    chipBox("f-lead-chips",state.leads); chipBox("f-issuer-chips",state.issuers);
    populateCat(); populateLeads(); render();
  }

  function download() {
    const cols = COLS[state.tab], list = filtered();
    const aoa = [cols.map(c=>c.label)];
    list.forEach(r => aoa.push(cols.map(c=>c.xls(r))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, state.tab==="ipo"?"IPO":"유상증자");
    XLSX.writeFile(wb, `NumbersPool_ECM_${state.tab}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function init() {
    try {
      const [data, meta] = await Promise.all([
        fetch("../ecm_data.json").then(r=>r.json()),
        fetch("../ecm_meta.json").then(r=>r.json()).catch(()=>null),
      ]);
      DATA = data;
      if (meta) {
        const nu = $("nav-updated"); if (nu) nu.textContent = "최종 업데이트 " + meta.updated;
        if ($("updated")) $("updated").textContent = meta.updated;
        if ($("count")) $("count").textContent = `IPO ${meta.ipo_count} · 유증 ${meta.rights_count}`;
      }
    } catch (e) { console.error(e); const nu=$("nav-updated"); if(nu) nu.textContent="데이터 로드 실패"; return; }

    populateCat(); populateLeads();
    document.querySelectorAll(".ecm-tab").forEach(t => t.addEventListener("click", ()=>switchTab(t.dataset.tab)));
    $("f-issuer").addEventListener("keydown", e => {
      if (e.key==="Enter") { e.preventDefault(); const v=e.target.value.trim();
        if (v && state.issuers.size<10){ state.issuers.add(v); chipBox("f-issuer-chips",state.issuers); e.target.value=""; } }
    });
    $("f-lead").addEventListener("change", e => {
      const v=e.target.value; if (v && state.leads.size<5){ state.leads.add(v); chipBox("f-lead-chips",state.leads); } e.target.value="";
    });
    document.querySelectorAll(".date-presets button").forEach(b =>
      b.addEventListener("click", ()=>{
        const p=b.dataset.preset, end=new Date(), start=new Date();
        if (p==="1y") start.setFullYear(end.getFullYear()-1);
        else if (p==="3y") start.setFullYear(end.getFullYear()-3);
        else { $("f-date-start").value=""; $("f-date-end").value=""; applyFilters(); return; }
        $("f-date-start").value=start.toISOString().slice(0,10);
        $("f-date-end").value=end.toISOString().slice(0,10);
        applyFilters();
      }));
    $("btn-search").addEventListener("click", applyFilters);
    $("btn-reset").addEventListener("click", ()=>{
      state.issuers.clear(); state.leads.clear();
      chipBox("f-issuer-chips",state.issuers); chipBox("f-lead-chips",state.leads);
      $("f-date-start").value=""; $("f-date-end").value=""; $("f-issuer").value=""; $("f-cat").value="";
      state.dateStart=state.dateEnd=state.cat=""; state.page=1; render();
    });
    $("btn-download").addEventListener("click", download);
    render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
