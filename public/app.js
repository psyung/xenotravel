import * as M from './lib/model.js';
import { parseLocationInput } from './lib/links.js';
import { searchPlaces, reversePlace } from './lib/geo.js';
import { loadStore, saveStore } from './lib/store.js';
import { exportXlsx, downloadJson } from './lib/export.js';
import * as T from './lib/trends.js';

const COLORS = ['#ff6f61', '#4d9de0', '#2fbf9b', '#a77bf3', '#f2a116', '#ff6fae', '#22b8cf', '#7c8cf8'];
const INBOX_COLOR = '#868e96';
const TREND_COLOR = '#7048e8';
const dayColor = (i) => COLORS[i % COLORS.length];
const TODAY = new Date().toISOString().slice(0, 10);

// 화면 설정(보기 방식 등)은 이 브라우저에만 기억한다. 저장소를 못 써도 기본값으로 동작.
const PREF_KEY = 'xenotravel:prefs';
const prefs = (() => {
  try {
    return { view: 'list', trendsOpen: true, mapHidden: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { view: 'list', trendsOpen: true, mapHidden: false };
  }
})();
const savePrefs = () => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* 무시 */
  }
};
let trends = { cities: [] };

// OpenStreetMap 기본 타일: 키 없이 쓸 수 있지만 개인·소규모 사용 전제 (https://operations.osmfoundation.org/policies/tiles/)
// 사용자가 늘면 MapTiler·Stadia 같은 유료/무료 키 기반 타일로 바꿔야 한다.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPTS = {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 검색 <a href="https://photon.komoot.io">Photon</a>',
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

const store = loadStore();
let trip = store.trips[store.currentId] ?? null;
const ui = {
  openItem: null,
  focusList: null, // 지도에서 강조할 일차 id (null이면 전체)
  target: null, // 장소를 추가할 목록 id
  picking: false,
  results: [],
  activeResult: -1,
  searchAbort: null,
  sortables: [],
  warnedStorage: false,
};

/* ───────── 지도 ───────── */
const map = L.map('map', { worldCopyJump: true }).setView([30, 20], 2);
L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);
const layer = L.layerGroup().addTo(map);
const markers = new Map();

