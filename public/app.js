import * as M from './lib/model.js';
import { parseLocationInput } from './lib/links.js';
import { searchPlaces, searchPlacesKo, HANGUL, reversePlace, geocodeDestination } from './lib/geo.js';
import { loadStore, saveStore } from './lib/store.js';
import { exportXlsx, downloadJson } from './lib/export.js';
import * as T from './lib/trends.js';
import * as B from './lib/budget.js';
import * as C from './lib/checklist.js';
import { encodeShare, decodeShare, shareUrl, shareCodeFromHash, shareSummary, shareMessage } from './lib/share.js';
import { enhanceDates } from './lib/datepicker.js';
import { loadWeather, weatherSignature } from './lib/weather.js';

const COLORS = ['#3B6FD6', '#E8590C', '#C2255C', '#0B8A6F', '#7048E8', '#1098AD', '#F08C00', '#5C940D'];
const INBOX_COLOR = '#868e96';
const TREND_COLOR = '#7048e8';
const dayColor = (i) => COLORS[i % COLORS.length];
const TODAY = new Date().toISOString().slice(0, 10);

// 화면 설정(보기 방식 등)은 이 브라우저에만 기억한다. 저장소를 못 써도 기본값으로 동작.
const PREF_KEY = 'xenotravel:prefs';
const prefs = (() => {
  try {
    return { view: 'list', trendsOpen: true, mapHidden: false, pinColor: 'day', page: 'plan', theme: 'system', ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { view: 'list', trendsOpen: true, mapHidden: false, pinColor: 'day', page: 'plan', theme: 'system' };
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

// 지도 타일: Esri Light Gray Canvas (바탕 + 글자 두 겹). 차분한 회색이라 일정 핀이 잘 보인다. 키 없이 쓰고 출처 표기 필수.
// 어두운 화면에서는 Dark Gray Canvas. (CARTO는 2025년부터 키가 필요하고, Stadia는 localhost 밖에서 키가 필요하다)
// Canvas 타일은 16단계까지라 더 확대하면 16단계 그림을 키워서 보여준다.
// 사용자가 늘면 ArcGIS 계정 키나 MapTiler·Stadia 키 기반으로 바꿔야 한다.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const TILES = {
  light: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  dark: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const TILE_OPTS = {
  maxZoom: 19,
  maxNativeZoom: 16,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · 검색 <a href="https://photon.komoot.io">Photon</a>',
};
/** 바탕 + 글자 타일 묶음 */
const tileGroup = (kind) => L.layerGroup([L.tileLayer(TILES[kind][0], TILE_OPTS), L.tileLayer(TILES[kind][1], { ...TILE_OPTS, attribution: '' })]);
const isDark = () =>
  prefs.theme === 'dark' || (prefs.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

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
  readonly: false, // 공유 링크로 연 일정 (저장·편집하지 않음)
  routePlan: null, // 동선 정리 미리 보기 { listId, dayIndex, ids, beforeKm, afterKm, savedKm, fixed }
  routeUndo: null, // 방금 적용한 동선 정리 되돌리기 { listId, dayIndex, prev, applied, savedKm }
  weather: { sig: '', data: {} }, // 일차 id → 날씨 요약
};

/* ───────── 지도 ───────── */
const map = L.map('map', { worldCopyJump: true }).setView([30, 20], 2);
let baseKind = isDark() ? 'dark' : 'light';
let baseTiles = tileGroup(baseKind).addTo(map);
/** 밝기가 바뀌면 지도 타일도 바꾼다 */
function syncTiles() {
  const kind = isDark() ? 'dark' : 'light';
  if (kind === baseKind) return;
  map.removeLayer(baseTiles);
  baseKind = kind;
  baseTiles = tileGroup(kind).addTo(map);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTiles);
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

const UNSET_COLOR = '#94a3b8'; // 종류 보기에서 종류를 안 정한 장소
const byCategory = () => prefs.pinColor === 'category';
/** 핀 색: 일차별(동선 선과 같은 색) 또는 종류별(관광·맛집·카페·쇼핑) */
const pinColorOf = (it, listColor) => (byCategory() ? M.CATEGORIES[it.category]?.color ?? UNSET_COLOR : listColor);
const stayPinHtml = () => `<div class="stay-pin"${byCategory() ? ` style="background:${M.STAY_COLOR};border-color:${M.STAY_COLOR};color:#fff"` : ''}>숙소</div>`;
const catIcon = (it) => {
  const c = M.CATEGORIES[it.category];
  return c ? `<span class="cat-tag" style="--cc:${c.color}">${c.label}</span>` : '';
};

function renderPinLegend() {
  const el = $('#pinLegend');
  el.innerHTML = `<div class="pin-seg" role="group" aria-label="핀 색 기준">
      <button data-pin="day" class="${byCategory() ? '' : 'active'}">일차별</button>
      <button data-pin="category" class="${byCategory() ? 'active' : ''}">종류별</button>
    </div>${
      byCategory()
        ? `<div class="legend">${Object.values(M.CATEGORIES)
            .map((c) => `<span><i style="--c:${c.color}"></i>${c.label}</span>`)
            .join('')}<span><i style="--c:${M.STAY_COLOR}"></i>숙소</span></div>`
        : ''
    }`;
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
  const plan = currentRoutePlan();
  allLists().forEach((l, dayIndex) => {
    const dim = ui.focusList != null && ui.focusList !== l.id;
    // 동선 정리 미리 보기 중인 날은 제안 순서로 선과 번호를 그린다 (실선 = 아직 적용 전 제안).
    const preview = plan?.listId === l.id ? plan.ids.map((id) => l.items.find((it) => it.id === id)) : null;
    // 동선: 출발 숙소 → 장소들 → 귀가 숙소
    const { start, end } = l.isDay ? M.dayStays(trip, dayIndex) : {};
    const route = preview ? [start, ...preview, end].filter(Boolean) : l.isDay ? M.dayRoute(trip, dayIndex) : l.items;
    const pts = route.map((it) => [it.lat, it.lng]);
    if (!dim) [start, end].forEach((s) => s && bounds.push([s.lat, s.lng]));
    if (l.isDay && pts.length > 1) {
      L.polyline(pts, preview ? { color: l.color, weight: 4, opacity: 0.9 } : { color: l.color, weight: 3, opacity: dim ? 0.15 : 0.75, dashArray: '6 6' }).addTo(layer);
    }
    l.items.forEach((it, i) => {
      const n = preview ? preview.indexOf(it) + 1 : i + 1;
      const m = L.marker([it.lat, it.lng], {
        icon: pinIcon(l.isDay ? n : '•', pinColorOf(it, l.color), dim),
        zIndexOffset: dim ? 0 : 1000,
      }).addTo(layer);
      m.bindPopup(
        `<div class="popup-name">${esc(it.name)}</div>` +
          `<div class="popup-meta">${M.CATEGORIES[it.category] ? `${M.CATEGORIES[it.category].label} · ` : ''}${esc(l.label)}${l.isDay ? ` · ${i + 1}번째` : ''}${it.time ? ` · ${esc(it.time)}` : ''}</div>` +
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
      icon: L.divIcon({ className: '', html: stayPinHtml(), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }),
      zIndexOffset: 1500,
    }).addTo(layer);
    m.bindPopup(
      `<div class="popup-name">${esc(s.name)}</div>` +
        `<div class="popup-meta">${s.nights}박${checkIn ? ` · ${esc(M.formatDate(checkIn))} 체크인 ~ ${esc(M.formatDate(checkOut))} 체크아웃` : ''}</div>` +
        `<a href="${M.googleMapsUrl(s)}" target="_blank" rel="noopener">구글맵에서 열기</a>`,
    );
    markers.set(s.id, m);
  }
  renderTrendMarkers();
  renderPinLegend();
  $('#showAll').classList.toggle('on', ui.focusList == null);
  if (fit) fitTo(bounds);
}

/* ───────── 트렌드 (요즘 뜨는 곳) ───────── */
function currentCity() {
  if (!trip || !trends.cities.length) return null;
  const chosen = trends.cities.find((c) => c.id === trip.trendCity);
  return chosen ?? T.cityByName(trends.cities, trip.destination) ?? T.nearestCity(trends.cities, T.tripAnchor(trip));
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
  if (!city || ui.readonly || (prefs.view === 'list' && !prefs.trendsOpen)) return;
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
  return `<section class="day trend-col card" style="--c:${TREND_COLOR}">
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
  if (!trip || ui.readonly) return;
  const { lat, lng } = e.latlng;
  ui.ctxPlace = { name: '선택한 위치', address: '', lat, lng };
  const html = (name, address) =>
    `<div class="ctx">
      <div class="popup-name">${esc(name)}</div>
      <div class="popup-meta">${esc(address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}</div>
      <button class="ctx-btn" data-ctx-add="item">+ 이 위치 추가 <small>(${esc(targetLabel())})</small></button>
      <button class="ctx-btn stay" data-ctx-add="stay">숙소로 추가 <small>(${esc(stayOptsLabel())})</small></button>
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
  if (ui.readonly) return render({ fit }); // 공유받은 일정은 저장하지 않는다
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
    document.body.dataset.hasTrip = 'no';
    showPage('home');
    return;
  }
  document.body.dataset.hasTrip = 'yes';
  trip.stays ??= []; // 숙소 기능 이전에 만든 여행
  repairCenter();
  document.title = `${trip.title} · XenoTravel`;
  const title = $('#tripTitle');
  if (document.activeElement !== title) title.value = trip.title;
  title.readOnly = ui.readonly;
  $('#startDate').disabled = $('#endDate').disabled = ui.readonly;
  $('#startDate').value = trip.startDate;
  $('#endDate').value = trip.endDate;
  renderHero();
  renderNotice();
  renderToday();
  renderTarget();
  renderDays();
  renderMap({ fit });
  renderBadge();
  if (prefs.page === 'budget') renderBudget();
  if (prefs.page === 'check') renderChecks();
  if (prefs.page === 'home') renderHome();
  refreshWeatherSoon();
}

/** 여행지 이름이 트렌드 도시인데 좌표가 그 도시와 멀면(예전 검색이 서울의 "오사카○○" 식당을 찾은 경우) 도시 좌표로 고친다. */
function repairCenter() {
  const named = T.cityByName(trends.cities, trip.destination);
  if (!named || (trip.center && T.distanceKm(trip.center, named.center) <= 150)) return;
  trip.center = { ...named.center };
  if (!ui.readonly) {
    store.trips[trip.id] = trip;
    persist();
  }
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
      .join('') + `<option value="${STAY_TARGET}"${ui.target === STAY_TARGET ? ' selected' : ''}>숙소로 추가</option>`;
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
    `숙소 "${stay.name}" ${stay.nights}박${checkIn ? ` (${M.formatDate(checkIn)} ~ ${M.formatDate(checkOut)})` : ''}을 추가했어요`,
    3000,
  );
}

function stayRowHtml(stay, dayIndex, pos, flags, leg = null) {
  const key = `${stay.id}|${dayIndex}|${pos}`;
  const open = ui.openStay === key;
  const tag = pos === 'start' && flags.checkOut ? '체크아웃' : pos === 'end' && flags.checkIn ? '체크인' : '';
  const n = trip.days.length;
  const editor = open && ui.readonly
    ? detailHtml(stay, { stay: true })
    : open
    ? `<div class="editor stay-editor" data-stay="${stay.id}">
        <label>숙소 이름<input data-sfield="name" value="${esc(stay.name)}"></label>
        <div class="stay-range" data-dp-pair="숙소 날짜" data-dp-min-nights="1">
          <label>체크인<input type="date" data-srange="in" data-dp="start" aria-label="체크인" value="${M.dateAtIndex(trip, stay.startIndex)}"
            min="${M.dateAtIndex(trip, 0)}" max="${M.dateAtIndex(trip, n - 1)}"></label>
          <label>체크아웃<input type="date" data-srange="out" data-dp="end" aria-label="체크아웃" value="${M.dateAtIndex(trip, stay.startIndex + stay.nights)}"
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
  return `<div class="tl-row stay">${legHtml(leg)}<div class="tl-time"></div><div class="tl-box">
    <div class="stay-row ${pos}${open ? ' open' : ''}" data-stay="${stay.id}" data-key="${key}">
      <button class="stay-main" data-action="stay-toggle">
        <span class="stay-pos">${pos === 'start' ? '출발' : '귀가'}</span>
        <span class="stay-name">${esc(stay.name)}</span>${tag ? `<span class="stay-tag">${tag}</span>` : ''}
      </button>
      <button class="icon" data-action="stay-locate" title="지도에서 보기">◎</button>
    </div>${editor}</div></div>`;
}

/** 앞 장소에서 여기까지: "도보 약 12분 · 850m  길찾기" (직선거리 기준 어림값) */
function legHtml(leg) {
  if (!leg) return '';
  const how = leg.mode === 'walking' ? `도보 약 ${leg.walkMin}분 · ${M.formatKm(leg.km)} · ${M.formatSteps(leg.steps)}걸음` : `${M.formatKm(leg.km)} · 대중교통`;
  return `<a class="leg" href="${leg.url}" target="_blank" rel="noopener"
      title="직선거리 기준 어림값이에요. 누르면 구글맵 길찾기(${leg.mode === 'walking' ? '도보' : '대중교통'})가 열려요">
      <span class="leg-how">${how}</span><span class="leg-go">길찾기</span></a>`;
}

/** 보기 전용(공유받은 일정)에서 편집 창 대신 보여주는 상세 */
function detailHtml(x, { stay = false } = {}) {
  const url = M.safeUrl(x.url);
  const range = stay ? M.stayDates(trip, x) : null;
  return `<div class="editor detail">
      ${stay ? `<p><b>${x.nights}박</b>${range.checkIn ? ` · ${esc(M.formatDate(range.checkIn))} ~ ${esc(M.formatDate(range.checkOut))}` : ''}</p>` : ''}
      ${x.memo ? `<p class="memo-text">${esc(x.memo)}</p>` : ''}
      ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>` : ''}
      ${x.address ? `<p class="addr">${esc(x.address)}</p>` : ''}
      <div class="editor-actions"><a href="${M.googleMapsUrl(x)}" target="_blank" rel="noopener">구글맵에서 열기 ↗</a></div>
    </div>`;
}

function itemHtml(it, i, isDay, leg = null) {
  const open = ui.openItem === it.id;
  const sub = esc(it.memo.split('\n')[0] || it.address); // 시간은 타임라인 왼쪽에 따로 보인다
  return `<li class="item${open ? ' open' : ''}" data-id="${it.id}">
    ${legHtml(leg)}
    <div class="tl-time">${esc(it.time)}</div>
    <div class="tl-box">
    <div class="item-row">
      <span class="drag" title="끌어서 순서·날짜 바꾸기">⋮⋮</span>
      <span class="num">${isDay ? i + 1 : '•'}</span>
      <button class="item-main" data-action="toggle">
        <span class="item-name"><span class="nm">${esc(it.name)}</span>${catIcon(it)}</span>
        <span class="item-sub">${sub}</span>
      </button>
      <button class="icon" data-action="duplicate" title="복제">⧉</button>
      <button class="icon" data-action="locate" title="지도에서 보기">◎</button>
    </div>
    ${
      open && ui.readonly
        ? detailHtml(it)
        : open
        ? `<div class="editor">
      <label>이름<input data-field="name" value="${esc(it.name)}"></label>
      <div class="cat-pick" role="group" aria-label="종류">${Object.entries(M.CATEGORIES)
        .map(([k, c]) => `<button type="button" data-action="set-cat" data-cat="${k}" class="${it.category === k ? 'on' : ''}" style="--c:${c.color}">${c.label}</button>`)
        .join('')}</div>
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
    </div>
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
      const t = (role === 'arrive' ? f.arriveAt : f.departAt).slice(11, 16);
      return `<div class="tl-row flight"><div class="tl-time">${esc(t)}</div><div class="tl-box">
        <button class="flight-main" data-action="flight-edit" data-flight="${f.id}" title="항공편 수정">
          <span class="fl-ic" aria-hidden="true"><svg class="ic"><use href="#i-plane"/></svg></span>
          <span class="fl-kind">${esc(M.FLIGHT_KINDS[f.kind])}${note ? ` · ${note}` : ''}</span>
          <span class="fl-text">${esc(M.flightSummary(f))}</span>
          ${f.bookingRef ? `<span class="fl-ref">${esc(f.bookingRef)}</span>` : ''}
        </button>
      </div></div>`;
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
  toast(outside ? '저장했어요. 출발일이 여행 기간 밖이라 일정에는 보이지 않아요' : `${M.flightSummary(saved)} 저장했어요`, outside ? 4000 : 2200);
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
  dock.hidden = ui.readonly && !items.length; // 공유받은 일정: 빈 보관함은 보여줄 게 없다
  const open = prefs.dockOpen !== false;
  const cards = items
    .map(
      (it) => `<li class="item dock-card" data-id="${it.id}" style="--c:${INBOX_COLOR}">
        <div class="dock-top">
          <span class="drag" title="끌어서 원하는 날에 놓기">⋮⋮</span>
          <div class="dock-text">
            <span class="item-name"><span class="nm">${esc(it.name)}</span>${catIcon(it)}</span>
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

/** 하루 타임라인 본문: 항공(출발) → 출발 숙소 → 장소들 → 귀가 숙소 → 항공(귀국) */
function dayBodyHtml(l) {
  const st = M.dayStays(trip, l.dayIndex);
  // 구간 거리: route[k-1] → route[k]. 출발 숙소가 있으면 장소 j는 route[j+1].
  const route = M.dayRoute(trip, l.dayIndex);
  const off = st.start ? 1 : 0;
  const legTo = (k) => (k > 0 && route[k] ? M.routeLeg(route[k - 1], route[k]) : null);
  return `<div class="timeline" style="--c:${l.color}">
      ${flightRowsHtml(l.dayIndex, 'top')}
      ${st.start ? stayRowHtml(st.start, l.dayIndex, 'start', st) : ''}
      <ol class="items" data-list="${l.id}" data-empty="${ui.readonly ? '아직 정한 곳이 없어요' : '장소를 검색하거나 여기로 끌어오세요'}">${l.items.map((it, j) => itemHtml(it, j, true, legTo(off + j))).join('')}</ol>
      ${st.end ? stayRowHtml(st.end, l.dayIndex, 'end', st, legTo(route.length - 1)) : ''}
      ${flightRowsHtml(l.dayIndex, 'bottom')}
    </div>`;
}

function dayToolsHtml(l) {
  const st = M.dayStays(trip, l.dayIndex);
  const url = M.routeDirectionsUrl(M.dayRoute(trip, l.dayIndex));
  const link = url ? `<a class="route-link" href="${url}" target="_blank" rel="noopener" title="이 날 동선 전체를 구글맵 길찾기로 열기">길찾기</a>` : '';
  const copy = `<button data-action="day-copy" data-day="${l.dayIndex}" title="이 날 일정을 카톡에 붙일 글로 복사해요">카톡용 복사</button>`;
  const route = link + copy;
  if (ui.readonly) return route;
  const movable = l.items.filter((it) => !it.time).length;
  return `${route}${st.end ? '' : `<button data-action="stay-here" data-day="${l.dayIndex}" title="이 날부터 묵을 숙소 추가">+ 숙소</button>`}${
    movable > 1 ? `<button data-action="route-opt" data-list="${l.id}" title="숙소 기준으로 덜 돌아가는 순서를 찾아요. 시간을 정한 장소는 그대로 둬요">동선 정리</button>` : ''
  }${l.items.length > 1 ? `<button data-action="sort-time" data-list="${l.id}">시간순</button>` : ''}`;
}

/* ───────── 일차별 날씨 ─────────
 * 날짜·숙소 위치가 바뀔 때만 다시 가져온다(캐시는 weather.js). 도착하면 카드 전체를 다시 그리지 않고
 * 날씨 칸만 채운다 (메모를 입력하는 중이어도 커서가 튀지 않게).
 */
const WX_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4"/>',
  partly: '<path d="M8 4.5v1.2 M3.8 9H5 M5 5.9l.9.9 M11.3 7.6A3.5 3.5 0 0 0 5.7 11"/><path d="M9 19h8.5a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 8.4 13 3 3 0 0 0 9 19Z"/>',
  cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.6 12a3.3 3.3 0 0 0 .9 6.5Z"/>',
  rain: '<path d="M7.5 14.5h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.6 8a3.3 3.3 0 0 0 .9 6.5Z M8.5 17.5l-1 2.5 M12.5 17.5l-1 2.5 M16.5 17.5l-1 2.5"/>',
  snow: '<path d="M7.5 14.5h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.6 8a3.3 3.3 0 0 0 .9 6.5Z M8 18.5h.01 M12 20h.01 M16 18.5h.01"/>',
  storm: '<path d="M7.5 14.5h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.6 8a3.3 3.3 0 0 0 .9 6.5Z M12.5 15.5l-2 3h3l-2 3"/>',
  fog: '<path d="M4 9h16 M6 13h12 M4 17h16"/>',
};

function wxChipHtml(w, dayId) {
  if (!w) return '';
  if (w.kind === 'climate') {
    // 예보 전: 작년 기록은 눌러야 보인다 (다음 달 비 소식으로 읽히지 않게)
    const d = M.parseDate(w.forecastFrom);
    const from = d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}부터` : '';
    const open = ui.wxRefOpen?.has(dayId) && w.ref;
    return `<button type="button" class="chip wx wx-ref" data-action="wx-ref" data-day-id="${dayId}" title="예보는 여행 16일 전부터 나와요${w.ref ? '. 누르면 작년 같은 날 날씨를 보여줘요' : ''}"${w.ref ? '' : ' disabled'}>
        예보 전${from ? ` · ${from}` : ''}${open ? ` <span class="wx-last">작년 이맘때 ${esc(w.ref.text)} <b>${esc(w.ref.temp)}</b></span>` : ''}</button>`;
  }
  const icon = `<svg class="wx-ic" viewBox="0 0 24 24" aria-hidden="true">${WX_ICONS[w.icon] ?? WX_ICONS.cloud}</svg>`;
  const rain = w.prob != null && w.prob >= 20 ? `<em>비 ${w.prob}%</em>` : '';
  const pre = w.kind === 'climate' ? '<small>작년 이맘때</small>' : '';
  return `<span class="chip wx wx-${w.icon}${w.kind === 'climate' ? ' wx-ref' : ''}${w.wet ? ' wx-wet' : ''}" title="${esc(w.title)}">${icon}${pre}${esc(w.text)} <b>${esc(w.temp)}</b>${rain}</span>`;
}

function wxHintHtml(w) {
  if (!w?.wet) return '';
  const what = w.icon === 'snow' ? '눈' : '비';
  return `<p class="wx-hint">${what} 소식이 있어요${w.prob != null ? ` (${what} ${w.prob}%)` : ''}. 실내 장소 위주로 짜거나 우산을 챙기세요</p>`;
}

function paintWeather() {
  for (const el of $$('[data-wx]')) el.innerHTML = wxChipHtml(ui.weather.data[el.dataset.wx], el.dataset.wx);
  for (const el of $$('[data-wx-hint]')) el.innerHTML = wxHintHtml(ui.weather.data[el.dataset.wxHint]);
}

function refreshWeather() {
  if (!trip) return;
  const sig = `${trip.id}#${weatherSignature(trip, TODAY)}`;
  if (sig === ui.weather.sig) return;
  ui.weather.sig = sig;
  loadWeather(trip, TODAY)
    .then((data) => {
      if (ui.weather.sig !== sig) return; // 그사이 날짜·여행이 바뀜
      ui.weather.data = data;
      paintWeather();
    })
    .catch(() => {});
}
const refreshWeatherSoon = debounce(refreshWeather, 600);

/* ───────── 동선 자동 정리 ─────────
 * 버튼 → 제안 계산(미리 보기) → 적용을 눌러야 순서가 바뀐다. 그사이 그날 장소가 바뀌면 제안은 버린다.
 */
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const dayIds = (dayIndex) => trip.days[dayIndex]?.items.map((it) => it.id) ?? [];

function currentRoutePlan() {
  const p = ui.routePlan;
  if (p && (trip.days[p.dayIndex]?.id !== p.listId || !sameIds(dayIds(p.dayIndex), p.current))) ui.routePlan = null;
  return ui.routePlan;
}

function currentRouteUndo() {
  const u = ui.routeUndo;
  if (u && (trip.days[u.dayIndex]?.id !== u.listId || !sameIds(dayIds(u.dayIndex), u.applied))) ui.routeUndo = null;
  return ui.routeUndo;
}

function proposeRoute(listId) {
  const dayIndex = trip.days.findIndex((d) => d.id === listId);
  const r = M.optimizeDay(trip, dayIndex);
  if (!r) return;
  if (!r.changed) {
    ui.routePlan = null;
    toast(r.fixed ? '시간을 정한 곳을 그대로 두면 지금 순서가 가장 짧아요' : '지금 순서가 이미 가장 짧아요');
    return;
  }
  ui.routePlan = { listId, dayIndex, current: dayIds(dayIndex), ids: r.items.map((it) => it.id), beforeKm: r.beforeKm, afterKm: r.afterKm, savedKm: r.savedKm, fixed: r.fixed };
  ui.routeUndo = null;
  ui.focusList = listId;
  ui.day = dayIndex;
  renderDays();
  renderMap({ fit: true });
}

function applyRoute() {
  const p = currentRoutePlan();
  if (!p) return;
  if (!M.applyDayOrder(trip, p.dayIndex, p.ids)) {
    ui.routePlan = null;
    return toast('그사이 장소가 바뀌어서 다시 계산해 주세요');
  }
  ui.routeUndo = { listId: p.listId, dayIndex: p.dayIndex, prev: p.current, applied: p.ids, savedKm: p.savedKm };
  ui.routePlan = null;
  commit();
}

function undoRoute() {
  const u = currentRouteUndo();
  if (!u) return;
  M.applyDayOrder(trip, u.dayIndex, u.prev);
  ui.routeUndo = null;
  commit();
  toast('원래 순서로 되돌렸어요');
}

function routePlanHtml(l) {
  const plan = currentRoutePlan();
  if (plan?.listId === l.id) {
    const byId = new Map(l.items.map((it) => [it.id, it]));
    const rows = plan.ids
      .map((id, i) => {
        const it = byId.get(id);
        const moved = plan.current[i] !== id;
        return `<li class="${it.time ? 'fixed' : moved ? 'moved' : ''}"><span class="rp-num">${i + 1}</span><span class="rp-name">${esc(it.name)}</span>${
          it.time ? `<span class="rp-tag">${esc(it.time)} 고정</span>` : ''
        }</li>`;
      })
      .join('');
    return `<div class="route-plan" role="region" aria-label="동선 정리 제안">
        <div class="rp-head">
          <strong>동선 정리 제안</strong>
          <span class="rp-km">${M.formatKm(plan.beforeKm)} → <b>${M.formatKm(plan.afterKm)}</b></span>
        </div>
        <p class="rp-sub">이동 거리가 ${M.formatKm(plan.savedKm)} 줄어요. 숙소 기준 직선거리로 계산했어요${plan.fixed ? ` · 시간을 정한 ${plan.fixed}곳은 그대로 둬요` : ''}.</p>
        <ol class="rp-list">${rows}</ol>
        <div class="rp-actions">
          <button class="btn" data-action="route-cancel">취소</button>
          <button class="btn primary" data-action="route-apply">이 순서로 바꾸기</button>
        </div>
      </div>`;
  }
  const undo = currentRouteUndo();
  if (undo?.listId === l.id) {
    return `<div class="route-done"><span>동선을 정리했어요 · ${M.formatKm(undo.savedKm)} 줄었어요</span><button data-action="route-undo">되돌리기</button></div>`;
  }
  return '';
}

/** 하루 카드: 머리(날짜·장소 이름·요약) + 타임라인. 목록형은 위아래로, 보드형은 칸으로 늘어놓는다. */
function dayCardHtml(l) {
  const sum = M.daySummary(trip, l.dayIndex);
  const st = M.dayStays(trip, l.dayIndex);
  const date = M.formatDate(trip.days[l.dayIndex].date);
  const dayId = trip.days[l.dayIndex].id;
  const chips = [
    `<span class="wx-slot" data-wx="${dayId}">${wxChipHtml(ui.weather.data[dayId], dayId)}</span>`,
    sum.places ? `<span class="chip">${sum.places}곳</span>` : '',
    sum.km >= 0.05 ? `<span class="chip">이동 ${M.formatKm(sum.km)}</span>` : '',
    sum.steps ? `<span class="chip" title="걸어갈 만한 구간만 더한 어림값">약 ${M.formatSteps(sum.steps)}걸음</span>` : '',
    sum.from ? `<span class="chip">${esc(sum.from)}${sum.to !== sum.from ? ` – ${esc(sum.to)}` : ''}</span>` : '',
    st.end ? `<span class="chip stay">숙소 ${esc(st.end.name)}</span>` : '',
  ].join('');
  return `<section id="day-${l.dayIndex}" class="day daycard card${ui.focusList === l.id ? ' is-focus' : ''}" style="--c:${l.color}">
      <div class="dc-head">
        <button class="dc-title-btn" data-action="focus" data-list="${l.id}" title="지도에서 이 날만 보기">
          <span class="dc-meta"><span class="dot"></span>Day ${l.dayIndex + 1}${date ? `<small>${esc(date)}</small>` : ''}</span>
          <span class="dc-title${sum.title ? '' : ' empty'}">${sum.title ? esc(sum.title) : '아직 비어 있는 날'}</span>
        </button>
        <div class="day-tools">${dayToolsHtml(l)}</div>
      </div>
      <div class="chips">${chips}</div>
      <div class="wx-hint-slot" data-wx-hint="${dayId}">${wxHintHtml(ui.weather.data[dayId])}</div>
      ${ui.readonly ? '' : routePlanHtml(l)}
      ${dayBodyHtml(l)}
    </section>`;
}

function renderDays() {
  ui.sortables.forEach((s) => s.destroy());
  ui.sortables = [];
  const daysEl = $('#days');
  const lists = allLists()
    .filter((l) => l.isDay)
    .map((l, i) => ({ ...l, dayIndex: i, title: M.dayTitle(trip.days[i], i) }));
  ui.day = Math.max(0, Math.min(ui.day ?? 0, lists.length - 1));
  renderDock();
  renderDayTabs();
  daysEl.innerHTML =
    (ui.readonly ? '' : trendSectionHtml()) + lists.map(dayCardHtml).join('');
  enhanceDates(daysEl);

  for (const ol of [...$$('ol.items', daysEl), ...$$('ol.items', $('#inboxDock'))]) {
    ui.sortables.push(
      new Sortable(ol, {
        group: 'plan',
        disabled: Boolean(ui.readonly),
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
  const dayIdx = trip.days.findIndex((d) => d.id === listIdOf(id));
  if (dayIdx !== -1 && dayIdx !== ui.day && prefs.view !== 'board') {
    ui.day = dayIdx;
    ui.focusList = trip.days[dayIdx].id;
    renderMap();
  }
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
    ui.keepView = true;
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
    const di = trip.days.findIndex((d) => d.id === listId);
    if (di !== -1) ui.day = di;
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
  } else if (action === 'wx-ref') {
    ui.wxRefOpen ??= new Set();
    const id = btn.dataset.dayId;
    ui.wxRefOpen.has(id) ? ui.wxRefOpen.delete(id) : ui.wxRefOpen.add(id);
    paintWeather();
  } else if (action === 'day-copy') {
    copyText(M.dayShareText(trip, Number(btn.dataset.day)), '그날 일정을 복사했어요. 카톡에 붙여넣으세요');
  } else if (action === 'route-opt') {
    proposeRoute(btn.dataset.list);
  } else if (action === 'route-apply') {
    applyRoute();
  } else if (action === 'route-cancel') {
    ui.routePlan = null;
    renderDays();
    renderMap();
  } else if (action === 'route-undo') {
    undoRoute();
  } else if (action === 'duplicate') {
    const copy = M.duplicateItem(trip, id);
    if (!copy) return;
    ui.openItem = null;
    commit();
    $(`.item[data-id="${CSS.escape(copy.id)}"]`)?.classList.add('flash');
    toast(`"${copy.name}"을(를) 복제했어요. 끌어서 다른 날로 옮길 수 있어요`);
  } else if (action === 'set-cat') {
    const found = M.findItem(trip, id);
    if (!found) return;
    found.item.category = found.item.category === btn.dataset.cat ? '' : btn.dataset.cat;
    commit();
  } else if (action === 'flight-edit') {
    if (!ui.readonly) openFlights(btn.dataset.flight);
  } else if (action === 'stay-toggle') {
    const key = btn.closest('.stay-row').dataset.key;
    ui.openStay = ui.openStay === key ? null : key;
    ui.openItem = null;
    renderDays();
  } else if (action === 'stay-locate') {
    const s = M.findStay(trip, btn.closest('.stay-row').dataset.stay);
    if (!s) return;
    ui.keepView = true;
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
  $('.item-name', li).innerHTML = `<span class="nm">${esc(it.name)}</span>${catIcon(it)}`;
  $('.item-sub', li).textContent = it.memo.split('\n')[0] || it.address;
  const timeEl = $('.tl-time', li);
  if (timeEl) timeEl.textContent = it.time;
  refreshMapSoon();
});

$('#days').addEventListener('change', (e) => {
  if (!e.target.matches('.trend-city')) return;
  trip.trendCity = e.target.value || null;
  commit();
  const city = currentCity();
  if (city && !T.tripAnchor(trip)) map.setView([city.center.lat, city.center.lng], 12);
});

$('#pinLegend').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-pin]')?.dataset.pin;
  if (!mode || mode === prefs.pinColor) return;
  prefs.pinColor = mode;
  savePrefs();
  renderMap();
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
    // 날짜별 보기는 고른 날만 강조, 보드는 전체
    if (trip) ui.focusList = prefs.view === 'list' ? trip.days[ui.day ?? 0]?.id ?? null : null;
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

/** explicit: Enter로 검색 (한국어 검색은 Enter일 때만 한다) */
async function runSearch({ explicit = false } = {}) {
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
    const query = parsed?.query ?? q;
    const c = map.getCenter();
    const near = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    if (HANGUL.test(query)) {
      if (!explicit) return showMessage(`Enter를 누르면 "${query}"을(를) 한국어로 찾아요`);
      showMessage('한국어로 찾는 중…');
      const places = await searchPlacesKo(query, near, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!places.length) {
        return showMessage('한국어 이름으로는 못 찾았어요. 영어·현지어로 검색하거나(예: Kuromon Market), 구글맵 링크를 붙여넣어 주세요.');
      }
      return showResults(places);
    }
    showMessage('검색 중…');
    const places = await searchPlaces(query, near, ctrl.signal);
    if (!ctrl.signal.aborted) showResults(places);
  } catch (err) {
    if (err.name !== 'AbortError') showMessage(`검색하지 못했어요: ${err.message}`);
  }
}

searchEl.addEventListener('input', debounce(() => runSearch(), 350));
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
    else runSearch({ explicit: true });
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
  renderTripSwitcher();
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

/* ───────── 메인 페이지 · 주소(라우팅) ─────────
 * #/               메인 (새 여행 만들기 · 내 여행 · 요즘 뜨는 곳)
 * #/trip/<id>      일정   (#/trip/<id>/budget, #/trip/<id>/check)
 * 공유 링크(/s/<id>, #s=…)는 따로 처리한다.
 */
const POPULAR = ['오사카', '도쿄', '후쿠오카', '교토', '삿포로', '오키나와', '다낭', '방콕', '타이베이', '파리'];

function tripHash(page, id) {
  if (page === 'home' || !id) return '#/';
  return `#/trip/${id}${page === 'budget' || page === 'check' ? `/${page}` : ''}`;
}

/** 화면 이동: 주소를 바꾸면 hashchange → route()가 그린다 (뒤로 가기도 같은 길로) */
function go(page, id = trip?.id ?? store.currentId) {
  const h = tripHash(page, id);
  if (location.hash === h || (h === '#/' && !location.hash)) route();
  else location.hash = h;
}

/** 주소에 맞는 화면을 그린다 */
function route() {
  if (ui.readonly) return;
  const m = /^#\/trip\/([^/]+)(?:\/(budget|check))?$/.exec(location.hash);
  const t = m && store.trips[decodeURIComponent(m[1])];
  if (!t) {
    if (m) history.replaceState(null, '', '#/'); // 지워졌거나 없는 여행
    showPage('home');
    return;
  }
  if (trip?.id !== t.id) openTrip(t);
  showPage(m[2] || 'plan');
}

/** 여행 열기 (화면 이동 없이 상태만) */
function openTrip(t, { save = false } = {}) {
  leaveShared();
  trip = t;
  store.currentId = t.id;
  if (save) store.trips[t.id] = t;
  ui.openItem = null;
  ui.day = M.todayIndex(t, TODAY);
  ui.focusList = prefs.view === 'list' ? t.days[ui.day]?.id ?? null : null;
  ui.target = null;
  ui.bf = null;
  persist();
  render({ fit: true });
}

function switchTrip(t, { save = false } = {}) {
  openTrip(t, { save });
  go('plan', t.id);
}

function deleteTrip(id) {
  const t = store.trips[id];
  if (!t || !confirm(`"${t.title}" 여행을 삭제할까요? 되돌릴 수 없어요.`)) return;
  delete store.trips[id];
  if (trip?.id === id) {
    trip = null;
    store.currentId = Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;
  }
  persist();
  toast(`"${t.title}"을(를) 삭제했어요`);
  go('home');
}

/** 새 여행: 여행지 좌표를 찾고 만든 뒤 일정 화면으로 */
async function createTripFrom({ destination, title = '', startDate, endDate }, submit) {
  const label = submit?.textContent;
  if (submit) {
    submit.disabled = true;
    submit.textContent = '여행지 찾는 중…';
  }
  let center = null;
  try {
    center = await geocodeDestination(destination);
  } catch {
    /* 여행지 좌표를 못 찾아도 여행은 만든다 */
  }
  if (submit) {
    submit.disabled = false;
    submit.textContent = label;
  }
  const t = M.createTrip({ title, destination: destination.trim(), startDate, endDate, center });
  switchTrip(t, { save: true });
  if (center) map.setView([center.lat, center.lng], 12);
  setTimeout(() => searchEl.focus(), 50);
}

function defaultDates() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const start = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() + 3);
  return [start, d.toISOString().slice(0, 10)];
}

const shortDate = (s) => {
  const d = M.parseDate(s);
  return d ? `${d.getUTCMonth() + 1}.${d.getUTCDate()}` : '';
};

function tripCardHtml(t) {
  const s = M.tripStats(t, TODAY);
  const ended = s.dday.label === '다녀옴';
  const color = dayColor([...(t.destination || t.title)].reduce((h, c) => h + c.charCodeAt(0), 0));
  return `<li class="tcard${ended ? ' ended' : ''}" style="--c:${color}">
      <button class="tc-open" data-open="${t.id}">
        <span class="tc-cover"><span class="tc-dday">${esc(s.dday.label)}</span><span class="tc-dest">${esc(t.destination || '여행')}</span></span>
        <span class="tc-body">
          <b>${esc(t.title)}</b>
          <small>${t.startDate ? `${shortDate(t.startDate)} – ${shortDate(t.endDate)} · ` : ''}${s.length} · ${s.places}곳</small>
        </span>
      </button>
      <button class="icon tc-del" data-del="${t.id}" title="삭제" aria-label="${esc(t.title)} 삭제">✕</button>
    </li>`;
}

function renderHome() {
  const el = $('#page-home');
  const form = $('#homeNew', el);
  const keep = form ? Object.fromEntries(new FormData(form)) : null; // 다시 그려도 입력 중인 값 유지
  const all = Object.values(store.trips);
  const { upcoming, past } = sortedTrips();
  const cities = trends.cities ?? [];
  // 처음엔 다가오는 여행의 도시를 보여준다 (없으면 첫 도시)
  const near = upcoming.map((t) => T.cityByName(cities, t.destination)).find(Boolean);
  ui.homeCity = cities.some((c) => c.id === ui.homeCity) ? ui.homeCity : near?.id ?? cities[0]?.id;
  const city = cities.find((c) => c.id === ui.homeCity);
  const places = city ? T.activePlaces(city, TODAY) : [];
  const [ds, de] = defaultDates();
  el.innerHTML = `<div class="home">
    <section class="home-hero">
      <h1>지도와 일정을 한 화면에.<br><span>설치 없이 공유까지.</span></h1>
      <p>가입 없이 바로 시작하는 해외여행 플래너. 일정은 이 브라우저에 저장돼요.</p>
      <form id="homeNew" class="home-new" autocomplete="off" data-dp-pair="여행 날짜">
        <label class="hn-dest"><span>어디로 떠나요?</span><input name="destination" placeholder="예: 오사카, 다낭, Lisbon" required></label>
        <label class="hn-date"><span>가는 날</span><input type="date" name="startDate" data-dp="start" aria-label="가는 날" required value="${ds}"></label>
        <label class="hn-date"><span>오는 날</span><input type="date" name="endDate" data-dp="end" aria-label="오는 날" required value="${de}"></label>
        <button class="btn primary hn-go">일정 만들기</button>
      </form>
      <div class="dest-chips"><span>많이 가는 곳</span>${POPULAR.map((d) => `<button type="button" data-dest="${esc(d)}">${esc(d)}</button>`).join('')}</div>
    </section>

    ${
      all.length
        ? `<section class="home-sec">
      <div class="sec-head"><h2>내 여행</h2><span class="count">${all.length}개</span></div>
      <ul class="tcards">${upcoming.map(tripCardHtml).join('')}
        <li class="tcard add"><button class="tc-open" data-focus-new><span class="tc-plus">+</span><span class="tc-body"><b>새 여행</b><small>여행지와 날짜만 있으면 돼요</small></span></button></li>
      </ul>
      ${past.length ? `<h3 class="sub-h">다녀온 여행</h3><ul class="tcards">${past.map(tripCardHtml).join('')}</ul>` : ''}
    </section>`
        : ''
    }

    ${
      city
        ? `<section class="home-sec">
      <div class="sec-head"><h2>요즘 뜨는 곳</h2><span class="count">${esc(trends.researchedAt)} 조사</span></div>
      <div class="city-tabs">${cities.map((c) => `<button data-city="${c.id}" class="${c.id === city.id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
      <ul class="insp">${places
        .map(
          (p) => `<li><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span>
            <b>${esc(p.name)}</b><small>${esc(p.area)} · ${esc(p.category)}</small><p>${esc(p.summary)}</p></li>`,
        )
        .join('')}</ul>
      <button class="btn insp-go" data-dest="${esc(city.name)}">${esc(city.name)} 일정 만들기</button>
    </section>`
        : ''
    }

    <section class="home-sec">
      <div class="sec-head"><h2>XenoTravel로 할 수 있는 것</h2></div>
      <ul class="feats">
        <li><b>지도와 일정을 한 화면에</b><p>날짜별 타임라인과 지도 동선을 같이 보고, 끌어서 순서·날짜를 바꿔요.</p></li>
        <li><b>설치 없이 공유</b><p>링크 하나면 친구가 앱 없이 바로 봐요. 원하면 자기 여행으로 저장해 고쳐요.</p></li>
        <li><b>어디든 장소 추가</b><p>한국어 검색, 구글맵 링크 붙여넣기, 지도에서 찍기. 소도시도 빠짐없이.</p></li>
        <li><b>거리 · 걸음 · 길찾기</b><p>장소 사이 도보 시간과 예상 걸음, 누르면 구글맵 길찾기가 열려요.</p></li>
        <li><b>가계부 · 체크리스트</b><p>현지 돈으로 적으면 원화도 같이. 출발 전 할 일, 짐, 쇼핑 리스트까지.</p></li>
        <li><b>전부 무료</b><p>엑셀 · PDF 내보내기, 다크 모드, 백업까지 돈 내는 기능이 없어요.</p></li>
      </ul>
    </section>
    <p class="home-foot">일정·가계부는 이 브라우저에만 저장돼요. 다른 기기로 옮길 땐 백업 파일을 쓰세요 · <button class="linkbtn" data-home="import">백업 파일 불러오기</button></p>
  </div>`;
  if (keep) for (const [k, v] of Object.entries(keep)) if (v) $(`#homeNew [name="${k}"]`).value = v;
  enhanceDates(el);
}

$('#page-home').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]')?.dataset.open;
  const del = e.target.closest('[data-del]')?.dataset.del;
  const dest = e.target.closest('[data-dest]')?.dataset.dest;
  const cityId = e.target.closest('[data-city]')?.dataset.city;
  if (open && store.trips[open]) go('plan', open);
  else if (del) deleteTrip(del);
  else if (dest || e.target.closest('[data-focus-new]')) {
    const input = $('#homeNew [name="destination"]');
    if (dest) input.value = dest;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.focus();
  } else if (cityId) {
    ui.homeCity = cityId;
    renderHome();
  } else if (e.target.closest('[data-home="import"]')) $('#importFile').click();
});
$('#page-home').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  let [startDate, endDate] = [f.startDate.value, f.endDate.value];
  if (endDate < startDate) endDate = startDate;
  createTripFrom({ destination: f.destination.value, startDate, endDate }, $('.hn-go', f));
});
$('#tripsBtn').addEventListener('click', () => go('home'));

