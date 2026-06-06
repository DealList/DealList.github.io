/* ─────────────────────────────────────────────────────────────
 * Deal List — 메인페이지 동적 섹션
 * summary.json + data.json 을 읽어 KPI / 최근 발행 / 리그테이블 /
 * 월별 추이 / 다가오는 청약을 채웁니다.
 * ───────────────────────────────────────────────────────────── */

const BROKER_FULL = {
  "BNK":"BNK투자증권","DB":"DB금융투자","IBK":"IBK투자증권","KB":"KB증권",
  "KR":"KR투자증권","LS":"LS증권","NH":"NH투자증권","SK":"SK증권","iM":"iM증권",
  "교보":"교보증권","다올":"다올투자증권","대신":"대신증권","디에스":"DS투자증권",
  "리딩":"리딩투자증권","메리츠":"메리츠증권","미래":"미래에셋증권","부국":"부국증권",
  "산은":"한국산업은행","삼성":"삼성증권","상상인":"상상인증권","신영":"신영증권",
  "신한":"신한투자증권","우리":"우리투자증권","유안타":"유안타증권","유진":"유진투자증권",
  "케이프":"케이프투자증권","코리아에셋":"코리아에셋투자증권","키움":"키움증권",
  "하나":"하나증권","한양":"한양증권","한투":"한국투자증권","한화":"한화투자증권",
  "현차":"현대차증권","흥국":"흥국증권"
};

/* ─── formatters ─── */
const fmtAmt = (eok) => {
  if (eok == null) return '—';
  if (eok >= 10000) {
    const jo = Math.floor(eok / 10000);
    const rest = Math.round(eok % 10000);
    return rest > 0
      ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억`
      : `${jo.toLocaleString()}조`;
  }
  return `${Math.round(eok).toLocaleString()}억`;
};
const chgLabel = (v) => v == null ? '' : (v > 0 ? `↑ ${v}%` : v < 0 ? `↓ ${Math.abs(v)}%` : '변동 없음');
const tagClassFor = (rating) => {
  if (!rating) return '';
  const r = rating.toUpperCase();
  if (r.startsWith('AAA')) return 'aaa';
  if (r.startsWith('AA')) return 'aa';
  if (r.startsWith('A')) return 'a';
  return 'bbb';
};
const shortMonth = (dateStr) => dateStr.slice(5, 7) + '월';
const shortDay = (dateStr) => dateStr.slice(8, 10);

/* ─── (1) KPI grid + nav updated — summary.json + data.json ─── */
async function fillKPI() {
  try {
    const [s, dataRaw] = await Promise.all([
      NP_loadData('summary.json'),
      NP_loadData('data.json'),
    ]);
    document.getElementById('nav-updated').textContent =
      `최종 업데이트 ${s.updated || '—'}`;

    // 사용자 today 기준 "지난 달" 통계 — summary.json 의 this_month_* 은
    // max_date 기반이라 미래 청약일 있으면 다음 달로 잘못 넘어감. 클라이언트에서
    // 다시 계산: prevMonth = today.month - 1. 같은 청약일·발행사·회차base 는
    // 1건 (회차 단위) 으로 카운트, 금액은 모든 트랜치 final 합계.
    const _ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const today = new Date();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevPrevMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const prevYM = _ym(prevMonth);
    const prevPrevYM = _ym(prevPrevMonth);

    const records = (dataRaw && dataRaw.records) ? dataRaw.records : (dataRaw || []);
    function aggMonth(targetYM) {
      const seen = new Set();
      let count = 0, amount = 0;
      for (const r of records) {
        if (!r.date || !r.date.startsWith(targetYM)) continue;
        amount += r.final || 0;
        const baseSeries = (r.series || '').split('-')[0];
        const key = `${r.date}|${r.issuer}|${baseSeries}`;
        if (!seen.has(key)) { seen.add(key); count++; }
      }
      return { count, amount };
    }
    const prev = aggMonth(prevYM);
    const prevPrev = aggMonth(prevPrevYM);
    const pct = (curr, base) => base > 0 ? ((curr - base) / base * 100) : null;
    const countChange = pct(prev.count, prevPrev.count);
    const amountChange = pct(prev.amount, prevPrev.amount);

    const monthLabel = `${prevMonth.getFullYear()}년 ${prevMonth.getMonth() + 1}월`;
    const fmtPct = (v) => v == null ? '—' :
      `<span class="delta ${v < 0 ? 'down' : 'up'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(1)}%</span>`;

    document.getElementById('kpi-grid').innerHTML = `
      <a class="v1-kpi" href="dcm-deals/">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          ${monthLabel} 공모채 발행건수
        </div>
        <div class="value">${prev.count}<small>건</small></div>
        <div class="sub">
          ${fmtPct(countChange)}
          <span class="sub-text">전월 대비</span>
        </div>
      </a>
      <a class="v1-kpi" href="dcm-deals/">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          ${monthLabel} 공모채 발행총액
        </div>
        <div class="value">${fmtAmt(prev.amount)}</div>
        <div class="sub">
          ${fmtPct(amountChange)}
          <span class="sub-text">전월 대비</span>
        </div>
      </a>
      <a class="v1-kpi" href="dcm-brokers/">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9a6 6 0 0 0 12 0V3H6v6z"/><path d="M4 22h16M9 17l-2 5M15 17l2 5"/></svg>
          올해 공모채 주관 1위
        </div>
        <div class="value compact">${BROKER_FULL[s.this_year_top_broker] || s.this_year_top_broker}</div>
        <div class="sub">
          <span style="font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums;">${fmtAmt(s.this_year_top_amount)}</span>
          <span class="sub-text">· 점유율 ${s.this_year_top_share}%</span>
        </div>
      </a>
      <a class="v1-kpi" href="dcm-deals/">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
          올해 공모채 최대 단일 발행
        </div>
        <div class="value compact">${s.this_year_biggest_issuer} <span style="color: var(--muted); font-size: 14px;">${s.this_year_biggest_series}회차</span></div>
        <div class="sub">
          <span style="font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums;">${fmtAmt(s.this_year_biggest_amount)}</span>
          <span class="sub-text">· ${s.this_year_biggest_date}</span>
        </div>
      </a>
    `;
  } catch (e) { console.error('KPI load failed', e); }
}

