/* Numbers Pool — Supabase 클라이언트 공용 초기화
 *
 * 모든 인증/회원 관련 페이지가 이 스크립트를 공유.
 * 로드 후 글로벌:
 *   window.sb                  : Supabase JS 클라이언트
 *   window.NP_SUPABASE_READY   : Promise<{ sb, error }>
 *   window.NP_setRemember(bool): "이 기기에 로그인 유지" 플래그
 *   window.NP_clearRemember()  : 위 플래그 해제
 *
 * 보안 정책:
 *   - 기본은 sessionStorage (브라우저 닫으면 로그아웃)
 *   - "이 기기에 로그인 유지" 체크 → localStorage (영구)
 *   읽기는 양쪽 다 시도 — 전환 케이스에서도 끊김 없음.
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

  const REMEMBER_FLAG = 'np-remember-me';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[supabase-client] Supabase JS SDK 미로드 — CDN 스크립트가 먼저 로드돼야 함');
    window.NP_SUPABASE_READY = Promise.resolve({
      sb: null,
      error: new Error('Supabase JS SDK 미로드'),
    });
    return;
  }

  // ─── 하이브리드 스토리지 어댑터 ───
  // 쓰기: remember 플래그가 true 면 localStorage, 아니면 sessionStorage
  // 읽기: localStorage → sessionStorage 순으로 시도
  // 삭제: 양쪽 다 제거 (확실한 로그아웃 보장)
  const npStorage = {
    getItem(k) {
      try {
        const fromLocal = localStorage.getItem(k);
        if (fromLocal !== null) return fromLocal;
        return sessionStorage.getItem(k);
      } catch (e) { return null; }
    },
    setItem(k, v) {
      try {
        const remember = (function(){
          try { return localStorage.getItem(REMEMBER_FLAG) === '1'; }
          catch (e) { return false; }
        })();
        if (remember) {
          localStorage.setItem(k, v);
          sessionStorage.removeItem(k);  // 중복 저장 방지
        } else {
          sessionStorage.setItem(k, v);
          localStorage.removeItem(k);
        }
      } catch (e) { /* quota/private mode */ }
    },
    removeItem(k) {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch (e) {}
    },
  };

  window.sb = window.supabase.createClient(URL, KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: npStorage,
    },
  });

  // 로그인 페이지에서 signIn 호출 직전에 사용
  window.NP_setRemember = function (remember) {
    try {
      if (remember) localStorage.setItem(REMEMBER_FLAG, '1');
      else localStorage.removeItem(REMEMBER_FLAG);
    } catch (e) {}
  };
  window.NP_clearRemember = function () {
    try { localStorage.removeItem(REMEMBER_FLAG); } catch (e) {}
  };

  window.NP_SUPABASE_READY = Promise.resolve({ sb: window.sb, error: null });
})();
