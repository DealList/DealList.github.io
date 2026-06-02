/* Numbers Pool — 회원 관리 (관리자 전용)
 * RLS 가 비-admin 의 접근을 거부하므로 화면도 같이 막아 UX 안내.
 */
(async () => {
  const profile = await NP.getProfile();

  // 비로그인 → 로그인 페이지
  if (!profile) {
    location.href = '/login/?next=' + encodeURIComponent('/admin/members/');
    return;
  }
  // 비-admin → 대시보드로
  if (profile.role !== 'admin') {
    alert('관리자만 접근 가능한 페이지입니다.');
    location.href = '/main/';
    return;
  }

  // 상단 바: 본인 이메일 + 로그아웃
  const meEl = document.getElementById('me-email');
  if (meEl) meEl.textContent = profile.email || '';
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      await NP.signOut();
      location.href = '/';
    });
  }

  const tbody    = document.getElementById('rows');
  const grid     = document.getElementById('grid');
  const empty    = document.getElementById('empty');
  const loading  = document.getElementById('loading');
  const countEl  = document.getElementById('count');
  const fStatus  = document.getElementById('f-status');
  const fSearch  = document.getElementById('f-search');

  async function load() {
    loading.hidden = false;
    grid.hidden = true;
    empty.hidden = true;

    const status = fStatus.value;
    const q = fSearch.value.trim().toLowerCase();

    let qb = sb.from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (status) qb = qb.eq('status', status);

    const { data, error } = await qb.limit(500);
    loading.hidden = true;

    if (error) {
      empty.hidden = false;
      empty.textContent = '로드 실패: ' + error.message;
      return;
    }

    let rows = data || [];
    if (q) {
      rows = rows.filter(r =>
        (r.email||'').toLowerCase().includes(q) ||
        (r.name||'').toLowerCase().includes(q)
      );
    }

    render(rows);
  }

  function render(rows) {
    countEl.textContent = `${rows.length}명`;

    if (rows.length === 0) {
      empty.hidden = false;
      grid.hidden = true;
      return;
    }

    grid.hidden = false;
    empty.hidden = true;

    tbody.innerHTML = rows.map(r => `
      <tr data-id="${r.id}">
        <td>${(r.created_at||'').slice(0,10)}</td>
        <td>${esc(r.email||'')}</td>
        <td>${esc(r.name||'')}</td>
        <td>${esc(r.affiliation||'')}</td>
        <td>${esc(r.signup_reason||'')}</td>
        <td><span class="method-tag">${esc(r.signup_method||'')}</span></td>
        <td><span class="status status-${r.status}">${statusLabel(r.status)}</span></td>
        <td class="${r.role === 'admin' ? 'role-admin' : ''}">${esc(r.role||'')}</td>
        <td class="actions">
          ${r.status === 'pending' ? `
            <button class="btn-approve" data-act="approve">승인</button>
            <button class="btn-reject"  data-act="reject">거절</button>` : ''}
          ${r.status === 'approved' && r.role !== 'admin' ? `
            <button class="btn-revoke"  data-act="revoke">해제</button>` : ''}
          ${r.status === 'rejected' || r.status === 'revoked' ? `
            <button class="btn-approve" data-act="approve">복원</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn));
    });
  }

  async function handleAction(btn) {
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const act = btn.dataset.act;
    const email = tr.children[1].textContent.trim();

    const verbMap = { approve: '승인', reject: '거절', revoke: '권한 해제' };
    if (!confirm(`${email} 회원을 ${verbMap[act]} 처리합니다.\n계속하시겠습니까?`)) return;

    let patch = null;
    if (act === 'approve') {
      patch = { status: 'approved', approved_at: new Date().toISOString(), approved_by: profile.id };
    } else if (act === 'reject') {
      patch = { status: 'rejected' };
    } else if (act === 'revoke') {
      patch = { status: 'revoked' };
    }

    btn.disabled = true;
    btn.textContent = '처리 중...';

    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) {
      alert('처리 실패: ' + error.message);
      btn.disabled = false;
      return;
    }

    await load();  // 새로고침
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function statusLabel(s) {
    return ({ pending:'승인 대기', approved:'승인됨', rejected:'거절', revoked:'해제' })[s] || s;
  }

  // 이벤트
  fStatus.addEventListener('change', load);
  let searchTimer;
  fSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });
  document.getElementById('btn-refresh').addEventListener('click', load);

  load();
})();