/* ─── (2) data.json — derive recent/league/trend/upcoming ─── */
async function fillFromData() {
  let data;
  try { data = await NP_loadData('data.json'); }
  catch (e) { console.error('data.json load failed', e); return; }

  // Aggregate to series-level (한 회차 = 1건). data.json은 트랜치 단위라 series 묶어야 함.
  // series key = issuer + base series number (예: "146-1" → "146")
  const seriesMap = new Map();
  for (const d of data) {
    const baseSeries = (d.series || '').split('-')[0];
    const key = `${d.date}|${d.issuer}|${baseSeries}`;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        date: d.date,
        issuer: d.issuer,
        series: baseSeries,
        type: d.type,
        rating: d.rating,
        leads: new Set(d.leads || []),
        leadAmts: { ...(d.lead_amt || {}) },
        uwAmts: { ...(d.uw || {}) },
        finalAmt: d.final || 0,
        initAmt: d.init || 0,  // 트랜치별 최초모집액 합 (series_total 미정 시 사용)
        limit: d.limit || 0,
        seriesTotal: d.series_total,  // 첫 트랜치에서 잡음 (모든 트랜치 동일값)
        tranches: 1,
      });
    } else {
      const e = seriesMap.get(key);
      (d.leads || []).forEach(L => e.leads.add(L));
      Object.entries(d.lead_amt || {}).forEach(([k, v]) => {
        e.leadAmts[k] = (e.leadAmts[k] || 0) + v;
      });
      Object.entries(d.uw || {}).forEach(([k, v]) => {
        e.uwAmts[k] = (e.uwAmts[k] || 0) + v;
      });
      e.finalAmt += d.final || 0;
      e.initAmt += d.init || 0;
      // 첫 트랜치에 series_total 없고 다른 트랜치에 있으면 보강
      if (e.seriesTotal == null && d.series_total != null) e.seriesTotal = d.series_total;
      e.tranches++;
    }
  }
  const series = [...seriesMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  // Today reference — 사용자 today (브라우저 시각) 기준 YYYY-MM-DD.
  // 기존엔 데이터의 max_date 를 사용했는데, 미래 청약일 record 가 들어가면서
  // max_date 가 미래로 튀어 "다가오는 청약" 필터가 거의 항상 빈 결과를 냄.
  // 이제 사용자 today 와 비교 → 청약일이 오늘 이전 = 최근 발행 / 오늘 이후 = 다가오는 청약.
  const _todayDt = new Date();
  const today = `${_todayDt.getFullYear()}-${String(_todayDt.getMonth() + 1).padStart(2, '0')}-${String(_todayDt.getDate()).padStart(2, '0')}`;

  /* ─── 2행: 최근 발행 공모채(청약일 < 오늘=당일 제외, 완료 딜, 최근 10) / 다가오는 청약(미완료=finalAmt==0, 최신 10) ─── */
  renderRecentDeals(series.filter(s => s.date && s.date < today && (s.finalAmt || 0) > 0).slice(0, 10));
  // 다가오는 청약: 청약일이 오늘부터(포함) 이후인 모든 건 (수요예측 완료 여부 무관). 먼 미래 먼저(date desc) 10건.
  renderUpcoming(series.filter(s => s.date && s.date >= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10));

  /* ─── 1행: 주관 / 인수 리그 TOP 10 (올해) ─── */
  // 매년 1월 한 달은 직전 해 유지 (2월 1일부터 새 해 전환). 사용자 룰 (2026-05-26).
  const _yr = _todayDt.getFullYear();
  const _mo = _todayDt.getMonth() + 1;
  const year = String(_mo === 1 ? _yr - 1 : _yr);
  const yearSeries = series.filter(s => s.date.startsWith(year));
  const yearTotal = yearSeries.reduce((sum, s) => sum + (s.finalAmt || 0), 0);
  const mkDcmLeague = (field) => {
    const agg = {};
    for (const s of yearSeries) for (const [b, amt] of Object.entries(s[field] || {})) { (agg[b] || (agg[b] = { amount: 0 })).amount += amt; }
    return Object.entries(agg).map(([b, v]) => ({ name: BROKER_FULL[b] || b, amount: v.amount, share: yearTotal > 0 ? v.amount / yearTotal * 100 : 0 })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  };
  renderDcmLeagueRows('league-rows', mkDcmLeague('leadAmts'));
  renderDcmLeagueRows('league-uw-rows', mkDcmLeague('uwAmts'));
  const _setDcm = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  _setDcm('dcm-league-lead-title', `${year} 공모채 주관 리그테이블`);
  _setDcm('dcm-league-uw-title', `${year} 공모채 인수 리그테이블`);

  /* ─── Monthly trend (current month + 12 prior = 13 months) ─── */
  // 1) 오늘 기준 13개월 range (좌: 전년 동월, 우: 현재월)
  // 주의: 위쪽에 const today (max_date 기반 string) 가 이미 있음 → 다른 이름 사용
  const nowDt = new Date();
  const months = [];
  let y = nowDt.getFullYear(), m = nowDt.getMonth(); // m: 0-indexed
  for (let i = 0; i < 13; i++) {
    months.unshift(`${y}-${String(m + 1).padStart(2, "0")}`);
    m--;
    if (m < 0) { m = 11; y--; }
  }
  const currentYM = months[months.length - 1];
  // 2) 모든 월을 0 으로 초기화 (빈 월도 막대 자리 차지)
  const monthAgg = {};
  for (const ym of months) monthAgg[ym] = { count: 0, amount: 0 };
  // 3) 청약일이 현재월 이하인 record 만 집계 (미래 청약일은 제외)
  for (const s of series) {
    const ym = s.date.slice(0, 7);
    if (!(ym in monthAgg)) continue;        // range 밖
    if (ym > currentYM) continue;            // 미래 청약일 제외 (안전망)
    monthAgg[ym].count++;
    monthAgg[ym].amount += s.finalAmt || 0;
  }
  _trendData = months.map(m => ({ label: m, ...monthAgg[m] }));

  // 4) 초기 mode 는 .toggle .active 가 가진 mode (기본 count). DCM 트렌드 카드만 (#dcm-main).
  const activeToggle = document.querySelector("#dcm-main .v1-chart .toggle span.active");
  const initMode = activeToggle ? activeToggle.dataset.mode : "count";
  renderTrend(_trendData, initMode);

  // 5) 토글 클릭 → mode 전환 + 즉시 재렌더 (DCM 트렌드 카드 한정)
  document.querySelectorAll("#dcm-main .v1-chart .toggle span").forEach((sp) => {
    sp.onclick = () => {
      document.querySelectorAll("#dcm-main .v1-chart .toggle span")
        .forEach((x) => x.classList.remove("active"));
      sp.classList.add("active");
      renderTrend(_trendData, sp.dataset.mode);
    };
  });
}

// 토글 재렌더링을 위해 module-level 에 마지막 trend 데이터 보관
let _trendData = null;

function renderRecentDeals(list) {
  const root = document.getElementById('recent-deals');
  const container = root.closest('.v1-deals'); if (container) container.classList.add('no-leads');
  if (!list.length) {
    root.innerHTML = `<div style="padding: 40px 18px; text-align: center; color: var(--muted); font-size: 13px;">최근 발행 데이터가 없습니다.</div>`;
    return;
  }
  root.innerHTML = list.map(s => {
    // 수요예측 전 (= finalAmt 미정) 인 건들은 금액 자리에 "수요예측 예정" 표시
    const isPriced = (s.finalAmt || 0) > 0;
    const amtHtml = isPriced
      ? `<div class="amt">${s.finalAmt.toLocaleString()}<small>억</small></div>`
      : `<div class="amt pending">수요예측 예정</div>`;
    return `
    <a class="v1-deal-row" href="dcm-deals/" data-type="${s.type || ''}">
      <div class="date">
        <span class="d">${shortDay(s.date)}</span>
        <span>${shortMonth(s.date)}</span>
      </div>
      <div class="issuer">
        <div class="name">${s.issuer}</div>
        <div class="series">${s.series}회차 · ${s.type}${s.tranches > 1 ? ` · ${s.tranches}트랜치` : ''}</div>
      </div>
      <div><span class="tag ${tagClassFor(s.rating)}">${s.rating || '—'}</span></div>
      ${amtHtml}
    </a>`;
  }).join('');

  // Filter pills
  document.querySelectorAll('.v1-deals .pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('.v1-deals .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const f = p.dataset.filter;
      document.querySelectorAll('.v1-deal-row').forEach(row => {
        row.style.display = (f === 'all' || row.dataset.type === f) ? '' : 'none';
      });
    };
  });
}

