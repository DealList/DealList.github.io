// DealList - 클라이언트 사이드 필터링 + Excel 다운로드
(function () {
  "use strict";

  const PAGE_SIZE = 50;

  let DATA = [];
  let META = {};
  let filtered = [];          // 트랜치 단위 (필터링 직후)
  let grouped = [];           // [{ key, records: [tranches sorted by series], rep }] 회차 단위
  let currentPage = 1;
  let sortKey = "date";
  let sortDir = "desc";

  const $ = (id) => document.getElementById(id);

  // ============== 데이터 로드 ==============
  async function loadAll() {
    try {
      const [d, m] = await Promise.all([
        fetch("data.json").then((r) => r.json()),
        fetch("meta.json").then((r) => r.json()),
      ]);
      DATA = d;
      META = m;
      initFilters();
      $("updated").textContent = "최종 업데이트: " + (META.updated || "-");
      $("count").textContent = "전체 " + (META.count || DATA.length).toLocaleString() + "건";
      applyFilters();
    } catch (e) {
      $("updated").textContent = "데이터 로드 실패";
      console.error(e);
    }
  }

  // ============== 필터 옵션 초기화 ==============
  function fillSelect(id, values) {
    const sel = $(id);
    sel.innerHTML = "";
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
  }

  function initFilters() {
    fillSelect("f-year", META.years || []);
    fillSelect("f-type", META.types || []);
    fillSelect("f-rating", META.ratings || []);
    fillSelect("f-lead", META.leads || []);

    ["f-year", "f-type", "f-rating", "f-lead"].forEach((id) => {
      $(id).addEventListener("change", () => {
        currentPage = 1;
        applyFilters();
      });
    });
    $("f-issuer").addEventListener("input", debounce(() => {
      currentPage = 1;
      applyFilters();
    }, 200));

    $("btn-reset").addEventListener("click", () => {
      ["f-year", "f-type", "f-rating", "f-lead"].forEach((id) => {
        Array.from($(id).options).forEach((o) => (o.selected = false));
      });
      $("f-issuer").value = "";
      currentPage = 1;
      applyFilters();
    });

    $("btn-download").addEventListener("click", downloadExcel);

    document.querySelectorAll("#grid thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = k;
          sortDir = k === "date" ? "desc" : "asc";
        }
        groupAndSort();
        render();
      });
    });
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ============== 필터 적용 ==============
  function selectedValues(id) {
    return Array.from($(id).selectedOptions).map((o) => o.value);
  }

  function applyFilters() {
    const years = selectedValues("f-year");
    const types = selectedValues("f-type");
    const ratings = selectedValues("f-rating");
    const leads = selectedValues("f-lead");
    const issuerQ = ($("f-issuer").value || "").trim().toLowerCase();

    // 1) 트랜치 단위 필터링. 매치되는 트랜치가 한 개라도 있으면 그룹 전체 표시 위해
    //    그룹 키 단위로 한 번 더 확장.
    const matchTranche = (r) => {
      if (years.length && !years.includes((r.date || "").slice(0, 4))) return false;
      if (types.length && !types.includes(r.type)) return false;
      if (ratings.length && !ratings.includes(r.rating)) return false;
      if (leads.length && !r.leads.some((l) => leads.includes(l))) return false;
      if (issuerQ) {
        const hay = (r.issuer + " " + (r.issuer_full || "")).toLowerCase();
        if (!hay.includes(issuerQ)) return false;
      }
      return true;
    };
    const matchedKeys = new Set();
    for (const r of DATA) {
      if (matchTranche(r)) matchedKeys.add(groupKey(r));
    }
    filtered = DATA.filter((r) => matchedKeys.has(groupKey(r)));

    groupAndSort();
    render();
  }

  // ============== 그룹화 ==============
  function groupKey(r) {
    const base = (r.series || "").split("-")[0];
    return `${r.issuer}|${base}|${r.date}`;
  }

  function seriesSortKey(s) {
    // "314-1" → [314, 1], "32" → [32]. 정수 비교 가능하도록.
    return (s || "").split("-").map((p) => {
      const n = Number(p);
      return isNaN(n) ? p : n;
    });
  }

  function compareSeries(a, b) {
    const ka = seriesSortKey(a);
    const kb = seriesSortKey(b);
    const len = Math.max(ka.length, kb.length);
    for (let i = 0; i < len; i++) {
      const va = ka[i];
      const vb = kb[i];
      if (va === undefined) return -1;
      if (vb === undefined) return 1;
      if (typeof va === "number" && typeof vb === "number") {
        if (va !== vb) return va - vb;
      } else {
        const cmp = String(va).localeCompare(String(vb));
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  }

  function groupAndSort() {
    // filtered (트랜치 단위) → grouped (회차 단위)
    const map = new Map();
    for (const r of filtered) {
      const k = groupKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    grouped = [];
    for (const [k, recs] of map.entries()) {
      recs.sort((a, b) => compareSeries(a.series, b.series));
      grouped.push({ key: k, records: recs, rep: recs[0] });
    }

    // 그룹 단위 정렬 — 그룹 내 첫 트랜치 (rep) 의 정렬키 값 기준
    const k = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    grouped.sort((ga, gb) => {
      // 정렬 키가 series 이면 series 베이스 숫자 비교 (314 vs 315)
      if (k === "series") {
        return compareSeries(ga.rep.series, gb.rep.series) * dir;
      }
      const va = ga.rep[k];
      const vb = gb.rep[k];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });

    document.querySelectorAll("#grid thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === k) {
        th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  // ============== 렌더 ==============
  function fmtNum(v) {
    if (v == null) return "";
    return Number(v).toLocaleString();
  }

  function fmtRate(v) {
    if (v == null) return "";
    return Number(v).toFixed(3);
  }

  function fmtUw(uw, withAmount) {
    // uw = { "삼성": 300, "DB": 50, ... }
    if (!uw || typeof uw !== "object") return "";
    const entries = Object.entries(uw);
    if (!entries.length) return "";
    if (withAmount) {
      // 툴팁용: "삼성 300억, DB 50억, ..."
      return entries.map(([k, v]) => `${k} ${fmtNum(v)}억`).join(", ");
    }
    // 표 표시용: 인수사 이름만 ", " join
    return entries.map(([k]) => k).join(", ");
  }

  function render() {
    const totalGroups = grouped.length;
    const totalTranches = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageGroups = grouped.slice(start, start + PAGE_SIZE);

    const tbody = $("rows");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();

    pageGroups.forEach((g, gIdx) => {
      const N = g.records.length;
      g.records.forEach((r, i) => {
        const isFirst = i === 0;
        const tr = document.createElement("tr");
        // 그룹 첫 트랜치엔 시각적 구분선
        if (isFirst && gIdx > 0) tr.classList.add("group-start");

        let html =
          "<td>" + (r.date || "") + "</td>" +
          "<td>" + esc(r.issuer) + "</td>" +
          "<td>" + esc(r.series) + "</td>" +
          "<td>" + esc(r.type) + "</td>" +
          "<td>" + esc(r.rating) + "</td>" +
          "<td>" + esc(r.maturity) + "</td>" +
          '<td class="num">' + fmtNum(r.init) + "</td>";

        // 발행한도 — 그룹 공통, 첫 트랜치에만 rowspan
        if (isFirst) {
          html += '<td class="num group-cell" rowspan="' + N + '">' + fmtNum(r.limit) + "</td>";
        }

        html +=
          '<td class="num">' + fmtNum(r.demand) + "</td>" +
          '<td class="num">' + fmtNum(r.final) + "</td>";

        // 회차합산 — 그룹 공통, 첫 트랜치에만 rowspan
        if (isFirst) {
          html += '<td class="num group-cell" rowspan="' + N + '">' + fmtNum(r.series_total) + "</td>";
        }

        html +=
          "<td>" + esc(r.r_target) + "</td>" +
          "<td>" + esc(r.r_demand) + "</td>" +
          '<td class="num">' + fmtRate(r.r_final) + "</td>" +
          "<td>" + esc((r.leads || []).join(", ")) + "</td>" +
          '<td title="' + esc(fmtUw(r.uw, true)) + '">' + esc(fmtUw(r.uw, false)) + "</td>";

        tr.innerHTML = html;
        frag.appendChild(tr);
      });
    });
    tbody.appendChild(frag);

    $("empty").classList.toggle("hidden", totalTranches > 0);
    $("result-count").textContent =
      totalTranches.toLocaleString() + "건 / " + totalGroups.toLocaleString() + "개 회차";

    renderPager(totalPages);
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderPager(totalPages) {
    const nav = $("pager");
    nav.innerHTML = "";
    if (totalPages <= 1) return;

    const addBtn = (label, page, opts = {}) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (opts.active) b.classList.add("active");
      if (opts.disabled) b.disabled = true;
      b.addEventListener("click", () => {
        currentPage = page;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      nav.appendChild(b);
    };

    addBtn("이전", Math.max(1, currentPage - 1), { disabled: currentPage === 1 });

    const windowSize = 5;
    let from = Math.max(1, currentPage - 2);
    let to = Math.min(totalPages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);

    if (from > 1) {
      addBtn("1", 1);
      if (from > 2) {
        const sp = document.createElement("span");
        sp.textContent = "…";
        sp.style.padding = "0 4px";
        nav.appendChild(sp);
      }
    }

    for (let p = from; p <= to; p++) {
      addBtn(String(p), p, { active: p === currentPage });
    }

    if (to < totalPages) {
      if (to < totalPages - 1) {
        const sp = document.createElement("span");
        sp.textContent = "…";
        sp.style.padding = "0 4px";
        nav.appendChild(sp);
      }
      addBtn(String(totalPages), totalPages);
    }

    addBtn("다음", Math.min(totalPages, currentPage + 1), { disabled: currentPage === totalPages });
  }

  // ============== Excel 다운로드 ==============
  function downloadExcel() {
    if (!filtered.length) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }
    const rows = filtered.map((r) => ({
      청약일: r.date,
      발행사: r.issuer,
      회차: r.series,
      종류: r.type,
      신용등급: r.rating,
      만기일: r.maturity,
      "최초모집(억)": r.init,
      "발행한도(억)": r.limit,
      "수요예측(억)": r.demand,
      "최종발행(억)": r.final,
      "회차합산(억)": r.series_total,
      희망금리: r.r_target,
      수요금리: r.r_demand,
      "최종금리(%)": r.r_final,
      대표주관: (r.leads || []).join(", "),
      인수사: Object.keys(r.uw || {}).join(", "),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DealList");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `DealList_${today}.xlsx`);
  }

  // ============== 시작 ==============
  loadAll();
})();
