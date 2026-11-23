// 앱 본체(app.js)를 불러오고, 실패하면 로딩 화면 대신 오류 안내를 보여 준다.
// CSP(S-1)에서 인라인 스크립트를 허용하지 않도록 index.html에서 떼어 낸 파일이다.
(function () {
  var showLoadError = function () {
    document.getElementById('appLoading').hidden = true;
    document.getElementById('appLoadError').hidden = false;
  };
  import(new URL('app.js', document.baseURI).href).catch(showLoadError);
})();