/* 상단: 지금 보고 있는 여행 이름 + 다른 여행으로 바꾸기 */
function sortedTrips() {
  const all = Object.values(store.trips);
  const upcoming = all.filter((t) => !t.endDate || t.endDate >= TODAY).sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'));
  const past = all.filter((t) => t.endDate && t.endDate < TODAY).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { upcoming, past };
}

function renderTripSwitcher() {
  $('#curTrip').textContent = trip ? trip.title : '';
  const row = (t) => {
    const dd = M.ddayInfo(t, TODAY);
    const color = dayColor([...(t.destination || t.title)].reduce((h, c) => h + c.charCodeAt(0), 0));
    return `<button class="sw${t.id === trip?.id ? ' on' : ''}${dd.label === '다녀옴' ? ' ended' : ''}" data-sw="${t.id}" style="--c:${color}">
        <span class="sw-dot"></span>
        <span class="sw-main"><b>${esc(t.title)}</b><small>${t.startDate ? `${shortDate(t.startDate)} – ${shortDate(t.endDate)} · ` : ''}${esc(t.destination || '')}</small></span>
        <span class="sw-dday">${esc(dd.label)}</span>
      </button>`;
  };
  const { upcoming, past } = sortedTrips();
  $('#tripSwList').innerHTML = `
    ${upcoming.length ? `<div class="sw-h">다가오는 여행</div>${upcoming.map(row).join('')}` : ''}
    ${past.length ? `<div class="sw-h">다녀온 여행</div>${past.map(row).join('')}` : ''}
    <hr>
    <button data-sw-new>+ 새 여행 만들기</button>
    <button data-sw-home>모든 여행 보기 (홈)</button>`;
}