function pinIcon(label, color, dim) {
  return L.divIcon({
    className: '',
    html: `<div class="pin${dim ? ' dim' : ''}" style="--c:${color}"><span>${esc(label)}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 30],
    popupAnchor: [0, -28],
  });
}

function allLists() {
  return [
    ...trip.days.map((d, i) => ({ id: d.id, items: d.items, color: dayColor(i), label: `Day ${i + 1}`, isDay: true })),
    { id: M.INBOX, items: trip.inbox, color: INBOX_COLOR, label: '보관함', isDay: false },
  ];
}

function renderMap({ fit = false } = {}) {
  layer.clearLayers();
  markers.clear();
  if (!trip) return;
  const bounds = [];
  allLists().forEach((l, dayIndex) => {
    const dim = ui.focusList != null && ui.focusList !== l.id;
    // 동선: 출발 숙소 → 장소들 → 귀가 숙소
    const { start, end } = l.isDay ? M.dayStays(trip, dayIndex) : {};
    const route = [...(start ? [start] : []), ...l.items, ...(end ? [end] : [])];
    const pts = route.map((it) => [it.lat, it.lng]);
    if (!dim) [start, end].forEach((s) => s && bounds.push([s.lat, s.lng]));
    if (l.isDay && pts.length > 1) {
      L.polyline(pts, { color: l.color, weight: 3, opacity: dim ? 0.15 : 0.75, dashArray: '6 6' }).addTo(layer);
    }
    l.items.forEach((it, i) => {
      const m = L.marker([it.lat, it.lng], {
        icon: pinIcon(l.isDay ? i + 1 : '•', l.color, dim),
        zIndexOffset: dim ? 0 : 1000,
      }).addTo(layer);
      m.bindPopup(
        `<div class="popup-name">${esc(it.name)}</div>` +
          `<div class="popup-meta">${esc(l.label)}${l.isDay ? ` · ${i + 1}번째` : ''}${it.time ? ` · ${esc(it.time)}` : ''}</div>` +
          `<a href="${M.googleMapsUrl(it)}" target="_blank" rel="noopener">구글맵에서 열기</a>`,
      );
      m.on('click', () => openItem(it.id, { scroll: true }));
      markers.set(it.id, m);
      if (!dim) bounds.push([it.lat, it.lng]);
    });
  });
  for (const s of trip.stays) {
    const { checkIn, checkOut } = M.stayDates(trip, s);
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: '<div class="stay-pin">🏨</div>', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }),
      zIndexOffset: 1500,
    }).addTo(layer);
    m.bindPopup(
      `<div class="popup-name">🏨 ${esc(s.name)}</div>` +
        `<div class="popup-meta">${s.nights}박${checkIn ? ` · ${esc(M.formatDate(checkIn))} 체크인 ~ ${esc(M.formatDate(checkOut))} 체크아웃` : ''}</div>` +
        `<a href="${M.googleMapsUrl(s)}" target="_blank" rel="noopener">구글맵에서 열기</a>`,
    );
    markers.set(s.id, m);
  }
  renderTrendMarkers();
  $('#showAll').hidden = ui.focusList == null;
  if (fit) fitTo(bounds);
}

/* ───────── 트렌드 (요즘 뜨는 곳) ───────── */
function currentCity() {
  if (!trip || !trends.cities.length) return null;
  const chosen = trends.cities.find((c) => c.id === trip.trendCity);
  return chosen ?? T.nearestCity(trends.cities, T.tripAnchor(trip));
}

function findTrend(id) {
  for (const c of trends.cities) {
    const p = c.places.find((x) => x.id === id);
    if (p) return { place: p, city: c };
  }
  return null;
}

function renderTrendMarkers() {
  const city = currentCity();
  if (!city || (prefs.view === 'list' && !prefs.trendsOpen)) return;
  for (const p of T.activePlaces(city, TODAY)) {
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: '<div class="trend-pin">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: -100,
    })
      .bindPopup(
        `<div class="popup-name">${esc(p.name)}</div>` +
          `<div class="popup-meta">요즘 뜨는 곳 · ${esc(T.statusLabel(p, TODAY))}</div>` +
          `<p class="popup-sum">${esc(p.summary)}</p>` +
          `<button class="popup-add" data-add-trend="${esc(p.id)}">+ 일정에 담기</button>`,
      )
      .addTo(layer);
  }
}

function trendSectionHtml() {
  const city = currentCity();
  const board = prefs.view === 'board';
  const open = board || prefs.trendsOpen;
  const places = T.activePlaces(city, TODAY);
  const options = [
    city ? '' : '<option value="">도시 선택</option>',
    ...trends.cities.map((c) => `<option value="${c.id}"${c.id === city?.id ? ' selected' : ''}>${esc(c.name)}</option>`),
  ].join('');
  const cards = places
    .map(
      (p) => `<li class="trend-card" data-trend="${esc(p.id)}">
        <div class="tc-top"><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span><span class="tc-cat">${esc(p.category)}</span></div>
        <div class="tc-name">${esc(p.name)}</div>
        <div class="tc-area">${esc(p.area)}${p.approx ? ' · 대략 위치' : ''}</div>
        <p class="tc-sum">${esc(p.summary)}</p>
        <div class="tc-foot">
          <span class="tc-src">출처 ${p.sources.map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${i + 1}</a>`).join(' ')}</span>
          <button class="tc-add" data-action="add-trend">+ 담기</button>
        </div>
      </li>`,
    )
    .join('');
  const body = city
    ? `<p class="trend-note">${esc(trends.researchedAt)} 조사 · 카드를 끌어서 원하는 날에 놓으세요</p><ul class="trend-list">${cards}</ul>`
    : `<p class="empty-list">이 여행지는 아직 트렌드 정보가 없어요. 지금은 ${trends.cities.map((c) => c.name).join('·')}만 있어요.</p>`;
  return `<section class="day trend-col" style="--c:${TREND_COLOR}">
    <header class="day-head">
      <button class="day-title" data-action="trend-toggle"${board ? ' disabled' : ''}>
        <span class="dot"></span><strong>요즘 뜨는 곳</strong><span class="count">${city ? `${places.length}곳` : ''}${board ? '' : open ? ' ▾' : ' ▸'}</span>
      </button>
      <select class="trend-city" aria-label="트렌드 도시">${options}</select>
    </header>
    ${open ? body : ''}
  </section>`;
}

function addTrend(id, listId, index) {
  const found = findTrend(id);
  if (!found) return;
  if (listId == null) return addPlace(T.trendToPlace(found.place, found.city.name));
  const item = M.addItem(trip, listId, T.trendToPlace(found.place, found.city.name));
  M.moveItem(trip, item.id, listId, index);
  commit();
  toast(`"${item.name}"을(를) 담았어요`);
}

map.getContainer().addEventListener('click', (e) => {
  const id = e.target.closest('[data-add-trend]')?.dataset.addTrend;
  if (id) {
    map.closePopup();
    addTrend(id);
  }
});

function fitTo(bounds) {
  if (bounds.length === 1) map.setView(bounds[0], 15);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  else if (trip?.center) map.setView([trip.center.lat, trip.center.lng], 12);
}

map.on('click', async (e) => {
  if (!ui.picking) return;
  setPicking(false);
  const { lat, lng } = e.latlng;
  let place = { name: '선택한 위치', address: '', lat, lng };
  try {
    const r = await reversePlace(lat, lng);
    if (r) place = { ...r, lat, lng };
  } catch {
    /* 주소를 못 찾아도 좌표로 추가 */
  }
  addPlace(place, { edit: true });
});

// 우클릭(모바일은 길게 누르기) → 그 자리에 "이 위치 추가" 창
map.on('contextmenu', async (e) => {
  if (!trip) return;
  const { lat, lng } = e.latlng;
  ui.ctxPlace = { name: '선택한 위치', address: '', lat, lng };
  const html = (name, address) =>
    `<div class="ctx">
      <div class="popup-name">📍 ${esc(name)}</div>
      <div class="popup-meta">${esc(address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}</div>
      <button class="ctx-btn" data-ctx-add="item">+ 이 위치 추가 <small>(${esc(targetLabel())})</small></button>
      <button class="ctx-btn stay" data-ctx-add="stay">🏨 숙소로 추가 <small>(${esc(stayOptsLabel())})</small></button>
    </div>`;
  const popup = L.popup({ minWidth: 220 }).setLatLng(e.latlng).setContent(html('위치 확인 중…', '')).openOn(map);
  try {
    const r = await reversePlace(lat, lng);
    if (r && ui.ctxPlace?.lat === lat) {
      ui.ctxPlace = { ...r, lat, lng };
      if (popup.isOpen()) popup.setContent(html(r.name, r.address));
    }
  } catch {
    if (popup.isOpen()) popup.setContent(html('선택한 위치', ''));
  }
});

map.getContainer().addEventListener('click', (e) => {
  const kind = e.target.closest('[data-ctx-add]')?.dataset.ctxAdd;
  if (!kind || !ui.ctxPlace) return;
  map.closePopup();
  if (kind === 'stay') addStayFromOpts(ui.ctxPlace);
  else addPlace(ui.ctxPlace, { edit: true, listId: ui.target === STAY_TARGET ? lastListId() : null });
  ui.ctxPlace = null;
});

function setPicking(on) {
  ui.picking = on;
  map.getContainer().classList.toggle('picking', on);
  $('#pickHint').hidden = !on;
  $('#pickBtn').classList.toggle('active', on);
  if (on) showTab('map');
}

/* ───────── 저장 ───────── */
const persist = debounce(() => {
  if (!saveStore(store) && !ui.warnedStorage) {
    ui.warnedStorage = true;
    toast('브라우저에 저장할 수 없어요. 새로고침하면 사라지니 백업 파일로 저장해 주세요.', 5000);
  }
}, 250);

function commit({ fit = false } = {}) {
  M.touch(trip);
  store.trips[trip.id] = trip;
  persist();
  render({ fit });
}

/* ───────── 렌더링 ───────── */
function render({ fit = false } = {}) {
  if (!trip) {
    document.title = 'XenoTravel';
    $('#days').innerHTML = '<p class="empty-list" style="margin:24px">여행을 먼저 만들어 주세요.</p>';
    layer.clearLayers();
    openTrips(true);
    return;
  }
  trip.stays ??= []; // 숙소 기능 이전에 만든 여행
  document.title = `${trip.title} · XenoTravel`;
  const title = $('#tripTitle');
  if (document.activeElement !== title) title.value = trip.title;
  $('#startDate').value = trip.startDate;
  $('#endDate').value = trip.endDate;
  renderTarget();
  renderDays();
  renderMap({ fit });
}

const STAY_TARGET = '__stay';

function renderTarget() {
  const lists = allLists();
  if (ui.target !== STAY_TARGET && !lists.some((l) => l.id === ui.target)) ui.target = trip.days[0]?.id ?? M.INBOX;
  $('#target').innerHTML =
    lists
      .map((l, i) => {
        const label = l.isDay ? M.dayTitle(trip.days[i], i) : '장소 보관함 (날짜 미정)';
        return `<option value="${l.id}"${l.id === ui.target ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('') + `<option value="${STAY_TARGET}"${ui.target === STAY_TARGET ? ' selected' : ''}>🏨 숙소로 추가</option>`;
  renderStayOpts();
}

/** 숙소 추가 옵션: 체크인 일차 + 박 수 (기본 2박) */
function renderStayOpts() {
  const box = $('#stayOpts');
  box.hidden = ui.target !== STAY_TARGET;
  if (box.hidden) return;
  const n = trip.days.length;
  ui.stayStart = Math.min(ui.stayStart ?? firstUncoveredNight(), n - 1);
  const maxNights = Math.max(1, n - ui.stayStart);
  ui.stayNights = Math.min(ui.stayNights ?? M.DEFAULT_NIGHTS, maxNights);
  setStayCalendar($('#stayIn'), $('#stayOut'), ui.stayStart, ui.stayNights);
  $('#stayNightsLabel').textContent = `${ui.stayNights}박`;
}

/** 체크인·체크아웃 달력 값과 고를 수 있는 범위(여행 기간)를 맞춘다. */
function setStayCalendar(inEl, outEl, startIndex, nights) {
  const n = trip.days.length;
  inEl.min = M.dateAtIndex(trip, 0);
  inEl.max = M.dateAtIndex(trip, n - 1);
  inEl.value = M.dateAtIndex(trip, startIndex);
  outEl.min = M.dateAtIndex(trip, startIndex + 1);
  outEl.max = M.dateAtIndex(trip, n);
  outEl.value = M.dateAtIndex(trip, startIndex + nights);
}

function firstUncoveredNight() {
  const i = trip.days.findIndex((_, d) => !M.nightStay(trip, d));
  return i === -1 ? 0 : i;
}

/** 숙소 모드일 때 일반 장소를 넣을 목록: 마지막으로 고른 일차 */
function lastListId() {
  return M.getList(trip, ui.lastList) ? ui.lastList : trip.days[0].id;
}

function targetLabel() {
  const id = ui.target === STAY_TARGET ? lastListId() : ui.target;
  const i = trip.days.findIndex((d) => d.id === id);
  return i === -1 ? '보관함' : `Day ${i + 1}`;
}

function stayOptsLabel() {
  const start = ui.target === STAY_TARGET ? ui.stayStart ?? firstUncoveredNight() : firstUncoveredNight();
  const nights = ui.target === STAY_TARGET ? ui.stayNights ?? M.DEFAULT_NIGHTS : M.DEFAULT_NIGHTS;
  return `Day ${start + 1}부터 ${nights}박`;
}

function addStayFromOpts(place) {
  const useOpts = ui.target === STAY_TARGET;
  const start = useOpts ? ui.stayStart ?? firstUncoveredNight() : firstUncoveredNight();
  const nights = useOpts ? ui.stayNights ?? M.DEFAULT_NIGHTS : M.DEFAULT_NIGHTS;
  const stay = M.addStay(trip, place, start, nights);
  const { checkIn, checkOut } = M.stayDates(trip, stay);
  ui.stayStart = Math.min(stay.startIndex + stay.nights, trip.days.length - 1); // 다음 숙소는 이어지는 날부터
  ui.stayNights = null;
  searchEl.value = '';
  hideResults();
  commit();
  map.setView([stay.lat, stay.lng], Math.max(map.getZoom(), 14));
  toast(
    `🏨 "${stay.name}" ${stay.nights}박${checkIn ? ` (${M.formatDate(checkIn)} ~ ${M.formatDate(checkOut)})` : ''}을 추가했어요`,
    3000,
  );
}

function stayRowHtml(stay, dayIndex, pos, flags) {
  const key = `${stay.id}|${dayIndex}|${pos}`;
  const open = ui.openStay === key;
  const tag = pos === 'start' && flags.checkOut ? '체크아웃' : pos === 'end' && flags.checkIn ? '체크인' : '';
  const n = trip.days.length;
  const editor = open
    ? `<div class="editor stay-editor" data-stay="${stay.id}">
        <label>숙소 이름<input data-sfield="name" value="${esc(stay.name)}"></label>
        <div class="stay-range">
          <label>체크인<input type="date" data-srange="in" value="${M.dateAtIndex(trip, stay.startIndex)}"
            min="${M.dateAtIndex(trip, 0)}" max="${M.dateAtIndex(trip, n - 1)}"></label>
          <label>체크아웃<input type="date" data-srange="out" value="${M.dateAtIndex(trip, stay.startIndex + stay.nights)}"
            min="${M.dateAtIndex(trip, stay.startIndex + 1)}" max="${M.dateAtIndex(trip, n)}"></label>
          <span class="nights-chip">${stay.nights}박</span>
        </div>
        <label>메모<textarea data-sfield="memo" placeholder="예약번호, 체크인 시간…">${esc(stay.memo)}</textarea></label>
        <label>링크<input type="url" data-sfield="url" value="${esc(stay.url)}" placeholder="예약 페이지"></label>
        ${stay.address ? `<p class="addr">${esc(stay.address)}</p>` : ''}
        <div class="editor-actions">
          <a href="${M.googleMapsUrl(stay)}" target="_blank" rel="noopener">구글맵에서 열기 ↗</a>
          <button data-action="stay-delete" data-stay="${stay.id}" class="danger">숙소 삭제</button>
        </div>
      </div>`
    : '';
  return `<div class="stay-row ${pos}${open ? ' open' : ''}" data-stay="${stay.id}" data-key="${key}">
      <button class="stay-main" data-action="stay-toggle">
        <span class="stay-ic">🏨</span><span class="stay-pos">${pos === 'start' ? '출발' : '귀가'}</span>
        <span class="stay-name">${esc(stay.name)}</span>${tag ? `<span class="stay-tag">${tag}</span>` : ''}
      </button>
      <button class="icon" data-action="stay-locate" title="지도에서 보기">◎</button>
    </div>${editor}`;
}

function itemHtml(it, i, isDay) {
  const open = ui.openItem === it.id;
  const sub = it.time ? `<b>${esc(it.time)}</b> ${esc(it.memo.split('\n')[0] || it.address)}` : esc(it.memo.split('\n')[0] || it.address);
  return `<li class="item${open ? ' open' : ''}" data-id="${it.id}">
    <div class="item-row">
      <span class="drag" title="끌어서 순서·날짜 바꾸기">⋮⋮</span>
      <span class="num">${isDay ? i + 1 : '•'}</span>
      <button class="item-main" data-action="toggle">
        <span class="item-name">${esc(it.name)}</span>
        <span class="item-sub">${sub}</span>
      </button>
      <button class="icon" data-action="duplicate" title="복제">⧉</button>
      <button class="icon" data-action="locate" title="지도에서 보기">◎</button>
    </div>
    ${
      open
        ? `<div class="editor">
      <label>이름<input data-field="name" value="${esc(it.name)}"></label>
      <label>시간<input type="time" data-field="time" value="${esc(it.time)}"></label>
      <label>메모<textarea data-field="memo" placeholder="영업시간, 예약번호, 꼭 먹을 것…">${esc(it.memo)}</textarea></label>
      <label>링크<input type="url" data-field="url" value="${esc(it.url)}" placeholder="예약 페이지, 블로그 등"></label>
      <label>다른 날로 옮기기<select class="move-to">${moveOptions(listIdOf(it.id), '옮길 날 고르기')}</select></label>
      ${it.address ? `<p class="addr">${esc(it.address)}</p>` : ''}
      <div class="editor-actions">
        <a href="${M.googleMapsUrl(it)}" target="_blank" rel="noopener">구글맵에서 열기 ↗</a>
        <span><button data-action="duplicate">복제</button> <button data-action="delete" class="danger">삭제</button></span>
      </div>
    </div>`
        : ''
    }
  </li>`;
}

/* ───────── 항공편 ───────── */
/** 그날 항공편. top = 출국·이동(하루 시작), bottom = 귀국(하루 끝) */
function dayFlights(dayIndex, where) {
  const date = trip.days[dayIndex]?.date;
  if (!date) return [];
  return M.flightsOnDate(trip, date).filter(({ flight }) => (flight.kind === 'in') === (where === 'bottom'));
}

function flightRowsHtml(dayIndex, where) {
  return dayFlights(dayIndex, where)
    .map(({ flight: f, role }) => {
      const note = role === 'depart' ? '출발' : role === 'arrive' ? '도착' : '';
      return `<div class="flight-row">
        <button class="flight-main" data-action="flight-edit" data-flight="${f.id}" title="항공편 수정">
          <span class="fl-ic" aria-hidden="true">✈</span>
          <span class="fl-kind">${esc(M.FLIGHT_KINDS[f.kind])}${note ? ` · ${note}` : ''}</span>
          <span class="fl-text">${esc(M.flightSummary(f))}</span>
          ${f.bookingRef ? `<span class="fl-ref">${esc(f.bookingRef)}</span>` : ''}
        </button>
      </div>`;
    })
    .join('');
}

const flightDialog = $('#flightDialog');
const flightForm = $('#flightForm');
ui.editFlight = null;

function openFlights(editId = null) {
  if (!trip) return;
  trip.flights ??= [];
  renderFlightList();
  fillFlightForm(editId ? trip.flights.find((x) => x.id === editId) : null);
  if (!flightDialog.open) flightDialog.showModal();
}

function renderFlightList() {
  const list = $('#flightList');
  list.hidden = !trip.flights.length;
  list.innerHTML = trip.flights
    .map(
      (f) => `<li class="${ui.editFlight === f.id ? 'current' : ''}">
        <button class="t-open" data-fedit="${f.id}">
          <strong><span class="fl-kind">${esc(M.FLIGHT_KINDS[f.kind])}</span> ${esc(M.flightSummary(f))}</strong>
          <span class="t-meta">${esc(M.formatDate(f.departAt.slice(0, 10)))}${f.bookingRef ? ` · 예약번호 ${esc(f.bookingRef)}` : ''}</span>
        </button>
        <button class="icon danger" data-fdel="${f.id}" title="삭제">✕</button>
      </li>`,
    )
    .join('');
}

/** 수정이면 그 값을, 새로 넣기면 상황에 맞는 기본값(첫 항공편은 출국, 다음은 귀국)을 채운다. */
function fillFlightForm(flight) {
  ui.editFlight = flight?.id ?? null;
  flightForm.reset();
  $('#flightError').hidden = true;
  const hasOut = trip.flights.some((x) => x.kind === 'out');
  const defaults = flight ?? {
    kind: hasOut ? 'in' : 'out',
    departAt: hasOut ? `${trip.endDate}T18:00` : `${trip.startDate}T09:00`,
    from: hasOut ? trip.flights.find((x) => x.kind === 'out')?.to ?? '' : '',
    to: hasOut ? trip.flights.find((x) => x.kind === 'out')?.from ?? '' : '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const el = flightForm.elements[k];
    if (!el || v == null) continue;
    if (el instanceof RadioNodeList) el.value = v;
    else el.value = v;
  }
  $('#flightFormTitle').textContent = flight ? '항공편 수정' : '항공편 추가';
  $('#flightSubmit').textContent = flight ? '저장' : '추가';
  $('#flightNew').hidden = !flight;
  renderFlightList();
}

flightForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(flightForm));
  const problem = M.flightProblem(data);
  const err = $('#flightError');
  if (problem) {
    err.textContent = problem;
    err.hidden = false;
    return;
  }
  const saved = ui.editFlight ? M.updateFlight(trip, ui.editFlight, data) : M.addFlight(trip, data);
  commit();
  const date = saved.departAt.slice(0, 10);
  const outside = trip.startDate && (date < trip.startDate || date > trip.endDate);
  toast(outside ? '저장했어요. 출발일이 여행 기간 밖이라 일정에는 보이지 않아요' : `✈ ${M.flightSummary(saved)} 저장했어요`, outside ? 4000 : 2200);
  fillFlightForm(null);
});
$('#flightList').addEventListener('click', (e) => {
  const editId = e.target.closest('[data-fedit]')?.dataset.fedit;
  const delId = e.target.closest('[data-fdel]')?.dataset.fdel;
  if (editId) fillFlightForm(trip.flights.find((x) => x.id === editId));
  if (delId && confirm('이 항공편을 삭제할까요?')) {
    M.removeFlight(trip, delId);
    commit();
    fillFlightForm(null);
  }
});
$('#flightNew').addEventListener('click', () => fillFlightForm(null));
$('#flightClose').addEventListener('click', () => flightDialog.close());
$('#flightsBtn').addEventListener('click', () => openFlights());

function listIdOf(itemId) {
  return M.findItem(trip, itemId)?.listId ?? null;
}

/** "보낼 날" 선택지. 지금 있는 목록은 뺀다. */
function moveOptions(currentListId, placeholder) {
  const days = trip.days
    .map((d, i) => (d.id === currentListId ? '' : `<option value="${d.id}">${esc(M.dayTitle(d, i))}</option>`))
    .join('');
  const inbox = currentListId === M.INBOX ? '' : `<option value="${M.INBOX}">장소 보관함</option>`;
  return `<option value="">${esc(placeholder)}</option>${days}${inbox}`;
}

function moveToList(itemId, listId) {
  const found = M.findItem(trip, itemId);
  if (!found || !listId || !M.moveItem(trip, itemId, listId, Infinity)) return;
  ui.openItem = null;
  commit();
  const i = trip.days.findIndex((d) => d.id === listId);
  toast(`"${found.item.name}" → ${i === -1 ? '장소 보관함' : `Day ${i + 1}`}(으)로 옮겼어요`);
}

/**
 * 보관함 카드 너비: 주소가 짧으면 주소가 다 보이게, 길면 장소 이름보다 살짝(80px)만 길게 하고 나머지는 … 처리.
 */
const DOCK_EXTRA = 80;
function sizeDockCards() {
  for (const card of $$('#inboxDock .dock-card')) {
    const text = $('.dock-text', card);
    const name = $('.item-name', card);
    const sub = $('.item-sub', card);
    card.style.width = '';
    const chrome = card.offsetWidth - text.clientWidth; // 손잡이·아이콘·여백
    const want = Math.max(name.scrollWidth, Math.min(sub.scrollWidth, name.scrollWidth + DOCK_EXTRA));
    card.style.width = `${Math.min(320, Math.max(180, want + chrome + 2))}px`;
  }
}

function renderDock() {
  const dock = $('#inboxDock');
  const items = trip.inbox;
  const open = prefs.dockOpen !== false;
  const cards = items
    .map(
      (it) => `<li class="item dock-card" data-id="${it.id}" style="--c:${INBOX_COLOR}">
        <div class="dock-top">
          <span class="drag" title="끌어서 원하는 날에 놓기">⋮⋮</span>
          <div class="dock-text">
            <span class="item-name">${esc(it.name)}</span>
            <span class="item-sub">${esc(it.memo.split('\n')[0] || it.address)}</span>
          </div>
          <button class="icon" data-action="locate" title="지도에서 보기">◎</button>
          <button class="icon" data-action="delete" title="삭제">✕</button>
        </div>
        <select class="move-to" aria-label="보낼 날">${moveOptions(M.INBOX, '보낼 날 →')}</select>
      </li>`,
    )
    .join('');
  dock.innerHTML = `<div class="dock-head">
      <button class="dock-toggle" data-action="dock-toggle" aria-expanded="${open}">
        <span class="dot" style="--c:${INBOX_COLOR}"></span><strong>장소 보관함</strong>
        <span class="count">${items.length}곳</span><span class="chev">${open ? '접기 ▾' : '펼치기 ▴'}</span>
      </button>
      ${open ? '<span class="dock-hint">끌어서 원하는 날에 놓거나, 보낼 날을 고르세요</span>' : ''}
    </div>
    ${
      open
        ? `<ol class="items dock-items" data-list="${M.INBOX}" data-empty="가고 싶은 곳을 일단 모아두는 곳이에요. 일정에서 여기로 끌어오거나, 추가할 곳을 장소 보관함으로 고르세요">${cards}</ol>`
        : ''
    }`;
  sizeDockCards();
}

function renderDays() {
  ui.sortables.forEach((s) => s.destroy());
  ui.sortables = [];
  const daysEl = $('#days');
  // 장소 보관함은 일정 목록이 아니라 화면 아래 고정 영역(#inboxDock)에 그린다. 여행이 길어도 항상 보이게.
  const lists = allLists()
    .filter((l) => l.isDay)
    .map((l, i) => ({ ...l, dayIndex: i, title: M.dayTitle(trip.days[i], i) }));
  renderDock();
  daysEl.innerHTML =
    trendSectionHtml() +
    lists
    .map((l) => {
      const title = l.title;
      const n = l.items.length;
      const st = l.isDay ? M.dayStays(trip, l.dayIndex) : {};
      return `<section class="day${ui.focusList === l.id ? ' is-focus' : ''}" style="--c:${l.color}">
        <header class="day-head">
          <button class="day-title" data-action="focus" data-list="${l.id}" title="지도에서 이 날만 보기">
            <span class="dot"></span><strong>${esc(title)}</strong><span class="count">${n}곳</span>
          </button>
          <div class="day-tools">${
            l.isDay
              ? `${st.end ? '' : `<button data-action="stay-here" data-day="${l.dayIndex}" title="이 날부터 묵을 숙소 추가">🏨+</button>`}${
                  n > 1 ? `<button data-action="sort-time" data-list="${l.id}">시간순</button>` : ''
                }`
              : ''
          }</div>
        </header>
        ${flightRowsHtml(l.dayIndex, 'top')}
        ${st.start ? stayRowHtml(st.start, l.dayIndex, 'start', st) : ''}
        <ol class="items" data-list="${l.id}">${l.items.map((it, j) => itemHtml(it, j, l.isDay)).join('')}</ol>
        ${n === 0 ? `<p class="empty-list">${l.isDay ? '장소를 검색하거나 여기로 끌어오세요' : '가고 싶은 곳을 일단 모아두는 곳이에요'}</p>` : ''}
        ${st.end ? stayRowHtml(st.end, l.dayIndex, 'end', st) : ''}
        ${flightRowsHtml(l.dayIndex, 'bottom')}
      </section>`;
    })
    .join('');

  for (const ol of [...$$('ol.items', daysEl), ...$$('ol.items', $('#inboxDock'))]) {
    ui.sortables.push(
      new Sortable(ol, {
        group: 'plan',
        handle: '.drag',
        animation: 150,
        ghostClass: 'ghost-item',
        emptyInsertThreshold: 24,
        onEnd: (e) => {
          if (M.moveItem(trip, e.item.dataset.id, e.to.dataset.list, e.newIndex)) commit();
        },
      }),
    );
  }

  // 트렌드 카드: 복사해서 끌어가기만 가능 (트렌드 목록 자체는 바뀌지 않음)
  const trendList = $('.trend-list', daysEl);
  if (trendList) {
    ui.sortables.push(
      new Sortable(trendList, {
        group: { name: 'plan', pull: 'clone', put: false },
        sort: false,
        animation: 150,
        filter: 'a, button',
        preventOnFilter: false,
        onEnd: (e) => {
          if (e.to === e.from) return;
          const listId = e.to.dataset.list;
          e.item.remove(); // 끌려간 카드 DOM은 버리고 일정 항목으로 새로 그린다
          addTrend(e.item.dataset.trend, listId, e.newIndex);
        },
      }),
    );
  }
}

function openItem(id, { scroll = false } = {}) {
  ui.openItem = id;
  ui.openStay = null;
  renderDays();
  if (scroll) {
    showTab('plan');
    const el = $(`.item[data-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('flash');
  }
}

/* ───────── 일정 목록 이벤트 ───────── */
$('#days').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  const action = btn.dataset.action;
  if (action === 'toggle') {
    ui.openItem = ui.openItem === id ? null : id;
    ui.openStay = null;
    renderDays();
  } else if (action === 'locate') {
    const found = M.findItem(trip, id);
    if (!found) return;
    showTab('map');
    map.setView([found.item.lat, found.item.lng], Math.max(map.getZoom(), 16));
    markers.get(id)?.openPopup();
  } else if (action === 'delete') {
    const found = M.findItem(trip, id);
    if (found && confirm(`"${found.item.name}"을(를) 삭제할까요?`)) {
      M.removeItem(trip, id);
      ui.openItem = null;
      commit();
    }
  } else if (action === 'focus') {
    const listId = btn.dataset.list;
    ui.focusList = ui.focusList === listId ? null : listId;
    ui.target = listId;
    ui.lastList = listId;
    renderTarget();
    renderDays();
    renderMap({ fit: true });
  } else if (action === 'trend-toggle') {
    prefs.trendsOpen = !prefs.trendsOpen;
    savePrefs();
    renderDays();
    renderMap();
  } else if (action === 'add-trend') {
    addTrend(btn.closest('.trend-card')?.dataset.trend);
  } else if (action === 'sort-time') {
    M.sortByTime(M.getList(trip, btn.dataset.list));
    commit();
  } else if (action === 'duplicate') {
    const copy = M.duplicateItem(trip, id);
    if (!copy) return;
    ui.openItem = null;
    commit();
    $(`.item[data-id="${CSS.escape(copy.id)}"]`)?.classList.add('flash');
    toast(`"${copy.name}"을(를) 복제했어요. 끌어서 다른 날로 옮길 수 있어요`);
  } else if (action === 'flight-edit') {
    openFlights(btn.dataset.flight);
  } else if (action === 'stay-toggle') {
    const key = btn.closest('.stay-row').dataset.key;
    ui.openStay = ui.openStay === key ? null : key;
    ui.openItem = null;
    renderDays();
  } else if (action === 'stay-locate') {
    const s = M.findStay(trip, btn.closest('.stay-row').dataset.stay);
    if (!s) return;
    showTab('map');
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16));
    markers.get(s.id)?.openPopup();
  } else if (action === 'stay-delete') {
    const s = M.findStay(trip, btn.dataset.stay);
    if (s && confirm(`숙소 "${s.name}"(${s.nights}박)을 삭제할까요?`)) {
      M.removeStay(trip, s.id);
      ui.openStay = null;
      commit();
    }
  } else if (action === 'stay-here') {
    ui.target = STAY_TARGET;
    ui.stayStart = Number(btn.dataset.day);
    ui.stayNights = null;
    renderTarget();
    searchEl.focus();
    toast('숙소 이름을 검색하거나, 지도에서 우클릭해서 추가하세요');
  }
});

