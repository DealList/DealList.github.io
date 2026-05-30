// DealList — 증권사 League Table (주관/인수 실적)
(function () {
  "use strict";

  // 증권사 alias → 풀네임 매핑 (deals/app.js 와 동일)
  const BROKER_FULL_NAME = {
    "BNK": "BNK투자증권", "DB": "DB금융투자", "IBK": "IBK투자증권",
    "KB": "KB증권", "KR": "KR투자증권", "LS": "LS증권",
    "NH": "NH투자증권", "SK": "SK증권", "iM": "iM증권",
    "교보": "교보증권", "다올": "다올투자증권", "대신": "대신증권",
    "디에스": "DS투자증권", "리딩": "리딩투자증권", "메리츠": "메리츠증권",
    "미래": "미래에셋증권", "부국": "부국증권", "산은": "한국산업은행",
    "삼성": "삼성증권", "상상인": "상상인증권", "신영": "신영증권",
    "신한": "신한투자증권", "우리": "우리투자증권", "유안타": "유안타증권",
    "유진": "유진투자증권", "케이프": "케이프투자증권",
    "코리아에셋": "코리아에셋투자증권", "키움": "키움증권",
    "하나": "하나증권", "한양": "한양증권", "한투": "한국투자증권",
    "한화": "한화투자증권", "현차": "현대차증권", "흥국": "흥국증권",
  };

  const MAX_BROKER_CHIPS = 10;

  let DATA = [];
  let META = {};
  let brokerKeywords = [];
  let aggregated = [];    // [{ alias, name, count, amount, share, issuers }]
  let activeTab = "lead"; // "lead" or "uw"
  let sortKey = "amount";
  let sortDir = "desc";

  const $ = (id) => document.getElementById(id);

  // ============== 데이터 로드 ==============
  async function loadAll() {
    try {
      const [d, m] = await Promise.all([
        fetch("../data.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("../meta.json", { cache: "no-store" }).then((r) => r.json()),
      ]);
      DATA = d;
      META = m;
      initFilters();
      $("updated").textContent = "최종 업데이트: " + (META.updated || "-");
      // nav (초록불 우측) 통합 표시
      const navUpdated = document.getElementById("nav-updated");
      if (navUpdated) {
        const total = META.count || DATA.length;
        navUpdated.textContent =
          `최종 업데이트 ${META.updated || "-"} · 전체 ${total.toLocaleString()}건`;
      }
      runQuery();
    } catch (e) {
      $("updated").textContent = "데이터 로드 실패";
      console.error(e);
    }
  }

  // ============== 필터 옵션 초기화 ==============
  function initFilters() {
    // 증권사 옵션 — META.leads + META.underwriters 합집합 (풀네임 정렬)
    const set = new Set([...(META.leads || []), ...(META.underwriters || [])]);
    const brokers = [...set].sort((a, b) =>
      displayName(a).localeCompare(displayName(b), "ko"));
    const sel = $("f-broker-select");
    sel.innerHTML = '<option value="">선택</option>';
    for (const v of brokers) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = displayName(v);
      sel.appendChild(o);
    }

    // 기간 max/min
    const maxDate = DATA.reduce(
      (a, r) => (r.date && r.date > a ? r.date : a), "");
    const minDate = DATA.reduce(
      (a, r) => (r.date && (!a || r.date < a) ? r.date : a), "");

    applyDatePreset("ytd", maxDate, minDate);

    // 이벤트 — 모든 필터 변경은 UI 만 (조회 버튼 클릭 시 갱신)
    ["f-date-start", "f-date-end"].forEach((id) => {
      $(id).addEventListener("change", () => clearPresetActive());
    });

    document.querySelectorAll(".date-presets button[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyDatePreset(btn.dataset.preset, maxDate, minDate);
      });
    });

    // 증권사 chip 셋업
    sel.addEventListener("change", () => {
      const val = sel.value;
      if (!val) return;
      if (brokerKeywords.length >= MAX_BROKER_CHIPS) { sel.value = ""; return; }
      if (brokerKeywords.includes(val)) { sel.value = ""; return; }
      brokerKeywords.push(val);
      sel.value = "";
      renderBrokerChips();
      syncBrokerDisable();
    });

    // 탭
    document.querySelectorAll(".result-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".result-tabs .tab").forEach((t) =>
          t.classList.remove("active"));
        tab.classList.add("active");
        activeTab = tab.dataset.tab;
        $("th-amount-label").textContent =
          activeTab === "lead" ? "주관 실적" : "인수 실적";
        $("th-name-label").textContent =
          activeTab === "lead" ? "주관사" : "인수사";
        $("th-issuers-label").textContent =
          activeTab === "lead" ? "주요 주관 딜(억원)" : "주요 인수 딜(억원)";
        $("formula-note").style.display =
          activeTab === "lead" ? "" : "none";
        runQuery();
      });
    });

    // 정렬 헤더
    document.querySelectorAll("#grid thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = k;
          sortDir = (k === "name") ? "asc" : "desc";
        }
        renderTable();
      });
    });

    // 조회 / 초기화 / 다운로드
    $("btn-search").addEventListener("click", () => {  // 짧은 로딩 스피너 후 적용
      const btn = $("btn-search");
      if (btn.dataset.busy) return;
      const orig = btn.innerHTML;            // 돋보기 SVG + "조회" 보존
      btn.dataset.busy = "1"; btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>조회 중';
      setTimeout(() => {
        runQuery();
        btn.disabled = false; btn.innerHTML = orig; delete btn.dataset.busy;
      }, 250);
    });

    $("btn-reset").addEventListener("click", () => {
      brokerKeywords = [];
      renderBrokerChips();
      syncBrokerDisable();
      $("f-broker-select").value = "";
      applyDatePreset("ytd", maxDate, minDate);
    });

    $("btn-download").addEventListener("click", downloadExcel);
  }

  function displayName(alias) {
    return BROKER_FULL_NAME[alias] || alias;
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

    // YTD — 올해 1월 1일 ~ maxDate.
    // 단, 매년 1월 한 달 동안은 직전 해 데이터를 유지 (1월은 새 해 데이터가
    // 거의 없어 의미 없음 — 2월 1일부터 새 해로 전환).
    if (preset === "ytd") {
      const t = new Date();
      const yr = (t.getMonth() + 1) === 1 ? t.getFullYear() - 1 : t.getFullYear();
      $("f-date-start").value = `${yr}-01-01`;
      $("f-date-end").value = maxDate;
      return;
    }

    const d = new Date(maxDate);
    const start = new Date(d);
    if (preset === "3m") start.setMonth(start.getMonth() - 3);
    else if (preset === "6m") start.setMonth(start.getMonth() - 6);
    else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    $("f-date-end").value = maxDate;
    $("f-date-start").value = start.toISOString().slice(0, 10);
  }

  // ============== 증권사 chip ==============
  function renderBrokerChips() {
    const wrap = $("f-broker-chips");
    wrap.innerHTML = "";
    for (const kw of brokerKeywords) {
      const chip = document.createElement("span");
      chip.className = "issuer-chip";
      chip.innerHTML = esc(displayName(kw)) +
        '<button type="button" class="remove" title="제거">×</button>';
      chip.querySelector(".remove").addEventListener("click", () => {
        brokerKeywords = brokerKeywords.filter((k) => k !== kw);
        renderBrokerChips();
        syncBrokerDisable();
      });
      wrap.appendChild(chip);
    }
  }

  function syncBrokerDisable() {
    const sel = $("f-broker-select");
    const set = new Set(brokerKeywords);
    Array.from(sel.options).forEach((o) => {
      o.disabled = o.value !== "" && set.has(o.value);
    });
  }

  // ============== 조회 + 집계 ==============
  function runQuery() {
    const dateStart = $("f-date-start").value || "";
    const dateEnd = $("f-date-end").value || "";
    $("period-range").textContent =
      `조회 기간: ${dateStart || "처음"} ~ ${dateEnd || "끝"}`;

    // 기간 안 records (final_amount 가 있는 발행 — 1단계 신고서 제외)
    const filtered = DATA.filter((r) => {
      const d = r.date || "";
      if (dateStart && d && d < dateStart) return false;
      if (dateEnd && d && d > dateEnd) return false;
      if (r.final == null) return false;
      return true;
    });

    // 1) 회차 단위로 트랜치 그룹화 — 사용자 룰: 회차(=같은 발행) 가 카운트 단위.
    //    회차 키 = (issuer, series_base, date). series_base = "X-1","X-2" → "X".
    //    트랜치별 lead_amt / uw 를 회차 단위로 합산.
    const dealMap = new Map();
    for (const r of filtered) {
      const seriesBase = (r.series || "").split("-")[0];
      const key = `${r.issuer}|${seriesBase}|${r.date}`;
      if (!dealMap.has(key)) {
        dealMap.set(key, {
          key, issuer: r.issuer, date: r.date, seriesBase,
          final: 0, lead_amt: {}, uw: {},
        });
      }
      const deal = dealMap.get(key);
      deal.final += r.final || 0;
      for (const [alias, amt] of Object.entries(r.lead_amt || {})) {
        deal.lead_amt[alias] = (deal.lead_amt[alias] || 0) + (amt || 0);
      }
      for (const [alias, amt] of Object.entries(r.uw || {})) {
        deal.uw[alias] = (deal.uw[alias] || 0) + (amt || 0);
      }
    }
    const deals = [...dealMap.values()];

    // 회차 단위 final 합 (= 발행총액 표시용)
    const marketTotal = deals.reduce((s, d) => s + d.final, 0);

    // 2) 증권사별 집계 — 회차 단위
    //    실적 금액은 broker 가 받은 lead_amt 또는 uw 의 회차 합산 (= 엑셀 원본 실적).
    const map = new Map();
    for (const deal of deals) {
      const source = activeTab === "lead" ? deal.lead_amt : deal.uw;
      for (const [alias, amt] of Object.entries(source)) {
        if (!map.has(alias)) {
          map.set(alias, { alias, count: 0, amount: 0, dealList: [] });
        }
        const g = map.get(alias);
        g.count += 1;
        g.amount += Number(amt) || 0;
        g.dealList.push({ issuer: deal.issuer, amount: amt });
      }
    }

    // 시장점유율 분모 = 모든 broker 실적 합 (점유율 합 = 100% 보장).
    // 일부 발행에 broker 정보 누락 시 회차 final 합과 다를 수 있으므로 broker 실적
    // 합산을 분모로 사용해야 합계가 정확히 100% 가 됨.
    const brokerTotal = [...map.values()].reduce((s, g) => s + g.amount, 0);

    aggregated = [...map.values()].map((g) => {
      const sortedDeals = [...g.dealList]
        .sort((a, b) => b.amount - a.amount)
        .map((d) => ({ issuer: d.issuer, amount: Math.round(d.amount) }));
      return {
        alias: g.alias,
        name: displayName(g.alias),
        count: g.count,
        amount: Math.round(g.amount),
        share: brokerTotal > 0 ? (g.amount / brokerTotal) * 100 : 0,
        issuers: sortedDeals,
      };
    });

    // Largest Remainder — 반올림 손실 보정해서 합 = 정확히 100.00%
    adjustShares(aggregated);

    // 증권사 필터 (chip 선택 시 그 회사들만)
    if (brokerKeywords.length) {
      const set = new Set(brokerKeywords);
      aggregated = aggregated.filter((g) => set.has(g.alias));
    }

    // 결과 카운트 (회차 단위)
    $("result-count").textContent =
      `증권사 ${aggregated.length.toLocaleString()}개 · ` +
      `발행건수 ${deals.length.toLocaleString()}건 · ` +
      `발행총액 ${fmtAmount(marketTotal)}`;

    updateKPI(deals, marketTotal);
    renderTable();
  }

  // ============== KPI 카드 ==============
  function updateKPI(deals, marketTotal) {
    const grid = $("kpi-grid");
    if (!grid) return;
    if (!deals.length) {
      grid.innerHTML = "";
      return;
    }
    // 주관 1위, 인수 1위 (전체 deals 기준)
    const leadSum = new Map();
    const uwSum = new Map();
    for (const d of deals) {
      for (const [a, v] of Object.entries(d.lead_amt || {})) {
        leadSum.set(a, (leadSum.get(a) || 0) + v);
      }
      for (const [a, v] of Object.entries(d.uw || {})) {
        uwSum.set(a, (uwSum.get(a) || 0) + v);
      }
    }
    const topLead = [...leadSum.entries()].sort((a,b) => b[1]-a[1])[0];
    const topUw = [...uwSum.entries()].sort((a,b) => b[1]-a[1])[0];
    const leadShare = topLead && marketTotal > 0 ?
      (topLead[1] / marketTotal * 100).toFixed(1) : "0";
    const uwShare = topUw && marketTotal > 0 ?
      (topUw[1] / marketTotal * 100).toFixed(1) : "0";

    // V1 디자인: .kpi-cell .l/.v/.s 구조 (deallist.css 의 .kpi-strip 가 4분할 가로 레이아웃)
    grid.innerHTML = `
      <div class="kpi-cell">
        <div class="l">조회 기간 발행건수</div>
        <div class="v">${deals.length.toLocaleString()}<small>건</small></div>
        <div class="s">회차 기준</div>
      </div>
      <div class="kpi-cell">
        <div class="l">조회 기간 발행총액</div>
        <div class="v">${fmtAmount(marketTotal)}</div>
        <div class="s">시장 규모</div>
      </div>
      <div class="kpi-cell">
        <div class="l">조회 기간 주관 1위</div>
        <div class="v">${esc(displayName(topLead ? topLead[0] : ""))}</div>
        <div class="s">${topLead ? fmtAmount(topLead[1]) + " · " + leadShare + "%" : ""}</div>
      </div>
      <div class="kpi-cell">
        <div class="l">조회 기간 인수 1위</div>
        <div class="v">${esc(displayName(topUw ? topUw[0] : ""))}</div>
        <div class="s">${topUw ? fmtAmount(topUw[1]) + " · " + uwShare + "%" : ""}</div>
      </div>
    `;
  }

  function renderTable() {
    // 정렬
    const k = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    aggregated.sort((a, b) => {
      const va = a[k];
      const vb = b[k];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });

    document.querySelectorAll("#grid thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === k) {
        th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });

    const tbody = $("rows");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();

    aggregated.forEach((g, i) => {
      const tr = document.createElement("tr");
      const issuersText = formatIssuers(g.issuers);
      const issuersFullTitle = g.issuers
        .map((x) => `${x.issuer}(${x.amount})`)
        .join(", ");
      tr.innerHTML =
        '<td class="num">' + (i + 1) + "</td>" +
        "<td>" + esc(g.name) + "</td>" +
        '<td class="num">' + g.count.toLocaleString() + "</td>" +
        '<td class="num strong">' + g.amount.toLocaleString() + "</td>" +
        '<td class="num">' + g.share.toFixed(2) + "%</td>" +
        '<td class="rel-issuers" title="' + esc(issuersFullTitle) + '">' +
        esc(issuersText) + "</td>";
      frag.appendChild(tr);
    });

    // 합계 행
    if (aggregated.length > 0) {
      const totalCount = aggregated.reduce((s, g) => s + g.count, 0);
      const totalAmt = aggregated.reduce((s, g) => s + g.amount, 0);
      const totalShare = aggregated.reduce((s, g) => s + g.share, 0);
      const tr = document.createElement("tr");
      tr.className = "total-row";
      tr.innerHTML =
        '<td colspan="2" class="center">합계</td>' +
        '<td class="num">' + totalCount.toLocaleString() + "</td>" +
        '<td class="num strong">' + totalAmt.toLocaleString() + "</td>" +
        '<td class="num">' + totalShare.toFixed(2) + "%</td>" +
        "<td></td>";
      frag.appendChild(tr);
    }

    tbody.appendChild(frag);

    $("empty").classList.toggle("hidden", aggregated.length > 0);
  }

  function formatIssuers(items) {
    if (!items.length) return "";
    const head = items
      .slice(0, 5)
      .map((x) => `${x.issuer}(${x.amount})`)
      .join(", ");
    if (items.length <= 5) return head;
    return head + ` 외 ${items.length - 5}건`;
  }

  // 시장점유율 합 = 정확히 100.00% 가 되도록 0.01%p 단위 보정 (Largest Remainder).
  // 반올림 누적 손실 (예: 33.33×3 = 99.99%) 제거.
  function adjustShares(items) {
    if (!items.length) return;
    const SCALE = 10000;  // 100.00% × 100 → 정수 단위
    const scaled = items.map((g) => Math.floor(g.share * 100));
    const total = scaled.reduce((s, x) => s + x, 0);
    let diff = SCALE - total;
    if (diff !== 0) {
      const remainders = items.map((g, i) => ({
        i, frac: g.share * 100 - scaled[i],
      })).sort((a, b) => diff > 0 ? b.frac - a.frac : a.frac - b.frac);
      const step = diff > 0 ? 1 : -1;
      for (let k = 0; k < Math.abs(diff); k++) {
        const idx = remainders[k % remainders.length].i;
        scaled[idx] += step;
      }
    }
    items.forEach((g, i) => { g.share = scaled[i] / 100; });
  }

  function fmtAmount(eok) {
    // 억원 → 조/억 표기 (큰 수)
    if (eok >= 10000) {
      const jo = Math.floor(eok / 10000);
      const rest = Math.round(eok % 10000);
      return `${jo.toLocaleString()}조 ${rest.toLocaleString()}억`;
    }
    return `${Math.round(eok).toLocaleString()}억`;
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ============== Excel 다운로드 ==============
  function downloadExcel() {
    if (!aggregated.length) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }
    const issuersColLabel = activeTab === "lead" ? "주요 주관 딜(억원)" : "주요 인수 딜(억원)";
    const amtColLabel = activeTab === "lead" ? "주관 실적(억원)" : "인수 실적(억원)";
    const nameColLabel = activeTab === "lead" ? "주관사" : "인수사";
    const rows = aggregated.map((g, i) => ({
      순위: i + 1,
      [nameColLabel]: g.name,
      건수: g.count,
      [amtColLabel]: g.amount,
      시장점유율: g.share.toFixed(2) + "%",
      [issuersColLabel]: g.issuers
        .map((x) => `${x.issuer}(${x.amount})`)
        .join(", "),
    }));
    // 합계 행 (Excel 에도 동일)
    const totalCount = aggregated.reduce((s, g) => s + g.count, 0);
    const totalAmt = aggregated.reduce((s, g) => s + g.amount, 0);
    const totalShare = aggregated.reduce((s, g) => s + g.share, 0);
    rows.push({
      순위: "합계",
      [nameColLabel]: "",
      건수: totalCount,
      [amtColLabel]: totalAmt,
      시장점유율: totalShare.toFixed(2) + "%",
      [issuersColLabel]: "",
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws,
      activeTab === "lead" ? "주관실적" : "인수실적");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb,
      `NumbersPool_${activeTab === "lead" ? "주관" : "인수"}실적_${today}.xlsx`);
  }

  loadAll();
})();
