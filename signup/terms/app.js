/* Numbers Pool — 약관 동의 페이지 */
(function () {
  const $ = (id) => document.getElementById(id);
  const allEl       = $('chk-all');
  const requiredEls = Array.from(document.querySelectorAll('.chk-required'));
  const marketingEl = $('chk-marketing');
  const btn         = $('btn-agree');

  function updateState() {
    const allRequired = requiredEls.every(c => c.checked);
    btn.disabled = !allRequired;

    const allItems = requiredEls.concat([marketingEl]);
    const checkedCount = allItems.filter(c => c.checked).length;
    if (checkedCount === allItems.length) {
      allEl.checked = true;
      allEl.indeterminate = false;
    } else if (checkedCount === 0) {
      allEl.checked = false;
      allEl.indeterminate = false;
    } else {
      allEl.checked = false;
      allEl.indeterminate = true;
    }
  }

  // 모두 동의 토글 — 전체 일괄 변경
  allEl.addEventListener('change', () => {
    const v = allEl.checked;
    requiredEls.forEach(c => c.checked = v);
    marketingEl.checked = v;
    allEl.indeterminate = false;
    btn.disabled = !v;
  });

  // 개별 체크박스 — 마스터 상태 갱신
  requiredEls.forEach(c => c.addEventListener('change', updateState));
  marketingEl.addEventListener('change', updateState);

  // 동의 완료 — sessionStorage 에 기록 후 가입 정보 페이지로
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    try {
      sessionStorage.setItem('np-terms-agreed', '1');
      sessionStorage.setItem('np-terms-version', '20260602');
      sessionStorage.setItem('np-marketing-consent', marketingEl.checked ? '1' : '0');
    } catch (e) {
      console.warn('[terms] sessionStorage write failed', e);
    }
    location.href = '../';  // /signup/
  });
})();