$('#tripSwList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-sw]')?.dataset.sw;
  $('#tripSw').open = false;
  if (id && store.trips[id]) go(prefs.page === 'home' ? 'plan' : prefs.page, id); // 같은 탭 그대로 다른 여행으로
  else if (e.target.closest('[data-sw-new]')) {
    go('home');
    setTimeout(() => $('#homeNew [name="destination"]')?.focus(), 50);
  } else if (e.target.closest('[data-sw-home]')) go('home');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tripSw')) $('#tripSw').open = false;
});

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
            stay ? `<tr class="stay"><td class="n">숙</td><td class="t">${label}</td><td><strong>${esc(stay.name)}</strong>${stay.address ? `<div class="addr">${esc(stay.address)}</div>` : ''}</td><td class="memo">${esc(stay.memo)}</td></tr>` : '';
          const has = l.items.length || st.start || (l.isDay && dayFlights(i, 'top').length + dayFlights(i, 'bottom').length);
          const flightRows = (where) =>
            dayFlights(i, where)
              .map(({ flight: fl }) => `<tr class="flight"><td class="n">항</td><td class="t">${esc(M.FLIGHT_KINDS[fl.kind])}</td><td><strong>${esc(M.flightSummary(fl))}</strong></td><td class="memo">${esc([fl.bookingRef && `예약번호 ${fl.bookingRef}`, fl.memo].filter(Boolean).join(' / '))}</td></tr>`)
              .join('');
          const rows = flightRows('top') + stayRow(st.start, '출발') + l.items
            .map(
              (it, j) => `<tr><td class="n">${l.isDay ? j + 1 : '•'}</td><td class="t">${esc(it.time)}</td>
                <td><strong>${M.CATEGORIES[it.category]?.icon ?? ''} ${esc(it.name)}</strong>${it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}</td>
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
    const tiles = L.tileLayer(TILES.light[0], TILE_OPTS);
    const loaded = new Promise((resolve) => {
      tiles.once('load', resolve);
      setTimeout(resolve, 8000);
    });
    tiles.addTo(m);
    L.tileLayer(TILES.light[1], { ...TILE_OPTS, attribution: '' }).addTo(m); // 글자는 바탕 위에
    const st = l.isDay ? M.dayStays(trip, Number(div.dataset.day)) : {};
    const pts = (l.isDay ? M.dayRoute(trip, Number(div.dataset.day)) : l.items).map((it) => [it.lat, it.lng]);
    if (l.isDay && pts.length > 1) L.polyline(pts, { color: l.color, weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(m);
    l.items.forEach((it, j) => L.marker([it.lat, it.lng], { icon: pinIcon(l.isDay ? j + 1 : '•', l.color, false) }).addTo(m));
    new Set([st.start, st.end].filter(Boolean)).forEach((s) =>
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="stay-pin">숙소</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(m),
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
/** 모바일: 일정 / 지도 전환 (넓은 화면은 둘 다 보이므로 화면 전환만) */
function showTab(tab) {
  if (prefs.page !== 'plan') showPage('plan');
  const layout = $('.layout');
  if (layout.dataset.tab === tab) return;
  layout.dataset.tab = tab;
  $$('.mtabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'map') setTimeout(() => { map.invalidateSize(); renderMap({ fit: !ui.keepView }); ui.keepView = false; }, 0);
}
$$('.mtabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

let toastTimer;
function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ───────── 날짜 바로가기 · 여행 요약 · 알림 ───────── */
function renderDayTabs() {
  const today = M.indexOfDate(trip, TODAY);
  $('#dayTabs').innerHTML = trip.days
    .map((d, i) => {
      const date = M.parseDate(d.date);
      const md = date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : '';
      return `<button class="daytab${i === ui.day && ui.focusList ? ' on' : ''}" role="tab" data-day="${i}" style="--c:${dayColor(i)}">
          <i></i>Day ${i + 1}${md ? `<small>${md}</small>` : ''}${i === today ? '<span class="today">오늘</span>' : ''}
        </button>`;
    })
    .join('');
}

/** 날짜 고르기: 그날로 스크롤하고, 지도는 그날만 강조하고, 새 장소는 그날에 들어가게 한다. */
function selectDay(i, { scroll = true } = {}) {
  const n = trip.days.length;
  ui.day = ((i % n) + n) % n;
  const id = trip.days[ui.day].id;
  ui.focusList = id;
  if (ui.target !== STAY_TARGET) ui.target = id;
  ui.lastList = id;
  renderTarget();
  renderDays();
  renderMap({ fit: true });
  if (scroll && prefs.view === 'list' && $('.layout').dataset.tab !== 'map') $(`#day-${ui.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 항공편 한 줄: 항공권 앱처럼 "ICN 08:40 ──✈── KIX 10:30" */
function flightRoute(f) {
  const t = (v) => (v ? v.slice(11, 16) : '');
  const d = M.parseDate(f.departAt.slice(0, 10));
  const md = d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '';
  return `<button class="route" data-hero="flights" data-flight="${f.id}" title="항공편 수정">
      <span class="rt-kind">${esc(M.FLIGHT_KINDS[f.kind])}${f.flightNo ? ` · ${esc(f.flightNo)}` : ''}${md ? ` · ${md}` : ''}</span>
      <span class="rt-line">
        <span class="rt-ap"><b>${esc(f.from || '출발')}</b><small>${esc(t(f.departAt))}</small></span>
        <span class="rt-path" aria-hidden="true"><svg class="ic"><use href="#i-plane"/></svg></span>
        <span class="rt-ap"><b>${esc(f.to || '도착')}</b><small>${esc(t(f.arriveAt))}</small></span>
      </span>
    </button>`;
}

function renderHero() {
  const s = M.tripStats(trip, TODAY);
  const dest = (trip.destination || '').trim();
  $('#heroTag').textContent = dest ? `${dest} 여행` : '여행 계획';
  const staysTxt = trip.stays.length ? `${trip.stays[0].name}${trip.stays.length > 1 ? ` 외 ${trip.stays.length - 1}곳` : ''}` : '';
  $('#heroMeta').textContent = [s.length, staysTxt].filter(Boolean).join(' · ');
  const km = s.km >= 10 ? Math.round(s.km) : s.km.toFixed(1);
  $('#heroStats').innerHTML = `
    <div class="tile dday"><span>${esc(s.dday.sub)}</span><b>${esc(s.dday.label)}</b></div>
    <div class="tile"><span>여행 기간</span><b>${s.days}<small>일</small></b></div>
    <div class="tile"><span>들를 곳</span><b>${s.places}<small>곳</small></b></div>
    <div class="tile"><span>이동 (직선)</span><b>${km}<small>km</small></b></div>
    <div class="tile" title="걸어갈 만한 구간(1.2km 이하)만 더한 어림값이에요. 관광지 안에서 걷는 건 빠져 있어요"><span>예상 걸음</span><b>${M.formatSteps(s.steps)}<small>걸음</small></b></div>`;
  const out = trip.flights.find((f) => f.kind === 'out');
  const back = trip.flights.find((f) => f.kind === 'in');
  const flights = [out, ...trip.flights.filter((f) => f.kind === 'move'), back].filter(Boolean);
  $('#heroFlight').innerHTML = flights.length
    ? flights.map(flightRoute).join('')
    : ui.readonly
    ? ''
    : '<button class="route add" data-hero="flights"><span class="rt-kind">항공편</span><span class="rt-add">+ 출국·귀국편 넣기</span></button>';
}

/* ───────── 여행 당일: 오늘 카드 ─────────
 * 여행 기간 중에만 맨 위에 보인다. 현장에서 자주 하는 일(다음 장소 길찾기, 주소 보여주기, 숙소로 가기,
 * 지출 적기, 동행에게 오늘 일정 보내기)을 한두 번 눌러서 하게 한다. 인터넷 없이도 열린다 (길찾기만 인터넷 필요).
 */
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function todayRowHtml(it, n, isNext) {
  const addr = it.address || `${(+it.lat).toFixed(5)}, ${(+it.lng).toFixed(5)}`;
  const memo = String(it.memo ?? '').split('\n')[0];
  return `<li class="td-row${isNext ? ' next' : ''}">
      <span class="td-time">${esc(it.time) || ''}</span>
      <span class="td-num">${n}</span>
      <div class="td-body">
        <b>${esc(it.name)}${isNext ? '<span class="td-next">다음</span>' : ''}</b>
        <small>${esc(addr)}</small>
        ${memo ? `<small class="td-memo">${esc(memo)}</small>` : ''}
      </div>
      <div class="td-acts">
        <button type="button" data-today="copy" data-text="${esc(addr)}" title="주소 복사 (택시 기사에게 보여주기)">주소</button>
        <a href="${M.directionsFromHereUrl(it)}" target="_blank" rel="noopener" title="지금 위치에서 길찾기">길찾기</a>
      </div>
    </li>`;
}

function renderToday() {
  const el = $('#today');
  const p = trip && M.todayPlan(trip, TODAY, nowHHMM());
  el.hidden = !p;
  if (!p) return (el.innerHTML = '');
  const day = trip.days[p.dayIndex];
  const s = p.stay;
  const stayAddr = s ? s.address || s.name : '';
  el.innerHTML = `<div class="td-head">
      <div><span class="td-eyebrow">오늘 · Day ${p.dayIndex + 1}</span><h2>${esc(M.formatDate(day.date))}</h2></div>
      <span class="wx-slot" data-wx="${day.id}">${wxChipHtml(ui.weather.data[day.id], day.id)}</span>
    </div>
    ${
      p.items.length
        ? `<ol class="td-list">${p.items.map((it, i) => todayRowHtml(it, i + 1, it.id === p.nextId)).join('')}</ol>`
        : '<p class="td-empty">오늘은 정한 곳이 없어요.</p>'
    }
    ${
      s
        ? `<div class="td-stay"><div><span>오늘 밤 숙소</span><b>${esc(s.name)}</b>${s.address ? `<small>${esc(s.address)}</small>` : ''}</div>
          <div class="td-acts"><button type="button" data-today="copy" data-text="${esc(stayAddr)}">주소</button><a href="${M.directionsFromHereUrl(s)}" target="_blank" rel="noopener">숙소로 가기</a></div></div>`
        : ''
    }
    <div class="td-foot">
      ${ui.readonly ? '' : '<button type="button" class="btn primary" data-today="expense">지출 적기</button>'}
      <button type="button" class="btn" data-today="share" data-day="${p.dayIndex}">카톡으로 오늘 일정 보내기</button>
    </div>`;
}

$('#today').addEventListener('click', (e) => {
  const b = e.target.closest('[data-today]');
  if (!b) return;
  const act = b.dataset.today;
  if (act === 'copy') copyText(b.dataset.text, '주소를 복사했어요');
  else if (act === 'share') copyText(M.dayShareText(trip, Number(b.dataset.day)), '오늘 일정을 복사했어요. 카톡에 붙여넣으세요');
  else if (act === 'expense') {
    showPage('budget');
    setTimeout(() => $('#bAmount')?.focus(), 50);
  }
});
// 시간이 지나면 "다음" 장소가 바뀐다
setInterval(() => !$('#today').hidden && prefs.page === 'plan' && renderToday(), 60_000);

function renderNotice() {
  const list = ui.readonly ? [] : M.tripNotices(trip);
  const total = trip.budget?.total;
  const plan = total ? C.planned(trip).total : 0;
  if (!ui.readonly && total && plan > total) list.push(`체크리스트 예상(${B.won(plan)})이 예산(${B.won(total)})보다 ${B.won(plan - total)} 많아요`);
  const el = $('#notice');
  el.hidden = !list.length;
  el.innerHTML = list.length ? `<b>확인</b><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}

$('#dayTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (b) selectDay(Number(b.dataset.day));
});
$('#dayPrev').addEventListener('click', () => selectDay(ui.day - 1));
$('#dayNext').addEventListener('click', () => selectDay(ui.day + 1));
$('#heroRoute').addEventListener('click', () => {
  ui.focusList = null;
  renderDays();
  renderMap({ fit: true });
  $('.mapwrap').scrollIntoView({ block: 'center' });
});
$('#heroFlight').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hero="flights"]');
  if (b) openFlights(b.dataset.flight || null);
});

// ←→ 날짜 바꾸기 (입력 중이 아닐 때)
document.addEventListener('keydown', (e) => {
  if (!trip || prefs.page !== 'plan' || prefs.view === 'board' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowLeft') selectDay(ui.day - 1);
  else if (e.key === 'ArrowRight') selectDay(ui.day + 1);
});

/* ───────── 화면(일정·가계부·체크) · 밝기 ───────── */
const PAGES = ['home', 'plan', 'budget', 'check'];
function showPage(page) {
  prefs.page = PAGES.includes(page) && (page === 'home' || trip) ? page : 'home';
  document.body.dataset.page = prefs.page;
  document.body.dataset.hasTrip = trip || store.currentId ? 'yes' : 'no';
  for (const p of PAGES) $(`#page-${p}`).hidden = p !== prefs.page;
  $$('button.pg').forEach((b) => b.classList.toggle('on', b.dataset.page === prefs.page));
  if (prefs.page === 'home') {
    document.title = 'XenoTravel · 가볍게 짜는 해외여행 일정';
    renderHome();
    window.scrollTo({ top: 0 });
    return;
  }
  document.title = `${trip.title} · XenoTravel`;
  renderTripSwitcher();
  if (prefs.page === 'plan') setTimeout(() => map.invalidateSize(), 0);
  if (prefs.page === 'budget') {
    renderBudget();
    const b = trip.budget;
    if (!ui.readonly && b.currency !== 'KRW' && !(b.krwPerUnit > 0)) fetchRate({ quiet: true }); // 처음 열 때 환율 자동으로
  }
  if (prefs.page === 'check') {
    renderChecks();
    renderBadge();
  }
  window.scrollTo({ top: 0 });
}
$$('button.pg').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));

