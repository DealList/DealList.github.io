/* Numbers Pool — 프로필 추가 정보 입력 (연락처·주소)
 *
 * 약관 동의는 가입 시점(/signup/terms/)에 처리되므로 이 페이지에선 다루지 않음.
 * 모든 사용자가 자유롭게 연락처·주소를 추가/수정할 수 있는 페이지.
 *
 * 저장은 RPC update_my_profile_extras 로 처리 (RLS 우회, 본인 행만 update)
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const msgEl = $('msg');
  const showMsg = (text, kind) => {
    msgEl.className = 'msg ' + (kind || 'err');
    msgEl.textContent = text;
  };

  // ─── 인증 체크 ───
  let profile;
  try { profile = await NP.getProfile(); } catch (e) { profile = null; }

  if (!profile) {
    location.replace('/login/?next=' + encodeURIComponent('/profile/complete/'));
    return;
  }
  if (profile.status !== 'approved') {
    location.replace(NP.targetByStatus(profile, '/main/'));
    return;
  }

  // 본인 이메일 표시
  $('me-email').textContent = profile.email || '—';

  const next = (new URL(location.href).searchParams.get('next')) || '/main/';

  // 안내 문구 + skip 링크는 항상 보임
  $('welcome-sub').textContent = '연락처를 추가하실 수 있습니다. (선택)';
  $('skip-link').hidden = false;
  $('btn-save').textContent = '저장하고 시작';

  // 기존 값 prefill
  if (profile.phone) {
    const m = profile.phone.match(/^(\d{2,3})-(\d{3,4})-(\d{4})$/);
    if (m) { $('phone1').value = m[1]; $('phone2').value = m[2]; $('phone3').value = m[3]; }
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

  // ─── 폼 제출 ───
  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = '';

    const p1 = $('phone1').value.trim();
    const p2 = $('phone2').value.trim();
    const p3 = $('phone3').value.trim();
    if ((p1 || p2 || p3) && !(p1 && p2 && p3)) {
      showMsg('연락처는 전체를 입력하거나 모두 비워두세요.', 'err');
      return;
    }
    const phone = (p1 && p2 && p3) ? `${p1}-${p2}-${p3}` : null;

    const saveBtn = $('btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const { error } = await sb.rpc('update_my_profile_extras', {
        p_phone:                phone,
        p_zipcode:              null,
        p_address:              null,
        p_address_detail:       null,
        p_marketing_consent:    null,
        p_terms_agreed_version: null,  // 가입 시점에 이미 기록됨 (변경 불가)
      });
      if (error) throw error;
      location.replace(next);
    } catch (err) {
      console.error('[profile/complete] save failed', err);
      const raw = (err && (err.message || err.error_description || JSON.stringify(err))) || String(err);
      let m = '저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
      if (/not authenticated/i.test(raw)) {
        m = '인증 세션이 만료됐습니다. 다시 로그인해주세요.';
      }
      showMsg(m, 'err');
      msgEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      saveBtn.disabled = false;
      saveBtn.textContent = '저장하고 시작';
    }
  });
})();