// 숙소 편집: 이름·메모·링크는 입력하는 대로, 체크인·박 수는 바꾸면 바로 날짜별 배치를 다시 그린다.
$('#days').addEventListener('input', (e) => {
  const field = e.target.dataset.sfield;
  const stay = field && M.findStay(trip, e.target.closest('.stay-editor')?.dataset.stay);
  if (!stay) return;
  stay[field] = field === 'name' ? e.target.value || '이름 없는 숙소' : e.target.value;
  M.touch(trip);
  persist();
  if (field === 'name') $$(`.stay-row[data-stay="${CSS.escape(stay.id)}"] .stay-name`).forEach((el) => (el.textContent = stay.name));
  refreshMapSoon();
});
$('#days').addEventListener('change', (e) => {
  const field = e.target.dataset.srange;
  const editorEl = field && e.target.closest('.stay-editor');
  const stay = editorEl && M.findStay(trip, editorEl.dataset.stay);
  if (!stay || !e.target.value) return;
  // 체크인을 옮기면 박 수는 유지(기간 통째로 이동), 체크아웃을 바꾸면 박 수가 바뀐다.
  const checkIn = $('[data-srange="in"]', editorEl).value;
  const checkOut =
    field === 'in' ? M.dateAtIndex(trip, M.indexOfDate(trip, checkIn) + stay.nights) : $('[data-srange="out"]', editorEl).value;
  const range = M.rangeFromDates(trip, checkIn, checkOut);
  if (!range) return;
  M.updateStayRange(trip, stay.id, range);
  commit();
});