function applyTheme() {
  const t = prefs.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  $('#themeBtn').classList.toggle('active', t === 'light' || t === 'dark');
  $('#themeBtn').title = t === 'dark' ? '어둡게 (누르면 시스템 따라가기)' : t === 'light' ? '밝게 (누르면 어둡게)' : '시스템 따라가기 (누르면 밝게)';
}
$('#themeBtn').addEventListener('click', () => {
  prefs.theme = prefs.theme === 'light' ? 'dark' : prefs.theme === 'dark' ? 'system' : 'light';
  savePrefs();
  applyTheme();
  syncTiles();
});

function renderBadge() {
  const n = trip && Array.isArray(trip.checks) ? C.pendingTodos(trip) : 0;
  for (const b of $$('.check-badge')) {
    b.hidden = !n;
    b.textContent = n;
  }
}

/* ───────── 가계부 ─────────
 * 금액은 현지 통화(또는 원화)로 적고, 적는 순간의 환율로 원화도 같이 저장한다.
 * 돈 기록은 공유 링크에 넣지 않는다 (decodeShare가 일정만 꺼낸다).
 */
const RATE_API = 'https://open.er-api.com/v6/latest/KRW'; // 키 없이 쓰는 무료 환율 (하루 1회 갱신)
ui.bf = null; // 가계부 입력 상태 { cur, cat, pay, day }

