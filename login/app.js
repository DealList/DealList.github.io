/* Numbers Pool — 로그인 페이지 */
(async () => {
  const msgEl = document.getElementById('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // URL 파라미터 분석
  //   np_from=oauth : Google OAuth 콜백으로 돌아옴 (자동 redirect)
  //   next=...      : 로그인 후 가야 할 곳
  const urlParams = new URL(location.href).searchParams;
  const isOauthCallback = urlParams.get('np_from') === 'oauth';
  const nextParam = urlParams.get('next');

  // 이미 로그인된 사용자: 상태별 처리
  //   pending/rejected/revoked → /pending/ 로 자동 이동 (다른 작업 불가)
  //   approved + OAuth 콜백/next 있음 → 자동 이동 (카드 안 거침)
  //   approved + 직접 URL 진입 → "이미 로그인됨" 카드 표시
  try {
    const profile = await NP.getProfile();
    if (profile) {
      if (profile.status === 'pending') { location.href = '/pending/'; return; }
      if (profile.status === 'rejected' || profile.status === 'revoked') {
        location.href = '/pending/?denied=' + profile.status; return;
      }
      if (profile.status === 'approved') {
        // OAuth 콜백이거나 next 파라미터 있으면 즉시 이동 — 카드 안 거침
        if (isOauthCallback || nextParam) {
          location.replace(nextParam || '/main/');
          return;
        }
        // 직접 URL 진입 → 이미 로그인 카드 표시
        document.getElementById('login-card').hidden = true;
        const card = document.getElementById('already-card');
        card.hidden = false;
        document.getElementById('already-email').textContent = profile.email || '—';
        document.getElementById('btn-continue').addEventListener('click', () => {
          location.href = '/main/';
        });
        document.getElementById('btn-switch').addEventListener('click', async () => {
          await NP.signOut();
          location.replace('/login/');
        });
        return;
      }
    }
  } catch (e) {
    console.warn('[login] profile pre-check failed', e);
  }

  // remember-me 헬퍼
  const getRemember = () => !!document.getElementById('chk-remember').checked;

  // 이메일/비번 로그인
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = '로그인 중...';
    msgEl.textContent = '';
    try {
      // signIn 호출 전에 remember 플래그 설정 — 세션 저장 위치 결정
      window.NP_setRemember(getRemember());
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const p = await NP.getProfile();
      // next 파라미터가 있으면 그곳으로, 없으면 /main/ 대시보드로
      const nextParam = new URL(location.href).searchParams.get('next');
      location.href = (p && p.status === 'approved' && nextParam)
        ? nextParam
        : NP.targetByStatus(p, '/main/');
    } catch (err) {
      let m = err.message || String(err);
      if (/Invalid login credentials/i.test(m)) m = '이메일 또는 비밀번호가 올바르지 않습니다.';
      else if (/Email not confirmed/i.test(m)) m = '이메일 확인이 완료되지 않았습니다. 가입 시 보낸 인증 메일의 링크를 눌러주세요.';
      showMsg(m, 'err');
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  });

  // Google OAuth
  document.getElementById('btn-google').addEventListener('click', async () => {
    msgEl.textContent = '';
    try {
      // OAuth 리디렉트 전에 remember 플래그 — 돌아왔을 때 저장 위치 결정
      window.NP_setRemember(getRemember());
      // 콜백 URL 에 np_from=oauth 마커 + next 파라미터 — 돌아왔을 때 자동 이동 (카드 안 거침)
      const next = nextParam || '/main/';
      const redirectTo = `${location.origin}/login/?np_from=oauth&next=${encodeURIComponent(next)}`;
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
    } catch (err) {
      let m = err.message || String(err);
      if (/provider is not enabled/i.test(m)) {
        m = 'Google 로그인이 아직 활성화되지 않았습니다. 잠시 후 다시 시도해주세요.';
      }
      showMsg('Google 로그인 실패: ' + m, 'err');
    }
  });
})();
