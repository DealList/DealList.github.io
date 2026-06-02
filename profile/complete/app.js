/* Numbers Pool — 프로필 완성 페이지
 *
 * 첫 로그인 시(주로 Google OAuth 가입자) 약관 동의 + 추가 정보 입력
 * - 약관 동의가 안 된 사용자: 약관 섹션 표시 + 필수 동의 후 저장 가능
 * - 약관 이미 동의: 약관 섹션 숨김 + 연락처·주소만 추가/수정 가능 ("나중에" 가능)
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
  try {
    profile = await NP.getProfile();
  } catch (e) { profile = null; }

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

  // ─── 약관 동의 분기 ───
  const needsTerms = !profile.terms_agreed_version;
  const next = (new URL(location.href).searchParams.get('next')) || '/main/';

  if (needsTerms) {
    // 약관 미동의자: 약관 섹션 표시, 필수 동의 전엔 저장 비활성
    $('terms-section').hidden = false;
    $('btn-save').disabled = true;
    $('btn-save').textContent = '저장하고 시작';
    // 안내 문구
    $('welcome-sub').textContent =
      '서비스 이용을 위해 약관 동의 및 추가 정보를 입력해주세요.';
  } else {
    // 약관 이미 동의됨: 추가 정보만 수정 (이미 시작한 사용자 / 자발 방문)
    $('terms-section').hidden = true;
    $('skip-link').hidden = false;  // "나중에" 허용
    $('welcome-sub').textContent = '연락처와 주소 정보를 추가하거나 수정할 수 있습니다.';
    // 기존 값 prefill
    if (profile.phone) {
      const m = profile.phone.match(/^(\d{2,3})-(\d{3,4})-(\d{4})$/);
      if (m) { $('phone1').value = m[1]; $('phone2').value = m[2]; $('phone3').value = m[3]; }
    }
    if (profile.zipcode)        $('zipcode').value         = profile.zipcode;
    if (profile.address)        $('address').value         = profile.address;
    if (profile.address_detail) $('address-detail').value  = profile.address_detail;
  }

  // ─── 약관 체크박스 ───
  const allEl       = $('chk-all');
  const requiredEls = Array.from(document.querySelectorAll('.chk-required'));
  const marketingEl = $('chk-marketing');
  const saveBtn     = $('btn-save');

  function updateState() {
    if (!needsTerms) return;  // 약관 동의 이미 됨 → 항상 활성
    const ok = requiredEls.every(c => c.checked);
    saveBtn.disabled = !ok;
    const allChecked = ok && marketingEl.checked;
    const anyChecked = ok || marketingEl.checked || requiredEls.some(c => c.checked);
    allEl.checked = allChecked;
    allEl.indeterminate = !allChecked && anyChecked;
  }

  if (needsTerms) {
    allEl.addEventListener('change', () => {
      const v = allEl.checked;
      requiredEls.forEach(c => c.checked = v);
      marketingEl.checked = v;
      allEl.indeterminate = false;
      saveBtn.disabled = !v;
    });
    requiredEls.forEach(c => c.addEventListener('change', updateState));
    marketingEl.addEventListener('change', updateState);
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

  // ─── 우편번호 검색 ───
  $('btn-zipcode').addEventListener('click', () => {
    if (typeof daum === 'undefined' || !daum.Postcode) {
      showMsg('우편번호 검색 스크립트 로드 실패. 잠시 후 다시 시도해주세요.', 'err');
      return;
    }
    new daum.Postcode({
      oncomplete: (data) => {
        const addr = data.roadAddress || data.jibunAddress || '';
        let extra = '';
        if (data.bname)        extra += data.bname;
        if (data.buildingName) extra += (extra ? ', ' : '') + data.buildingName;
        const fullAddr = extra ? `${addr} (${extra})` : addr;
        $('zipcode').value = data.zonecode || '';
        $('address').value = fullAddr;
        $('address-detail').focus();
      },
    }).open();
  });

  // ─── 폼 제출 ───
  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = '';

    if (needsTerms && !requiredEls.every(c => c.checked)) {
      showMsg('필수 약관에 모두 동의해주세요.', 'err');
      return;
    }

    const p1 = $('phone1').value.trim();
    const p2 = $('phone2').value.trim();
    const p3 = $('phone3').value.trim();
    if ((p1 || p2 || p3) && !(p1 && p2 && p3)) {
      showMsg('연락처는 전체를 입력하거나 모두 비워두세요.', 'err');
      return;
    }
    const phone = (p1 && p2 && p3) ? `${p1}-${p2}-${p3}` : null;
    const zipcode        = $('zipcode').value.trim()        || null;
    const address        = $('address').value.trim()        || null;
    const addressDetail  = $('address-detail').value.trim() || null;

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const { error } = await sb.rpc('update_my_profile_extras', {
        p_phone:                phone,
        p_zipcode:              zipcode,
        p_address:              address,
        p_address_detail:       addressDetail,
        p_marketing_consent:    needsTerms ? !!marketingEl.checked : null,
        p_terms_agreed_version: needsTerms ? '20260602' : null,
      });
      if (error) throw error;

      // 성공 → next 로 (기본 /main/)
      location.replace(next);
    } catch (err) {
      let m = err.message || String(err);
      if (/function .* does not exist/i.test(m)) {
        m = 'RPC 함수가 아직 설정되지 않았습니다. 운영팀에 문의해주세요.';
      }
      showMsg('저장 실패: ' + m, 'err');
      saveBtn.disabled = false;
      saveBtn.textContent = '저장하고 시작';
    }
  });
})();
