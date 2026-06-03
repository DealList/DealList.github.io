/* Numbers Pool — 발행정보 편집 (관리자) · DCM(records) + ECM(ecm_ipo/ecm_rights)
 *
 * 저장 시: ① 원본 테이블 UPDATE(영구) + locked_fields(잠긴 칸) 기록
 *          ② 표시 JSON 패치·재업로드(즉시 반영, 파생값 재계산)
 *          ③ (DCM) summary.json 재계산 → 메인 KPI 반영
 * 잠금: 수정한 칸만 자동수집 덮어쓰기에서 보존.
 *   DCM = records.locked_fields (sync_to 가 DB값 복원)
 *   ECM = locked_fields + locked_values (export_web_ecm 가 복원)
 */
(async () => {
  const $ = (id) => document.getElementById(id);

  // ───────── 필드 설정 ─────────
  // tk: 테이블 컬럼 / jk: JSON 표시 키(DCM 전용) / type: won(정수원·억표기) numf(실수) text
  const DCM_FIELDS = [
    { tk: 'subscription_date', jk: 'date',        label: '청약일',     ro: true },
    { tk: 'issuer_alias',      jk: 'issuer',       label: '발행사',     ro: true },
    { tk: 'series',            jk: 'series',       label: '회차',       ro: true },
    { tk: 'issuer_full',       jk: 'issuer_full',  label: '발행사(정식)', type: 'text' },
    { tk: 'bond_type',         jk: 'type',         label: '종류',       type: 'text' },
    { tk: 'credit_rating',     jk: 'rating',       label: '등급',       type: 'text' },
    { tk: 'maturity',          jk: 'maturity',     label: '만기',       type: 'text' },
    { tk: 'initial_amount',    jk: 'init',         label: '최초모집',   type: 'won' },
    { tk: 'issue_limit',       jk: 'limit',        label: '발행한도',   type: 'won' },
    { tk: 'demand_amount',     jk: 'demand',       label: '수요예측',   type: 'won' },
    { comp: true, label: '수요예측경쟁률', from: ['demand_amount', 'initial_amount'], calc: 'x2' },
    { tk: 'final_amount',      jk: 'final',        label: '최종발행',   type: 'won' },
    { tk: 'series_total',      jk: 'series_total', label: '회차합산',   type: 'won' },
    { tk: 'rate_target',       jk: 'r_target',     label: '희망금리',   type: 'text' },
    { tk: 'rate_demand',       jk: 'r_demand',     label: '수요금리',   type: 'text' },
    { tk: 'rate_final',        jk: 'r_final',      label: '최종금리',   type: 'numf' },
  ];
  const DCM_SELECT = DCM_FIELDS.filter(f => f.tk).map(f => f.tk).join(',') + ',rcept_no,locked_fields';

  const IPO_FIELDS = [
    { tk: 'listing_date',     label: '상장일',   type: 'text' },
    { tk: 'issuer',           label: '발행사',   ro: true },
    { tk: 'market',           label: '시장',     type: 'text' },
    { tk: 'init_qty',         label: '최초수량', type: 'numf' },
    { tk: 'init_price',       label: '최초가',   type: 'numf' },
    { tk: 'final_qty',        label: '확정수량', type: 'numf' },
    { tk: 'final_price',      label: '확정가',   type: 'numf' },
    { comp: true,             label: '확정총액', from: ['final_qty', 'final_price'], calc: 'eok' },
    { tk: 'new_share_ratio',  label: '신주비율', type: 'numf' },
    { tk: 'inst_initial',     label: '기관모집', type: 'numf' },
    { tk: 'inst_subscribed',  label: '기관청약', type: 'numf' },
    { tk: 'inst_final',       label: '기관배정', type: 'numf' },
    { comp: true,             label: '기관경쟁률', from: ['inst_subscribed', 'inst_initial'], calc: 'x' },
    { tk: 'general_initial',  label: '일반모집', type: 'numf' },
    { tk: 'general_subscribed', label: '일반청약', type: 'numf' },
    { tk: 'general_final',    label: '일반배정', type: 'numf' },
    { comp: true,             label: '일반경쟁률', from: ['general_subscribed', 'general_initial'], calc: 'x' },
    { tk: 'esop_initial',     label: '우리사주모집', type: 'numf' },
    { tk: 'esop_final',       label: '우리사주배정', type: 'numf' },
    { comp: true,             label: '우리사주청약률', from: ['esop_final', 'esop_initial'], calc: 'pct' },
  ];
  const RIGHTS_FIELDS = [
    { tk: 'record_date',   label: '기준일',   type: 'text' },
    { tk: 'issuer',        label: '발행사',   ro: true },
    { tk: 'offering_type', label: '유형',     type: 'text' },
    { tk: 'payment_date',  label: '납입일',   type: 'text' },
    { tk: 'new_qty',       label: '신주수량', type: 'numf' },
    { tk: 'existing_qty',  label: '기존수량', type: 'numf' },
    { tk: 'init_qty',      label: '최초수량', type: 'numf' },
    { comp: true,          label: '증자비율', from: ['new_qty', 'existing_qty'], calc: 'pct' },
    { tk: 'init_price',    label: '최초가',   type: 'numf' },
    { tk: 'price_1',       label: '1차가',    type: 'numf' },
    { comp: true,          label: '1차총액',  from: ['new_qty', 'price_1'], calc: 'eok' },
    { tk: 'price_2',       label: '2차가',    type: 'numf' },
    { comp: true,          label: '2차총액',  from: ['new_qty', 'price_2'], calc: 'eok' },
    { tk: 'final_price',   label: '확정가',   type: 'numf' },
    { comp: true,          label: '확정총액', from: ['new_qty', 'final_price'], calc: 'eok' },
  ];

  let market = 'dcm';
  let origMap = {};  // key → 원본 행 (DCM key=PK문자열, ECM key=id)

  // ───────── 테마 ─────────
  const rootEl = document.documentElement;
  $('btn-theme').addEventListener('click', () => {
    if (rootEl.getAttribute('data-theme') === 'dark') { rootEl.removeAttribute('data-theme'); localStorage.setItem('deallist-theme', 'light'); }
    else { rootEl.setAttribute('data-theme', 'dark'); localStorage.setItem('deallist-theme', 'dark'); }
  });

  // ───────── 가드 ─────────
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }
  if (!profile) { location.replace('/login/?next=' + encodeURIComponent('/admin/data/')); return; }
  if (profile.role !== 'admin' && profile.role !== 'master') {
    const g = $('guard-msg'); g.hidden = false;
    g.innerHTML = `<h2>접근 권한 없음</h2><p>이 계정(<strong>${esc(profile.email || '')}</strong>)은 관리자가 아닙니다.</p><a href="/main/" class="admin-btn">← 메인으로</a>`;
    return;
  }
  $('me-email').textContent = profile.email || '';
  $('role-badge').textContent = profile.role === 'master' ? 'MASTER' : 'ADMIN';
  $('admin-nav').hidden = false;
  $('panel').hidden = false;
  $('btn-logout').addEventListener('click', async () => { if (!confirm('로그아웃하시겠습니까?')) return; await NP.signOut(); location.href = '/'; });
  setupTriggers();

  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const qEl = $('q'), results = $('results'), countEl = $('count'), pagerEl = $('pager');
  let dcmRows = [], ipoRows = [], rtRows = [], ecmTab = 'ipo', page = 1; const PAGE = 50;

  // ───────── 시장 토글 ─────────
  function setMarket(m) {
    market = m;
    $('seg-dcm').classList.toggle('active', m === 'dcm');
    $('seg-ecm').classList.toggle('active', m === 'ecm');
    $('f-type').style.display = (m === 'dcm') ? '' : 'none';
    $('f-rating').style.display = (m === 'dcm') ? '' : 'none';
    results.innerHTML = ''; countEl.textContent = ''; pagerEl.innerHTML = '';
    origMap = {}; dcmRows = []; page = 1;
    if (m === 'dcm') populateDcmFilters();
    applyPreset('1y');
    load();
  }
  $('seg-dcm').addEventListener('click', () => setMarket('dcm'));
  $('seg-ecm').addEventListener('click', () => setMarket('ecm'));

  function load() { return market === 'ecm' ? loadEcm() : loadDcm(); }

  function readFilters() {
    return { from: $('f-from').value || '', to: $('f-to').value || '', issuer: qEl.value.trim(), type: $('f-type').value || '', rating: $('f-rating').value || '' };
  }
  function applyPreset(preset) {
    $$('.qbtn').forEach(b => b.classList.toggle('on', b.dataset.q === preset));
    if (preset === 'all') { $('f-from').value = ''; $('f-to').value = ''; return; }
    const months = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
    const t = new Date();
    $('f-from').value = isoDate(new Date(t.getFullYear(), t.getMonth() - months, t.getDate()));
    $('f-to').value = isoDate(new Date(t.getFullYear(), t.getMonth() + 6, t.getDate()));  // 예정 건 포함 버퍼
  }
  function isoDate(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

  let dcmFiltersLoaded = false;
  async function populateDcmFilters() {
    if (dcmFiltersLoaded) return;
    dcmFiltersLoaded = true;
    try {
      const meta = await NP_loadData('meta.json');
      (meta.types || []).forEach(t => $('f-type').appendChild(opt(t)));
      (meta.ratings || []).forEach(t => $('f-rating').appendChild(opt(t)));
    } catch (e) { console.warn('[edit] meta 필터 로드 실패', e); }
  }
  function opt(v) { const o = document.createElement('option'); o.value = v; o.textContent = v; return o; }

  function renderPager(total, rerender) {
    const pages = Math.ceil(total / PAGE);
    if (pages <= 1) { pagerEl.innerHTML = ''; return; }
    pagerEl.innerHTML = '';
    const mk = (label, p, disabled) => {
      const b = document.createElement('button'); b.textContent = label; b.disabled = disabled;
      b.addEventListener('click', () => { page = p; rerender(); try { window.scrollTo(0, 0); } catch (e) {} });
      return b;
    };
    pagerEl.appendChild(mk('← 이전', page - 1, page <= 1));
    const info = document.createElement('span'); info.className = 'pinfo'; info.textContent = `${page} / ${pages}`;
    pagerEl.appendChild(info);
    pagerEl.appendChild(mk('다음 →', page + 1, page >= pages));
  }

  // ═══════════════════ DCM ═══════════════════
  async function loadDcm() {
    msg('조회 중...'); pagerEl.innerHTML = '';
    const f = readFilters();
    let qb = sb.from('records').select(DCM_SELECT)
      .order('subscription_date', { ascending: false }).order('series', { ascending: true }).limit(1000);
    if (f.from) qb = qb.gte('subscription_date', f.from);
    if (f.to) qb = qb.lte('subscription_date', f.to);
    if (f.issuer) qb = qb.ilike('issuer_alias', `%${f.issuer}%`);
    if (f.type) qb = qb.eq('bond_type', f.type);
    if (f.rating) qb = qb.eq('credit_rating', f.rating);
    const { data, error } = await qb;
    if (error) { msg('조회 실패: ' + esc(error.message)); return; }
    dcmRows = data || [];
    origMap = {};
    dcmRows.forEach(r => { origMap[[r.subscription_date, r.issuer_alias, r.series].join('|')] = r; });
    page = 1;
    renderDcmPage();
  }

  function renderDcmPage() {
    countEl.textContent = dcmRows.length ? `${dcmRows.length}건${dcmRows.length === 1000 ? '+ (최대)' : ''}` : '';
    if (!dcmRows.length) { msg('조회 결과가 없습니다.'); pagerEl.innerHTML = ''; return; }
    const slice = dcmRows.slice((page - 1) * PAGE, (page - 1) * PAGE + PAGE);
    const head = DCM_FIELDS.map(f => `<th>${f.label}</th>`).join('') + '<th></th>';
    results.innerHTML = `<div class="table-scroll"><table class="admin-table edit-table" style="min-width:1500px;"><thead><tr>${head}</tr></thead><tbody></tbody></table></div>`;
    const tbody = results.querySelector('tbody');
    slice.forEach(r => {
      const tr = document.createElement('tr');
      tr.dataset.key = [r.subscription_date, r.issuer_alias, r.series].join('|');
      tr.innerHTML = rowCells(DCM_FIELDS, r) + `<td class="save-cell"><button class="admin-btn btn-save">저장</button></td>`;
      tbody.appendChild(tr);
    });
    bindRows(tbody, DCM_FIELDS, (tr) => saveDcmRow(tr.dataset.key, tr));
    renderPager(dcmRows.length, renderDcmPage);
  }

  async function saveDcmRow(key, tr) {
    const orig = origMap[key];
    if (!orig) return;
    const patch = collectPatch(tr, DCM_FIELDS, orig);
    const btn = tr.querySelector('.btn-save');
    if (!patch) { flash(tr, '변경 없음', false); return; }
    btn.disabled = true; btn.textContent = '저장 중...';

    const prevLocked = Array.isArray(orig.locked_fields) ? orig.locked_fields : [];
    const lockedNow = Array.from(new Set([...prevLocked, ...Object.keys(patch)]));

    const { error } = await sb.from('records').update({ ...patch, locked_fields: lockedNow })
      .eq('subscription_date', orig.subscription_date).eq('issuer_alias', orig.issuer_alias).eq('series', orig.series);
    if (error) { alert('테이블 저장 실패: ' + (error.message || error)); btn.disabled = false; btn.textContent = '저장'; return; }
    Object.assign(orig, patch); orig.locked_fields = lockedNow;
    markLocked(tr, lockedNow);

    let reflect = '';
    try { const res = await patchDcmJson(orig); reflect = res.summaryOk ? ' · 사이트 반영(KPI 포함)' : ' · 발행정보만 반영 (KPI는 다음 수집)'; }
    catch (e) { console.warn('[dcm] json', e); reflect = ' · 반영은 다음 수집 때'; }
    btn.disabled = false; btn.textContent = '저장';
    flash(tr, '저장됨' + reflect, true);
  }

  async function patchDcmJson(rec) {
    const arr = await NP_loadData('data.json');
    if (!Array.isArray(arr) || !arr.length) throw new Error('data.json 형식 오류');
    const len = arr.length;
    const idx = arr.findIndex(x => (x.date || '') === (rec.subscription_date || '') && (x.issuer || '') === (rec.issuer_alias || '') && (x.series || '') === (rec.series || ''));
    if (idx < 0) throw new Error('표시 대상 아님');
    const tgt = arr[idx];
    DCM_FIELDS.forEach(f => { if (f.ro || f.comp) return; const v = rec[f.tk]; tgt[f.jk] = (f.type === 'won') ? (v == null ? null : Math.round(v)) : v; });
    if (arr.length !== len) throw new Error('배열 변형');
    await upload('data.json', arr);

    let summaryOk = false;
    try { await upload('summary.json', computeSummary(arr)); summaryOk = true; }
    catch (e) { console.warn('[dcm] summary', e); }
    return { summaryOk };
  }

  function computeSummary(records) {
    const dealsMap = {};
    for (const r of records) {
      if (r.final == null || !r.date) continue;
      const sb2 = (r.series || '').split('-')[0];
      const key = r.issuer + '|' + sb2 + '|' + r.date;
      if (!dealsMap[key]) dealsMap[key] = { issuer: r.issuer, series: sb2, date: r.date, final: 0, lead_amt: {} };
      const d = dealsMap[key]; d.final += r.final || 0;
      const la = r.lead_amt || {}; for (const a in la) d.lead_amt[a] = (d.lead_amt[a] || 0) + (la[a] || 0);
    }
    const deals = Object.values(dealsMap);
    if (!deals.length) return { updated: kstNow(), kpi: [] };
    const maxD = deals.reduce((m, d) => (d.date > m ? d.date : m), deals[0].date);
    const y = maxD.slice(0, 4), m = maxD.slice(5, 7), thisMonth = `${y}-${m}`;
    const pm = new Date(Date.UTC(+y, +m - 1, 1) - 86400000);
    const prevMonth = `${pm.getUTCFullYear()}-${String(pm.getUTCMonth() + 1).padStart(2, '0')}`;
    const thisDeals = deals.filter(d => d.date.startsWith(thisMonth));
    const prevDeals = deals.filter(d => d.date.startsWith(prevMonth));
    const thisAmt = thisDeals.reduce((s, d) => s + d.final, 0), prevAmt = prevDeals.reduce((s, d) => s + d.final, 0);
    const pct = (c, p) => (p ? Math.round((c - p) / p * 1000) / 10 : null);
    const yearStart = `${y}-01-01`;
    const yd = deals.filter(d => d.date >= yearStart);
    const yTotal = yd.reduce((s, d) => s + d.final, 0);
    const leadSum = {}; for (const d of yd) for (const a in d.lead_amt) leadSum[a] = (leadSum[a] || 0) + d.lead_amt[a];
    let topA = '', topV = 0; for (const a in leadSum) if (leadSum[a] > topV) { topV = leadSum[a]; topA = a; }
    let big = null; for (const d of yd) if (!big || d.final > big.final) big = d;
    return {
      updated: kstNow(), max_date: maxD, year: y, this_month_label: thisMonth,
      this_month_count: thisDeals.length, this_month_amount: Math.round(thisAmt),
      this_month_count_change: pct(thisDeals.length, prevDeals.length), this_month_amount_change: pct(thisAmt, prevAmt),
      this_year_top_broker: topA, this_year_top_amount: Math.round(topV), this_year_top_share: Math.round((yTotal ? topV / yTotal * 100 : 0) * 100) / 100,
      this_year_biggest_issuer: big ? big.issuer : '', this_year_biggest_series: big ? big.series : '',
      this_year_biggest_amount: big ? Math.round(big.final) : 0, this_year_biggest_date: big ? big.date : '',
    };
  }
  function kstNow() { const d = new Date(Date.now() + 9 * 3600 * 1000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; }

  // ═══════════════════ ECM ═══════════════════
  async function loadEcm() {
    msg('조회 중...'); pagerEl.innerHTML = '';
    const f = readFilters();
    let ipoQ = sb.from('ecm_ipo').select('*').order('listing_date', { ascending: false }).limit(500);
    let rtQ = sb.from('ecm_rights').select('*').order('record_date', { ascending: false }).limit(500);
    if (f.issuer) { ipoQ = ipoQ.ilike('issuer', `%${f.issuer}%`); rtQ = rtQ.ilike('issuer', `%${f.issuer}%`); }
    ipoQ = applyEcmDate(ipoQ, 'listing_date', f);
    rtQ = applyEcmDate(rtQ, 'record_date', f);
    const [ipoRes, rtRes] = await Promise.all([ipoQ, rtQ]);
    if (ipoRes.error || rtRes.error) { msg('조회 실패: ' + esc((ipoRes.error || rtRes.error).message)); return; }
    ipoRows = ipoRes.data || [];
    rtRows = rtRes.data || [];
    origMap = {};
    ipoRows.forEach(r => { origMap['ipo:' + r.id] = r; });
    rtRows.forEach(r => { origMap['rights:' + r.id] = r; });
    ecmTab = 'ipo'; page = 1;
    renderEcmTab();
  }
  function applyEcmDate(qb, col, f) {
    // 날짜 미정(null=진행 중) 행은 항상 포함 + 범위 내 dated 행
    if (!f.from && !f.to) return qb;
    const range = [];
    if (f.from) range.push(`${col}.gte.${f.from}`);
    if (f.to) range.push(`${col}.lte.${f.to}`);
    const rangeCond = range.length === 1 ? range[0] : `and(${range.join(',')})`;
    return qb.or(`${col}.is.null,${rangeCond}`);
  }

  function renderEcmTab() {
    const total = ipoRows.length + rtRows.length;
    countEl.textContent = total ? `IPO ${ipoRows.length} · 유증 ${rtRows.length}` : '';
    const tabs = `<div class="ecm-tabs">
      <button class="etab ${ecmTab === 'ipo' ? 'on' : ''}" data-tab="ipo">IPO (${ipoRows.length})</button>
      <button class="etab ${ecmTab === 'rights' ? 'on' : ''}" data-tab="rights">유상증자 (${rtRows.length})</button>
    </div>`;
    const rows = ecmTab === 'ipo' ? ipoRows : rtRows;
    const fields = ecmTab === 'ipo' ? IPO_FIELDS : RIGHTS_FIELDS;
    if (!rows.length) {
      results.innerHTML = tabs + `<div class="admin-muted" style="padding:26px;text-align:center;">${total ? '해당 유형 결과가 없습니다.' : '조회 결과가 없습니다.'}</div>`;
      bindEcmTabs(); pagerEl.innerHTML = ''; return;
    }
    const slice = rows.slice((page - 1) * PAGE, (page - 1) * PAGE + PAGE);
    const head = fields.map(f => `<th>${f.label}</th>`).join('') + '<th></th>';
    results.innerHTML = tabs + `<div class="table-scroll"><table class="admin-table edit-table" data-kind="${ecmTab}" style="min-width:${(fields.length + 1) * 105}px;"><thead><tr>${head}</tr></thead><tbody></tbody></table></div>`;
    const tbody = results.querySelector('tbody');
    slice.forEach(r => {
      const tr = document.createElement('tr'); tr.dataset.id = r.id;
      tr.innerHTML = rowCells(fields, r) + `<td class="save-cell"><button class="admin-btn btn-save">저장</button></td>`;
      tbody.appendChild(tr);
    });
    bindRows(tbody, fields, (tr) => saveEcmRow(ecmTab, tr.dataset.id, tr));
    bindEcmTabs();
    renderPager(rows.length, renderEcmTab);
  }
  function bindEcmTabs() {
    results.querySelectorAll('.etab').forEach(b => b.addEventListener('click', () => { ecmTab = b.dataset.tab; page = 1; renderEcmTab(); }));
  }

  async function saveEcmRow(kind, id, tr) {
    const orig = origMap[kind + ':' + id];
    if (!orig) return;
    const fields = kind === 'ipo' ? IPO_FIELDS : RIGHTS_FIELDS;
    const table = kind === 'ipo' ? 'ecm_ipo' : 'ecm_rights';
    const patch = collectPatch(tr, fields, orig);
    const btn = tr.querySelector('.btn-save');
    if (!patch) { flash(tr, '변경 없음', false); return; }
    btn.disabled = true; btn.textContent = '저장 중...';

    const prevLf = Array.isArray(orig.locked_fields) ? orig.locked_fields : [];
    const lockedNow = Array.from(new Set([...prevLf, ...Object.keys(patch)]));
    const prevLv = (orig.locked_values && typeof orig.locked_values === 'object') ? orig.locked_values : {};
    const lockedVals = { ...prevLv }; for (const k of Object.keys(patch)) lockedVals[k] = patch[k];

    const { error } = await sb.from(table).update({ ...patch, locked_fields: lockedNow, locked_values: lockedVals }).eq('id', orig.id);
    if (error) { alert('저장 실패: ' + (error.message || error)); btn.disabled = false; btn.textContent = '저장'; return; }
    Object.assign(orig, patch); orig.locked_fields = lockedNow; orig.locked_values = lockedVals;
    markLocked(tr, lockedNow);

    let reflect = '';
    try { await patchEcmJson(kind, orig); reflect = ' · 사이트 반영됨'; }
    catch (e) { console.warn('[ecm] json', e); reflect = ' · 반영은 다음 수집 때'; }
    btn.disabled = false; btn.textContent = '저장';
    flash(tr, '저장됨' + reflect, true);
  }

  async function patchEcmJson(kind, row) {
    const data = await NP_loadData('ecm_data.json');
    if (!data || !Array.isArray(data.ipo) || !Array.isArray(data.rights)) throw new Error('ecm_data.json 형식 오류');
    const arr = kind === 'ipo' ? data.ipo : data.rights;
    const rec = kind === 'ipo' ? jsIpoRecord(row) : jsRightsRecord(row);
    const idx = arr.findIndex(x =>
      (x.issuer || '') === (rec.issuer || '') &&
      (x.rcept || '') === (rec.rcept || '') &&
      (kind !== 'rights' || (x.seq || 0) === (rec.seq || 0)));
    if (idx < 0) throw new Error('표시 대상 아님 (ecm_data.json 에 없음)');
    arr[idx] = rec;
    await upload('ecm_data.json', data);
  }

  function jsIpoRecord(r) {
    const iq = num(r.init_qty), ip = num(r.init_price), fq = num(r.final_qty), fp = num(r.final_price);
    const nr = num(r.new_share_ratio);
    const li = num(r.inst_initial), ls = num(r.inst_subscribed), lf = num(r.inst_final);
    const gi = num(r.general_initial), gs = num(r.general_subscribed), gf = num(r.general_final);
    const ei = num(r.esop_initial), ef = num(r.esop_final);
    return {
      date: r.listing_date || '', issuer: r.issuer || '', market: r.market || '',
      init_qty: iq, init_price: ip, init_total: eok(iq, ip),
      final_qty: fq, final_price: fp, final_total: eok(fq, fp),
      new_ratio: nr, old_ratio: (nr != null ? Math.round((1 - nr) * 1e4) / 1e4 : null),
      inst: { initial: li, subscribed: ls, compete: ratio(ls, li), final: lf },
      general: { initial: gi, subscribed: gs, compete: ratio(gs, gi), final: gf },
      esop: { initial: ei, final: ef, rate: ratio(ef, ei) },
      leads: r.lead_amounts || {}, uw: r.uw_amounts || {},
      rcept: latestRcept(r.rcept_no_stage1, r.rcept_no_final),
    };
  }
  function jsRightsRecord(r) {
    const e = num(r.new_qty), f = num(r.existing_qty), iq = num(r.init_qty), ip = num(r.init_price);
    const k = num(r.price_1), m = num(r.price_2), o = num(r.final_price);
    return {
      date: r.record_date || '', issuer: r.issuer || '', type: r.offering_type || '', payment: r.payment_date || '',
      new_qty: e, existing_qty: f, increase_ratio: ratio(e, f),
      init_qty: iq, init_price: ip, init_total: eok(iq, ip),
      price_1: k, total_1: eok(e, k), price_2: m, total_2: eok(e, m),
      final_price: o, final_total: eok(e, o),
      leads: r.lead_amounts || {}, uw: r.uw_amounts || {},
      seq: r.issue_seq || 0, rcept: latestRcept(r.rcept_no_stage1, r.rcept_no_final1, r.rcept_no_final2),
    };
  }
  function num(v) { return (typeof v === 'number') ? v : null; }
  function eok(q, p) { return (typeof q === 'number' && typeof p === 'number') ? Math.round(q * p / 1e8) : null; }
  function ratio(n, d) { return (typeof n === 'number' && typeof d === 'number' && d) ? Math.round(n / d * 100) / 100 : null; }
  function latestRcept() { const xs = Array.prototype.slice.call(arguments).filter(Boolean).map(String); return xs.length ? xs.reduce((a, b) => a > b ? a : b) : ''; }

  // ═══════════════════ 공통 ═══════════════════
  function rowCells(fields, r) {
    return fields.map((f, i) => {
      if (f.comp) {
        return `<td class="comp-cell" data-comp="${i}">${compCalc(f.calc, num(r[f.from[0]]), num(r[f.from[1]]))}</td>`;
      }
      const v = r[f.tk];
      const numCls = (f.type === 'won' || f.type === 'numf') ? 'num' : '';
      const ro = f.ro ? 'readonly' : '';
      const wrap = f.type === 'won' ? 'amt-won' : '';
      const eokSpan = (f.type === 'won' && v != null && v !== '') ? `<span class="cell-eok">${fmtEok(v)}</span>` : '';
      const locked = !f.ro && Array.isArray(r.locked_fields) && r.locked_fields.includes(f.tk);
      const lockCls = locked ? ' locked' : '';
      const lockTitle = locked ? ' title="수기 잠금 — 자동수집이 덮어쓰지 않음"' : '';
      return `<td class="${wrap}"><input data-tk="${f.tk}" class="${numCls}${lockCls}"${lockTitle} ${ro} value="${escAttr(v == null ? '' : v)}" />${eokSpan}</td>`;
    }).join('');
  }

  function bindRows(tbody, fields, saveFn) {
    tbody.querySelectorAll('.btn-save').forEach(btn => btn.addEventListener('click', () => saveFn(btn.closest('tr'))));
    tbody.querySelectorAll('tr').forEach(tr => {
      const recompute = () => fields.forEach((f, i) => {
        if (!f.comp) return;
        const cell = tr.querySelector('.comp-cell[data-comp="' + i + '"]'); if (!cell) return;
        cell.textContent = compCalc(f.calc, getInputNum(tr, f.from[0]), getInputNum(tr, f.from[1]));
      });
      tr.querySelectorAll('input[data-tk]').forEach(inp => {
        const f = fields.find(x => x.tk === inp.dataset.tk);
        inp.addEventListener('input', () => {
          if (f && f.type === 'won') {
            const span = inp.parentElement.querySelector('.cell-eok');
            if (span) { const s = inp.value.replace(/,/g, '').trim(); const n = Number(s); span.textContent = (s !== '' && isFinite(n)) ? fmtEok(n) : ''; }
          }
          recompute();
        });
      });
    });
  }
  function getInputNum(tr, tk) {
    const inp = tr.querySelector('input[data-tk="' + tk + '"]');
    if (!inp) return null;
    const s = inp.value.replace(/,/g, '').trim(); const n = Number(s);
    return (s !== '' && isFinite(n)) ? n : null;
  }
  // 자동계산 표기: eok(억) · x(경쟁률 배) · x2(소수2자리 배) · pct(%)
  function compCalc(calc, a, b) {
    if (typeof a !== 'number' || typeof b !== 'number') return '—';
    if (calc === 'eok') return Math.round(a * b / 1e8).toLocaleString() + '억';
    if (!b) return '—';
    if (calc === 'x')   return (Math.round(a / b * 100) / 100).toLocaleString() + '배';
    if (calc === 'x2')  return (a / b).toFixed(2) + '배';
    if (calc === 'pct') return ((Math.round(a / b * 100) / 100) * 100).toFixed(1) + '%';
    return '—';
  }

  function collectPatch(tr, fields, orig) {
    const patch = {}; let changed = false;
    tr.querySelectorAll('input[data-tk]').forEach(inp => {
      const f = fields.find(x => x.tk === inp.dataset.tk);
      if (!f || f.ro) return;
      const parsed = parseField(f, inp.value);
      if (!valEq(parsed, orig[f.tk])) { patch[f.tk] = parsed; changed = true; }
    });
    return changed ? patch : null;
  }

  function markLocked(tr, lockedNow) {
    tr.querySelectorAll('input[data-tk]').forEach(inp => {
      if (lockedNow.includes(inp.dataset.tk)) { inp.classList.add('locked'); inp.title = '수기 잠금 — 자동수집이 덮어쓰지 않음'; }
    });
  }

  async function upload(filename, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const { error } = await sb.storage.from('site-data').upload(filename, blob, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error(error.message || '업로드 실패');
  }

  function parseField(f, raw) {
    const s = (raw || '').trim();
    if (f.type === 'won' || f.type === 'numf') {
      if (s === '') return null;
      const n = Number(s.replace(/,/g, ''));
      if (!isFinite(n)) return null;
      return f.type === 'won' ? Math.round(n) : n;
    }
    return s === '' ? null : s;
  }
  function valEq(a, b) { if ((a == null || a === '') && (b == null || b === '')) return true; return a === b; }
  function fmtEok(v) { const n = Number(v); return isFinite(n) ? (n / 1e8).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '억' : ''; }
  function msg(t) { results.innerHTML = `<div class="admin-muted" style="padding:26px;text-align:center;">${esc(t)}</div>`; }
  function flash(tr, m, ok) {
    if (ok) { tr.classList.add('row-saved'); setTimeout(() => tr.classList.remove('row-saved'), 1500); }
    const cell = tr.querySelector('.save-cell'); const old = cell.querySelector('.flash'); if (old) old.remove();
    const s = document.createElement('div'); s.className = 'flash';
    s.style.cssText = 'font-size:10.5px;margin-top:3px;color:' + (ok ? 'var(--green)' : 'var(--muted)') + ';';
    s.textContent = m; cell.appendChild(s);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // ───────── 이벤트 ─────────
  $$('.qbtn').forEach(b => b.addEventListener('click', () => { applyPreset(b.dataset.q); load(); }));
  $('btn-search').addEventListener('click', () => { page = 1; load(); });
  $('btn-reset').addEventListener('click', () => {
    qEl.value = ''; $('f-type').value = ''; $('f-rating').value = '';
    applyPreset('1y'); load();
  });
  qEl.addEventListener('keydown', e => { if (e.key === 'Enter') { page = 1; load(); } });

  // ───────── 수동 수집 트리거 ─────────
  function setupTriggers() {
    wireTrigger('btn-trigger-dart', 'trigger-status', 'trigger_dart_update', 'DCM', 'https://github.com/DealList/DealList.github.io/actions/workflows/data-update.yml');
    wireTrigger('btn-trigger-ecm', 'trigger-status-ecm', 'trigger_ecm_update', 'ECM', 'https://github.com/DealList/DealList.github.io/actions/workflows/ecm-data-update.yml');
  }
  function wireTrigger(btnId, statusId, rpc, label, actionsUrl) {
    const btn = $(btnId); if (!btn) return;
    btn.addEventListener('click', async () => {
      const box = $(statusId);
      if (!confirm(`지금 ${label} 데이터 수집을 실행하시겠습니까?\n\n자동 수집과 동일한 작업이며 약 3~5분 후 사이트에 반영됩니다.`)) return;
      btn.disabled = true; btn.textContent = '실행 요청 중...';
      box.hidden = false; box.className = 'trigger-status';
      box.innerHTML = `<div class="ts-title">GitHub Actions 에 요청 보내는 중...</div>`;
      try {
        const { error } = await sb.rpc(rpc);
        if (error) throw error;
        const now = new Date(), fin = new Date(now.getTime() + 5 * 60 * 1000);
        const fmt = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        box.className = 'trigger-status status-success';
        box.innerHTML = `<div class="ts-title">✅ 실행 요청 완료</div><div>${label} 수집 워크플로우가 시작됐습니다.</div>` +
          `<div class="ts-meta" style="margin-top:6px;">• 요청 ${fmt(now)} · 예상 완료 ~${fmt(fin)}<br>• <a href="${actionsUrl}" target="_blank" rel="noopener">진행 상황 확인</a></div>`;
        btn.textContent = '✓ 요청 완료';
        setTimeout(() => { btn.disabled = false; btn.textContent = '지금 실행'; }, 30000);
      } catch (e) {
        let m = e.message || String(e);
        if (/permission denied/i.test(m)) m += ' (관리자 권한 필요 — 로그아웃 후 재로그인)';
        box.className = 'trigger-status status-error';
        box.innerHTML = `<div class="ts-title">❌ 실행 요청 실패</div><div>${esc(m)}</div>`;
        btn.disabled = false; btn.textContent = '지금 실행';
      }
    });
  }

  // 초기: DCM 최근 1년 자동 조회
  setMarket('dcm');
})();