const refreshMapSoon = debounce(() => renderMap(), 300);
$('#days').addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  const id = e.target.closest('.item')?.dataset.id;
  const found = id && M.findItem(trip, id);
  if (!field || !found) return;
  found.item[field] = field === 'name' ? e.target.value || '이름 없는 장소' : e.target.value;
  M.touch(trip);
  persist();
  const li = e.target.closest('.item');
  const it = found.item;
  $('.item-name', li).textContent = it.name;
  $('.item-sub', li).innerHTML = it.time
    ? `<b>${esc(it.time)}</b> ${esc(it.memo.split('\n')[0] || it.address)}`
    : esc(it.memo.split('\n')[0] || it.address);
  refreshMapSoon();
});

$('#days').addEventListener('change', (e) => {
  if (!e.target.matches('.trend-city')) return;
  trip.trendCity = e.target.value || null;
  commit();
  const city = currentCity();
  if (city && !T.tripAnchor(trip)) map.setView([city.center.lat, city.center.lng], 12);
});

$('#showAll').addEventListener('click', () => {
  ui.focusList = null;
  renderDays();
  renderMap({ fit: true });
});

/* ───────── 보기 방식 (기본형 / 보드형) ───────── */
function applyView() {
  const layout = $('.layout');
  layout.dataset.view = prefs.view;
  layout.classList.toggle('map-hidden', prefs.view === 'board' && prefs.mapHidden);
  document.body.dataset.view = prefs.view;
  $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === prefs.view));
  $('#mapToggle').textContent = prefs.mapHidden ? '지도 보기' : '지도 숨기기';
  setTimeout(() => map.invalidateSize(), 0);
}
$$('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    if (prefs.view === b.dataset.view) return;
    prefs.view = b.dataset.view;
    savePrefs();
    applyView();
    if (trip) {
      renderDays();
      renderMap();
    }
  }),
);
$('#mapToggle').addEventListener('click', () => {
  prefs.mapHidden = !prefs.mapHidden;
  savePrefs();
  applyView();
});

