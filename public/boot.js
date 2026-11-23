// 첫 화면 준비: <head>에서 동기로 실행해 깜빡임 없이 언어·밝기를 정한다 (번역은 app.js가 채운다).
// CSP(S-1)에서 인라인 스크립트를 허용하지 않도록 index.html·404.html에서 떼어 낸 파일이다.
(function () {
  var root = document.documentElement;
  var HTML = { ko: 'ko', en: 'en', zh: 'zh-Hans', ja: 'ja' };
  // 언어 (P0-7, lib/i18n.js의 loadLang·detectLang과 같은 규칙):
  // 언어 버튼으로 고른 저장값 → 없으면 브라우저 언어(ko·ja·zh(번체도 간체로)·en) → 그 밖은 영어
  var lang = null;
  try {
    lang = localStorage.getItem('xenotravel:lang');
  } catch (e) {}
  if (!HTML[lang]) {
    lang = 'en';
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    outer: for (var i = 0; i < list.length; i++) {
      var l = String(list[i] || '').toLowerCase();
      for (var c in HTML) {
        if (l === c || l.indexOf(c + '-') === 0) {
          lang = c;
          break outer;
        }
      }
    }
  }
  root.lang = HTML[lang];
  // 밝기도 첫 화면부터 확정 (light | dark 두 상태, 저장값이 없으면 기기 설정)
  try {
    var th = JSON.parse(localStorage.getItem('xenotravel:prefs') || '{}').theme;
    if (th !== 'light' && th !== 'dark') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.dataset.theme = th;
    root.classList.toggle('dark', th === 'dark');
  } catch (e) {}
})();
