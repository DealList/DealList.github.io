/* Numbers Pool — 초기 로딩 오버레이
 *
 * 데이터(signed URL → JSON)가 도착하기 전 빈 화면 깜빡임을 막기 위해
 * 페이지 로드 즉시 골드 스피너 오버레이를 띄우고, 데이터 로딩이 끝나면
 * data-loader.js 가 NP_loadingDone() 을 호출해 부드럽게 사라지게 한다.
 *
 * - 테마 inline 스크립트 다음, 가장 먼저 로드 (CDN/데이터보다 빨리 표시)
 * - 6초 안전장치: 어떤 이유로 done 이 안 불려도 자동 해제 (영구 가림 방지)
 */
(function () {
  if (window.__npLoadingInjected) return;
  window.__npLoadingInjected = true;

  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var bg  = dark ? '#0b1220' : '#ffffff';
  var ring = dark ? '#2a2410' : '#f0e6c8';
  var gold = dark ? '#cba23f' : '#9c7a17';
  var sub  = dark ? '#94a3b8' : '#64748b';

  var style = document.createElement('style');
  style.textContent =
    '#np-loading{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:14px;background:' + bg + ';' +
    'transition:opacity .3s ease;opacity:1;}' +
    '#np-loading.np-hide{opacity:0;pointer-events:none;}' +
    '#np-loading .np-spin{width:38px;height:38px;border-radius:50%;border:3px solid ' + ring + ';' +
    'border-top-color:' + gold + ';animation:np-spin .8s linear infinite;}' +
    '#np-loading .np-txt{font-size:13px;letter-spacing:.02em;color:' + sub + ';' +
    "font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;}" +
    '@keyframes np-spin{to{transform:rotate(360deg);}}';
  document.documentElement.appendChild(style);

  var ov = document.createElement('div');
  ov.id = 'np-loading';
  ov.innerHTML = '<div class="np-spin"></div><div class="np-txt">불러오는 중…</div>';
  (document.body || document.documentElement).appendChild(ov);

  var done = false;
  window.NP_loadingDone = function () {
    if (done) return;
    done = true;
    var el = document.getElementById('np-loading');
    if (!el) return;
    el.classList.add('np-hide');
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 350);
  };

  // 안전장치 — 데이터 로딩이 끝나도 done 이 안 불리는 경우 대비
  setTimeout(function () { window.NP_loadingDone(); }, 6000);
})();