function budgetForm() {
  if (!ui.bf || ui.bf.trip !== trip.id) {
    const i = M.indexOfDate(trip, TODAY);
    ui.bf = { trip: trip.id, cur: 'local', cat: 'food', pay: 'card', day: i != null && i >= 0 && i < trip.days.length ? i : -1 };
  }
  return ui.bf;
}

function barRows(map, defs, max) {
  const rows = Object.entries(defs)
    .map(([k, d]) => ({ k, d, v: map[k] ?? 0 }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return '<p class="empty-note">기록이 생기면 보여요</p>';
  return `<div class="bars">${rows
    .map((r) => `<div class="bar-row"><span class="lbl">${r.d.label}</span><span class="bar"><i style="width:${(r.v / max) * 100}%"></i></span><span class="v">${B.won(r.v)}</span></div>`)
    .join('')}</div>`;
}

/** 분류별 계획 대비: 쓴 돈 막대 위에 예상 금액 눈금 */
function planRows(spent, planned) {
  const keys = Object.keys(B.EXPENSE_CATS).filter((k) => spent[k] || planned[k]);
  const max = Math.max(1, ...keys.map((k) => Math.max(spent[k] ?? 0, planned[k] ?? 0)));
  return `<div class="bars">${keys
    .map((k) => {
      const sp = spent[k] ?? 0;
      const pl = planned[k] ?? 0;
      const over = pl && sp > pl;
      return `<div class="bar-row plan-row"><span class="lbl">${B.EXPENSE_CATS[k].label}</span>
        <span class="bar${over ? ' over' : ''}"><i style="width:${(sp / max) * 100}%"></i>${pl ? `<em style="left:${(pl / max) * 100}%"></em>` : ''}</span>
        <span class="v">${B.won(sp)}<small>${pl ? ` / ${B.won(pl)}` : ''}</small></span></div>`;
    })
    .join('')}</div><p class="fine">막대는 쓴 돈, 세로 눈금은 체크리스트 예상이에요.</p>`;
}

function renderBudget() {
  const el = $('#page-budget');
  const b = B.ensureBudget(trip);
  const f = budgetForm();
  const cur = B.CURRENCIES[b.currency];
  const local = b.currency !== 'KRW';
  const useLocal = local && f.cur === 'local';
  const s = B.summarize(trip);
  const plan = C.planned(trip);
  const dayKeys = [-1, ...trip.days.map((_, i) => i)];
  const dayMax = Math.max(1, ...dayKeys.map((k) => s.byDay[k] ?? 0));
  const recs = [...trip.expenses].reverse();
  const dayLabel = (d) => (d < 0 ? '출발 전' : `Day ${d + 1}`);
  el.innerHTML = `<div class="wrap">
    <h1 class="page-h">예산 · 가계부</h1>
    <p class="page-sub">금액만 넣고 기록하면 돼요. 현지 돈으로 적으면 그때 환율로 원화도 같이 저장돼요.</p>
    <div class="grid3 kpis kpis4">
      <label class="kpi"><span>1인 예산 (원)</span><input id="bTotal" inputmode="numeric" value="${b.total ? b.total.toLocaleString('ko-KR') : ''}" placeholder="예: 800,000"></label>
      <button class="kpi plan${b.total && plan.total > b.total ? ' hot' : ''}" data-b="to-check" title="체크리스트에서 가격을 넣으면 여기에 잡혀요">
        <span>예상 (체크리스트)</span><b>${plan.priced ? B.won(plan.total) : '—'}</b>
        <small>${plan.priced ? (b.total && plan.total > b.total ? `예산보다 ${B.won(plan.total - b.total)} 많아요` : `${plan.priced}개 품목 · 가격 고치기 →`) : '체크리스트에 가격 넣기 →'}</small>
      </button>
      <div class="kpi"><span>쓴 돈</span><b>${B.won(s.spent)}</b><small>${trip.expenses.length}건${s.pending.count ? ` · <span class="pend">환율 미정 ${s.pending.count}건 (${esc(B.money(s.pending.amount, b.currency))})</span>` : ''}</small></div>
      <div class="kpi ${s.left < 0 ? 'hot' : 'ok'}"><span>${s.left < 0 ? '예산 초과' : '남은 예산'}</span><b>${b.total ? B.won(Math.abs(s.left)) : '—'}</b><small>${b.total ? `${Math.min(999, Math.round((s.spent / b.total) * 100))}% 사용` : '예산을 넣으면 계산해요'}</small></div>
    </div>

    <div class="box" style="margin-top:14px">
      <div class="amount-row">
        ${local ? `<button class="cur-btn" data-b="cur" title="원화/${cur.name} 바꾸기">${useLocal ? cur.symbol.trim() : '₩'}</button>` : '<span class="cur-btn" style="display:grid;place-items:center">₩</span>'}
        <input id="bAmount" inputmode="decimal" placeholder="0" autocomplete="off">
        <span id="bKrw" class="krw"></span>
        <button class="btn primary" data-b="add">기록</button>
      </div>
      <div class="rate-row">
        <select id="bCurrency" class="inp" aria-label="현지 통화">${Object.entries(B.CURRENCIES)
          .map(([k, c]) => `<option value="${k}"${k === b.currency ? ' selected' : ''}>${k} ${c.name}</option>`)
          .join('')}</select>
        ${
          local
            ? `<span>${cur.unit === 1 ? '1' : cur.unit}${cur.name} =</span>
               <input id="bRate" inputmode="decimal" value="${b.krwPerUnit ? +(b.krwPerUnit * cur.unit).toFixed(2) : ''}" placeholder="환율"> <span>원</span>
               <button class="pill" data-b="rate">오늘 환율 받기</button>
               <span>${b.rateAt ? `${b.rateSource === 'auto' ? '자동' : '직접 입력'} · ${esc(b.rateAt.slice(5, 10).replace('-', '/'))}` : ''}</span>`
            : ''
        }
      </div>
      <div class="chipset">${Object.entries(B.EXPENSE_CATS)
        .map(([k, c]) => `<button class="${f.cat === k ? 'on' : ''}" data-b="cat" data-v="${k}">${c.label}</button>`)
        .join('')}</div>
      <div class="chipset">${Object.entries(B.PAYMENTS)
        .map(([k, c]) => `<button class="${f.pay === k ? 'on' : ''}" data-b="pay" data-v="${k}">${c.label}</button>`)
        .join('')}</div>
      <div class="memo-row">
        <input id="bMemo" placeholder="메모 (선택) · 예: 이치란 라멘" maxlength="80">
        <select id="bDay" class="inp" aria-label="언제">${dayKeys
          .map((k) => `<option value="${k}"${k === f.day ? ' selected' : ''}>${dayLabel(k)}</option>`)
          .join('')}</select>
      </div>
      <p id="bError" class="form-error" hidden></p>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="box"><h3>${plan.priced ? '계획 대비' : '분류별'}</h3>${plan.priced ? planRows(s.byCat, plan.byCat) : barRows(s.byCat, B.EXPENSE_CATS, Math.max(1, ...Object.values(s.byCat)))}</div>
      <div class="box">
        <h3>날짜별</h3>
        <div class="daybars">${dayKeys
          .map((k) => `<div title="${dayLabel(k)} ${B.won(s.byDay[k] ?? 0)}"><i style="height:${((s.byDay[k] ?? 0) / dayMax) * 100}%"></i>${k < 0 ? '전' : `D${k + 1}`}</div>`)
          .join('')}</div>
        <h3 style="margin-top:16px">결제 수단</h3>${barRows(s.byPay, B.PAYMENTS, Math.max(1, ...Object.values(s.byPay)))}
      </div>
    </div>

    <div class="box" style="margin-top:14px">
      <h3>기록 <button class="link" data-b="csv"${recs.length ? '' : ' hidden'}>CSV로 받기</button></h3>
      ${
        recs.length
          ? `<ul class="rec-list">${recs
              .map((e) => {
                const c = B.EXPENSE_CATS[e.cat];
                const pay = B.PAYMENTS[e.pay];
                const orig = e.cur === 'KRW' ? '' : B.money(e.amount, b.currency);
                return `<li>
                  <span class="rec-main"><b>${esc(e.memo || c.label)}</b><small>${dayLabel(e.day)} · ${c.label} · ${pay.label}</small></span>
                  <span class="rec-amt">${e.krw == null ? '<span class="pend">환율 미정</span>' : B.won(e.krw)}${orig ? `<small>${esc(orig)}</small>` : ''}</span>
                  <button class="icon" data-b="del" data-id="${e.id}" title="삭제">✕</button></li>`;
              })
              .join('')}</ul>`
          : '<p class="empty-note">아직 기록이 없어요. 위에서 금액만 넣고 기록을 누르면 돼요.</p>'
      }
    </div>
    <p class="fine">가계부는 이 브라우저에만 저장되고 공유 링크에는 들어가지 않아요. 백업 파일에는 포함돼요. 자동 환율: ExchangeRate-API (하루 1번 갱신).</p>
  </div>`;
  updateKrwPreview();
}

function updateKrwPreview() {
  const amt = Number(String($('#bAmount')?.value ?? '').replace(/,/g, ''));
  const out = $('#bKrw');
  if (!out) return;
  const b = trip.budget;
  const krw = amt > 0 ? B.toKrw(amt, ui.bf.cur === 'local' ? 'local' : 'KRW', b) : null;
  out.textContent = krw != null && b.currency !== 'KRW' && ui.bf.cur === 'local' ? `≈ ${B.won(krw)}` : '';
}

async function fetchRate({ quiet = false } = {}) {
  const b = trip.budget;
  if (b.currency === 'KRW') return;
  try {
    const r = await fetch(RATE_API);
    const data = await r.json();
    const per = data?.rates?.[b.currency];
    if (!(per > 0)) throw new Error('no rate');
    b.krwPerUnit = 1 / per;
    b.rateSource = 'auto';
    b.rateAt = new Date().toISOString();
    const filled = B.fillPendingKrw(trip);
    commit();
    if (filled) toast(`환율을 받아서 환율 미정이던 ${filled}건을 원화로 계산했어요`, 3200);
    else if (!quiet) toast(`환율을 받았어요: ${B.rateLabel(b)}`);
  } catch {
    if (!quiet) toast('환율을 받아오지 못했어요. 직접 입력해 주세요', 3500);
  }
}

function addExpenseFromForm() {
  const b = trip.budget;
  const raw = String($('#bAmount').value).replace(/,/g, '');
  const data = { amount: raw, cur: ui.bf.cur === 'local' && b.currency !== 'KRW' ? 'local' : 'KRW', cat: ui.bf.cat, pay: ui.bf.pay, day: ui.bf.day, memo: $('#bMemo').value };
  const problem = B.expenseProblem(data, b);
  if (problem) {
    const err = $('#bError');
    err.textContent = problem;
    err.hidden = false;
    $('#bAmount').focus();
    return;
  }
  const e = B.addExpense(trip, data);
  commit();
  toast(e.krw == null ? `${B.money(e.amount, b.currency)} 기록했어요. 원화는 환율을 받으면 계산해요` : `${B.won(e.krw)} 기록했어요`, e.krw == null ? 3200 : 2200);
  $('#bAmount')?.focus();
}

$('#page-budget').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-b]');
  if (!btn || !trip) return;
  const f = budgetForm();
  const act = btn.dataset.b;
  if (act === 'cat' || act === 'pay') {
    f[act] = btn.dataset.v;
    $$(`[data-b="${act}"]`, $('#page-budget')).forEach((x) => x.classList.toggle('on', x === btn));
  } else if (act === 'cur') {
    f.cur = f.cur === 'local' ? 'KRW' : 'local';
    btn.textContent = f.cur === 'local' ? B.CURRENCIES[trip.budget.currency].symbol.trim() : '₩';
    updateKrwPreview();
  } else if (act === 'add') addExpenseFromForm();
  else if (act === 'rate') fetchRate();
  else if (act === 'to-check') go('check');
  else if (act === 'del') {
    const e = trip.expenses.find((x) => x.id === btn.dataset.id);
    const linked = e?.checkId && trip.checks?.find((c) => c.id === e.checkId);
    if (confirm(linked ? `이 기록을 지울까요? 체크리스트의 "${linked.text}" 체크도 풀려요.` : '이 기록을 지울까요?')) {
      B.removeExpense(trip, btn.dataset.id);
      if (linked) linked.done = false; // 체크리스트와 맞춘다
      commit();
    }
  } else if (act === 'csv') {
    const blob = new Blob([B.expensesCsv(trip)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${M.safeFileName(trip.title)}-가계부.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
});
$('#page-budget').addEventListener('input', (e) => {
  if (e.target.id === 'bAmount') {
    updateKrwPreview();
    $('#bError').hidden = true;
  }
});
$('#page-budget').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'bAmount' || e.target.id === 'bMemo')) {
    e.preventDefault();
    addExpenseFromForm();
  }
});
$('#page-budget').addEventListener('change', (e) => {
  const b = trip.budget;
  if (e.target.id === 'bTotal') {
    b.total = Math.max(0, Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) || 0));
    commit();
  } else if (e.target.id === 'bRate') {
    const v = Number(e.target.value.replace(/,/g, ''));
    b.krwPerUnit = v > 0 ? v / B.CURRENCIES[b.currency].unit : 0;
    b.rateSource = 'manual';
    b.rateAt = new Date().toISOString();
    const filled = B.fillPendingKrw(trip);
    commit();
    if (filled) toast(`환율 미정이던 ${filled}건을 원화로 계산했어요`);
  } else if (e.target.id === 'bCurrency') {
    b.currency = e.target.value;
    b.krwPerUnit = 0;
    b.rateAt = '';
    commit();
    fetchRate({ quiet: true });
  } else if (e.target.id === 'bDay') {
    budgetForm().day = Number(e.target.value);
  }
});

