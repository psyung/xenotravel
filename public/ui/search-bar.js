let updateSearchBar;
export { updateSearchBar as checkSearchBar };

export function init(ctx) {
  const { $, prefs, curView } = ctx;

  /* ───────── P1-7: 검색창 고정 ─────────
   * 검색 카드가 머리 바 아래로 지나가면 얇은 고정 바(44px, 검색칸 + 지도에서 찍기 + 모바일 일정/지도 · 데스크톱 지도 접기)로 바뀐다.
   * 자리(.search-slot)는 원래 높이를 유지해 화면이 튀지 않고, 일차 탭은 그 아래(--search)에 붙는다.
   */
  const searchCard = $('.search.card');
  const searchSlot = document.createElement('div');
  searchSlot.className = 'search-slot';
  searchCard.before(searchSlot);
  searchSlot.append(searchCard);
  function setSearchCompact(on) {
    if (searchCard.classList.contains('compact') === on) return placeSearchBar();
    if (on) searchSlot.style.minHeight = `${searchSlot.offsetHeight}px`;
    else searchSlot.style.minHeight = '';
    searchCard.classList.toggle('compact', on);
    document.documentElement.style.setProperty('--search', on ? '52px' : '0px');
    placeSearchBar();
  }
  function placeSearchBar() {
    if (!searchCard.classList.contains('compact')) {
      searchCard.style.left = searchCard.style.width = '';
      return;
    }
    const r = searchSlot.getBoundingClientRect();
    searchCard.style.left = `${Math.round(r.left)}px`;
    searchCard.style.width = `${Math.round(r.width)}px`;
  }
  function checkSearchBar() {
    const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) || 56;
    const onPlan = prefs.page === 'plan' && curView() === 'list' && $('.layout').dataset.tab !== 'map' && !ctx.ui.picking;
    // 결과 목록이 열려 있거나 검색칸에 입력 중이면 바꾸지 않는다 (입력 중 화면이 튀지 않게)
    if (searchCard.contains(document.activeElement) && !searchCard.classList.contains('compact')) return;
    setSearchCompact(onPlan && searchSlot.getBoundingClientRect().bottom < head);
  }
  addEventListener('scroll', () => requestAnimationFrame(checkSearchBar), { passive: true });
  addEventListener('resize', () => requestAnimationFrame(checkSearchBar));
  searchCard.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-mini-tab]')?.dataset.miniTab;
    if (tab) $(`.mtabs [data-tab="${tab}"]`)?.click();
  });
  $('#miniMapToggle').addEventListener('click', () => $('#mapToggle').click());

  updateSearchBar = checkSearchBar;
}
