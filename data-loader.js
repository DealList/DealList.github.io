/* Numbers Pool — 게이트된 JSON 로더 (robust)
 *
 * site-data 버킷의 JSON 파일을 signed URL 로 fetch.
 * RLS 가 비-승인 사용자의 signed URL 생성을 거부하므로
 * 로그인+승인된 사용자만 데이터에 접근 가능.
 *
 * 사용:
 *   const summary = await NP_loadData('summary.json');
 *
 * 설계 노트:
 *   - createSignedUrl 은 인증 세션이 필요. autoRefresh 락 경합/네트워크로
 *     무한 대기(hang)에 빠지면 페이지가 조용히 빈 채로 멈춤 → 모든 단계에
 *     타임아웃을 걸어 hang 을 "명확한 에러"로 강등.
 *   - 호출 전 세션을 1회 워밍(getSession)해 락 경합 완화.
 *   - signed URL 1회 재시도.
 */
(function () {
  const BUCKET = 'site-data';
  const URL_TTL = 60;  // signed URL 유효 시간 (초)

  function withTimeout(promise, ms, label) {
    let to;
    const timeout = new Promise((_, reject) => {
      to = setTimeout(() => reject(new Error('시간 초과(' + ms + 'ms): ' + label)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
  }

  async function waitForSupabase(timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      if (window.sb) return window.sb;
      await new Promise(r => setTimeout(r, 50));
      elapsed += 50;
    }
    throw new Error('Supabase 클라이언트 로드 실패 (timeout)');
  }

  // 세션 1회 워밍 (캐시) — 여러 NP_loadData 가 동시에 떠도 한 번만 실행
  let _sessionWarm = null;
  function ensureSession(sb) {
    if (!_sessionWarm) {
      _sessionWarm = withTimeout(sb.auth.getSession(), 10000, 'getSession')
        .catch((e) => { _sessionWarm = null; throw e; });  // 실패 시 다음 호출 때 재시도 허용
    }
    return _sessionWarm;
  }

  // ── 로딩 오버레이 자동 해제 (np-loading.js 와 연동) ──
  // 동시/연속 호출을 추적해, "마지막 로드"가 끝난 직후 오버레이를 닫는다.
  // 페이지마다 별도 코드 없이 모든 데이터 페이지에서 동작.
  let _inflight = 0, _anyStarted = false, _dismissTimer = null;
  function _markStart() {
    _anyStarted = true;
    _inflight++;
    if (_dismissTimer) { clearTimeout(_dismissTimer); _dismissTimer = null; }
  }
  function _markEnd() {
    _inflight = Math.max(0, _inflight - 1);
    if (_inflight === 0 && _anyStarted) {
      if (_dismissTimer) clearTimeout(_dismissTimer);
      // 200ms 디바운스 — 연속 호출 사이의 짧은 공백에 닫히지 않게
      _dismissTimer = setTimeout(() => {
        if (window.NP_loadingDone) window.NP_loadingDone();
      }, 200);
    }
  }

  const _loadInner = async function (filename) {
    const sb = await waitForSupabase();

    // 세션 준비 — 없으면(비로그인) 에러로 빠르게 실패
    try {
      const { data: { session } } = await ensureSession(sb);
      if (!session) throw new Error('로그인 세션 없음');
    } catch (e) {
      console.error('[NP_loadData] 세션 확인 실패:', e.message, '(' + filename + ')');
      throw e;
    }

    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const signed = await withTimeout(
          sb.storage.from(BUCKET).createSignedUrl(filename, URL_TTL),
          15000, 'createSignedUrl ' + filename);
        if (signed.error) throw new Error('signed URL 거부: ' + (signed.error.message || signed.error));
        if (!signed.data || !signed.data.signedUrl) throw new Error('signed URL 비어있음: ' + filename);

        const res = await withTimeout(
          fetch(signed.data.signedUrl, { cache: 'no-store' }),
          20000, 'fetch ' + filename);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + filename);
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn('[NP_loadData] ' + filename + ' 시도 ' + attempt + '/2 실패:', e.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
    console.error('[NP_loadData] ' + filename + ' 최종 실패:', lastErr && lastErr.message);
    throw lastErr;
  };

  window.NP_loadData = async function (filename) {
    _markStart();
    try {
      return await _loadInner(filename);
    } finally {
      _markEnd();
    }
  };
})();
