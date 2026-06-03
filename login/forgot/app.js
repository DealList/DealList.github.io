/* Numbers Pool — 비밀번호 재설정 메일 요청 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const msgEl = $('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  $('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = '';

    const email = $('email').value.trim().toLowerCase();
    const btn = $('btn-send');
    btn.disabled = true;
    btn.textContent = '보내는 중...';

    try {
      // Supabase 는 보안상(enumeration 방지) 가입 여부 무관 항상 성공 반환
      // 그래서 사용자에게 "메일 확인" 안내만 표시
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/login/reset/',
      });
      if (error) throw error;

      showMsg(
        '재설정 메일을 보냈습니다.\n' +
        '메일함을 확인하고 링크를 클릭해 새 비밀번호를 설정해주세요. ' +
        '(스팸 폴더도 확인해주세요. 가입된 이메일이 아니면 메일이 오지 않습니다.)',
        'ok'
      );
      btn.textContent = '메일 발송 완료';
      $('email').disabled = true;
    } catch (err) {
      let m = err.message || String(err);
      if (/rate limit/i.test(m)) {
        m = '잠시 후 다시 시도해주세요. 보안을 위해 잠깐 메일 발송이 제한됩니다 (약 1분).';
      } else if (/invalid email|not a valid email/i.test(m)) {
        m = '올바른 이메일 형식이 아닙니다.';
      }
      showMsg('재설정 메일 발송 실패: ' + m, 'err');
      btn.disabled = false;
      btn.textContent = '재설정 메일 받기';
    }
  });
})();
