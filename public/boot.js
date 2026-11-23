// 첫 화면 준비: <head>에서 동기로 실행해 깜빡임 없이 언어·밝기를 정한다 (번역은 app.js가 채운다).
// CSP(S-1)에서 인라인 스크립트를 허용하지 않도록 index.html에서 떼어 낸 파일이다.
(function () {
  var root = document.documentElement;
  // 첫 화면부터 저장된 언어로
  try {
    var l = localStorage.getItem('xenotravel:lang');
    if (l === 'en' || l === 'ja') root.lang = l;
    else if (l === 'zh') root.lang = 'zh-Hans';
  } catch (e) {}
  // 밝기도 첫 화면부터 확정 (light | dark 두 상태, 저장값이 없으면 기기 설정)
  try {
    var th = JSON.parse(localStorage.getItem('xenotravel:prefs') || '{}').theme;
    if (th !== 'light' && th !== 'dark') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.dataset.theme = th;
    root.classList.toggle('dark', th === 'dark');
  } catch (e) {}
})();