/* ───────── 장소 검색 / 추가 ───────── */
const searchEl = $('#search');
const resultsEl = $('#results');

function showMessage(text) {
  ui.results = [];
  resultsEl.innerHTML = `<li class="msg">${esc(text)}</li>`;
  resultsEl.hidden = false;
}

function showResults(places) {
  ui.results = places;
  ui.activeResult = places.length ? 0 : -1;
  if (!places.length) return showMessage('검색 결과가 없어요. 영어나 현지어로도 검색해 보세요.');
  resultsEl.innerHTML = places
    .map(
      (p, i) =>
        `<li data-i="${i}"${i === 0 ? ' class="active"' : ''}><div class="r-name">${esc(p.name)}</div><div class="r-addr">${esc(p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}</div></li>`,
    )
    .join('');
  resultsEl.hidden = false;
}

function hideResults() {
  resultsEl.hidden = true;
  ui.results = [];
}

async function runSearch() {
  const q = searchEl.value.trim();
  ui.searchAbort?.abort();
  if (q.length < 2) return hideResults();

  const parsed = parseLocationInput(q);
  if (parsed?.error === 'short-link') {
    return showMessage('짧은 링크(maps.app.goo.gl)는 브라우저에서 열 수 없어요. 링크를 한 번 연 뒤 주소창의 긴 주소를 복사해 붙여넣어 주세요.');
  }
  if (parsed?.error) {
    return showMessage('이 링크에서 위치를 찾지 못했어요. 구글맵·애플맵·OpenStreetMap 링크나 "위도, 경도"를 붙여넣어 주세요.');
  }

  const ctrl = new AbortController();
  ui.searchAbort = ctrl;
  try {
    if (parsed && 'lat' in parsed) {
      let place = { name: parsed.name ?? '', address: '', lat: parsed.lat, lng: parsed.lng };
      showResults([{ ...place, name: place.name || '위치 확인 중…' }]);
      const r = await reversePlace(parsed.lat, parsed.lng, ctrl.signal).catch(() => null);
      place = { ...place, name: place.name || r?.name || '링크로 추가한 장소', address: r?.address ?? '' };
      if (!ctrl.signal.aborted) showResults([place]);
      return;
    }
    showMessage('검색 중…');
    const c = map.getCenter();
    const places = await searchPlaces(parsed?.query ?? q, { lat: c.lat, lng: c.lng, zoom: map.getZoom() }, ctrl.signal);
    if (!ctrl.signal.aborted) showResults(places);
  } catch (err) {
    if (err.name !== 'AbortError') showMessage(`검색하지 못했어요: ${err.message}`);
  }
}

