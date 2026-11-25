// 정적 페이지(가이드·개인정보·소개·문의·약관) 공용 스크립트 (I-2).
// <head>에서 동기로 실행해 앱과 같은 밝기 저장값(xenotravel:prefs.theme)을 첫 화면부터 따른다.
// 언어는 페이지 주소(/ko/…)가 정하므로 <html lang>은 건드리지 않는다.
(function () {
  var root = document.documentElement;
  try {
    var th = JSON.parse(localStorage.getItem('xenotravel:prefs') || '{}').theme;
    if (th === 'light' || th === 'dark') root.dataset.theme = th;
  } catch (e) {}

  function ready() {
    // J-8: [← 돌아가기] — 앱(같은 사이트)에서 왔으면 이전 화면으로, 아니면 홈으로
    var back = document.querySelector('[data-trend-back]');
    if (back) back.addEventListener('click', function (e) {
      var ref = document.referrer;
      if (ref && ref.indexOf(location.origin + '/') === 0 && history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });
    // J-9: 카드 전체 클릭 — 카드 안 제목 링크로 (새 탭·주소 복사는 링크 그대로)
    document.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.card-link');
      if (!card || e.target.closest('a, button')) return;
      var link = card.querySelector('a[href]');
      if (link) link.click();
    });
    // 모바일 메뉴(☰): 펼치기/접기, Esc로 닫기
    var btn = document.querySelector('.site-menu-btn');
    var head = document.querySelector('.site-head');
    if (btn && head) {
      var setOpen = function (open) {
        head.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
      };
      btn.addEventListener('click', function () { setOpen(!head.classList.contains('open')); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && head.classList.contains('open')) { setOpen(false); btn.focus(); }
      });
    }
    // 언어 버튼: 직접 고른 언어는 앱과 같은 키에 저장한다 (P0-7: 직접 누른 경우에만 저장)
    document.querySelectorAll('[data-set-lang]').forEach(function (a) {
      a.addEventListener('click', function () {
        try { localStorage.setItem('xenotravel:lang', a.getAttribute('data-set-lang')); } catch (e) {}
      });
    });
    // 문의 메일 주소 복사 + "복사했어요" 토스트
    var toast = document.querySelector('.site-toast');
    var timer;
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var text = b.getAttribute('data-copy');
        var done = function () {
          if (!toast) return;
          toast.textContent = b.getAttribute('data-copied') || '';
          toast.hidden = false;
          clearTimeout(timer);
          timer = setTimeout(function () { toast.hidden = true; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { window.prompt('', text); });
        } else {
          window.prompt('', text);
        }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
