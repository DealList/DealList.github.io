/* Numbers Pool — Supabase 클라이언트 공용 초기화
 *
 * 모든 인증/회원 관련 페이지가 이 스크립트를 공유.
 * 로드 후 글로벌:
 *   window.sb                  : Supabase JS 클라이언트
 *   window.NP_SUPABASE_READY   : Promise<{ sb, error }>
 *
 * 사용 순서:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/supabase-client.js"></script>
 *   <script src="/auth-helper.js"></script>
 *   <script src="app.js"></script>
 */
(function () {
  const URL = 'https://noacmyjepbtdvycrzsmj.supabase.co';
  // Publishable key — 브라우저 공개 가능 (RLS 가 진짜 보안선).
  // service_role 키는 절대 여기 넣지 말 것.
  const KEY = 'sb_publishable_JZBEavKwRpl-KRfe1huBrA_082xbrrz';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[supabase-client] Supabase JS SDK 미로드 — CDN 스크립트가 먼저 로드돼야 함');
    window.NP_SUPABASE_READY = Promise.resolve({
      sb: null,
      error: new Error('Supabase JS SDK 미로드'),
    });
    return;
  }

  // 기존 admin/admin.js 와 storage 공유 (storageKey 미지정 = 기본값).
  // 한 번 로그인하면 양쪽 페이지에서 같은 세션 사용.
  window.sb = window.supabase.createClient(URL, KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  window.NP_SUPABASE_READY = Promise.resolve({ sb: window.sb, error: null });
})();
