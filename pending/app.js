/* Numbers Pool — 승인 대기 페이지 */
(async () => {
  const profile = await NP.getProfile();

  if (!profile) {
    // 로그인 안 됐으면 로그인 페이지로
    location.href = '/login/';
    return;
  }

  if (profile.status === 'approved') {
    // 이미 승인됐으면 대시보드로
    location.href = '/main/';
    return;
  }

  // 화면에 정보 표시
  document.getElementById('email').textContent = profile.email || '—';

  const statusLabel = {
    pending:  '승인 대기',
    rejected: '가입 거절',
    revoked:  '권한 해제',
  }[profile.status] || profile.status;
  document.getElementById('status').textContent = statusLabel;

  // 상태별 안내 텍스트 조정
  if (profile.status === 'rejected') {
    document.getElementById('title').textContent = '가입이 거절되었습니다';
    document.getElementById('subtitle').innerHTML =
      '가입 신청이 거절되었습니다.<br/>문의가 있으시면 운영자에게 연락해주세요.';
  } else if (profile.status === 'revoked') {
    document.getElementById('title').textContent = '접근 권한이 해제되었습니다';
    document.getElementById('subtitle').innerHTML =
      '계정 권한이 해제되었습니다.<br/>문의가 있으시면 운영자에게 연락해주세요.';
  }

  // 로그아웃
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await NP.signOut();
    location.href = '/';
  });
})();