function renderUpcoming(list) {
  const root = document.getElementById('upcoming-rows');
  if (!list.length) {
    root.innerHTML = `<div style="padding: 24px 0; text-align: center; color: var(--muted); font-size: 12px;">예정된 청약이 없습니다.</div>`;
    return;
  }
  root.innerHTML = list.map(s => {
    // 금액: series_total 이 있으면 그대로, 아직 없으면(미확정) 모든 트랜치 최초모집액 합 (initAmt)
    const isPriced = (s.finalAmt || 0) > 0;
    const amt = isPriced ? s.finalAmt : ((s.seriesTotal != null && s.seriesTotal > 0) ? s.seriesTotal : (s.initAmt || 0));
    const amtHtml = amt > 0
      ? `<div class="amt">${amt.toLocaleString()}<small>억</small></div>`
      : `<div class="amt pending">수요예측 예정</div>`;
    return `
    <a class="v1-deal-row" href="dcm-deals/" data-type="${s.type || ''}">
      <div class="date">
        <span class="d">${shortDay(s.date)}</span>
        <span>${shortMonth(s.date)}</span>
      </div>
      <div class="issuer">
        <div class="name">${s.issuer}</div>
        <div class="series">${s.series}회차 · ${s.type}${s.tranches > 1 ? ` · ${s.tranches}트랜치` : ''}</div>
      </div>
      <div><span class="tag ${tagClassFor(s.rating)}">${s.rating || '—'}</span></div>
      ${amtHtml}
    </a>`;
  }).join('');
}

function renderLeague(rows, year) {
  document.getElementById('league-meta').textContent = `${year}.01.01 ~ 현재`;
  // 카드 외부 제목 ("2026 주관 리그테이블") 도 league year 와 동기화
  const titleEl = document.getElementById('league-title');
  if (titleEl) titleEl.textContent = `${year} 주관 리그테이블`;
  const root = document.getElementById('league-rows');
  if (!rows.length) {
    root.innerHTML = `<div style="padding: 40px 0; text-align: center; color: var(--muted); font-size: 13px;">데이터가 없습니다.</div>`;
    return;
  }
  root.innerHTML = rows.map((r, i) => {
    const rank = i + 1;
    const topClass = rank <= 3 ? `top${rank}` : '';
    return `
      <a class="v1-league-row ${topClass}" href="dcm-brokers/">
        <div class="rank">${rank}</div>
        <div class="name">${r.name}</div>
        <div class="amt">${fmtAmt(Math.round(r.amount))}</div>
        <div class="share">${r.share.toFixed(1)}%</div>
      </a>
    `;
  }).join('');
}

