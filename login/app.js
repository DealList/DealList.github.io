/* Numbers Pool — 로그인 페이지 */
(async () => {
  const msgEl = document.getElementById('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // URL 파라미터 분석
  //   np_from=oauth   : Google OAuth 콜백으로 돌아옴 (자동 redirect)
  //   next=...        : 로그인 후 가야 할 곳
  //   reason=inactive : 30일 비활성으로 자동 로그아웃되어 들어옴
  const urlParams = new URL(location.href).searchParams;
  const isOauthCallback = urlParams.get('np_from') === 'oauth';
  const nextParam = urlParams.get('next');
  const reason = urlParams.get('reason');

  // 비활성 자동 로그아웃 안내
  if (reason === 'inactive') {
    showMsg(
      '30일 이상 활동이 없어 보안을 위해 자동 로그아웃되었습니다. 다시 로그인해주세요.',
      'err'
    );
  }

  // 이미 로그인된 사용자: 상태별 처리
  //   pending/rejected/revoked → /pending/ 로 자동 이동 (다른 작업 불가)
  //   approved + OAuth 콜백/next 있음 → 자동 이동 (카드 안 거침)
  //   approved + 직접 URL 진입 → "이미 로그인됨" 카드 표시
  try {
    const profile = await NP.getProfile();
    if (profile) {
      // ── ⭐ 신규 OAuth 가입자가 가입 절차를 안 거친 경우 — 약관 페이지로 강제 이동 ──
      // /login/ 에서 Google 버튼만 눌러 자동승인 도메인이 그대로 회원이 되는 우회 차단.
      // 조건: OAuth 콜백 + profile 이 방금(5분 이내) 생성됨 + terms 비어있음 + signup 동의 신호 없음
      //   → 정상 가입 흐름(/signup/terms/ → /signup/ → Google)은 sessionStorage('np-terms-agreed')='1'
      //      을 갖고 있어 통과. /login/ 우회 흐름만 여기서 막힘.
      if (isOauthCallback && !profile.terms_agreed_version) {
        const createdMs = profile.created_at ? new Date(profile.created_at).getTime() : 0;
        const justCreated = createdMs && (Date.now() - createdMs) < 5 * 60 * 1000;
        const cameFromSignup = sessionStorage.getItem('np-terms-agreed') === '1';
        if (justCreated && !cameFromSignup) {
          alert('회원 가입 절차가 필요합니다. 약관 동의와 가입 정보 입력을 마쳐주세요.');
          await NP.signOut();
          location.replace('/signup/terms/');
          return;
        }
      }

      // ── Google OAuth 가입자 약관 동의 기록 ──
      // Google 가입은 /signup/terms/ 의 동의가 metadata 로 안 넘어와 terms_agreed_version 이 빔.
      // 비어있으면 이 시점(= Google 버튼 클릭 = 약관 동의 간주)에 기록 (coalesce 로 1회만 반영).
      // /signup/terms/ 를 거쳤으면 sessionStorage 의 명시적 버전·마케팅 동의를 사용.
      if (!profile.terms_agreed_version) {
        let tv = '20260603-oauth-implied';
        // 마케팅 동의 기본값 = 기존 프로필 값 (sessionStorage 신호 없으면 그대로 유지)
        let mk = (typeof profile.marketing_consent === 'boolean') ? profile.marketing_consent : false;
        try {
          const sv = sessionStorage.getItem('np-terms-version');
          if (sv) tv = sv;
          const m = sessionStorage.getItem('np-marketing-consent');
          if (m === '1') mk = true; else if (m === '0') mk = false;
        } catch (e) {}
        try {
          // 전체 파라미터를 기존 값으로 채워 호출 — RPC 가 coalesce 든 직접대입이든
          // 연락처·주소가 지워지지 않도록. terms 만 새로 기록.
          await sb.rpc('update_my_profile_extras', {
            p_phone: profile.phone || null,
            p_zipcode: profile.zipcode || null,
            p_address: profile.address || null,
            p_address_detail: profile.address_detail || null,
            p_marketing_consent: mk,
            p_terms_agreed_version: tv
          });
        } catch (e) { console.warn('[login] terms record failed', e); }
        try {
          sessionStorage.removeItem('np-terms-agreed');
          sessionStorage.removeItem('np-terms-version');
          sessionStorage.removeItem('np-marketing-consent');
        } catch (e) {}
      }
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