/* ───────── 체크리스트 ───────── */
/** 나라별 추천 쇼핑 목록 담기 버튼 (아직 안 담은 품목이 있는 목록만) */
function picksHtml() {
  if (ui.readonly) return '';
  return C.shopPickSets(trip)
    .map((set) => {
      const n = C.missingPicks(trip, set).length;
      if (!n) return '';
      return `<button class="picks-btn" data-c="picks" data-set="${esc(set.id)}">${esc(set.title)} ${n}개 담기<small>${esc(set.note || '한국 여행자들이 많이 사는 품목이에요')}</small></button>`;
    })
    .join('');
}

ui.editPrice = null; // 가격을 고치는 중인 체크 항목 id
ui.priceCur = 'local';

/** 체크 항목 가격 표시: "¥1,000" (원화로 적었으면 "₩25,000") */
function priceLabel(c) {
  if (!(c.price > 0)) return '';
  const budget = B.ensureBudget(trip);
  return c.cur === 'KRW' || budget.currency === 'KRW' ? B.won(c.price) : B.money(c.price, budget.currency);
}

function checkRowHtml(c) {
  const budget = B.ensureBudget(trip);
  const local = budget.currency !== 'KRW';
  let price;
  if (ui.editPrice === c.id) {
    const cur = local ? ui.priceCur : 'KRW';
    const sym = cur === 'KRW' ? '₩' : B.CURRENCIES[budget.currency].symbol.trim();
    price = `<form class="price-form" data-id="${c.id}">
        ${local ? `<button type="button" class="cur-mini" data-c="pcur" title="원화/현지 돈 바꾸기">${sym}</button>` : '<span class="cur-mini">₩</span>'}
        <input name="amt" inputmode="decimal" autocomplete="off" placeholder="예상 가격" value="${c.price > 0 ? c.price : ''}">
        <button class="ok">확인</button>
      </form>`;
  } else {
    price = `<button class="price-chip${c.price > 0 ? ' set' : ''}" data-c="price" data-id="${c.id}" title="예상 가격 (가계부 예상에 잡혀요)">${c.price > 0 ? esc(priceLabel(c)) : '+ 가격'}</button>`;
  }
  return `<li class="${c.done ? 'done' : ''}${ui.editPrice === c.id ? ' editing' : ''}">
      <label><input type="checkbox" data-c="toggle" data-id="${c.id}"${c.done ? ' checked' : ''}><span>${esc(c.text)}</span></label>
      ${price}
      <button class="icon" data-c="del" data-id="${c.id}" title="지우기">✕</button>
    </li>`;
}