// 공모채 주관/인수 리그 rows 렌더 (지정 컨테이너) — rootId에 따라 dcm-brokers ?tab= 자동 부여
function renderDcmLeagueRows(rootId, rows) {
  const root = document.getElementById(rootId); if (!root) return;
  if (!rows.length) { root.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--muted);font-size:13px;">데이터가 없습니다.</div>`; return; }
  const tab = rootId === 'league-uw-rows' ? 'uw' : 'lead';
  const href = `dcm-brokers/?tab=${tab}`;
  root.innerHTML = rows.map((r, i) => {
    const rank = i + 1, topClass = rank <= 3 ? `top${rank}` : '';
    return `<a class="v1-league-row ${topClass}" href="${href}"><div class="rank">${rank}</div><div class="name">${r.name}</div><div class="amt">${fmtAmt(Math.round(r.amount))}</div><div class="share">${r.share.toFixed(1)}%</div></a>`;
  }).join('');
}

function renderTrend(months, mode) {
  if (!months || !months.length) return;
  mode = mode || "count";
  const svg = document.getElementById("trend-chart");
  const W = 600, H = 200, padL = 40, padR = 5, padT = 20, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = innerW / months.length;
  const barW = step * 0.55;

  // SVG 내부 전체를 <a> 로 감싸 클릭 시 charts/ (인포그래픽) 페이지로 이동.
  // 막대·점 개별 hover 효과는 landing.css 에서 처리.
  let html = `<a href="dcm-charts/" target="_self">`;

  // gridlines (5 lines)
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i / 4);
    html += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>`;
  }

  if (mode === "count") {
    // 건수 모드 — 막대만
    const maxCount = Math.max(...months.map(m => m.count), 1);
    months.forEach((m, i) => {
      if (!m.count) return;
      const h = (m.count / maxCount) * innerH;
      const x = padL + i * step + (step - barW) / 2;
      html += `<rect x="${x}" y="${padT + innerH - h}" width="${barW}" height="${h}" fill="#c9a24a" rx="2"/>`;
    });
  } else {
    // 금액 모드 — 선 + area gradient 만
    const maxAmt = Math.max(...months.map(m => m.amount), 1);
    const points = months.map((m, i) => {
      const x = padL + i * step + step / 2;
      const y = padT + innerH - (m.amount / maxAmt) * innerH;
      return `${x},${y}`;
    }).join(" ");
    html = `<defs>
      <linearGradient id="trendG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9a24a" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#c9a24a" stop-opacity="0"/>
      </linearGradient>
    </defs>` + html;
    const first = `${padL + step / 2},${padT + innerH}`;
    const last = `${padL + (months.length - 1) * step + step / 2},${padT + innerH}`;
    html += `<path d="M ${first} L ${points} L ${last} Z" fill="url(#trendG)"/>`;
    html += `<polyline points="${points}" fill="none" stroke="#c9a24a" stroke-width="2"/>`;
    months.forEach((m, i) => {
      const x = padL + i * step + step / 2;
      const y = padT + innerH - (m.amount / maxAmt) * innerH;
      html += `<circle cx="${x}" cy="${y}" r="3" fill="white" stroke="#c9a24a" stroke-width="2"/>`;
    });
  }

  // x labels (월) — 모드 무관 공통
  months.forEach((m, i) => {
    const x = padL + i * step + step / 2;
    const lbl = m.label.slice(2).replace("-", "/");
    html += `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#94a3b8">${lbl}</text>`;
  });

  html += `</a>`;
  svg.innerHTML = html;

  // legend 동기화 — 활성 모드만 표시 (해당 차트 카드 한정)
  const _card = svg.closest(".v1-chart");
  const legendItems = _card ? _card.querySelectorAll(".legend > span") : [];
  if (legendItems.length >= 2) {
    legendItems[0].style.display = mode === "count" ? "" : "none";
    legendItems[1].style.display = mode === "amount" ? "" : "none";
  }
}

/* ═══════════════ ECM 랜딩 (IPO·유상증자 분리) ═══════════════ */
let _ecmLoaded = false;
const $$ = (id) => document.getElementById(id);
const ecmTotal = (r) => r.final_total != null ? r.final_total : (r.total_1 != null ? r.total_1 : (r.init_total || 0));
const leadTop = (leads) => {
  const e = Object.entries(leads || {});
  if (!e.length) return '';
  e.sort((a, b) => b[1] - a[1]);
  return e.slice(0, 2).map(([a]) => BROKER_FULL[a] || a).join(' · ');
};
const ecmTypeShort = (t) => {
  if (!t) return '유상증자';
  if (t.includes('주주배정후')) return '실권주 일반공모';
  if (t.includes('주주배정')) return '주주배정';
  if (t.includes('제3자')) return '제3자배정';
  if (t.includes('일반공모')) return '일반공모';
  return t.length > 9 ? t.slice(0, 9) : t;
};

