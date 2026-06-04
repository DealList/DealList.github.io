/* Numbers Pool — 마이페이지
 *
 * 조회: 이메일·가입방식·상태·가입일 + 이름·연락처·마케팅동의
 * 수정: update_my_account RPC (이름·연락처·마케팅 — 주소 인자는 호환 위해 null 로 전달)
 * 비번 변경: sb.auth.updateUser (이메일 가입자만)
 * 탈퇴: delete_my_account RPC (본인 계정+개인정보 완전 삭제)
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const msgEl = $('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
    msgEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // ─── 인증 가드 ───
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }
  if (!profile) {
    location.replace('/login/?next=' + encodeURIComponent('/account/'));
    return;
  }
  if (profile.status !== 'approved') {
    location.replace(NP.targetByStatus(profile, '/main/'));
    return;
  }

  // ─── 계정 정보 표시 (읽기 전용) ───
  $('i-email').textContent = profile.email || '—';
  const methodLabel = { google: 'Google 계정', email: '이메일·비밀번호' };
  $('i-method').textContent = methodLabel[profile.signup_method] || profile.signup_method || '—';
  $('i-status').textContent = '승인됨';
  $('i-created').textContent = fmtDate(profile.created_at);

  // ─── 정보 수정 prefill ───
  $('name').value = profile.name || '';
  if (profile.phone) {
    const m = profile.phone.match(/^(\d{2,3})-(\d{3,4})-(\d{4})$/);
    if (m) { $('phone1').value = m[1]; $('phone2').value = m[2]; $('phone3').value = m[3]; }
  }
  $('marketing').checked = !!profile.marketing_consent;

  // ─── 비밀번호 섹션: 가입 방식별 ───
  if (profile.signup_method === 'google') {
    $('pw-google-note').hidden = false;
  } else {
    $('pw-section').hidden = false;
  }

  // ─── 연락처 자동 포커스 + 숫자만 ───
  function setupPhone(curId, nextId, len) {
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
  setupPhone('phone1', 'phone2', 3);
  setupPhone('phone2', 'phone3', 4);
  setupPhone('phone3', null, 4);

  // ─── 정보 저장 ───
  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = ''; msgEl.className = '';

    const name = $('name').value.trim();
    if (!name) { showMsg('이름을 입력해주세요.', 'err'); return; }

    const p1 = $('phone1').value.trim(), p2 = $('phone2').value.trim(), p3 = $('phone3').value.trim();
    if ((p1 || p2 || p3) && !(p1 && p2 && p3)) {
      showMsg('연락처는 전체를 입력하거나 모두 비워두세요.', 'err');
      return;
    }
    const phone = (p1 && p2 && p3) ? `${p1}-${p2}-${p3}` : null;

    const btn = $('btn-save');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      const { error } = await sb.rpc('update_my_account', {
        p_name:              name,
        p_phone:             phone,
        p_zipcode:           null,
        p_address:           null,
        p_address_detail:    null,
        p_marketing_consent: $('marketing').checked,
      });
      if (error) throw error;
      profile.name = name;  // 로컬 반영
      showMsg('저장되었습니다.', 'ok');
    } catch (err) {
      console.error('[account] save failed', err);
      showMsg(authErr(err, '저장에 실패했습니다. 잠시 후 다시 시도해주세요.'), 'err');
    } finally {
      btn.disabled = false; btn.textContent = '저장';
    }
  });

  // ─── 비밀번호 변경 (이메일 가입자) ───
  const pwForm = $('pw-form');
  if (pwForm) {
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      msgEl.textContent = ''; msgEl.className = '';

      const pw1 = $('pw1').value, pw2 = $('pw2').value;
      const v = validatePassword(pw1);
      if (!v.ok) { showMsg(v.msg, 'err'); return; }
      if (pw1 !== pw2) { showMsg('새 비밀번호가 일치하지 않습니다.', 'err'); return; }

      const btn = $('btn-pw');
      btn.disabled = true; btn.textContent = '변경 중...';
      try {
        const { error } = await sb.auth.updateUser({ password: pw1 });
        if (error) throw error;
        $('pw1').value = ''; $('pw2').value = '';
        showMsg('비밀번호가 변경되었습니다.', 'ok');
      } catch (err) {
        let m = err.message || String(err);
        if (/different from the old|should be different|New password should be different/i.test(m)) {
          m = '기존 비밀번호와 다른 비밀번호를 입력해주세요.';
        } else if (/reauthentication|sign in again|session|JWT/i.test(m)) {
          m = '보안을 위해 다시 로그인한 후 시도해주세요.';
        } else {
          m = '비밀번호 변경에 실패했습니다: ' + m;
        }
        showMsg(m, 'err');
      } finally {
        btn.disabled = false; btn.textContent = '비밀번호 변경';
      }
    });
  }

  // ─── 회원 탈퇴 ───
  $('btn-delete').addEventListener('click', () => {
    $('delete-confirm').classList.remove('hidden');
    $('btn-delete').style.display = 'none';
    try { $('delete-ack').focus(); } catch (e) {}
  });
  $('delete-ack').addEventListener('change', () => {
    $('btn-delete-final').disabled = !$('delete-ack').checked;
  });
  $('btn-delete-final').addEventListener('click', async () => {
    if (!$('delete-ack').checked) return;
    msgEl.textContent = ''; msgEl.className = '';
    const btn = $('btn-delete-final');
    btn.disabled = true; btn.textContent = '처리 중...';
    try {
      const { error } = await sb.rpc('delete_my_account');
      if (error) throw error;
      // 세션·로컬 흔적 정리
      try { await sb.auth.signOut(); } catch (e) {}
      try { localStorage.removeItem('np-last-active'); } catch (e) {}
      try { if (window.NP_clearRemember) window.NP_clearRemember(); } catch (e) {}
      $('delete-confirm').style.display = 'none';
      showMsg('탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.', 'ok');
      setTimeout(() => location.replace('/'), 2400);
    } catch (err) {
      console.error('[account] delete failed', err);
      showMsg(authErr(err, '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도하거나 master@numberspool.co.kr 로 문의해주세요.'), 'err');
      btn.disabled = false; btn.textContent = '영구 탈퇴하기';
    }
  });

  // ─── helpers ───
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    } catch (e) { return '—'; }
  }
  function validatePassword(pw) {
    if (!pw || pw.length < 8 || pw.length > 32) return { ok: false, msg: '비밀번호는 8~32자로 입력해주세요.' };
    if (/(.)\1{3,}/.test(pw)) return { ok: false, msg: '같은 문자를 4번 이상 반복할 수 없습니다.' };
    let kinds = 0;
    if (/[a-zA-Z]/.test(pw)) kinds++;
    if (/[0-9]/.test(pw)) kinds++;
    if (/[^a-zA-Z0-9]/.test(pw)) kinds++;
    if (kinds < 2) return { ok: false, msg: '영문·숫자·특수문자 중 2가지 이상을 조합해주세요.' };
    return { ok: true };
  }
  function authErr(err, fallback) {
    const raw = (err && (err.message || err.error_description || '')) || '';
    if (/not authenticated/i.test(raw)) return '인증 세션이 만료됐습니다. 다시 로그인해주세요.';
    return fallback;
  }
})();
