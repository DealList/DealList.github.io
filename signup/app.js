/* Numbers Pool — 가입 신청 페이지 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const msgEl = $('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // ─── 이미 로그인된 사용자 처리 ───
  let alreadyLoggedIn = false;
  try {
    const profile = await NP.getProfile();
    if (profile) {
      alreadyLoggedIn = true;
      if (profile.status !== 'approved') {
        location.href = NP.targetByStatus(profile, '/');
        return;
      }
      // approved
      $('signup-card').hidden = true;
      const card = $('already-card');
      card.hidden = false;
      $('already-email').textContent = profile.email || '—';
      $('btn-continue').addEventListener('click', () => { location.href = '/main/'; });
      $('btn-switch').addEventListener('click', async () => {
        await NP.signOut();
        location.replace('/signup/');
      });
      return;
    }
  } catch (e) {
    console.warn('[signup] profile pre-check failed', e);
  }

  // 비로그인 + 약관 동의 안 한 경우 → 약관 페이지로
  if (!alreadyLoggedIn && sessionStorage.getItem('np-terms-agreed') !== '1') {
    location.replace('/signup/terms/');
    return;
  }

  // ─── 비밀번호 검증 ───
  // 정책: 8~32자 + 같은 문자/숫자 4자 이상 연속 불가 + 영문·숫자·특수문자 중 2종 이상
  function validatePassword(pw) {
    if (!pw || pw.length < 8 || pw.length > 32) return '비밀번호는 8~32자여야 합니다.';
    if (/(.)\1{3,}/.test(pw)) return '같은 문자/숫자를 4자 이상 연속 사용할 수 없습니다.';
    let types = 0;
    if (/[a-zA-Z]/.test(pw)) types++;
    if (/[0-9]/.test(pw)) types++;
    if (/[^a-zA-Z0-9]/.test(pw)) types++;
    if (types < 2) return '영문·숫자·특수문자 중 2가지 이상을 조합해야 합니다.';
    return null;
  }

  // 실시간 비밀번호 힌트 색상 토글
  const pwEl  = $('password');
  const pw2El = $('password2');
  const pwHint = $('pw-hint');
  const pw2Hint = $('pw2-hint');

  pwEl.addEventListener('input', () => {
    const v = pwEl.value;
    if (!v) {
      pwHint.classList.remove('err');
      pwHint.textContent = '반복 문자/숫자 4자 이상 불가하며 영문·숫자·특수문자 중 2가지 이상 조합하여 8~32자 내로 입력.';
      return;
    }
    const err = validatePassword(v);
    if (err) {
      pwHint.classList.add('err');
      pwHint.textContent = err;
    } else {
      pwHint.classList.remove('err');
      pwHint.textContent = '✓ 사용 가능한 비밀번호';
    }
  });

  pw2El.addEventListener('input', () => {
    const v2 = pw2El.value;
    if (!v2) { pw2Hint.hidden = true; return; }
    pw2Hint.hidden = false;
    if (v2 !== pwEl.value) {
      pw2Hint.classList.add('err');
      pw2Hint.textContent = '비밀번호가 일치하지 않습니다.';
    } else {
      pw2Hint.classList.remove('err');
      pw2Hint.textContent = '✓ 비밀번호 일치';
    }
  });

  // ─── 연락처 자동 포커스 이동 + 숫자만 ───
  function setupPhoneField(curId, nextId, len) {
    const el = $(curId);
    if (!el) return;
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9]/g, '').slice(0, len);
      if (el.value.length >= len && nextId) {
        const nxt = $(nextId);
        if (nxt) nxt.focus();
      }
    });
  }
  setupPhoneField('phone1', 'phone2', 3);
  setupPhoneField('phone2', 'phone3', 4);
  setupPhoneField('phone3', null, 4);

  // ─── 폼 제출 ───
  $('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = '';

    // honeypot
    if ($('hp-website').value) {
      console.warn('[signup] honeypot triggered — silently aborting');
      return;
    }

    const email = $('email').value.trim().toLowerCase();
    const password = pwEl.value;
    const password2 = pw2El.value;
    const name = $('name').value.trim();
    const p1 = $('phone1').value.trim();
    const p2 = $('phone2').value.trim();
    const p3 = $('phone3').value.trim();
    const phone = (p1 && p2 && p3) ? `${p1}-${p2}-${p3}` : '';

    // 비밀번호 검증
    const pwErr = validatePassword(password);
    if (pwErr) { showMsg(pwErr, 'err'); pwEl.focus(); return; }
    if (password !== password2) { showMsg('비밀번호가 일치하지 않습니다.', 'err'); pw2El.focus(); return; }

    // 연락처 부분입력 검증
    if ((p1 || p2 || p3) && !(p1 && p2 && p3)) {
      showMsg('연락처는 전체를 입력하거나 모두 비워두세요.', 'err');
      return;
    }

    const btn = $('btn-signup');
    btn.disabled = true;
    btn.textContent = '신청 중...';

    try {
      const marketingConsent = sessionStorage.getItem('np-marketing-consent') === '1';
      const termsVersion = sessionStorage.getItem('np-terms-version') || '';

      // raw_user_meta_data 에 추가 정보 전달 → 트리거가 profiles 로 INSERT
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: location.origin + '/login/',
          data: {
            name,
            full_name: name,
            phone,
            terms_agreed_version: termsVersion,
            marketing_consent: marketingConsent,
          },
        },
      });
      if (error) throw error;

      // Supabase enumeration 보호: 이미 가입자도 success 응답
      // 다만 user.identities 가 빈 배열이면 이미 가입자라는 신호 → 명확히 안내
      const isExisting = data && data.user
        && Array.isArray(data.user.identities) && data.user.identities.length === 0;

      if (isExisting) {
        showMsg(
          '이미 가입된 이메일입니다.\n' +
          '로그인 페이지에서 로그인하시거나, 비밀번호를 잊으셨다면 비밀번호 찾기를 이용해주세요.',
          'err'
        );
        btn.disabled = false;
        btn.textContent = '가입 신청';
        return;
      }

      // 신규 가입 성공 → 약관 sessionStorage 정리
      try {
        sessionStorage.removeItem('np-terms-agreed');
        sessionStorage.removeItem('np-terms-version');
        sessionStorage.removeItem('np-marketing-consent');
      } catch (e) {}

      showMsg(
        '가입 신청이 접수되었습니다.\n' +
        '이메일로 보낸 인증 메일의 링크를 눌러 확인을 완료한 뒤 로그인해주세요. ' +
        '메일이 오지 않으면 스팸함을 확인하시거나, 이미 가입된 이메일인지 확인해주세요. ' +
        '(관리자 승인 후 이용 가능)',
        'ok'
      );
      btn.textContent = '신청 완료';
      document.querySelectorAll('#signup-form input').forEach(i => i.disabled = true);
      document.querySelectorAll('#signup-form button').forEach(b => b.disabled = true);
    } catch (err) {
      let m = err.message || String(err);
      if (/already registered/i.test(m) || /already in use/i.test(m) || /already exists/i.test(m)) {
        m = '이미 가입된 이메일입니다. 로그인 페이지로 이동해주세요.';
      } else if (/Password should be at least/i.test(m)) {
        m = '비밀번호 정책: 8~32자, 영문·숫자·특수문자 중 2가지 이상.';
      } else if (/rate limit/i.test(m)) {
        m = '메일 발송 한도 초과 — 같은 이메일은 시간당 2회까지 가능합니다. 약 1시간 뒤 다시 시도해주세요.';
      }
      showMsg(m, 'err');
      btn.disabled = false;
      btn.textContent = '가입 신청';
    }
  });

  // ─── Google OAuth ───
  $('btn-google').addEventListener('click', async () => {
    msgEl.textContent = '';
    try {
      // 콜백 URL 에 np_from=oauth 마커 — 돌아왔을 때 자동 이동 (카드 안 거침)
      const redirectTo = `${location.origin}/login/?np_from=oauth&next=${encodeURIComponent('/main/')}`;
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
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