searchEl.addEventListener('input', debounce(runSearch, 350));
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchEl.value = '';
    hideResults();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!ui.results.length) return;
    e.preventDefault();
    const n = ui.results.length;
    ui.activeResult = (ui.activeResult + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    $$('li', resultsEl).forEach((li, i) => li.classList.toggle('active', i === ui.activeResult));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const p = ui.results[ui.activeResult];
    if (p) addPlace(p);
    else runSearch();
  }
});
resultsEl.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) addPlace(ui.results[+li.dataset.i]);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) hideResults();
  if (!e.target.closest('.menu')) $('.menu').open = false;
});

function addPlace(place, { edit = false, listId = null } = {}) {
  if (!trip || !place) return;
  if (listId == null && ui.target === STAY_TARGET) return addStayFromOpts(place);
  const target = listId ?? ui.target;
  const item = M.addItem(trip, target, place);
  ui.openItem = edit ? item.id : null;
  if (edit) ui.openStay = null;
  searchEl.value = '';
  hideResults();
  commit();
  map.setView([item.lat, item.lng], Math.max(map.getZoom(), 14));
  const i = trip.days.findIndex((d) => d.id === target);
  toast(`"${item.name}" → ${i === -1 ? '보관함' : `Day ${i + 1}`}에 추가했어요`);
  const el = $(`.item[data-id="${CSS.escape(item.id)}"]`);
  el?.scrollIntoView({ block: 'nearest' });
  el?.classList.add('flash');
}

