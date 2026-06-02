/* Numbers Pool — 인증 헬퍼
 *
 * 사용:
 *   const session = await NP.getSession();
 *   const user    = await NP.getUser();
 *   const profile = await NP.getProfile();
 *   await NP.signOut();
 *
 * 반드시 supabase-client.js 보다 나중에 로드.
 */
window.NP = (function () {
  const sb = () => window.sb;

  async function getSession() {
    if (!sb()) return null;
    try {
      const { data, error } = await sb().auth.getSession();
      if (error) { console.warn('[NP] getSession error', error); return null; }
      return data.session;
    } catch (e) { console.warn('[NP] getSession exception', e); return null; }
  }

  async function getUser() {
    const s = await getSession();
    return s ? s.user : null;
  }

  // 본인 profiles 행 조회 — RLS 가 본인 행만 허용
  async function getProfile() {
    if (!sb()) return null;
    const u = await getUser();
    if (!u) return null;
    try {
      const { data, error } = await sb()
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle();
      if (error) { console.warn('[NP] getProfile error', error); return null; }
      return data;
    } catch (e) { console.warn('[NP] getProfile exception', e); return null; }
  }

  async function signOut() {
    if (!sb()) return;
    try { await sb().auth.signOut(); } catch (e) { console.warn('[NP] signOut', e); }
    // remember-me 플래그도 같이 정리 — 다음 로그인은 다시 OFF 가 기본
    try { if (window.NP_clearRemember) window.NP_clearRemember(); } catch (e) {}
  }

  // status 로 가야 할 곳 결정
  // 기본 목적지는 /main/ (대시보드). / 는 비로그인용 미리보기.
  function targetByStatus(profile, defaultPath) {
    if (!profile)                      return '/login/';
    if (profile.status === 'pending')  return '/pending/';
    if (profile.status === 'rejected') return '/pending/?denied=rejected';
    if (profile.status === 'revoked')  return '/pending/?denied=revoked';
    return defaultPath || '/main/';
  }

  return { getSession, getUser, getProfile, signOut, targetByStatus };
})();
