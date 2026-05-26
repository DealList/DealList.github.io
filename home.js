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
      fetch('summary.json', { cache: 'no-store' }).then(r => r.json()),
      fetch('data.json', { cache: 'no-store' }).then(r => r.json()),
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

    const monthLabel = `${prevMonth.getFullYear()}년 ${String(prevMonth.getMonth() + 1).padStart(2, '0')}월`;
    const fmtPct = (v) => v == null ? '—' :
      `<span class="delta ${v < 0 ? 'down' : 'up'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(1)}%</span>`;

    document.getElementById('kpi-grid').innerHTML = `
      <div class="v1-kpi">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          ${monthLabel} 발행건수
        </div>
        <div class="value">${prev.count}<small>건</small></div>
        <div class="sub">
          ${fmtPct(countChange)}
          <span class="sub-text">전월 대비</span>
        </div>
      </div>
      <div class="v1-kpi">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          ${monthLabel} 발행총액
        </div>
        <div class="value">${fmtAmt(prev.amount)}</div>
        <div class="sub">
          ${fmtPct(amountChange)}
          <span class="sub-text">전월 대비</span>
        </div>
      </div>
      <div class="v1-kpi">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9a6 6 0 0 0 12 0V3H6v6z"/><path d="M4 22h16M9 17l-2 5M15 17l2 5"/></svg>
          올해 주관 1위
        </div>
        <div class="value compact">${BROKER_FULL[s.this_year_top_broker] || s.this_year_top_broker}</div>
        <div class="sub">
          <span style="font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums;">${fmtAmt(s.this_year_top_amount)}</span>
          <span class="sub-text">· 점유율 ${s.this_year_top_share}%</span>
        </div>
      </div>
      <div class="v1-kpi">
        <div class="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
          올해 최대 단일 발행
        </div>
        <div class="value compact">${s.this_year_biggest_issuer} <span style="color: var(--muted); font-size: 14px;">${s.this_year_biggest_series}회차</span></div>
        <div class="sub">
          <span style="font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums;">${fmtAmt(s.this_year_biggest_amount)}</span>
          <span class="sub-text">· ${s.this_year_biggest_date}</span>
        </div>
      </div>
    `;
  } catch (e) { console.error('KPI load failed', e); }
}

