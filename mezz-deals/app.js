// Numbers Pool — 메자닌(CB/BW/EB) 발행정보 (3탭, 단일 테이블 재렌더)
(function () {
  "use strict";
  const PAGE = 50;
  const TOTAL_OPTS = [10, 50, 100, 300, 500, 1000, 3000, 5000, 10000];  // 권면총액(억원) 범위

  let DATA = { cb: [], bw: [], eb: [] };
  let META = null;
  let issuerSet = new Map();
  const state = {
    tab: "cb", sort: { key: "bddd", dir: "desc" }, page: 1,
    issuers: new Set(), market: "", method: "",
    dateStart: "", dateEnd: "", totalMin: 0, totalMax: 0,
  };
  try { const _t = new URLSearchParams(location.search).get("tab"); if (["cb","bw","eb"].includes(_t)) state.tab = _t; } catch (_) {}

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
  const fmtN = (v) => (typeof v === "number" ? v.toLocaleString() : "-");
  const fmtNum1 = (v) => (typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "-");
  const fmtPctN = (v) => {  // 소수 2자리까지(불필요한 0 제거) — 변환비율·총수대비용
    if (typeof v !== "number" || !isFinite(v)) return "-";
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };
  const fmtPct2Fixed = (v) => {  // 소수 2자리 고정(0 유지) — 표면금리/만기금리 통일 표시
    if (typeof v !== "number" || !isFinite(v)) return "-";
    return v.toFixed(2);
  };
  const fmtManN = (v) => (typeof v === "number" ? Math.round(v / 10000).toLocaleString() : "-");
  const fmtDate = (s) => s || "-";
  const fmtRange = (a, b) => (a || b) ? `${a || "-"} ~ ${b || "-"}` : "-";

  // type 별 표시 라벨 (전환/행사/교환)
  const CONV_LABEL = {
    cb: { prc: "전환가(원)", qty: "전환주식수(만주)", vs: "총수 대비(%)", period: "전환기간" },
    bw: { prc: "행사가(원)", qty: "행사주식수(만주)", vs: "총수 대비(%)", period: "행사기간" },
    eb: { prc: "교환가(원)", qty: "교환주식수(만주)", vs: "총수 대비(%)", period: "교환기간" },
  };

  function buildCols(tab) {
    const lab = CONV_LABEL[tab];
    // 순서 = 표시 순서. hide: true 면 표·정렬에선 숨김(Excel 다운로드에는 포함).
    return [
      { id: "bddd",      label: "이사회 결의일",  cell: r => esc(fmtDate(r.bddd)),      val: r => r.bddd,      xls: r => r.bddd || "" },
      { id: "issuer",    label: "발행사", cls: "issuer",
        cell: r => r.rcept ? `<a class="dart-link" href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(r.rcept)}" data-rcept="${esc(r.rcept)}">${esc(r.issuer)}</a>` : esc(r.issuer),
        val:  r => r.issuer, xls: r => r.issuer || "" },
      { id: "bd_tm",     label: "회차", num: 1,  cell: r => fmtN(r.bd_tm),            val: r => r.bd_tm,     xls: r => r.bd_tm ?? "" },
      { id: "bdis_mthn", label: "방식",          cell: r => esc(r.bdis_mthn || "-"), val: r => r.bdis_mthn, xls: r => r.bdis_mthn || "" },
      { id: "pymd",      label: "납입일",        cell: r => esc(fmtDate(r.pymd)),     val: r => r.pymd,      xls: r => r.pymd || "" },
      { id: "bd_mtd",    label: "만기일",        cell: r => esc(fmtDate(r.bd_mtd)),   val: r => r.bd_mtd,    xls: r => r.bd_mtd || "" },
      { id: "bd_fta",    label: "권면총액(억원)", num: 1, cell: r => fmtNum1(r.bd_fta_eok), val: r => r.bd_fta_eok, xls: r => r.bd_fta_eok ?? "" },
      { id: "intr_ex",   label: "표면금리(%)",   num: 1, cell: r => fmtPct2Fixed(r.intr_ex), val: r => r.intr_ex, xls: r => r.intr_ex ?? "" },
      { id: "intr_sf",   label: "만기금리(%)",   num: 1, cell: r => fmtPct2Fixed(r.intr_sf), val: r => r.intr_sf, xls: r => r.intr_sf ?? "" },
      { id: "conv_prc",  label: lab.prc, num: 1, cell: r => fmtN(r.conv_prc),         val: r => r.conv_prc,  xls: r => r.conv_prc ?? "" },
      { id: "conv_qty",  label: lab.qty, num: 1, cell: r => fmtManN(r.conv_qty),      val: r => r.conv_qty,  xls: r => r.conv_qty ?? "" },
      { id: "conv_vs",   label: lab.vs,  num: 1, cell: r => fmtPctN(r.conv_vs),       val: r => r.conv_vs,   xls: r => r.conv_vs ?? "" },
      { id: "conv_per",  label: lab.period,
        cell: r => esc(fmtRange(r.conv_bgd, r.conv_edd)),
        val: r => r.conv_bgd || "", xls: r => fmtRange(r.conv_bgd, r.conv_edd) },
      // ─ 표 비공개(웹에선 숨김, Excel 다운로드에는 포함) ─
      { id: "sbd",       label: "청약일", hide: true, cell: r => esc(fmtDate(r.sbd)),  val: r => r.sbd,       xls: r => r.sbd || "" },
      { id: "market",    label: "시장", hide: true,  cell: r => esc(r.market || "-"),  val: r => r.market,    xls: r => r.market || "" },
      { id: "rpmcmp",    label: "대표주관", hide: true, cell: r => esc(r.rpmcmp || "-"), val: r => r.rpmcmp || "", xls: r => r.rpmcmp || "" },
      { id: "bd_knd",    label: "종류", hide: true, cell: r => esc(r.bd_knd || "-"),   val: r => r.bd_knd || "", xls: r => r.bd_knd || "" },
    ];
  }

  function filtered() {
    const arr = DATA[state.tab] || [];
    const out = arr.filter(r => {
      if ((state.dateStart || state.dateEnd) && r.bddd) {
        if (state.dateStart && r.bddd < state.dateStart) return false;
        if (state.dateEnd && r.bddd > state.dateEnd) return false;
      }
      if (state.issuers.size && !state.issuers.has(r.issuer)) return false;
      if (state.market && (r.market || "") !== state.market) return false;
      if (state.method && (r.bdis_mthn || "") !== state.method) return false;
      if (state.totalMin || state.totalMax) {
        const t = r.bd_fta_eok;
        if (t == null) return false;
        if (state.totalMin && t < state.totalMin) return false;
        if (state.totalMax && t > state.totalMax) return false;
      }
      return true;
    });
    const cols = buildCols(state.tab);
    const col = cols.find(c => c.id === state.sort.key) || cols[0];
    const sgn = state.sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      let x = col.val ? col.val(a) : "", y = col.val ? col.val(b) : "";
      if (typeof x === "number" || typeof y === "number") {
        const xn = typeof x === "number", yn = typeof y === "number";
        // 빈값(숫자 아님)은 asc/desc 무관하게 맨 뒤로
        if (!xn || !yn) return (!xn && !yn) ? 0 : (!xn ? 1 : -1);
        return (x - y) * sgn;
      }
      const xs = String(x || ""), ys = String(y || "");
      // 빈값은 asc/desc 무관하게 항상 맨 뒤로(잡음을 위로 끌고 오지 않게)
      if (xs === "" || ys === "") {
        if (xs === "" && ys === "") return 0;
        return xs === "" ? 1 : -1;
      }
      return xs.localeCompare(ys) * sgn;
    });
    return out;
  }

  function render() {
    const cols = buildCols(state.tab).filter(c => !c.hide);  // 표·정렬은 hide 제외
    $("ghead").innerHTML = "<tr>" + cols.map(c => {
      const sortCls = state.sort.key === c.id ? (state.sort.dir === "asc" ? "sorted-asc" : "sorted-desc") : "";
      const cls = [c.num ? "num" : "", sortCls].filter(Boolean).join(" ");
      return `<th data-col="${c.id}"${cls ? ` class="${cls}"` : ""}>${esc(c.label)}</th>`;
    }).join("") + "</tr>";
    $("ghead").querySelectorAll("th[data-col]").forEach(th =>
      th.addEventListener("click", () => {
        const k = th.dataset.col;
        if (state.sort.key === k) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else state.sort = { key: k, dir: ["bddd","bd_mtd","sbd","pymd","bd_fta"].includes(k) ? "desc" : "asc" };
        render();
      }));
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page > pages) state.page = pages;
    const slice = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    $("rows").innerHTML = slice.map(r =>
      "<tr>" + cols.map(c => `<td${c.num ? ' class="num"' : (c.cls ? ` class="${c.cls}"` : "")}>${c.cell(r)}</td>`).join("") + "</tr>"
    ).join("");
    $("empty").classList.toggle("hidden", list.length > 0);
    $("result-count").innerHTML = `<strong>${list.length.toLocaleString()}</strong>건`;
    renderPager(pages);
    document.querySelectorAll(".ecm-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === state.tab));
  }

  function renderPager(pages) {
    const p = $("pager");
    if (pages <= 1) { p.innerHTML = ""; return; }
    const cur = state.page;
    const mk = (n, t, dis, act) => `<button ${dis ? "disabled" : ""} class="${act ? "active" : ""}" data-page="${n}">${t}</button>`;
    let h = mk(cur - 1, "‹", cur === 1, false);
    const win = []; for (let i = Math.max(1, cur - 2); i <= Math.min(pages, cur + 2); i++) win.push(i);
    if (win[0] > 1) { h += mk(1, "1", false, false); if (win[0] > 2) h += "<span style='padding:0 4px'>…</span>"; }
    win.forEach(i => h += mk(i, i, false, i === cur));
    if (win[win.length - 1] < pages) { if (win[win.length - 1] < pages - 1) h += "<span style='padding:0 4px'>…</span>"; h += mk(pages, pages, false, false); }
    h += mk(cur + 1, "›", cur === pages, false);
    p.innerHTML = h;
    p.querySelectorAll("button[data-page]").forEach(b =>
      b.addEventListener("click", () => { state.page = +b.dataset.page; render(); window.scrollTo(0, 0); }));
  }

  function chipBox(boxId, set) {
    const box = $(boxId);
    box.innerHTML = [...set].map(v => `<span class="type-pill">${esc(v)} <button data-v="${esc(v)}" style="border:none;background:none;cursor:pointer;color:inherit">×</button></span>`).join(" ");
    box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { set.delete(b.dataset.v); chipBox(boxId, set); }));
  }
  function populateMarket() {
    const vals = [...new Set((DATA[state.tab] || []).map(r => r.market).filter(Boolean))].sort();
    $("f-market").innerHTML = `<option value="">전체</option>` + vals.map(v => `<option>${esc(v)}</option>`).join("");
    state.market = "";
  }
  function populateMethod() {
    const vals = [...new Set((DATA[state.tab] || []).map(r => r.bdis_mthn).filter(Boolean))].sort();
    $("f-method").innerHTML = `<option value="">전체</option>` + vals.map(v => `<option>${esc(v)}</option>`).join("");
    state.method = "";
  }
  function populateIssuers() {
    const names = [...new Set((DATA[state.tab] || []).map(r => r.issuer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    issuerSet = new Map(names.map(n => [n.toLowerCase(), n]));
    const dl = $("issuers-datalist");
    if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join("");
  }
  function populateTotals() {
    const opt = v => `<option value="${v}">${v.toLocaleString()}</option>`;
    $("f-total-min").innerHTML = `<option value="">하한 없음</option>` + TOTAL_OPTS.map(opt).join("");
    $("f-total-max").innerHTML = `<option value="">상한 없음</option>` + TOTAL_OPTS.map(opt).join("");
  }
  function dateRange() {
    const ds = (DATA[state.tab] || []).map(r => r.bddd).filter(Boolean);
    if (!ds.length) return { min: "", max: "" };
    return { min: ds.reduce((a, b) => b < a ? b : a), max: ds.reduce((a, b) => b > a ? b : a) };
  }
  function setActivePreset(p) {
    document.querySelectorAll(".date-presets button").forEach(b => b.classList.toggle("active", b.dataset.preset === p));
  }
  function applyDefaultRange() {
    const { max } = dateRange();
    if (max) {
      const s = new Date(max); s.setFullYear(s.getFullYear() - 1); s.setDate(s.getDate() + 1);
      $("f-date-start").value = s.toISOString().slice(0, 10);
      $("f-date-end").value = max;
    } else { $("f-date-start").value = ""; $("f-date-end").value = ""; }
    state.dateStart = $("f-date-start").value; state.dateEnd = $("f-date-end").value; state.page = 1;
    setActivePreset("1y");
  }
  function applyFilters() {
    state.dateStart = $("f-date-start").value || "";
    state.dateEnd = $("f-date-end").value || "";
    state.market = $("f-market").value || "";
    state.method = $("f-method").value || "";
    state.totalMin = +($("f-total-min").value || 0);
    state.totalMax = +($("f-total-max").value || 0);
    state.page = 1; render();
  }
  function switchTab(tab) {
    if (tab === state.tab) return;
    state.tab = tab; state.page = 1; state.sort = { key: "bddd", dir: "desc" };
    state.issuers.clear();
    chipBox("f-issuer-chips", state.issuers);
    $("f-total-min").value = ""; $("f-total-max").value = ""; state.totalMin = state.totalMax = 0;
    populateMarket(); populateMethod(); populateIssuers(); applyDefaultRange(); render();
  }

  function download() {
    const list = filtered();
    const cols = buildCols(state.tab);
    const header = cols.map(c => c.label);
    const rows = list.map(r => cols.map(c => c.xls ? c.xls(r) : ""));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // 헤더 스타일
    const hs = {
      font: { bold: true }, alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "F1F5F9" }, patternType: "solid" },
      border: { top: { style: "thin", color: { rgb: "CBD5E1" } }, bottom: { style: "thin", color: { rgb: "CBD5E1" } },
                left: { style: "thin", color: { rgb: "CBD5E1" } }, right: { style: "thin", color: { rgb: "CBD5E1" } } },
    };
    for (let c = 0; c < cols.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[ref]) ws[ref].s = hs;
    }
    // 컬럼 폭
    const cw = cols.map(c => {
      if (c.id === "issuer") return { wch: 16 };
      if (c.id === "bd_knd") return { wch: 32 };
      if (c.id === "rpmcmp") return { wch: 20 };
      if (c.id === "conv_per") return { wch: 22 };
      if (["bddd","sbd","pymd","bd_mtd"].includes(c.id)) return { wch: 12 };
      return { wch: 10 };
    });
    ws["!cols"] = cw; ws["!rows"] = [{ hpt: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, state.tab.toUpperCase());
    XLSX.writeFile(wb, `NumbersPool_메자닌_${state.tab.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function init() {
    try {
      const [data, meta] = await Promise.all([
        NP_loadData("mezz_data.json"),
        NP_loadData("mezz_meta.json").catch(() => null),
      ]);
      DATA = data;
      META = meta;
      if (meta) {
        const nu = $("nav-updated"); if (nu) nu.textContent = "최종 업데이트 " + meta.updated_at;
        if ($("updated")) $("updated").textContent = meta.updated_at;
        if ($("count")) $("count").textContent = `CB ${meta.counts?.cb ?? 0} · BW ${meta.counts?.bw ?? 0} · EB ${meta.counts?.eb ?? 0}`;
      }
    } catch (e) {
      console.error(e);
      const nu = $("nav-updated"); if (nu) nu.textContent = "데이터 로드 실패";
      return;
    }

    populateMarket(); populateMethod(); populateIssuers(); populateTotals();
    document.querySelectorAll(".ecm-tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
    $("rows").addEventListener("click", (e) => {
      const a = e.target.closest("a.dart-link"); if (!a) return;
      e.preventDefault();
      const rcept = a.dataset.rcept; if (!rcept) return;
      window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}`, "dart-viewer", "width=1100,height=800,scrollbars=yes,resizable=yes");
    });
    function commitIssuerText(silent) {
      const v = $("f-issuer").value.trim(); if (!v) return false;
      const canonical = issuerSet.get(v.toLowerCase());
      if (!canonical) { if (!silent) alert("'" + v + "' 발행사를 찾을 수 없습니다.\n\nDART 공시 기준 정확한 회사명을 입력하거나 자동완성 목록에서 선택해 주세요."); return false; }
      if (state.issuers.size >= 10 || state.issuers.has(canonical)) { $("f-issuer").value = ""; return false; }
      state.issuers.add(canonical); chipBox("f-issuer-chips", state.issuers); $("f-issuer").value = ""; return true;
    }
    $("f-issuer").addEventListener("keydown", e => {
      if (e.key !== "Enter") return; e.preventDefault();
      commitIssuerText(false);
    });
    document.querySelectorAll(".date-presets button").forEach(b =>
      b.addEventListener("click", () => {
        const p = b.dataset.preset;
        setActivePreset(p);
        const { min, max } = dateRange();
        if (p === "all") { $("f-date-start").value = min || ""; $("f-date-end").value = max || ""; return; }
        if (!max) return;
        const s = new Date(max);
        if (p === "3m") s.setMonth(s.getMonth() - 3);
        else if (p === "6m") s.setMonth(s.getMonth() - 6);
        else if (p === "1y") s.setFullYear(s.getFullYear() - 1);
        s.setDate(s.getDate() + 1);
        $("f-date-end").value = max;
        $("f-date-start").value = s.toISOString().slice(0, 10);
      }));
    ["f-date-start", "f-date-end"].forEach(id => $(id).addEventListener("change", () => setActivePreset(null)));
    $("btn-search").addEventListener("click", () => {
      const btn = $("btn-search");
      if (btn.dataset.busy) return;
      const orig = btn.innerHTML;
      btn.dataset.busy = "1"; btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>조회 중';
      setTimeout(() => {
        commitIssuerText(true);
        applyFilters();
        btn.disabled = false; btn.innerHTML = orig; delete btn.dataset.busy;
      }, 200);
    });
    $("btn-reset").addEventListener("click", () => {
      state.issuers.clear();
      chipBox("f-issuer-chips", state.issuers);
      $("f-issuer").value = "";
      $("f-market").value = ""; state.market = "";
      $("f-method").value = ""; state.method = "";
      $("f-total-min").value = ""; $("f-total-max").value = ""; state.totalMin = state.totalMax = 0;
      applyDefaultRange(); render();
    });
    $("btn-download").addEventListener("click", download);
    applyDefaultRange(); render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
