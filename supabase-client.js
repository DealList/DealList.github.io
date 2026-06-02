/* Numbers Pool — Supabase 클라이언트 공용 초기화
 *
 * 로드 후 글로벌:
 *   window.sb                  : Supabase JS 클라이언트
 *   window.NP_SUPABASE_READY   : Promise<{ sb, error }>
 *   window.NP_setRemember(bool): "이 기기에 로그인 유지" 플래그
 *   window.NP_clearRemember()  : 위 플래그 해제
 *
 * 보안 정책:
 *   - 기본은 sessionStorage (브라우저 닫으면 로그아웃)
 *   - "이 기기에 로그인 유지" 체크 → localStorage (영구)
 *
 * 안정성:
 *   - lock 무력화: 기본 navigator Web Locks 잠금이 SPA 초기 로드에서
 *     토큰 갱신과 경합해 getSession/storage 호출을 무한 대기시키는
 *     데드락을 유발 → pass-through lock 으로 교체 (단일 탭 앱이라 안전).
 *   - 중복 createClient 방지 (window.sb 이미 있으면 재사용).
 */
(function () {
  // 이미 초기화됐으면 재생성 금지 (다중 GoTrueClient → 락 경합 방지)
  if (window.sb && window.NP_SUPABASE_READY) return;

  const URL = 'https://noacmyjepbtdvycrzsmj.supabase.co';
  // Publishable key — 브라우저 공개 가능 (RLS 가 진짜 보안선).
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
        const remember = (function () {
          try { return localStorage.getItem(REMEMBER_FLAG) === '1'; }
          catch (e) { return false; }
        })();
        if (remember) {
          localStorage.setItem(k, v);
          sessionStorage.removeItem(k);
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

  // pass-through lock — navigator.locks 데드락 회피 (단일 탭에선 조율 불필요)
  const passThroughLock = async (_name, _acquireTimeout, fn) => fn();

  window.sb = window.supabase.createClient(URL, KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: npStorage,
      lock: passThroughLock,
    },
  });

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