$('#target').addEventListener('change', (e) => {
  ui.target = e.target.value;
  if (ui.target !== STAY_TARGET) ui.lastList = ui.target;
  renderStayOpts();
});
$('#stayIn').addEventListener('change', (e) => {
  const range = M.rangeFromDates(trip, e.target.value, M.dateAtIndex(trip, M.indexOfDate(trip, e.target.value) + (ui.stayNights ?? M.DEFAULT_NIGHTS)));
  if (range) [ui.stayStart, ui.stayNights] = [range.startIndex, range.nights];
  renderStayOpts();
});
$('#stayOut').addEventListener('change', (e) => {
  const range = M.rangeFromDates(trip, $('#stayIn').value, e.target.value);
  if (range) [ui.stayStart, ui.stayNights] = [range.startIndex, range.nights];
  renderStayOpts();
});
$('#pickBtn').addEventListener('click', () => setPicking(!ui.picking));
$('#pickCancel').addEventListener('click', () => setPicking(false));

/* ───────── 상단 바 ───────── */
$('#tripTitle').addEventListener('change', (e) => {
  trip.title = e.target.value.trim() || '새 여행';
  commit();
});

function onDatesChange() {
  const start = $('#startDate').value;
  let end = $('#endDate').value;
  if (!start) return render();
  if (!end || end < start) end = start;
  const overflow = M.overflowCount(trip, start, end);
  if (overflow && !confirm(`줄어든 날짜에 있던 장소 ${overflow}곳은 '장소 보관함'으로 옮겨요. 계속할까요?`)) return render();
  M.setTripDates(trip, start, end);
  commit();
}
$('#startDate').addEventListener('change', onDatesChange);
$('#endDate').addEventListener('change', onDatesChange);

$('#exportXlsx').addEventListener('click', () => {
  try {
    exportXlsx(trip);
  } catch (err) {
    toast(err.message, 4000);
  }
});
$('#exportPdf').addEventListener('click', openPrint);

$('.menu-pop').addEventListener('click', (e) => {
  const action = e.target.closest('[data-menu]')?.dataset.menu;
  $('.menu').open = false;
  if (action === 'backup') downloadJson(trip);
  else if (action === 'import') $('#importFile').click();
  else if (action === 'delete') deleteTrip(trip.id);
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const imported = M.validateTrip(JSON.parse(await file.text()));
    if (store.trips[imported.id] && !confirm(`"${store.trips[imported.id].title}"이(가) 이미 있어요. 백업 파일 내용으로 덮어쓸까요?`)) return;
    switchTrip(imported, { save: true });
    toast(`"${imported.title}"을(를) 불러왔어요`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'JSON 파일을 읽을 수 없어요' : err.message, 4000);
  }
});

/* ───────── 여행 목록 / 새 여행 ───────── */
const dialog = $('#tripsDialog');

function openTrips(required = false) {
  const trips = Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('#tripList').innerHTML = trips.length
    ? trips
        .map((t) => {
          const n = t.days.reduce((s, d) => s + d.items.length, 0) + t.inbox.length;
          return `<li class="${t.id === trip?.id ? 'current' : ''}">
            <button class="t-open" data-open="${t.id}"><strong>${esc(t.title)}</strong>
              <span class="t-meta">${esc(t.startDate)} ~ ${esc(t.endDate)} · ${t.days.length}일 · ${n}곳</span></button>
            <button class="icon danger" data-del="${t.id}" title="삭제">✕</button></li>`;
        })
        .join('')
    : '';
  $('#tripList').hidden = !trips.length;
  $('#closeTrips').hidden = required && !trip;
  const form = $('#newTrip');
  if (!form.startDate.value) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    form.startDate.value = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() + 3);
    form.endDate.value = d.toISOString().slice(0, 10);
  }
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('cancel', (e) => {
  if (!trip) e.preventDefault();
});
$('#closeTrips').addEventListener('click', () => dialog.close());
$('#tripsBtn').addEventListener('click', () => openTrips());

$('#tripList').addEventListener('click', (e) => {
  const openId = e.target.closest('[data-open]')?.dataset.open;
  const delId = e.target.closest('[data-del]')?.dataset.del;
  if (openId) {
    switchTrip(store.trips[openId]);
    dialog.close();
  } else if (delId) {
    deleteTrip(delId);
  }
});

$('#newTrip').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submit = $('button[type="submit"]', form);
  const destination = form.destination.value.trim();
  submit.disabled = true;
  submit.textContent = '여행지 찾는 중…';
  let center = null;
  try {
    const [first] = await searchPlaces(destination);
    if (first) center = { lat: first.lat, lng: first.lng };
  } catch {
    /* 여행지 좌표를 못 찾아도 여행은 만든다 */
  }
  submit.disabled = false;
  submit.textContent = '만들기';
  const t = M.createTrip({
    title: form.title.value,
    destination,
    startDate: form.startDate.value,
    endDate: form.endDate.value,
    center,
  });
  form.reset();
  dialog.close();
  switchTrip(t, { save: true });
  if (center) map.setView([center.lat, center.lng], 12);
  searchEl.focus();
});

function switchTrip(t, { save = false } = {}) {
  trip = t;
  store.currentId = t.id;
  if (save) store.trips[t.id] = t;
  ui.openItem = null;
  ui.focusList = null;
  ui.target = null;
  persist();
  render({ fit: true });
}

function deleteTrip(id) {
  const t = store.trips[id];
  if (!t || !confirm(`"${t.title}" 여행을 삭제할까요? 되돌릴 수 없어요.`)) return;
  delete store.trips[id];
  if (trip?.id === id) {
    const next = Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    trip = next ?? null;
    store.currentId = next?.id ?? null;
  }
  persist();
  render({ fit: true });
  if (dialog.open) openTrips(!trip);
}

/* ───────── PDF (인쇄 미리보기) ───────── */
let printMaps = [];

