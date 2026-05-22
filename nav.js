/* ─────────────────────────────────────────────────────────────
 * Deal List — 공유 네비게이션 컴포넌트
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
          <img src="${root}/assets/numbers-logo.png" alt="Numbers" class="v1-logo-img" />
          <span class="v1-logo-pool">Pool</span>
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
              <a${cls(dcmSub === 'deals' ? 'active' : '')} href="${root}/deals/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                발행 정보
              </a>
              <a${cls(dcmSub === 'brokers' ? 'active' : '')} href="${root}/brokers/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/></svg>
                주관·인수 실적
              </a>
              <a${cls(dcmSub === 'charts' ? 'active' : '')} href="${root}/charts/">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l6.5 3.5"/></svg>
                인포그래픽
              </a>
            </div>
          </div>

          <div${cls('dd' + (isEcm ? ' active' : ''))}>
            <div class="cat disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
              ECM · 주식시장 <span class="mini-badge">개발중</span>
              <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="panel disabled">
              <div class="panel-label dim">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
                ECM <span class="badge">개발 중</span>
              </div>
              <a href="#"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> 발행 정보</a>
              <a href="#"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/></svg> 주관·인수 실적</a>
              <a href="#"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v10l6.5 3.5"/></svg> 인포그래픽</a>
            </div>
          </div>

          <a${cls(isAbout ? 'active' : '')} href="${root}/about/">데이터 안내</a>
        </div>
      </div>
      <div class="right">
        <div class="updated">
          <span class="pulse"></span>
          <span id="nav-updated">최종 업데이트 로딩 중…</span>
        </div>
        <button id="btn-theme" class="theme-btn" title="다크 모드 전환">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
    </nav>
  `;

  // Wire theme toggle — 기본값 dark. 사용자가 명시적으로 'light' 선택한 경우만 light.
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
})();
