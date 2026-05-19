// DealList - 클라이언트 사이드 필터링 + Excel 다운로드
(function () {
  "use strict";

  const PAGE_SIZE = 50;

  let DATA = [];
  let META = {};
  let filtered = [];
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
        applyFilters();
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

    filtered = DATA.filter((r) => {
      if (years.length && !years.includes((r.date || "").slice(0, 4))) return false;
      if (types.length && !types.includes(r.type)) return false;
      if (ratings.length && !ratings.includes(r.rating)) return false;
      if (leads.length && !r.leads.some((l) => leads.includes(l))) return false;
      if (issuerQ) {
        const hay = (r.issuer + " " + (r.issuer_full || "")).toLowerCase();
        if (!hay.includes(issuerQ)) return false;
      }
      return true;
    });

    sortRows();
    render();
  }

  function sortRows() {
    const k = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const va = a[k];
      const vb = b[k];
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

  function render() {
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    const tbody = $("rows");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const r of slice) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (r.date || "") + "</td>" +
        "<td>" + esc(r.issuer) + "</td>" +
        "<td>" + esc(r.series) + "</td>" +
        "<td>" + esc(r.type) + "</td>" +
        "<td>" + esc(r.rating) + "</td>" +
        "<td>" + esc(r.maturity) + "</td>" +
        '<td class="num">' + fmtNum(r.final) + "</td>" +
        '<td class="num">' + fmtRate(r.r_final) + "</td>" +
        "<td>" + esc(r.r_target) + "</td>" +
        "<td>" + esc((r.leads || []).join(", ")) + "</td>";
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);

    $("empty").classList.toggle("hidden", total > 0);
    $("result-count").textContent = total.toLocaleString() + "건 필터됨";

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
