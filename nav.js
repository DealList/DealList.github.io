/* ─────────────────────────────────────────────────────────────
 * Numbers Pool — 공유 네비게이션 컴포넌트
 *
 * 사용법:
 *   <div id="nav-mount" data-active="dcm-deals" data-root=".."></div>
 *   <script src="../nav.js"></script>
 *
 * active 값:
 *   "home" | "dcm-deals" | "dcm-brokers" | "dcm-charts"
 *   "ecm-deals" | "ecm-brokers" | "ecm-charts" | "about"
 *
 * data-root: 사이트 루트로의 상대 경로 (기본 ".")
 *   메인페이지: ""  /  하위 페이지: ".."
 *
 * 인증 기능 (자동):
 *   - 보호 페이지 + 비로그인 → /login/ 으로 리디렉트
 *   - 로그인됐지만 status ≠ approved → /pending/ 으로
 *   - 로그인 + approved → 우측 상단에 "이름님 환영합니다 · 로그아웃"
 * ───────────────────────────────────────────────────────────── */

(function () {
  const mount = document.getElementById('nav-mount');
  if (!mount) return;
  const active = mount.dataset.active || 'home';
  const root = mount.dataset.root || '.';

  const isHome = active === 'home';
  const isAbout = active === 'about';
  const isDcm = active.startsWith('dcm-');
  const isEcm = active.startsWith('ecm-');
  const dcmSub = isDcm ? active.replace('dcm-', '') : null;
  const ecmSub = isEcm ? active.replace('ecm-', '') : null;
  const cls = (c) => c ? ` class="${c}"` : '';

  mount.outerHTML = `
    <nav class="v1-nav">
      <div class="left">
        <a href="${root}/" class="v1-logo">
          <img src="${root}/assets/numbers-pool-logo.png" alt="Numbers Pool" class="v1-logo-img light-only" />
          <img src="${root}/assets/numbers-pool-logo-dark.png" alt="" class="v1-logo-img dark-only" />
          <small>Korea Capital Market</small>
        </a>
        <div class="primary">
          <a${cls(isHome ? 'active' : '')} href="${root}/">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            홈
          </a>

          <div${cls('dd' + (isDcm ? ' active' : ''))}>
            <div class="cat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              DCM · 채권시장
              <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="panel">
              <div class="panel-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                DCM
              </div>
              <a${cls(dcmSub === 'deals' ? 'active' : '')} href="${root}/dcm-deals/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                발행 정보
              </a>
              <a${cls(dcmSub === 'brokers' ? 'active' : '')} href="${root}/dcm-brokers/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/></svg>
                주관·인수 실적
              </a>
              <a${cls(dcmSub === 'charts' ? 'active' : '')} href="${root}/dcm-charts/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l6.5 3.5"/></svg>
                인포그래픽
              </a>
            </div>
          </div>

          <div${cls('dd' + (isEcm ? ' active' : ''))}>
            <div class="cat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
              ECM · 주식시장
              <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="panel">
              <div class="panel-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
                ECM
              </div>
              <a${cls(ecmSub === 'deals' ? 'active' : '')} href="${root}/ecm-deals/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 발행 정보</a>
              <a${cls(ecmSub === 'brokers' ? 'active' : '')} href="${root}/ecm-brokers/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/></svg> 주관·인수 실적</a>
              <a${cls(ecmSub === 'charts' ? 'active' : '')} href="${root}/ecm-charts/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l6.5 3.5"/></svg> 인포그래픽</a>
            </div>
          </div>

          <a${cls(isAbout ? 'active' : '')} href="${root}/about/">데이터 안내</a>
        </div>
      </div>
      <div class="right">
        <div class="np-right-top">
          <div class="nav-auth" id="nav-auth"></div>
          <button id="btn-theme" class="theme-btn" title="다크 모드 전환">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>
        <div class="updated">
          <span class="pulse"></span>
          <span id="nav-updated">최종 업데이트 로딩 중…</span>
        </div>
      </div>
    </nav>
  `;

  // ─── nav-auth 영역 스타일 (한 번만 inject) ───
  if (!document.getElementById('np-nav-auth-style')) {
    const st = document.createElement('style');
    st.id = 'np-nav-auth-style';
    st.textContent = `
      .nav-auth { display: flex; align-items: center; gap: 10px; font-size: 13px; }
      .nav-welcome { color: var(--text-2); white-space: nowrap; }
      .nav-welcome .nav-status-badge {
        margin-left: 6px; padding: 1px 6px; border-radius: 8px;
        background: var(--amber-bg); color: var(--amber); font-size: 10px; font-weight: 700;
      }
      .nav-logout, .nav-login {
        color: var(--accent); text-decoration: none; font-weight: 600;
        padding: 5px 11px; border: 1px solid var(--border); border-radius: 5px;
        white-space: nowrap;
      }
      .nav-logout:hover, .nav-login:hover { background: var(--accent); color: white; border-color: var(--accent); }
      .nav-mypage {
        color: var(--text-2); text-decoration: none; font-weight: 600; white-space: nowrap;
        padding: 5px 11px; border: 1px solid var(--border); border-radius: 5px;
      }
      .nav-mypage:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
      /* 최종 업데이트를 auth+테마 줄 아래로 분리 */
      .v1-nav .right { flex-direction: column; align-items: flex-end; gap: 7px; }
      .v1-nav .right .np-right-top { display: flex; align-items: center; gap: 12px; }
      @media (max-width: 720px) { .v1-nav .right .updated { display: none; } }
    `;
    document.head.appendChild(st);
  }

  // ─── Theme toggle wire (기존 그대로) ───
  const root_el = document.documentElement;
  const KEY = 'deallist-theme';
  if (localStorage.getItem(KEY) !== 'light') root_el.setAttribute('data-theme', 'dark');
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.addEventListener('click', () => {
      if (root_el.getAttribute('data-theme') === 'dark') {
        root_el.removeAttribute('data-theme');
        localStorage.setItem(KEY, 'light');
      } else {
        root_el.setAttribute('data-theme', 'dark');
        localStorage.setItem(KEY, 'dark');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 인증 가드 + 우측 상단 로그인 상태 표시
  // ═══════════════════════════════════════════════════════════

  // 공개 경로 (비로그인이어도 OK)
  //   '/' = 미리보기 페이지 (사이트 소개 + 가입 CTA)
  //   /admin/* 은 자체 가드 있으니 nav 가 강제 리디렉트 안 함 (admin/members/app.js 에서 처리)
  const path = location.pathname;
  const PUBLIC_PREFIXES = ['/login/', '/signup/', '/logout/', '/pending/', '/admin/'];
  const isPublic = (path === '/' || path === '/index.html')
                   || PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p));

  loadSupabase().then(async (sb) => {
    if (!sb) {
      // SDK 로드 실패 — 보호 페이지여도 일단 통과 (사용자가 사이트 자체를 못 보면 더 답답)
      renderAuthArea(null, null);
      return;
    }
    let user = null, profile = null;
    try {
      const sres = await sb.auth.getSession();
      user = (sres.data && sres.data.session) ? sres.data.session.user : null;
      if (user) {
        const pres = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
        profile = pres.data || null;
      }
    } catch (e) {
      console.warn('[nav] auth check failed', e);
    }

    // 보호 페이지 + 비로그인 → 로그인 페이지로
    if (!isPublic && !user) {
      location.replace('/login/?next=' + encodeURIComponent(path + location.search));
      return;
    }
    // 보호 페이지 + 미승인 → 대기 페이지로
    if (!isPublic && profile && profile.status !== 'approved') {
      const dest = profile.status === 'pending'
        ? '/pending/'
        : '/pending/?denied=' + profile.status;
      location.replace(dest);
      return;
    }
    // 약관 동의 기록은 가입 시점(/signup/terms/)에 받으므로 nav 가 추가 라우팅하지 않음.
    // /profile/complete/ 는 연락처·주소 등 선택 정보 보완 페이지로만 사용 (자발적 방문).

    // ─── 비활성 자동 로그아웃 (30일) — 클라이언트 측 구현 ───
    // localStorage 의 마지막 활동 시각이 30일 전이면 강제 로그아웃 + /login/?reason=inactive
    // (Supabase 의 inactivity timeout 이 Pro 플랜 전용이라 무료 플랜 대안)
    if (profile && profile.status === 'approved') {
      const ACTIVE_KEY = 'np-last-active';
      const LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
      let last = 0;
      try { last = parseInt(localStorage.getItem(ACTIVE_KEY) || '0', 10) || 0; } catch (e) {}
      if (last > 0 && (Date.now() - last) > LIMIT_MS) {
        try { await sb.auth.signOut(); } catch (e) {}
        try { localStorage.removeItem(ACTIVE_KEY); } catch (e) {}
        try { if (window.NP_clearRemember) window.NP_clearRemember(); } catch (e) {}
        location.replace('/login/?reason=inactive');
        return;
      }
      // 활동 시각 갱신
      try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch (e) {}
    }

    renderAuthArea(user, profile);
  }).catch(e => {
    console.warn('[nav] supabase load error', e);
    renderAuthArea(null, null);
  });

  // ─── 보조 함수 ───
  function loadSupabase() {
    return new Promise(async (resolve) => {
      if (window.sb) { resolve(window.sb); return; }
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
        await loadScript(root + '/supabase-client.js?v=20260602g');
        await loadScript(root + '/auth-helper.js?v=20260602c');
        resolve(window.sb || null);
      } catch (e) {
        console.warn('[nav] script load failed', e);
        resolve(null);
      }
    });
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // 이미 로드된 스크립트면 스킵
      const key = src.split('?')[0];
      const exists = Array.from(document.scripts).some(s => s.src && s.src.includes(key));
      if (exists) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('failed: ' + src));
      document.head.appendChild(s);
    });
  }

  function renderAuthArea(user, profile) {
    const el = document.getElementById('nav-auth');
    if (!el) return;

    if (user) {
      // 표시 이름: profile.name > user_metadata.full_name/name > 이메일 앞부분
      const meta = (user.user_metadata || {});
      const name =
        (profile && profile.name) ||
        meta.full_name || meta.name ||
        (user.email ? user.email.split('@')[0] : '회원');

      const status = profile ? profile.status : null;
      const statusBadge =
        status && status !== 'approved'
          ? ` <span class="nav-status-badge">${statusLabel(status)}</span>`
          : '';

      const myPageLink = (profile && profile.status === 'approved')
        ? `<a href="${root}/account/" class="nav-mypage">마이페이지</a>`
        : '';
      el.innerHTML = `
        <span class="nav-welcome">${esc(name)}님 환영합니다${statusBadge}</span>
        ${myPageLink}
        <a href="${root}/logout/" class="nav-logout">로그아웃</a>
      `;
    } else {
      // 비로그인 (공개 페이지에서만 도달 — 보호 페이지는 위에서 redirect 됨)
      el.innerHTML = `<a href="${root}/login/" class="nav-login">로그인</a>`;
    }
  }

  function statusLabel(s) {
    return ({ pending: '승인 대기', rejected: '가입 거절', revoked: '권한 해제' })[s] || s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();