async function loadEcm() {
  if (_ecmLoaded) return;
  let data, summary;
  try {
    [data, summary] = await Promise.all([
      NP_loadData('ecm_data.json'),
      NP_loadData('ecm_summary.json'),
    ]);
  } catch (e) { console.error('ECM load failed', e); return; }
  _ecmLoaded = true;

  const ipo = data.ipo || [], rights = data.rights || [];
  const _t = new Date();
  const today = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`;
  const yr = String(summary.this_year || _t.getFullYear());

  // 완료 딜 필터 (정보·실적 페이지와 동일) — IPO: 청약 현황(기관·일반 경쟁률) 입력 /
  //   유증: 1차 발행가액 또는 최종가액 확정 (최초희망까지만인 건 제외)
  const ipoDone = (r) => r.inst && typeof r.inst.compete === 'number' && r.general && typeof r.general.compete === 'number';
  const rightsDone = (r) => typeof r.price_1 === 'number' || typeof r.final_price === 'number';
  const amt = (r) => r.final_total ?? r.total_1 ?? r.init_total ?? 0;

  // 지난 달 (오늘 기준 직전 월) — DCM 메인 위젯과 동일 (매월 1일에 넘어감)
  const _ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = new Date(_t.getFullYear(), _t.getMonth() - 1, 1);
  const prevPrevMonth = new Date(_t.getFullYear(), _t.getMonth() - 2, 1);
  const prevYM = _ym(prevMonth), prevPrevYM = _ym(prevPrevMonth);
  const monthLabel = `${prevMonth.getFullYear()}년 ${prevMonth.getMonth() + 1}월`;
  const pct = (c, b) => b > 0 ? ((c - b) / b * 100) : null;
  const fmtPct = (v) => v == null ? '—' : `<span class="delta ${v < 0 ? 'down' : 'up'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(1)}%</span>`;
  const monthAmt = (arr, done, ym) => arr.filter(r => done(r) && (r.date || '').startsWith(ym)).reduce((s, r) => s + amt(r), 0);
  const ipoPrev = monthAmt(ipo, ipoDone, prevYM), ipoPrev2 = monthAmt(ipo, ipoDone, prevPrevYM);
  const rtPrev = monthAmt(rights, rightsDone, prevYM), rtPrev2 = monthAmt(rights, rightsDone, prevPrevYM);

  // 올해 주관 리그(완료 딜만) — 통합 / IPO / 유증 + 최대 IPO / 최대 유상증자
  const aggAll = {}, aggIpo = {}, aggRt = {};
  let yTotAll = 0, yTotIpo = 0, yTotRt = 0, bigIpo = null, bigRt = null;
  const addLead = (g, a, v) => { (g[a] || (g[a] = { amount: 0 })).amount += v; };
  for (const r of ipo) {
    if (!ipoDone(r) || !(r.date || '').startsWith(yr)) continue;
    const t = amt(r); yTotAll += t; yTotIpo += t;
    if (t > 0 && (!bigIpo || t > bigIpo.amount)) bigIpo = { issuer: r.issuer, amount: t };
    for (const [a, v] of Object.entries(r.leads || {})) { addLead(aggAll, a, v); addLead(aggIpo, a, v); }
  }
  for (const r of rights) {
    if (!rightsDone(r) || !(r.date || '').startsWith(yr)) continue;
    const t = amt(r); yTotAll += t; yTotRt += t;
    if (t > 0 && (!bigRt || t > bigRt.amount)) bigRt = { issuer: r.issuer, amount: t };
    for (const [a, v] of Object.entries(r.leads || {})) { addLead(aggAll, a, v); addLead(aggRt, a, v); }
  }
  const mkLeague = (g, tot) => Object.entries(g).map(([a, v]) => ({ name: BROKER_FULL[a] || a, amount: v.amount, share: tot > 0 ? v.amount / tot * 100 : 0 })).sort((a, b) => b.amount - a.amount);
  const leagueAll = mkLeague(aggAll, yTotAll), leagueIpo = mkLeague(aggIpo, yTotIpo), leagueRt = mkLeague(aggRt, yTotRt);
  const topB = leagueAll[0];

  // KPI 5칸: 지난달 IPO / 지난달 유상증자 / 올해 주관1위 / 올해 최대 IPO / 올해 최대 유상증자
  $$('ecm-kpi-grid').innerHTML = `
    <a class="v1-kpi" href="ecm-deals/?tab=ipo">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> ${monthLabel} IPO</div>
      <div class="value">${fmtAmt(ipoPrev)}</div>
      <div class="sub">${fmtPct(pct(ipoPrev, ipoPrev2))} <span class="sub-text">전월 대비</span></div>
    </a>
    <a class="v1-kpi" href="ecm-deals/?tab=rights">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> ${monthLabel} 유상증자</div>
      <div class="value">${fmtAmt(rtPrev)}</div>
      <div class="sub">${fmtPct(pct(rtPrev, rtPrev2))} <span class="sub-text">전월 대비</span></div>
    </a>
    <a class="v1-kpi" href="ecm-brokers/">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9a6 6 0 0 0 12 0V3H6v6z"/><path d="M4 22h16M9 17l-2 5M15 17l2 5"/></svg> ${yr} ECM 통합 주관 1위</div>
      <div class="value compact">${topB ? topB.name : '—'}</div>
      <div class="sub"><span style="font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;">${topB ? fmtAmt(topB.amount) : ''}</span> <span class="sub-text">${topB ? '· 점유율 ' + topB.share.toFixed(1) + '%' : ''}</span></div>
    </a>
    <a class="v1-kpi" href="ecm-deals/?tab=ipo">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg> ${yr} 최대 IPO</div>
      <div class="value compact">${bigIpo ? bigIpo.issuer : '—'}</div>
      <div class="sub"><span style="font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;">${bigIpo ? fmtAmt(bigIpo.amount) : ''}</span></div>
    </a>
    <a class="v1-kpi" href="ecm-deals/?tab=rights">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${yr} 최대 유상증자</div>
      <div class="value compact">${bigRt ? bigRt.issuer : '—'}</div>
      <div class="sub"><span style="font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;">${bigRt ? fmtAmt(bigRt.amount) : ''}</span></div>
    </a>`;

  const ic = $$('ecm-ipo-count'); if (ic) ic.textContent = `${yr}년 ${summary.this_year_ipo ?? 0}건`;
  const rc = $$('ecm-rights-count'); if (rc) rc.textContent = `${yr}년 ${summary.this_year_rights ?? 0}건`;

  // 1행: 주관 TOP 10 — 통합 / IPO / 유상증자 (완료 딜 기준)
  renderLeagueRows('ecm-league-all-rows', leagueAll.slice(0, 10));
  renderLeagueRows('ecm-league-ipo-rows', leagueIpo.slice(0, 10));
  renderLeagueRows('ecm-league-rights-rows', leagueRt.slice(0, 10));
  const _setT = (id, t) => { const el = $$(id); if (el) el.textContent = t; };
  _setT('ecm-league-all-title', `${yr} ECM 통합 리그테이블`);
  _setT('ecm-league-ipo-title', `${yr} IPO 리그테이블`);
  _setT('ecm-league-rt-title', `${yr} 유상증자 리그테이블`);

  // 2행: 최근 IPO (완료 딜) / 다가오는 IPO (미완료)
  const dDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
  const dDescNull1st = (a, b) => (b.date || '9999-99-99').localeCompare(a.date || '9999-99-99');
  renderEcmDeals('ecm-recent-ipo', ipo.filter(r => ipoDone(r) && r.date).sort(dDesc).slice(0, 10), 'ipo', {hideLeads:true});
  renderEcmUpcomingDeals('ecm-upcoming-ipo', ipo.filter(r => !ipoDone(r)).sort(dDescNull1st).slice(0, 10), 'ipo', {hideLeads:true});
  // 3행: 최근 유상증자 (1차·최종 확정) / 다가오는 유상증자 (최초희망만)
  renderEcmDeals('ecm-recent-rights', rights.filter(r => rightsDone(r) && r.date).sort(dDesc).slice(0, 10), 'rights', {hideLeads:true, hideTag:true});
  renderEcmUpcomingDeals('ecm-upcoming-rights', rights.filter(r => !rightsDone(r)).sort(dDescNull1st).slice(0, 10), 'rights', {hideLeads:true, hideTag:true});
  // 4·5행: 월별 추이 (완료 딜, 최근 13개월) — 건수/금액 토글
  setupEcmTrend('ecm-ipo-trend', monthly13(ipo, ipoDone));
  setupEcmTrend('ecm-rights-trend', monthly13(rights, rightsDone));
}