function renderChecks() {
  const before = JSON.stringify([trip.checksV, trip.checks?.length]);
  C.ensureChecks(trip);
  // 처음 만들었거나 예전 자동 쇼핑 목록을 정리했으면 저장
  if (!ui.readonly && before !== JSON.stringify([trip.checksV, trip.checks.length])) {
    store.trips[trip.id] = trip;
    persist();
  }
  const plan = C.planned(trip);
  $('#page-check').innerHTML = `<div class="wrap">
    <h1 class="page-h">체크리스트</h1>
    <p class="page-sub">항목에 예상 가격을 넣으면 가계부 "예상"에 잡히고, 체크하면 가계부에 실제로 쓴 돈으로 기록돼요. 체크를 풀면 그 기록도 지워져요.</p>
    ${
      plan.priced
        ? `<div class="plan-bar"><span>체크리스트 예상 <b>${B.won(plan.total)}</b>${plan.noRate ? ` <small>(환율이 없어 ${plan.noRate}개 빠짐)</small>` : ''}</span><button class="linkbtn" data-c="to-budget">가계부에서 보기 →</button></div>`
        : ''
    }
    <div class="grid3">${Object.entries(C.CHECK_GROUPS)
      .map(([g, def]) => {
        const p = C.progress(trip, g);
        const list = trip.checks.filter((c) => c.group === g);
        const sum = plan.byGroup[g] ?? 0;
        return `<section class="box">
          <h3 class="check-head">${def.label}<span class="count">${p.done}/${p.total}</span></h3>
          <div class="cprog"><i style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></i></div>
          <ul class="checks">${list.map(checkRowHtml).join('')}</ul>
          ${sum ? `<p class="check-sum">예상 합계 <b>${B.won(sum)}</b></p>` : ''}
          ${g === 'shop' ? picksHtml() : ''}
          <form class="addrow" data-group="${g}"><input name="text" placeholder="${def.placeholder}" maxlength="80" autocomplete="off"><button>추가</button></form>
          ${
            list.length
              ? `<div class="bulk">${p.done ? `<button data-c="del-done" data-group="${g}">체크한 것 삭제 (${p.done})</button>` : ''}<button data-c="clear" data-group="${g}">전체 삭제</button></div>`
              : ''
          }
        </section>`;
      })
      .join('')}</div>
  </div>`;
  if (ui.editPrice) {
    const input = $(`#page-check .price-form[data-id="${ui.editPrice}"] input`);
    input?.focus();
    input?.select();
  }
}

