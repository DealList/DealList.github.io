/* Numbers Pool — 회원 관리 (관리자 전용)
 * 권한: profile.role === 'admin' (RLS 가 실제 접근을 막음 — 화면도 같이 안내)
 * 강제 탈퇴: admin_delete_user RPC (SECURITY DEFINER, 관리자만)
 */
(async () => {
  const $ = (id) => document.getElementById(id);

  // ── 테마 토글 ──
  const rootEl = document.documentElement;
  $('btn-theme').addEventListener('click', () => {
    if (rootEl.getAttribute('data-theme') === 'dark') {
      rootEl.removeAttribute('data-theme'); localStorage.setItem('deallist-theme', 'light');
    } else {
      rootEl.setAttribute('data-theme', 'dark'); localStorage.setItem('deallist-theme', 'dark');
    }
  });

  // ── 권한 가드 ──
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }
  if (!profile) {
    location.replace('/login/?next=' + encodeURIComponent('/admin/members/'));
    return;
  }
  if (profile.role !== 'admin') {
    const g = $('guard-msg');
    g.hidden = false;
    g.innerHTML = `<h2>접근 권한 없음</h2>
      <p>이 계정(<strong>${esc(profile.email || '')}</strong>)은 관리자가 아닙니다.</p>
      <a href="/main/" class="admin-btn">← 메인으로</a>`;
    return;
  }

  $('me-email').textContent = profile.email || '';
  $('admin-nav').hidden = false;
  $('panel').hidden = false;
  $('btn-logout').addEventListener('click', async () => {
    if (!confirm('로그아웃하시겠습니까?')) return;
    await NP.signOut(); location.href = '/';
  });

  const tbody = $('rows'), empty = $('empty'), countEl = $('count');
  const fStatus = $('f-status'), fSearch = $('f-search');
  let currentRows = [];

  // ── 목록 로드 ──
  async function load() {
    tbody.innerHTML = `<tr><td colspan="8" id="loading-row">불러오는 중...</td></tr>`;
    empty.hidden = true;

    const status = fStatus.value;
    const q = fSearch.value.trim().toLowerCase();

    let qb = sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (status) qb = qb.eq('status', status);
    const { data, error } = await qb.limit(1000);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">로드 실패: ${esc(error.message)}</td></tr>`;
      return;
    }

    let rows = data || [];
    if (q) {
      rows = rows.filter(r =>
        (r.email || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q));
    }
    currentRows = rows;
    render(rows);
  }

  function render(rows) {
    countEl.textContent = `${rows.length}명`;
    if (rows.length === 0) { tbody.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;

    tbody.innerHTML = rows.map(r => `
      <tr data-id="${r.id}">
        <td>${(r.created_at || '').slice(0, 10)}</td>
        <td>${esc(r.email || '')}</td>
        <td>${esc(r.name || '')}</td>
        <td>${esc(r.phone || '')}</td>
        <td><span class="method-tag">${esc(r.signup_method || '')}</span></td>
        <td><span class="status-badge sb-${r.status}">${statusLabel(r.status)}</span></td>
        <td class="${r.role === 'admin' ? 'role-admin' : ''}">${esc(r.role || '')}</td>
        <td><div class="row-actions">${actionButtons(r)}</div></td>
      </tr>`).join('');

    tbody.querySelectorAll('button[data-act]').forEach(btn =>
      btn.addEventListener('click', () => handleAction(btn)));
  }

  function actionButtons(r) {
    if (r.role === 'admin') return '<span class="admin-muted">관리자 계정</span>';
    let b = '';
    if (r.status === 'pending') {
      b += `<button class="mini-btn primary" data-act="approve">승인</button>`;
      b += `<button class="mini-btn danger" data-act="reject">거절</button>`;
    } else if (r.status === 'approved') {
      b += `<button class="mini-btn danger" data-act="revoke">권한 해제</button>`;
    } else if (r.status === 'rejected' || r.status === 'revoked') {
      b += `<button class="mini-btn primary" data-act="approve">복원</button>`;
    }
    b += `<button class="mini-btn danger" data-act="delete">강제 탈퇴</button>`;
    return b;
  }

  async function handleAction(btn) {
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const act = btn.dataset.act;
    const email = tr.children[1].textContent.trim();

    if (act === 'delete') return forceDelete(id, email, btn);

    const verb = { approve: '승인/복원', reject: '거절', revoke: '권한 해제' }[act];
    if (!confirm(`${email} 회원을 ${verb} 처리합니다.\n계속하시겠습니까?`)) return;

    let patch = null;
    if (act === 'approve') patch = { status: 'approved', approved_at: new Date().toISOString(), approved_by: profile.id };
    else if (act === 'reject') patch = { status: 'rejected' };
    else if (act === 'revoke') patch = { status: 'revoked' };

    btn.disabled = true; btn.textContent = '처리 중...';
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) { alert('처리 실패: ' + error.message); btn.disabled = false; return; }
    await load();
  }

  async function forceDelete(id, email, btn) {
    const typed = prompt(
      `⚠️ 강제 탈퇴 — 되돌릴 수 없습니다.\n\n` +
      `${email} 회원의 계정과 모든 개인정보(이름·연락처·주소 등)가 영구 삭제됩니다.\n\n` +
      `확인하려면 이 회원의 이메일을 그대로 입력하세요:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== email.toLowerCase()) {
      alert('이메일이 일치하지 않아 취소되었습니다.');
      return;
    }

    btn.disabled = true; btn.textContent = '삭제 중...';
    const { error } = await sb.rpc('admin_delete_user', { p_target: id });
    if (error) {
      let m = error.message || String(error);
      if (/not authorized/i.test(m)) m = '권한이 없습니다. 다시 로그인해 주세요.';
      else if (/another admin/i.test(m)) m = '다른 관리자 계정은 삭제할 수 없습니다.';
      else if (/yourself/i.test(m)) m = '본인 계정은 여기서 삭제할 수 없습니다.';
      else if (/does not exist/i.test(m)) m = 'admin_delete_user RPC 미생성 — SQL 실행이 필요합니다.';
      alert('탈퇴 처리 실패: ' + m);
      btn.disabled = false; btn.textContent = '강제 탈퇴';
      return;
    }
    await load();
  }

  // ── CSV 내보내기 ──
  $('btn-csv').addEventListener('click', () => exportCsv(currentRows));
  function exportCsv(rows) {
    if (!rows || rows.length === 0) { alert('내보낼 회원이 없습니다.'); return; }
    const cols = [
      ['email', '이메일'], ['name', '이름'], ['phone', '연락처'],
      ['status', '상태'], ['role', '역할'], ['signup_method', '가입방법'],
      ['zipcode', '우편번호'], ['address', '주소'], ['address_detail', '상세주소'],
      ['marketing_consent', '마케팅동의'], ['created_at', '가입일'], ['approved_at', '승인일'],
    ];
    const head = cols.map(c => c[1]).join(',');
    const body = rows.map(r => cols.map(c => csvCell(r[c[0]])).join(',')).join('\r\n');
    const csv = '﻿' + head + '\r\n' + body;  // BOM — Excel 한글 깨짐 방지
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = (new Date()).toISOString().slice(0, 10);
    a.href = url; a.download = `numberspool_members_${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'Y' : 'N';
    let s = String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ── helpers ──
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function statusLabel(s) {
    return ({ pending: '승인 대기', approved: '승인됨', rejected: '거절', revoked: '해제' })[s] || s;
  }

  // ── 이벤트 ──
  fStatus.addEventListener('change', load);
  let searchTimer;
  fSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
  $('btn-refresh').addEventListener('click', load);

  load();
})();
