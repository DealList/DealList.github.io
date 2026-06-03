/* Numbers Pool — 새 비밀번호 설정 (recovery 링크 도착지)
 *
 * Supabase 가 hash 의 access_token 을 자동으로 추출해 recovery 세션 시작.
 * 이 세션은 비밀번호 변경 외엔 권한 없음.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const msgEl = $('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // ─── recovery 세션 확인 ───
  // Supabase detectSessionInUrl 이 hash 토큰을 자동으로 처리 → getSession 으로 확인
  let hasSession = false;
  try {
    // 잠시 대기 — detectSessionInUrl 처리 시간
    await new Promise(r => setTimeout(r, 200));
    const { data } = await sb.auth.getSession();
    hasSession = !!(data && data.session);
  } catch (e) {
    console.warn('[reset] session check failed', e);
  }

  if (!hasSession) {
    $('invalid-card').hidden = false;
    return;
  }

  $('reset-card').hidden = false;

  // ─── 비밀번호 정책 (signup 과 동일) ───
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
    if (err) { pwHint.classList.add('err'); pwHint.textContent = err; }
    else     { pwHint.classList.remove('err'); pwHint.textContent = '✓ 사용 가능한 비밀번호'; }
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

  // ─── 폼 제출 ───
  $('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';

    const pw = pwEl.value;
    const pw2 = pw2El.value;

    const pwErr = validatePassword(pw);
    if (pwErr) { showMsg(pwErr, 'err'); pwEl.focus(); return; }
    if (pw !== pw2) { showMsg('비밀번호가 일치하지 않습니다.', 'err'); pw2El.focus(); return; }

    const btn = $('btn-reset');
    btn.disabled = true;
    btn.textContent = '변경 중...';

    try {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;

      // 비밀번호 변경 성공 → 보안 차원에서 로그아웃 후 로그인 페이지로
      await sb.auth.signOut();
      try { if (window.NP_clearRemember) window.NP_clearRemember(); } catch (e) {}

      showMsg('비밀번호가 변경되었습니다. 3초 뒤 로그인 페이지로 이동합니다.', 'ok');
      btn.textContent = '변경 완료';
      pwEl.disabled = true;
      pw2El.disabled = true;
      setTimeout(() => location.replace('/login/'), 3000);
    } catch (err) {
      const m = err.message || String(err);
      showMsg('비밀번호 변경 실패: ' + m, 'err');
      btn.disabled = false;
      btn.textContent = '비밀번호 변경';
    }
  });
})();
