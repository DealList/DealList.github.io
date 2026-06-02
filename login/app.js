/* Numbers Pool — 로그인 페이지 */
(async () => {
  const msgEl = document.getElementById('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // 이미 로그인된 사용자: 상태별 처리
  //   pending/rejected/revoked → /pending/ 로 자동 이동 (다른 작업 불가)
  //   approved → "이미 로그인됨" 카드 표시 (사용자가 직접 [계속] / [다른 계정] 선택)
  try {
    const profile = await NP.getProfile();
    if (profile) {
      if (profile.status === 'pending') { location.href = '/pending/'; return; }
      if (profile.status === 'rejected' || profile.status === 'revoked') {
        location.href = '/pending/?denied=' + profile.status; return;
      }
      if (profile.status === 'approved') {
        document.getElementById('login-card').hidden = true;
        const card = document.getElementById('already-card');
        card.hidden = false;
        document.getElementById('already-email').textContent = profile.email || '—';
        document.getElementById('btn-continue').addEventListener('click', () => {
          const next = new URL(location.href).searchParams.get('next') || '/main/';
          location.href = next;
        });
        document.getElementById('btn-switch').addEventListener('click', async () => {
          await NP.signOut();
          // 로그아웃 후 재진입 — 폼이 깨끗하게 보이도록 강제 리로드
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