function openPrint() {
  const el = $('#print');
  const lists = allLists().filter((l) => l.isDay || l.items.length);
  const range = trip.startDate ? `${M.formatDate(trip.startDate)} ~ ${M.formatDate(trip.endDate)} · ${trip.days.length}일` : '';
  el.innerHTML = `
    <div class="print-toolbar">
      <span id="printStatus">지도를 불러오는 중…</span>
      <button class="btn" id="doPrint">인쇄 / PDF로 저장</button>
      <button class="btn" id="closePrint">닫기</button>
    </div>
    <div class="print-page">
      <h1>${esc(trip.title)}</h1>
      <p class="p-sub">${esc(range)}</p>
      ${lists
        .map((l, i) => {
          const title = l.isDay ? M.dayTitle(trip.days[i], i) : '장소 보관함 (날짜 미정)';
          const st = l.isDay ? M.dayStays(trip, i) : {};
          const stayRow = (stay, label) =>
            stay ? `<tr class="stay"><td class="n">🏨</td><td class="t">${label}</td><td><strong>${esc(stay.name)}</strong>${stay.address ? `<div class="addr">${esc(stay.address)}</div>` : ''}</td><td class="memo">${esc(stay.memo)}</td></tr>` : '';
          const has = l.items.length || st.start || (l.isDay && dayFlights(i, 'top').length + dayFlights(i, 'bottom').length);
          const flightRows = (where) =>
            dayFlights(i, where)
              .map(({ flight: fl }) => `<tr class="flight"><td class="n">✈</td><td class="t">${esc(M.FLIGHT_KINDS[fl.kind])}</td><td><strong>${esc(M.flightSummary(fl))}</strong></td><td class="memo">${esc([fl.bookingRef && `예약번호 ${fl.bookingRef}`, fl.memo].filter(Boolean).join(' / '))}</td></tr>`)
              .join('');
          const rows = flightRows('top') + stayRow(st.start, '출발') + l.items
            .map(
              (it, j) => `<tr><td class="n">${l.isDay ? j + 1 : '•'}</td><td class="t">${esc(it.time)}</td>
                <td><strong>${esc(it.name)}</strong>${it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}</td>
                <td class="memo">${esc(it.memo)}${it.url ? `<div class="addr">${esc(it.url)}</div>` : ''}</td></tr>`,
            )
            .join('') + stayRow(st.end, '귀가') + flightRows('bottom');
          return `<section class="print-day" style="--c:${l.color}">
            <h2>${esc(title)}</h2>
            ${has ? `<div class="print-map" data-list="${l.id}" data-day="${i}"></div>` : ''}
            ${
              has
                ? `<table><thead><tr><th></th><th>시간</th><th>장소</th><th>메모</th></tr></thead><tbody>${rows}</tbody></table>`
                : '<p class="addr">아직 일정이 없어요</p>'
            }
          </section>`;
        })
        .join('')}
    </div>`;
  el.hidden = false;
  document.body.classList.add('printing');

  const loads = $$('.print-map', el).map((div) => {
    const l = lists.find((x) => x.id === div.dataset.list);
    const m = L.map(div, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false });
    printMaps.push(m);
    const tiles = L.tileLayer(TILE_URL, TILE_OPTS);
    const loaded = new Promise((resolve) => {
      tiles.once('load', resolve);
      setTimeout(resolve, 8000);
    });
    tiles.addTo(m);
    const st = l.isDay ? M.dayStays(trip, Number(div.dataset.day)) : {};
    const route = [...(st.start ? [st.start] : []), ...l.items, ...(st.end ? [st.end] : [])];
    const pts = route.map((it) => [it.lat, it.lng]);
    if (l.isDay && pts.length > 1) L.polyline(pts, { color: l.color, weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(m);
    l.items.forEach((it, j) => L.marker([it.lat, it.lng], { icon: pinIcon(l.isDay ? j + 1 : '•', l.color, false) }).addTo(m));
    new Set([st.start, st.end].filter(Boolean)).forEach((s) =>
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="stay-pin">🏨</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(m),
    );
    if (pts.length === 1) m.setView(pts[0], 15);
    else m.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    return loaded;
  });
  Promise.all(loads).then(() => {
    const status = $('#printStatus');
    if (status) status.textContent = '준비됐어요. 인쇄 창에서 "PDF로 저장"을 고르세요.';
  });
  $('#doPrint').addEventListener('click', () => window.print());
  $('#closePrint').addEventListener('click', closePrint);
}

function closePrint() {
  printMaps.forEach((m) => m.remove());
  printMaps = [];
  const el = $('#print');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('printing');
}

/* ───────── 모바일 탭 / 토스트 ───────── */
function showTab(tab) {
  const layout = $('.layout');
  if (layout.dataset.tab === tab) return;
  layout.dataset.tab = tab;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'map') setTimeout(() => map.invalidateSize(), 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

let toastTimer;
function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ───────── 시작 ───────── */
applyView();
fetch('data/trends.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  .then((data) => (trends = data))
  .catch(() => toast('트렌드 정보를 불러오지 못했어요'))
  .finally(() => {
    render({ fit: true });
    document.fonts?.ready.then(sizeDockCards); // 글꼴이 늦게 로드되면 다시 잰다
  });

/* ───────── 장소 보관함 (아래 고정 영역) / 날짜 옮기기 ───────── */
$('#inboxDock').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (btn.dataset.action === 'dock-toggle') {
    prefs.dockOpen = prefs.dockOpen === false;
    savePrefs();
    renderDays();
  } else if (btn.dataset.action === 'locate') {
    const found = M.findItem(trip, id);
    if (!found) return;
    showTab('map');
    map.setView([found.item.lat, found.item.lng], Math.max(map.getZoom(), 16));
    markers.get(id)?.openPopup();
  } else if (btn.dataset.action === 'delete') {
    const found = M.findItem(trip, id);
    if (found && confirm(`"${found.item.name}"을(를) 삭제할까요?`)) {
      M.removeItem(trip, id);
      commit();
    }
  }
});
for (const el of [$('#inboxDock'), $('#days')]) {
  el.addEventListener('change', (e) => {
    if (!e.target.matches('.move-to') || !e.target.value) return;
    moveToList(e.target.closest('.item')?.dataset.id, e.target.value);
  });
}

/* ───────── 모달: 바깥(배경) 클릭으로 닫기 ─────────
 * 누르기 시작한 곳과 뗀 곳이 모두 모달 박스 밖일 때만 닫는다.
 * (입력칸에서 글자를 드래그하다 밖에서 놓는 경우는 닫지 않음)
 */
function closeOnBackdrop(dlg, canClose = () => true) {
  const outside = (e) => {
    if (e.target !== dlg) return false; // 모달 안쪽 요소를 누른 경우
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => (downOutside = outside(e)));
  dlg.addEventListener('click', (e) => {
    if (downOutside && outside(e) && canClose()) dlg.close();
    downOutside = false;
  });
}
closeOnBackdrop(dialog, () => Boolean(trip)); // 여행이 하나도 없으면 먼저 만들어야 하므로 닫지 않는다
closeOnBackdrop(flightDialog);