function renderEcmDeals(rootId, list, kind, opts) {
  const root = $$(rootId);
  if (!root) return;
  const hideLeads = !!(opts && opts.hideLeads);
  const hideTag = !!(opts && opts.hideTag);
  const container = root.closest('.v1-deals');
  if (container) { container.classList.toggle('no-leads', hideLeads); container.classList.toggle('no-tag', hideTag); }
  if (!list.length) {
    root.innerHTML = `<div style="padding:40px 18px;text-align:center;color:var(--muted);font-size:13px;">데이터가 없습니다.</div>`;
    return;
  }
  root.innerHTML = list.map(s => {
    const total = ecmTotal(s);
    const amtHtml = total > 0
      ? `<div class="amt">${fmtAmt(total)}</div>`
      : `<div class="amt pending">미확정</div>`;
    const tag = kind === 'ipo' ? (s.market || 'IPO') : '유증';
    const sub = kind === 'ipo' ? '신규상장' : ecmTypeShort(s.type);
    const tagHtml = hideTag ? '' : `<div><span class="tag">${tag}</span></div>`;
    const leadsHtml = hideLeads ? '' : `<div class="leads">${leadTop(s.leads)}</div>`;
    const href = `ecm-deals/?tab=${kind==='rights'?'rights':'ipo'}`;
    return `
    <a class="v1-deal-row" href="${href}">
      <div class="date"><span class="d">${shortDay(s.date)}</span><span>${shortMonth(s.date)}</span></div>
      <div class="issuer"><div class="name">${s.issuer}</div><div class="series">${sub}</div></div>
      ${tagHtml}
      ${amtHtml}
      ${leadsHtml}
    </a>`;
  }).join('');
}

function renderEcmLeague(rows, yr) {
  const meta = $$('ecm-league-meta'); if (meta) meta.textContent = `${yr}.01.01 ~ 현재 · ECM 통합`;
  const title = $$('ecm-league-title'); if (title) title.textContent = `${yr} ECM 통합 주관 리그`;
  const root = $$('ecm-league-rows');
  if (!root) return;
  if (!rows.length) { root.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--muted);font-size:13px;">데이터가 없습니다.</div>`; return; }
  root.innerHTML = rows.map((r, i) => {
    const rank = i + 1, topClass = rank <= 3 ? `top${rank}` : '';
    return `<a class="v1-league-row ${topClass}" href="ecm-brokers/"><div class="rank">${rank}</div><div class="name">${r.name}</div><div class="amt">${fmtAmt(Math.round(r.amount))}</div><div class="share">${r.share.toFixed(1)}%</div></a>`;
  }).join('');
}

// 주관 리그 rows 렌더 (지정 컨테이너) — 통합/IPO/유증 공용. rootId에 따라 ecm-brokers ?scope= 자동 부여.
function renderLeagueRows(rootId, rows) {
  const root = $$(rootId); if (!root) return;
  if (!rows.length) { root.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--muted);font-size:13px;">데이터가 없습니다.</div>`; return; }
  const scope = rootId.includes('-ipo-') ? 'ipo' : rootId.includes('-rights-') ? 'rights' : 'all';
  const href = `ecm-brokers/?scope=${scope}`;
  root.innerHTML = rows.map((r, i) => {
    const rank = i + 1, topClass = rank <= 3 ? `top${rank}` : '';
    return `<a class="v1-league-row ${topClass}" href="${href}"><div class="rank">${rank}</div><div class="name">${r.name}</div><div class="amt">${fmtAmt(Math.round(r.amount))}</div><div class="share">${r.share.toFixed(1)}%</div></a>`;
  }).join('');
}

function renderEcmUpcoming(list) {
  const root = $$('ecm-upcoming-rows');
  if (!root) return;
  if (!list.length) { root.innerHTML = `<div style="padding:24px 0;text-align:center;color:var(--muted);font-size:12px;">예정된 상장이 없습니다.</div>`; return; }
  const monthAbbr = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  root.innerHTML = list.map(s => {
    const total = ecmTotal(s);
    return `
    <a class="v1-up-row" href="ecm-deals/">
      <div class="when"><span class="day">${shortDay(s.date)}</span><span class="month">${monthAbbr[parseInt(s.date.slice(5, 7)) - 1]}</span></div>
      <div class="info"><div class="name">${s.issuer}</div><div class="meta-2">${s.market || ''} · 신규상장</div></div>
      <div class="amt">${total > 0 ? fmtAmt(total) : '미확정'}</div>
    </a>`;
  }).join('');
}

