// 404 화면 문구: 앱과 같은 언어 (boot.js가 정한 <html lang>을 따른다). 앱 파일 없이 동작해야 해서 문구를 여기에 둔다.
// CSP(S-1)에서 인라인 스크립트를 허용하지 않도록 404.html에서 떼어 낸 파일이다.
(function () {
  var T = {
    en: ['Page or shared link not found', 'The address is wrong or the shared link has expired. Ask the sender for a new link. Your own trips are still saved in this browser.', 'Go to XenoTravel home'],
    'zh-Hans': ['找不到该页面或分享链接', '地址有误或分享链接已失效。请向发送者重新索取链接。你的行程仍保存在此浏览器中。', '返回 XenoTravel 首页'],
    ja: ['ページまたは共有リンクが見つかりません', 'アドレスが間違っているか、共有リンクの期限が切れています。送信者にもう一度リンクをもらってください。あなたの旅行はこのブラウザに保存されたままです。', 'XenoTravel ホームへ'],
  };
  var s = T[document.documentElement.lang];
  if (!s) return;
  document.getElementById('h').textContent = s[0];
  document.getElementById('p').textContent = s[1];
  document.getElementById('a').textContent = s[2];
})();
