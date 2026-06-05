/* Numbers Pool — 기사 생성 페이지
 *
 * DCM/ECM 발행정보를 하나의 페이지에서 보고, 각 행의 [기사 쓰기] 버튼 → 모달 → AI 기사 초안.
 * 표·필터·Excel 은 기존 dcm-deals / ecm-deals 와 동일 동작. KPI 카드는 표시하지 않음.
 *
 * 구조:
 *   - 1차 탭: DCM / ECM  (active section 토글)
 *   - ECM 안 2차 탭: IPO / 유상증자
 *   - 모달: 데이터 → Edge Function(generate-article) → 기사 텍스트 표시
 */
(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════════
  // 공통 상수 / 헬퍼
  // ════════════════════════════════════════════════════════════════════
  const PAGE_SIZE = 50;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(
    /[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const fmtN = (v) => (typeof v === "number" ? v.toLocaleString() : "-");
  const fmtRate = (v) => (v == null ? "" : Number(v).toFixed(3));
  const fmtBig = (eok) => {
    if (!eok || eok < 0) return "-";
    if (eok >= 10000) {
      const jo = Math.floor(eok / 10000), rest = Math.round(eok % 10000);
      return rest > 0 ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${jo.toLocaleString()}조`;
    }
    return `${Math.round(eok).toLocaleString()}억`;
  };
  const fmtManN = (v) => (typeof v === "number" ? Math.round(v / 10000).toLocaleString() : "-");
  const fmtPctN = (v) => {  // 표 셀용 % 숫자만 (단위는 헤더). 소수 2자리 + 불필요한 0 제거.
    if (typeof v !== "number" || !isFinite(v)) return "-";
    const p = Math.round(v * 10000) / 100;
    return p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };
  // 증자비율 — 반올림된 increase_ratio 대신 원본 신주수량/기존주식수로 정밀 계산.
  const ratioOf = (r) => (typeof r.new_qty === "number" && typeof r.existing_qty === "number" && r.existing_qty) ? r.new_qty / r.existing_qty : r.increase_ratio;
  // 비율(분수 0~1) → 퍼센트 문자열. 소수 2자리, 불필요한 0 제거. 0.2487 → "24.87%", 0.25 → "25%", 0.248 → "24.8%".
  const fmtPctStr = (v) => {
    if (typeof v !== "number" || !isFinite(v)) return null;
    const p = Math.round(v * 10000) / 100;            // 퍼센트, 소수 2자리
    return p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "%";
  };
  // 비율을 '반올림된 ratio' 대신 원본 분자/분모로 정밀 계산(데이터의 round(,2) 손실 우회). 수량 없으면 ratio로 폴백.
  const ratioPctStr = (num, den, fallbackRatio) => {
    if (typeof num === "number" && typeof den === "number" && den) return fmtPctStr(num / den);
    return fmtPctStr(typeof fallbackRatio === "number" ? fallbackRatio : null);
  };

  // Excel(DCM) broker 컬럼 순서 — dcm-deals/app.js 와 동일. 데이터에 새 broker 나오면 끝에 자동 추가.
  const LEAD_ORDER = [
    "KB","NH","한투","신한","SK","삼성","키움","미래","하나","한화",
    "iM","대신","교보","한양","DB","IBK","부국","신영","유진","흥국",
    "유안타","BNK","우리","메리츠","코리아에셋","산은","현차","KR",
  ];
  const UW_ORDER = [
    "KB","NH","한투","신한","SK","삼성","키움","미래","하나","한화",
    "iM","대신","교보","한양","DB","현차","IBK","부국","신영","유진",
    "흥국","유안타","LS","BNK","메리츠","상상인","리딩","우리","케이프",
    "산은","코리아에셋","KR","다올","디에스",
  ];

  // dcm-deals 의 RATING_RANK / RATING_OPTIONS (동일)
  const RATING_RANK = {
    "AAA": 1, "AA+": 2, "AA": 3, "AA-": 4, "A+": 5, "A": 6, "A-": 7,
    "BBB+": 8, "BBB": 9, "BBB-": 10, "BB+": 11, "BB": 12, "BB-": 13,
    "B+": 14, "B": 15, "B-": 16, "CCC+": 17, "CCC": 18, "CCC-": 19,
    "CC": 20, "C": 21, "D": 22,
  };
  const RATING_OPTIONS = ["AAA","AA+","AA","AA-","A+","A","A-","BBB+","BBB","BBB-"];
  function effectiveRatingRank(s) {
    if (!s) return null;
    if (s.includes("~")) { const low = s.split("~")[0].trim(); return RATING_RANK[low] ?? null; }
    return RATING_RANK[s.trim()] ?? null;
  }

  // ecm-deals 의 BROKER_FULL (동일)
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

  // ════════════════════════════════════════════════════════════════════
  // 1차 탭 전환 (DCM / ECM)
  // ════════════════════════════════════════════════════════════════════
  let topTab = "dcm";
  function switchTop(t) {
    if (!t) return;
    if (t === topTab) return;
    topTab = t;
    document.querySelectorAll(".art-tab").forEach(b =>
      b.classList.toggle("active", b.dataset.top === t));
    document.querySelectorAll(".art-section").forEach(s =>
      s.hidden = s.dataset.section !== t);
    // 첫 진입 시 초기화 (lazy)
    if (t === "dcm" && !DCM.inited) DCM.init();
    if (t === "ecm" && !ECM.inited) ECM.init();
  }
  // 이벤트 위임 — 직접 핸들러 미연결 케이스 안전망 (script timing 등)
  const topTabsBar = document.querySelector(".art-top-tabs");
  if (topTabsBar) {
    topTabsBar.addEventListener("click", (e) => {
      const b = e.target.closest(".art-tab");
      if (b && b.dataset.top) switchTop(b.dataset.top);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // DCM 섹션 — dcm-deals/app.js 의 핵심 로직을 차용해 prefix 'd-' 로 옮김
  // ════════════════════════════════════════════════════════════════════
  const DCM = {
    inited: false, DATA: [], META: {},
    filtered: [], grouped: [],
    page: 1, sortKey: "date", sortDir: "desc",
    issuerKw: [], leadKw: [], uwKw: [],
    MAX_ISS: 10, MAX_BR: 5,
  };

  DCM.init = async function () {
    if (DCM.inited) return;
    DCM.inited = true;
    try {
      const [d, m] = await Promise.all([
        NP_loadData("data.json"),
        NP_loadData("meta.json"),
      ]);
      DCM.DATA = d; DCM.META = m;
    } catch (e) {
      console.error("DCM load error", e);
      $("d-empty").textContent = "데이터 로드 실패";
      $("d-empty").classList.remove("hidden");
      return;
    }
    DCM.initFilters();
    DCM.applyFilters();
  };

  DCM.initFilters = function () {
    const TYPE_ORDER = ["무보증","신종자본","후순위채","보증"];
    const types = DCM.META.types || [];
    const orderedTypes = [
      ...TYPE_ORDER.filter(t => types.includes(t)),
      ...types.filter(t => !TYPE_ORDER.includes(t)),
    ];
    fillSelect("d-f-type", orderedTypes, true);
    fillSelect("d-f-rating-min", RATING_OPTIONS, true);
    fillSelect("d-f-rating-max", RATING_OPTIONS, true);

    const maxDate = DCM.DATA.reduce((a, r) => (r.date && r.date > a ? r.date : a), "");
    const minDate = DCM.DATA.reduce((a, r) => (r.date && (!a || r.date < a) ? r.date : a), "");

    DCM.applyDatePreset("1y", maxDate, minDate);

    setupChipDropdown({
      selId:"d-f-lead-select", chipsId:"d-f-lead-chips", max:DCM.MAX_BR,
      values:DCM.META.leads || [], dispMap:BROKER_FULL,
      get:() => DCM.leadKw, set:(a) => { DCM.leadKw = a; },
    });
    setupChipDropdown({
      selId:"d-f-uw-select", chipsId:"d-f-uw-chips", max:DCM.MAX_BR,
      values:DCM.META.underwriters || [], dispMap:BROKER_FULL,
      get:() => DCM.uwKw, set:(a) => { DCM.uwKw = a; },
    });
    ["d-f-date-start","d-f-date-end"].forEach(id =>
      $(id).addEventListener("change", () => clearPresetActive("d")));

    const issuerSet = new Map((DCM.META.issuers || []).map(s => [s.toLowerCase(), s]));
    const dl = $("d-issuers-datalist");
    dl.innerHTML = "";
    for (const n of (DCM.META.issuers || [])) {
      const o = document.createElement("option"); o.value = n; dl.appendChild(o);
    }
    function commitIssuer(silent) {
      const v = $("d-f-issuer").value.trim();
      if (!v) return false;
      const canon = issuerSet.get(v.toLowerCase());
      if (!canon) { if (!silent) alert(`'${v}' 발행사를 찾을 수 없습니다. 자동완성 목록에서 선택해 주세요.`); return false; }
      if (DCM.issuerKw.length >= DCM.MAX_ISS || DCM.issuerKw.includes(canon)) { $("d-f-issuer").value = ""; return false; }
      DCM.issuerKw.push(canon); $("d-f-issuer").value = "";
      renderChips("d-f-issuer-chips", DCM.issuerKw, () => {});
      return true;
    }
    $("d-f-issuer").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commitIssuer(false); }
    });

    document.querySelectorAll('[data-d-preset]').forEach(btn =>
      btn.addEventListener("click", () => DCM.applyDatePreset(btn.dataset.dPreset, maxDate, minDate)));

    $("d-btn-search").addEventListener("click", () => {
      const btn = $("d-btn-search"); const orig = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>조회 중';
      setTimeout(() => {
        commitIssuer(true); DCM.page = 1; DCM.applyFilters();
        btn.disabled = false; btn.innerHTML = orig;
      }, 250);
    });
    $("d-btn-reset").addEventListener("click", () => {
      $("d-f-type").value = ""; $("d-f-rating-min").value = ""; $("d-f-rating-max").value = "";
      DCM.applyDatePreset("1y", maxDate, minDate);
      DCM.issuerKw = []; renderChips("d-f-issuer-chips", DCM.issuerKw, () => {});
      $("d-f-issuer").value = "";
      DCM.leadKw = []; $("d-f-lead-chips").innerHTML = ""; $("d-f-lead-select").value = "";
      Array.from($("d-f-lead-select").options).forEach(o => o.disabled = false);
      DCM.uwKw = []; $("d-f-uw-chips").innerHTML = ""; $("d-f-uw-select").value = "";
      Array.from($("d-f-uw-select").options).forEach(o => o.disabled = false);
    });
    $("d-btn-download").addEventListener("click", DCM.downloadExcel);

    document.querySelectorAll('#d-grid thead th[data-sort]').forEach(th =>
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (DCM.sortKey === k) DCM.sortDir = DCM.sortDir === "asc" ? "desc" : "asc";
        else { DCM.sortKey = k; DCM.sortDir = (k === "date" || k === "disclosure_date") ? "desc" : "asc"; }
        DCM.groupAndSort(); DCM.render();
      }));

    // 표 본문 이벤트 위임 — DART 링크 + [기사 쓰기]
    $("d-rows").addEventListener("click", (e) => {
      const link = e.target.closest("a.dart-link");
      if (link) { e.preventDefault(); const r = link.dataset.rcept;
        if (r) window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r}`, "dart-viewer", "width=1100,height=800");
        return; }
      const wb = e.target.closest(".art-btn-write");
      if (wb) {
        e.preventDefault();
        const key = wb.dataset.key;
        const g = DCM.grouped.find(x => x.key === key);
        if (g) openArticleModal("dcm", g);
      }
    });
  };

  DCM.applyDatePreset = function (p, maxDate, minDate) {
    clearPresetActive("d");
    const btn = document.querySelector(`[data-d-preset="${p}"]`);
    if (btn) btn.classList.add("active");
    if (p === "all") { $("d-f-date-start").value = minDate || ""; $("d-f-date-end").value = maxDate || ""; return; }
    if (!maxDate) return;
    const d = new Date(maxDate); const s = new Date(d);
    if (p === "3m") s.setMonth(s.getMonth() - 3);
    else if (p === "6m") s.setMonth(s.getMonth() - 6);
    else if (p === "1y") s.setFullYear(s.getFullYear() - 1);
    s.setDate(s.getDate() + 1);
    $("d-f-date-end").value = maxDate;
    $("d-f-date-start").value = s.toISOString().slice(0, 10);
  };

  DCM.applyFilters = function () {
    const dateStart = $("d-f-date-start").value || "";
    const dateEnd = $("d-f-date-end").value || "";
    const typeVal = $("d-f-type").value || "";
    const ratingMin = $("d-f-rating-min").value || "";
    const ratingMax = $("d-f-rating-max").value || "";
    const minRank = ratingMin ? RATING_RANK[ratingMin] : null;
    const maxRank = ratingMax ? RATING_RANK[ratingMax] : null;
    const issuerSet = new Set(DCM.issuerKw.map(k => k.toLowerCase()));
    const leadSet = new Set(DCM.leadKw.map(k => k.toLowerCase()));
    const uwSet = new Set(DCM.uwKw.map(k => k.toLowerCase()));

    const matchTr = (r) => {
      const d = r.date || "";
      if (dateStart && d && d < dateStart) return false;
      if (dateEnd && d && d > dateEnd) return false;
      if (typeVal && r.type !== typeVal) return false;
      if (minRank !== null || maxRank !== null) {
        const er = effectiveRatingRank(r.rating);
        if (er == null) return false;
        if (maxRank !== null && er < maxRank) return false;
        if (minRank !== null && er > minRank) return false;
      }
      if (leadSet.size && !(r.leads || []).some(l => leadSet.has(l.toLowerCase()))) return false;
      if (uwSet.size && !Object.keys(r.uw || {}).some(a => uwSet.has(a.toLowerCase()))) return false;
      if (issuerSet.size && !issuerSet.has((r.issuer || "").toLowerCase())) return false;
      return true;
    };
    const matchedKeys = new Set();
    for (const r of DCM.DATA) if (matchTr(r)) matchedKeys.add(dGroupKey(r));
    DCM.filtered = DCM.DATA.filter(r => matchedKeys.has(dGroupKey(r)));

    DCM.groupAndSort(); DCM.render();
  };

  function dGroupKey(r) {
    const base = (r.series || "").split("-")[0];
    return `${r.issuer}|${base}|${r.date}`;
  }
  function dSeriesSortKey(s) {
    return (s || "").split("-").map(p => { const n = Number(p); return isNaN(n) ? p : n; });
  }
  function dCompareSeries(a, b) {
    const ka = dSeriesSortKey(a), kb = dSeriesSortKey(b);
    const len = Math.max(ka.length, kb.length);
    for (let i = 0; i < len; i++) {
      const va = ka[i], vb = kb[i];
      if (va === undefined) return -1; if (vb === undefined) return 1;
      if (typeof va === "number" && typeof vb === "number") { if (va !== vb) return va - vb; }
      else { const c = String(va).localeCompare(String(vb)); if (c !== 0) return c; }
    }
    return 0;
  }

  DCM.groupAndSort = function () {
    const map = new Map();
    for (const r of DCM.filtered) {
      const k = dGroupKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    DCM.grouped = [];
    for (const [k, recs] of map.entries()) {
      recs.sort((a, b) => dCompareSeries(a.series, b.series));
      DCM.grouped.push({ key:k, records:recs, rep:recs[0] });
    }
    const k = DCM.sortKey; const dir = DCM.sortDir === "asc" ? 1 : -1;
    const computeRatio = (rec) => (rec && rec.demand && rec.init) ? rec.demand / rec.init : null;
    DCM.grouped.sort((ga, gb) => {
      if (k === "series") return dCompareSeries(ga.rep.series, gb.rep.series) * dir;
      let va, vb;
      if (k === "ratio") { va = computeRatio(ga.rep); vb = computeRatio(gb.rep); }
      else { va = ga.rep[k]; vb = gb.rep[k]; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
    document.querySelectorAll('#d-grid thead th').forEach(th => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === k) th.classList.add(DCM.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  };

  DCM.render = function () {
    const totalGroups = DCM.grouped.length;
    const totalTr = DCM.filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));
    if (DCM.page > totalPages) DCM.page = totalPages;
    const start = (DCM.page - 1) * PAGE_SIZE;
    const pageGroups = DCM.grouped.slice(start, start + PAGE_SIZE);

    const tbody = $("d-rows"); tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    pageGroups.forEach((g, gIdx) => {
      const N = g.records.length;
      g.records.forEach((r, i) => {
        const isFirst = i === 0;
        const tr = document.createElement("tr");
        if (isFirst && gIdx > 0) tr.classList.add("group-start");
        let html = "";
        if (isFirst) {
          html += `<td class="art-col group-cell" rowspan="${N}">${writeBtnHtml(g.key)}</td>`;
          html += `<td class="group-cell" rowspan="${N}">${esc(r.disclosure_date || "-")}</td>`;
          html += `<td class="group-cell" rowspan="${N}">${esc(r.date || "")}</td>`;
          const issuerHtml = r.rcept
            ? `<a class="dart-link" href="#" data-rcept="${esc(r.rcept)}">${esc(r.issuer)}</a>`
            : esc(r.issuer);
          html += `<td class="group-cell" rowspan="${N}">${issuerHtml}</td>`;
        }
        html += `<td>${esc(r.series)}</td>` +
                `<td>${esc(r.type)}</td>` +
                `<td>${esc(r.rating)}</td>` +
                `<td>${esc(r.maturity)}</td>` +
                `<td class="num">${fmtN(r.init)}</td>`;
        if (isFirst) html += `<td class="num group-cell" rowspan="${N}">${fmtN(r.limit)}</td>`;
        html += `<td class="num">${fmtN(r.demand)}</td>` +
                `<td class="num">${fmtN(r.final)}</td>`;
        if (isFirst) html += `<td class="num group-cell" rowspan="${N}">${fmtN(r.series_total)}</td>`;
        const ratio = (r.demand && r.init) ? (r.demand / r.init) : null;
        html += `<td class="num">${ratio != null ? ratio.toFixed(2) : "-"}</td>` +
                `<td class="center">${esc(r.r_target)}</td>` +
                `<td class="center">${esc(r.r_demand)}</td>` +
                `<td class="num">${fmtRate(r.r_final)}</td>` +
                `<td>${esc((r.leads || []).join(", "))}</td>` +
                `<td>${esc(Object.keys(r.uw || {}).join(", "))}</td>`;
        tr.innerHTML = html;
        frag.appendChild(tr);
      });
    });
    tbody.appendChild(frag);
    $("d-empty").classList.toggle("hidden", totalTr > 0);
    $("d-result-count").innerHTML =
      `<strong>${totalTr.toLocaleString()}</strong>건 / <strong>${totalGroups.toLocaleString()}</strong>개 회차`;
    renderPager("d-pager", totalPages, DCM.page, n => { DCM.page = n; DCM.render(); });
  };

  // DCM Excel — dcm-deals/app.js 의 downloadExcel 과 동일(원본 데이터 형식: 2행 헤더 + 주관/인수 broker별 컬럼 + 그룹 병합).
  DCM.downloadExcel = function () {
    if (!DCM.grouped.length) { alert("다운로드할 데이터가 없습니다."); return; }

    const leadKnown = new Set(LEAD_ORDER);
    const uwKnown = new Set(UW_ORDER);
    const leadExtras = new Set();
    const uwExtras = new Set();
    for (const g of DCM.grouped) {
      for (const r of g.records) {
        for (const k of Object.keys(r.lead_amt || {})) if (!leadKnown.has(k)) leadExtras.add(k);
        for (const k of Object.keys(r.uw || {}))       if (!uwKnown.has(k))   uwExtras.add(k);
      }
    }
    const leadCols = [...LEAD_ORDER, ...leadExtras];
    const uwCols   = [...UW_ORDER,   ...uwExtras];

    const C_DISCLOSURE = 0;
    const C_DATE = 1, C_ISSUER = 2, C_SERIES = 3, C_TYPE = 4, C_RATING = 5,
          C_MATURITY = 6, C_INIT = 7, C_LIMIT = 8;
    const C_AMT_START = 9;
    const C_RATIO     = 12;
    const C_RATE_START = 13;
    const C_LEAD_START = 16;
    const C_UW_START   = C_LEAD_START + leadCols.length;
    const TOTAL_COLS   = C_UW_START + uwCols.length;

    const row1 = new Array(TOTAL_COLS).fill("");
    const row2 = new Array(TOTAL_COLS).fill("");
    row1[C_DISCLOSURE] = "최초공시일";
    row1[C_DATE]     = "청약일";
    row1[C_ISSUER]   = "발행사";
    row1[C_SERIES]   = "회차";
    row1[C_TYPE]     = "종류";
    row1[C_RATING]   = "신용등급";
    row1[C_MATURITY] = "만기일";
    row1[C_INIT]     = "최초모집(억)";
    row1[C_LIMIT]    = "발행한도(억)";
    row1[C_AMT_START] = "금액";
    row2[C_AMT_START]     = "수요예측(억)";
    row2[C_AMT_START + 1] = "최종발행(억)";
    row2[C_AMT_START + 2] = "회차합산(억)";
    row1[C_RATIO] = "경쟁률";
    row1[C_RATE_START] = "금리";
    row2[C_RATE_START]     = "희망";
    row2[C_RATE_START + 1] = "수요";
    row2[C_RATE_START + 2] = "최종(%)";
    row1[C_LEAD_START] = "주관";
    for (let i = 0; i < leadCols.length; i++) row2[C_LEAD_START + i] = leadCols[i];
    row1[C_UW_START] = "인수";
    for (let i = 0; i < uwCols.length; i++)   row2[C_UW_START + i]   = uwCols[i];

    const dataRows = [];
    const merges = [];
    let dataRowIdx = 2;

    for (const g of DCM.grouped) {
      const N = g.records.length;
      g.records.forEach((r, i) => {
        const isFirst = i === 0;
        const row = new Array(TOTAL_COLS).fill(null);
        row[C_DISCLOSURE] = isFirst ? r.disclosure_date : null;
        row[C_DATE]     = isFirst ? r.date : null;
        row[C_ISSUER]   = isFirst ? r.issuer : null;
        row[C_SERIES]   = r.series;
        row[C_TYPE]     = r.type;
        row[C_RATING]   = r.rating;
        row[C_MATURITY] = r.maturity;
        row[C_INIT]     = r.init;
        row[C_LIMIT]    = isFirst ? r.limit : null;
        row[C_AMT_START]     = r.demand;
        row[C_AMT_START + 1] = r.final;
        row[C_AMT_START + 2] = isFirst ? r.series_total : null;
        row[C_RATIO] = (r.demand && r.init)
          ? Number((r.demand / r.init).toFixed(2))
          : null;
        row[C_RATE_START]     = r.r_target;
        row[C_RATE_START + 1] = r.r_demand;
        row[C_RATE_START + 2] = r.r_final;
        const la = r.lead_amt || {};
        for (let j = 0; j < leadCols.length; j++) {
          const v = la[leadCols[j]];
          row[C_LEAD_START + j] = (v != null && v !== 0) ? v : null;
        }
        const uw = r.uw || {};
        for (let j = 0; j < uwCols.length; j++) {
          const v = uw[uwCols[j]];
          row[C_UW_START + j] = (v != null && v !== 0) ? v : null;
        }
        dataRows.push(row);
      });
      if (N > 1) {
        const startR = dataRowIdx;
        const endR = dataRowIdx + N - 1;
        for (const c of [C_DISCLOSURE, C_DATE, C_ISSUER, C_LIMIT, C_AMT_START + 2]) {
          merges.push({ s: { r: startR, c }, e: { r: endR, c } });
        }
      }
      dataRowIdx += N;
    }

    merges.push({ s: { r: 0, c: C_AMT_START },  e: { r: 0, c: C_AMT_START + 2 } });
    merges.push({ s: { r: 0, c: C_RATE_START }, e: { r: 0, c: C_RATE_START + 2 } });
    merges.push({ s: { r: 0, c: C_LEAD_START }, e: { r: 0, c: C_UW_START - 1 } });
    merges.push({ s: { r: 0, c: C_UW_START },   e: { r: 0, c: TOTAL_COLS - 1 } });
    for (const c of [C_DISCLOSURE, C_DATE, C_ISSUER, C_SERIES, C_TYPE, C_RATING, C_MATURITY,
                     C_INIT, C_LIMIT, C_RATIO]) {
      merges.push({ s: { r: 0, c }, e: { r: 1, c } });
    }

    const aoa = [row1, row2, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;

    const headerStyle = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: false },
      fill: { fgColor: { rgb: "F1F5F9" }, patternType: "solid" },
      border: {
        top:    { style: "thin", color: { rgb: "CBD5E1" } },
        bottom: { style: "thin", color: { rgb: "CBD5E1" } },
        left:   { style: "thin", color: { rgb: "CBD5E1" } },
        right:  { style: "thin", color: { rgb: "CBD5E1" } },
      },
    };
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < TOTAL_COLS; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].s = headerStyle;
      }
    }

    for (const m of merges) {
      if (m.s.r < 2) continue;
      const ref = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
      if (ws[ref]) {
        ws[ref].s = ws[ref].s || {};
        ws[ref].s.alignment = { vertical: "center" };
      }
    }

    const cols = new Array(TOTAL_COLS).fill({ wch: 6 });
    cols[C_DISCLOSURE] = { wch: 11 };
    cols[C_DATE]     = { wch: 11 };
    cols[C_ISSUER]   = { wch: 14 };
    cols[C_SERIES]   = { wch: 7 };
    cols[C_TYPE]     = { wch: 8 };
    cols[C_RATING]   = { wch: 8 };
    cols[C_MATURITY] = { wch: 11 };
    cols[C_INIT]     = { wch: 9 };
    cols[C_LIMIT]    = { wch: 9 };
    cols[C_AMT_START]     = { wch: 10 };
    cols[C_AMT_START + 1] = { wch: 10 };
    cols[C_AMT_START + 2] = { wch: 10 };
    cols[C_RATIO] = { wch: 7 };
    cols[C_RATE_START]     = { wch: 11 };
    cols[C_RATE_START + 1] = { wch: 8 };
    cols[C_RATE_START + 2] = { wch: 8 };
    ws["!cols"] = cols;

    ws["!rows"] = [{ hpt: 22 }, { hpt: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NumbersPool");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `NumbersPool_DCM_${today}.xlsx`);
  };

  // ════════════════════════════════════════════════════════════════════
  // ECM 섹션 — ecm-deals/app.js 핵심 로직 차용
  // ════════════════════════════════════════════════════════════════════
  const TOTAL_OPTS = [50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 50000];

  const ECM = {
    inited: false, DATA: { ipo:[], rights:[] }, META: null,
    tab: "ipo", page: 1,
    sort: { key:"date", dir:"desc" },
    issuers: new Set(), leads: new Set(), uws: new Set(),
    dateStart:"", dateEnd:"", cat:"", totalMin:0, totalMax:0,
    issuerSet: new Map(),
  };

  ECM.init = async function () {
    if (ECM.inited) return;
    ECM.inited = true;
    try {
      const [data, meta] = await Promise.all([
        NP_loadData("ecm_data.json"),
        NP_loadData("ecm_meta.json").catch(() => null),
      ]);
      ECM.DATA = data; ECM.META = meta;
    } catch (e) {
      console.error("ECM load error", e);
      $("e-empty").textContent = "데이터 로드 실패";
      $("e-empty").classList.remove("hidden");
      return;
    }
    ECM.populateCat(); ECM.populateLeads(); ECM.populateUws();
    ECM.populateIssuers(); ECM.populateTotals();
    ECM.applyDefaultRange();
    ECM.bindEvents();
    ECM.render();
  };

  // ECM 표 컬럼 정의 — 첫 컬럼이 [기사 쓰기]
  ECM.cols = function () {
    if (ECM.tab === "ipo") {
      return [
        {id:"_art", label:"기사", cell:r => writeBtnHtml(`ipo:${r._id}`), val:() => null, num:0, cls:"art-col"},
        {id:"disclosure_date", label:"최초 공시일", cell:r => esc(r.disclosure_date || "-"), val:r => r.disclosure_date},
        {id:"date", label:"상장일", cell:r => esc(r.date || "상장 예정"), val:r => r.date},
        {id:"issuer", label:"발행사", cell:r => r.rcept
          ? `<a class="dart-link" href="#" data-rcept="${esc(r.rcept)}">${esc(r.issuer)}</a>` : esc(r.issuer), val:r => r.issuer},
        {id:"market", label:"시장", cell:r => esc(r.market), val:r => r.market},
        {id:"qty", label:"발행 수량(만주)", num:1, cell:r => fmtManN(r.final_qty ?? r.init_qty), val:r => r.final_qty ?? r.init_qty},
        {id:"price", label:"1주당 모집 가액(원)", num:1, cell:r => fmtN(r.final_price ?? r.init_price), val:r => r.final_price ?? r.init_price},
        {id:"total", label:"발행 총액(억원)", num:1, cell:r => fmtN(r.final_total ?? r.init_total), val:r => r.final_total ?? r.init_total},
        {id:"new_ratio", label:"신주 비율(%)", num:1, cell:r => fmtPctN(r.new_ratio), val:r => r.new_ratio},
        {id:"ic", label:"기관 경쟁률(배)", num:1, cell:r => fmtN(r.inst && r.inst.compete), val:r => (r.inst && r.inst.compete) || 0},
        {id:"gc", label:"일반 경쟁률(배)", num:1, cell:r => fmtN(r.general && r.general.compete), val:r => (r.general && r.general.compete) || 0},
        {id:"ec", label:"우리사주 청약률(%)", num:1, cell:r => fmtPctN(r.esop && r.esop.rate), val:r => (r.esop && r.esop.rate) || 0},
        {id:"leads", label:"주관사", cell:r => esc(Object.keys(r.leads||{}).join(", ")) || "-"},
        {id:"uw", label:"인수사", cell:r => esc(Object.keys(r.uw||{}).join(", ")) || "-"},
      ];
    }
    return [
      {id:"_art", label:"기사", cell:r => writeBtnHtml(`rights:${r._id}`), val:() => null, num:0, cls:"art-col"},
      {id:"disclosure_date", label:"최초 공시일", cell:r => esc(r.disclosure_date || "-"), val:r => r.disclosure_date},
      {id:"date", label:"신주배정기준일", cell:r => esc(r.date || "미정"), val:r => r.date},
      {id:"issuer", label:"발행사", cell:r => r.rcept
        ? `<a class="dart-link" href="#" data-rcept="${esc(r.rcept)}">${esc(r.issuer)}</a>` : esc(r.issuer), val:r => r.issuer},
      {id:"type", label:"유형", cell:r => esc(r.type), val:r => r.type},
      {id:"payment", label:"납입일", cell:r => esc(r.payment || "-"), val:r => r.payment},
      {id:"new_qty", label:"발행 수량(만주)", num:1, cell:r => fmtManN(r.new_qty), val:r => r.new_qty},
      {id:"increase_ratio", label:"증자 비율(%)", num:1, cell:r => fmtPctN(ratioOf(r)), val:r => ratioOf(r)},
      {id:"init_price", label:"1주당 희망 가액(원)", num:1, cell:r => fmtN(r.init_price), val:r => r.init_price},
      {id:"price_1", label:"1차 가액(원)", num:1, cell:r => fmtN(r.price_1), val:r => r.price_1},
      {id:"price_2", label:"2차 가액(원)", num:1, cell:r => fmtN(r.price_2), val:r => r.price_2},
      {id:"final_price", label:"최종 가액(원)", num:1, cell:r => fmtN(r.final_price), val:r => r.final_price},
      {id:"final_total", label:"발행 총액(억원)", num:1,
        cell:r => fmtN(r.final_total ?? r.total_1 ?? r.init_total),
        val:r => r.final_total ?? r.total_1 ?? r.init_total},
      {id:"leads", label:"주관사", cell:r => esc(Object.keys(r.leads||{}).join(", ")) || "-"},
      {id:"uw", label:"인수사", cell:r => esc(Object.keys(r.uw||{}).join(", ")) || "-"},
    ];
  };

  ECM.filtered = function () {
    const arr = (ECM.DATA[ECM.tab] || []);
    const cf = ECM.tab === "ipo" ? "market" : "type";
    let out = arr.filter(r => {
      if ((ECM.dateStart || ECM.dateEnd) && r.date) {
        if (ECM.dateStart && r.date < ECM.dateStart) return false;
        if (ECM.dateEnd && r.date > ECM.dateEnd) return false;
      }
      if (ECM.issuers.size && !ECM.issuers.has(r.issuer)) return false;
      if (ECM.cat && (r[cf] || "") !== ECM.cat) return false;
      if (ECM.totalMin || ECM.totalMax) {
        const t = r.final_total ?? r.total_1 ?? r.init_total;
        if (t == null) return false;
        if (ECM.totalMin && t < ECM.totalMin) return false;
        if (ECM.totalMax && t > ECM.totalMax) return false;
      }
      if (ECM.leads.size) {
        const lk = Object.keys(r.leads || {});
        if (![...ECM.leads].some(b => lk.includes(b))) return false;
      }
      if (ECM.uws.size) {
        const uk = Object.keys(r.uw || {});
        if (![...ECM.uws].some(b => uk.includes(b))) return false;
      }
      return true;
    });
    const cols = ECM.cols();
    const col = cols.find(c => c.id === ECM.sort.key) || cols[1];
    const sgn = ECM.sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      let x = col.val ? col.val(a) : "", y = col.val ? col.val(b) : "";
      if (typeof x === "number" || typeof y === "number") {
        x = typeof x === "number" ? x : -Infinity; y = typeof y === "number" ? y : -Infinity;
        return (x - y) * sgn;
      }
      const xs = String(x || ""), ys = String(y || "");
      if (col.id === "date" && (xs === "" || ys === "")) {
        if (xs === "" && ys === "") return 0;
        return (xs === "" ? 1 : -1) * sgn;
      }
      return xs.localeCompare(ys) * sgn;
    });
    return out;
  };

  ECM.render = function () {
    const cols = ECM.cols();
    $("e-ghead").innerHTML = "<tr>" + cols.map(c => {
      const sortCls = ECM.sort.key === c.id ? (ECM.sort.dir === "asc" ? "sorted-asc" : "sorted-desc") : "";
      const cls = [c.num ? "num" : "", c.cls || "", sortCls].filter(Boolean).join(" ");
      const sortable = c.id !== "_art" && c.id !== "leads" && c.id !== "uw";
      return `<th${sortable ? ` data-col="${c.id}"` : ""}${cls ? ` class="${cls}"` : ""}>${esc(c.label)}</th>`;
    }).join("") + "</tr>";
    $("e-ghead").querySelectorAll("th[data-col]").forEach(th =>
      th.addEventListener("click", () => {
        const k = th.dataset.col;
        if (ECM.sort.key === k) ECM.sort.dir = ECM.sort.dir === "asc" ? "desc" : "asc";
        else ECM.sort = { key:k, dir:(k === "date" || k === "disclosure_date") ? "desc" : "asc" };
        ECM.render();
      }));

    const list = ECM.filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (ECM.page > pages) ECM.page = pages;
    const slice = list.slice((ECM.page - 1) * PAGE_SIZE, ECM.page * PAGE_SIZE);
    // 행마다 안정적 id 부여 (모달 → 데이터 lookup 용)
    slice.forEach((r, i) => { if (r._id == null) r._id = `${ECM.tab}-${(ECM.page-1)*PAGE_SIZE+i}-${r.issuer || ""}-${r.date || ""}`; });
    ECM.lastList = list;  // 모달 lookup 용
    $("e-rows").innerHTML = slice.map(r =>
      "<tr>" + cols.map(c => {
        const clsA = (c.num ? "num" : "") + (c.cls ? ` ${c.cls}` : "");
        return `<td${clsA ? ` class="${clsA.trim()}"` : ""}>${c.cell(r)}</td>`;
      }).join("") + "</tr>"
    ).join("");
    $("e-empty").classList.toggle("hidden", list.length > 0);
    $("e-result-count").innerHTML = `<strong>${list.length.toLocaleString()}</strong>건`;
    renderPager("e-pager", pages, ECM.page, n => { ECM.page = n; ECM.render(); });
    document.querySelectorAll(".ecm-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === ECM.tab));
  };

  ECM.populateCat = function () {
    const arr = ECM.DATA[ECM.tab] || [];
    const field = ECM.tab === "ipo" ? "market" : "type";
    const vals = [...new Set(arr.map(r => r[field]).filter(Boolean))].sort();
    $("e-cat-name").textContent = ECM.tab === "ipo" ? "시장" : "유형";
    $("e-f-cat").innerHTML = `<option value="">전체</option>` + vals.map(v => `<option>${esc(v)}</option>`).join("");
    ECM.cat = "";
  };
  ECM.populateLeads = function () {
    const arr = ECM.DATA[ECM.tab] || [];
    const s = new Set();
    arr.forEach(r => Object.keys(r.leads || {}).forEach(a => s.add(a)));
    $("e-f-lead").innerHTML = `<option value="">추가…</option>` +
      [...s].sort().map(a => `<option value="${esc(a)}">${esc(BROKER_FULL[a] || a)}</option>`).join("");
  };
  ECM.populateUws = function () {
    const arr = ECM.DATA[ECM.tab] || [];
    const s = new Set();
    arr.forEach(r => Object.keys(r.uw || {}).forEach(a => s.add(a)));
    $("e-f-uw").innerHTML = `<option value="">추가…</option>` +
      [...s].sort().map(a => `<option value="${esc(a)}">${esc(BROKER_FULL[a] || a)}</option>`).join("");
  };
  ECM.populateIssuers = function () {
    const arr = ECM.DATA[ECM.tab] || [];
    const names = [...new Set(arr.map(r => r.issuer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    ECM.issuerSet = new Map(names.map(n => [n.toLowerCase(), n]));
    const dl = $("e-issuers-datalist");
    if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join("");
  };
  ECM.populateTotals = function () {
    const opt = v => `<option value="${v}">${v.toLocaleString()}</option>`;
    $("e-f-total-min").innerHTML = `<option value="">하한 없음</option>` + TOTAL_OPTS.map(opt).join("");
    $("e-f-total-max").innerHTML = `<option value="">상한 없음</option>` + TOTAL_OPTS.map(opt).join("");
  };
  ECM.dateRange = function () {
    const ds = (ECM.DATA[ECM.tab] || []).map(r => r.date).filter(Boolean);
    if (!ds.length) return { min:"", max:"" };
    return { min:ds.reduce((a, b) => b < a ? b : a), max:ds.reduce((a, b) => b > a ? b : a) };
  };
  ECM.setPresetActive = function (p) {
    document.querySelectorAll("[data-e-preset]").forEach(b => b.classList.toggle("active", b.dataset.ePreset === p));
  };
  ECM.applyDefaultRange = function () {
    const { max } = ECM.dateRange();
    if (max) {
      const s = new Date(max); s.setFullYear(s.getFullYear() - 1); s.setDate(s.getDate() + 1);
      $("e-f-date-start").value = s.toISOString().slice(0, 10); $("e-f-date-end").value = max;
    } else { $("e-f-date-start").value = ""; $("e-f-date-end").value = ""; }
    ECM.dateStart = $("e-f-date-start").value; ECM.dateEnd = $("e-f-date-end").value; ECM.page = 1;
    ECM.setPresetActive("1y");
  };
  ECM.applyFilters = function () {
    ECM.dateStart = $("e-f-date-start").value || ""; ECM.dateEnd = $("e-f-date-end").value || "";
    ECM.cat = $("e-f-cat").value || "";
    ECM.totalMin = +($("e-f-total-min").value || 0); ECM.totalMax = +($("e-f-total-max").value || 0);
    ECM.page = 1; ECM.render();
  };
  ECM.switchTab = function (t) {
    if (t === ECM.tab) return;
    ECM.tab = t; ECM.page = 1; ECM.sort = { key:"date", dir:"desc" };
    ECM.leads.clear(); ECM.uws.clear(); ECM.issuers.clear();
    $("e-f-lead-chips").innerHTML = ""; $("e-f-uw-chips").innerHTML = ""; $("e-f-issuer-chips").innerHTML = "";
    $("e-date-basis").textContent = t === "ipo" ? "상장일" : "신주배정기준일";
    $("e-f-total-min").value = ""; $("e-f-total-max").value = ""; ECM.totalMin = ECM.totalMax = 0;
    ECM.populateCat(); ECM.populateLeads(); ECM.populateUws(); ECM.populateIssuers(); ECM.applyDefaultRange();
    ECM.render();
  };

  ECM.bindEvents = function () {
    document.querySelectorAll(".ecm-tab").forEach(t =>
      t.addEventListener("click", () => ECM.switchTab(t.dataset.tab)));
    $("e-rows").addEventListener("click", (e) => {
      const link = e.target.closest("a.dart-link");
      if (link) { e.preventDefault(); const r = link.dataset.rcept;
        if (r) window.open(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r}`, "dart-viewer", "width=1100,height=800");
        return; }
      const wb = e.target.closest(".art-btn-write");
      if (wb) {
        e.preventDefault();
        const key = wb.dataset.key;  // 'ipo:_id' / 'rights:_id'
        const rec = (ECM.lastList || []).find(r => `${ECM.tab}:${r._id}` === key);
        if (rec) openArticleModal(ECM.tab, rec);
      }
    });

    function commitIssuer(silent) {
      const v = $("e-f-issuer").value.trim(); if (!v) return false;
      const canon = ECM.issuerSet.get(v.toLowerCase());
      if (!canon) { if (!silent) alert(`'${v}' 발행사를 찾을 수 없습니다.`); return false; }
      if (ECM.issuers.size >= 10 || ECM.issuers.has(canon)) { $("e-f-issuer").value = ""; return false; }
      ECM.issuers.add(canon);
      renderChips("e-f-issuer-chips", [...ECM.issuers], (v) => { ECM.issuers.delete(v); });
      $("e-f-issuer").value = ""; return true;
    }
    $("e-f-issuer").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commitIssuer(false); }
    });
    $("e-f-lead").addEventListener("change", e => {
      const v = e.target.value; if (v && ECM.leads.size < 5) {
        ECM.leads.add(v);
        renderChips("e-f-lead-chips", [...ECM.leads], (val) => { ECM.leads.delete(val); }, BROKER_FULL);
      } e.target.value = "";
    });
    $("e-f-uw").addEventListener("change", e => {
      const v = e.target.value; if (v && ECM.uws.size < 5) {
        ECM.uws.add(v);
        renderChips("e-f-uw-chips", [...ECM.uws], (val) => { ECM.uws.delete(val); }, BROKER_FULL);
      } e.target.value = "";
    });
    document.querySelectorAll("[data-e-preset]").forEach(b =>
      b.addEventListener("click", () => {
        const p = b.dataset.ePreset; ECM.setPresetActive(p);
        const { min, max } = ECM.dateRange();
        if (p === "all") { $("e-f-date-start").value = min || ""; $("e-f-date-end").value = max || ""; return; }
        if (!max) return;
        const s = new Date(max);
        if (p === "3m") s.setMonth(s.getMonth() - 3);
        else if (p === "6m") s.setMonth(s.getMonth() - 6);
        else if (p === "1y") s.setFullYear(s.getFullYear() - 1);
        s.setDate(s.getDate() + 1);
        $("e-f-date-end").value = max;
        $("e-f-date-start").value = s.toISOString().slice(0, 10);
      }));
    ["e-f-date-start", "e-f-date-end"].forEach(id =>
      $(id).addEventListener("change", () => ECM.setPresetActive(null)));
    $("e-btn-search").addEventListener("click", () => {
      const btn = $("e-btn-search"); const orig = btn.innerHTML;
      if (btn.dataset.busy) return;
      btn.dataset.busy = "1"; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>조회 중';
      setTimeout(() => { commitIssuer(true); ECM.applyFilters(); btn.disabled = false; btn.innerHTML = orig; delete btn.dataset.busy; }, 250);
    });
    $("e-btn-reset").addEventListener("click", () => {
      ECM.issuers.clear(); ECM.leads.clear(); ECM.uws.clear();
      $("e-f-issuer-chips").innerHTML = ""; $("e-f-lead-chips").innerHTML = ""; $("e-f-uw-chips").innerHTML = "";
      $("e-f-issuer").value = ""; $("e-f-cat").value = ""; ECM.cat = "";
      $("e-f-total-min").value = ""; $("e-f-total-max").value = ""; ECM.totalMin = ECM.totalMax = 0;
      ECM.applyDefaultRange(); ECM.render();
    });
    $("e-btn-download").addEventListener("click", ECM.downloadExcel);
  };

  ECM.downloadExcel = function () {
    const list = ECM.filtered();
    if (!list.length) { alert("다운로드할 데이터가 없습니다."); return; }
    if (ECM.tab === "ipo") ecmDownloadIpoFull(list);
    else ecmDownloadRightsFull(list);
  };

  // 유상증자 — ecm-deals/app.js 의 downloadRightsFull 과 동일(원본 ECM Table.xlsx 형태: 2행 헤더 + 최초/1차/2차/최종 + 주관/인수 broker별 컬럼)
  function ecmDownloadRightsFull(list) {
    const leadOrder = (ECM.META && ECM.META.lead_order) || [];
    const uwOrder   = (ECM.META && ECM.META.uw_order)   || [];
    const lKnown = new Set(leadOrder), uKnown = new Set(uwOrder);
    const lExtra = new Set(), uExtra = new Set();
    for (const r of list) {
      for (const k of Object.keys(r.leads||{})) if (!lKnown.has(k)) lExtra.add(k);
      for (const k of Object.keys(r.uw||{}))    if (!uKnown.has(k)) uExtra.add(k);
    }
    const LEAD = [...leadOrder, ...lExtra], UW = [...uwOrder, ...uExtra];
    const L0 = 17, U0 = L0 + LEAD.length, TOTAL = U0 + UW.length;

    const row1 = new Array(TOTAL).fill(""), row2 = new Array(TOTAL).fill("");
    row1[0]="최초 공시일"; row1[1]="신주배정기준일"; row1[2]="회사명"; row1[3]="구분"; row1[4]="납입일";
    row1[5]="발행 수량"; row1[6]="기존 주식"; row1[7]="증자비율";
    row1[8]="최초 희망 발행"; row2[8]="수량"; row2[9]="가액(원)"; row2[10]="총액(억)";
    row1[11]="1차"; row2[11]="가액(원)"; row2[12]="총액(억)";
    row1[13]="2차"; row2[13]="가액(원)"; row2[14]="총액(억)";
    row1[15]="최종"; row2[15]="가액(원)"; row2[16]="총액(억)";
    row1[L0]="주관"; LEAD.forEach((b,i)=>row2[L0+i]=b);
    row1[U0]="인수"; UW.forEach((b,i)=>row2[U0+i]=b);

    const dataRows = list.map(r => {
      const a = new Array(TOTAL).fill(null);
      const la=r.leads||{}, uwm=r.uw||{};
      a[0]=r.disclosure_date||""; a[1]=r.date||""; a[2]=r.issuer; a[3]=r.type; a[4]=r.payment||"";
      a[5]=r.new_qty; a[6]=r.existing_qty; a[7]=ratioOf(r);
      a[8]=r.init_qty; a[9]=r.init_price; a[10]=r.init_total;
      a[11]=r.price_1; a[12]=r.total_1;
      a[13]=r.price_2; a[14]=r.total_2;
      a[15]=r.final_price; a[16]=r.final_total;
      LEAD.forEach((b,i)=>{ const v=la[b]; if (v) a[L0+i]=v; });
      UW.forEach((b,i)=>{ const v=uwm[b]; if (v) a[U0+i]=v; });
      return a;
    });

    const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...dataRows]);

    const merges = [];
    const grp=(c0,c1)=>merges.push({s:{r:0,c:c0},e:{r:0,c:c1}});
    grp(8,10); grp(11,12); grp(13,14); grp(15,16); grp(L0,U0-1); grp(U0,TOTAL-1);
    [0,1,2,3,4,5,6,7].forEach(c=>merges.push({s:{r:0,c},e:{r:1,c}}));
    ws["!merges"]=merges;

    const hs = { font:{bold:true}, alignment:{horizontal:"center",vertical:"center"},
      fill:{fgColor:{rgb:"F1F5F9"},patternType:"solid"},
      border:{top:{style:"thin",color:{rgb:"CBD5E1"}},bottom:{style:"thin",color:{rgb:"CBD5E1"}},
              left:{style:"thin",color:{rgb:"CBD5E1"}},right:{style:"thin",color:{rgb:"CBD5E1"}}} };
    for (let c=0;c<TOTAL;c++) for (let r=0;r<2;r++){ const ref=XLSX.utils.encode_cell({r,c}); if(ws[ref]) ws[ref].s=hs; }

    for (let i=0;i<dataRows.length;i++){ const r=i+2; const ref=XLSX.utils.encode_cell({r,c:7}); if(ws[ref]&&typeof ws[ref].v==="number") ws[ref].z="0.0%"; }

    const cw=new Array(TOTAL).fill({wch:6});
    cw[0]={wch:13}; cw[1]={wch:13}; cw[2]={wch:16}; cw[3]={wch:18}; cw[4]={wch:11};
    [5,6,8,9,10,11,12,13,14,15,16].forEach(c=>cw[c]={wch:11}); cw[7]={wch:8};
    ws["!cols"]=cw; ws["!rows"]=[{hpt:20},{hpt:18}];

    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "유상증자");
    XLSX.writeFile(wb, `NumbersPool_ECM_유상증자_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // IPO — ecm-deals/app.js 의 downloadIpoFull 과 동일(원본 ECM Table.xlsx 형태: 2행 헤더 + 최초/최종/청약 세부 + 주관/인수 broker별 컬럼)
  function ecmDownloadIpoFull(list) {
    const leadOrder = (ECM.META && ECM.META.lead_order) || [];
    const uwOrder   = (ECM.META && ECM.META.uw_order)   || [];
    const lKnown = new Set(leadOrder), uKnown = new Set(uwOrder);
    const lExtra = new Set(), uExtra = new Set();
    for (const r of list) {
      for (const k of Object.keys(r.leads||{})) if (!lKnown.has(k)) lExtra.add(k);
      for (const k of Object.keys(r.uw||{}))    if (!uKnown.has(k)) uExtra.add(k);
    }
    const LEAD = [...leadOrder, ...lExtra], UW = [...uwOrder, ...uExtra];
    const L0 = 23, U0 = L0 + LEAD.length, TOTAL = U0 + UW.length;

    const row1 = new Array(TOTAL).fill(""), row2 = new Array(TOTAL).fill("");
    row1[0]="최초 공시일"; row1[1]="상장일"; row1[2]="회사명"; row1[3]="시장";
    row1[4]="최초 희망 발행"; row2[4]="수량"; row2[5]="가액(원)"; row2[6]="총액(억)";
    row1[7]="최종 확정 발행"; row2[7]="수량"; row2[8]="가액(원)"; row2[9]="총액(억)";
    row1[10]="발행 방식"; row2[10]="신주비율"; row2[11]="구주비율";
    row1[12]="기관"; row2[12]="최초배정"; row2[13]="청약"; row2[14]="경쟁률"; row2[15]="최종배정";
    row1[16]="일반"; row2[16]="최초배정"; row2[17]="청약"; row2[18]="경쟁률"; row2[19]="최종배정";
    row1[20]="우리사주"; row2[20]="최초배정"; row2[21]="최종배정"; row2[22]="청약률";
    row1[L0]="주관"; LEAD.forEach((b,i)=>row2[L0+i]=b);
    row1[U0]="인수"; UW.forEach((b,i)=>row2[U0+i]=b);

    const dataRows = list.map(r => {
      const a = new Array(TOTAL).fill(null);
      const ins=r.inst||{}, gen=r.general||{}, es=r.esop||{}, la=r.leads||{}, uwm=r.uw||{};
      a[0]=r.disclosure_date||""; a[1]=r.date||""; a[2]=r.issuer; a[3]=r.market;
      a[4]=r.init_qty; a[5]=r.init_price; a[6]=r.init_total;
      a[7]=r.final_qty; a[8]=r.final_price; a[9]=r.final_total;
      a[10]=r.new_ratio; a[11]=r.old_ratio;
      a[12]=ins.initial; a[13]=ins.subscribed; a[14]=ins.compete; a[15]=ins.final;
      a[16]=gen.initial; a[17]=gen.subscribed; a[18]=gen.compete; a[19]=gen.final;
      a[20]=es.initial; a[21]=es.final; a[22]=es.rate;
      LEAD.forEach((b,i)=>{ const v=la[b]; if (v) a[L0+i]=v; });
      UW.forEach((b,i)=>{ const v=uwm[b]; if (v) a[U0+i]=v; });
      return a;
    });

    const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...dataRows]);

    const merges = [];
    const grp=(c0,c1)=>merges.push({s:{r:0,c:c0},e:{r:0,c:c1}});
    grp(4,6); grp(7,9); grp(10,11); grp(12,15); grp(16,19); grp(20,22); grp(L0,U0-1); grp(U0,TOTAL-1);
    [0,1,2,3].forEach(c=>merges.push({s:{r:0,c},e:{r:1,c}}));
    ws["!merges"]=merges;

    const hs = { font:{bold:true}, alignment:{horizontal:"center",vertical:"center"},
      fill:{fgColor:{rgb:"F1F5F9"},patternType:"solid"},
      border:{top:{style:"thin",color:{rgb:"CBD5E1"}},bottom:{style:"thin",color:{rgb:"CBD5E1"}},
              left:{style:"thin",color:{rgb:"CBD5E1"}},right:{style:"thin",color:{rgb:"CBD5E1"}}} };
    for (let c=0;c<TOTAL;c++) for (let r=0;r<2;r++){ const ref=XLSX.utils.encode_cell({r,c}); if(ws[ref]) ws[ref].s=hs; }

    for (let i=0;i<dataRows.length;i++){ const r=i+2;
      [10,11,22].forEach(c=>{ const ref=XLSX.utils.encode_cell({r,c}); if(ws[ref]&&typeof ws[ref].v==="number") ws[ref].z="0.0%"; });
    }

    const cw=new Array(TOTAL).fill({wch:6});
    cw[0]={wch:13}; cw[1]={wch:11}; cw[2]={wch:16}; cw[3]={wch:7};
    [4,5,6,7,8,9,12,13,14,15,16,17,18,19,20,21,22].forEach(c=>cw[c]={wch:11});
    [10,11].forEach(c=>cw[c]={wch:8});
    ws["!cols"]=cw; ws["!rows"]=[{hpt:20},{hpt:18}];

    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IPO");
    XLSX.writeFile(wb, `NumbersPool_ECM_IPO_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 기사 모달 — Edge Function (generate-article) 연동
  // ════════════════════════════════════════════════════════════════════
  let currentArticleCtx = null;  // { kind, data }

  function writeBtnHtml(key) {
    return `<button class="art-btn-write" data-key="${esc(key)}" title="기사 초안 생성">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
      기사 쓰기
    </button>`;
  }

  function openArticleModal(kind, data) {
    currentArticleCtx = { kind, data };
    const modal = $("art-modal");
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // 메타 라인
    let title = "기사 초안";
    let metaHtml = "";
    if (kind === "dcm") {
      // data 는 { key, records, rep } — 회차 그룹
      const rep = data.rep;
      const seriesBase = (rep.series || "").split("-")[0];
      title = `${rep.issuer} ${seriesBase}회차 회사채`;
      const totalFinal = data.records.reduce((s, r) => s + (r.final || 0), 0);
      metaHtml = `<strong>${esc(rep.issuer)}</strong>` +
        `<span class="sep">·</span>${seriesBase}회차 (${data.records.length}개 트랜치)` +
        `<span class="sep">·</span>청약 ${esc(rep.date || "")}` +
        `<span class="sep">·</span>최종 ${fmtBig(totalFinal)}`;
    } else if (kind === "ipo") {
      title = `${data.issuer} IPO`;
      metaHtml = `<strong>${esc(data.issuer)}</strong>` +
        `<span class="sep">·</span>${esc(data.market || "")}` +
        `<span class="sep">·</span>${esc(data.date ? `상장 ${data.date}` : "상장 예정")}` +
        `<span class="sep">·</span>${fmtBig(data.final_total ?? data.init_total)}`;
    } else if (kind === "rights") {
      title = `${data.issuer} 유상증자`;
      metaHtml = `<strong>${esc(data.issuer)}</strong>` +
        `<span class="sep">·</span>${esc(data.type || "")}` +
        `<span class="sep">·</span>${esc(data.date ? `기준일 ${data.date}` : "기준일 미정")}` +
        `<span class="sep">·</span>${fmtBig(data.final_total ?? data.total_1 ?? data.init_total)}`;
    }
    $("art-modal-title").textContent = title;
    $("art-modal-meta").innerHTML = metaHtml;
    $("art-modal-body").innerHTML = `<div class="art-loading"><span class="spinner"></span> 기사 생성 중…</div>`;
    $("art-btn-copy").classList.remove("art-btn-copied");
    $("art-btn-copy").textContent = "복사";

    generateArticle();
  }
  function closeArticleModal() {
    $("art-modal").hidden = true;
    document.body.style.overflow = "";
    currentArticleCtx = null;
  }
  $("art-modal-close").addEventListener("click", closeArticleModal);
  $("art-modal").addEventListener("click", (e) => {
    if (e.target.classList.contains("art-modal-back")) closeArticleModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("art-modal").hidden) closeArticleModal();
  });

  $("art-btn-regen").addEventListener("click", () => {
    if (!currentArticleCtx) return;
    $("art-modal-body").innerHTML = `<div class="art-loading"><span class="spinner"></span> 기사 생성 중…</div>`;
    generateArticle();
  });

  $("art-btn-copy").addEventListener("click", () => {
    const text = $("art-modal-body").innerText.trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const b = $("art-btn-copy"); b.textContent = "✓ 복사됨"; b.classList.add("art-btn-copied");
      setTimeout(() => { b.textContent = "복사"; b.classList.remove("art-btn-copied"); }, 1800);
    }).catch(() => alert("복사 실패 — 직접 선택해 복사해주세요."));
  });

  async function generateArticle() {
    if (!currentArticleCtx) return;
    const { kind, data } = currentArticleCtx;

    // ⚠ Phase 1a: Edge Function 미배포 상태 — placeholder 로 표시.
    // Phase 1b 에서 Supabase Edge Function 'generate-article' 호출로 교체.
    try {
      const sess = await window.sb.auth.getSession();
      const token = sess.data && sess.data.session && sess.data.session.access_token;
      if (!token) throw new Error("로그인 세션을 확인할 수 없습니다.");

      const payload = buildArticlePayload(kind, data);
      const url = `${window.NP_SUPABASE_URL || ""}/functions/v1/generate-article`;

      // Edge Function 호출 시도
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        // 서버가 내려준 메시지를 우선 사용 (일일 한도 / 일시적 혼잡 구분)
        let serverMsg = "";
        try { serverMsg = (JSON.parse(txt) || {}).error || ""; } catch (_) {}
        if (resp.status === 404) {
          throw new Error("기사 생성 기능이 아직 활성화되지 않았습니다. (관리자에게 문의)");
        }
        if (resp.status === 429) {
          throw new Error(serverMsg || "지금 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.");
        }
        throw new Error(serverMsg || `기사 생성 실패 (${resp.status}): ${txt.slice(0, 200)}`);
      }
      const json = await resp.json();
      const article = json.article || "";
      const headline = json.headline || "";
      renderArticle(headline, article);
    } catch (e) {
      $("art-modal-body").innerHTML =
        `<div class="art-error">${esc(e.message || String(e))}</div>`;
    }
  }

  function renderArticle(headline, body) {
    const html = (headline ? `<div class="art-headline">${esc(headline)}</div>` : "") +
      body.split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join("");
    $("art-modal-body").innerHTML = html;
  }

  // ── 만기 연수 계산 — 청약일과 만기일의 차이 (0.5년 단위 반올림). 회차번호 대신 N년물 표기용. ──
  function maturityYears(subDate, maturityDate) {
    if (!subDate || !maturityDate) return null;
    const s = new Date(String(subDate).slice(0, 10));
    const m = new Date(String(maturityDate).slice(0, 10));
    if (isNaN(s.getTime()) || isNaN(m.getTime())) return null;
    const years = (m - s) / (1000 * 60 * 60 * 24 * 365.25);
    if (years <= 0) return null;
    const half = Math.round(years * 2) / 2;
    return half;  // 1, 1.5, 2, 3, 5 등
  }

  // ── 같은 발행사의 직전 발행 1~2건 (DCM) ── 회차그룹 단위, 청약일 desc 최대 2개
  function dcmHistory(rep) {
    if (!rep || !rep.issuer || !rep.date) return [];
    const same = (DCM.DATA || []).filter(r =>
      r.issuer === rep.issuer && r.date && r.date < rep.date);
    const map = new Map();
    for (const r of same) {
      const k = dGroupKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    const groups = [];
    for (const recs of map.values()) {
      recs.sort((a, b) => dCompareSeries(a.series, b.series));
      const reps = recs[0];
      groups.push({
        청약일: reps.date,
        신용등급: reps.rating,
        종류: reps.type,
        회차합산_억: recs.reduce((s, r) => s + (r.final || 0), 0),
        tranches: recs.map(r => ({
          만기연수: maturityYears(r.date, r.maturity),
          최초모집_억: r.init,
          수요예측_억: r.demand,
          최종발행_억: r.final,
          최종금리: r.r_final,
        })),
      });
    }
    groups.sort((a, b) => b.청약일.localeCompare(a.청약일));
    return groups.slice(0, 2);  // 직전 2건까지
  }

  // ── 같은 발행사의 직전 ECM 발행 (탭별로) — IPO는 거의 없음, 유증은 종종 있음 ──
  function ecmHistory(kind, cur) {
    if (!cur || !cur.issuer) return [];
    const arr = (ECM.DATA && ECM.DATA[kind]) || [];
    const curDate = cur.date || cur.disclosure_date || "";
    const past = arr
      .filter(r => r !== cur && r.issuer === cur.issuer && (r.date || r.disclosure_date) && (r.date || r.disclosure_date) < curDate)
      .sort((a, b) => (b.date || b.disclosure_date).localeCompare(a.date || a.disclosure_date))
      .slice(0, 2);
    if (kind === "ipo") {
      return past.map(r => ({
        상장일: r.date || null, 최초공시일: r.disclosure_date || null,
        시장: r.market,
        최종_가액_원: r.final_price, 최종_총액_억: r.final_total,
        기관경쟁률: r.inst && r.inst.compete, 일반경쟁률: r.general && r.general.compete,
      }));
    }
    return past.map(r => ({
      신주배정기준일: r.date || null, 최초공시일: r.disclosure_date || null,
      유형: r.type, 신주_수량: r.new_qty, 증자비율: ratioPctStr(r.new_qty, r.existing_qty, r.increase_ratio),
      확정가_원: r.final_price, 확정총액_억: r.final_total,
    }));
  }

  // 오늘 날짜 (KST) — 기사 본문 첫 도입부의 "N일 금감원..." 또는 "...공시했다"에 사용
  function todayKST() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    } catch (e) {
      // fallback — UTC 보정
      const d = new Date(Date.now() + 9 * 3600 * 1000);
      return d.toISOString().slice(0, 10);
    }
  }

  // 시제 판단 — 기준일이 오늘 이전이면 과거("발행했다"), 이후면 미래("발행한다")
  function tense(refDate, today) {
    if (!refDate) return "미래";  // 미정 = 진행 중 = 미래로 취급
    return (String(refDate).slice(0, 10) <= today) ? "과거" : "미래";
  }

  // Edge Function 으로 보낼 페이로드 정리 — 모델이 사실 데이터만 보게 정형화
  // 회차번호(series)는 본문에 쓰면 안 되므로 payload 에 노출하지 않음 — 대신 만기연수 제공.
  function buildArticlePayload(kind, data) {
    const today = todayKST();
    if (kind === "dcm") {
      const rep = data.rep;
      // 트랜치마다 같은 값이 중복돼 모델이 "트랜치별 한도"로 오인할 수 있는 발행한도·신용등급·종류는
      // rep 레벨로만 노출 (트랜치에서 제거).
      const tranches = data.records.map(r => ({
        만기연수: maturityYears(r.date, r.maturity),
        만기일: r.maturity,
        최초모집_억: r.init,
        수요예측_억: r.demand,
        경쟁률: (r.demand && r.init) ? Math.round(r.demand / r.init * 100) / 100 : null,
        최종발행_억: r.final,
        증액_억: (r.final != null && r.init != null) ? Math.round((r.final - r.init) * 100) / 100 : null,
        희망금리: r.r_target, 수요금리: r.r_demand, 최종금리: r.r_final,
      }));
      // 회차 전체 합산: 주관사별 주관실적(산식 분배) + 인수사별 인수량
      const 주관실적_분배_억 = {};
      const 인수량_별_억 = {};
      for (const r of data.records) {
        for (const [a, v] of Object.entries(r.lead_amt || {})) {
          주관실적_분배_억[a] = Math.round(((주관실적_분배_억[a] || 0) + (v || 0)) * 100) / 100;
        }
        for (const [a, v] of Object.entries(r.uw || {})) {
          인수량_별_억[a] = (인수량_별_억[a] || 0) + (v || 0);
        }
      }
      const 주관사_명단 = [...new Set(data.records.flatMap(r => r.leads || []))];
      // 회차 합산 — 최종발행액(수요예측 후 확정)이 아직 없으면 증액/감액을 계산하지 않는다(null).
      // (수요예측 전 딜은 final 이 null → '0억원 발행'으로 오인 방지)
      const _hasFinal = data.records.some(r => r.final != null);
      const _sumInit = tranches.reduce((s, t) => s + (t.최초모집_억 || 0), 0);
      const _sumFinal = _hasFinal ? tranches.reduce((s, t) => s + (t.최종발행_억 || 0), 0) : null;
      const 증액_총_억 = _hasFinal ? Math.round((_sumFinal - _sumInit) * 100) / 100 : null;
      return {
        kind: "dcm",
        data: {
          오늘날짜: today,
          시제: tense(rep.date, today),  // 청약일 기준 — '과거'면 발행했다/확정됐다, '미래'면 발행한다/예정이다
          발행사: rep.issuer, 발행사_정식명: rep.issuer_full || rep.issuer,
          최초공시일: rep.disclosure_date || null,
          청약일: rep.date,
          발행일: rep.date,          // 회사채는 청약일 = 발행일 (본문에 반드시 명기)
          종류: rep.type,            // 회차 공통
          신용등급: rep.rating,      // 회차 공통
          발행한도_총_억: rep.limit, // 회차 전체 한도 (트랜치별 X)
          최종발행_확정: _hasFinal,  // false면 수요예측 전 — 최종규모·증액·경쟁률·최종금리 미정
          회차합산_최초모집_억: Math.round(_sumInit * 100) / 100,
          회차합산_억: _hasFinal ? (rep.series_total || _sumFinal) : Math.round(_sumInit * 100) / 100,
          증액_총_억,                // 회차 합산 최종발행 − 최초모집. null이면 최종 미확정(증액 언급 금지)

          주관사_명단,                 // 본문 등장 순서
          주관실적_분배_억,           // 주관사별 산식 분배액 (본인 인수 + 잔여 균등) — '주관 실적'
          인수량_별_억,               // 인수사별 실제 인수 금액
          tranches,
          history: dcmHistory(rep),  // 같은 발행사 직전 발행 (회차그룹 단위, 최대 2건)
        },
      };
    }
    if (kind === "ipo") {
      return {
        kind: "ipo",
        data: {
          오늘날짜: today,
          시제: tense(data.date, today),  // 상장일 기준
          발행사: data.issuer, 시장: data.market,
          최초공시일: data.disclosure_date || null, 상장일: data.date || null,
          최초_수량: data.init_qty, 최초_가액_원: data.init_price, 최초_총액_억: data.init_total,
          최종_수량: data.final_qty, 최종_가액_원: data.final_price, 최종_총액_억: data.final_total,
          신주비율: fmtPctStr(data.new_ratio), 구주비율: fmtPctStr(data.old_ratio),
          기관: data.inst || null, 일반: data.general || null, 우리사주: data.esop || null,
          주관사: data.leads || {}, 인수사: data.uw || {},
          history: ecmHistory("ipo", data),  // 보통 없음
        },
      };
    }
    // rights
    return {
      kind: "rights",
      data: {
        오늘날짜: today,
        시제: tense(data.date, today),  // 신주배정기준일 기준
        발행사: data.issuer, 유형: data.type,
        최초공시일: data.disclosure_date || null,
        신주배정기준일: data.date || null, 납입일: data.payment || null,
        신주_수량: data.new_qty, 기존_수량: data.existing_qty, 증자비율: ratioPctStr(data.new_qty, data.existing_qty, data.increase_ratio),
        최초가_원: data.init_price, "1차가_원": data.price_1, "2차가_원": data.price_2, 확정가_원: data.final_price,
        최초총액_억: data.init_total, "1차총액_억": data.total_1, "2차총액_억": data.total_2, 확정총액_억: data.final_total,
        주관사: data.leads || {}, 인수사: data.uw || {},
        history: ecmHistory("rights", data),
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 공통 UI 헬퍼
  // ════════════════════════════════════════════════════════════════════
  function fillSelect(id, values, withAll) {
    const sel = $(id); sel.innerHTML = "";
    if (withAll) { const o = document.createElement("option"); o.value = ""; o.textContent = "전체"; sel.appendChild(o); }
    for (const v of values) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
  }
  function clearPresetActive(prefix) {
    document.querySelectorAll(`[data-${prefix}-preset]`).forEach(b => b.classList.remove("active"));
  }
  function setupChipDropdown(opts) {
    const sel = $(opts.selId);
    const dispOf = (v) => (opts.dispMap && opts.dispMap[v]) || v;
    const sorted = [...opts.values].sort((a, b) => dispOf(a).localeCompare(dispOf(b), "ko"));
    sel.innerHTML = '<option value="">선택</option>';
    for (const v of sorted) { const o = document.createElement("option"); o.value = v; o.textContent = dispOf(v); sel.appendChild(o); }
    const syncDisable = () => {
      const kws = new Set(opts.get());
      Array.from(sel.options).forEach(o => o.disabled = o.value !== "" && kws.has(o.value));
    };
    const render = () => {
      const wrap = $(opts.chipsId); wrap.innerHTML = "";
      for (const kw of opts.get()) {
        const chip = document.createElement("span"); chip.className = "issuer-chip";
        chip.innerHTML = esc(dispOf(kw)) + '<button type="button" class="remove" title="제거">×</button>';
        chip.querySelector(".remove").addEventListener("click", () => {
          opts.set(opts.get().filter(k => k !== kw)); render(); syncDisable();
        });
        wrap.appendChild(chip);
      }
    };
    sel.addEventListener("change", () => {
      const val = sel.value; if (!val) return;
      const kws = opts.get(); if (kws.length >= opts.max || kws.includes(val)) { sel.value = ""; return; }
      kws.push(val); sel.value = ""; render(); syncDisable();
    });
    render(); syncDisable();
  }
  function renderChips(wrapId, arr, onRemove, dispMap) {
    const wrap = $(wrapId); wrap.innerHTML = "";
    const dispOf = (v) => (dispMap && dispMap[v]) || v;
    for (const kw of arr) {
      const chip = document.createElement("span"); chip.className = "issuer-chip";
      chip.innerHTML = esc(dispOf(kw)) + '<button type="button" class="remove" title="제거">×</button>';
      chip.querySelector(".remove").addEventListener("click", () => {
        onRemove(kw); renderChips(wrapId, arr.filter(k => k !== kw), onRemove, dispMap);
      });
      wrap.appendChild(chip);
    }
  }
  function renderPager(navId, totalPages, currentPage, onJump) {
    const nav = $(navId); nav.innerHTML = "";
    if (totalPages <= 1) return;
    const addBtn = (label, page, opts = {}) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (opts.active) b.classList.add("active");
      if (opts.disabled) b.disabled = true;
      b.addEventListener("click", () => { onJump(page); window.scrollTo({ top:0, behavior:"smooth" }); });
      nav.appendChild(b);
    };
    addBtn("이전", Math.max(1, currentPage - 1), { disabled:currentPage === 1 });
    let from = Math.max(1, currentPage - 2);
    let to = Math.min(totalPages, from + 4);
    from = Math.max(1, to - 4);
    if (from > 1) { addBtn("1", 1); if (from > 2) { const sp = document.createElement("span"); sp.textContent = "…"; sp.style.padding = "0 4px"; nav.appendChild(sp); } }
    for (let p = from; p <= to; p++) addBtn(String(p), p, { active:p === currentPage });
    if (to < totalPages) { if (to < totalPages - 1) { const sp = document.createElement("span"); sp.textContent = "…"; sp.style.padding = "0 4px"; nav.appendChild(sp); } addBtn(String(totalPages), totalPages); }
    addBtn("다음", Math.min(totalPages, currentPage + 1), { disabled:currentPage === totalPages });
  }

  // ════════════════════════════════════════════════════════════════════
  // 부팅
  // ════════════════════════════════════════════════════════════════════
  // Supabase URL 노출 (Edge Function 호출용) — supabase-client.js 의 NP_SUPABASE_URL 사용
  // (이미 setup 돼 있으면 그대로, 아니면 sb.supabaseUrl 시도)
  if (!window.NP_SUPABASE_URL && window.sb && window.sb.supabaseUrl) {
    window.NP_SUPABASE_URL = window.sb.supabaseUrl;
  }

  // dcm-deals / ecm-deals 패턴 — IIFE 끝에서 즉시 호출 (script 가 body 끝이라 DOM 이미 완성)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => DCM.init());
  } else {
    DCM.init();
  }
})();