// 다가오는(미완료) 딜 렌더 — 날짜 미정(상장예정)도 표기
function renderEcmUpcomingDeals(rootId, list, kind, opts) {
  const root = $$(rootId); if (!root) return;
  const hideLeads = !!(opts && opts.hideLeads);
  const hideTag = !!(opts && opts.hideTag);
  const container = root.closest('.v1-deals');
  if (container) { container.classList.toggle('no-leads', hideLeads); container.classList.toggle('no-tag', hideTag); }
  if (!list.length) { root.innerHTML = `<div style="padding:40px 18px;text-align:center;color:var(--muted);font-size:13px;">해당 건이 없습니다.</div>`; return; }
  root.innerHTML = list.map(s => {
    const total = ecmTotal(s);
    const amtHtml = total > 0 ? `<div class="amt">${fmtAmt(total)}</div>` : `<div class="amt pending">미확정</div>`;
    const tag = kind === 'ipo' ? (s.market || 'IPO') : '유증';
    const sub = kind === 'ipo' ? '상장 예정' : ecmTypeShort(s.type);
    const dt = s.date ? `<span class="d">${shortDay(s.date)}</span><span>${shortMonth(s.date)}</span>` : `<span class="d" style="font-size:12px;">예정</span>`;
    const tagHtml = hideTag ? '' : `<div><span class="tag">${tag}</span></div>`;
    const leadsHtml = hideLeads ? '' : `<div class="leads">${leadTop(s.leads)}</div>`;
    const href = `ecm-deals/?tab=${kind==='rights'?'rights':'ipo'}`;
    return `<a class="v1-deal-row" href="${href}"><div class="date">${dt}</div><div class="issuer"><div class="name">${s.issuer}</div><div class="series">${sub}</div></div>${tagHtml}${amtHtml}${leadsHtml}</a>`;
  }).join('');
}

// 월별 13개월 집계 (완료 딜) — 인포그래픽 1번 카드 데이터와 동일
function monthly13(arr, done) {
  const m = new Map();
  for (const r of arr) { if (!done(r) || !r.date) continue; const ym = r.date.slice(0, 7); const v = m.get(ym) || { count: 0, amount: 0 }; v.count++; v.amount += ecmTotal(r); m.set(ym, v); }
  const keys = [...m.keys()].sort(); if (!keys.length) return [];
  let [y, mo] = keys[keys.length - 1].split('-').map(Number); const seq = [];
  for (let i = 0; i < 13; i++) { const k = `${y}-${String(mo).padStart(2, '0')}`; const v = m.get(k) || { count: 0, amount: 0 }; seq.unshift({ label: k, count: v.count, amount: v.amount }); if (--mo === 0) { mo = 12; y--; } }
  return seq;
}

// 월별 추이 SVG (DCM 월별 발행 추이 스타일) — 막대=건수 / 선=금액
function drawEcmTrend(svg, months, mode) {
  if (!svg || !months || !months.length) { if (svg) svg.innerHTML = ''; return; }
  mode = mode || 'count';
  const W = 600, H = 200, padL = 40, padR = 5, padT = 20, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const step = innerW / months.length, barW = step * 0.55;
  const gid = 'g-' + svg.id;
  const trendTab = svg.id.includes('-rt-') || svg.id.includes('-rights-') ? 'rights' : 'ipo';
  let html = `<a href="ecm-charts/?tab=${trendTab}" target="_self">`;
  for (let i = 0; i <= 4; i++) { const y = padT + innerH * i / 4; html += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>`; }
  if (mode === 'count') {
    const maxC = Math.max(...months.map(m => m.count), 1);
    months.forEach((m, i) => { if (!m.count) return; const h = (m.count / maxC) * innerH; const x = padL + i * step + (step - barW) / 2; html += `<rect x="${x}" y="${padT + innerH - h}" width="${barW}" height="${h}" fill="#c9a24a" rx="2"/>`; });
  } else {
    const maxA = Math.max(...months.map(m => m.amount), 1);
    const pts = months.map((m, i) => { const x = padL + i * step + step / 2; const y = padT + innerH - (m.amount / maxA) * innerH; return `${x},${y}`; }).join(' ');
    html = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9a24a" stop-opacity="0.18"/><stop offset="100%" stop-color="#c9a24a" stop-opacity="0"/></linearGradient></defs>` + html;
    const first = `${padL + step / 2},${padT + innerH}`, last = `${padL + (months.length - 1) * step + step / 2},${padT + innerH}`;
    html += `<path d="M ${first} L ${pts} L ${last} Z" fill="url(#${gid})"/>`;
    html += `<polyline points="${pts}" fill="none" stroke="#c9a24a" stroke-width="2"/>`;
    months.forEach((m, i) => { const x = padL + i * step + step / 2; const y = padT + innerH - (m.amount / maxA) * innerH; html += `<circle cx="${x}" cy="${y}" r="3" fill="white" stroke="#c9a24a" stroke-width="2"/>`; });
  }
  months.forEach((m, i) => { const x = padL + i * step + step / 2; const lbl = m.label.slice(2).replace('-', '/'); html += `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#94a3b8">${lbl}</text>`; });
  html += `</a>`; svg.innerHTML = html;
}

// 차트 카드 토글(건수/금액) + 범례 동기화
function setupEcmTrend(svgId, months) {
  const svg = $$(svgId); if (!svg) return;
  const card = svg.closest('.v1-chart'); if (!card) return;
  const syncLegend = (mode) => { const it = card.querySelectorAll('.legend > span'); if (it.length >= 2) { it[0].style.display = mode === 'count' ? '' : 'none'; it[1].style.display = mode === 'amount' ? '' : 'none'; } };
  const draw = (mode) => { drawEcmTrend(svg, months, mode); syncLegend(mode); };
  draw(card.querySelector('.toggle span.active')?.dataset.mode || 'count');
  card.querySelectorAll('.toggle span').forEach(sp => sp.addEventListener('click', () => {
    card.querySelectorAll('.toggle span').forEach(x => x.classList.toggle('active', x === sp));
    draw(sp.dataset.mode);
  }));
}