function savePrice(form) {
  const c = C.setPrice(trip, form.dataset.id, form.amt.value, ui.priceCur);
  ui.editPrice = null;
  commit();
  if (c?.price && B.toKrw(c.price, c.cur, trip.budget) == null) toast('가계부에서 환율을 정하면 원화 예상에 잡혀요', 3200);
}

$('#page-check').addEventListener('change', (e) => {
  if (e.target.dataset.c !== 'toggle') return;
  const r = C.toggleCheck(trip, e.target.dataset.id, TODAY);
  commit();
  if (r.expense) toast(r.expense.krw == null ? '가계부에 기록했어요. 원화는 환율을 받으면 계산해요' : `가계부에 ${B.won(r.expense.krw)} 기록했어요`);
  else if (r.removed) toast('체크를 풀어서 가계부 기록도 지웠어요');
});
$('#page-check').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-c="picks"]');
  if (pick) {
    const set = C.shopPickSets(trip).find((x) => x.id === pick.dataset.set);
    const n = C.addPicks(trip, pick.dataset.set);
    commit();
    toast(`${set.title} ${n}개를 쇼핑 리스트에 담았어요`);
    return;
  }
  const btn = e.target.closest('[data-c]');
  if (!btn) return;
  const act = btn.dataset.c;
  const g = btn.dataset.group;
  const label = C.CHECK_GROUPS[g]?.label;
  if (act === 'del') {
    C.removeCheck(trip, btn.dataset.id);
    commit();
  } else if (act === 'price') {
    const c = trip.checks.find((x) => x.id === btn.dataset.id);
    ui.editPrice = btn.dataset.id;
    ui.priceCur = c?.cur ?? (B.ensureBudget(trip).currency === 'KRW' ? 'KRW' : 'local');
    renderChecks();
  } else if (act === 'pcur') {
    ui.priceCur = ui.priceCur === 'KRW' ? 'local' : 'KRW';
    btn.textContent = ui.priceCur === 'KRW' ? '₩' : B.CURRENCIES[trip.budget.currency].symbol.trim();
    btn.nextElementSibling?.focus();
  } else if (act === 'del-done') {
    if (!confirm(`${label}에서 체크한 항목을 지울까요? 가계부에 기록된 금액은 그대로 남아요.`)) return;
    toast(`${C.removeDone(trip, g)}개를 지웠어요`);
    commit();
  } else if (act === 'clear') {
    if (!confirm(`${label}을(를) 전부 지울까요? 되돌릴 수 없어요. 가계부에 기록된 금액은 그대로 남아요.`)) return;
    toast(`${C.clearGroup(trip, g)}개를 지웠어요`);
    commit();
  } else if (act === 'to-budget') go('budget');
});
$('#page-check').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  if (form.classList.contains('price-form')) return savePrice(form);
  if (!C.addCheck(trip, form.dataset.group, form.text.value)) return;
  const g = form.dataset.group;
  commit();
  $(`#page-check form[data-group="${g}"] input`)?.focus();
});
$('#page-check').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.editPrice) {
    ui.editPrice = null;
    renderChecks();
  }
});
// 가격 칸 밖을 누르면 입력한 값으로 저장
$('#page-check').addEventListener('focusout', (e) => {
  const form = e.target.closest('.price-form');
  if (!form || form.contains(e.relatedTarget)) return;
  setTimeout(() => {
    if (ui.editPrice === form.dataset.id && document.contains(form)) savePrice(form);
  }, 0);
});

/* ───────── 공유 링크 ─────────
 * 보내기: 여행을 압축한 코드를 서버에 맡기고 짧은 링크(/s/<id>)를 받는다.
 *   서버 페이지에 제목·요약 미리보기 태그가 들어가서 카톡에서 카드로 보인다.
 *   서버가 없으면(정적 호스팅 등) 코드를 URL # 뒤에 담은 긴 링크로 대신한다.
 * 받기: /s/<id> 또는 #s=… 로 열리면 보기 전용으로 보여주고, 원하면 "내 여행으로 저장"으로 사본을 만든다.
 */
const shareDialog = $('#shareDialog');
const SHARE_PATH = /\/s\/([A-Za-z0-9]{8})\/?$/;
const appBase = () => new URL('./', document.baseURI).href; // /s/<id> 페이지에서도 앱 루트
ui.share = null; // { url, message }

async function createShareUrl(code) {
  try {
    const r = await fetch(new URL('api/share', appBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (r.ok) return new URL((await r.json()).path, appBase()).href;
  } catch {
    /* 서버 없음 → 긴 링크 */
  }
  return shareUrl(appBase(), code);
}

async function openShare() {
  if (!trip) return;
  const { title, line } = shareSummary(trip);
  $('#shareTitle').textContent = title;
  $('#shareLine').textContent = line;
  $('#shareLink').textContent = '링크 만드는 중…';
  $('#shareCopy').disabled = $('#shareNative').disabled = true;
  $('#shareNative').hidden = !navigator.share;
  ui.share = null;
  if (!shareDialog.open) shareDialog.showModal();
  try {
    const url = await createShareUrl(await encodeShare(trip));
    ui.share = { url, title, message: shareMessage(trip, url) };
    $('#shareLink').textContent = url;
    $('#shareLong').hidden = !url.includes('#s=');
    $('#shareCopy').disabled = $('#shareNative').disabled = false;
  } catch {
    $('#shareLink').textContent = '';
    toast('이 브라우저에서는 공유 링크를 만들 수 없어요', 4000);
  }
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    window.prompt('아래 내용을 복사해 주세요', text);
  }
}

$('#shareBtn').addEventListener('click', openShare);
$('#shareCopy').addEventListener('click', () => ui.share && copyText(ui.share.message, '복사했어요. 카톡이나 메신저에 붙여넣으세요'));
$('#shareCopyLink').addEventListener('click', () => ui.share && copyText(ui.share.url, '링크만 복사했어요'));
$('#shareNative').addEventListener('click', () => {
  if (!ui.share) return;
  const { title, line } = shareSummary(trip);
  navigator.share({ title: ui.share.title, text: `${title}\n${line}`, url: ui.share.url }).catch(() => {});
});
$('#shareClose').addEventListener('click', () => shareDialog.close());

function setReadonly(on) {
  ui.readonly = on;
  document.body.classList.toggle('readonly', on);
  $('#sharedBanner').hidden = !on;
}

/** 공유 주소(/s/<id>, #s=…)를 앱 기본 주소로 되돌린다 (새로고침해도 다시 열리지 않게). */
function clearShareAddress() {
  if (SHARE_PATH.test(location.pathname) || shareCodeFromHash(location.hash)) history.replaceState(null, '', appBase());
}

function leaveShared() {
  if (!ui.readonly) return;
  setReadonly(false);
  clearShareAddress();
}

/** 지금 주소의 공유 코드: 짧은 링크면 서버에서 받아 온다. 공유 주소가 아니면 null. */
async function shareCodeFromAddress() {
  const id = SHARE_PATH.exec(location.pathname)?.[1];
  if (!id) return shareCodeFromHash(location.hash);
  const r = await fetch(new URL(`api/share/${id}`, appBase())).catch(() => null);
  if (!r?.ok) throw new Error(r?.status === 404 ? '공유 링크를 찾을 수 없어요. 보낸 사람에게 다시 받아 주세요.' : '공유 일정을 불러오지 못했어요. 잠시 후 다시 열어 주세요.');
  return (await r.json()).code;
}

/** 주소가 공유 링크면 그 일정을 보기 전용으로 연다. 열었으면 true. */
async function openSharedFromAddress() {
  try {
    const code = await shareCodeFromAddress();
    if (!code) return false;
    const shared = await decodeShare(code);
    trip = shared;
    ui.openItem = ui.openStay = null;
    ui.day = 0;
    ui.focusList = null;
    ui.target = null;
    setReadonly(true);
    $('#sharedTitle').textContent = shared.title;
    return true;
  } catch (err) {
    clearShareAddress();
    toast(err.message, 5000);
    return false;
  }
}

$('#sharedSave').addEventListener('click', () => {
  // 받은 일정은 새 id로 사본을 만들어 내 여행에 넣는다 (보낸 사람 일정과 섞이지 않게).
  const copy = { ...trip, id: M.uid(), createdAt: new Date().toISOString() };
  switchTrip(copy, { save: true });
  toast(`"${copy.title}"을(를) 내 여행에 저장했어요. 이제 고칠 수 있어요`, 3000);
});
$('#sharedLeave').addEventListener('click', () => {
  leaveShared();
  trip = null;
  go('home');
});
window.addEventListener('hashchange', async () => {
  if (await openSharedFromAddress()) {
    render({ fit: true });
    showPage('plan');
  } else route();
});

/* ───────── 시작 ───────── */
applyView();
applyTheme();
trip = null; // 주소(#/trip/<id>)를 보고 연다
Promise.all([
  openSharedFromAddress(),
  fetch('data/trends.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((data) => (trends = data))
    .catch(() => toast('트렌드 정보를 불러오지 못했어요')),
]).finally(() => {
  if (ui.readonly) {
    render({ fit: true });
    showPage('plan');
  } else route();
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
    ui.keepView = true;
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
closeOnBackdrop(flightDialog);
closeOnBackdrop(shareDialog);
enhanceDates(document); // 처음부터 있는 날짜 칸 (여행 날짜, 숙소 추가, 항공편)

/* ───────── 오프라인 (PWA) ─────────
 * 서비스 워커가 앱 파일을 저장해서 인터넷 없이도 새로 열린다. 일정·가계부·체크리스트는 원래 이 브라우저에 있다.
 * 인터넷이 끊기면 위에 한 줄로 알려 준다 (지도 바탕·검색·길찾기는 인터넷이 필요).
 */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: './' }).catch(() => {});
}
function syncOnline() {
  const off = !navigator.onLine;
  document.body.classList.toggle('offline', off);
  $('#offlineBar').hidden = !off;
}
addEventListener('online', () => {
  syncOnline();
  toast('다시 인터넷에 연결됐어요');
  // 오프라인에서 현지 돈으로만 적은 지출이 있으면 환율을 받아 원화를 채운다
  if (trip && !ui.readonly && trip.budget && B.pendingKrw(trip).count) fetchRate({ quiet: true });
});
addEventListener('offline', syncOnline);
syncOnline();
