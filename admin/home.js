/* Numbers Pool — 관리자 대시보드 홈
 * 권한: profile.role === 'admin' (RLS 가 실제 데이터 접근을 막음 — 화면도 같이 안내)
 */
(async () => {
  const $ = (id) => document.getElementById(id);

  // ── 테마 토글 ──
  const rootEl = document.documentElement;
  const TKEY = 'deallist-theme';
  $('btn-theme').addEventListener('click', () => {
    if (rootEl.getAttribute('data-theme') === 'dark') {
      rootEl.removeAttribute('data-theme'); localStorage.setItem(TKEY, 'light');
    } else {
      rootEl.setAttribute('data-theme', 'dark'); localStorage.setItem(TKEY, 'dark');
    }
  });

  // ── 권한 가드 ──
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }

  if (!profile) {
    location.replace('/login/?next=' + encodeURIComponent('/admin/'));
    return;
  }
  if (profile.role !== 'admin' && profile.role !== 'master') {
    const g = $('guard-msg');
    g.hidden = false;
    g.innerHTML = `
      <h2>접근 권한 없음</h2>
      <p>이 계정(<strong>${esc(profile.email || '')}</strong>)은 관리자가 아닙니다.<br/>
      관리자 권한이 필요하면 운영자에게 문의해주세요.</p>
      <a href="/main/" class="admin-btn">← 메인으로</a>`;
    return;
  }

  // ── 관리자 확인됨 ──
  $('me-email').textContent = profile.email || '';
  $('role-badge').textContent = profile.role === 'master' ? 'MASTER' : 'ADMIN';
  $('admin-nav').hidden = false;
  $('dash').hidden = false;

  $('btn-logout').addEventListener('click', async () => {
    if (!confirm('로그아웃하시겠습니까?')) return;
    await NP.signOut();
    location.href = '/';
  });

  // ── 카운트 집계 ──
  loadMemberCounts();
  countTable('records', 'c-dcm');
  loadEcmCount();
  loadLastUpdated();

  async function loadMemberCounts() {
    try {
      const { data, error } = await sb.from('profiles').select('status');
      if (error) throw error;
      const all = data || [];
      const pending  = all.filter(p => p.status === 'pending').length;
      const approved = all.filter(p => p.status === 'approved').length;
      setText('c-pending', pending);
      setText('c-members', all.length);
      setText('c-approved', approved);
      if (pending > 0) {
        $('cell-pending').classList.add('alert');
        const qb = $('q-pending');
        qb.hidden = false;
        qb.textContent = `${pending} 대기`;
      }
    } catch (e) {
      console.warn('[admin] member counts', e);
      ['c-pending', 'c-members', 'c-approved'].forEach(id => setText(id, '—'));
    }
  }

  async function countOf(table) {
    try {
      const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    } catch (e) {
      console.warn('[admin] count ' + table, e);
      return null;
    }
  }
  async function countTable(table, id) {
    const c = await countOf(table);
    setText(id, c === null ? '—' : c);
  }
  async function loadEcmCount() {
    const [a, b] = await Promise.all([countOf('ecm_ipo'), countOf('ecm_rights')]);
    if (a === null && b === null) { setText('c-ecm', '—'); return; }
    setText('c-ecm', (a || 0) + (b || 0));
  }

  // ── 최종 업데이트 시각 (summary JSON) ──
  async function loadLastUpdated() {
    if (!window.NP_loadData) return;
    NP_loadData('summary.json')
      .then(s => { if (s && s.updated) $('u-dcm').textContent = '갱신 ' + s.updated; })
      .catch(() => {});
    NP_loadData('ecm_summary.json')
      .then(s => { if (s && s.updated) $('u-ecm').textContent = '갱신 ' + s.updated; })
      .catch(() => {});
  }

  // ── helpers ──
  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = (typeof v === 'number') ? v.toLocaleString() : v;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
