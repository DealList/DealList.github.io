/* Numbers Pool — 로그인 페이지 */
(async () => {
  const msgEl = document.getElementById('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // 이미 로그인된 사용자는 상태 따라 라우팅
  try {
    const profile = await NP.getProfile();
    if (profile) {
      if (profile.status === 'approved') {
        const next = new URL(location.href).searchParams.get('next') || '/';
        location.href = next;
        return;
      }
      if (profile.status === 'pending') {
        location.href = '/pending/';
        return;
      }
      if (profile.status === 'rejected' || profile.status === 'revoked') {
        location.href = '/pending/?denied=' + profile.status;
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
      location.href = NP.targetByStatus(p, '/');
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
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + '/login/' },
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
