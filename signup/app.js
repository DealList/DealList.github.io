/* Numbers Pool — 가입 신청 페이지 */
(async () => {
  const msgEl = document.getElementById('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // 이미 로그인된 사용자: 상태별 처리
  //   pending/rejected/revoked → /pending/ 로 자동 이동
  //   approved → "이미 로그인됨" 카드 표시 (직접 선택)
  try {
    const profile = await NP.getProfile();
    if (profile) {
      if (profile.status !== 'approved') {
        location.href = NP.targetByStatus(profile, '/');
        return;
      }
      // approved
      document.getElementById('signup-card').hidden = true;
      const card = document.getElementById('already-card');
      card.hidden = false;
      document.getElementById('already-email').textContent = profile.email || '—';
      document.getElementById('btn-continue').addEventListener('click', () => {
        location.href = '/';
      });
      document.getElementById('btn-switch').addEventListener('click', async () => {
        await NP.signOut();
        location.replace('/signup/');
      });
      return;
    }
  } catch (e) {
    console.warn('[signup] profile pre-check failed', e);
  }

  // 이메일 가입
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value.trim();
    const affiliation = document.getElementById('affiliation').value.trim();
    const reason = document.getElementById('reason').value.trim();
    const btn = document.getElementById('btn-signup');

    btn.disabled = true;
    btn.textContent = '신청 중...';
    msgEl.textContent = '';

    try {
      // raw_user_meta_data 에 추가 정보 전달 → 트리거가 profiles 에 함께 INSERT
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: location.origin + '/login/',
          data: {
            name,
            full_name: name,           // 표준 키 호환
            affiliation,
            signup_reason: reason,
          },
        },
      });
      if (error) throw error;

      showMsg(
        '가입 신청이 접수되었습니다.\n' +
        '이메일로 보낸 인증 메일의 링크를 눌러 확인을 완료한 뒤 로그인해주세요. ' +
        '(사내 도메인은 자동 승인, 외부 도메인은 관리자 승인 후 이용 가능)',
        'ok'
      );
      btn.textContent = '신청 완료';
      // 폼 비활성화
      document.querySelectorAll('#signup-form input').forEach(i => i.disabled = true);
    } catch (err) {
      let m = err.message || String(err);
      if (/already registered/i.test(m) || /already in use/i.test(m) || /already exists/i.test(m)) {
        m = '이미 가입된 이메일입니다. 로그인 페이지로 이동해주세요.';
      } else if (/Password should be at least/i.test(m)) {
        m = '비밀번호는 6자 이상이어야 합니다.';
      }
      showMsg(m, 'err');
      btn.disabled = false;
      btn.textContent = '가입 신청';
    }
  });

  // Google OAuth (자동 가입)
  document.getElementById('btn-google').addEventListener('click', async () => {
    msgEl.textContent = '';
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + '/login/' },
      });
      if (error) throw error;
    } catch (err) {
      let m = err.message || String(err);
      if (/provider is not enabled/i.test(m)) {
        m = 'Google 가입이 아직 활성화되지 않았습니다. 이메일 가입을 이용해주세요.';
      }
      showMsg(m, 'err');
    }
  });
})();
