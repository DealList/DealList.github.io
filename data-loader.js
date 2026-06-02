/* Numbers Pool — 게이트된 JSON 로더
 *
 * site-data 버킷의 JSON 파일을 signed URL 로 fetch.
 * RLS 가 비-승인 사용자의 signed URL 생성을 거부하므로
 * 로그인+승인된 사용자만 데이터에 접근 가능.
 *
 * 사용:
 *   const summary = await NP_loadData('summary.json');
 *   const data    = await NP_loadData('data.json');
 *
 * 반드시 supabase-client.js 보다 나중에 로드.
 */
(function () {
  const BUCKET = 'site-data';
  const URL_TTL = 60;  // signed URL 유효 시간 (초)

  // Supabase 클라이언트가 비동기로 로드될 수 있어 잠시 대기
  async function waitForSupabase(timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    if (window.sb) return window.sb;
    const interval = 50;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      if (window.sb) return window.sb;
      await new Promise(r => setTimeout(r, interval));
      elapsed += interval;
    }
    throw new Error('Supabase 클라이언트 로드 실패 (timeout ' + timeoutMs + 'ms)');
  }

  window.NP_loadData = async function (filename) {
    const sb = await waitForSupabase();

    // 1) signed URL 생성 (RLS 통과해야 성공)
    const { data, error } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(filename, URL_TTL);
    if (error) {
      console.error('[NP_loadData] signed URL error', error, 'file=', filename);
      throw new Error('데이터 권한 없음: ' + (error.message || error));
    }

    // 2) signed URL 로 실제 fetch
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('데이터 fetch 실패 (HTTP ' + res.status + ') — ' + filename);
    }
    return res.json();
  };
})();