/* ═══════════════ 메자닌 랜딩 (CB / BW / EB) ═══════════════ */
// 데이터: mezz_data.json {cb,bw,eb}. 발행(납입)일 = pymd, 금액 = 권면총액(bd_fta_eok, 억).
// 최근 발행 = 납입일이 오늘 이전(어제까지) / 다가오는 = 납입일이 오늘 포함 이후.
let _mezzLoaded = false;
const MEZZ_TYPES = [['cb', 'CB'], ['bw', 'BW'], ['eb', 'EB']];

async function loadMezz() {
  if (_mezzLoaded) return;
  let data;
  try { data = await NP_loadData('mezz_data.json'); }
  catch (e) { console.error('Mezz load failed', e); return; }
  _mezzLoaded = true;

  const buckets = { cb: data.cb || [], bw: data.bw || [], eb: data.eb || [] };
  const _t = new Date();
  const today = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`;

  // 지난달 발행총액(납입일 기준) — DCM/ECM 위젯과 동일 (매월 1일에 넘어감)
  const _ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = new Date(_t.getFullYear(), _t.getMonth() - 1, 1);
  const prevPrevMonth = new Date(_t.getFullYear(), _t.getMonth() - 2, 1);
  const prevYM = _ym(prevMonth), prevPrevYM = _ym(prevPrevMonth);
  const monthLabel = `${prevMonth.getFullYear()}년 ${prevMonth.getMonth() + 1}월`;
  const pct = (c, b) => b > 0 ? ((c - b) / b * 100) : null;
  const fmtPct = (v) => v == null ? '—' : `<span class="delta ${v < 0 ? 'down' : 'up'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(1)}%</span>`;
  const monthAmt = (arr, ym) => arr.filter(r => (r.pymd || '').startsWith(ym)).reduce((s, r) => s + (r.bd_fta_eok || 0), 0);

  // 위젯 3칸: CB / BW / EB 지난달 발행총액
  $$('mezz-kpi-grid').innerHTML = MEZZ_TYPES.map(([t, lbl]) => {
    const cur = monthAmt(buckets[t], prevYM), prev = monthAmt(buckets[t], prevPrevYM);
    return `
    <a class="v1-kpi" href="mezz-deals/">
      <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${monthLabel} ${lbl} 발행총액</div>
      <div class="value">${fmtAmt(cur)}</div>
      <div class="sub">${fmtPct(pct(cur, prev))} <span class="sub-text">전월 대비</span></div>
    </a>`;
  }).join('');

  // 각 유형: 최근 발행(납입일<오늘, 최신순) / 다가오는(납입일>=오늘, 임박순)
  for (const [t] of MEZZ_TYPES) {
    const arr = buckets[t];
    const recent = arr.filter(r => r.pymd && r.pymd < today)
      .sort((a, b) => (b.pymd || '').localeCompare(a.pymd || '')).slice(0, 10);
    const upcoming = arr.filter(r => r.pymd && r.pymd >= today)
      .sort((a, b) => (a.pymd || '').localeCompare(b.pymd || '')).slice(0, 10);
    renderMezzRows(`mezz-recent-${t}`, recent, false);
    renderMezzRows(`mezz-upcoming-${t}`, upcoming, true);
  }
}

function renderMezzRows(rootId, list, upcoming) {
  const root = $$(rootId); if (!root) return;
  const container = root.closest('.v1-deals');
  if (container) container.classList.add('no-leads');
  if (!list.length) {
    root.innerHTML = `<div style="padding:40px 18px;text-align:center;color:var(--muted);font-size:13px;">${upcoming ? '예정된 건이 없습니다.' : '최근 발행 건이 없습니다.'}</div>`;
    return;
  }
  root.innerHTML = list.map(s => {
    const d = s.pymd || '';
    const amt = s.bd_fta_eok;
    const amtHtml = (amt != null && amt > 0) ? `<div class="amt">${fmtAmt(amt)}</div>` : `<div class="amt pending">미정</div>`;
    const tagTxt = s.bdis_mthn || s.market || '—';
    const parts = [];
    if (s.bd_tm != null) parts.push(`${s.bd_tm}회차`);
    if (s.market) parts.push(s.market);
    const sub = parts.join(' · ') || '메자닌';
    return `
    <a class="v1-deal-row" href="mezz-deals/">
      <div class="date"><span class="d">${shortDay(d)}</span><span>${shortMonth(d)}</span></div>
      <div class="issuer"><div class="name">${s.issuer || '—'}</div><div class="series">${sub}</div></div>
      <div><span class="tag">${tagTxt}</span></div>
      ${amtHtml}
    </a>`;
  }).join('');
}

function wireSectionTabs() {
  const tabs = document.querySelectorAll('.v1-section-tab');
  if (!tabs.length) return;
  const dcm = $$('dcm-main'), ecm = $$('ecm-main'), mezz = $$('mezz-main');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    const sec = tab.dataset.section;
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    if (dcm) dcm.hidden = sec !== 'dcm';
    if (ecm) ecm.hidden = sec !== 'ecm';
    if (mezz) mezz.hidden = sec !== 'mezz';
    if (sec === 'ecm') loadEcm();
    else if (sec === 'mezz') loadMezz();
  }));
}

/* ─── boot ─── */
(async () => {
  wireSectionTabs();
  // Load summary first for KPI + the max_date used by data filtering
  try {
    const s = await NP_loadData('summary.json');
    window._summary = s;
  } catch (e) { console.error('summary load failed', e); }

  await Promise.all([fillKPI(), fillFromData()]);
})();
