import { t, dayName } from '../lib/i18n.js';
import { enhanceSelect, closeFor as closeSelectFor, focusSelect } from '../lib/select.js';
import { reversePlace } from '../lib/geo.js';
import * as M from '../lib/model.js';

let boundCancelMapHold, boundPickViewport, boundRevealMap, boundSetPicking;
export let locationChoice;
export { boundCancelMapHold as cancelMapHold };
export { boundPickViewport as pickViewport };
export { boundRevealMap as revealMap };
export { boundSetPicking as setPicking };

export function init(ctx) {
  const {
    $, ui, map, mapDayContext, esc, mapDayOptions, addPlace, $$, toast, clearCandidate, showTab,
  } = ctx;

  $('#pickConfirm').addEventListener('click', () => {
    if (!ui.picking || !ctx.trip || ui.readonly) return;
    const latlng = map.wrapLatLng(map.getCenter());
    const draft = ctx.stayMapDraft;
    ctx.stayMapDraft = null;
    setPicking(false);
    if (draft) ctx.resumeStayFromMap(draft, latlng);
    else showLocationChoices(latlng);
  });

  map.on('contextmenu', (e) => {
    if (!ui.picking && !e.originalEvent.sourceCapabilities?.firesTouchEvents && e.originalEvent.pointerType !== 'touch' && !mapTouchActive) {
      showLocationChoices(map.wrapLatLng(e.latlng));
    }
  });

  const mapEl = map.getContainer();
  let mapTouchActive = false;
  let holdTimer;
  let holdOrigin;
  let holdOpened = false;
  let ignoreMapTapUntil = 0;
  const cancelMapHold = () => {
    clearTimeout(holdTimer);
    holdOrigin = null;
  };
  mapEl.addEventListener('touchstart', (e) => {
    mapTouchActive = true;
    if (e.touches.length === 1) holdOpened = false;
    cancelMapHold();
    if (ui.picking || !ctx.trip || ui.readonly || e.touches.length !== 1 || e.target.closest('.leaflet-control, .leaflet-popup, .leaflet-marker-icon')) return;
    const point = e.touches[0];
    const latlng = map.wrapLatLng(map.mouseEventToLatLng(point));
    holdOrigin = point;
    const context = mapDayContext();
    holdTimer = setTimeout(() => {
      if (context !== mapDayContext() || ui.picking) return;
      holdOpened = true;
      showLocationChoices(latlng);
    }, 500);
  }, { passive: true });
  mapEl.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (!holdOrigin || e.touches.length !== 1 || Math.hypot(p.clientX - holdOrigin.clientX, p.clientY - holdOrigin.clientY) > 10) cancelMapHold();
  }, { passive: true });
  for (const event of ['touchend', 'touchcancel']) {
    mapEl.addEventListener(event, (e) => {
      mapTouchActive = e.touches.length > 0;
      if (!mapTouchActive && holdOpened) ignoreMapTapUntil = performance.now() + 400;
      cancelMapHold();
    }, { passive: true });
  }
  mapEl.addEventListener('click', (e) => {
    if (performance.now() >= ignoreMapTapUntil || e.target.closest('.leaflet-popup, .leaflet-control')) return;
    ignoreMapTapUntil = 0;
    e.stopImmediatePropagation();
  }, true);
  map.on('dragstart zoomstart', cancelMapHold);

  async function showLocationChoices(latlng) {
    if (!ctx.trip || ui.readonly) return;
    const { lat, lng } = latlng;
    const context = mapDayContext();
    let place = { name: t('선택한 위치'), address: '', lat, lng };
    const all = !ctx.trip.days.some((d) => d.id === ui.focusList);
    let dayId = all ? '' : ui.focusList;
    const content = document.createElement('div');
    content.className = 'ctx';
    content.innerHTML = `<div class="popup-name">${esc(place.name)}</div>
    <div class="popup-meta">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    ${all ? `<select data-ui-select aria-label="${esc(t('추가할 날짜 선택'))}">
      <option value="">${esc(t('추가할 날짜 선택'))}</option>
      ${mapDayOptions()}
    </select>` : ''}
    <button class="ctx-btn" data-ctx-add="item"></button>
    <button class="ctx-btn stay" data-ctx-add="stay"></button>`;
    const select = content.querySelector('select');
    const item = content.querySelector('[data-ctx-add="item"]');
    const stay = content.querySelector('[data-ctx-add="stay"]');
    const dayIndex = () => ctx.trip.days.findIndex((day) => day.id === dayId);
    function updateActions() {
      const start = dayIndex();
      item.disabled = start < 0;
      stay.disabled = start < 0;
      const day = start < 0 ? '—' : dayName(start);
      item.textContent = t('+ 이 위치 추가 ({day})', { day });
      stay.textContent = t('숙소로 추가 ({day}부터 1박)', { day });
    }
    if (select) {
      select.addEventListener('change', () => {
        dayId = select.value;
        updateActions();
        popup.update();
      });
    }
    updateActions();
    const back = document.activeElement;
    const popup = L.popup({ maxWidth: Math.max(180, Math.min(280, mapEl.clientWidth - 58)) }).setLatLng(latlng).setContent(content).openOn(map);
    locationChoice = { popup, context };
    if (select) enhanceSelect(select);
    const popupEl = popup.getElement();
    const close = popupEl.querySelector('.leaflet-popup-close-button');
    close?.setAttribute('aria-label', t('닫기'));
    popupEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      map.closePopup(popup);
    });
    popup.once('remove', () => {
      if (select) closeSelectFor(select);
      if (locationChoice?.popup === popup) locationChoice = null;
      if (document.activeElement === document.body || content.contains(document.activeElement) || document.activeElement === close) {
        (back instanceof HTMLElement && back !== document.body && back.isConnected ? back : mapEl).focus({ preventScroll: true });
      }
    });
    if (select) focusSelect(select);
    else item.focus({ preventScroll: true });
    item.addEventListener('click', () => {
      if (context !== mapDayContext() || dayIndex() < 0) return;
      map.closePopup(popup);
      addPlace(place, { edit: true, listId: dayId });
    });
    stay.addEventListener('click', () => {
      const start = dayIndex();
      if (context !== mapDayContext() || start < 0) return;
      map.closePopup(popup);
      ctx.openStays({ place, start });
    });
    try {
      const r = await reversePlace(lat, lng);
      if (r && popup.isOpen()) {
        place = { ...r, lat, lng };
        content.querySelector('.popup-name').textContent = r.name;
        if (r.address) content.querySelector('.popup-meta').textContent = r.address;
        popup.update();
      }
    } catch {
      // 주소를 못 찾아도 좌표로 추가할 수 있다.
    }
  }

  /* ───────── 지도에서 찍기 ─────────
   * 시작하면 지도 화면으로 가서 "위치 고르는 중" 안내·확정·취소를 바로 보여준다. 취소하면 시작 버튼으로 돌아간다.
   */
  const pickViewport = matchMedia('(max-width: 900px)');
  function syncPickNavigation() {
    const locked = Boolean(ui.picking && pickViewport.matches);
    for (const el of $$('.mtabs, #dayTabs, .pagebar, .map-top, #mapLocate')) el.inert = locked;
  }
  pickViewport.addEventListener('change', syncPickNavigation);

  /** 지도에서 찍기의 빠른 이동: 지금 추가할 일차의 마지막 장소(없으면 숙소·여행지) */
  function pickAnchor() {
    if (!ctx.trip) return null;
    const listId = ui.target;
    const items = M.getList(ctx.trip, listId) ?? [];
    const di = ctx.trip.days.findIndex((d) => d.id === listId);
    const st = di >= 0 ? M.dayStays(ctx.trip, di) : {};
    return items.at(-1) ?? st.start ?? st.end ?? ctx.trip.center ?? null;
  }
  $('#pickLast').addEventListener('click', () => {
    const p = pickAnchor();
    if (p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
  });
  $('#pickHere').addEventListener('click', () => {
    if (!navigator.geolocation) return toast(t('이 브라우저에서는 현재 위치를 확인할 수 없어요'));
    map.locate({ setView: true, maxZoom: 16, timeout: 8000 });
  });

  /** 지도 전체(아래쪽 확정·취소 포함)가 화면 안에 들어오게 스크롤한다. 좁은 화면은 아래 탭바 높이만큼 비워 둔다. */
  function revealMap() {
    const wrap = $('.mapwrap');
    const r = wrap.getBoundingClientRect();
    const head = $('.topbar').offsetHeight + ($('#offlineBar').hidden ? 0 : $('#offlineBar').offsetHeight); // 오프라인 안내 띠도 머리 바처럼 위에 붙어 있다
    const bar = pickViewport.matches && !ui.picking ? $('.pagebar').offsetHeight : 0;
    const room = innerHeight - head - bar;
    // 지도가 화면보다 크면 위쪽을 머리 바로 아래에, 아니면 아래쪽이 보이도록
    const dy = r.height > room ? r.top - head : Math.max(0, r.bottom - (innerHeight - bar)) || Math.min(0, r.top - head);
    if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'instant' });
  }

  function setPicking(on, { cancelled = false } = {}) {
    if (ui.picking === on) return;
    ui.picking = on;
    if (on) {
      if (locationChoice) map.closePopup(locationChoice.popup);
      $('#mapPlace').hidden = true;
      clearCandidate();
    }
    map.getContainer().classList.toggle('picking', on);
    document.body.classList.toggle('picking', on);
    setTimeout(() => map.invalidateSize(), 0);
    $('#pickHint').hidden = !on;
    $('#pickPin').hidden = !on;
    $('#pickBtn').classList.toggle('active', on);
    $('#pickBtn').setAttribute('aria-pressed', String(on));
    if (on) {
      map.closePopup();
      showTab('map');
      revealMap();
      requestAnimationFrame(revealMap); // 지도 높이가 바뀐 뒤 한 번 더 맞춘다
      $('#pickConfirm').focus({ preventScroll: true });
      const last = pickAnchor();
      $('#pickLast').hidden = !last;
    }
    syncPickNavigation();
    if (!on && ctx.stayMapDraft) {
      const draft = ctx.stayMapDraft;
      ctx.stayMapDraft = null;
      if (cancelled) ctx.resumeStayFromMap(draft);
      return;
    }
    if (cancelled) {
      // 시작 버튼으로 돌아간다 (좁은 화면은 일정 화면에 있다)
      if (pickViewport.matches) showTab('plan');
      $('#pickBtn').focus({ preventScroll: true });
    }
  }

  boundCancelMapHold = cancelMapHold;
  boundPickViewport = pickViewport;
  boundRevealMap = revealMap;
  boundSetPicking = setPicking;
}

export function initPickButtons(ctx) {
  const { $ } = ctx;
  $('#pickBtn').addEventListener('click', () => boundSetPicking(!ctx.ui.picking, { cancelled: ctx.ui.picking }));
  $('#pickCancel').addEventListener('click', () => boundSetPicking(false, { cancelled: true }));
}
