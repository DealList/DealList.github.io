// DealList - 클라이언트 사이드 필터링 + Excel 다운로드
(function () {
  "use strict";

  const PAGE_SIZE = 50;

  // 신용등급 ranking — 숫자 작을수록 좋음 (AAA=1, D=22)
  const RATING_RANK = {
    "AAA": 1,
    "AA+": 2, "AA": 3, "AA-": 4,
    "A+": 5, "A": 6, "A-": 7,
    "BBB+": 8, "BBB": 9, "BBB-": 10,
    "BB+": 11, "BB": 12, "BB-": 13,
    "B+": 14, "B": 15, "B-": 16,
    "CCC+": 17, "CCC": 18, "CCC-": 19,
    "CC": 20, "C": 21, "D": 22,
  };
  // 드롭다운에 표시할 standard 등급 (공모 회사채 실용 범위: AAA ~ BBB-)
  const RATING_OPTIONS = [
    "AAA", "AA+", "AA", "AA-",
    "A+", "A", "A-",
    "BBB+", "BBB", "BBB-",
  ];

  // 증권사 alias → 풀네임 매핑 (드롭다운/chip 표시용. 데이터/필터링은 alias 그대로)
  const BROKER_FULL_NAME = {
    "BNK": "BNK투자증권",
    "DB": "DB금융투자",
    "IBK": "IBK투자증권",
    "KB": "KB증권",
    "KR": "KR투자증권",
    "LS": "LS증권",
    "NH": "NH투자증권",
    "SK": "SK증권",
    "iM": "iM증권",
    "교보": "교보증권",
    "다올": "다올투자증권",
    "대신": "대신증권",
    "디에스": "DS투자증권",
    "리딩": "리딩투자증권",
    "메리츠": "메리츠증권",
    "미래": "미래에셋증권",
    "부국": "부국증권",
    "산은": "한국산업은행",
    "삼성": "삼성증권",
    "상상인": "상상인증권",
    "신영": "신영증권",
    "신한": "신한투자증권",
    "우리": "우리투자증권",
    "유안타": "유안타증권",
    "유진": "유진투자증권",
    "케이프": "케이프투자증권",
    "코리아에셋": "코리아에셋투자증권",
    "키움": "키움증권",
    "하나": "하나증권",
    "한양": "한양증권",
    "한투": "한국투자증권",
    "한화": "한화투자증권",
    "현차": "현대차증권",
    "흥국": "흥국증권",
  };

  // 효과적 등급 rank — 범위(A+~AA-) 는 첫 번째(=low, 낮은 등급) 기준
  // 사용자 룰: 신용등급 표기 "low~high" 중 하단(low)이 필터 기준
  function effectiveRatingRank(s) {
    if (!s) return null;
    if (s.includes("~")) {
      const parts = s.split("~").map((x) => x.trim());
      const low = parts[0];  // 첫 번째 = low (낮은 등급) = 필터 기준
      return RATING_RANK[low] ?? null;
    }
    return RATING_RANK[s.trim()] ?? null;
  }

  let DATA = [];
  let META = {};
  let filtered = [];          // 트랜치 단위 (필터링 직후)
  let grouped = [];           // [{ key, records: [tranches sorted by series], rep }] 회차 단위
  let currentPage = 1;
  let sortKey = "date";
  let sortDir = "desc";
  let issuerKeywords = [];    // 발행사 검색 chip 배열
  let leadKeywords = [];      // 주관 증권사 chip 배열
  let uwKeywords = [];        // 인수 증권사 chip 배열
  const MAX_ISSUER_CHIPS = 10;
  const MAX_BROKER_CHIPS = 5;

  const $ = (id) => document.getElementById(id);

  // ============== 데이터 로드 ==============
  async function loadAll() {
    try {
      const [d, m] = await Promise.all([
        fetch("../data.json").then((r) => r.json()),
        fetch("../meta.json").then((r) => r.json()),
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

  function initFilters() {
    // 종류 순서: 무보증 → 신종자본 → 후순위채 → 보증 (사용자 지정)
    const TYPE_ORDER = ["무보증", "신종자본", "후순위채", "보증"];
    const types = META.types || [];
    const orderedTypes = [
      ...TYPE_ORDER.filter((t) => types.includes(t)),
      ...types.filter((t) => !TYPE_ORDER.includes(t)),  // 새 종류는 뒤에
    ];
    fillSelect("f-type", orderedTypes, true);   // 단일 선택 + "전체"
    fillSelect("f-rating-min", RATING_OPTIONS, true);  // low end
    fillSelect("f-rating-max", RATING_OPTIONS, true);  // high end
    // 주관/인수 증권사는 setupChipDropdown 이 옵션 채움

    // 데이터 max/min 청약일 (preset 계산 기준)
    const maxDate = DATA.reduce((a, r) => (r.date && r.date > a ? r.date : a), "");
    const minDate = DATA.reduce(
      (a, r) => (r.date && (!a || r.date < a) ? r.date : a), "");

    // 초기 화면: 최근 1년치
    applyDatePreset("1y", maxDate, minDate);

    // 모든 필터 change 이벤트는 즉각 적용 안 함 — "조회" 버튼 클릭 시만 반영
    // (chip / preset 버튼 등은 UI 만 갱신, 데이터는 그대로)

    // 주관/인수 chip 드롭다운 셋업
    setupChipDropdown({
      selectId: "f-lead-select",
      chipsId: "f-lead-chips",
      max: MAX_BROKER_CHIPS,
      values: META.leads || [],
      displayMap: BROKER_FULL_NAME,
      getArr: () => leadKeywords,
      setArr: (arr) => { leadKeywords = arr; },
    });
    setupChipDropdown({
      selectId: "f-uw-select",
      chipsId: "f-uw-chips",
      max: MAX_BROKER_CHIPS,
      values: META.underwriters || [],
      displayMap: BROKER_FULL_NAME,
      getArr: () => uwKeywords,
      setArr: (arr) => { uwKeywords = arr; },
    });
    ["f-date-start", "f-date-end"].forEach((id) => {
      $(id).addEventListener("change", () => {
        clearPresetActive();
      });
    });
    // 발행사 목록 (정확한 발행사명 검증용)
    const issuerSet = new Map(
      (META.issuers || []).map((s) => [s.toLowerCase(), s]),
    );

    // 자동완성 — datalist 채움 (브라우저 기본 typeahead)
    const dl = $("issuers-datalist");
    dl.innerHTML = "";
    for (const name of (META.issuers || [])) {
      const o = document.createElement("option");
      o.value = name;
      dl.appendChild(o);
    }

    // 발행사 검색: 엔터로 chip 추가 — 데이터에 정확히 일치하는 발행사명만 허용
    $("f-issuer").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const val = $("f-issuer").value.trim();
      if (!val) return;
      const canonical = issuerSet.get(val.toLowerCase());
      if (!canonical) {
        alert(
          "'" + val + "' 발행사를 찾을 수 없습니다.\n\n" +
          "금융감독원 DART 공시 기준의 정확한 전체 기업명을 입력해 주세요.\n" +
          "(예: SK, SK네트웍스, 에스케이에코플랜트 등)\n\n" +
          "기업명이 올바르더라도 발행 내역이 없으면 조회가 되지 않습니다."
        );
        return;
      }
      if (issuerKeywords.length >= MAX_ISSUER_CHIPS) {
        $("f-issuer").value = "";
        return;
      }
      if (issuerKeywords.includes(canonical)) {
        $("f-issuer").value = "";
        return;
      }
      issuerKeywords.push(canonical);
      $("f-issuer").value = "";
      renderIssuerChips();
    });

    // 기간 preset 버튼 — 날짜 input 만 갱신, 데이터는 "조회" 눌러야 반영
    document.querySelectorAll(".date-presets button[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyDatePreset(btn.dataset.preset, maxDate, minDate);
      });
    });

    // 조회 버튼 — 짧은 로딩 표시 후 필터 적용
    $("btn-search").addEventListener("click", () => {
      const btn = $("btn-search");
      const tableWrap = document.querySelector(".table-wrap");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>조회 중';
      tableWrap.classList.add("loading");
      // 다음 paint 후 + 짧은 딜레이로 시각적 피드백
      setTimeout(() => {
        currentPage = 1;
        applyFilters();
        btn.disabled = false;
        btn.textContent = "조회";
        tableWrap.classList.remove("loading");
      }, 250);
    });

    $("btn-reset").addEventListener("click", () => {
      // 종류 / 신용등급 범위: 단일 선택 → "전체" (value="") 로 복원
      $("f-type").value = "";
      $("f-rating-min").value = "";
      $("f-rating-max").value = "";
      applyDatePreset("1y", maxDate, minDate);
      // chip 인풋들 비움
      $("f-issuer").value = "";
      issuerKeywords = [];
      renderIssuerChips();
      leadKeywords = [];
      $("f-lead-chips").innerHTML = "";
      $("f-lead-select").value = "";
      Array.from($("f-lead-select").options).forEach((o) => (o.disabled = false));
      uwKeywords = [];
      $("f-uw-chips").innerHTML = "";
      $("f-uw-select").value = "";
      Array.from($("f-uw-select").options).forEach((o) => (o.disabled = false));
      // 필터 초기화는 UI 만 — 데이터는 "조회" 눌러야 반영
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

  function renderIssuerChips() {
    const wrap = $("f-issuer-chips");
    wrap.innerHTML = "";
    for (const kw of issuerKeywords) {
      const chip = document.createElement("span");
      chip.className = "issuer-chip";
      chip.innerHTML = esc(kw) +
        '<button type="button" class="remove" title="제거">×</button>';
      chip.querySelector(".remove").addEventListener("click", () => {
        issuerKeywords = issuerKeywords.filter((k) => k !== kw);
        renderIssuerChips();
      });
      wrap.appendChild(chip);
    }
  }

  // chip + 드롭다운 셋업 (주관/인수 증권사용)
  function setupChipDropdown(opts) {
    const sel = $(opts.selectId);

    // 표시값 함수 (displayMap 있으면 풀네임, 없으면 그대로)
    const displayOf = (v) => (opts.displayMap && opts.displayMap[v]) || v;

    // 옵션 채움 — 풀네임 가나다 순 정렬, 첫 항목은 빈 placeholder
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function applyDatePreset(preset, maxDate, minDate) {
    clearPresetActive();
    const btn = document.querySelector(`.date-presets button[data-preset="${preset}"]`);
    if (btn) btn.classList.add("active");

    if (preset === "all") {
      // 데이터 최초 청약일 ~ 오늘
      $("f-date-start").value = minDate || "";
      $("f-date-end").value = todayLocal();
      return;
    }
    if (!maxDate) return;
    const d = new Date(maxDate);
    const start = new Date(d);
    if (preset === "1m") start.setMonth(start.getMonth() - 1);
    else if (preset === "3m") start.setMonth(start.getMonth() - 3);
    else if (preset === "6m") start.setMonth(start.getMonth() - 6);
    else if (preset === "9m") start.setMonth(start.getMonth() - 9);
    else if (preset === "1y") start.setFullYear(start.getFullYear() - 1);
    else if (preset === "2y") start.setFullYear(start.getFullYear() - 2);
    else if (preset === "3y") start.setFullYear(start.getFullYear() - 3);
    start.setDate(start.getDate() + 1);
    $("f-date-end").value = maxDate;
    $("f-date-start").value = start.toISOString().slice(0, 10);
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
    const dateStart = $("f-date-start").value || "";
    const dateEnd = $("f-date-end").value || "";
    const typeVal = $("f-type").value || "";   // 단일 선택 ("" = 전체)
    const ratingMin = $("f-rating-min").value || "";  // low end (나쁜 등급 쪽)
    const ratingMax = $("f-rating-max").value || "";  // high end (좋은 등급 쪽)
    const minRank = ratingMin ? RATING_RANK[ratingMin] : null;  // rank 큰 값 = 나쁜
    const maxRank = ratingMax ? RATING_RANK[ratingMax] : null;  // rank 작은 값 = 좋은
    // 발행사 / 주관 / 인수: chip 으로 추가된 정확한 alias 만 (exact match, 대소문자 무관)
    const issuerSet = new Set(issuerKeywords.map((k) => k.toLowerCase()));
    const leadSet = new Set(leadKeywords.map((k) => k.toLowerCase()));
    const uwSet = new Set(uwKeywords.map((k) => k.toLowerCase()));

    // 1) 트랜치 단위 필터링. 매치되는 트랜치가 한 개라도 있으면 그룹 전체 표시 위해
    //    그룹 키 단위로 한 번 더 확장.
    const matchTranche = (r) => {
      const d = r.date || "";
      if (dateStart && d && d < dateStart) return false;
      if (dateEnd && d && d > dateEnd) return false;
      if (typeVal && r.type !== typeVal) return false;
      if (minRank !== null || maxRank !== null) {
        const effRank = effectiveRatingRank(r.rating);
        if (effRank == null) return false;
        // 범위: maxRank(좋은 등급, 작은 숫자) ≤ effRank ≤ minRank(나쁜 등급, 큰 숫자)
        if (maxRank !== null && effRank < maxRank) return false;
        if (minRank !== null && effRank > minRank) return false;
      }
      if (leadSet.size) {
        // 주관 증권사: r.leads 의 alias 중 하나가 chip 에 있으면 통과 (OR)
        if (!(r.leads || []).some((l) => leadSet.has(l.toLowerCase()))) return false;
      }
      if (uwSet.size) {
        // 인수 증권사: r.uw (dict) 의 키 중 하나가 chip 에 있으면 통과 (OR)
        const uwAliases = Object.keys(r.uw || {});
        if (!uwAliases.some((a) => uwSet.has(a.toLowerCase()))) return false;
      }
      if (issuerSet.size) {
        // 정확한 발행사명 매치 (chip 으로 등록된 것 OR)
        if (!issuerSet.has((r.issuer || "").toLowerCase())) return false;
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

        let html = "";

        // 청약일 + 발행사 — 그룹 공통, 첫 트랜치에만 rowspan
        if (isFirst) {
          html += '<td class="group-cell" rowspan="' + N + '">' + (r.date || "") + "</td>";
          html += '<td class="group-cell" rowspan="' + N + '">' + esc(r.issuer) + "</td>";
        }

        // 트랜치별 표시
        html +=
          "<td>" + esc(r.series) + "</td>" +
          "<td>" + esc(r.type) + "</td>" +
          "<td>" + esc(r.rating) + "</td>" +
          "<td>" + esc(r.maturity) + "</td>" +
          '<td class="num">' + fmtNum(r.init) + "</td>";

        // 발행한도 — 그룹 공통
        if (isFirst) {
          html += '<td class="num group-cell" rowspan="' + N + '">' + fmtNum(r.limit) + "</td>";
        }

        html +=
          '<td class="num">' + fmtNum(r.demand) + "</td>" +
          '<td class="num">' + fmtNum(r.final) + "</td>";

        // 회차합산 — 그룹 공통
        if (isFirst) {
          html += '<td class="num group-cell" rowspan="' + N + '">' + fmtNum(r.series_total) + "</td>";
        }

        html +=
          '<td class="center">' + esc(r.r_target) + "</td>" +
          '<td class="center">' + esc(r.r_demand) + "</td>" +
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
  // 웹 화면과 동일하게 같은 회차의 트랜치들에서 청약일/발행사/발행한도/회차합산
  // 컬럼을 첫 트랜치에만 표시 + 실제 셀 병합 적용.
  function downloadExcel() {
    if (!grouped.length) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    // 컬럼 정의 — json_to_sheet 가 객체 키 순서대로 컬럼 만듦
    const COLS = [
      "청약일", "발행사", "회차", "종류", "신용등급", "만기일",
      "최초모집(억)", "발행한도(억)", "수요예측(억)",
      "최종발행(억)", "회차합산(억)",
      "희망금리", "수요금리", "최종금리(%)",
      "주관사", "인수사",
    ];
    // 그룹 공통 컬럼 (병합 대상)
    const MERGE_COL_NAMES = ["청약일", "발행사", "발행한도(억)", "회차합산(억)"];
    const MERGE_COL_INDICES = MERGE_COL_NAMES.map((c) => COLS.indexOf(c));

    const rows = [];
    const merges = [];
    let dataRowIdx = 1;  // row 0 = 헤더, 데이터는 1부터

    for (const g of grouped) {
      const N = g.records.length;
      g.records.forEach((r, i) => {
        const isFirst = i === 0;
        rows.push({
          청약일: isFirst ? r.date : null,
          발행사: isFirst ? r.issuer : null,
          회차: r.series,
          종류: r.type,
          신용등급: r.rating,
          만기일: r.maturity,
          "최초모집(억)": r.init,
          "발행한도(억)": isFirst ? r.limit : null,
          "수요예측(억)": r.demand,
          "최종발행(억)": r.final,
          "회차합산(억)": isFirst ? r.series_total : null,
          희망금리: r.r_target,
          수요금리: r.r_demand,
          "최종금리(%)": r.r_final,
          주관사: (r.leads || []).join(", "),
          인수사: Object.keys(r.uw || {}).join(", "),
        });
      });
      if (N > 1) {
        const startRow = dataRowIdx;
        const endRow = dataRowIdx + N - 1;
        for (const c of MERGE_COL_INDICES) {
          merges.push({ s: { r: startRow, c }, e: { r: endRow, c } });
        }
      }
      dataRowIdx += N;
    }

    const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
    ws["!merges"] = merges;

    // 병합 셀들의 세로 가운데 정렬 (보기 좋게)
    for (const m of merges) {
      const cellRef = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
      if (ws[cellRef]) {
        ws[cellRef].s = ws[cellRef].s || {};
        ws[cellRef].s.alignment = { vertical: "center" };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DealList");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `DealList_${today}.xlsx`);
  }

  // ============== 시작 ==============
  loadAll();
})();
