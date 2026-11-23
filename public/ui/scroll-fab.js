let schedulePlacement;
export { schedulePlacement as placeFabSoon };

export function init(ctx) {
  const { $, $$ } = ctx;

  /* ───────── P1-8: 맨 위로 / 맨 아래로 ─────────
   * 600px 넘게 내리면 오른쪽 아래에 버튼 두 개. 하단 탭·보관함·지도 시트·알림처럼 아래에 고정된 것 위에 놓는다.
   */
  const fab = $('#scrollFab');
  const FAB_BELOW = '.pagebar, .inbox-dock, .map-sheet, #toast.show';
  function placeFab() {
    const scrolled = scrollY > 600;
    fab.hidden = !scrolled || document.body.classList.contains('printing');
    if (fab.hidden) return;
    // 화면 아래쪽에 붙은 고정 요소 중 가장 높이 올라온 것 위로
    let top = innerHeight;
    for (const el of $$(FAB_BELOW)) {
      const r = el.getBoundingClientRect();
      if (r.height && /fixed|sticky/.test(getComputedStyle(el).position) && r.bottom > innerHeight / 2 && r.top > innerHeight / 2) top = Math.min(top, r.top);
    }
    fab.style.bottom = `${Math.round(innerHeight - top) + 12}px`;
    fab.querySelector('[data-fab="bottom"]').disabled = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  }
  fab.addEventListener('click', (e) => {
    const where = e.target.closest('[data-fab]')?.dataset.fab;
    if (!where) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({ top: where === 'top' ? 0 : document.documentElement.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  });
  let fabFrame = 0;
  const placeFabSoon = () => {
    cancelAnimationFrame(fabFrame);
    fabFrame = requestAnimationFrame(placeFab);
  };
  addEventListener('scroll', placeFabSoon, { passive: true });
  addEventListener('resize', placeFabSoon);
  new MutationObserver(placeFabSoon).observe($('#toast'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(placeFabSoon).observe($('#inboxDock'), { childList: true }); // 보관함을 펼치거나 접으면 다시 맞춘다

  schedulePlacement = placeFabSoon;
}
