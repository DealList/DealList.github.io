/* Numbers Pool — 관리자 설정 (자동승인 도메인 · 공지 배너)
 * 권한: profile.role === 'admin' + RLS (is_admin_role()) 가 실제 쓰기를 보호.
 */
(async () => {
  const $ = (id) => document.getElementById(id);

  // ── 테마 ──
  const rootEl = document.documentElement;
  $('btn-theme').addEventListener('click', () => {
    if (rootEl.getAttribute('data-theme') === 'dark') {
      rootEl.removeAttribute('data-theme'); localStorage.setItem('deallist-theme', 'light');
    } else {
      rootEl.setAttribute('data-theme', 'dark'); localStorage.setItem('deallist-theme', 'dark');
    }
  });

  // ── 가드 ──
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }
  if (!profile) {
    location.replace('/login/?next=' + encodeURIComponent('/admin/settings/'));
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

  // ═══════════ 자동승인 도메인 ═══════════
  const domList = $('dom-list');

  async function loadDomains() {
    domList.innerHTML = '<div class="admin-muted">불러오는 중...</div>';
    const { data, error } = await sb.from('allowed_domains').select('*').order('domain', { ascending: true });
    if (error) {
      domList.innerHTML = `<div class="admin-muted">로드 실패: ${esc(error.message)}</div>`;
      return;
    }
    const rows = data || [];
    if (!rows.length) {
      domList.innerHTML = '<div class="admin-muted">등록된 도메인이 없습니다.</div>';
      return;
    }
    domList.innerHTML = rows.map(r => `
      <div class="dom-row">
        <span>@${esc(r.domain)}</span>
        <button class="mini-btn danger" data-dom="${esc(r.domain)}">삭제</button>
      </div>`).join('');
    domList.querySelectorAll('button[data-dom]').forEach(b =>
      b.addEventListener('click', () => delDomain(b.dataset.dom)));
  }

  $('dom-add').addEventListener('click', addDomain);
  $('dom-input').addEventListener('keydown', e => { if (e.key === 'Enter') addDomain(); });

  async function addDomain() {
    let d = $('dom-input').value.trim().toLowerCase().replace(/^@+/, '');
    if (!d || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      alert('올바른 도메인을 입력하세요. (예: numbers.co.kr)');
      return;
    }
    const btn = $('dom-add'); btn.disabled = true;
    const { error } = await sb.from('allowed_domains').insert({ domain: d });
    btn.disabled = false;
    if (error) {
      const m = /duplicate|unique/i.test(error.message) ? '이미 등록된 도메인입니다.' : error.message;
      alert('추가 실패: ' + m);
      return;
    }
    $('dom-input').value = '';
    loadDomains();
  }

  async function delDomain(d) {
    if (!confirm(`@${d} 자동승인을 삭제하시겠습니까?\n(이 도메인 신규 가입자는 다시 수동 승인 대상이 됩니다.)`)) return;
    const { error } = await sb.from('allowed_domains').delete().eq('domain', d);
    if (error) { alert('삭제 실패: ' + error.message); return; }
    loadDomains();
  }

  // ═══════════ 공지 배너 ═══════════
  const noticeCur = $('notice-current');

  async function loadNotice() {
    noticeCur.innerHTML = '<div class="admin-muted">불러오는 중...</div>';
    const { data, error } = await sb.from('notices').select('*')
      .eq('active', true).order('created_at', { ascending: false }).limit(1);
    if (error) {
      noticeCur.innerHTML = `<div class="admin-muted">로드 실패: ${esc(error.message)}</div>`;
      return;
    }
    const n = data && data[0];
    if (!n) {
      noticeCur.innerHTML = '<div class="admin-muted">현재 게시된 공지가 없습니다.</div>';
      return;
    }
    noticeCur.innerHTML = `<div class="notice-preview ${n.level === 'warn' ? 'lv-warn' : ''}">${esc(n.message)}</div>`;
  }

  $('notice-post').addEventListener('click', postNotice);
  $('notice-clear').addEventListener('click', clearNotice);

  async function postNotice() {
    const msg = $('notice-msg').value.trim();
    if (!msg) { alert('공지 내용을 입력하세요.'); return; }
    const level = $('notice-level').value;
    const btn = $('notice-post'); btn.disabled = true; btn.textContent = '게시 중...';
    // 기존 활성 공지 내리고 새로 게시 (한 번에 하나만 노출)
    await sb.from('notices').update({ active: false }).eq('active', true);
    const { error } = await sb.from('notices').insert({ message: msg, level, active: true });
    btn.disabled = false; btn.textContent = '공지 게시';
    if (error) {
      const m = /does not exist|relation/i.test(error.message) ? 'notices 테이블 미생성 — SQL 실행이 필요합니다.' : error.message;
      alert('게시 실패: ' + m);
      return;
    }
    $('notice-msg').value = '';
    loadNotice();
    alert('공지를 게시했습니다. 사이트 상단에 표시됩니다.');
  }

  async function clearNotice() {
    if (!confirm('현재 공지를 내리시겠습니까?')) return;
    const { error } = await sb.from('notices').update({ active: false }).eq('active', true);
    if (error) { alert('실패: ' + error.message); return; }
    loadNotice();
  }

  // ── helpers ──
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 초기 로드
  loadDomains();
  loadNotice();
})();
