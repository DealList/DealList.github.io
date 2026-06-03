/* Numbers Pool — 발행정보 편집 (관리자)
 * DCM(records) 값 수정 → ① 테이블 UPDATE(영구) ② data.json 패치·재업로드(즉시 반영)
 * PK(청약일·발행사·회차)는 읽기전용. 파생 수치(KPI·주관사)는 다음 수집 때 갱신.
 */
(async () => {
  const $ = (id) => document.getElementById(id);

  // tk: records 테이블 컬럼 / jk: data.json 표시 키 / type: won(정수원)·numf(실수)·text
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
    { tk: 'final_amount',      jk: 'final',        label: '최종발행',   type: 'won' },
    { tk: 'series_total',      jk: 'series_total', label: '회차합산',   type: 'won' },
    { tk: 'rate_target',       jk: 'r_target',     label: '희망금리',   type: 'text' },
    { tk: 'rate_demand',       jk: 'r_demand',     label: '수요금리',   type: 'text' },
    { tk: 'rate_final',        jk: 'r_final',      label: '최종금리',   type: 'numf' },
  ];
  const SELECT_COLS = DCM_FIELDS.map(f => f.tk).join(',') + ',rcept_no';

  // ── 테마 ──
  const rootEl = document.documentElement;
  $('btn-theme').addEventListener('click', () => {
    if (rootEl.getAttribute('data-theme') === 'dark') { rootEl.removeAttribute('data-theme'); localStorage.setItem('deallist-theme', 'light'); }
    else { rootEl.setAttribute('data-theme', 'dark'); localStorage.setItem('deallist-theme', 'dark'); }
  });

  // ── 가드 ──
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }
  if (!profile) { location.replace('/login/?next=' + encodeURIComponent('/admin/data/edit/')); return; }
  if (profile.role !== 'admin') {
    const g = $('guard-msg'); g.hidden = false;
    g.innerHTML = `<h2>접근 권한 없음</h2><p>이 계정(<strong>${esc(profile.email || '')}</strong>)은 관리자가 아닙니다.</p><a href="/main/" class="admin-btn">← 메인으로</a>`;
    return;
  }
  $('me-email').textContent = profile.email || '';
  $('admin-nav').hidden = false;
  $('panel').hidden = false;
  $('btn-logout').addEventListener('click', async () => { if (!confirm('로그아웃하시겠습니까?')) return; await NP.signOut(); location.href = '/'; });

  const qEl = $('q'), results = $('results'), countEl = $('count');
  let origMap = {};

  // ── 검색 ──
  async function search() {
    const q = qEl.value.trim();
    if (!q) { results.innerHTML = '<div class="admin-muted" style="padding:24px;text-align:center;">발행사명을 입력하세요.</div>'; countEl.textContent = ''; return; }
    results.innerHTML = '<div class="admin-muted" style="padding:24px;text-align:center;">검색 중...</div>';
    const { data, error } = await sb.from('records')
      .select(SELECT_COLS)
      .ilike('issuer_alias', `%${q}%`)
      .order('subscription_date', { ascending: false })
      .order('series', { ascending: true })
      .limit(100);
    if (error) { results.innerHTML = `<div class="admin-muted" style="padding:24px;text-align:center;">검색 실패: ${esc(error.message)}</div>`; return; }
    render(data || []);
  }

  function render(rows) {
    origMap = {};
    countEl.textContent = rows.length ? `${rows.length}건${rows.length === 100 ? ' (최대 100)' : ''}` : '';
    if (!rows.length) { results.innerHTML = '<div class="admin-muted" style="padding:30px;text-align:center;">검색 결과가 없습니다.</div>'; return; }

    const head = DCM_FIELDS.map(f => `<th>${f.label}</th>`).join('') + '<th></th>';
    results.innerHTML = `<div class="table-scroll"><table class="admin-table edit-table" style="min-width:1400px;"><thead><tr>${head}</tr></thead><tbody></tbody></table></div>`;
    const tbody = results.querySelector('tbody');

    rows.forEach(r => {
      const key = recKey(r);
      origMap[key] = Object.assign({}, r);
      const tr = document.createElement('tr');
      tr.dataset.key = key;
      tr.innerHTML = DCM_FIELDS.map(f => {
        const v = r[f.tk];
        const numCls = (f.type === 'won' || f.type === 'numf') ? 'num' : '';
        const ro = f.ro ? 'readonly' : '';
        const wrap = f.type === 'won' ? 'amt-won' : '';
        const eok = (f.type === 'won' && v != null && v !== '') ? `<span class="cell-eok">${fmtEok(v)}</span>` : '';
        return `<td class="${wrap}"><input data-tk="${f.tk}" class="${numCls}" ${ro} value="${escAttr(v == null ? '' : v)}" />${eok}</td>`;
      }).join('') + `<td class="save-cell"><button class="admin-btn btn-save">저장</button></td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-save').forEach(btn =>
      btn.addEventListener('click', () => { const tr = btn.closest('tr'); saveRow(tr.dataset.key, tr); }));

    // 금액 입력 시 억 표기 갱신
    tbody.querySelectorAll('input[data-tk]').forEach(inp => {
      const f = DCM_FIELDS.find(x => x.tk === inp.dataset.tk);
      if (f && f.type === 'won') inp.addEventListener('input', () => {
        const span = inp.parentElement.querySelector('.cell-eok');
        if (!span) return;
        const s = inp.value.replace(/,/g, '').trim();
        const n = Number(s);
        span.textContent = (s !== '' && isFinite(n)) ? fmtEok(n) : '';
      });
    });
  }

  // ── 저장 ──
  async function saveRow(key, tr) {
    const orig = origMap[key];
    if (!orig) return;

    const tablePatch = {};
    let changed = false;
    tr.querySelectorAll('input[data-tk]').forEach(inp => {
      const f = DCM_FIELDS.find(x => x.tk === inp.dataset.tk);
      if (!f || f.ro) return;
      const parsed = parseField(f, inp.value);
      if (!valEq(parsed, orig[f.tk])) { tablePatch[f.tk] = parsed; changed = true; }
    });

    const btn = tr.querySelector('.btn-save');
    if (!changed) { flash(tr, '변경 없음', false); return; }

    btn.disabled = true; btn.textContent = '저장 중...';

    // 1) 테이블 UPDATE (원본 PK 로 지정)
    const { error: upErr } = await sb.from('records').update(tablePatch)
      .eq('subscription_date', orig.subscription_date)
      .eq('issuer_alias', orig.issuer_alias)
      .eq('series', orig.series);
    if (upErr) {
      alert('테이블 저장 실패: ' + (upErr.message || upErr));
      btn.disabled = false; btn.textContent = '저장';
      return;
    }
    Object.assign(orig, tablePatch);  // 로컬 원본 갱신

    // 2) data.json 패치 + 재업로드 (즉시 반영)
    let reflect = '';
    try {
      await patchJson(orig);
      reflect = ' · 사이트 반영됨';
    } catch (e) {
      console.warn('[edit] data.json 패치 실패', e);
      reflect = ' · 반영은 다음 수집 때';
    }
    btn.disabled = false; btn.textContent = '저장';
    flash(tr, '저장됨' + reflect, true);
  }

  // ── data.json 안전 패치 ──
  async function patchJson(rec) {
    const arr = await NP_loadData('data.json');
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('data.json 형식 오류');
    const len = arr.length;
    const idx = arr.findIndex(x =>
      (x.date || '') === (rec.subscription_date || '') &&
      (x.issuer || '') === (rec.issuer_alias || '') &&
      (x.series || '') === (rec.series || ''));
    if (idx < 0) throw new Error('표시 대상 아님 (data.json 에 없음)');

    const tgt = arr[idx];
    DCM_FIELDS.forEach(f => {
      if (f.ro) return;
      const v = rec[f.tk];
      tgt[f.jk] = (f.type === 'won') ? (v == null ? null : Math.round(v)) : v;
    });

    // 안전 검증 — 구조가 변하지 않았는지
    if (!Array.isArray(arr) || arr.length !== len) throw new Error('배열 변형 감지 — 업로드 중단');

    const blob = new Blob([JSON.stringify(arr)], { type: 'application/json' });
    const { error } = await sb.storage.from('site-data').upload('data.json', blob, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error(error.message || '업로드 실패');
  }

  // ── 입력 파싱 ──
  function parseField(f, raw) {
    const s = (raw || '').trim();
    if (f.type === 'won') {
      if (s === '') return null;
      const n = Number(s.replace(/,/g, ''));
      return isFinite(n) ? Math.round(n) : null;
    }
    if (f.type === 'numf') {
      if (s === '') return null;
      const n = Number(s.replace(/,/g, ''));
      return isFinite(n) ? n : null;
    }
    return s === '' ? null : s;
  }
  function valEq(a, b) {
    if ((a == null || a === '') && (b == null || b === '')) return true;
    return a === b;
  }

  function recKey(r) { return [r.subscription_date, r.issuer_alias, r.series].join('|'); }
  function fmtEok(v) { const n = Number(v); return isFinite(n) ? (n / 1e8).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '억' : ''; }

  function flash(tr, msg, ok) {
    if (ok) { tr.classList.add('row-saved'); setTimeout(() => tr.classList.remove('row-saved'), 1500); }
    const cell = tr.querySelector('.save-cell');
    const old = cell.querySelector('.flash'); if (old) old.remove();
    const s = document.createElement('div');
    s.className = 'flash';
    s.style.cssText = 'font-size:10.5px;margin-top:3px;color:' + (ok ? 'var(--green)' : 'var(--muted)') + ';';
    s.textContent = msg;
    cell.appendChild(s);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // ── 이벤트 ──
  $('btn-search').addEventListener('click', search);
  qEl.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
})();
