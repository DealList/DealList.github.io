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
        NP_loadData("data.json"),
        NP_loadData("meta.json"),
      ]);
      DATA = d;
      META = m;
      $("updated").textContent = "최종 업데이트: " + (META.updated || "-");
      // nav (초록불 우측) 통합 표시
      const navUpdated = document.getElementById("nav-updated");
      if (navUpdated) {
        const total = META.count || DATA.length;
        navUpdated.textContent =
          `최종 업데이트 ${META.updated || "-"}`;
      }
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
      $("f-date-end").value = maxDate || "";
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

    // 기간 표기 제거 (사용자 요청, 2026-05-31)
    const _pr = $("period-range"); if (_pr) _pr.textContent = "";

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

  function _updateKPI_disabled(deals, totalAmt) {
    const grid = $("kpi-grid");
    if (!grid) return;
    if (!deals.length) { grid.innerHTML = ""; return; }
    const avg = totalAmt / deals.length;
    const brokers = new Set();
    for (const d of deals) {
      for (const a of Object.keys(d.lead_amt || {})) brokers.add(a);
    }
    const issuers = new Set(deals.map((d) => d.issuer));
    grid.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-icon blue">📄</div>
        <div class="kpi-body">
          <div class="kpi-label">조회 기간 발행건수</div>
          <div class="kpi-value">${deals.length.toLocaleString()}건</div>
          <div class="kpi-sub">회차 기준</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green">💰</div>
        <div class="kpi-body">
          <div class="kpi-label">조회 기간 발행총액</div>
          <div class="kpi-value">${fmtAmount(totalAmt)}</div>
          <div class="kpi-sub">시장 규모</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon orange">📊</div>
        <div class="kpi-body">
          <div class="kpi-label">평균 발행규모</div>
          <div class="kpi-value">${fmtAmount(avg)}</div>
          <div class="kpi-sub">회차당 평균</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple">🏢</div>
        <div class="kpi-body">
          <div class="kpi-label">발행사 / 참여 주관사</div>
          <div class="kpi-value">${issuers.size} / ${brokers.size}개</div>
          <div class="kpi-sub">고유 발행사·주관사 수</div>
        </div>
      </div>
    `;
  }

  function fmtAmount(eok) {
    if (eok >= 10000) {
      const jo = Math.floor(eok / 10000);
      const rest = Math.round(eok % 10000);
      return `${jo.toLocaleString()}조 ${rest.toLocaleString()}억`;
    }
    return `${Math.round(eok).toLocaleString()}억`;
  }

  // ============== 테마 인식 색 ==============
  // 다크모드 시 라벨/축이 어두운 색이라 안 보이는 문제 해소.
  // renderCharts 마다 현재 테마 읽어 Chart.defaults 와 dataset 색을 갱신.
  function isDarkMode() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }
  function chartColors() {
    const dark = isDarkMode();
    return {
      label:     dark ? "#e2e8f0" : "#0f172a",  // 일반 datalabel
      lineLabel: dark ? "#e7ddc6" : "#1f2d4d",  // monthly line 위 금액 (크림/네이비)
      axis:      dark ? "#94a3b8" : "#475569",  // 축 tick label
      grid:      dark ? "#1e293b" : "#eef2f7",  // grid line
      // ===== 로고 팔레트 (네이비·골드·브론즈·슬레이트) — 다크모드 가독성 위해 톤 보정 =====
      gold:   "#c9a24a",                        // 로고 골드 점
      bronze: dark ? "#c4973a" : "#a07d2c",     // 딥 골드/브론즈
      navy:   dark ? "#4a5d85" : "#1f2d4d",     // 로고 네이비 (다크모드선 밝게)
      slate:  dark ? "#6b7fa8" : "#34466e",     // 슬레이트 블루
    };
  }

  // ============== Data label 포맷 헬퍼 ==============
  // 글로벌 formatter — JSON deep clone 으로 차트 export 시에도 살아남도록
  // Chart.defaults 에 한 번만 설정. dataset._isAmount=true 면 억/조 포맷.
  function fmtCount(v) {
    if (!Number.isFinite(v) || v <= 0) return "";
    return v.toLocaleString() + "건";
  }
  function fmtAmtShort(v) {
    if (!Number.isFinite(v) || v <= 0) return "";
    if (v >= 10000) return (v / 10000).toFixed(1) + "조";
    return Math.round(v).toLocaleString() + "억";
  }
  function smartDataLabel(value, ctx) {
    if (!Number.isFinite(value) || value <= 0) return "";
    // doughnut: 3% 미만 slice 는 라벨 숨김 (잡음 방지)
    const cType = ctx.chart.config.type;
    if (cType === "doughnut" || cType === "pie") {
      const total = (ctx.dataset.data || []).reduce(
        (a, b) => (Number(a) || 0) + (Number(b) || 0), 0);
      if (total > 0 && value / total < 0.03) return "";
    }
    return ctx.dataset._isAmount ? fmtAmtShort(value) : fmtCount(value);
  }

  // ============== 차트 렌더링 ==============
  function renderCharts(deals) {
    Chart.defaults.font.family =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif";
    Chart.defaults.font.size = 11;

    // 현재 테마 색 적용 (다크모드 대응)
    const C = chartColors();
    Chart.defaults.color = C.axis;
    Chart.defaults.borderColor = C.grid;

    // 데이터라벨 플러그인 글로벌 등록 + 기본값
    if (window.ChartDataLabels && !Chart.registry.plugins.get("datalabels")) {
      Chart.register(window.ChartDataLabels);
    }
    Chart.defaults.set("plugins.datalabels", {
      color: C.label,
      font: { size: 16, weight: "700" },
      anchor: "end",
      align: "end",
      offset: 4,
      clip: false,
      formatter: smartDataLabel,
    });

    // 커스텀 플러그인: dataset 의 _labelAtTop=true 인 경우 차트 영역 상단에
    // 라벨 강제 배치 (라인 포인트 위치 무관). 듀얼 축 차트에서 라인 라벨이
    // 막대와 겹치는 문제 회피용. 전역 등록 → JPG export 에도 동일 적용.
    if (!Chart.registry.plugins.get("lineLabelsAtTop")) {
      Chart.register({
        id: "lineLabelsAtTop",
        afterDatasetsDraw(chart) {
          const cctx = chart.ctx;
          chart.data.datasets.forEach((ds, dsIdx) => {
            if (!ds._labelAtTop) return;
            const meta = chart.getDatasetMeta(dsIdx);
            cctx.save();
            cctx.font = ds._labelFont || '700 12px Pretendard, -apple-system, sans-serif';
            cctx.fillStyle = ds._labelColor || "#1f2d4d";
            cctx.textAlign = "center";
            cctx.textBaseline = "bottom";
            const topY = chart.chartArea.top - 4; // 차트 영역 바로 위 (padding 영역 안)
            // dataset 의 _labelFormatter 가 있으면 우선 사용 (① 월별 추이의
            // "0.X조" 포맷 등 차트별 커스텀), 없으면 글로벌 fmtAmtShort.
            const fmt = ds._labelFormatter || fmtAmtShort;
            meta.data.forEach((point, i) => {
              const value = ds.data[i];
              if (!Number.isFinite(value) || value <= 0) return;
              cctx.fillText(fmt(value), point.x, topY);
            });
            cctx.restore();
          });
        },
      });
    }

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
          { type: "bar", label: "발행건수",
            data: ymSorted.map(([_,v]) => v.count),
            backgroundColor: C.gold, yAxisID: "y",
            datalabels: {
              anchor: "end",
              // 막대 높이가 라벨 들어갈 만큼 충분하면 막대 안쪽(start), 작으면
              // 막대 바로 위(end). element.base/y 는 초기 layout 시점에 미정일
              // 수 있어 scale 의 pixel mapping 으로 정확 계산.
              align: (ctx) => {
                const scale = ctx.chart.scales.y;
                if (!scale) return "start";
                const val = ctx.dataset.data[ctx.dataIndex];
                const barH = scale.bottom - scale.getPixelForValue(val);
                return barH < 25 ? "end" : "start";
              },
              offset: 6,
              // 막대(골드) 안: 어두운 글씨로 대비. 막대 위로 빠지면
              // 라이트=네이비 / 다크=크림 으로 배경에 안 묻히게.
              color: (ctx) => {
                const scale = ctx.chart.scales.y;
                if (!scale) return "#1a1408";
                const val = ctx.dataset.data[ctx.dataIndex];
                const barH = scale.bottom - scale.getPixelForValue(val);
                const outside = barH < 25;
                const dark = document.documentElement.getAttribute("data-theme") === "dark";
                return outside ? (dark ? "#e7ddc6" : "#1f2d4d") : "#1a1408";
              },
              font: { size: 15, weight: "700" },
            },
          },
          { type: "line", label: "발행총액(억)",
            data: ymSorted.map(([_,v]) => Math.round(v.amount)),
            borderColor: C.slate, backgroundColor: C.slate,
            yAxisID: "y2", tension: 0.2,
            _isAmount: true,
            // 라인 라벨은 차트 상단 고정 (lineLabelsAtTop 플러그인이 그림)
            // → 막대와 겹치지 않음. 빌트인 datalabels 는 비활성.
            _labelAtTop: true,
            _labelColor: C.lineLabel,  // 테마-인식 (다크모드 시 밝은 파랑)
            _labelFont: '700 15px Pretendard, -apple-system, "Malgun Gothic", sans-serif',
            // 1조 미만도 항상 "0.X조" 포맷 — 단위 통일 (2,100억 → 0.2조).
            _labelFormatter: (v) => (v / 10000).toFixed(1) + "조",
            datalabels: { display: false },
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 40, right: 12 } },
        plugins: {
          legend: { position: "bottom",
                    labels: { font: { size: 14, weight: "600" }, padding: 14, boxWidth: 18 } },
        },
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
    // initFilters 의 TYPE_ORDER 와 동일 기준 — 무보증 → 신종자본 → 후순위채 → 보증
    const TYPE_ORDER_CHART = ["무보증","신종자본","후순위채","보증"];
    const tEntries = [...tCount.entries()].sort(([a], [b]) => {
      const ia = TYPE_ORDER_CHART.indexOf(a);
      const ib = TYPE_ORDER_CHART.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    const typeColors = [C.gold, C.navy, C.bronze, C.slate, "#9a8550"];
    // doughnut 공통 옵션: 슬라이스 안 흰 글씨 + 그림자
    const doughnutLabelOpts = {
      color: "#ffffff",
      font: { size: 19, weight: "800" },
      anchor: "center", align: "center",
      textStrokeColor: "rgba(0,0,0,0.55)",
      textStrokeWidth: 4,
    };
    charts.typeCount = new Chart($("ch-type-count"), {
      type: "doughnut",
      data: {
        labels: tEntries.map(([k]) => k),
        datasets: [{ data: tEntries.map(([_,v]) => v),
                     backgroundColor: typeColors }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right",
                    labels: { font: { size: 14, weight: "600" }, padding: 12, boxWidth: 18 } },
          datalabels: doughnutLabelOpts,
        },
      },
    });
    charts.typeAmt = new Chart($("ch-type-amt"), {
      type: "doughnut",
      data: {
        labels: tEntries.map(([k]) => k),
        datasets: [{ data: tEntries.map(([k]) => Math.round(tAmt.get(k) || 0)),
                     backgroundColor: typeColors,
                     _isAmount: true }], // 억 단위 포맷
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right",
                    labels: { font: { size: 14, weight: "600" }, padding: 12, boxWidth: 18 } },
          datalabels: doughnutLabelOpts,
        },
      },
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
    // X축 차트 순서 — RATING_OPTIONS 는 AAA→BBB- (높→낮) 이지만 차트는
    // 낮→높 (왼쪽=BBB-, 오른쪽=AAA) 순서로 표시. filter dropdown 은 그대로.
    const RATING_OPTIONS_CHART = [...RATING_OPTIONS].reverse();
    charts.ratingCount = new Chart($("ch-rating-count"), {
      type: "bar",
      data: {
        labels: RATING_OPTIONS_CHART,
        datasets: [{ label: "건수",
                     data: RATING_OPTIONS_CHART.map((r) => ratingCount.get(r)),
                     backgroundColor: C.slate }],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        plugins: { legend: { display: false } },
      },
    });
    charts.ratingAmt = new Chart($("ch-rating-amt"), {
      type: "bar",
      data: {
        labels: RATING_OPTIONS_CHART,
        datasets: [{ label: "발행총액(억)",
                     data: RATING_OPTIONS_CHART.map((r) => Math.round(ratingAmt.get(r))),
                     backgroundColor: C.navy,
                     _isAmount: true }],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        plugins: { legend: { display: false } },
      },
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
                     backgroundColor: C.gold,
                     _isAmount: true }],
      },
      options: { indexAxis: "y", maintainAspectRatio: false,
                 layout: { padding: { right: 60 } }, // 라벨이 막대 끝 밖으로 나가는 공간
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
                     backgroundColor: C.bronze,
                     _isAmount: true }],
      },
      options: { indexAxis: "y", maintainAspectRatio: false,
                 layout: { padding: { right: 60 } },
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
                     backgroundColor: C.slate }],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        plugins: { legend: { display: false } },
      },
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
                     backgroundColor: C.gold }],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 36 } },
        plugins: { legend: { display: false } },
      },
    });

    // ============== 각 차트 카드에 JPG 다운로드 버튼 부착 ==============
    attachDownloadButtons();
  }

  // ============== 다운로드 (1920×1080 JPG, 상단 제목+설명 포함) ==============
  // 합성 방식: 메인 1920×1080 캔버스에 흰 배경 + "공모채 <제목>" + 설명 텍스트.
  // 그 아래 영역에 별도 offscreen 캔버스로 Chart.js 재렌더 후 drawImage 로 합성.
  function attachDownloadButtons() {
    document.querySelectorAll(".chart-card").forEach((card) => {
      if (card.querySelector(".chart-download-btn")) return;
      const canvas = card.querySelector("canvas");
      if (!canvas) return;
      const chartKey = Object.keys(charts).find((k) => charts[k] && charts[k].canvas === canvas);
      if (!chartKey) return;
      const h3 = card.querySelector("h3");
      const title = h3
        ? h3.textContent.replace(/^\s*\d+\s*/, "").trim()
        : canvas.id;
      const descEl = card.querySelector(".chart-desc");
      const desc = descEl ? descEl.textContent.trim() : "";
      const btn = document.createElement("button");
      btn.className = "chart-download-btn";
      btn.type = "button";
      btn.title = "이 차트를 JPG로 다운로드 (1920×1080)";
      btn.dataset.key = chartKey;
      btn.dataset.label = title;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      const showPeriod = !canvas.id.includes("monthly");  // 1번(월별) 카드는 기간 미표기
      btn.addEventListener("click", () => downloadChartAsJPG(chartKey, title, desc, showPeriod));
      card.appendChild(btn);
    });
  }

  function downloadChartAsJPG(chartKey, title, desc, showPeriod) {
    const src = charts[chartKey];
    if (!src) return;

    // 제목 "공모채" 접두사
    const fullTitle = `공모채 ${title}`;

    // 라이트/다크 모드 색 (현재 페이지 테마 기반 — 차트도 그 톤으로 렌더링됨)
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const COLOR_BG    = isDark ? "#0a0a0a" : "#ffffff";
    const COLOR_TITLE = isDark ? "#f1f5f9" : "#0f172a";
    const COLOR_DESC  = isDark ? "#94a3b8" : "#64748b";

    // 설명 줄: (조회 기간) + (원래 설명). 기간은 원래 설명 윗줄(제목과 설명 사이).
    const descLines = [];
    if (showPeriod) {
      const ds = $("f-date-start").value || "처음", de = $("f-date-end").value || "끝";
      descLines.push(`조회 기간: ${ds} ~ ${de}`);
    }
    if (desc) descLines.push(desc);

    // 레이아웃 (px)
    const W = 1920, H = 1080;
    const PAD_X      = 72;
    const TITLE_TOP  = 92;            // 제목 baseline Y
    const DESC_TOP   = 152;           // 첫 설명 줄 baseline Y
    const DESC_LH    = 40;            // 설명 줄 간격
    const CHART_Y    = descLines.length ? (DESC_TOP + (descLines.length - 1) * DESC_LH + 48) : 170;
    const CHART_PAD_B = 40;           // 차트 영역 하단 패딩
    const CHART_W    = W;
    const CHART_H    = H - CHART_Y - CHART_PAD_B;

    // 메인 캔버스 (최종 출력)
    const mainCanvas = document.createElement("canvas");
    mainCanvas.width = W;
    mainCanvas.height = H;
    const mctx = mainCanvas.getContext("2d");
    // 흰 (혹은 다크) 배경
    mctx.fillStyle = COLOR_BG;
    mctx.fillRect(0, 0, W, H);
    // 제목
    const fontFamily = `Pretendard, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    mctx.fillStyle = COLOR_TITLE;
    mctx.font = `700 48px ${fontFamily}`;
    mctx.textBaseline = "alphabetic";
    mctx.fillText(fullTitle, PAD_X, TITLE_TOP);
    // 설명 줄들 (조회 기간 + 원래 설명) — 동일 폰트/크기
    mctx.fillStyle = COLOR_DESC;
    mctx.font = `400 28px ${fontFamily}`;
    descLines.forEach((line, i) => mctx.fillText(line, PAD_X, DESC_TOP + i * DESC_LH));

    // 차트 전용 offscreen 캔버스 (이후 mainCanvas 에 drawImage 합성)
    const chartCanvas = document.createElement("canvas");
    chartCanvas.width = CHART_W;
    chartCanvas.height = CHART_H;
    chartCanvas.style.cssText = "position:fixed;left:-99999px;top:-99999px;";
    document.body.appendChild(chartCanvas);

    // Chart.js config clone (option callbacks 없음 — JSON deep clone 안전)
    const cfg = src.config;
    const clonedData = JSON.parse(JSON.stringify(cfg.data));
    const clonedOptions = JSON.parse(JSON.stringify(cfg.options || {}));
    clonedOptions.animation = false;
    clonedOptions.responsive = false;
    clonedOptions.maintainAspectRatio = false;
    clonedOptions.devicePixelRatio = 1;

    // 1920×1080 큰 캔버스에서 화면용 폰트 (11~19px) 가 너무 작아 보이는 문제.
    // 모든 font.size 를 SCALE 배수 + _labelFont CSS 문자열도 동일 스케일.
    const SCALE = 2.6;
    // 차트-레벨 기본 font 설정 (없으면) — 축 tick / 축 title 등 Chart.defaults
    // (size 11) 를 상속하는 요소들이 다운로드 시 명시 override 받아 스케일됨.
    const baseSize = (Chart.defaults.font && Chart.defaults.font.size) || 11;
    clonedOptions.font = clonedOptions.font || {};
    if (typeof clonedOptions.font.size !== "number") {
      clonedOptions.font.size = baseSize;
    }
    const scaleFonts = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { obj.forEach(scaleFonts); return; }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "font" && v && typeof v === "object" && typeof v.size === "number") {
          v.size = Math.round(v.size * SCALE);
        } else if (typeof v === "object") {
          scaleFonts(v);
        }
      }
    };
    scaleFonts(clonedOptions);
    scaleFonts(clonedData);
    // dataset 의 _labelFont CSS 문자열 (lineLabelsAtTop 플러그인용) 도 스케일
    (clonedData.datasets || []).forEach((ds) => {
      if (typeof ds._labelFont === "string") {
        ds._labelFont = ds._labelFont.replace(/(\d+)px/, (_, sz) =>
          `${Math.round(parseInt(sz, 10) * SCALE)}px`);
      }
    });
    // Chart.defaults 의 글로벌 font.size 도 download 인스턴스에서 override
    clonedOptions.plugins = clonedOptions.plugins || {};
    clonedOptions.plugins.datalabels = clonedOptions.plugins.datalabels || {};
    if (!clonedOptions.plugins.datalabels.font) {
      // 차트가 자체 font 안 가지고 있으면 글로벌 default (size 16) 스케일 적용
      clonedOptions.plugins.datalabels.font = { size: Math.round(16 * SCALE), weight: "700" };
    }

    // 축 tick / 축 title 은 Chart.defaults.font.size (=11) 를 동적으로 상속.
    // 임시로 bump → 새 Chart 인스턴스만 영향받음 (기존 화면 차트는 이미
    // 생성 시점에 resolved 라 무관). 다운로드 끝나면 finally 에서 복원.
    const origDefaultsFontSize = (Chart.defaults.font && Chart.defaults.font.size) || 11;
    if (!Chart.defaults.font) Chart.defaults.font = {};
    Chart.defaults.font.size = Math.round(origDefaultsFontSize * SCALE);

    const tempChart = new Chart(chartCanvas, {
      type: cfg.type,
      data: clonedData,
      options: clonedOptions,
    });

    // 두 프레임 대기 → 렌더 완료
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        // 차트 캔버스 → 메인 캔버스 합성
        mctx.drawImage(chartCanvas, 0, CHART_Y);

        const dataURL = mainCanvas.toDataURL("image/jpeg", 0.95);

        const today = new Date().toISOString().slice(0, 10);
        const safeTitle = fullTitle
          .replace(/[\\/:*?"<>|]/g, "")
          .replace(/\s+/g, "_");
        const a = document.createElement("a");
        a.href = dataURL;
        a.download = `NumbersPool_${safeTitle}_${today}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        tempChart.destroy();
        chartCanvas.remove();
        // Chart.defaults.font.size 복원 — 새 차트 인스턴스에 영향 가지 않게
        Chart.defaults.font.size = origDefaultsFontSize;
      }
    }));
  }

  loadAll();

  // 테마 토글 시 자동 재렌더링 — 라벨 색이 즉시 새 테마에 맞게 갱신됨
  new MutationObserver(() => {
    if (DATA) runQuery();
  }).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-theme"],
  });
})();
