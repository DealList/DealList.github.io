// DealList — 공모 회사채 인포그래픽 (8개 차트 + 5종 필터)
(function () {
  "use strict";

  // ============== 상수 ==============
  const BROKER_FULL_NAME = {
    "BNK":"BNK투자증권","DB":"DB금융투자","IBK":"IBK투자증권","KB":"KB증권",
    "KR":"KR투자증권","LS":"LS증권","NH":"NH투자증권","SK":"SK증권","iM":"iM증권",
    "교보":"교보증권","다올":"다올투자증권","대신":"대신증권","디에스":"DS투자증권",
    "리딩":"리딩투자증권","메리츠":"메리츠증권","미래":"미래에셋증권","부국":"부국증권",
    "산은":"한국산업은행","삼성":"삼성증권","상상인":"상상인증권","신영":"신영증권",
    "신한":"신한투자증권","우리":"우리투자증권","유안타":"유안타증권","유진":"유진투자증권",
    "케이프":"케이프투자증권","코리아에셋":"코리아에셋투자증권","키움":"키움증권",
    "하나":"하나증권","한양":"한양증권","한투":"한국투자증권","한화":"한화투자증권",
    "현차":"현대차증권","흥국":"흥국증권",
  };

  const RATING_RANK = {
    "AAA":1, "AA+":2, "AA":3, "AA-":4, "A+":5, "A":6, "A-":7,
    "BBB+":8, "BBB":9, "BBB-":10,
    "BB+":11, "BB":12, "BB-":13, "B+":14, "B":15, "B-":16,
    "CCC+":17, "CCC":18, "CCC-":19, "CC":20, "C":21, "D":22,
  };
  const RATING_OPTIONS = [
    "AAA","AA+","AA","AA-","A+","A","A-","BBB+","BBB","BBB-",
  ];

  function effectiveRatingRank(s) {
    if (!s) return null;
    if (s.includes("~")) {
      const low = s.split("~")[0].trim();
      return RATING_RANK[low] ?? null;
    }
    return RATING_RANK[s.trim()] ?? null;
  }

  const MAX_BROKER_CHIPS = 5;

  // ============== 상태 ==============
  let DATA = [];
  let META = {};
  let charts = {};  // chart instances
  let leadKeywords = [];

  const $ = (id) => document.getElementById(id);
  const displayName = (a) => BROKER_FULL_NAME[a] || a;

  // ============== 데이터 로드 ==============
  async function loadAll() {
    try {
      const [d, m] = await Promise.all([
        fetch("../data.json").then((r) => r.json()),
        fetch("../meta.json").then((r) => r.json()),
      ]);
      DATA = d;
      META = m;
      $("updated").textContent = "최종 업데이트: " + (META.updated || "-");
      initFilters();
      runQuery();
    } catch (e) {
      $("updated").textContent = "데이터 로드 실패";
      console.error(e);
    }
  }

  // ============== 필터 ==============
  function initFilters() {
    // 종류
    const TYPE_ORDER = ["무보증","신종자본","후순위채","보증"];
    const types = META.types || [];
    const ordered = [
      ...TYPE_ORDER.filter((t) => types.includes(t)),
      ...types.filter((t) => !TYPE_ORDER.includes(t)),
    ];
    fillSelect("f-type", ordered, true);
    fillSelect("f-rating-min", RATING_OPTIONS, true);
    fillSelect("f-rating-max", RATING_OPTIONS, true);

    // 주관 증권사 (chip dropdown)
    setupChipDropdown({
      selectId: "f-lead-select",
      chipsId: "f-lead-chips",
      max: MAX_BROKER_CHIPS,
      values: META.leads || [],
      displayMap: BROKER_FULL_NAME,
      getArr: () => leadKeywords,
      setArr: (a) => { leadKeywords = a; },
    });

    // 기간 기본값
    const maxDate = DATA.reduce(
      (a, r) => (r.date && r.date > a ? r.date : a), "");
    const minDate = DATA.reduce(
      (a, r) => (r.date && (!a || r.date < a) ? r.date : a), "");
    applyDatePreset("1y", maxDate, minDate);

    ["f-date-start", "f-date-end"].forEach((id) => {
      $(id).addEventListener("change", () => clearPresetActive());
    });

    document.querySelectorAll(".date-presets button[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyDatePreset(btn.dataset.preset, maxDate, minDate);
      });
    });

    // 조회 / 초기화
    $("btn-search").addEventListener("click", () => {
      const btn = $("btn-search");
      const wrap = $("charts-wrap");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>조회 중';
      wrap.classList.add("loading");
      setTimeout(() => {
        runQuery();
        btn.disabled = false;
        btn.textContent = "조회";
        wrap.classList.remove("loading");
      }, 250);
    });

    $("btn-reset").addEventListener("click", () => {
      $("f-type").value = "";
      $("f-rating-min").value = "";
      $("f-rating-max").value = "";
      applyDatePreset("1y", maxDate, minDate);
      leadKeywords = [];
      $("f-lead-chips").innerHTML = "";
      $("f-lead-select").value = "";
      Array.from($("f-lead-select").options).forEach((o) => (o.disabled = false));
    });
  }

  function fillSelect(id, values, withAll) {
    const sel = $(id);
    sel.innerHTML = "";
    if (withAll) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "전체";
      sel.appendChild(o);
    }
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
  }

  function setupChipDropdown(opts) {
    const sel = $(opts.selectId);
    const displayOf = (v) => (opts.displayMap && opts.displayMap[v]) || v;
    const sortedValues = [...opts.values].sort((a, b) =>
      displayOf(a).localeCompare(displayOf(b), "ko"));
    sel.innerHTML = '<option value="">선택</option>';
    for (const v of sortedValues) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = displayOf(v);
      sel.appendChild(o);
    }

    const syncDisable = () => {
      const kws = new Set(opts.getArr());
      Array.from(sel.options).forEach((o) => {
        o.disabled = o.value !== "" && kws.has(o.value);
      });
    };

    const render = () => {
      const wrap = $(opts.chipsId);
      wrap.innerHTML = "";
      for (const kw of opts.getArr()) {
        const chip = document.createElement("span");
        chip.className = "issuer-chip";
        chip.innerHTML = esc(displayOf(kw)) +
          '<button type="button" class="remove" title="제거">×</button>';
        chip.querySelector(".remove").addEventListener("click", () => {
          opts.setArr(opts.getArr().filter((k) => k !== kw));
          render();
          syncDisable();
        });
        wrap.appendChild(chip);
      }
    };

    sel.addEventListener("change", () => {
      const val = sel.value;
      if (!val) return;
      const kws = opts.getArr();
      if (kws.length >= opts.max) { sel.value = ""; return; }
      if (kws.includes(val)) { sel.value = ""; return; }
      kws.push(val);
      sel.value = "";
      render();
      syncDisable();
    });

    render();
    syncDisable();
  }

  function clearPresetActive() {
    document.querySelectorAll(".date-presets button").forEach((b) =>
      b.classList.remove("active"));
  }

  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function applyDatePreset(preset, maxDate, minDate) {
    clearPresetActive();
    const btn = document.querySelector(`.date-presets button[data-preset="${preset}"]`);
    if (btn) btn.classList.add("active");
    if (preset === "all") {
      $("f-date-start").value = minDate || "";
      $("f-date-end").value = todayLocal();
      return;
    }
    if (!maxDate) return;
    const d = new Date(maxDate);
    const start = new Date(d);
    if (preset === "3m") start.setMonth(start.getMonth() - 3);
    else if (preset === "6m") start.setMonth(start.getMonth() - 6);
    else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    $("f-date-end").value = maxDate;
    $("f-date-start").value = start.toISOString().slice(0, 10);
  }

  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ============== 조회 + 집계 ==============
  function runQuery() {
    const dateStart = $("f-date-start").value || "";
    const dateEnd = $("f-date-end").value || "";
    const typeVal = $("f-type").value || "";
    const ratingMin = $("f-rating-min").value || "";
    const ratingMax = $("f-rating-max").value || "";
    const minRank = ratingMin ? RATING_RANK[ratingMin] : null;
    const maxRank = ratingMax ? RATING_RANK[ratingMax] : null;
    const leadSet = new Set(leadKeywords.map((k) => k.toLowerCase()));

    $("period-range").textContent =
      `조회 기간: ${dateStart || "처음"} ~ ${dateEnd || "끝"}`;

    // record (트랜치) 단위 필터
    const filtered = DATA.filter((r) => {
      if (r.final == null) return false;  // 발행조건확정 후 데이터만
      const d = r.date || "";
      if (dateStart && d && d < dateStart) return false;
      if (dateEnd && d && d > dateEnd) return false;
      if (typeVal && r.type !== typeVal) return false;
      if (minRank !== null || maxRank !== null) {
        const eff = effectiveRatingRank(r.rating);
        if (eff == null) return false;
        if (maxRank !== null && eff < maxRank) return false;
        if (minRank !== null && eff > minRank) return false;
      }
      if (leadSet.size && !(r.leads || []).some((l) => leadSet.has(l.toLowerCase()))) return false;
      return true;
    });

    // 회차 단위 그룹화
    const dealMap = new Map();
    for (const r of filtered) {
      const seriesBase = (r.series || "").split("-")[0];
      const key = `${r.issuer}|${seriesBase}|${r.date}`;
      if (!dealMap.has(key)) {
        dealMap.set(key, {
          issuer: r.issuer, date: r.date, final: 0,
          type: r.type, rating: r.rating, maturity: r.maturity,
          lead_amt: {},
        });
      }
      const d = dealMap.get(key);
      d.final += r.final || 0;
      for (const [a, v] of Object.entries(r.lead_amt || {})) {
        d.lead_amt[a] = (d.lead_amt[a] || 0) + (v || 0);
      }
    }
    const deals = [...dealMap.values()];

    const totalAmt = deals.reduce((s, d) => s + d.final, 0);
    $("result-count").textContent =
      `발행건수 ${deals.length.toLocaleString()}건 · 발행총액 ${fmtAmount(totalAmt)}`;

    renderCharts(deals);
  }

  function fmtAmount(eok) {
    if (eok >= 10000) {
      const jo = Math.floor(eok / 10000);
      const rest = Math.round(eok % 10000);
      return `${jo.toLocaleString()}조 ${rest.toLocaleString()}억`;
    }
    return `${Math.round(eok).toLocaleString()}억`;
  }

  // ============== 차트 렌더링 ==============
  function renderCharts(deals) {
    Chart.defaults.font.family =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif";
    Chart.defaults.font.size = 11;

    // 기존 차트 destroy
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};

    if (deals.length === 0) {
      ["ch-monthly","ch-type-count","ch-type-amt",
       "ch-rating-count","ch-rating-amt",
       "ch-top-issuers","ch-top-leads","ch-maturity","ch-size"].forEach((id) => {
        const ctx = $(id).getContext("2d");
        ctx.clearRect(0, 0, $(id).width, $(id).height);
      });
      return;
    }

    // ① 월별 추이
    const ymMap = new Map();
    for (const d of deals) {
      const ym = (d.date || "").slice(0, 7);
      if (!ym) continue;
      const v = ymMap.get(ym) || { count: 0, amount: 0 };
      v.count += 1;
      v.amount += d.final;
      ymMap.set(ym, v);
    }
    const ymSorted = [...ymMap.entries()].sort();
    charts.monthly = new Chart($("ch-monthly"), {
      type: "bar",
      data: {
        labels: ymSorted.map(([ym]) => ym),
        datasets: [
          { type: "bar", label: "발행건수", data: ymSorted.map(([_,v]) => v.count),
            backgroundColor: "#93c5fd", yAxisID: "y" },
          { type: "line", label: "발행총액(억)",
            data: ymSorted.map(([_,v]) => Math.round(v.amount)),
            borderColor: "#1e40af", backgroundColor: "#1e40af",
            yAxisID: "y2", tension: 0.2 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: { type: "linear", position: "left", title: { display: true, text: "건수" } },
          y2: { type: "linear", position: "right", title: { display: true, text: "발행총액(억)" },
                grid: { drawOnChartArea: false } },
        },
      },
    });

    // ② 종류별 (건수) + ③ 종류별 (액수)
    const tCount = new Map();
    const tAmt = new Map();
    for (const d of deals) {
      const t = d.type || "기타";
      tCount.set(t, (tCount.get(t) || 0) + 1);
      tAmt.set(t, (tAmt.get(t) || 0) + d.final);
    }
    const tEntries = [...tCount.entries()];
    const typeColors = ["#2563eb","#10b981","#f59e0b","#ef4444","#8b5cf6"];
    charts.typeCount = new Chart($("ch-type-count"), {
      type: "doughnut",
      data: {
        labels: tEntries.map(([k]) => k),
        datasets: [{ data: tEntries.map(([_,v]) => v),
                     backgroundColor: typeColors }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: "right" } } },
    });
    charts.typeAmt = new Chart($("ch-type-amt"), {
      type: "doughnut",
      data: {
        labels: tEntries.map(([k]) => k),
        datasets: [{ data: tEntries.map(([k]) => Math.round(tAmt.get(k) || 0)),
                     backgroundColor: typeColors }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: "right" } } },
    });

    // ④ 등급별 (건수) + ⑤ 등급별 (액수)
    const ratingCount = new Map(RATING_OPTIONS.map((r) => [r, 0]));
    const ratingAmt = new Map(RATING_OPTIONS.map((r) => [r, 0]));
    for (const d of deals) {
      const raw = d.rating || "";
      const eff = raw.includes("~") ? raw.split("~")[0].trim() : raw.trim();
      if (ratingCount.has(eff)) {
        ratingCount.set(eff, ratingCount.get(eff) + 1);
        ratingAmt.set(eff, ratingAmt.get(eff) + d.final);
      }
    }
    charts.ratingCount = new Chart($("ch-rating-count"), {
      type: "bar",
      data: {
        labels: RATING_OPTIONS,
        datasets: [{ label: "건수",
                     data: RATING_OPTIONS.map((r) => ratingCount.get(r)),
                     backgroundColor: "#06b6d4" }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    charts.ratingAmt = new Chart($("ch-rating-amt"), {
      type: "bar",
      data: {
        labels: RATING_OPTIONS,
        datasets: [{ label: "발행총액(억)",
                     data: RATING_OPTIONS.map((r) => Math.round(ratingAmt.get(r))),
                     backgroundColor: "#0e7490" }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });

    // ⑤ Top 10 발행사
    const iMap = new Map();
    for (const d of deals) iMap.set(d.issuer, (iMap.get(d.issuer) || 0) + d.final);
    const topI = [...iMap.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
    charts.topIssuers = new Chart($("ch-top-issuers"), {
      type: "bar",
      data: {
        labels: topI.map(([k]) => k),
        datasets: [{ label: "발행총액(억)", data: topI.map(([_,v]) => Math.round(v)),
                     backgroundColor: "#f97316" }],
      },
      options: { indexAxis: "y", maintainAspectRatio: false,
                 plugins: { legend: { display: false } } },
    });

    // ⑥ Top 10 주관사
    const lMap = new Map();
    for (const d of deals) {
      for (const [a, v] of Object.entries(d.lead_amt)) {
        lMap.set(a, (lMap.get(a) || 0) + v);
      }
    }
    const topL = [...lMap.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
    charts.topLeads = new Chart($("ch-top-leads"), {
      type: "bar",
      data: {
        labels: topL.map(([k]) => displayName(k)),
        datasets: [{ label: "주관 실적(억)", data: topL.map(([_,v]) => Math.round(v)),
                     backgroundColor: "#22c55e" }],
      },
      options: { indexAxis: "y", maintainAspectRatio: false,
                 plugins: { legend: { display: false } } },
    });

    // ⑦ 만기 분포
    const matBuckets = { "1년 이하":0, "2년":0, "3년":0, "5년":0, "10년":0, "10년 초과":0 };
    for (const d of deals) {
      if (!d.maturity || !d.date) continue;
      const sub = new Date(d.date);
      const mat = new Date(d.maturity);
      if (isNaN(sub) || isNaN(mat)) continue;
      const years = (mat - sub) / (365.25 * 24 * 3600 * 1000);
      if (years <= 1.5) matBuckets["1년 이하"]++;
      else if (years <= 2.5) matBuckets["2년"]++;
      else if (years <= 4) matBuckets["3년"]++;
      else if (years <= 7) matBuckets["5년"]++;
      else if (years <= 12) matBuckets["10년"]++;
      else matBuckets["10년 초과"]++;
    }
    charts.maturity = new Chart($("ch-maturity"), {
      type: "bar",
      data: {
        labels: Object.keys(matBuckets),
        datasets: [{ label: "건수", data: Object.values(matBuckets),
                     backgroundColor: "#a855f7" }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });

    // ⑧ 발행규모
    const sizeBuckets = { "~500":0, "500~1,000":0, "1,000~2,000":0,
                          "2,000~5,000":0, "5,000+":0 };
    for (const d of deals) {
      const f = d.final;
      if (f < 500) sizeBuckets["~500"]++;
      else if (f < 1000) sizeBuckets["500~1,000"]++;
      else if (f < 2000) sizeBuckets["1,000~2,000"]++;
      else if (f < 5000) sizeBuckets["2,000~5,000"]++;
      else sizeBuckets["5,000+"]++;
    }
    charts.size = new Chart($("ch-size"), {
      type: "bar",
      data: {
        labels: Object.keys(sizeBuckets),
        datasets: [{ label: "건수", data: Object.values(sizeBuckets),
                     backgroundColor: "#ec4899" }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  loadAll();
})();
