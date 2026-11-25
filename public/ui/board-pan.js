let refreshBoardNav;
export { refreshBoardNav as updateBoardNav };

/* ───────── J-19: 데스크톱 보드 가로 이동 ─────────
 * - 마우스로 보드 빈 곳(칸 바탕·칸 머리 빈 곳)을 끌면 좌우로 움직인다. 장소 카드·버튼·입력칸·링크에서 시작하면 원래 동작(끌어 옮기기·클릭).
 * - 5px 미만으로 움직이면 클릭으로 둔다. 터치·펜은 브라우저 기본 스와이프 그대로.
 * - 좌우 끝의 ‹ › 버튼과 ← → 키로 한 칸씩. 첫 칸·마지막 칸에서는 그쪽 버튼을 숨긴다.
 * - 세로 휠은 칸 안 세로 스크롤 그대로, Shift+휠은 브라우저 기본(가로 이동).
 */
export function init(ctx) {
  const { $, curView, t } = ctx;
  const days = $('#days');
  const prev = $('#boardPrev');
  const next = $('#boardNext');
  const isBoard = () => curView() === 'board' && $('.layout').dataset.view === 'board';
  const NO_PAN = '.item, .stay-row, .tl-row.flight, .trend-card, .route-plan, button, a, input, textarea, select, label, summary, details, [contenteditable], .ui-select';

  function columns() {
    return [...days.children].filter((el) => el.offsetWidth);
  }
  function step(dir) {
    const cols = columns();
    if (!cols.length) return;
    const left = days.scrollLeft;
    const base = days.getBoundingClientRect().left;
    const offsets = cols.map((c) => c.getBoundingClientRect().left - base + left - parseFloat(getComputedStyle(days).paddingLeft || '0'));
    const target = dir > 0 ? offsets.find((x) => x > left + 4) : [...offsets].reverse().find((x) => x < left - 4);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    days.scrollTo({ left: target ?? (dir > 0 ? days.scrollWidth : 0), behavior: reduce ? 'auto' : 'smooth' });
  }
  function update() {
    const on = isBoard() && days.scrollWidth > days.clientWidth + 2;
    prev.hidden = !on || days.scrollLeft <= 2;
    next.hidden = !on || days.scrollLeft + days.clientWidth >= days.scrollWidth - 2;
  }
  prev.setAttribute('aria-label', t('이전 칸'));
  next.setAttribute('aria-label', t('다음 칸'));
  prev.title = t('이전 칸');
  next.title = t('다음 칸');
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  days.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  addEventListener('resize', () => requestAnimationFrame(update));
  new ResizeObserver(() => requestAnimationFrame(update)).observe(days);
  new MutationObserver(() => requestAnimationFrame(update)).observe(days, { childList: true });

  let drag = null;
  days.addEventListener('pointerdown', (e) => {
    if (!isBoard() || e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest(NO_PAN)) return;
    drag = { x: e.clientX, left: days.scrollLeft, id: e.pointerId, moved: false };
  });
  days.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      days.setPointerCapture(e.pointerId);
      days.classList.add('panning');
    }
    e.preventDefault();
    days.scrollLeft = drag.left - dx;
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const moved = drag.moved;
    drag = null;
    days.classList.remove('panning');
    if (moved) {
      // 끌기가 끝난 자리에서 클릭이 함께 일어나지 않게 (바로 뒤따르는 클릭 하나만 막는다)
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
  };
  let suppressClick = false;
  days.addEventListener('click', (ev) => {
    if (!suppressClick) return;
    suppressClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
  days.addEventListener('pointerup', end);
  days.addEventListener('pointercancel', end);
  days.addEventListener('lostpointercapture', () => { if (drag?.moved) end(); });

  // ← → 키: 보드(칸 바탕)에 포커스가 있을 때 한 칸씩
  days.addEventListener('keydown', (e) => {
    if (!isBoard() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target !== days) return;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
  });

  refreshBoardNav = update;
  update();
}