/* ─── (2) data.json — derive recent/league/trend/upcoming ─── */
async function fillFromData() {
  let data;
  try { data = await fetch('data.json', { cache: 'no-store' }).then(r => r.json()); }
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

  /* ─── Recent deals (latest 10 issued, exclude future ones) ─── */
  const recentList = series.filter(s => s.date <= today).slice(0, 10);
  renderRecentDeals(recentList);

  /* ─── 다가오는 청약 — deals 페이지 정렬 (date desc) 의 상위 5건.
       사용자 today 와 무관 (과거/미래 섞여도 OK). 금액 표기:
       finalAmt > 0 (수요예측 완료) → series_total (= finalAmt 합)
       finalAmt 없음 (수요예측 전)   → initAmt (모든 트랜치 init 합) */
  const upcomingList = series.slice(0, 5);
  renderUpcoming(upcomingList);

  /* ─── League table TOP 10 (current year) ─── */
  const year = today.slice(0, 4);
  const yearSeries = series.filter(s => s.date.startsWith(year));
  const yearTotal = yearSeries.reduce((sum, s) => sum + (s.finalAmt || 0), 0);
  const brokerAgg = {};
  for (const s of yearSeries) {
    Object.entries(s.leadAmts).forEach(([broker, amt]) => {
      if (!brokerAgg[broker]) brokerAgg[broker] = { amount: 0, count: 0 };
      brokerAgg[broker].amount += amt;
      brokerAgg[broker].count++;
    });
  }
  const leagueRows = Object.entries(brokerAgg)
    .map(([broker, v]) => ({
      name: BROKER_FULL[broker] || broker,
      amount: v.amount,
      share: yearTotal > 0 ? (v.amount / yearTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  renderLeague(leagueRows, year);

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

  // 4) 초기 mode 는 .toggle .active 가 가진 mode (기본 count)
  const activeToggle = document.querySelector(".v1-chart .toggle span.active");
  const initMode = activeToggle ? activeToggle.dataset.mode : "count";
  renderTrend(_trendData, initMode);

  // 5) 토글 클릭 → mode 전환 + 즉시 재렌더
  document.querySelectorAll(".v1-chart .toggle span").forEach((sp) => {
    sp.onclick = () => {
      document.querySelectorAll(".v1-chart .toggle span")
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
  if (!list.length) {
    root.innerHTML = `<div style="padding: 40px 18px; text-align: center; color: var(--muted); font-size: 13px;">최근 발행 데이터가 없습니다.</div>`;
    return;
  }
  root.innerHTML = list.map(s => {
    // 수요예측 전 (= finalAmt 미정) 인 건들은 금액·주관사 자리에 placeholder 대신
    // "수요예측 예정" 한 줄 표시 — finalAmt > 0 이어야 priced 로 인정.
    const isPriced = (s.finalAmt || 0) > 0;
    const amtHtml = isPriced
      ? `<div class="amt">${s.finalAmt.toLocaleString()}<small>억</small></div>`
      : `<div class="amt pending">수요예측 예정</div>`;
    const leadsHtml = isPriced
      ? `<div class="leads">${[...s.leads].slice(0, 3).join(' · ')}</div>`
      : `<div class="leads"></div>`;
    return `
    <a class="v1-deal-row" href="deals/" data-type="${s.type || ''}">
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
      ${leadsHtml}
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
  const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  root.innerHTML = list.map(s => {
    // 금액: series_total 이 있으면 그대로,
    //       아직 없으면 (회차합산 미확정) 모든 트랜치 최초모집액 합 (initAmt)
    const amt = (s.seriesTotal != null && s.seriesTotal > 0) ? s.seriesTotal : (s.initAmt || 0);
    return `
    <a class="v1-up-row" href="deals/">
      <div class="when">
        <span class="day">${shortDay(s.date)}</span>
        <span class="month">${monthAbbr[parseInt(s.date.slice(5,7))-1]}</span>
      </div>
      <div class="info">
        <div class="name">${s.issuer}</div>
        <div class="meta-2">${s.series}회차 · ${s.rating || '—'} · ${s.type}</div>
      </div>
      <div class="amt">${amt.toLocaleString()}억</div>
    </a>`;
  }).join('');
}

function renderLeague(rows, year) {
  document.getElementById('league-meta').textContent = `${year}.01.01 ~ 현재`;
  const root = document.getElementById('league-rows');
  if (!rows.length) {
    root.innerHTML = `<div style="padding: 40px 0; text-align: center; color: var(--muted); font-size: 13px;">데이터가 없습니다.</div>`;
    return;
  }
  root.innerHTML = rows.map((r, i) => {
    const rank = i + 1;
    const topClass = rank <= 3 ? `top${rank}` : '';
    return `
      <div class="v1-league-row ${topClass}">
        <div class="rank">${rank}</div>
        <div class="name">${r.name}</div>
        <div class="amt">${fmtAmt(Math.round(r.amount))}</div>
        <div class="share">${r.share.toFixed(1)}%</div>
      </div>
    `;
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

  let html = "";

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
      html += `<rect x="${x}" y="${padT + innerH - h}" width="${barW}" height="${h}" fill="#94a3b8" rx="2"/>`;
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
        <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0"/>
      </linearGradient>
    </defs>` + html;
    const first = `${padL + step / 2},${padT + innerH}`;
    const last = `${padL + (months.length - 1) * step + step / 2},${padT + innerH}`;
    html += `<path d="M ${first} L ${points} L ${last} Z" fill="url(#trendG)"/>`;
    html += `<polyline points="${points}" fill="none" stroke="#1d4ed8" stroke-width="2"/>`;
    months.forEach((m, i) => {
      const x = padL + i * step + step / 2;
      const y = padT + innerH - (m.amount / maxAmt) * innerH;
      html += `<circle cx="${x}" cy="${y}" r="3" fill="white" stroke="#1d4ed8" stroke-width="2"/>`;
    });
  }

  // x labels (월) — 모드 무관 공통
  months.forEach((m, i) => {
    const x = padL + i * step + step / 2;
    const lbl = m.label.slice(2).replace("-", "/");
    html += `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="9" fill="#94a3b8">${lbl}</text>`;
  });

  svg.innerHTML = html;

  // legend 동기화 — 활성 모드만 표시
  const legendItems = document.querySelectorAll(".v1-chart .legend > span");
  if (legendItems.length >= 2) {
    legendItems[0].style.display = mode === "count" ? "" : "none";
    legendItems[1].style.display = mode === "amount" ? "" : "none";
  }
}

/* ─── boot ─── */
(async () => {
  // Load summary first for KPI + the max_date used by data filtering
  try {
    const s = await fetch('summary.json', { cache: 'no-store' }).then(r => r.json());
    window._summary = s;
  } catch (e) { console.error('summary load failed', e); }

  await Promise.all([fillKPI(), fillFromData()]);
})();
