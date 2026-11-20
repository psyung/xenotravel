import * as M from './lib/model.js';
import { parseLocationInput, parseLocationList } from './lib/links.js';
import { searchPlaces, searchPlacesKo, HANGUL, reversePlace, geocodeDestination } from './lib/geo.js';
import { openStore, KEY as STORE_KEY } from './lib/store.js';
import { exportXlsx, downloadJson, downloadCalendar } from './lib/export.js';
import * as T from './lib/trends.js';
import * as B from './lib/budget.js';
import * as C from './lib/checklist.js';
import { encodeShare, decodeShare, shareUrl, shareCodeFromHash, shareSummary, shareMessage, sharedCopy } from './lib/share.js';
import { enhanceDates, refreshDates } from './lib/datepicker.js';
import { enhanceSuggestions } from './lib/suggestions.js';
import { loadWeather, weatherSignature } from './lib/weather.js';
import { t, k, missing as i18nMissing, LANGS, LANG_KEY, getLang, setLang, loadLang, saveLang, locale, num, dayName, shortDate, dateTime, normalizeLang, tripLength, allVersions } from './lib/i18n.js';
import { privacySections } from './lib/privacy.js';

const COLORS = ['#A3432E', '#9C4A28', '#A03754', '#516B53', '#795169', '#576B65', '#82601F', '#626456'];
const INBOX_COLOR = '#868e96';
const TREND_COLOR = '#BF3E26';
const dayColor = (i) => COLORS[i % COLORS.length];
const TODAY = new Date().toISOString().slice(0, 10);
/** 내장 프리셋 문구의 4개 국어 맵 { ko, en, zh, ja } (번역 사전에서 만든다) */
const presetMap = (key) => {
  const [ko, en = ko, zh = ko, ja = ko] = allVersions(key);
  return { ko, en, zh, ja };
};

// 언어: 저장값이 없거나 이상하면 한국어. 저장소를 못 써도 이번 화면에서는 바꾼 언어로 동작한다.
loadLang();

// 화면 설정(보기 방식 등)은 이 브라우저에만 기억한다. 저장소를 못 써도 기본값으로 동작.
const PREF_KEY = 'xenotravel:prefs';
const PREF_DEFAULTS = { view: 'list', mapHidden: false, pinColor: 'day', page: 'plan', theme: 'system' };
const prefs = (() => {
  try {
    return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { ...PREF_DEFAULTS };
  }
})();
// 밝기는 'light' | 'dark' 두 상태만 쓴다. 저장값이 없으면(또는 예전 'system') 지금 기기 설정으로 확정해
// 첫 클릭부터 바로 반대로 바뀌게 한다.
if (prefs.theme !== 'light' && prefs.theme !== 'dark') prefs.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const savePrefs = () => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* 무시 */
  }
};
let trends = { cities: [] };
let trendsI18n = null; // data/trends-i18n.json (트렌드 문구 번역)
/** 트렌드 장소 문구를 지금 언어로. 번역이 없으면 한국어 원문 (original) */
const tp = (p) => T.localizePlace(p, getLang(), trendsI18n);
/** 원문(한국어)을 보여줄 때 언어를 드러낸다 */
const origAttr = (loc) => (loc.original ? ' lang="ko"' : '');
const origTag = (loc) => (loc.original ? ` <small class="orig-tag">${esc(t('한국어 원문'))}</small>` : '');

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
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
};
/** 바탕 + 글자 타일 묶음 */
const tileGroup = (kind) => L.layerGroup([L.tileLayer(TILES[kind][0], TILE_OPTS), L.tileLayer(TILES[kind][1], { ...TILE_OPTS, attribution: '' })]);
const isDark = () => prefs.theme === 'dark';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const debounce = (fn, ms) => {
  let timer;
  const run = (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
};

/* ───────── 번역 (화면에 처음부터 있는 글자) ─────────
 * data-i18n="키" → 글자, data-i18n-attr="aria-label=키;title=키" → 속성. 키는 한국어 원문이다.
 */
function applyStaticI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const i = pair.indexOf('=');
      if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1)));
    }
  }
}
applyStaticI18n();
globalThis.__xenoI18nMissing = i18nMissing; // 브라우저 검사용: 번역이 없어 한국어로 보인 키

const db = openStore();
const store = db.load();
let trip = store.trips[store.currentId] ?? null;
const ui = {
  catFilter: null, // 지도 종류별 보기에서 강조할 종류 (sight|food|cafe|shop|etc|stay)
  openItem: null,
  focusList: null, // 지도에서 강조할 일차 id (null이면 전체)
  target: null, // 장소를 추가할 목록 id
  picking: false,
  results: [],
  activeResult: -1,
  searchAbort: null,
  sortables: [],
  readonly: false, // 공유 링크로 연 일정 (저장·편집하지 않음)
  routePlan: null, // 동선 정리 미리 보기 { listId, dayIndex, current, ids, beforeKm, afterKm, fixed }
  routeUndo: null, // 방금 적용한 동선 정리 되돌리기 { listId, dayIndex, prev, applied, savedKm }
  weather: { sig: '', data: {} }, // 일차 id → 날씨 요약
  saveError: null, // 마지막 저장 실패 ('quota' | 'denied' | 'unavailable')
  homeAlert: null, // 메인에 보여줄 안내 { kind: 'missing' | 'share', message }
};

/* ───────── 지도 ───────── */
const map = L.map('map', { worldCopyJump: true, tapHold: false }).setView([30, 20], 2);
let locationChoice;
const mapDayContext = () => JSON.stringify([trip?.id, ui.focusList, getLang(), trip?.days.map(({ id, date }) => [id, date])]);
map.zoomControl.setPosition('topright');
$('#mapLocate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast(t('이 브라우저에서는 현재 위치를 확인할 수 없어요'));
  map.locate({ setView: true, maxZoom: 16, timeout: 8000 });
});
let locationPoint;
map.on('locationfound', ({ latlng }) => {
  if (locationPoint) locationPoint.setLatLng(latlng);
  else locationPoint = L.circleMarker(latlng, { radius: 7, color: 'var(--paper)', weight: 3, fillColor: 'var(--accent)', fillOpacity: 1, interactive: false }).addTo(map);
});
map.on('locationerror', () => toast(t('현재 위치를 확인하지 못했어요. 브라우저의 위치 권한을 확인해 주세요')));

/** 지도 자체 조작(확대·축소·출처)의 글자도 지금 언어로 */
function mapControlsText() {
  const zc = map.zoomControl;
  for (const [btn, key] of [[zc._zoomInButton, k('확대')], [zc._zoomOutButton, k('축소')]]) {
    if (!btn) continue;
    btn.title = t(key);
    btn.setAttribute('aria-label', t(key));
  }
  map.attributionControl.setPrefix(`<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a> · ${esc(t('검색'))} <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>`);
}
mapControlsText();

/* 지도 바탕 타일. 못 받아오면(차단·오프라인) 지도 위에 알리고 다시 시도할 수 있게 한다. 일정·핀은 그대로 쓴다. */
let baseKind = isDark() ? 'dark' : 'light';
let baseTiles = watchTiles(tileGroup(baseKind)).addTo(map);
function watchTiles(group) {
  let fails = 0;
  for (const layer of group.getLayers()) {
    layer.on('tileerror', () => {
      if (++fails >= 4) $('#tileError').hidden = false;
    });
    layer.on('tileload', () => {
      fails = 0;
      $('#tileError').hidden = true;
    });
  }
  return group;
}
$('#tileRetry').addEventListener('click', () => {
  $('#tileError').hidden = true;
  baseTiles.eachLayer((l) => l.redraw());
});
/**
 * 밝기가 바뀌면 지도 타일만 바꾼다 (지도·핀·위치·확대 단계는 그대로).
 * 새 타일을 위에 먼저 깔고, 다 그려지면 이전 타일을 치운다 (그사이 빈 바탕이 깜빡이지 않게).
 */
function syncTiles() {
  const kind = isDark() ? 'dark' : 'light';
  if (kind === baseKind) return;
  const old = baseTiles;
  baseKind = kind;
  baseTiles = watchTiles(tileGroup(kind)).addTo(map);
  let done = false;
  const drop = () => {
    if (done) return;
    done = true;
    map.removeLayer(old);
  };
  baseTiles.getLayers()[0].once('load', drop);
  setTimeout(drop, 4000);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => withoutTransitions(() => {
  syncTiles();
  syncBrowserTheme();
}));
const layer = L.layerGroup().addTo(map);
const markers = new Map();

function pinIcon(label, color, dim, filter = '') {
  return L.divIcon({
    className: '',
    html: `<div class="pin${dim ? ' dim' : ''}${filter ? ` ${filter}` : ''}${color === 'var(--accent)' ? ' brand-pin' : ''}" style="--c:${color}"><span aria-hidden="true">${esc(label)}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -28],
  });
}

/** 지도 핀 접근성 이름: 번호만 읽히지 않게 일차·순서·장소 이름을 붙인다 */
function labelMarker(m, label) {
  const el = m.getElement();
  if (!el) return;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  el.removeAttribute('title');
  el.title = label;
}

const UNSET_COLOR = '#94a3b8'; // 종류 보기에서 종류를 안 정한 장소
const byCategory = () => prefs.pinColor === 'category';
/** 핀 색: 일차별(동선 선과 같은 색) 또는 종류별(관광·맛집·카페·쇼핑) */
const pinColorOf = (it, listColor) => (byCategory() ? M.CATEGORIES[it.category]?.color ?? UNSET_COLOR : listColor);
const stayPinHtml = () => `<div class="stay-pin${catFilterClass('stay')}"${byCategory() ? ` style="background:${M.STAY_COLOR};border-color:${M.STAY_COLOR};color:#fff"` : ''}><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg></div>`;
/** 종류별 필터: 고른 종류 핀만 또렷하게, 나머지는 흐리게 */
const catFilterClass = (cat) => (byCategory() && ui.catFilter ? (ui.catFilter === cat ? ' cat-on' : ' cat-off') : '');
const catLabel = (k) => (M.CATEGORIES[k] ? t(M.CATEGORIES[k].label) : '');
const catIcon = (it) => {
  const c = M.CATEGORIES[it.category];
  return c ? `<span class="cat-tag" style="--cc:${c.color}">${esc(t(c.label))}</span>` : '';
};

function renderPinLegend() {
  const el = $('#pinLegend');
  el.innerHTML = `<div class="pin-seg" role="group" aria-label="${esc(t('핀 색 기준'))}">
      <button type="button" data-pin="day" aria-pressed="${!byCategory()}" class="${byCategory() ? '' : 'active'}">${esc(t('일차별'))}</button>
      <button type="button" data-pin="category" aria-pressed="${byCategory()}" class="${byCategory() ? 'active' : ''}">${esc(t('종류별'))}</button>
    </div>${
      byCategory()
        ? `<div class="legend" role="group" aria-label="${esc(t('종류별'))}">${[...Object.entries(M.CATEGORIES), ['stay', { label: '숙소', color: M.STAY_COLOR }]]
            .map(([k, c]) => `<button type="button" class="cat-chip${ui.catFilter === k ? ' on' : ''}" data-cat-filter="${k}" aria-pressed="${ui.catFilter === k}" style="--c:${c.color}"><i></i>${esc(t(c.label))}</button>`)
            .join('')}</div>`
        : ''
    }`;
}

function allLists() {
  return [
    ...trip.days.map((d, i) => ({ id: d.id, items: d.items, color: dayColor(i), label: dayName(i), isDay: true })),
    { id: M.INBOX, items: trip.inbox, color: INBOX_COLOR, label: t('보관함'), isDay: false },
  ];
}

function renderMap({ fit = false } = {}) {
  if (locationChoice && locationChoice.context !== mapDayContext()) map.closePopup(locationChoice.popup);
  if (!ui.candidate) $('#mapPlace').hidden = true;
  layer.clearLayers();
  markers.clear();
  if (!trip) return;
  if (trip.days.some((d) => d.id === ui.focusList)) ui.mapLastDay = ui.focusList;
  const bounds = [];
  const plan = currentRoutePlan();
  allLists().forEach((l, dayIndex) => {
    const dim = ui.focusList != null && ui.focusList !== l.id;
    const color = l.isDay && ui.focusList === l.id ? 'var(--accent)' : l.color;
    // 동선 정리 미리 보기 중인 날은 제안 순서로 선과 번호를 그린다 (실선 = 아직 적용 전 제안).
    const preview = plan?.listId === l.id ? plan.ids.map((id) => l.items.find((it) => it.id === id)) : null;
    // 동선: 출발 숙소 → 장소들 → 귀가 숙소
    const { start, end } = l.isDay ? M.dayStays(trip, dayIndex) : {};
    const route = preview ? [start, ...preview, end].filter(Boolean) : l.isDay ? M.dayRoute(trip, dayIndex) : l.items;
    const pts = route.map((it) => [it.lat, it.lng]);
    if (!dim) [start, end].forEach((s) => s && bounds.push([s.lat, s.lng]));
    if (l.isDay && pts.length > 1) {
      L.polyline(pts, { color: 'var(--paper)', weight: 7, opacity: dim ? 0.12 : 0.9, interactive: false }).addTo(layer);
      L.polyline(pts, { color, weight: preview ? 4 : 3, opacity: dim ? 0.18 : 0.95, dashArray: preview ? null : '7 6', interactive: false }).addTo(layer);
    }
    l.items.forEach((it, i) => {
      const n = preview ? preview.indexOf(it) + 1 : i + 1;
      const m = L.marker([it.lat, it.lng], {
        icon: pinIcon(l.isDay ? n : '•', pinColorOf(it, color), dim, catFilterClass(M.CATEGORIES[it.category] ? it.category : 'etc').trim()),
        zIndexOffset: dim ? 0 : 1000,
      }).addTo(layer);
      const detail = [l.label, l.isDay ? t('{n}번째', { n }) : '', it.time].filter(Boolean).join(' · ');
      labelMarker(m, `${it.name} · ${detail}`);
      m.on('click', () => showMapPlace(it, detail, true, m));
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
    const detail = `${t('숙소')} · ${t('{n}박', { n: s.nights })}${checkIn ? ` · ${M.formatDate(checkIn)} ~ ${M.formatDate(checkOut)}` : ''}`;
    labelMarker(m, `${s.name} · ${detail}`);
    m.on('click', () => showMapPlace(s, detail, false, m));
    markers.set(s.id, m);
    if (ui.focusList == null) bounds.push([s.lat, s.lng]);
  }
  renderTrendMarkers();
  renderPinLegend();
  const all = ui.focusList == null;
  $('#showAll').setAttribute('aria-pressed', String(all));
  const date = trip.days[ui.day]?.date;
  $('#mapDayLabel').textContent = `${dayName(ui.day)}${date ? ` · ${shortDate(date)}` : ''}`;
  $('#dayPrev').disabled = ui.day <= 0;
  $('#dayNext').disabled = ui.day >= trip.days.length - 1;
  if (ui.candidate) showCandidate(ui.candidate, { pan: false });
  if (fit) fitTo(bounds);
}

function showMapPlace(item, detail, hasSchedule, marker) {
  const card = $('#mapPlace');
  ui.candidate = null;
  markers.get(card.dataset.item)?.getElement()?.classList.remove('map-pin-selected');
  card.dataset.item = item.id;
  marker.getElement()?.classList.add('map-pin-selected');
  card.innerHTML = `<div><strong>${esc(item.name)}</strong><small>${esc(detail)}</small></div>
    <a href="${M.directionsFromHereUrl(item)}" target="_blank" rel="noopener">${esc(t('길찾기'))}</a>
    ${hasSchedule ? `<button type="button" data-map-item="${esc(item.id)}">${esc(t('일정 보기'))}</button>` : ''}
    <button type="button" data-map-dismiss aria-label="${esc(t('장소 요약 닫기'))}">×</button>`;
  card.hidden = false;
  if (document.activeElement === marker.getElement()) card.querySelector('a').focus({ preventScroll: true });
}

/* 검색 후보 미리 보기: 같은 이름 후보를 지도 위치로 구분한다 */
let candidateMarker = null;
function showCandidate(p, { pan = true } = {}) {
  ui.candidate = p;
  candidateMarker?.remove();
  candidateMarker = L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: '', html: '<div class="cand-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 3000,
    keyboard: false,
    interactive: false,
  }).addTo(map);
  if (pan) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 14));
  const card = $('#mapPlace');
  card.dataset.item = '';
  card.innerHTML = `<div><strong>${esc(p.name)}</strong><small>${esc([p.address, p.region].filter(Boolean).join(' · ') || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}</small></div>
    ${ui.readonly ? '' : `<button type="button" data-cand-add>${esc(t('이 장소 추가'))}</button>`}
    <button type="button" data-cand-back>${esc(t('검색 결과로'))}</button>
    <button type="button" data-map-dismiss aria-label="${esc(t('미리 보기 닫기'))}">×</button>`;
  card.hidden = false;
}
function clearCandidate() {
  ui.candidate = null;
  candidateMarker?.remove();
  candidateMarker = null;
}

$('#mapPlace').addEventListener('click', (e) => {
  const id = e.target.closest('[data-map-item]')?.dataset.mapItem;
  if (id) {
    $('#mapPlace').hidden = true;
    markers.get(id)?.getElement()?.classList.remove('map-pin-selected');
    openItem(id, { scroll: true });
  }
  if (e.target.closest('[data-cand-add]') && ui.candidate) {
    const p = ui.candidate;
    clearCandidate();
    $('#mapPlace').hidden = true;
    addPlace(p);
    return;
  }
  if (e.target.closest('[data-cand-back]')) {
    clearCandidate();
    $('#mapPlace').hidden = true;
    showTab('plan');
    searchEl.focus();
    if (ui.results.length) resultsEl.hidden = false;
    return;
  }
  if (e.target.closest('[data-map-dismiss]')) {
    const card = $('#mapPlace');
    card.hidden = true;
    clearCandidate();
    const marker = markers.get(card.dataset.item)?.getElement();
    marker?.classList.remove('map-pin-selected');
    marker?.focus({ preventScroll: true });
  }
});

function locateMapPlace(item) {
  ui.keepView = $('.layout').dataset.tab !== 'map';
  showTab('map');
  map.setView([item.lat, item.lng], Math.max(map.getZoom(), 16));
  setTimeout(() => markers.get(item.id)?.fire('click'), 0);
}

/* ───────── 트렌드 (요즘 뜨는 곳) ─────────
 * 트렌드 장소 이름·요약은 조사한 원문 자료라 번역하지 않는다 (도시 이름과 상태 문구만 지금 언어로).
 */
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

const placeCount = () => (trip ? trip.days.reduce((n, d) => n + d.items.length, 0) + trip.inbox.length : 0);
/** 요즘 뜨는 곳 펼침: 직접 접거나 펼쳤으면 그대로, 아니면 장소가 없을 때만 펼친다 (장소가 생기면 Day 1이 아래로 밀리지 않게) */
const trendsOpen = () => prefs.view === 'board' || (prefs.trendsUser ?? placeCount() === 0);

function renderTrendMarkers() {
  const city = currentCity();
  if (!city || ui.readonly || (prefs.view === 'list' && !trendsOpen())) return;
  for (const p of T.activePlaces(city, TODAY)) {
    const loc = tp(p);
    const m = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: '<div class="trend-pin" aria-hidden="true">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: -100,
    })
      .bindPopup(
        `<div class="popup-name">${esc(loc.name)}</div>` +
          `<div class="popup-meta">${esc(t('요즘 뜨는 곳'))} · ${esc(T.statusLabel(p, TODAY))}</div>` +
          `<p class="popup-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>` +
          `<button class="popup-add" data-add-trend="${esc(p.id)}">${esc(t('+ 일정에 담기'))}</button>`,
      )
      .addTo(layer);
    labelMarker(m, `${t('요즘 뜨는 곳')}: ${loc.name}`);
  }
}

function trendSectionHtml() {
  const city = currentCity();
  const board = prefs.view === 'board';
  const open = trendsOpen();
  const places = T.activePlaces(city, TODAY);
  const options = [
    city ? '' : `<option value="">${esc(t('도시 선택'))}</option>`,
    ...trends.cities.map((c) => `<option value="${c.id}"${c.id === city?.id ? ' selected' : ''}>${esc(t(c.name))}</option>`),
  ].join('');
  const cards = places
    .map((p) => [p, tp(p)])
    .map(
      ([p, loc]) => `<li class="trend-card" data-trend="${esc(p.id)}">
        <div class="tc-top"><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span><span class="tc-cat">${esc(loc.category)}</span></div>
        <div class="tc-name">${esc(loc.name)}</div>
        <div class="tc-area">${esc(loc.area)}${p.approx ? ` · ${esc(t('대략 위치'))}` : ''}</div>
        <p class="tc-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>
        <div class="tc-foot">
          <span class="tc-src">${esc(t('출처'))} ${p.sources.map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}" aria-label="${esc(t('출처 {n}: {title}', { n: i + 1, title: s.title }))}">${i + 1}</a>`).join(' ')}</span>
          <button class="tc-add" data-action="add-trend" aria-label="${esc(t('{name} 일정에 담기', { name: loc.name }))}">${esc(t('+ 담기'))}</button>
        </div>
      </li>`,
    )
    .join('');
  const body = city
    ? `<p class="trend-note">${esc(t('{date} 조사 · 카드를 끌어서 원하는 날에 놓으세요', { date: trends.researchedAt }))}</p><ul class="trend-list">${cards}</ul>`
    : `<p class="empty-list">${esc(t('이 여행지는 아직 트렌드 정보가 없어요. 지금은 {cities}만 있어요.', { cities: trends.cities.map((c) => t(c.name)).join('·') }))}</p>`;
  return `<section class="day trend-col card" style="--c:${TREND_COLOR}">
    <header class="day-head">
      <button class="day-title" data-action="trend-toggle"${board ? ' disabled' : ` aria-expanded="${open}"`}>
        <span class="dot"></span><strong>${esc(t('요즘 뜨는 곳'))}</strong><span class="count">${city ? esc(t('{n}곳', { n: places.length })) : ''}${board ? '' : open ? ' ▾' : ' ▸'}</span>
      </button>
      <select class="trend-city" aria-label="${esc(t('트렌드 도시'))}">${options}</select>
    </header>
    ${open ? body : ''}
  </section>`;
}

function addTrend(id, listId, index) {
  const found = findTrend(id);
  if (!found) return;
  const local = { ...found.place, ...tp(found.place) };
  if (listId == null) return addPlace(T.trendToPlace(local, t(found.city.name)));
  const item = M.addItem(trip, listId, T.trendToPlace(local, t(found.city.name)));
  M.moveItem(trip, item.id, listId, index);
  if (commit().ok) toast(t('"{name}"을(를) 담았어요', { name: item.name }));
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

$('#pickConfirm').addEventListener('click', () => {
  if (!ui.picking || !trip || ui.readonly) return;
  const latlng = map.wrapLatLng(map.getCenter());
  setPicking(false);
  showLocationChoices(latlng);
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
  if (ui.picking || !trip || ui.readonly || e.touches.length !== 1 || e.target.closest('.leaflet-control, .leaflet-popup, .leaflet-marker-icon')) return;
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
  if (!trip || ui.readonly) return;
  const { lat, lng } = latlng;
  const context = mapDayContext();
  let place = { name: t('선택한 위치'), address: '', lat, lng };
  let dayId = trip.days.some((d) => d.id === ui.focusList) ? ui.focusList : ui.mapLastDay;
  const all = !trip.days.some((d) => d.id === ui.focusList);
  const content = document.createElement('div');
  content.className = 'ctx';
  content.innerHTML = `<div class="popup-name">${esc(place.name)}</div>
    <div class="popup-meta">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    ${all ? `<select aria-label="${esc(t('추가할 날짜 선택'))}">
      <option value="">${esc(t('추가할 날짜 선택'))}</option>
      ${trip.days.map((d, i) => `<option value="${esc(d.id)}">${esc(dayName(i))} · ${esc(shortDate(d.date))}</option>`).join('')}
    </select>` : ''}
    <button class="ctx-btn" data-ctx-add="item"></button>
    <button class="ctx-btn stay" data-ctx-add="stay"></button>
    <small class="ctx-note"></small>`;
  const select = content.querySelector('select');
  const item = content.querySelector('[data-ctx-add="item"]');
  const stay = content.querySelector('[data-ctx-add="stay"]');
  const range = () => {
    const start = trip.days.findIndex((day) => day.id === dayId);
    return { start, nights: start < 0 ? 0 : Math.min(M.DEFAULT_NIGHTS, trip.days.length - 1 - start) };
  };
  function updateActions() {
    const { start, nights } = range();
    item.disabled = start < 0;
    stay.disabled = !nights;
    item.textContent = t('+ 이 위치 추가') + (start < 0 ? '' : ` (${dayName(start)})`);
    stay.textContent = t('숙소로 추가') + (nights ? ` (${t('{day}부터 {n}박', { day: dayName(start), n: nights })})` : '');
    content.querySelector('.ctx-note').textContent = start >= 0 && !nights ? t('이 날짜부터 숙박할 수 없어요') : '';
  }
  if (select) {
    select.value = dayId ?? '';
    if (select.selectedIndex < 0) select.selectedIndex = 0;
    dayId = select.value;
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
  const popupEl = popup.getElement();
  const close = popupEl.querySelector('.leaflet-popup-close-button');
  close?.setAttribute('aria-label', t('닫기'));
  popupEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    map.closePopup(popup);
  });
  popup.once('remove', () => {
    if (locationChoice?.popup === popup) locationChoice = null;
    if (document.activeElement === document.body || content.contains(document.activeElement) || document.activeElement === close) {
      (back instanceof HTMLElement && back !== document.body && back.isConnected ? back : mapEl).focus({ preventScroll: true });
    }
  });
  (select ?? item).focus({ preventScroll: true });
  item.addEventListener('click', () => {
    if (context !== mapDayContext() || range().start < 0) return;
    map.closePopup(popup);
    addPlace(place, { edit: true, listId: dayId });
  });
  stay.addEventListener('click', async () => {
    if (context !== mapDayContext()) return;
    const { start, nights } = range();
    if (!nights) return;
    const overlaps = () => trip.stays.filter((s) => s.startIndex < start + nights && s.startIndex + s.nights > start);
    const conflicts = overlaps();
    if (conflicts.length) {
      const dates = conflicts.map((s) => {
        const { checkIn, checkOut } = M.stayDates(trip, s);
        return `${s.name} (${shortDate(checkIn)} – ${shortDate(checkOut)})`;
      }).join(', ');
      const choice = await ask({
        title: t('겹치는 숙소를 교체할까요?'),
        body: dates,
        actions: [{ value: 'replace', label: t('교체'), danger: true }],
      });
      if (!choice || locationChoice?.popup !== popup || context !== mapDayContext()) return;
      if (JSON.stringify(overlaps()) !== JSON.stringify(conflicts)) return;
      const ids = new Set(conflicts.map((s) => s.id));
      trip.stays = trip.stays.filter((s) => !ids.has(s.id));
    }
    map.closePopup(popup);
    addStayFromOpts(place, { start, nights });
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
  if (!trip) return null;
  const listId = ui.target === STAY_TARGET ? lastListId() : ui.target;
  const items = M.getList(trip, listId) ?? [];
  const di = trip.days.findIndex((d) => d.id === listId);
  const st = di >= 0 ? M.dayStays(trip, di) : {};
  return items.at(-1) ?? st.start ?? st.end ?? trip.center ?? null;
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
  const head = $('.topbar').offsetHeight;
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
  if (cancelled) {
    // 시작 버튼으로 돌아간다 (좁은 화면은 일정 화면에 있다)
    if (pickViewport.matches) showTab('plan');
    $('#pickBtn').focus({ preventScroll: true });
  }
}

/* ───────── 저장 ─────────
 * 바로 저장하고(다른 탭이 그사이 저장했으면 합쳐서), 성공했을 때만 "저장했어요"류 안내를 보여준다.
 * 실패하면 화면의 데이터는 그대로 두고 위에 고정 안내를 띄운다 (다시 저장 · 백업 파일 저장).
 */
const SAVE_ERRORS = {
  quota: k('브라우저 저장 공간이 가득 차서 저장하지 못했어요. 화면의 내용은 그대로 있으니 백업 파일로 저장한 뒤, 오래된 여행이나 다른 사이트 데이터를 지우고 다시 저장해 주세요.'),
  denied: k('이 브라우저에서 저장이 막혀 있어요(시크릿 모드·사이트 데이터 차단 등). 새로고침하면 사라지니 백업 파일로 저장해 주세요.'),
  unavailable: k('이 브라우저에서 저장소를 쓸 수 없어요. 새로고침하면 사라지니 백업 파일로 저장해 주세요.'),
};

function saveNow(choices) {
  persistSoon.cancel();
  if (ui.readonly) return { ok: true, changed: [] };
  const r = db.save(store, { choices });
  afterSave(r);
  return r;
}
const persistSoon = debounce(() => saveNow(), 400); // 입력하는 동안 (이름·메모 등)

function afterSave(r) {
  if (r.ok) {
    if (ui.saveError) {
      ui.saveError = null;
      renderSaveBar();
    }
    if (trip && !ui.readonly && r.changed.includes(trip.id)) {
      const next = store.trips[trip.id];
      if (next) trip = next;
      else {
        trip = null;
        toast(t('다른 탭에서 이 여행을 지웠어요'), 4000);
        go('home');
      }
    }
    return;
  }
  if (r.conflicts) return void resolveConflicts(r.conflicts);
  ui.saveError = r.error;
  renderSaveBar();
}

function renderSaveBar() {
  const corrupt = ui.storeProblem === 'corrupt' || ui.storeProblem === 'partial';
  const text = ui.saveError
    ? t(SAVE_ERRORS[ui.saveError] ?? SAVE_ERRORS.denied)
    : corrupt
      ? t(ui.storeProblem === 'partial'
        ? '저장된 여행 중 일부를 읽지 못해 빼고 열었어요. 읽지 못한 원본은 지우지 않고 따로 보관했어요.'
        : '저장된 데이터를 읽지 못해 빈 상태로 열었어요. 읽지 못한 원본은 지우지 않고 따로 보관했어요.')
      : '';
  $('#saveBar').hidden = !text;
  $('#saveBarText').textContent = text;
  $('#saveRetry').hidden = !ui.saveError;
  $('#saveBackup').hidden = !ui.saveError || !trip || ui.readonly;
  $('#saveCorrupt').hidden = !corrupt || !db.corruptBackup();
}
$('#saveRetry').addEventListener('click', () => {
  const r = saveNow();
  if (r.ok) toast(t('저장했어요'));
});
$('#saveBackup').addEventListener('click', () => saveTripBackup());
$('#saveCorrupt').addEventListener('click', () => {
  const raw = db.corruptBackup();
  if (!raw) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  a.download = 'xenotravel-unreadable-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ui.storeProblem = null;
  renderSaveBar();
});

/** 여행을 바꾼 뒤: 저장하고 다시 그린다. → 저장 결과 { ok, ... } (공유받은 일정은 저장하지 않는다) */
function commit({ fit = false } = {}) {
  if (ui.readonly) {
    render({ fit });
    return { ok: true, changed: [] };
  }
  M.touch(trip);
  store.trips[trip.id] = trip;
  const r = saveNow();
  render({ fit });
  return r;
}

/** 저장 결과에 맞춰 안내: 성공했을 때만 done을 보여준다 */
function saved(r, done, ms) {
  if (r.ok && done) toast(done, ms);
  return r.ok;
}

/* 다른 탭이 저장하면 바로 합쳐서 보여준다 (입력 중인 칸은 그대로) */
addEventListener('storage', (e) => {
  if (e.storageArea && e.storageArea !== localStorage) return;
  if (e.key === LANG_KEY && e.newValue && normalizeLang(e.newValue) !== getLang()) {
    setLang(e.newValue);
    applyLanguage();
    return;
  }
  if (e.key !== STORE_KEY && e.key !== null) return;
  const before = trip;
  const r = saveNow();
  if (r.ok && r.changed.length) {
    if (prefs.page === 'home') renderHome();
    else if (trip && trip === store.trips[trip.id] && (before !== trip || r.changed.includes(trip.id))) {
      render();
      toast(t('다른 탭에서 바꾼 내용을 반영했어요'));
    }
    renderTripSwitcher();
  }
});

/* ───────── 확인 창 ─────────
 * ask({ title, body | html, actions: [{ value, label, primary, danger }], cancel }) → 고른 value | null(취소)
 * 고를 때까지 다른 화면은 그대로 둔다 (입력 중인 값도 지우지 않는다). 닫으면 원래 자리로 포커스를 돌려준다.
 */
const askDialog = $('#askDialog');
let askResolve = null;
function ask({ title, body = '', html = '', actions, cancel = t('취소') }) {
  if (askResolve) askResolve(null);
  const back = document.activeElement;
  $('#askTitle').textContent = title;
  if (html) $('#askBody').innerHTML = html;
  else $('#askBody').textContent = body;
  $('#askActions').innerHTML = [
    cancel ? `<button type="submit" value="" class="btn ghost">${esc(cancel)}</button>` : '',
    ...actions.map((a) => `<button type="submit" value="${esc(a.value)}" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}">${esc(a.label)}</button>`),
  ].join('');
  askDialog.dataset.cancelable = cancel ? '1' : '';
  askDialog.returnValue = '';
  askDialog.showModal();
  ($('#askActions .primary', askDialog) ?? $('#askActions button:last-child', askDialog))?.focus();
  return new Promise((resolve) => {
    askResolve = (v) => {
      askResolve = null;
      if (askDialog.open) askDialog.close();
      if (back?.isConnected) back.focus({ preventScroll: true });
      resolve(v);
    };
  });
}
askDialog.addEventListener('cancel', (e) => {
  if (!askDialog.dataset.cancelable) e.preventDefault(); // 꼭 골라야 하는 창 (저장 충돌)
});
askDialog.addEventListener('close', () => askResolve?.(askDialog.returnValue || null));

/** 저장 충돌: 같은 항목을 다른 탭에서 다르게 바꿨다. 항목마다 어느 쪽을 남길지 고른다 (기본은 이 탭). */
let resolving = false;
async function resolveConflicts(conflicts) {
  if (resolving) return;
  resolving = true;
  const rows = conflicts
    .map((c, i) => `<li class="cf-row"><b>${esc(conflictLabel(c))}</b>
        <label><input type="radio" name="cf${i}" value="local" checked> ${esc(t('이 탭'))}: <span>${esc(conflictValue(c, c.local))}</span></label>
        <label><input type="radio" name="cf${i}" value="remote"> ${esc(t('다른 탭'))}: <span>${esc(conflictValue(c, c.remote))}</span></label></li>`)
    .join('');
  await ask({
    title: t('다른 탭에서 같은 항목을 바꿨어요'),
    html: `<p>${esc(t('두 탭의 다른 변경은 모두 합쳤어요. 아래 항목만 어느 쪽을 남길지 골라 주세요. 지금 입력 중인 내용은 그대로 있어요.'))}</p><ul class="cf-list">${rows}</ul>`,
    actions: [{ value: 'save', label: t('고른 내용으로 저장'), primary: true }],
    cancel: null,
  });
  const choices = {};
  conflicts.forEach((c, i) => (choices[c.key] = askDialog.querySelector(`input[name="cf${i}"]:checked`)?.value ?? 'local'));
  resolving = false;
  const r = saveNow(choices);
  if (r.ok) {
    if (trip && !ui.readonly) trip = store.trips[trip.id] ?? trip;
    if (trip) render();
    else renderHome();
    toast(t('저장했어요'));
  }
}

const LIST_NAMES = { expenses: k('지출'), checks: k('체크 항목'), items: k('장소'), stays: k('숙소'), flights: k('항공편') };
const FIELD_NAMES = { title: k('여행 이름'), destination: k('여행지'), total: k('1인 예산'), currency: k('현지 통화'), krwPerUnit: k('환율'), trendCity: k('트렌드 도시'), amount: k('금액'), memo: k('메모'), text: k('항목'), done: k('체크'), price: k('예상 가격'), name: k('이름'), time: k('시간') };
function conflictLabel(c) {
  const [tripId, ...path] = c.path;
  const tripTitle = (store.trips[tripId] ?? trip)?.title ?? '';
  if (path[0] === '__trip') return t('여행 “{title}” 전체', { title: (c.local ?? c.remote)?.title ?? tripTitle });
  if (path[0] === '__dates') return t('여행 날짜');
  const list = LIST_NAMES[path[0]];
  if (list) {
    const entity = c.local && typeof c.local === 'object' && !path[2] ? c.local : null;
    const id = path[1]?.slice(1);
    const all = [...(trip?.expenses ?? []), ...(trip?.checks ?? []), ...(trip?.stays ?? []), ...(trip?.flights ?? []), ...(trip ? allLists().flatMap((l) => l.items) : [])];
    const x = entity ?? (c.local === null || c.remote === null ? c.local ?? c.remote : all.find((e) => e.id === id));
    const name = x?.memo || x?.text || x?.name || (x?.flightNo ?? '') || '';
    const field = path[2] ? ` · ${t(FIELD_NAMES[path[2]] ?? path[2])}` : '';
    return `${t(list)}${name ? ` “${name}”` : ''}${field}`;
  }
  return t(FIELD_NAMES[path.at(-1)] ?? path.join(' › '));
}
function conflictValue(c, v) {
  if (v === null || v === undefined) return t('삭제됨');
  if (c.path[1] === '__dates') return `${v.startDate} ~ ${v.endDate}`;
  if (typeof v !== 'object') return String(v);
  if ('amount' in v) return `${v.memo ? `${v.memo} · ` : ''}${B.money(v.amount, trip?.budget?.currency ?? 'USD')}`;
  return v.name || v.text || v.title || JSON.stringify(v).slice(0, 60);
}

/* ───────── 렌더링 ───────── */
function render({ fit = false } = {}) {
  if (!trip) {
    document.title = 'XenoTravel';
    $('#days').innerHTML = `<p class="empty-list" style="margin:24px">${esc(t('여행을 먼저 만들어 주세요.'))}</p>`;
    layer.clearLayers();
    document.body.dataset.hasTrip = 'no';
    showPage('home');
    return;
  }
  document.body.dataset.hasTrip = 'yes';
  trip.stays ??= []; // 숙소 기능 이전에 만든 여행
  repairCenter();
  document.title = `${trip.title} · XenoTravel`;
  $('#planHeading').textContent = `${trip.title} · ${t('일정')}`;
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
  if (prefs.page === 'plan') {
    renderPlanEmpty();
    renderDays();
  } else clearPlanDom();
  renderMap({ fit });
  renderBadge();
  renderBackupReminder();
  renderTripSwitcher();
  renderSaveBar();
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
    persistSoon();
  }
}

/**
 * 일정 화면이 아닐 때는 일정 목록·보관함·안내를 DOM에서 비운다.
 * (숨긴 화면의 글자가 어떤 보조기기·도구에서도 가계부·체크리스트 앞에 읽히지 않게. 일정으로 돌아오면 다시 그린다)
 */
function clearPlanDom() {
  ui.sortables.forEach((s) => s.destroy());
  ui.sortables = [];
  for (const id of ['days', 'inboxDock', 'planEmpty', 'dayTabs']) $(`#${id}`).innerHTML = '';
}

/** 장소가 하나도 없는 일정: 첫 장소를 넣는 방법을 눈에 띄게 */
function renderPlanEmpty() {
  const el = $('#planEmpty');
  const show = !ui.readonly && placeCount() === 0 && prefs.page === 'plan';
  el.hidden = !show;
  el.innerHTML = show
    ? `<section class="plan-empty card" aria-labelledby="planEmptyTitle">
        <h2 id="planEmptyTitle">${esc(t('첫 장소를 추가해 보세요'))}</h2>
        <p>${esc(ui.target === STAY_TARGET
          ? t('숙소를 검색하거나 구글맵 링크를 붙여넣으면 숙소로 추가돼요 ({range}). 지도에서 찍을 때는 지도 일차를 사용해요.', { range: stayOptsLabel() })
          : t('장소를 검색하거나 구글맵 링크를 붙여넣으면 {target}에 담겨요. 지도에서 찍을 때는 지도 일차를 사용해요.', { target: targetLabel() }))}</p>
        <div class="plan-empty-actions">
          <button type="button" class="btn primary" data-empty="search">${esc(t('장소 검색하기'))}</button>
          <button type="button" class="btn" data-empty="pick">${esc(t('지도에서 찍기'))}</button>
          <button type="button" class="btn ghost" data-empty="bulk">${esc(t('링크 여러 개 담기'))}</button>
        </div>
      </section>`
    : '';
}
$('#planEmpty').addEventListener('click', (e) => {
  const act = e.target.closest('[data-empty]')?.dataset.empty;
  if (act === 'search') {
    searchEl.focus();
    searchEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (act === 'pick') setPicking(true);
  else if (act === 'bulk') openBulk();
});

const STAY_TARGET = '__stay';

function renderTarget() {
  const lists = allLists();
  if (ui.target !== STAY_TARGET && !lists.some((l) => l.id === ui.target)) ui.target = trip.days[0]?.id ?? M.INBOX;
  $('#target').innerHTML =
    lists
      .map((l, i) => {
        const label = l.isDay ? M.dayTitle(trip.days[i], i) : t('장소 보관함 (날짜 미정)');
        return `<option value="${l.id}"${l.id === ui.target ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('') + `<option value="${STAY_TARGET}"${ui.target === STAY_TARGET ? ' selected' : ''}>${esc(t('숙소로 추가'))}</option>`;
  renderStayOpts();
  renderPlanEmpty(); // 첫 장소 안내도 지금 고른 추가 대상을 따른다
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
  $('#stayNightsLabel').textContent = t('{n}박', { n: ui.stayNights });
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

const listName = (id) => {
  const i = trip.days.findIndex((d) => d.id === id);
  return i === -1 ? t('장소 보관함') : dayName(i);
};

function targetLabel() {
  return listName(ui.target === STAY_TARGET ? lastListId() : ui.target);
}

function stayOptsLabel() {
  const start = ui.target === STAY_TARGET ? ui.stayStart ?? firstUncoveredNight() : firstUncoveredNight();
  const nights = ui.target === STAY_TARGET ? ui.stayNights ?? M.DEFAULT_NIGHTS : M.DEFAULT_NIGHTS;
  return t('{day}부터 {n}박', { day: dayName(start), n: nights });
}

function addStayFromOpts(place, range) {
  const useOpts = ui.target === STAY_TARGET;
  const start = range?.start ?? (useOpts ? ui.stayStart ?? firstUncoveredNight() : firstUncoveredNight());
  const nights = range?.nights ?? (useOpts ? ui.stayNights ?? M.DEFAULT_NIGHTS : M.DEFAULT_NIGHTS);
  const stay = M.addStay(trip, place, start, nights);
  ui.lastAddedId = stay.id;
  const { checkIn, checkOut } = M.stayDates(trip, stay);
  ui.stayStart = Math.min(stay.startIndex + stay.nights, trip.days.length - 1); // 다음 숙소는 이어지는 날부터
  ui.stayNights = null;
  searchEl.value = '';
  hideResults();
  const r = commit();
  map.setView([stay.lat, stay.lng], Math.max(map.getZoom(), 14));
  saved(r, t('숙소 "{name}" {n}박{range}을 추가했어요', {
    name: stay.name,
    n: stay.nights,
    range: checkIn ? ` (${M.formatDate(checkIn)} ~ ${M.formatDate(checkOut)})` : '',
  }), 3000);
}

function stayRowHtml(stay, dayIndex, pos, flags, leg = null) {
  const key = `${stay.id}|${dayIndex}|${pos}`;
  const open = ui.openStay === key;
  const tag = pos === 'start' && flags.checkOut ? t('체크아웃') : pos === 'end' && flags.checkIn ? t('체크인') : '';
  const n = trip.days.length;
  const editor = open && ui.readonly
    ? detailHtml(stay, { stay: true })
    : open
    ? `<div class="editor stay-editor" data-stay="${stay.id}">
        <label>${esc(t('숙소 이름'))}<input data-sfield="name" value="${esc(stay.name)}"></label>
        <div class="stay-range" data-dp-pair="숙소 날짜" data-dp-min-nights="1">
          <label>${esc(t('체크인'))}<input type="date" data-srange="in" data-dp="start" aria-label="체크인" value="${M.dateAtIndex(trip, stay.startIndex)}"
            min="${M.dateAtIndex(trip, 0)}" max="${M.dateAtIndex(trip, n - 1)}"></label>
          <label>${esc(t('체크아웃'))}<input type="date" data-srange="out" data-dp="end" aria-label="체크아웃" value="${M.dateAtIndex(trip, stay.startIndex + stay.nights)}"
            min="${M.dateAtIndex(trip, stay.startIndex + 1)}" max="${M.dateAtIndex(trip, n)}"></label>
          <span class="nights-chip">${esc(t('{n}박', { n: stay.nights }))}</span>
        </div>
        <label>${esc(t('메모'))}<textarea data-sfield="memo" placeholder="${esc(t('예약번호, 체크인 시간…'))}">${esc(stay.memo)}</textarea></label>
        <label>${esc(t('링크'))}<input type="url" data-sfield="url" value="${esc(stay.url)}" placeholder="${esc(t('예약 페이지'))}"></label>
        ${stay.address ? `<p class="addr">${esc(stay.address)}</p>` : ''}
        <div class="editor-actions">
          <a href="${M.googleMapsUrl(stay)}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a>
          <button data-action="stay-delete" data-stay="${stay.id}" class="danger">${esc(t('숙소 삭제'))}</button>
        </div>
      </div>`
    : '';
  return `<div class="tl-row stay">${legHtml(leg)}<div class="tl-time"></div><div class="tl-box">
    <div class="stay-row ${pos}${open ? ' open' : ''}" data-stay="${stay.id}" data-key="${key}">
      <button class="stay-main" data-action="stay-toggle" aria-expanded="${open}">
        <span class="stay-pos">${esc(pos === 'start' ? t('출발') : t('귀가'))}</span>
        <span class="stay-name">${esc(stay.name)}</span>${tag ? `<span class="stay-tag">${esc(tag)}</span>` : ''}
      </button>
      <button class="icon" data-action="stay-locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: stay.name }))}">◎</button>
    </div>${editor}</div></div>`;
}

/** 앞 장소에서 여기까지: "도보 약 12분 · 850m  길찾기" (직선거리 기준 어림값) */
function legHtml(leg) {
  if (!leg) return '';
  const how = leg.mode === 'walking'
    ? t('도보 약 {min}분 · {km}', { min: leg.walkMin, km: M.formatKm(leg.km) })
    : t('{km} · 대중교통', { km: M.formatKm(leg.km) });
  const mode = leg.mode === 'walking' ? t('도보') : t('대중교통');
  return `<a class="leg" href="${leg.url}" target="_blank" rel="noopener"
      title="${esc(t('직선거리 기준 어림값이에요. 누르면 구글맵 길찾기({mode})가 열려요', { mode }))}">
      <span class="leg-how">${esc(how)}</span><span class="leg-go">${esc(t('길찾기'))}</span></a>`;
}

/** 보기 전용(공유받은 일정)에서 편집 창 대신 보여주는 상세 */
function detailHtml(x, { stay = false } = {}) {
  const url = M.safeUrl(x.url);
  const range = stay ? M.stayDates(trip, x) : null;
  return `<div class="editor detail">
      ${stay ? `<p><b>${esc(t('{n}박', { n: x.nights }))}</b>${range.checkIn ? ` · ${esc(M.formatDate(range.checkIn))} ~ ${esc(M.formatDate(range.checkOut))}` : ''}</p>` : ''}
      ${x.memo ? `<p class="memo-text">${esc(x.memo)}</p>` : ''}
      ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>` : ''}
      ${x.address ? `<p class="addr">${esc(x.address)}</p>` : ''}
      <div class="editor-actions"><a href="${M.googleMapsUrl(x)}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a></div>
    </div>`;
}

/* ───────── 장소 비용 ─────────
 * 예정 비용("¥1,200")은 카드 이름 옆에, 결제하면 "결제 ₩10,800"으로 바뀐다. 결제·취소는 편집 창과 오늘 카드에서.
 */
const tripCurrency = () => trip.budget?.currency ?? B.guessCurrency(trip.destination, trip.country);
function costTagHtml(it) {
  const paid = trip.expenses?.length ? B.placeExpense(trip, it.id) : null;
  if (paid) return `<span class="cost-tag paid" title="${esc(t('가계부에 기록됨'))}">${esc(t('결제 {amount}', { amount: paid.krw == null ? B.moneyCode(paid.amount, trip.budget.currency) : B.won(paid.krw) }))}</span>`;
  if (!(it.cost?.price > 0)) return '';
  const code = it.cost.cur === 'KRW' ? 'KRW' : tripCurrency();
  return `<span class="cost-tag" title="${esc(t('예정 비용'))}">${esc(B.moneyCode(it.cost.price, code))}</span>`;
}
const nameHtml = (it) =>
  `<span class="nm">${esc(it.name)}</span>${catIcon(it)}${it.pinned ? `<span class="pin-tag" title="${esc(t('동선 정리할 때 이 자리 그대로'))}">${esc(t('고정'))}</span>` : ''}${costTagHtml(it)}`;

function costEditorHtml(it) {
  const b = trip.budget ?? { currency: tripCurrency() };
  const local = b.currency !== 'KRW';
  const paid = B.placeExpense(trip, it.id);
  const cur = it.cost?.cur ?? 'local';
  return `<div class="cost-row">
      <label>${esc(t('예상 비용'))}<span class="cost-in"><input data-cost="price" inputmode="decimal" value="${it.cost?.price ?? ''}" placeholder="${esc(t('입장료·식사 등'))}">${
        local
          ? `<select data-cost="cur" aria-label="${esc(t('통화'))}"><option value="local"${cur === 'local' ? ' selected' : ''}>${esc(B.CURRENCIES[b.currency]?.symbol ?? '')} ${esc(b.currency)}</option><option value="KRW"${cur === 'KRW' ? ' selected' : ''}>₩ KRW</option></select>`
          : ''
      }</span></label>
      ${
        paid
          ? `<span class="paid-note">${esc(t('가계부에 {amount} 기록됨', { amount: paid.krw == null ? B.moneyCode(paid.amount, b.currency) : B.won(paid.krw) }))} <button type="button" data-action="unpay">${esc(t('결제 취소'))}</button></span>`
          : `<button type="button" class="pay-btn" data-action="pay">${esc(t('결제 완료로 기록'))}</button>`
      }
    </div>`;
}

function itemHtml(it, i, isDay, leg = null, listItems = null) {
  const open = ui.openItem === it.id;
  const sub = esc(it.memo.split('\n')[0] || it.address); // 시간은 타임라인 왼쪽에 따로 보인다
  const pos = listItems ? listItems.indexOf(it) : i;
  const canUp = pos > 0;
  const canDown = listItems ? pos < listItems.length - 1 : false;
  const dayPos = isDay ? trip.days.findIndex((d) => d.items.includes(it)) : -1;
  return `<li class="item${open ? ' open' : ''}${it.visited ? ' visited' : ''}" data-id="${it.id}">
    ${legHtml(leg)}
    <div class="tl-time">${esc(it.time)}</div>
    <div class="tl-box">
    <div class="item-row">
      <span class="drag" title="${esc(t('끌어서 순서·날짜 바꾸기'))}" aria-hidden="true">⋮⋮</span>
      <span class="num"${it.visited ? ` title="${esc(t('다녀왔어요'))}"` : ''} aria-hidden="true">${it.visited ? '✓' : isDay ? i + 1 : '•'}</span>
      <button class="item-main" data-action="toggle" aria-expanded="${open}">
        <span class="sr-only">${isDay ? esc(t('{n}번째', { n: i + 1 })) : ''}${it.visited ? ` · ${esc(t('다녀왔어요'))}` : ''}</span>
        <span class="item-name">${nameHtml(it)}</span>
        <span class="item-sub">${sub}</span>
      </button>
      <button class="icon" data-action="duplicate" title="${esc(t('복제'))}" aria-label="${esc(t('{name} 복제', { name: it.name }))}">⧉</button>
      <button class="icon" data-action="locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: it.name }))}">◎</button>
      ${open ? `<button class="icon collapse" data-action="toggle" title="${esc(t('접기'))}" aria-label="${esc(t('접기'))}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>` : ''}
    </div>
    ${
      open && ui.readonly
        ? detailHtml(it)
        : open
        ? `<div class="editor">
      <label>${esc(t('이름'))}<input data-field="name" value="${esc(it.name)}"></label>
      <div class="cat-pick" role="group" aria-label="${esc(t('종류'))}">${Object.entries(M.CATEGORIES)
        .map(([k, c]) => `<button type="button" data-action="set-cat" data-cat="${k}" aria-pressed="${it.category === k}" class="${it.category === k ? 'on' : ''}" style="--c:${c.color}">${esc(t(c.label))}</button>`)
        .join('')}</div>
      <label>${esc(t('시간'))}<input type="time" data-field="time" value="${esc(it.time)}"></label>
      ${isDay ? `<label class="pin-toggle"><input type="checkbox" data-pin${it.pinned ? ' checked' : ''}> ${esc(t('동선 정리할 때 이 순서 그대로 두기'))} <small>(${esc(t('시간을 정한 곳은 늘 그대로'))})</small></label>` : ''}
      ${isDay ? costEditorHtml(it) : ''}
      <label>${esc(t('메모'))}<textarea data-field="memo" placeholder="${esc(t('영업시간, 예약번호, 꼭 먹을 것…'))}">${esc(it.memo)}</textarea></label>
      <label>${esc(t('링크'))}<input type="url" data-field="url" value="${esc(it.url)}" placeholder="${esc(t('예약 페이지, 블로그 등'))}"></label>
      <div class="order-row" role="group" aria-label="${esc(t('순서 바꾸기'))}">
        <span>${esc(t('순서'))}</span>
        <button type="button" data-action="item-up"${canUp ? '' : ' disabled'} aria-label="${esc(t('{name} 한 칸 위로', { name: it.name }))}">↑ ${esc(t('위로'))}</button>
        <button type="button" data-action="item-down"${canDown ? '' : ' disabled'} aria-label="${esc(t('{name} 한 칸 아래로', { name: it.name }))}">↓ ${esc(t('아래로'))}</button>
        ${isDay ? `<button type="button" data-action="item-prev-day"${dayPos > 0 ? '' : ' disabled'} aria-label="${esc(t('{name} 전날로 옮기기', { name: it.name }))}">← ${esc(t('전날'))}</button>
        <button type="button" data-action="item-next-day"${dayPos >= 0 && dayPos < trip.days.length - 1 ? '' : ' disabled'} aria-label="${esc(t('{name} 다음 날로 옮기기', { name: it.name }))}">${esc(t('다음 날'))} →</button>` : ''}
      </div>
      <label>${esc(t('다른 날로 옮기기'))}<select class="move-to">${moveOptions(listIdOf(it.id), t('옮길 날 고르기'))}</select></label>
      ${it.address ? `<p class="addr">${esc(it.address)}</p>` : ''}
      <div class="editor-actions">
        <a href="${M.googleMapsUrl(it)}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a>
        <span><button data-action="duplicate">${esc(t('복제'))}</button> <button data-action="delete" class="danger">${esc(t('삭제'))}</button></span>
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
      const note = role === 'depart' ? t('출발') : role === 'arrive' ? t('도착') : '';
      const tm = (role === 'arrive' ? f.arriveAt : f.departAt).slice(11, 16);
      return `<div class="tl-row flight"><div class="tl-time">${esc(tm)}</div><div class="tl-box">
        <button class="flight-main" data-action="flight-edit" data-flight="${f.id}" title="${esc(t('항공편 수정'))}">
          <span class="fl-ic" aria-hidden="true"><svg class="ic"><use href="#i-ticket"/></svg></span>
          <span class="fl-kind">${esc(M.flightKind(f.kind))}${note ? ` · ${esc(note)}` : ''}</span>
          <span class="fl-text">${esc(M.flightSummary(f))}</span>
          ${f.bookingRef ? `<span class="fl-ref">${esc(f.bookingRef)}</span>` : ''}
        </button>
      </div></div>`;
    })
    .join('');
}

const flightDialog = $('#flightDialog');
const flightForm = $('#flightForm');
const airports = () => [...$('#airports').content.querySelectorAll('option')].map((o) => ({ value: o.value, detail: t(o.label), keywords: [o.label] }));
for (const input of [$('#flightFrom'), $('#flightTo')]) enhanceSuggestions(input, airports);
ui.editFlight = null;

function openFlights(editId = null) {
  if (!trip) return;
  trip.flights ??= [];
  renderFlightList();
  fillFlightForm(editId ? trip.flights.find((x) => x.id === editId) : null);
  if (!flightDialog.open) showDialog(flightDialog);
}

function renderFlightList() {
  const list = $('#flightList');
  list.hidden = !trip.flights.length;
  list.innerHTML = trip.flights
    .map(
      (f) => `<li class="${ui.editFlight === f.id ? 'current' : ''}">
        <button class="t-open" data-fedit="${f.id}">
          <strong><span class="fl-kind">${esc(M.flightKind(f.kind))}</span> ${esc(M.flightSummary(f))}</strong>
          <span class="t-meta">${esc(M.formatDate(f.departAt.slice(0, 10)))}${f.bookingRef ? ` · ${esc(t('예약번호 {ref}', { ref: f.bookingRef }))}` : ''}${flightOutside(f) ? ` · <b class="warn-text">${esc(t('여행 기간 밖'))}</b>` : ''}</span>
        </button>
        <button class="icon danger" data-fdel="${f.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: M.flightSummary(f) }))}">✕</button>
      </li>`,
    )
    .join('');
}

const flightOutside = (f) => {
  const d = f.departAt.slice(0, 10);
  const a = (f.arriveAt || f.departAt).slice(0, 10);
  return Boolean(trip.startDate) && (a < trip.startDate || d > trip.endDate);
};

function flightFormLabels() {
  $('#flightFormTitle').textContent = ui.editFlight ? t('항공편 수정') : t('항공편 추가');
  $('#flightSubmit').textContent = ui.flightWarned ? t('그래도 저장') : ui.editFlight ? t('저장') : t('추가');
}

/** 수정이면 그 값을, 새로 넣기면 상황에 맞는 기본값(첫 항공편은 출국, 다음은 귀국)을 채운다. */
function fillFlightForm(flight) {
  ui.editFlight = flight?.id ?? null;
  ui.flightWarned = null;
  flightForm.reset();
  $('#flightError').hidden = true;
  $('#flightError').classList.remove('warn');
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
    el.value = v;
  }
  flightFormLabels();
  $('#flightNew').hidden = !flight;
  renderFlightList();
}

flightForm.addEventListener('input', () => {
  if (!ui.flightWarned) return;
  ui.flightWarned = null;
  $('#flightError').hidden = true;
  flightFormLabels();
});
flightForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(flightForm));
  const problem = M.flightProblem(data);
  const err = $('#flightError');
  err.classList.remove('warn');
  for (const el of flightForm.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (problem) {
    // 어느 칸이 문제인지 표시하고 그 칸으로 간다 (입력한 값은 그대로)
    const field = !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.departAt) ? 'departAt' : data.arriveAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.arriveAt) ? 'arriveAt' : !data.from.trim() ? 'from' : 'to';
    const input = flightForm.elements[field];
    input.setAttribute('aria-invalid', 'true');
    const visible = input.type === 'datetime-local' ? input.parentElement.querySelector('.dp-field') ?? input : input;
    visible.setAttribute('aria-invalid', 'true');
    visible.setAttribute('aria-describedby', 'flightError');
    err.textContent = problem;
    err.hidden = false;
    visible.focus();
    visible.scrollIntoView({ block: 'center' });
    return;
  }
  // 날짜 변경선을 넘는 비행은 도착이 출발보다 빠를 수 있다: 한 번 알리고, 다시 누르면 저장
  const warning = M.flightWarning(data);
  const sig = JSON.stringify(data);
  if (warning && ui.flightWarned !== sig) {
    ui.flightWarned = sig;
    err.textContent = `${warning} ${t('날짜 변경선을 넘는 비행이면 그대로 저장하세요.')}`;
    err.classList.add('warn');
    err.hidden = false;
    flightFormLabels();
    return;
  }
  const savedFlight = ui.editFlight ? M.updateFlight(trip, ui.editFlight, data) : M.addFlight(trip, data);
  const r = commit();
  const outside = flightOutside(savedFlight);
  saved(r, outside ? t('저장했어요. 출발일이 여행 기간 밖이라 일정에는 보이지 않아요') : t('{name} 저장했어요', { name: M.flightSummary(savedFlight) }), outside ? 4000 : 2200);
  fillFlightForm(null);
});
$('#flightList').addEventListener('click', async (e) => {
  const editId = e.target.closest('[data-fedit]')?.dataset.fedit;
  const delId = e.target.closest('[data-fdel]')?.dataset.fdel;
  if (editId) fillFlightForm(trip.flights.find((x) => x.id === editId));
  if (delId && confirm(t('이 항공편을 삭제할까요?'))) {
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
  const inbox = currentListId === M.INBOX ? '' : `<option value="${M.INBOX}">${esc(t('장소 보관함'))}</option>`;
  return `<option value="">${esc(placeholder)}</option>${days}${inbox}`;
}

function moveToList(itemId, listId) {
  const found = M.findItem(trip, itemId);
  if (!found || !listId || !M.moveItem(trip, itemId, listId, Infinity)) return;
  ui.openItem = null;
  saved(commit(), t('"{name}" → {list}(으)로 옮겼어요', { name: found.item.name, list: listName(listId) }));
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
  dock.classList.toggle('is-empty', !items.length);
  const open = prefs.dockOpen !== false;
  const cards = items
    .map(
      (it) => `<li class="item dock-card" data-id="${it.id}" style="--c:${INBOX_COLOR}">
        <div class="dock-top">
          <span class="drag" title="${esc(t('끌어서 원하는 날에 놓기'))}" aria-hidden="true">⋮⋮</span>
          <div class="dock-text">
            <span class="item-name"><span class="nm">${esc(it.name)}</span>${catIcon(it)}</span>
            <span class="item-sub">${esc(it.memo.split('\n')[0] || it.address)}</span>
          </div>
          <button class="icon" data-action="locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: it.name }))}">◎</button>
          <button class="icon" data-action="delete" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: it.name }))}">✕</button>
        </div>
        <select class="move-to" aria-label="${esc(t('{name} 보낼 날', { name: it.name }))}">${moveOptions(M.INBOX, t('보낼 날 →'))}</select>
      </li>`,
    )
    .join('');
  dock.innerHTML = `<div class="dock-head">
      <button class="dock-toggle" data-action="dock-toggle" aria-expanded="${open}">
        <span class="dot" style="--c:${INBOX_COLOR}"></span><strong>${esc(t('장소 보관함'))}</strong>
        <span class="count">${esc(t('{n}곳', { n: items.length }))}</span><span class="chev">${esc(open ? t('접기 ▾') : t('펼치기 ▴'))}</span>
      </button>
      ${open ? `<span class="dock-hint">${esc(items.length ? t('끌어서 원하는 날에 놓거나, 보낼 날을 고르세요') : t('가고 싶은 곳을 날짜 없이 모아두는 곳이에요'))}</span>` : ''}
    </div>
    ${
      open
        ? `<ol class="items dock-items" data-list="${M.INBOX}" data-empty="${esc(t('여기로 끌어오거나, 추가할 곳을 장소 보관함으로 고르세요'))}">${cards}</ol>`
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
      <ol class="items" data-list="${l.id}" data-empty="${esc(ui.readonly ? t('아직 정한 곳이 없어요') : t('장소를 검색하거나 여기로 끌어오세요'))}">${l.items.map((it, j) => itemHtml(it, j, true, legTo(off + j), l.items)).join('')}</ol>
      ${st.end ? stayRowHtml(st.end, l.dayIndex, 'end', st, legTo(route.length - 1)) : ''}
      ${flightRowsHtml(l.dayIndex, 'bottom')}
    </div>`;
}

function dayToolsHtml(l) {
  const st = M.dayStays(trip, l.dayIndex);
  const url = M.routeDirectionsUrl(M.dayRoute(trip, l.dayIndex));
  const link = url ? `<a class="route-link" href="${url}" target="_blank" rel="noopener" title="${esc(t('이 날 동선 전체를 구글맵 길찾기로 열기'))}">${esc(t('길찾기'))}</a>` : '';
  const copy = `<button data-action="day-copy" data-day="${l.dayIndex}" title="${esc(t('이 날 일정을 카톡에 붙일 글로 복사해요'))}">${esc(t('카톡용 복사'))}</button>`;
  const route = link + copy;
  if (ui.readonly) return route;
  const movable = l.items.filter((it) => !it.time && !it.pinned).length;
  return `${route}${st.end ? '' : `<button data-action="stay-here" data-day="${l.dayIndex}" title="${esc(t('이 날부터 묵을 숙소 추가'))}">${esc(t('+ 숙소'))}</button>`}${
    movable > 1 ? `<button data-action="route-opt" data-list="${l.id}" title="${esc(t('숙소 기준으로 덜 돌아가는 순서를 찾아요. 시간을 정한 장소는 그대로 둬요'))}">${esc(t('동선 정리'))}</button>` : ''
  }${l.items.length > 1 ? `<button data-action="sort-time" data-list="${l.id}">${esc(t('시간순'))}</button>` : ''}${
    trip.days.length > 1
      ? `<span class="swap-wrap"><span class="swap-label" aria-hidden="true">${esc(t('다른 날과 바꾸기'))}</span><select class="day-swap" data-day="${l.dayIndex}" aria-label="${esc(t('이 날 장소를 다른 날과 통째로 바꾸기'))}" title="${esc(t('이 날 장소를 다른 날과 통째로 바꿔요 (날짜·숙소·항공편은 그대로)'))}"><option value="">${esc(t('다른 날과 바꾸기'))}</option>${trip.days
          .map((d, i) => (i === l.dayIndex ? '' : `<option value="${i}">${esc(dayName(i))}${d.date ? ` · ${esc(M.formatDate(d.date))}` : ''}</option>`))
          .join('')}</select></span>`
      : ''
  }`;
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
    const from = w.forecastFrom ? t('{date}부터', { date: shortDate(w.forecastFrom) }) : '';
    const open = ui.wxRefOpen?.has(dayId) && w.ref;
    return `<button type="button" class="chip wx wx-ref" data-action="wx-ref" data-day-id="${dayId}" aria-expanded="${Boolean(open)}" title="${esc(t('예보는 여행 16일 전부터 나와요'))}${w.ref ? esc(`. ${t('누르면 작년 같은 날 날씨를 보여줘요')}`) : ''}"${w.ref ? '' : ' disabled'}>
        ${esc(t('예보 전'))}${from ? ` · ${esc(from)}` : ''}${open ? ` <span class="wx-last">${esc(t('작년 이맘때'))} ${esc(t(w.ref.text))} <b>${esc(w.ref.temp)}</b></span>` : ''}</button>`;
  }
  const icon = `<svg class="wx-ic" viewBox="0 0 24 24" aria-hidden="true">${WX_ICONS[w.icon] ?? WX_ICONS.cloud}</svg>`;
  const rain = w.prob != null && w.prob >= 20 ? `<em>${esc(t('비 {p}%', { p: w.prob }))}</em>` : '';
  return `<span class="chip wx wx-${w.icon}${w.wet ? ' wx-wet' : ''}" title="${esc(t(w.title))}">${icon}${esc(t(w.text))} <b>${esc(w.temp)}</b>${rain}</span>`;
}

function wxHintHtml(w) {
  if (!w?.wet) return '';
  const what = w.icon === 'snow' ? t('눈') : t('비');
  return `<p class="wx-hint">${esc(t('{what} 소식이 있어요{prob}. 실내 장소 위주로 짜거나 우산을 챙기세요', { what, prob: w.prob != null ? ` (${what} ${w.prob}%)` : '' }))}</p>`;
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
 * 버튼 → 제안 계산(미리 보기) → 카드 안에서 순서를 직접 고칠 수 있다(끌기 · ↑↓) → 적용을 눌러야 일정이 바뀐다.
 * 고치는 동안은 카드 안의 임시 순서일 뿐이고, 취소·닫기는 원래 순서와 저장 상태를 그대로 둔다.
 * 그사이 그날 장소가 바뀌면 제안은 버리고 알려 준다.
 */
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const dayIds = (dayIndex) => trip.days[dayIndex]?.items.map((it) => it.id) ?? [];

function currentRoutePlan() {
  const p = ui.routePlan;
  if (p && (trip.days[p.dayIndex]?.id !== p.listId || !sameIds(dayIds(p.dayIndex), p.current))) {
    ui.routePlan = null;
    setTimeout(() => toast(t('일정이 바뀌어서 동선 정리 제안을 닫았어요. 다시 눌러 계산해 주세요'), 3500), 0);
  }
  return ui.routePlan;
}

function currentRouteUndo() {
  const u = ui.routeUndo;
  if (u && (trip.days[u.dayIndex]?.id !== u.listId || !sameIds(dayIds(u.dayIndex), u.applied))) ui.routeUndo = null;
  return ui.routeUndo;
}

/** 제안 순서의 장소들 */
const planItems = (p) => {
  const byId = new Map(trip.days[p.dayIndex].items.map((it) => [it.id, it]));
  return p.ids.map((id) => byId.get(id));
};
/** 기존 제안과 같은 규칙(출발 숙소 → 장소들 → 귀가 숙소 직선거리 합)으로 거리 계산 */
function planKm(p) {
  const { start, end } = M.dayStays(trip, p.dayIndex);
  return M.pathKm([start, ...planItems(p), end]);
}

function proposeRoute(listId) {
  const dayIndex = trip.days.findIndex((d) => d.id === listId);
  const r = M.optimizeDay(trip, dayIndex);
  if (!r) return;
  if (!r.changed) {
    ui.routePlan = null;
    toast(r.fixed ? t('시간을 정했거나 고정한 곳을 그대로 두면 지금 순서가 가장 짧아요') : t('지금 순서가 이미 가장 짧아요'));
    return;
  }
  ui.routePlan = { listId, dayIndex, current: dayIds(dayIndex), ids: r.items.map((it) => it.id), beforeKm: r.beforeKm, afterKm: r.afterKm, fixed: r.fixed };
  ui.routeUndo = null;
  ui.focusList = listId;
  ui.day = dayIndex;
  renderDays();
  renderMap({ fit: true });
  $(`#day-${dayIndex} .route-plan`)?.focus({ preventScroll: true });
}

/** 제안 카드 안에서 순서 바꾸기 (임시 상태). 바뀔 때마다 순번·거리·지도 미리 보기를 바로 다시 그린다. */
function updatePlanOrder(ids, { focus } = {}) {
  const p = currentRoutePlan();
  if (!p) return;
  p.ids = ids;
  p.afterKm = planKm(p);
  renderDays();
  renderMap();
  if (focus) {
    const row = $(`.route-plan [data-rp="${CSS.escape(focus.id)}"]`);
    const btn = row?.querySelector(`[data-dir="${focus.dir}"]`);
    (btn && !btn.disabled ? btn : row?.querySelector('[data-dir]:not(:disabled)') ?? row)?.focus({ preventScroll: true });
    const it = planItems(p).find((x) => x.id === focus.id);
    const n = p.ids.indexOf(focus.id) + 1;
    $('#rpStatus').textContent = t('{name}: {n}번째 · 예상 {km}', { name: it?.name ?? '', n, km: M.formatKm(p.afterKm) });
  }
}

function moveInPlan(id, dir) {
  const p = currentRoutePlan();
  if (!p) return;
  const order = planItems(p);
  const next = M.routeStep(order, p.ids.indexOf(id), dir);
  if (next) updatePlanOrder(next.map((it) => it.id), { focus: { id, dir } });
}

function applyRoute() {
  const p = currentRoutePlan();
  if (!p) return;
  if (!M.applyDayOrder(trip, p.dayIndex, p.ids)) {
    ui.routePlan = null;
    return toast(t('그사이 장소가 바뀌어서 다시 계산해 주세요'));
  }
  const unchanged = sameIds(p.ids, p.current);
  ui.routeUndo = unchanged ? null : { listId: p.listId, dayIndex: p.dayIndex, prev: p.current, applied: p.ids, savedKm: p.beforeKm - p.afterKm };
  ui.routePlan = null;
  saved(commit(), unchanged ? t('순서는 그대로예요') : '');
}

function undoRoute() {
  const u = currentRouteUndo();
  if (!u) return;
  M.applyDayOrder(trip, u.dayIndex, u.prev);
  ui.routeUndo = null;
  saved(commit(), t('원래 순서로 되돌렸어요'));
}

function kmChange(diff) {
  if (diff > 0.01) return t('이동 거리가 {km} 줄어요', { km: M.formatKm(diff) });
  if (diff < -0.01) return t('이동 거리가 {km} 늘어요', { km: M.formatKm(-diff) });
  return t('이동 거리는 지금과 같아요');
}

function routePlanHtml(l) {
  const plan = currentRoutePlan();
  if (plan?.listId === l.id) {
    const order = planItems(plan);
    const rows = order
      .map((it, i) => {
        const fixed = M.isFixedInRoute(it);
        const moved = plan.current[i] !== it.id;
        const up = M.routeStepTarget(order, i, -1) !== -1;
        const down = M.routeStepTarget(order, i, 1) !== -1;
        return `<li class="rp-row${fixed ? ' fixed' : moved ? ' moved' : ''}" data-rp="${esc(it.id)}"${fixed ? '' : ' tabindex="-1"'}>
          ${fixed ? '<span class="rp-drag off" aria-hidden="true"></span>' : `<span class="rp-drag" aria-hidden="true" title="${esc(t('끌어서 순서 바꾸기'))}">⋮⋮</span>`}
          <span class="rp-num">${i + 1}</span><span class="rp-name">${esc(it.name)}</span>${
            it.time ? `<span class="rp-tag">${esc(t('{time} 고정', { time: it.time }))}</span>` : it.pinned ? `<span class="rp-tag">${esc(t('자리 고정'))}</span>` : ''
          }
          ${fixed ? '' : `<span class="rp-move">
            <button type="button" data-action="rp-move" data-dir="-1"${up ? '' : ' disabled'} aria-label="${esc(t('{name} 위로 이동', { name: it.name }))}">↑</button>
            <button type="button" data-action="rp-move" data-dir="1"${down ? '' : ' disabled'} aria-label="${esc(t('{name} 아래로 이동', { name: it.name }))}">↓</button>
          </span>`}
        </li>`;
      })
      .join('');
    return `<div class="route-plan" role="region" tabindex="-1" aria-label="${esc(t('동선 정리 제안'))}">
        <div class="rp-head">
          <strong>${esc(t('동선 정리 제안'))}</strong>
          <span class="rp-km">${M.formatKm(plan.beforeKm)} → <b>${M.formatKm(plan.afterKm)}</b></span>
        </div>
        <p class="rp-sub">${esc(kmChange(plan.beforeKm - plan.afterKm))}. ${esc(t('숙소 기준 직선거리로 계산했어요'))}${plan.fixed ? ` · ${esc(t('시간을 정했거나 고정한 {n}곳은 그대로 둬요', { n: plan.fixed }))}` : ''}. ${esc(t('끌거나 ↑↓로 순서를 직접 고칠 수 있어요.'))}</p>
        <ol class="rp-list">${rows}</ol>
        <p id="rpStatus" class="sr-only" role="status"></p>
        <div class="rp-actions">
          <button class="btn" data-action="route-cancel">${esc(t('취소'))}</button>
          <button class="btn primary" data-action="route-apply">${esc(t('이 순서로 바꾸기'))}</button>
        </div>
      </div>`;
  }
  const undo = currentRouteUndo();
  if (undo?.listId === l.id) {
    return `<div class="route-done"><span>${esc(t('동선을 바꿨어요 · {change}', { change: kmChange(undo.savedKm) }))}</span><button data-action="route-undo">${esc(t('되돌리기'))}</button></div>`;
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
    sum.places ? `<span class="chip">${esc(t('{n}곳', { n: sum.places }))}</span>` : '',
    sum.km >= 0.05 ? `<span class="chip">${esc(t('이동 {km}', { km: M.formatKm(sum.km) }))}</span>` : '',
    sum.from ? `<span class="chip">${esc(sum.from)}${sum.to !== sum.from ? ` – ${esc(sum.to)}` : ''}</span>` : '',
    st.end ? `<span class="chip stay">${esc(t('숙소 {name}', { name: st.end.name }))}</span>` : '',
  ].join('');
  return `<section id="day-${l.dayIndex}" class="day daycard card${ui.focusList === l.id ? ' is-focus' : ''}" style="--c:${l.color}" aria-label="${esc(M.dayTitle(trip.days[l.dayIndex], l.dayIndex))}">
      <div class="dc-head">
        <button class="dc-title-btn" data-action="focus" data-list="${l.id}" title="${esc(t('지도에서 이 날만 보기'))}">
          <span class="dc-meta"><span class="dot"></span>${esc(dayName(l.dayIndex))}${date ? `<small>${esc(date)}</small>` : ''}</span>
          <span class="dc-title${sum.title ? '' : ' empty'}">${sum.title ? esc(sum.title) : esc(t('아직 비어 있는 날'))}</span>
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

  // 동선 정리 제안 카드: 끌어서 순서 바꾸기 (고정 장소는 제자리)
  const rp = $('.rp-list', daysEl);
  if (rp) {
    ui.sortables.push(
      new Sortable(rp, {
        handle: '.rp-drag:not(.off)',
        filter: '.fixed',
        preventOnFilter: false,
        animation: 150,
        ghostClass: 'ghost-item',
        onEnd: (e) => {
          const p = currentRoutePlan();
          if (!p || e.oldIndex === e.newIndex) return;
          const byId = new Map(planItems(p).map((it) => [it.id, it]));
          const dragged = $$('[data-rp]', rp).map((li) => byId.get(li.dataset.rp));
          updatePlanOrder(M.routeReorder(planItems(p), dragged).map((it) => it.id), { focus: { id: e.item.dataset.rp, dir: 0 } });
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

/* ───────── 펼친 장소 카드: 바깥을 탭하면 접기 ─────────
 * 지도·팝업·대화상자·날짜 선택 창은 제외하고, 8px 넘게 움직인 터치(스크롤)는 탭으로 보지 않는다.
 */
const OUTSIDE_SAFE = '#map, .mapwrap, .leaflet-container, .leaflet-popup, dialog, .dp-pop, .menu, .tripsw, .toast, .ctx';
let cardTap = null;
document.addEventListener('pointerdown', (e) => {
  cardTap = ui.openItem || ui.openStay ? { x: e.clientX, y: e.clientY, target: e.target } : null;
}, true);
document.addEventListener('pointermove', (e) => {
  if (cardTap && Math.hypot(e.clientX - cardTap.x, e.clientY - cardTap.y) >= 8) cardTap = null;
}, true);
document.addEventListener('pointercancel', () => (cardTap = null), true);
document.addEventListener('pointerup', (e) => {
  const tap = cardTap;
  cardTap = null;
  if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 8) return;
  const target = tap.target;
  if (!(target instanceof Element) || !document.contains(target)) return;
  if (target.closest(OUTSIDE_SAFE)) return;
  const card = ui.openItem
    ? $(`.item[data-id="${CSS.escape(ui.openItem)}"]`)
    : $(`.stay-row[data-key="${CSS.escape(ui.openStay)}"]`)?.closest('.tl-row');
  if (!card || card.contains(target)) return;
  // 입력 중인 칸이 카드 안에 있으면 (키보드가 떠 있는 상태 등) 닫지 않는다
  const active = document.activeElement;
  if (active && card.contains(active) && active.matches('select, input[type="time"], input[type="date"]') && target === document.documentElement) return;
  const item = ui.openItem;
  const stay = ui.openStay;
  // 다른 카드 열기 등 클릭 처리가 먼저 끝나게 한 박자 늦게 접는다
  setTimeout(() => {
    if (ui.openItem !== item || ui.openStay !== stay) return;
    ui.openItem = null;
    ui.openStay = null;
    renderDays();
  });
}, true);

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
    $(`.item[data-id="${CSS.escape(id)}"] .item-main`)?.focus({ preventScroll: true });
  } else if (action === 'locate') {
    const found = M.findItem(trip, id);
    if (!found) return;
    locateMapPlace(found.item);
  } else if (action === 'delete') {
    const found = M.findItem(trip, id);
    if (found && confirm(t('"{name}"을(를) 삭제할까요?', { name: found.item.name }))) {
      M.removeItem(trip, id);
      ui.openItem = null;
      commit();
    }
  } else if (action === 'item-prev-day' || action === 'item-next-day') {
    // 하루 앞뒤로 원탭 이동 (그날 맨 끝에 넣는다)
    const found = M.findItem(trip, id);
    const di = trip.days.findIndex((d) => d.id === found?.listId);
    const to = trip.days[di + (action === 'item-prev-day' ? -1 : 1)];
    if (!found || !to) return;
    M.moveItem(trip, id, to.id, Infinity);
    ui.openItem = id;
    const r = commit();
    ($(`.item[data-id="${CSS.escape(id)}"] [data-action="${action}"]:not(:disabled)`) ?? $(`.item[data-id="${CSS.escape(id)}"] .item-main`))?.focus({ preventScroll: true });
    saved(r, t('"{name}" → {list}(으)로 옮겼어요', { name: found.item.name, list: listName(to.id) }));
  } else if (action === 'item-up' || action === 'item-down') {
    // 끌지 않고 순서 바꾸기 (키보드·터치)
    const found = M.findItem(trip, id);
    if (!found) return;
    const to = found.index + (action === 'item-up' ? -1 : 1);
    if (to < 0 || to >= found.list.length) return;
    M.moveItem(trip, id, found.listId, to);
    commit();
    const again = $(`.item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`);
    (again && !again.disabled ? again : $(`.item[data-id="${CSS.escape(id)}"] .order-row button:not(:disabled)`))?.focus({ preventScroll: true });
    toast(t('{name}: {n}번째', { name: found.item.name, n: to + 1 }));
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
    prefs.trendsUser = !trendsOpen();
    savePrefs();
    renderDays();
    renderMap();
  } else if (action === 'add-trend') {
    addTrend(btn.closest('.trend-card')?.dataset.trend);
  } else if (action === 'sort-time') {
    M.sortByTime(M.getList(trip, btn.dataset.list));
    commit();
  } else if (action === 'pay' || action === 'unpay') {
    const found = M.findItem(trip, id);
    if (!found) return;
    if (action === 'unpay') {
      B.unpayPlace(trip, id);
      return void saved(commit(), t('결제 기록을 지웠어요'));
    }
    // 칸에 적은 금액으로 기록 (예정 비용이 비어 있으면 그 금액을 예정 비용으로도 둔다)
    const row = btn.closest('.cost-row');
    const amount = $('[data-cost="price"]', row)?.value;
    const cur = $('[data-cost="cur"]', row)?.value ?? 'local';
    const problem = B.amountProblem(amount);
    if (problem) {
      $('[data-cost="price"]', row)?.focus();
      return toast(problem, 3200);
    }
    if (!found.item.cost) B.setPlaceCost(found.item, amount, cur);
    B.ensureBudget(trip);
    const r = B.payPlace(trip, id, { amount, cur, today: TODAY });
    if (!r) return;
    saved(commit(), r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: B.won(r.expense.krw) }));
  } else if (action === 'wx-ref') {
    ui.wxRefOpen ??= new Set();
    const dayId = btn.dataset.dayId;
    ui.wxRefOpen.has(dayId) ? ui.wxRefOpen.delete(dayId) : ui.wxRefOpen.add(dayId);
    paintWeather();
  } else if (action === 'day-copy') {
    copyText(M.dayShareText(trip, Number(btn.dataset.day)), t('그날 일정을 복사했어요. 카톡에 붙여넣으세요'));
  } else if (action === 'route-opt') {
    proposeRoute(btn.dataset.list);
  } else if (action === 'rp-move') {
    moveInPlan(btn.closest('[data-rp]').dataset.rp, Number(btn.dataset.dir));
  } else if (action === 'route-apply') {
    applyRoute();
  } else if (action === 'route-cancel') {
    const listId = ui.routePlan?.listId;
    ui.routePlan = null;
    renderDays();
    renderMap();
    $(`[data-action="route-opt"][data-list="${CSS.escape(listId ?? '')}"]`)?.focus({ preventScroll: true });
  } else if (action === 'route-undo') {
    undoRoute();
  } else if (action === 'duplicate') {
    const copy = M.duplicateItem(trip, id);
    if (!copy) return;
    ui.openItem = null;
    const r = commit();
    $(`.item[data-id="${CSS.escape(copy.id)}"]`)?.classList.add('flash');
    saved(r, t('"{name}"을(를) 복제했어요. 끌어서 다른 날로 옮길 수 있어요', { name: copy.name }));
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
    locateMapPlace(s);
  } else if (action === 'stay-delete') {
    const s = M.findStay(trip, btn.dataset.stay);
    if (s && confirm(t('숙소 "{name}"({n}박)을 삭제할까요?', { name: s.name, n: s.nights }))) {
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
    toast(t('숙소 이름을 검색하거나 ‘지도에서 찍기’로 위치를 골라요.'));
  }
});

// 숙소 편집: 이름·메모·링크는 입력하는 대로, 체크인·박 수는 바꾸면 바로 날짜별 배치를 다시 그린다.
$('#days').addEventListener('input', (e) => {
  const field = e.target.dataset.sfield;
  const stay = field && M.findStay(trip, e.target.closest('.stay-editor')?.dataset.stay);
  if (!stay) return;
  stay[field] = field === 'name' ? e.target.value || t('이름 없는 숙소') : e.target.value;
  M.touch(trip);
  persistSoon();
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
  found.item[field] = field === 'name' ? e.target.value || t('이름 없는 장소') : e.target.value;
  M.touch(trip);
  persistSoon();
  const li = e.target.closest('.item');
  const it = found.item;
  $('.item-name', li).innerHTML = nameHtml(it);
  $('.item-sub', li).textContent = it.memo.split('\n')[0] || it.address;
  const timeEl = $('.tl-time', li);
  if (timeEl) timeEl.textContent = it.time;
  refreshMapSoon();
});

// 순서 고정
$('#days').addEventListener('change', (e) => {
  if (!e.target.matches('[data-pin]')) return;
  const found = M.findItem(trip, e.target.closest('.item')?.dataset.id);
  if (!found) return;
  if (e.target.checked) found.item.pinned = true;
  else delete found.item.pinned;
  commit();
});
// 다른 날과 통째로 바꾸기 (다시 바꾸면 돌아간다)
$('#days').addEventListener('change', (e) => {
  if (!e.target.matches('.day-swap') || e.target.value === '') return;
  const a = Number(e.target.dataset.day);
  const b = Number(e.target.value);
  if (!M.swapDays(trip, a, b)) return;
  ui.routePlan = ui.routeUndo = null;
  saved(commit(), t('{a} ↔ {b} 장소를 바꿨어요. 한 번 더 바꾸면 돌아가요', { a: dayName(a), b: dayName(b) }), 3000);
});

// 장소 예상 비용: 칸을 벗어나거나 통화를 바꾸면 저장 (가계부 "예상"에 바로 잡힌다)
$('#days').addEventListener('change', (e) => {
  const key = e.target.dataset.cost;
  const li = key && e.target.closest('.item');
  const found = li && M.findItem(trip, li.dataset.id);
  if (!found) return;
  const row = e.target.closest('.cost-row');
  const price = $('[data-cost="price"]', row).value;
  const problem = price.trim() ? B.amountProblem(price) : null;
  if (problem) {
    toast(problem, 3200);
    return;
  }
  B.setPlaceCost(found.item, price, $('[data-cost="cur"]', row)?.value ?? 'local');
  commit();
});

$('#days').addEventListener('change', (e) => {
  if (!e.target.matches('.trend-city')) return;
  trip.trendCity = e.target.value || null;
  commit();
  const city = currentCity();
  if (city && !T.tripAnchor(trip)) map.setView([city.center.lat, city.center.lng], 12);
});

$('#pinLegend').addEventListener('click', (e) => {
  const cat = e.target.closest('[data-cat-filter]')?.dataset.catFilter;
  if (cat) {
    ui.catFilter = ui.catFilter === cat ? null : cat; // 같은 칩을 다시 누르면 해제
    renderMap();
    $(`#pinLegend [data-cat-filter="${cat}"]`)?.focus();
    return;
  }
  const mode = e.target.closest('[data-pin]')?.dataset.pin;
  if (!mode || mode === prefs.pinColor) return;
  ui.catFilter = null;
  prefs.pinColor = mode;
  savePrefs();
  renderMap();
  $(`#pinLegend [data-pin="${mode}"]`)?.focus();
});

$('#showAll').addEventListener('click', () => {
  if (ui.focusList == null) return selectDay(ui.day, { scroll: false });
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
  $$('.seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === prefs.view);
    b.setAttribute('aria-pressed', String(b.dataset.view === prefs.view));
  });
  $('#mapToggle').textContent = prefs.mapHidden ? t('지도 보기') : t('지도 숨기기');
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

/* ───────── 장소 검색 / 추가 ─────────
 * 상태마다 다른 안내: 좌표 범위 밖 · 지원하지 않는 링크 · 결과 없음 · 검색 서버 문제(다시 시도) · 오프라인.
 * 후보는 주소·지역·여행지에서 거리로 구분하고, "위치 보기"로 지도에서 확인한다.
 */
const searchEl = $('#search');
const resultsEl = $('#results');

function showMessage(text, { retry = false } = {}) {
  ui.results = [];
  resultsEl.innerHTML = `<li class="msg" role="status">${esc(text)}${retry ? ` <button type="button" class="linkbtn" data-retry>${esc(t('다시 시도'))}</button>` : ''}</li>`;
  resultsEl.hidden = false;
}

function candidateMeta(p) {
  const parts = [p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`];
  if (p.region && !String(p.address).includes(p.region)) parts.push(p.region);
  const anchor = trip?.center ?? T.tripAnchor(trip ?? {});
  if (anchor) parts.push(t('여행지에서 {km}', { km: M.formatKm(M.distanceKm(anchor, p)) }));
  return parts.join(' · ');
}

function showResults(places) {
  ui.results = places;
  ui.activeResult = places.length ? 0 : -1;
  if (!places.length) return showMessage(t('검색 결과가 없어요. 영어나 현지어로도 검색해 보세요.'));
  resultsEl.innerHTML = places
    .map(
      (p, i) =>
        `<li data-i="${i}"${i === 0 ? ' class="active"' : ''}><div class="r-main"><div class="r-name">${esc(p.name)}</div><div class="r-addr">${esc(candidateMeta(p))}</div></div>
          <button type="button" class="r-preview" data-preview="${i}" aria-label="${esc(t('{name} 위치 미리 보기', { name: p.name }))}">${esc(t('위치 보기'))}</button></li>`,
    )
    .join('');
  resultsEl.hidden = false;
}

function hideResults() {
  resultsEl.hidden = true;
  ui.results = [];
}

function searchErrorText(err) {
  if (err.kind === 'offline' || !navigator.onLine) return t('인터넷 연결이 없어 검색할 수 없어요. 연결되면 다시 시도하거나 "위도, 경도"를 붙여넣어 주세요.');
  if (err.kind === 'busy') return t('검색 요청이 많아요. 잠시 후 다시 시도해 주세요.');
  return t('검색 서버에 문제가 있어요({detail}). 잠시 후 다시 시도하거나 구글맵 링크를 붙여넣어 주세요.', { detail: err.message });
}

/** explicit: Enter로 검색 (한국어 검색은 Enter일 때만 한다) */
async function runSearch({ explicit = false } = {}) {
  const q = searchEl.value.trim();
  ui.searchAbort?.abort();
  ui.lastSearch = { explicit };
  if (q.length < 2) return hideResults();

  const parsed = parseLocationInput(q);
  if (parsed?.error === 'short-link') {
    return showMessage(t('짧은 링크(maps.app.goo.gl)는 브라우저에서 열 수 없어요. 링크를 한 번 연 뒤 주소창의 긴 주소를 복사해 붙여넣어 주세요.'));
  }
  if (parsed?.error === 'range') {
    return showMessage(t('좌표 범위를 벗어났어요. 위도는 -90~90, 경도는 -180~180 사이여야 해요 (예: 35.6812, 139.7671).'));
  }
  if (parsed?.error) {
    return showMessage(t('이 링크에서 위치를 찾지 못했어요. 구글맵·애플맵·OpenStreetMap 링크나 "위도, 경도"를 붙여넣어 주세요.'));
  }

  const ctrl = new AbortController();
  ui.searchAbort = ctrl;
  try {
    if (parsed && 'lat' in parsed) {
      let place = { name: parsed.name ?? '', address: '', lat: parsed.lat, lng: parsed.lng };
      // 주소를 찾는 동안 추가해도 '위치 확인 중…'이 이름으로 남지 않게: 찾으면 나중에 채운다
      const lookup = reversePlace(parsed.lat, parsed.lng, ctrl.signal).catch(() => null);
      showResults([{ ...place, name: place.name || t('위치 확인 중…'), lookup, unnamed: !place.name }]);
      const r = await lookup;
      place = { ...place, name: place.name || r?.name || t('링크로 추가한 장소'), address: r?.address ?? '', region: r?.region ?? '' };
      if (!ctrl.signal.aborted) showResults([place]);
      return;
    }
    if (!navigator.onLine) return showMessage(searchErrorText({ kind: 'offline' }), { retry: true });
    const query = parsed?.query ?? q;
    const c = map.getCenter();
    const near = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    if (HANGUL.test(query)) {
      if (!explicit) return showMessage(t('Enter를 누르면 "{q}"을(를) 한국어로 찾아요', { q: query }));
      showMessage(t('한국어로 찾는 중…'));
      const places = await searchPlacesKo(query, near, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!places.length) {
        return showMessage(t('한국어 이름으로는 못 찾았어요. 영어·현지어로 검색하거나(예: Kuromon Market), 구글맵 링크를 붙여넣어 주세요.'));
      }
      return showResults(places);
    }
    showMessage(t('검색 중…'));
    const places = await searchPlaces(query, near, ctrl.signal);
    if (!ctrl.signal.aborted) showResults(places);
  } catch (err) {
    if (err.name !== 'AbortError') showMessage(searchErrorText(err), { retry: true });
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
  if (e.target.closest('[data-retry]')) return void runSearch({ explicit: true });
  const pv = e.target.closest('[data-preview]');
  if (pv) {
    const p = ui.results[Number(pv.dataset.preview)];
    if (!p) return;
    if (pickViewport.matches) {
      resultsEl.hidden = true;
      showTab('map');
      setTimeout(() => showCandidate(p), 50);
    } else showCandidate(p);
    return;
  }
  const li = e.target.closest('li[data-i]');
  if (li) addPlace(ui.results[+li.dataset.i]);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search') && !e.target.closest('#mapPlace')) hideResults();
  if (!e.target.closest('.menu')) $('.menu').open = false;
});

function addPlace(place, { edit = false, listId = null } = {}) {
  if (!trip || !place) return;
  if (place.lookup) {
    // 주소 조회가 끝나기 전에 고름: 일단 좌표 이름으로 넣고, 찾으면 이름·주소를 채운다 (그사이 사용자가 고친 이름은 그대로)
    const { lookup, unnamed, ...rest } = place;
    const tmpName = unnamed ? t('링크로 추가한 장소') : rest.name;
    const forTrip = trip;
    lookup.then((r) => {
      if (!r || trip !== forTrip) return;
      const found = M.findItem(trip, ui.lastAddedId) ?? M.findStay?.(trip, ui.lastAddedId);
      const it = found?.item ?? found;
      if (!it || it.lat !== rest.lat) return;
      if (unnamed && it.name === tmpName) it.name = r.name || tmpName;
      if (!it.address) it.address = r.address ?? '';
      commit();
    });
    place = { ...rest, name: tmpName };
  }
  if (listId == null && ui.target === STAY_TARGET) return addStayFromOpts(place);
  const target = listId ?? ui.target;
  const item = M.addItem(trip, target, place);
  ui.lastAddedId = item.id;
  ui.openItem = edit ? item.id : null;
  if (edit) ui.openStay = null;
  searchEl.value = '';
  hideResults();
  clearCandidate();
  const r = commit();
  map.setView([item.lat, item.lng], Math.max(map.getZoom(), 14));
  saved(r, t('"{name}" → {list}에 추가했어요', { name: item.name, list: listName(target) }));
  const el = $(`.item[data-id="${CSS.escape(item.id)}"]`);
  el?.scrollIntoView({ block: 'nearest' });
  el?.classList.add('flash');
}

$('#target').addEventListener('change', (e) => {
  ui.target = e.target.value;
  if (ui.target !== STAY_TARGET) ui.lastList = ui.target;
  renderStayOpts();
  renderPlanEmpty();
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
$('#pickBtn').addEventListener('click', () => setPicking(!ui.picking, { cancelled: ui.picking }));
$('#pickCancel').addEventListener('click', () => setPicking(false, { cancelled: true }));

/* ───────── 상단 바 ───────── */
$('#tripTitle').addEventListener('change', (e) => {
  trip.title = e.target.value.trim() || t('새 여행');
  commit();
  renderTripSwitcher();
});

/**
 * 여행 날짜 바꾸기. 바꾸기 전에 영향받는 장소·지출·숙소·항공편과 처리 방식을 보여주고 확인받는다.
 *  - 줄어든 날의 장소 → 장소 보관함, 지출 → 지우지 않고 원래 날짜로 '일정 외'에 집계
 *  - 숙소 → 줄어든 밤만 빠짐, 항공편 → 그대로 두고 일정에서만 안 보임
 */
async function onDatesChange() {
  const start = $('#startDate').value;
  let end = $('#endDate').value;
  if (!start) return render();
  if (!end || end < start) end = start;
  const impact = M.dateChangeImpact(trip, start, end);
  if (!impact) return render();
  const items = [];
  const names = (list, key = 'name') => list.slice(0, 5).map((x) => x[key]).filter(Boolean).join(', ') + (list.length > 5 ? ` ${t('외 {n}곳', { n: list.length - 5 })}` : '');
  if (impact.places.length) items.push([t('장소 {n}곳은 장소 보관함으로 옮겨요', { n: impact.places.length }), names(impact.places)]);
  if (impact.expenses.length) {
    items.push([
      t('지출 {n}건은 지우지 않고 원래 날짜 그대로 가계부에 ‘일정 외’로 남겨요. 합계는 그대로예요', { n: impact.expenses.length }),
      impact.expenses.slice(0, 5).map((e) => `${dayName(e.day)}${trip.days[e.day]?.date ? ` (${shortDate(trip.days[e.day].date)})` : ''} · ${e.memo || t(B.EXPENSE_CATS[e.cat]?.label ?? '기타')} ${e.cur === 'KRW' ? B.won(e.amount) : B.moneyCode(e.amount, trip.budget?.currency)}`).join(' / '),
    ]);
  }
  if (impact.stays.length) items.push([t('숙소 {n}곳은 줄어든 기간만큼 밤이 빠져요 (숙소는 지우지 않아요)', { n: impact.stays.length }), names(impact.stays)]);
  if (impact.flights.length) items.push([t('항공편 {n}개는 여행 기간 밖이 되어 일정에 안 보여요 (항공편은 지우지 않아요)', { n: impact.flights.length }), impact.flights.map((f) => M.flightSummary(f)).join(', ')]);
  if (impact.shifted && placeCount()) items.push([t('시작일이 바뀌어도 일차별 장소는 그대로이고, 날짜만 {date}부터로 바뀌어요', { date: M.formatDate(start) }), '']);
  if (items.length) {
    const ok = await ask({
      title: t('여행 날짜를 바꿀까요?'),
      html: `<p>${esc(`${M.formatDate(start)} – ${M.formatDate(end)} · ${tripLength(M.dateRange(start, end).length)}`)}</p>
        <ul class="impact">${items.map(([head, detail]) => `<li><b>${esc(head)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</li>`).join('')}</ul>`,
      actions: [{ value: 'ok', label: t('날짜 바꾸기'), primary: true }],
    });
    if (ok !== 'ok') return render();
  }
  M.setTripDates(trip, start, end);
  if (ui.bf && ui.bf.day >= trip.days.length) ui.bf.day = -1;
  saved(commit(), impact.places.length || impact.expenses.length ? t('날짜를 바꿨어요') : '');
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

$('.menu .menu-pop').addEventListener('click', (e) => {
  const action = e.target.closest('[data-menu]')?.dataset.menu;
  $('.menu').open = false;
  if (action === 'backup') saveTripBackup();
  else if (action === 'calendar' && !downloadCalendar(trip)) toast(t('캘린더에 내보낼 일정이 없어요. 날짜가 있는 일차에 장소를 넣으면 내보낼 수 있어요'), 3500);
  else if (action === 'import') $('#importFile').click();
  else if (action === 'delete') deleteTrip(trip.id);
  else if (action === 'flights') openFlights();
  else if (action === 'share') {
    $('.menu summary').focus();
    $('#shareBtn').click();
  }
  else if (action === 'theme') $('#themeBtn').click();
});

const BACKUP_INTERVAL = 3 * 24 * 60 * 60 * 1000;
function renderBackupReminder() {
  const last = prefs.backups?.[trip?.id];
  const count = trip ? trip.days.reduce((n, day) => n + day.items.length, trip.expenses?.length ?? 0) : 0;
  const due = Boolean(trip && !ui.readonly && prefs.page !== 'home' &&
    (last ? Date.now() - last >= BACKUP_INTERVAL : count >= 10 || Date.now() - Date.parse(trip.createdAt) >= BACKUP_INTERVAL));
  $('#backupDot').hidden = !due;
  $('.menu summary').setAttribute('aria-label', due ? t('더보기 · 백업 파일을 저장할 때예요') : t('더보기'));
}

function saveTripBackup() {
  if (!trip) return;
  downloadJson(trip);
  if (ui.readonly) return;
  prefs.backups ??= {};
  prefs.backups[trip.id] = Date.now();
  savePrefs();
  renderBackupReminder();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderBackupReminder();
});

/**
 * 백업 불러오기. 잘못된 파일은 기존 데이터를 건드리지 않는다.
 * 같은 여행이 이미 있으면 기본은 "사본으로 가져오기"(기존 여행 그대로), 원하면 덮어쓰기.
 */
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let imported;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error(t('파일이 너무 커요 (10MB 이하)'));
    imported = M.validateTrip(JSON.parse(await file.text()));
  } catch (err) {
    return void ask({
      title: t('백업 파일을 불러오지 못했어요'),
      body: `${err instanceof SyntaxError ? t('JSON 파일을 읽을 수 없어요. 파일이 잘렸거나 다른 형식이에요.') : err.message} ${t('지금 있는 여행은 바뀌지 않았어요.')}`,
      actions: [{ value: 'ok', label: t('확인'), primary: true }],
      cancel: null,
    });
  }
  const existing = store.trips[imported.id];
  if (existing) {
    const same = JSON.stringify(existing) === JSON.stringify(imported);
    const choice = await ask({
      title: t('이미 있는 여행이에요'),
      body: same
        ? t('"{title}"이(가) 이미 같은 내용으로 있어요. 사본을 하나 더 만들까요?', { title: existing.title })
        : t('"{title}"이(가) 이미 있어요. 사본으로 가져오면 지금 여행은 그대로 두고 새 여행을 하나 더 만들어요. 덮어쓰면 지금 여행이 백업 파일 내용으로 바뀌어요.', { title: existing.title }),
      actions: same ? [{ value: 'copy', label: t('사본으로 가져오기'), primary: true }] : [
        { value: 'overwrite', label: t('덮어쓰기'), danger: true },
        { value: 'copy', label: t('사본으로 가져오기'), primary: true },
      ],
    });
    if (!choice) return;
    if (choice === 'copy') imported = { ...imported, id: M.uid(), title: t('{title} (사본)', { title: imported.title }), createdAt: new Date().toISOString() };
  }
  switchTrip(imported, { save: true });
  if (store.trips[imported.id]) toast(t('"{title}"을(를) 불러왔어요', { title: imported.title }));
});

/* ───────── 메인 페이지 · 주소(라우팅) ─────────
 * #/               메인 (새 여행 만들기 · 내 여행 · 요즘 뜨는 곳)
 * #/trip/<id>      일정   (#/trip/<id>/budget, #/trip/<id>/check)
 * 공유 링크(/s/<id>, #s=…)는 따로 처리한다.
 */
const POPULAR = [k('오사카'), k('도쿄'), k('후쿠오카'), k('교토'), k('삿포로'), k('오키나와'), k('다낭'), k('방콕'), k('타이베이'), k('파리')];
const DESTINATIONS = [
  [k('오사카'), k('일본'), 'osaka', 'ㅇㅅㅋ', '大阪'], [k('도쿄'), k('일본'), 'tokyo', '동경', 'ㄷㅋ', '東京', '东京'],
  [k('후쿠오카'), k('일본'), 'fukuoka', 'ㅎㅋㅇㅋ', '福岡'], [k('교토'), k('일본'), 'kyoto', 'ㄱㅌ', '京都'],
  [k('삿포로'), k('일본'), 'sapporo', 'ㅅㅍㄹ', '札幌'], [k('오키나와'), k('일본'), 'okinawa', 'ㅇㅋㄴㅇ', '沖縄', '冲绳'],
  [k('다낭'), k('베트남'), 'da nang', 'danang', 'ㄷㄴ', '岘港', 'ダナン'], [k('방콕'), k('태국'), 'bangkok', 'ㅂㅋ', '曼谷', 'バンコク'],
  [k('타이베이'), k('대만'), 'taipei', 'ㅌㅇㅂㅇ', '台北'], [k('파리'), k('프랑스'), 'paris', 'ㅍㄹ', '巴黎', 'パリ'],
  [k('도하'), k('카타르'), 'doha', 'ㄷㅎ', '多哈', 'ドーハ'], [k('리스본'), k('포르투갈'), 'lisbon', 'ㄹㅅㅂ', '里斯本', 'リスボン'],
  [k('상하이'), k('중국'), 'shanghai', 'ㅅㅎㅇ', '上海'], [k('자싱'), k('중국'), 'jiaxing', 'ㅈㅅ', '嘉兴'],
].map(([value, detail, ...keywords]) => ({ value, detail, keywords }));

function destinationOptions() {
  const countryNames = Intl.DisplayNames ? new Intl.DisplayNames([locale()], { type: 'region' }) : null;
  return [
    ...DESTINATIONS.map((d) => ({ value: t(d.value), detail: t(d.detail), keywords: [d.value, ...d.keywords] })),
    ...trends.cities.filter((city) => !DESTINATIONS.some((d) => d.value === city.name))
      .map((city) => ({ value: t(city.name), detail: countryNames?.of(city.country) ?? city.country, keywords: [city.id, city.name] })),
  ];
}

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

/** 주소에 맞는 화면을 그린다. 이 브라우저에 없는 여행 주소면 이유와 복구 방법을 메인에 보여준다. */
function route() {
  if (ui.readonly) return;
  const m = /^#\/trip\/([^/]+)(?:\/(budget|check))?$/.exec(location.hash);
  const id = m ? decodeURIComponent(m[1]) : null;
  const found = id && store.trips[id];
  if (!found) {
    if (m) {
      ui.homeAlert = { kind: 'missing', id };
      history.replaceState(null, '', '#/');
    }
    showPage('home');
    return;
  }
  if (ui.homeAlert?.kind === 'missing') ui.homeAlert = null;
  if (trip?.id !== found.id) openTrip(found);
  showPage(m[2] || 'plan');
}

/** 여행 열기 (화면 이동 없이 상태만) */
function openTrip(tr, { save = false } = {}) {
  leaveShared();
  setPicking(false);
  map.closePopup();
  clearCandidate();
  trip = tr;
  ui.mapLastDay = null;
  store.currentId = tr.id;
  if (save) store.trips[tr.id] = tr;
  ui.openItem = null;
  ui.routePlan = ui.routeUndo = null;
  ui.day = M.todayIndex(tr, TODAY);
  ui.focusList = prefs.view === 'list' ? tr.days[ui.day]?.id ?? null : null;
  ui.target = null;
  ui.bf = null;
  if (save) saveNow();
  else persistSoon();
  if (!trip) return;
  render({ fit: true });
}

function switchTrip(tr, { save = false } = {}) {
  openTrip(tr, { save });
  if (trip) go('plan', trip.id);
}

function deleteTrip(id) {
  const tr = store.trips[id];
  if (!tr || !confirm(t('"{title}" 여행을 삭제할까요? 되돌릴 수 없어요.', { title: tr.title }))) return;
  delete store.trips[id];
  if (trip?.id === id) {
    trip = null;
    store.currentId = Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;
  }
  saved(saveNow(), t('"{title}"을(를) 삭제했어요', { title: tr.title }));
  go('home');
}

/** 새 여행: 여행지 좌표(와 나라)를 찾고 만든 뒤 일정 화면으로. 나라를 알면 가계부 통화도 그 나라 돈으로 시작한다. */
async function createTripFrom({ destination, title = '', startDate, endDate }, submit) {
  const label = submit?.textContent;
  if (submit) {
    submit.disabled = true;
    submit.textContent = t('여행지 찾는 중…');
  }
  let found = null;
  try {
    found = await geocodeDestination(destination);
  } catch {
    /* 여행지 좌표를 못 찾아도 여행은 만든다 */
  }
  if (submit) {
    submit.disabled = false;
    submit.textContent = label;
  }
  const center = found ? { lat: found.lat, lng: found.lng } : null;
  const tr = M.createTrip({ title, destination: destination.trim(), startDate, endDate, center });
  if (found?.country) tr.country = found.country;
  B.ensureBudget(tr); // 통화를 정해 둔다 (근거가 없으면 첫 기록 전에 확인받는다)
  switchTrip(tr, { save: true });
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

function tripCardHtml(tr) {
  const s = M.tripStats(tr, TODAY);
  const ended = M.tripEnded(tr, TODAY);
  const color = dayColor([...(tr.destination || tr.title)].reduce((h, c) => h + c.charCodeAt(0), 0));
  return `<li class="tcard${ended ? ' ended' : ''}" style="--c:${color}">
      <button class="tc-open" data-open="${tr.id}">
        <span class="tc-cover"><span class="tc-dday">${esc(s.dday.label)}</span><span class="tc-dest">${esc(tr.destination || t('여행'))}</span></span>
        <span class="tc-body">
          <b>${esc(tr.title)}</b>
          <small>${tr.startDate ? `${shortDate(tr.startDate)} – ${shortDate(tr.endDate)} · ` : ''}${esc(s.length)} · ${esc(t('{n}곳', { n: s.places }))}</small>
        </span>
      </button>
      <button class="icon tc-del" data-del="${tr.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: tr.title }))}">✕</button>
    </li>`;
}

function newTripForm(id) {
  const [ds, de] = defaultDates();
  return `<form id="${id}" class="home-new" autocomplete="off" data-dp-pair="여행 날짜">
    <label class="hn-dest suggest-field"><span>${esc(t('어디로 떠나요?'))}</span><input id="${id}Destination" name="destination" placeholder="${esc(t('예: 오사카, 다낭, Lisbon'))}" required></label>
    <label class="hn-date"><span>${esc(t('가는 날'))}</span><input type="date" name="startDate" data-dp="start" aria-label="가는 날" required value="${ds}"></label>
    <label class="hn-date"><span>${esc(t('오는 날'))}</span><input type="date" name="endDate" data-dp="end" aria-label="오는 날" required value="${de}"></label>
    <button class="btn primary hn-go">${esc(t('일정 만들기'))}</button>
  </form>`;
}

const newTripDialog = $('#new-trip-modal');
function renderNewTripModal() {
  const form = $('#modalNew');
  const keep = form ? Object.fromEntries(new FormData(form)) : null;
  $('#newTripFields').innerHTML = newTripForm('modalNew');
  if (keep) for (const [k, v] of Object.entries(keep)) if (v) $(`#modalNew [name="${k}"]`).value = v;
  enhanceSuggestions($('#modalNewDestination'), destinationOptions);
  enhanceDates($('#newTripFields'));
  $('#modalNew').addEventListener('submit', submitNewTrip);
}
renderNewTripModal();
$('#newTripClose').addEventListener('click', () => newTripDialog.close());

function openNewTrip() {
  showDialog(newTripDialog);
  $('#modalNewDestination').focus();
}

/** 메인 위쪽 안내 (없는 여행 주소, 손상된 공유 링크): 이유 + 복구 방법 */
function homeAlertHtml() {
  const a = ui.homeAlert;
  if (!a) return '';
  const hasTrips = Object.keys(store.trips).length > 0;
  const title = a.kind === 'missing' ? t('이 주소의 여행을 이 브라우저에서 찾을 수 없어요') : t('공유 링크를 열지 못했어요');
  const why = a.kind === 'missing'
    ? t('여행은 만든 브라우저에만 저장돼요. 다른 브라우저·기기에서 만들었거나, 여행을 삭제했거나, 브라우저의 사이트 데이터가 지워졌을 수 있어요.')
    : a.message;
  return `<section class="home-alert" role="alert" aria-labelledby="homeAlertTitle">
      <div><h2 id="homeAlertTitle">${esc(title)}</h2><p>${esc(why)}</p>
      <ul>
        ${hasTrips ? `<li>${esc(t('이 브라우저에 있는 여행은 아래 ‘내 여행’에서 열 수 있어요.'))}</li>` : ''}
        <li>${esc(a.kind === 'missing' ? t('공유 링크를 받았다면 받은 링크를 다시 열어 주세요. 보기 전용으로 열리고 내 여행으로 저장할 수 있어요.') : t('보낸 사람에게 링크 전체를 다시 복사해 보내 달라고 하거나, 일정 파일(JSON)을 받아 불러오세요.'))}</li>
        <li>${esc(t('백업 파일(JSON)이 있으면 불러와서 이어서 쓸 수 있어요.'))}</li>
      </ul></div>
      <div class="home-alert-actions">
        ${hasTrips ? `<button type="button" class="btn" data-home="mytrips">${esc(t('내 여행 보기'))}</button>` : ''}
        <button type="button" class="btn primary" data-home="import">${esc(t('백업 파일 불러오기'))}</button>
        <button type="button" class="btn ghost" data-home="dismiss">${esc(t('닫기'))}</button>
      </div>
    </section>`;
}

/** 공통 푸터 (모든 화면 아래): 저작권 · 문의 · 개인정보처리방침 */
const CONTACT = 'xenobase.official@gmail.com';
function renderFooter() {
  $('#siteFoot').innerHTML = `
      <nav class="foot-links" aria-label="${esc(t('사이트 정보'))}">
        <button type="button" class="linkbtn" id="privacyLink" data-foot="privacy" aria-haspopup="dialog">${esc(t('개인정보처리방침'))}</button>
        <span class="foot-contact">${esc(t('문의'))} <a href="mailto:${CONTACT}">${CONTACT}</a></span>
      </nav>
      <p class="foot-note">${esc(t('일정·가계부는 이 브라우저에만 저장돼요. 다른 기기로 옮길 땐 백업 파일을 쓰세요'))}<span class="edit-only"> · <button type="button" class="linkbtn" data-foot="import">${esc(t('백업 파일 불러오기'))}</button></span></p>
      <p class="foot-copy">© 2026 XenoTravel. ${esc(t('모든 권리 보유.'))}</p>`;
}
renderFooter();
$('#siteFoot').addEventListener('click', (e) => {
  const act = e.target.closest('[data-foot]')?.dataset.foot;
  if (act === 'privacy') openPrivacy();
  else if (act === 'import' && !ui.readonly) $('#importFile').click();
});

function renderHome() {
  const el = $('#page-home');
  const form = $('#homeNew', el);
  const restoreSearch = form && document.activeElement === $('#homeNewDestination', form);
  const caret = restoreSearch ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const keep = form ? Object.fromEntries(new FormData(form)) : null; // 다시 그려도 입력 중인 값 유지
  const focusSel = el.contains(document.activeElement) && document.activeElement.id ? `#${CSS.escape(document.activeElement.id)}` : null;
  const all = Object.values(store.trips);
  const { upcoming, past } = sortedTrips();
  const cities = trends.cities ?? [];
  // 처음엔 다가오는 여행의 도시를 보여준다 (없으면 첫 도시)
  const near = upcoming.map((tr) => T.cityByName(cities, tr.destination)).find(Boolean);
  ui.homeCity = cities.some((c) => c.id === ui.homeCity) ? ui.homeCity : near?.id ?? cities[0]?.id;
  const city = cities.find((c) => c.id === ui.homeCity);
  const places = city ? T.activePlaces(city, TODAY) : [];
  el.innerHTML = `<div class="home">
    ${homeAlertHtml()}
    <section class="home-hero">
      <h1>${esc(t('지도와 일정을 한 화면에.'))}<br><span>${esc(t('설치 없이 공유까지.'))}</span></h1>
      <p>${esc(t('가입 없이 바로 시작하는 해외여행 플래너. 일정은 이 브라우저에 저장돼요.'))}</p>
      ${newTripForm('homeNew')}
      <div class="dest-chips"><span>${esc(t('많이 가는 곳'))}</span>${POPULAR.map((d) => `<button type="button" data-dest="${esc(t(d))}">${esc(t(d))}</button>`).join('')}</div>
      ${all.length ? '' : `<div class="home-sample"><button type="button" class="btn" data-home="sample">${esc(t('도쿄 3박 4일 샘플 열기'))}</button></div>`}
    </section>

    ${
      all.length
        ? `<section class="home-sec" id="myTrips" tabindex="-1" aria-labelledby="myTripsTitle">
      <div class="sec-head"><h2 id="myTripsTitle">${esc(t('내 여행'))}</h2><span class="count">${esc(t('{n}개', { n: all.length }))}</span></div>
      <ul class="tcards">${upcoming.map(tripCardHtml).join('')}
        <li class="tcard add"><button class="tc-open" data-focus-new><span class="tc-plus" aria-hidden="true">+</span><span class="tc-body"><b>${esc(t('새 여행'))}</b><small>${esc(t('여행지와 날짜만 있으면 돼요'))}</small></span></button></li>
      </ul>
      ${past.length ? `<h3 class="sub-h">${esc(t('다녀온 여행'))}</h3><ul class="tcards">${past.map(tripCardHtml).join('')}</ul>` : ''}
    </section>`
        : ''
    }

    ${
      city
        ? `<section class="home-sec">
      <div class="sec-head"><h2>${esc(t('요즘 뜨는 곳'))}</h2><span class="count">${esc(t('{date} 조사', { date: trends.researchedAt }))}</span></div>
      <div class="city-tabs" role="group" aria-label="${esc(t('트렌드 도시'))}">${cities.map((c) => `<button data-city="${c.id}" aria-pressed="${c.id === city.id}" class="${c.id === city.id ? 'on' : ''}">${esc(t(c.name))}</button>`).join('')}</div>
      <ul class="insp">${places
        .map((p) => [p, tp(p)])
        .map(
          ([p, loc]) => `<li><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span>
            <b>${esc(loc.name)}</b><small>${esc(loc.area)} · ${esc(loc.category)}</small><p${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p></li>`,
        )
        .join('')}</ul>
      <button class="btn insp-go" data-dest="${esc(t(city.name))}">${esc(t('{city} 일정 만들기', { city: t(city.name) }))}</button>
    </section>`
        : ''
    }

    <section class="home-sec">
      <div class="sec-head"><h2>${esc(t('XenoTravel로 할 수 있는 것'))}</h2></div>
      <ul class="feats">
        <li><b>${esc(t('지도와 일정을 한 화면에'))}</b><p>${esc(t('날짜별 타임라인과 지도 동선을 같이 보고, 끌어서 순서·날짜를 바꿔요.'))}</p></li>
        <li><b>${esc(t('설치 없이 공유'))}</b><p>${esc(t('링크 하나면 친구가 앱 없이 바로 봐요. 원하면 자기 여행으로 저장해 고쳐요.'))}</p></li>
        <li><b>${esc(t('어디든 장소 추가'))}</b><p>${esc(t('한국어 검색, 구글맵 링크 붙여넣기, 지도에서 찍기. 소도시도 빠짐없이.'))}</p></li>
        <li><b>${esc(t('거리 · 길찾기'))}</b><p>${esc(t('장소 사이 거리와 도보 시간, 누르면 구글맵 길찾기가 열려요.'))}</p></li>
        <li><b>${esc(t('가계부 · 체크리스트'))}</b><p>${esc(t('현지 돈으로 적으면 원화도 같이. 출발 전 할 일, 짐, 쇼핑 리스트까지.'))}</p></li>
        <li><b>${esc(t('전부 무료'))}</b><p>${esc(t('엑셀 · PDF 내보내기, 다크 모드, 백업까지 돈 내는 기능이 없어요.'))}</p></li>
      </ul>
    </section>
  </div>`;
  if (keep) for (const [k, v] of Object.entries(keep)) if (v) $(`#homeNew [name="${k}"]`).value = v;
  enhanceDates(el);
  const destination = $('#homeNewDestination');
  enhanceSuggestions(destination, destinationOptions);
  if (caret) {
    destination.focus({ preventScroll: true });
    destination.setSelectionRange(...caret);
  } else if (focusSel) $(focusSel, el)?.focus({ preventScroll: true });
}

$('#page-home').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]')?.dataset.open;
  const del = e.target.closest('[data-del]')?.dataset.del;
  const dest = e.target.closest('[data-dest]')?.dataset.dest;
  const cityId = e.target.closest('[data-city]')?.dataset.city;
  const home = e.target.closest('[data-home]')?.dataset.home;
  if (open && store.trips[open]) go('plan', open);
  else if (del) deleteTrip(del);
  else if (e.target.closest('[data-focus-new]')) openNewTrip();
  else if (dest) {
    const input = $('#homeNew [name="destination"]');
    input.value = dest;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.focus();
  } else if (cityId) {
    ui.homeCity = cityId;
    renderHome();
    $(`#page-home [data-city="${CSS.escape(cityId)}"]`)?.focus();
  } else if (home === 'import') $('#importFile').click();
  else if (home === 'mytrips') {
    const sec = $('#myTrips');
    sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sec?.focus({ preventScroll: true });
  } else if (home === 'dismiss') {
    ui.homeAlert = null;
    renderHome();
    $('#homeNewDestination')?.focus();
  } else if (home === 'sample') {
    const [startDate] = defaultDates();
    const end = M.parseDate(startDate);
    end.setUTCDate(end.getUTCDate() + 3);
    const sample = M.createTrip({
      title: t('도쿄 3박 4일 샘플'), destination: t('도쿄'), startDate,
      endDate: end.toISOString().slice(0, 10), center: { lat: 35.6812, lng: 139.7671 },
    });
    sample.country = 'jp';
    sample.presetI18n = { title: presetMap('도쿄 3박 4일 샘플'), destination: presetMap('도쿄') };
    const days = [
      [[k('센소지'), 35.7148, 139.7967], [k('도쿄 스카이트리'), 35.7101, 139.8107]],
      [[k('메이지 신궁'), 35.6764, 139.6993], [k('시부야 스크램블 교차로'), 35.6595, 139.7005]],
      [[k('츠키지 장외시장'), 35.6655, 139.7707], [k('도쿄 타워'), 35.6586, 139.7454]],
      [[k('도쿄역'), 35.6812, 139.7671]],
    ];
    days.forEach((places, i) => {
      places.forEach(([name, lat, lng]) => M.addItem(sample, sample.days[i].id, { name: t(name), nameI18n: presetMap(name), lat, lng }));
    });
    B.ensureBudget(sample);
    switchTrip(sample, { save: true });
  }
});
async function submitNewTrip(e) {
  e.preventDefault();
  const f = e.target;
  let [startDate, endDate] = [f.startDate.value, f.endDate.value];
  if (endDate < startDate) endDate = startDate;
  await createTripFrom({ destination: f.destination.value, startDate, endDate }, $('.hn-go', f));
  if (f.id === 'modalNew') {
    newTripDialog.close();
    f.reset();
  }
}
$('#page-home').addEventListener('submit', submitNewTrip);
$('#tripsBtn').addEventListener('click', () => go('home'));

/* 상단: 지금 보고 있는 여행 이름 + 다른 여행으로 바꾸기 */
function sortedTrips() {
  const all = Object.values(store.trips);
  const upcoming = all.filter((tr) => !tr.endDate || tr.endDate >= TODAY).sort((a, b) => (a.startDate || '9').localeCompare(b.startDate || '9'));
  const past = all.filter((tr) => tr.endDate && tr.endDate < TODAY).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { upcoming, past };
}

function renderTripSwitcher() {
  $('#curTrip').textContent = trip ? trip.title : '';
  const row = (tr) => {
    const dd = M.ddayInfo(tr, TODAY);
    const color = dayColor([...(tr.destination || tr.title)].reduce((h, c) => h + c.charCodeAt(0), 0));
    return `<button class="sw${tr.id === trip?.id ? ' on' : ''}${M.tripEnded(tr, TODAY) ? ' ended' : ''}" data-sw="${tr.id}" style="--c:${color}"${tr.id === trip?.id ? ' aria-current="true"' : ''}>
        <span class="sw-dot"></span>
        <span class="sw-main"><b>${esc(tr.title)}</b><small>${tr.startDate ? `${shortDate(tr.startDate)} – ${shortDate(tr.endDate)} · ` : ''}${esc(tr.destination || '')}</small></span>
        <span class="sw-dday">${esc(dd.label)}</span>
      </button>`;
  };
  const { upcoming, past } = sortedTrips();
  $('#tripSwList').innerHTML = `
    ${upcoming.length ? `<div class="sw-h">${esc(t('다가오는 여행'))}</div>${upcoming.map(row).join('')}` : ''}
    ${past.length ? `<div class="sw-h">${esc(t('다녀온 여행'))}</div>${past.map(row).join('')}` : ''}
    <hr>
    <button data-sw-new>${esc(t('+ 새 여행 만들기'))}</button>
    <button data-sw-home>${esc(t('모든 여행 보기 (홈)'))}</button>`;
}

$('#tripSwList').addEventListener('click', (e) => {
  const id = e.target.closest('[data-sw]')?.dataset.sw;
  $('#tripSw').open = false;
  if (id && store.trips[id]) go(prefs.page === 'home' ? 'plan' : prefs.page, id); // 같은 탭 그대로 다른 여행으로
  else if (e.target.closest('[data-sw-new]')) openNewTrip();
  else if (e.target.closest('[data-sw-home]')) go('home');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tripSw')) $('#tripSw').open = false;
});

/* ───────── PDF (인쇄 미리보기) ───────── */
let printMaps = [];

function openPrint() {
  const el = $('#print');
  const lists = allLists().filter((l) => l.isDay || l.items.length);
  const range = trip.startDate ? `${M.formatDate(trip.startDate)} ~ ${M.formatDate(trip.endDate)} · ${t('{n}일', { n: trip.days.length })}` : '';
  const empty = !placeCount() && !trip.stays.length && !trip.flights.length;
  el.innerHTML = `
    <div class="print-toolbar">
      <span id="printStatus" role="status">${esc(empty ? t('아직 일정이 비어 있어요. 빈 일정표로 인쇄돼요.') : t('지도를 불러오는 중…'))}</span>
      <button class="btn" id="doPrint">${esc(t('인쇄 / PDF로 저장'))}</button>
      <button class="btn" id="closePrint">${esc(t('닫기'))}</button>
    </div>
    <div class="print-page" lang="${LANGS[getLang()].html}">
      <h1>${esc(trip.title)}</h1>
      <p class="p-sub">${esc(range)}</p>
      ${lists
        .map((l, i) => {
          const title = l.isDay ? M.dayTitle(trip.days[i], i) : t('장소 보관함 (날짜 미정)');
          const st = l.isDay ? M.dayStays(trip, i) : {};
          const stayRow = (stay, label) =>
            stay ? `<tr class="stay"><td class="n">${esc(t('숙'))}</td><td class="t">${esc(label)}</td><td><strong>${esc(stay.name)}</strong>${stay.address ? `<div class="addr">${esc(stay.address)}</div>` : ''}</td><td class="memo">${esc(stay.memo)}</td></tr>` : '';
          const has = l.items.length || st.start || (l.isDay && dayFlights(i, 'top').length + dayFlights(i, 'bottom').length);
          const flightRows = (where) =>
            dayFlights(i, where)
              .map(({ flight: fl }) => `<tr class="flight"><td class="n">${esc(t('항'))}</td><td class="t">${esc(M.flightKind(fl.kind))}</td><td><strong>${esc(M.flightSummary(fl))}</strong></td><td class="memo">${esc([fl.bookingRef && t('예약번호 {ref}', { ref: fl.bookingRef }), fl.memo].filter(Boolean).join(' / '))}</td></tr>`)
              .join('');
          const rows = flightRows('top') + stayRow(st.start, t('출발')) + l.items
            .map(
              (it, j) => `<tr><td class="n">${l.isDay ? j + 1 : '•'}</td><td class="t">${esc(it.time)}</td>
                <td><strong>${M.CATEGORIES[it.category]?.icon ?? ''} ${esc(it.name)}</strong>${it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}</td>
                <td class="memo">${esc(it.memo)}${it.url ? `<div class="addr">${esc(it.url)}</div>` : ''}</td></tr>`,
            )
            .join('') + stayRow(st.end, t('귀가')) + flightRows('bottom');
          return `<section class="print-day" style="--c:${l.color}">
            <h2>${esc(title)}</h2>
            ${has ? `<div class="print-map" data-list="${l.id}" data-day="${i}"></div>` : ''}
            ${
              has
                ? `<table><thead><tr><th></th><th>${esc(t('시간'))}</th><th>${esc(t('장소'))}</th><th>${esc(t('메모'))}</th></tr></thead><tbody>${rows}</tbody></table>`
                : `<p class="addr">${esc(t('아직 일정이 없어요'))}</p>`
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
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="stay-pin">${esc(t('숙소'))}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(m),
    );
    if (pts.length === 1) m.setView(pts[0], 15);
    else m.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    return loaded;
  });
  Promise.all(loads).then(() => {
    const status = $('#printStatus');
    if (status && loads.length) status.textContent = t('준비됐어요. 인쇄 창에서 "PDF로 저장"을 고르세요.');
  });
  $('#doPrint').addEventListener('click', () => window.print());
  $('#closePrint').addEventListener('click', closePrint);
  $('#doPrint').focus();
}

function closePrint() {
  printMaps.forEach((m) => m.remove());
  printMaps = [];
  const el = $('#print');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('printing');
  $('.menu summary')?.focus();
}

/* ───────── 모바일 탭 / 토스트 ───────── */
/** 모바일: 일정 / 지도 전환 (넓은 화면은 둘 다 보이므로 화면 전환만) */
function showTab(tab) {
  if (prefs.page !== 'plan') showPage('plan');
  const layout = $('.layout');
  if (layout.dataset.tab === tab) return;
  if (tab !== 'map' && ui.picking) setPicking(false);
  layout.dataset.tab = tab;
  $$('.mtabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  });
  if (tab === 'map') setTimeout(() => { map.invalidateSize(); renderMap({ fit: !ui.keepView && !ui.candidate }); ui.keepView = false; }, 0);
}
$$('.mtabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* 토스트: 사라지면 글자도 지운다 (다른 화면의 접근성 트리·읽기 순서에 지난 안내가 남지 않게) */
let toastTimer;
function toast(text, ms = 2200) {
  if (!text) return;
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = setTimeout(() => (el.textContent = ''), 250);
  }, ms);
}

/** 모달 열기: 닫으면 연 자리로 포커스를 돌려준다 */
function showDialog(dlg) {
  const back = document.activeElement;
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (back?.isConnected && !document.querySelector('dialog[open]')) back.focus({ preventScroll: true });
  }, { once: true });
}

/* ───────── 날짜 바로가기 · 여행 요약 · 알림 ───────── */
function renderDayTabs() {
  const today = M.indexOfDate(trip, TODAY);
  $('#dayTabs').innerHTML = trip.days
    .map((d, i) => {
      const on = i === ui.day && ui.focusList;
      return `<button class="daytab${on ? ' on' : ''}" role="tab" aria-selected="${Boolean(on)}" tabindex="${i === ui.day ? 0 : -1}" data-day="${i}" style="--c:${dayColor(i)}">
          <i aria-hidden="true"></i>${esc(dayName(i))}${d.date ? `<small>${shortDate(d.date)}</small>` : ''}${i === today ? `<span class="today">${esc(t('오늘'))}</span>` : ''}
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

/** 항공편 한 줄: 항공권 앱처럼 "ICN 08:40 ─── KIX 10:30" */
function flightRoute(f) {
  const tm = (v) => (v ? v.slice(11, 16) : '');
  const md = shortDate(f.departAt.slice(0, 10));
  return `<button class="route" data-hero="flights" data-flight="${f.id}" title="${esc(t('항공편 수정'))}">
      <span class="rt-kind">${esc(M.flightKind(f.kind))}${f.flightNo ? ` · ${esc(f.flightNo)}` : ''}${md ? ` · ${md}` : ''}</span>
      <span class="rt-line">
        <span class="rt-ap"><b>${esc(f.from || t('출발'))}</b><small>${esc(tm(f.departAt))}</small></span>
        <span class="rt-path" aria-hidden="true"><svg class="ic"><use href="#i-ticket"/></svg></span>
        <span class="rt-ap"><b>${esc(f.to || t('도착'))}</b><small>${esc(tm(f.arriveAt))}</small></span>
      </span>
    </button>`;
}

function renderHero() {
  const s = M.tripStats(trip, TODAY);
  const dest = (trip.destination || '').trim();
  $('#heroTag').textContent = dest ? t('{dest} 여행', { dest }) : t('여행 계획');
  const staysTxt = trip.stays.length ? `${trip.stays[0].name}${trip.stays.length > 1 ? ` ${t('외 {n}곳', { n: trip.stays.length - 1 })}` : ''}` : '';
  $('#heroMeta').textContent = [s.length, staysTxt].filter(Boolean).join(' · ');
  const km = s.km >= 10 ? Math.round(s.km) : s.km.toFixed(1);
  $('#heroStats').innerHTML = `
    <div class="tile dday"><span>${esc(s.dday.sub)}</span><b>${esc(s.dday.label)}</b></div>
    <div class="tile"><span>${esc(t('여행 기간'))}</span><b>${s.days}<small>${esc(t('일'))}</small></b></div>
    <div class="tile"><span>${esc(t('들를 곳'))}</span><b>${s.places}<small>${esc(t('곳'))}</small></b></div>
    <div class="tile wide"><span>${esc(t('이동 (직선)'))}</span><b>${num(Number(km), { maximumFractionDigits: 1 })}<small>km</small></b></div>`;
  const out = trip.flights.find((f) => f.kind === 'out');
  const back = trip.flights.find((f) => f.kind === 'in');
  const flights = [out, ...trip.flights.filter((f) => f.kind === 'move'), back].filter(Boolean);
  $('#heroFlight').innerHTML = flights.length
    ? flights.map(flightRoute).join('')
    : ui.readonly
    ? ''
    : `<button class="route add" data-hero="flights"><span class="rt-kind">${esc(t('항공편'))}</span><span class="rt-add">${esc(t('+ 출국·귀국편 넣기'))}</span></button>`;
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
  const paid = B.placeExpense(trip, it.id);
  const canPay = !ui.readonly && !paid && it.cost?.price > 0;
  return `<li class="td-row${isNext ? ' next' : ''}${it.visited ? ' visited' : ''}">
      <span class="td-time">${esc(it.time) || ''}</span>
      ${
        ui.readonly
          ? `<span class="td-num">${it.visited ? '✓' : n}</span>`
          : `<button type="button" class="td-num" data-today="visit" data-id="${it.id}" aria-pressed="${!!it.visited}" aria-label="${esc(t('{name} 다녀옴 표시', { name: it.name }))}" title="${esc(it.visited ? t('다녀온 표시 지우기') : t('다녀왔어요'))}">${it.visited ? '✓' : n}</button>`
      }
      <div class="td-body">
        <b>${esc(it.name)}${isNext ? `<span class="td-next">${esc(t('다음'))}</span>` : ''}${costTagHtml(it)}</b>
        <small>${esc(addr)}</small>
        ${memo ? `<small class="td-memo">${esc(memo)}</small>` : ''}
      </div>
      <div class="td-acts">
        ${canPay ? `<button type="button" data-today="pay" data-id="${it.id}" title="${esc(t('예정 비용 그대로 가계부에 기록'))}" aria-label="${esc(t('{name} 결제 기록', { name: it.name }))}">${esc(t('결제'))}</button>` : ''}
        <button type="button" data-today="copy" data-text="${esc(addr)}" title="${esc(t('주소 복사 (택시 기사에게 보여주기)'))}" aria-label="${esc(t('{name} 주소 복사', { name: it.name }))}">${esc(t('주소'))}</button>
        <a href="${M.directionsFromHereUrl(it)}" target="_blank" rel="noopener" title="${esc(t('지금 위치에서 길찾기'))}" aria-label="${esc(t('{name} 길찾기', { name: it.name }))}">${esc(t('길찾기'))}</a>
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
      <div><span class="td-eyebrow">${esc(t('오늘'))} · ${esc(dayName(p.dayIndex))}</span><h2>${esc(M.formatDate(day.date))}</h2></div>
      <span class="wx-slot" data-wx="${day.id}">${wxChipHtml(ui.weather.data[day.id], day.id)}</span>
    </div>
    ${
      p.items.length
        ? `<ol class="td-list">${p.items.map((it, i) => todayRowHtml(it, i + 1, it.id === p.nextId)).join('')}</ol>`
        : `<p class="td-empty">${esc(t('오늘은 정한 곳이 없어요.'))}</p>`
    }
    ${
      s
        ? `<div class="td-stay"><div><span>${esc(t('오늘 밤 숙소'))}</span><b>${esc(s.name)}</b>${s.address ? `<small>${esc(s.address)}</small>` : ''}</div>
          <div class="td-acts"><button type="button" data-today="copy" data-text="${esc(stayAddr)}">${esc(t('주소'))}</button><a href="${M.directionsFromHereUrl(s)}" target="_blank" rel="noopener">${esc(t('숙소로 가기'))}</a></div></div>`
        : ''
    }
    <div class="td-foot">
      ${ui.readonly ? '' : `<button type="button" class="btn primary" data-today="expense">${esc(t('지출 적기'))}</button>`}
      <button type="button" class="btn" data-today="share" data-day="${p.dayIndex}">${esc(t('카톡으로 오늘 일정 보내기'))}</button>
    </div>`;
}

$('#today').addEventListener('click', (e) => {
  const b = e.target.closest('[data-today]');
  if (!b) return;
  const act = b.dataset.today;
  if (act === 'copy') copyText(b.dataset.text, t('주소를 복사했어요'));
  else if (act === 'visit') {
    const found = M.findItem(trip, b.dataset.id);
    if (!found) return;
    found.item.visited = !found.item.visited;
    commit();
  } else if (act === 'pay') {
    B.ensureBudget(trip);
    const r = B.payPlace(trip, b.dataset.id, { today: TODAY });
    if (!r) return;
    saved(commit(), r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: B.won(r.expense.krw) }));
  }
  else if (act === 'share') copyText(M.dayShareText(trip, Number(b.dataset.day)), t('오늘 일정을 복사했어요. 카톡에 붙여넣으세요'));
  else if (act === 'expense') {
    go('budget');
    setTimeout(() => $('#bAmount')?.focus(), 50);
  }
});
// 시간이 지나면 "다음" 장소가 바뀐다
setInterval(() => !$('#today').hidden && prefs.page === 'plan' && renderToday(), 60_000);

function renderNotice() {
  const list = ui.readonly ? [] : M.tripNotices(trip);
  const total = trip.budget?.total;
  const plan = total ? B.combinePlans(C.planned(trip), B.placePlanned(trip)).total : 0;
  if (!ui.readonly && total && plan > total) list.push(t('예상 비용({plan})이 예산({total})보다 {diff} 많아요', { plan: B.won(plan), total: B.won(total), diff: B.won(plan - total) }));
  const el = $('#notice');
  el.hidden = !list.length;
  const noStay = !ui.readonly && !(trip.stays ?? []).length && trip.days.length > 1;
  el.innerHTML = list.length
    ? `<b>${esc(t('확인할 것'))}</b><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${noStay ? `<button type="button" class="btn notice-act" data-notice="stay">${esc(t('+ 숙소 추가'))}</button>` : ''}`
    : '';
}

$('#notice').addEventListener('click', (e) => {
  if (e.target.closest('[data-notice="stay"]')) {
    ui.target = STAY_TARGET;
    ui.stayStart = firstUncoveredNight();
    ui.stayNights = null;
    renderTarget();
    showTab('plan');
    searchEl.focus();
    searchEl.scrollIntoView({ block: 'center' });
    toast(t('숙소 이름을 검색하거나 ‘지도에서 찍기’로 위치를 골라요.'));
  }
});
$('#dayTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (b) selectDay(Number(b.dataset.day));
});
// 날짜 칩: ←→ Home End로 이동 (탭 목록 키보드 규칙)
$('#dayTabs').addEventListener('keydown', (e) => {
  const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  if (!(e.key in keys) || !trip) return;
  e.preventDefault();
  const n = trip.days.length;
  const i = keys[e.key] === -Infinity ? 0 : keys[e.key] === Infinity ? n - 1 : Math.max(0, Math.min(n - 1, ui.day + keys[e.key]));
  selectDay(i);
  $(`#dayTabs [data-day="${i}"]`)?.focus();
});
$('#dayPrev').addEventListener('click', () => {
  selectDay(ui.day - 1, { scroll: false });
  if ($('#dayPrev').disabled) $('#dayNext').focus();
});
$('#dayNext').addEventListener('click', () => {
  selectDay(ui.day + 1, { scroll: false });
  if ($('#dayNext').disabled) $('#dayPrev').focus();
});
$('#heroFlight').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hero="flights"]');
  if (b) openFlights(b.dataset.flight || null);
});

// ←→ 날짜 바꾸기 (입력 중이 아닐 때)
document.addEventListener('keydown', (e) => {
  if (ui.picking) {
    if (e.key === 'Escape') setPicking(false, { cancelled: true });
    return;
  }
  if (!trip || prefs.page !== 'plan' || prefs.view === 'board' || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.defaultPrevented || e.target.closest('input, textarea, select, button, a, [role="tab"], [contenteditable], #datePicker, .leaflet-container') || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowLeft') selectDay(ui.day - 1);
  else if (e.key === 'ArrowRight') selectDay(ui.day + 1);
});

/* ───────── 화면(일정·가계부·체크) · 밝기 · 언어 ───────── */
const PAGES = ['home', 'plan', 'budget', 'check'];
function showPage(page, { scroll = true } = {}) {
  prefs.page = PAGES.includes(page) && (page === 'home' || trip) ? page : 'home';
  if (prefs.page !== 'plan') {
    setPicking(false);
    cancelMapHold();
    if (locationChoice) map.closePopup(locationChoice.popup);
  }
  document.body.dataset.page = prefs.page;
  document.body.dataset.hasTrip = trip || store.currentId ? 'yes' : 'no';
  $('#inAppBackup').hidden = !trip || ui.readonly;
  renderBackupReminder();
  // 보이지 않는 화면은 읽기 순서·탭 순서에서 완전히 뺀다 (hidden + inert)
  for (const p of PAGES) {
    $(`#page-${p}`).hidden = p !== prefs.page;
    $(`#page-${p}`).inert = p !== prefs.page;
  }
  $$('button.pg').forEach((b) => {
    b.classList.toggle('on', b.dataset.page === prefs.page);
    if (b.dataset.page === prefs.page) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  renderSaveBar();
  if (prefs.page === 'home') {
    document.title = `XenoTravel · ${t('가볍게 짜는 해외여행 일정')}`;
    renderHome();
    if (scroll) window.scrollTo({ top: 0 });
    return;
  }
  document.title = `${trip.title} · XenoTravel`;
  renderTripSwitcher();
  if (prefs.page === 'plan') {
    if (!$('#days').childElementCount) {
      renderPlanEmpty();
      renderDays();
    }
    setTimeout(() => map.invalidateSize(), 0);
  } else clearPlanDom();
  if (prefs.page === 'budget') {
    renderBudget();
    const b = trip.budget;
    if (!ui.readonly && b.currency !== 'KRW' && !(b.krwPerUnit > 0) && !B.needsCurrency(trip)) fetchRate({ quiet: true }); // 처음 열 때 환율 자동으로
  }
  if (prefs.page === 'check') {
    renderChecks();
    renderBadge();
  }
  if (scroll) window.scrollTo({ top: 0 });
}
$$('button.pg').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));

/**
 * 밝기 전환. 색은 CSS 변수라 바로 바뀐다. 바뀌는 순간에는 화면 전체의 색 전환 애니메이션(transition)을 끈다
 * (요소마다 배경·테두리 색이 0.15초씩 따로 바뀌면서 느리게 보이던 것). 일정 목록·지도는 다시 그리지 않고 타일만 바꾼다.
 */
function withoutTransitions(fn) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  fn();
  // 새 색으로 한 번 그린 다음 프레임에 원래 전환 효과를 돌려준다
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}
function syncBrowserTheme() {
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
function applyTheme() {
  const th = isDark() ? 'dark' : 'light';
  document.documentElement.dataset.theme = th;
  document.documentElement.classList.toggle('dark', th === 'dark');
  syncBrowserTheme();
  const btn = $('#themeBtn');
  btn.setAttribute('aria-pressed', String(th === 'dark'));
  const label = th === 'dark' ? t('어둡게 (누르면 밝게)') : t('밝게 (누르면 어둡게)');
  btn.title = label;
  btn.setAttribute('aria-label', `${t('화면 밝기')}: ${label}`);
  $('#themeMenu').textContent = `${t('화면 밝기')}: ${label}`;
}
$('#themeBtn').addEventListener('click', () => {
  prefs.theme = isDark() ? 'light' : 'dark';
  savePrefs();
  withoutTransitions(() => {
    applyTheme();
    syncTiles();
  });
});

/** 언어 바꾸기: 화면 글자·문서 언어를 바로 바꾸고 이 브라우저에 기억한다 (기록한 통화·금액은 그대로). */
function applyLanguage() {
  const lang = getLang();
  document.documentElement.lang = LANGS[lang].html;
  // 샘플 일정 같은 내장 프리셋 이름도 이 언어로 (사용자가 고친 이름은 그대로)
  if (!ui.readonly && Object.values(store.trips).map((tr) => M.localizePresets(tr, lang)).some(Boolean)) saveNow();
  syncLanguageSwitch();
  applyStaticI18n();
  refreshDates();
  mapControlsText();
  applyView();
  applyTheme();
  renderNewTripModal();
  if (flightDialog.open) {
    flightFormLabels();
    renderFlightList();
  }
  if (shareDialog.open && ui.share) {
    const { title, line } = shareSummary(trip);
    $('#shareTitle').textContent = title;
    $('#shareLine').textContent = line;
    ui.share.message = shareMessage({ ...trip, title }, ui.share.url);
  }
  if (bulkDialog.open) renderBulk();
  if (privacyDialog.open) renderPrivacy();
  renderSaveBar();
  renderFooter();
  if (trip && prefs.page !== 'home') {
    render();
    showPage(prefs.page, { scroll: false });
  } else showPage('home', { scroll: false });
}
function syncLanguageSwitch() {
  for (const button of $$('#langSwitch [data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
}
$('#langSwitch').addEventListener('click', (e) => {
  const button = e.target.closest('[data-lang]');
  if (!button || button.dataset.lang === getLang()) return;
  setLang(button.dataset.lang);
  saveLang(); // 저장이 막혀도 이번 화면에서는 바뀐 언어로 계속 쓴다
  applyLanguage();
  button.focus({ preventScroll: true });
});

function renderBadge() {
  const n = trip && Array.isArray(trip.checks) ? C.pendingTodos(trip) : 0;
  for (const b of $$('.check-badge')) {
    b.hidden = !n;
    b.textContent = n;
    b.setAttribute('aria-label', t('남은 할 일 {n}개', { n }));
  }
}

/* 입력 중인 값 지키기: 다시 그려도 [data-draft] 칸의 값·커서·포커스를 그대로 둔다 (다른 탭 반영·언어 전환 등) */
function keepDrafts(root, draw) {
  const drafts = $$('[data-draft]', root).map((el) => ({
    key: el.dataset.draft,
    value: el.value,
    focused: el === document.activeElement,
    sel: el === document.activeElement && 'selectionStart' in el ? [el.selectionStart, el.selectionEnd] : null,
  }));
  draw();
  for (const d of drafts) {
    const el = root.querySelector(`[data-draft="${CSS.escape(d.key)}"]`);
    if (!el) continue;
    if (d.value) el.value = d.value;
    if (d.focused) {
      el.focus({ preventScroll: true });
      if (d.sel) {
        try {
          el.setSelectionRange(...d.sel);
        } catch {
          /* 숫자 칸 등 */
        }
      }
    }
  }
}

/* ───────── 가계부 ─────────
 * 금액은 현지 통화(또는 원화)로 적고, 적는 순간의 환율로 원화도 같이 저장한다 (나중에 환율이 바뀌어도 그대로).
 * 돈 기록은 공유 링크에 넣지 않는다 (decodeShare가 일정만 꺼낸다).
 */
const RATE_API = 'https://open.er-api.com/v6/latest/KRW'; // 키 없이 쓰는 무료 환율 (하루 1회 갱신)
ui.bf = null; // 가계부 입력 상태 { cur, cat, pay, day }

function budgetForm() {
  if (!ui.bf || ui.bf.trip !== trip.id) {
    const i = M.indexOfDate(trip, TODAY);
    ui.bf = { trip: trip.id, cur: 'local', cat: 'food', pay: 'card', day: i != null && i >= 0 && i < trip.days.length ? i : -1 };
  }
  if (ui.bf.day >= trip.days.length) ui.bf.day = -1;
  return ui.bf;
}

function barRows(map, defs, max) {
  const rows = Object.entries(defs)
    .map(([k, d]) => ({ k, d, v: map[k] ?? 0 }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return `<p class="empty-note">${esc(t('기록이 생기면 보여요'))}</p>`;
  return `<div class="bars">${rows
    .map((r) => `<div class="bar-row"><span class="lbl">${esc(t(r.d.label))}</span><span class="bar" aria-hidden="true"><i style="width:${(r.v / max) * 100}%"></i></span><span class="v">${B.won(r.v)}</span></div>`)
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
      return `<div class="bar-row plan-row"><span class="lbl">${esc(t(B.EXPENSE_CATS[k].label))}</span>
        <span class="bar${over ? ' over' : ''}" aria-hidden="true"><i style="width:${(sp / max) * 100}%"></i>${pl ? `<em style="left:${(pl / max) * 100}%"></em>` : ''}</span>
        <span class="v">${B.won(sp)}<small>${pl ? ` / ${B.won(pl)}` : ''}</small></span></div>`;
    })
    .join('')}</div><p class="fine">${esc(t('막대는 쓴 돈, 세로 눈금은 장소·체크리스트 예상이에요.'))}</p>`;
}

/** 예산 칸: 예산 없음 · 남음 · 딱 맞게 다 씀 · 초과 (문구와 색이 상태와 같게) */
function budgetTileHtml(b, s) {
  const state = B.budgetState(b.total, s.spent);
  const pct = b.total ? Math.min(999, Math.round((s.spent / b.total) * 100)) : 0;
  const tile = {
    unset: { cls: 'neutral', label: t('남은 예산'), value: '—', note: t('예산을 넣으면 계산해요') },
    within: { cls: 'ok', label: t('남은 예산'), value: B.won(s.left), note: t('{p}% 사용', { p: pct }) },
    reached: { cls: 'warn', label: t('예산 도달'), value: B.won(0), note: t('예산을 다 썼어요 (100%)') },
    over: { cls: 'hot', label: t('예산 초과'), value: B.won(-s.left), note: t('{p}% 사용', { p: pct }) },
  }[state];
  return `<div class="kpi ${tile.cls}" data-state="${state}"><span>${esc(tile.label)}</span><b>${tile.value}</b><small>${esc(tile.note)}</small></div>`;
}

function currencyOptions(selected) {
  return Object.entries(B.CURRENCIES)
    .map(([k, c]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${k} ${esc(t(c.name))}</option>`)
    .join('');
}

function renderBudget() {
  const el = $('#page-budget');
  keepDrafts(el, () => drawBudget(el));
  updateKrwPreview();
}

function drawBudget(el) {
  const b = B.ensureBudget(trip);
  const f = budgetForm();
  const cur = B.CURRENCIES[b.currency];
  const local = b.currency !== 'KRW';
  const useLocal = local && f.cur === 'local';
  const s = B.summarize(trip);
  const plan = B.combinePlans(C.planned(trip), B.placePlanned(trip));
  const hasOut = s.byDay.out != null || trip.expenses.some((e) => B.expenseDay(trip, e) === 'out');
  const dayKeys = [-1, ...trip.days.map((_, i) => i), ...(hasOut ? ['out'] : [])];
  const dayMax = Math.max(1, ...dayKeys.map((k) => s.byDay[k] ?? 0));
  const recs = [...trip.expenses].reverse();
  const dayLabel = (k) => (k === -1 ? t('출발 전') : k === 'out' ? t('일정 외') : dayName(k));
  const dayShort = (k) => (k === -1 ? t('전') : k === 'out' ? t('외') : `D${k + 1}`);
  const confirmCur = B.needsCurrency(trip);
  el.innerHTML = `<div class="wrap">
    <h1 class="page-h">${esc(t('예산 · 가계부'))}</h1>
    <p class="page-sub">${esc(t('금액만 넣고 기록하면 돼요. 현지 돈으로 적으면 그때 환율로 원화도 같이 저장돼요.'))}</p>
    ${
      confirmCur && !ui.readonly
        ? `<div class="cur-confirm" role="group" aria-labelledby="curConfirmTitle">
            <b id="curConfirmTitle">${esc(t('현지 통화를 확인해 주세요'))}</b>
            <p>${esc(t('여행지 "{dest}"만으로는 어느 나라 돈을 쓰는지 알 수 없어요. 첫 기록 전에 통화를 골라 주세요. 지금은 임시로 {code}예요.', { dest: trip.destination || t('여행'), code: b.currency }))}</p>
            <div class="cur-confirm-row"><select id="bConfirmCur" aria-label="${esc(t('현지 통화'))}">${currencyOptions(b.currency)}</select>
            <button class="btn primary" data-b="cur-ok">${esc(t('이 통화로 쓰기'))}</button></div>
          </div>`
        : ''
    }
    <div class="grid3 kpis kpis4">
      <label class="kpi"><span>${esc(t('1인 예산 (원)'))}</span><input id="bTotal" inputmode="numeric" value="${b.total ? num(b.total) : ''}" placeholder="${esc(t('예: 800,000'))}"></label>
      <button class="kpi plan${b.total && plan.total > b.total ? ' hot' : ''}" data-b="to-check" title="${esc(t('장소의 예상 비용과 체크리스트 가격이 여기에 잡혀요'))}">
        <span>${esc(t('예상 (장소·체크리스트)'))}</span><b>${plan.priced ? B.won(plan.total) : '—'}</b>
        <small>${plan.priced ? (b.total && plan.total > b.total ? esc(t('예산보다 {diff} 많아요', { diff: B.won(plan.total - b.total) })) : `${esc(t('{n}개 항목', { n: plan.priced }))}${plan.noRate ? ` · ${esc(t('환율 미정 {n}개', { n: plan.noRate }))}` : ''}`) : esc(t('장소나 체크리스트에 가격 넣기 →'))}</small>
      </button>
      <div class="kpi"><span>${esc(t('쓴 돈'))}</span><b>${B.won(s.spent)}</b><small>${esc(t('{n}건', { n: trip.expenses.length }))}${s.pending.count ? ` · <span class="pend">${esc(t('환율 미정 {n}건 ({amount})', { n: s.pending.count, amount: B.moneyCode(s.pending.amount, b.currency) }))}</span>` : ''}</small></div>
      ${budgetTileHtml(b, s)}
    </div>

    <div class="box" style="margin-top:14px">
      <div class="amount-row">
        ${local ? `<button class="cur-btn" data-b="cur" aria-label="${esc(t('통화 바꾸기: 지금 {cur}', { cur: useLocal ? b.currency : 'KRW' }))}" title="${esc(t('원화/{name} 바꾸기', { name: t(cur.name) }))}">${useLocal ? esc(cur.symbol.trim()) : '₩'}</button>` : '<span class="cur-btn" style="display:grid;place-items:center" aria-hidden="true">₩</span>'}
        <input id="bAmount" data-draft="amount" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="${esc(t('금액'))}" aria-describedby="bError bKrw">
        <span id="bKrw" class="krw" aria-live="polite"></span>
        <button class="btn primary" data-b="add">${esc(t('기록'))}</button>
      </div>
      <div class="rate-row">
        <select id="bCurrency" class="inp" aria-label="${esc(t('현지 통화'))}">${currencyOptions(b.currency)}</select>
        ${
          local
            ? `<span>${cur.unit === 1 ? '1' : cur.unit} ${esc(t(cur.name))} =</span>
               <input id="bRate" inputmode="decimal" value="${b.krwPerUnit ? +(b.krwPerUnit * cur.unit).toFixed(2) : ''}" placeholder="${esc(t('환율'))}" aria-label="${esc(t('환율 (원)'))}"> <span>${esc(t('원'))}</span>
               <button class="pill" data-b="rate">${esc(t('오늘 환율 받기'))}</button>
               <span>${b.rateAt ? `${esc(b.rateSource === 'auto' ? t('자동') : t('직접 입력'))} · ${esc(shortDate(b.rateAt.slice(0, 10)))}` : b.krwPerUnit ? '' : `<span class="pend">${esc(t('환율 미정'))}</span>`}</span>`
            : ''
        }
      </div>
      ${ui.rateError ? `<p class="form-error" role="alert">${esc(t('환율을 받아오지 못했어요. 인터넷 연결을 확인하고 다시 받거나, 환율을 직접 입력해 주세요. 그동안 적은 지출은 현지 돈으로 저장되고 원화는 “환율 미정”으로 표시돼요.'))} <button class="linkbtn" data-b="rate">${esc(t('다시 시도'))}</button></p>` : ''}
      <div class="chipset" role="group" aria-label="${esc(t('분류'))}">${Object.entries(B.EXPENSE_CATS)
        .map(([k, c]) => `<button class="${f.cat === k ? 'on' : ''}" aria-pressed="${f.cat === k}" data-b="cat" data-v="${k}">${esc(t(c.label))}</button>`)
        .join('')}</div>
      <div class="chipset" role="group" aria-label="${esc(t('결제 수단'))}">${Object.entries(B.PAYMENTS)
        .map(([k, c]) => `<button class="${f.pay === k ? 'on' : ''}" aria-pressed="${f.pay === k}" data-b="pay" data-v="${k}">${esc(t(c.label))}</button>`)
        .join('')}</div>
      <div class="memo-row">
        <input id="bMemo" data-draft="memo" placeholder="${esc(t('메모 (선택) · 예: 이치란 라멘'))}" aria-label="${esc(t('메모'))}" maxlength="80">
        <select id="bDay" class="inp" aria-label="${esc(t('언제'))}">${[-1, ...trip.days.map((_, i) => i)]
          .map((k) => `<option value="${k}"${k === f.day ? ' selected' : ''}>${esc(dayLabel(k))}</option>`)
          .join('')}</select>
      </div>
      <p id="bError" class="form-error" role="alert" hidden></p>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="box"><h3>${esc(plan.priced ? t('계획 대비') : t('분류별'))}</h3>${plan.priced ? planRows(s.byCat, plan.byCat) : barRows(s.byCat, B.EXPENSE_CATS, Math.max(1, ...Object.values(s.byCat)))}</div>
      <div class="box">
        <h3>${esc(t('날짜별'))}</h3>
        <div class="daybars" role="list">${dayKeys
          .map((k) => `<div role="listitem" title="${esc(dayLabel(k))} ${B.won(s.byDay[k] ?? 0)}" aria-label="${esc(dayLabel(k))} ${B.won(s.byDay[k] ?? 0)}"><i style="height:${((s.byDay[k] ?? 0) / dayMax) * 100}%"></i>${esc(dayShort(k))}</div>`)
          .join('')}</div>
        ${hasOut ? `<p class="fine">${esc(t('‘일정 외’는 여행 기간을 줄여 사라진 날의 지출이에요. 원래 날짜로 남아 있고 합계에 들어가요.'))}</p>` : ''}
        <h3 style="margin-top:16px">${esc(t('결제 수단'))}</h3>${barRows(s.byPay, B.PAYMENTS, Math.max(1, ...Object.values(s.byPay)))}
      </div>
    </div>

    <div class="box" style="margin-top:14px">
      <h3>${esc(t('기록'))} <button class="link" data-b="csv"${recs.length ? '' : ' hidden'}>${esc(t('CSV로 받기'))}</button></h3>
      ${
        recs.length
          ? `<ul class="rec-list">${recs
              .map((e) => {
                if (ui.editExpense === e.id && !ui.readonly) return expenseEditHtml(e);
                const c = B.EXPENSE_CATS[e.cat] ?? B.EXPENSE_CATS.etc;
                const pay = B.PAYMENTS[e.pay] ?? B.PAYMENTS.card;
                const orig = e.cur === 'KRW' ? '' : B.moneyCode(e.amount, b.currency);
                const link = e.checkId ? t('체크리스트') : e.placeId ? t('장소') : '';
                return `<li>
                  <span class="rec-main"><b>${esc(e.memo || t(c.label))}</b><small>${esc(B.expenseDayLabel(trip, e))} · ${esc(t(c.label))} · ${esc(t(pay.label))}${link ? ` · ${esc(link)}` : ''}</small></span>
                  <span class="rec-amt">${e.krw == null ? `<span class="pend">${esc(t('환율 미정'))}</span>` : B.won(e.krw)}${orig ? `<small>${esc(orig)}</small>` : ''}</span>
                  <span class="rec-acts"><button class="icon" data-b="edit" data-id="${e.id}" title="${esc(t('수정'))}" aria-label="${esc(t('{name} 수정', { name: e.memo || t(c.label) }))}">✎</button><button class="icon" data-b="del" data-id="${e.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: e.memo || t(c.label) }))}">✕</button></span></li>`;
              })
              .join('')}</ul>`
          : `<p class="empty-note">${esc(t('아직 기록된 지출이 없어요. 첫 지출을 추가해 보세요.'))}</p>`
      }
    </div>
    <p class="fine">${esc(t('가계부는 이 브라우저에만 저장되고 공유 링크에는 들어가지 않아요. 백업 파일에는 포함돼요. 자동 환율: ExchangeRate-API (하루 1번 갱신).'))}</p>
  </div>`;
}

/** 저장한 지출 고치기 (행 안에서) */
function expenseEditHtml(e) {
  const b = trip.budget;
  const local = b.currency !== 'KRW';
  const dk = B.expenseDay(trip, e);
  const days = [-1, ...trip.days.map((_, i) => i)];
  const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `<li class="rec-edit"><form class="exp-form" data-exp="${e.id}" aria-label="${esc(t('지출 수정'))}">
      <div class="exp-row">
        <label class="exp-amt"><span>${esc(t('금액'))}</span><input name="amount" data-draft="exp-amount-${e.id}" inputmode="decimal" value="${e.amount}" autocomplete="off"></label>
        ${local ? `<label><span>${esc(t('통화'))}</span><select name="cur">${opt('local', `${B.CURRENCIES[b.currency].symbol.trim()} ${b.currency}`, e.cur !== 'KRW')}${opt('KRW', '₩ KRW', e.cur === 'KRW')}</select></label>` : ''}
      </div>
      <label><span>${esc(t('메모'))}</span><input name="memo" data-draft="exp-memo-${e.id}" value="${esc(e.memo)}" maxlength="80"></label>
      <div class="exp-row">
        <label><span>${esc(t('언제'))}</span><select name="day">${dk === 'out' ? opt('out', B.expenseDayLabel(trip, e), true) : ''}${days.map((d) => opt(d, d < 0 ? t('출발 전') : dayName(d), d === dk)).join('')}</select></label>
        <label><span>${esc(t('분류'))}</span><select name="cat">${Object.entries(B.EXPENSE_CATS).map(([key, c]) => opt(key, t(c.label), key === e.cat)).join('')}</select></label>
        <label><span>${esc(t('결제 수단'))}</span><select name="pay">${Object.entries(B.PAYMENTS).map(([key, c]) => opt(key, t(c.label), key === e.pay)).join('')}</select></label>
      </div>
      <p class="exp-krw" role="status">${esc(expensePreviewText(e, e.amount, e.cur))}</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="exp-actions"><button type="button" class="btn ghost" data-b="edit-cancel">${esc(t('취소'))}</button><button class="btn primary">${esc(t('저장'))}</button></div>
    </form></li>`;
}

/** 고치는 중: 원화가 어떻게 계산될지 미리 보여준다 */
function expensePreviewText(e, amount, cur) {
  const same = B.parseAmount(amount) === e.amount && cur === e.cur;
  if (same) return e.krw == null ? t('원화: 환율 미정') : t('원화 {krw} (기록 당시 그대로)', { krw: B.won(e.krw) });
  const p = B.expenseKrwPreview(trip, e, { amount, cur });
  if (!p) return '';
  if (p.source === 'krw') return t('원화 {krw}', { krw: B.won(p.krw) });
  if (p.source === 'none') return t('원화: 환율 미정 (환율을 정하면 채워져요)');
  const unit = B.CURRENCIES[trip.budget.currency].unit;
  const rate = `${unit} ${t(B.CURRENCIES[trip.budget.currency].name)} = ${num(p.rate * unit, { maximumFractionDigits: 2 })} KRW`;
  return t(p.source === 'recorded' ? k('원화 {krw} · 기록 당시 환율 {rate}') : k('원화 {krw} · 지금 환율 {rate}'), { krw: B.won(p.krw), rate });
}

function updateKrwPreview() {
  const out = $('#bKrw');
  if (!out || !trip) return;
  const raw = $('#bAmount')?.value ?? '';
  const amt = B.parseAmount(raw);
  const b = trip.budget;
  const local = b.currency !== 'KRW' && ui.bf.cur === 'local';
  if (!(amt > 0) || !local) return void (out.textContent = '');
  const krw = B.toKrw(amt, 'local', b);
  out.textContent = krw != null ? `≈ ${B.won(krw)}` : t('환율 미정 · 원화는 나중에 채워져요');
}

async function fetchRate({ quiet = false } = {}) {
  const b = trip.budget;
  if (b.currency === 'KRW') return;
  const forTrip = trip;
  try {
    const r = await fetch(RATE_API, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    const per = data?.rates?.[b.currency];
    if (!(per > 0)) throw new Error('no rate');
    if (trip !== forTrip) return;
    b.krwPerUnit = 1 / per;
    b.rateSource = 'auto';
    b.rateAt = new Date().toISOString();
    ui.rateError = false;
    const filled = B.fillPendingKrw(trip);
    const res = commit();
    if (filled) saved(res, t('환율을 받아서 환율 미정이던 {n}건을 원화로 계산했어요', { n: filled }), 3200);
    else if (!quiet) saved(res, t('환율을 받았어요: {rate}', { rate: B.rateLabel(b) }));
  } catch {
    if (trip !== forTrip) return;
    ui.rateError = !quiet || ui.rateError;
    if (!quiet && prefs.page === 'budget') renderBudget();
  }
}

function addExpenseFromForm() {
  const b = trip.budget;
  const err = $('#bError');
  if (B.needsCurrency(trip)) {
    err.textContent = t('먼저 위에서 현지 통화를 확인해 주세요');
    err.hidden = false;
    $('#bConfirmCur')?.focus();
    return;
  }
  const data = { amount: $('#bAmount').value, cur: ui.bf.cur === 'local' && b.currency !== 'KRW' ? 'local' : 'KRW', cat: ui.bf.cat, pay: ui.bf.pay, day: ui.bf.day, memo: $('#bMemo').value };
  const problem = B.expenseProblem(data, b);
  if (problem) {
    err.textContent = problem;
    err.hidden = false;
    $('#bAmount').setAttribute('aria-invalid', 'true');
    $('#bAmount').focus();
    return;
  }
  const e = B.addExpense(trip, data);
  const r = commit();
  if (!r.ok) return; // 저장하지 못함: 위 안내를 본다 (입력한 지출은 화면에 남아 있다)
  $('#bAmount').value = '';
  $('#bMemo').value = '';
  updateKrwPreview();
  toast(e.krw == null ? t('{amount} 기록했어요. 원화는 환율을 받으면 계산해요', { amount: B.moneyCode(e.amount, b.currency) }) : t('{amount} 기록했어요', { amount: B.won(e.krw) }), e.krw == null ? 3200 : 2200);
  $('#bAmount')?.focus();
}

$('#page-budget').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-b]');
  if (!btn || !trip) return;
  const f = budgetForm();
  const act = btn.dataset.b;
  if (act === 'cat' || act === 'pay') {
    f[act] = btn.dataset.v;
    $$(`[data-b="${act}"]`, $('#page-budget')).forEach((x) => {
      x.classList.toggle('on', x === btn);
      x.setAttribute('aria-pressed', String(x === btn));
    });
  } else if (act === 'cur') {
    f.cur = f.cur === 'local' ? 'KRW' : 'local';
    renderBudget();
    $('#page-budget [data-b="cur"]')?.focus();
  } else if (act === 'cur-ok') {
    B.confirmCurrency(trip, $('#bConfirmCur').value);
    saved(commit(), t('현지 통화를 {code}(으)로 정했어요', { code: trip.budget.currency }));
    if (trip.budget.currency !== 'KRW' && !(trip.budget.krwPerUnit > 0)) fetchRate({ quiet: true });
    $('#bAmount')?.focus();
  } else if (act === 'add') addExpenseFromForm();
  else if (act === 'rate') fetchRate();
  else if (act === 'edit') {
    ui.editExpense = btn.dataset.id;
    renderBudget();
    $(`#page-budget .exp-form[data-exp="${CSS.escape(btn.dataset.id)}"] input[name="amount"]`)?.focus();
  } else if (act === 'edit-cancel') {
    const id = ui.editExpense;
    ui.editExpense = null;
    renderBudget();
    $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
  }
  else if (act === 'to-check') go('check');
  else if (act === 'del') {
    const ex = trip.expenses.find((x) => x.id === btn.dataset.id);
    const linked = ex?.checkId && trip.checks?.find((c) => c.id === ex.checkId);
    if (confirm(linked ? t('이 기록을 지울까요? 체크리스트의 "{text}" 체크도 풀려요.', { text: linked.text }) : t('이 기록을 지울까요?'))) {
      B.removeExpense(trip, btn.dataset.id);
      if (linked) linked.done = false; // 체크리스트와 맞춘다
      commit();
    }
  } else if (act === 'csv') {
    const blob = new Blob([B.expensesCsv(trip)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${M.safeFileName(trip.title)}-${t('가계부')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
});
$('#page-budget').addEventListener('submit', (ev) => {
  const form = ev.target.closest('.exp-form');
  if (!form) return;
  ev.preventDefault();
  const id = form.dataset.exp;
  const data = Object.fromEntries(new FormData(form));
  const problem = B.amountProblem(data.amount);
  const err = $('.form-error', form);
  if (problem) {
    err.textContent = problem;
    err.hidden = false;
    form.amount.setAttribute('aria-invalid', 'true');
    form.amount.focus();
    return;
  }
  const e = B.updateExpense(trip, id, data);
  if (!e) return;
  const linked = e.checkId && trip.checks?.find((c) => c.id === e.checkId);
  ui.editExpense = null;
  const r = commit();
  if (!r.ok) ui.editExpense = id; // 저장 실패: 고치던 칸을 그대로 열어 둔다 (위 안내 참고)
  else {
    toast(t('지출을 고쳤어요'));
    $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
  }
  void linked;
});
$('#page-budget').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.editExpense) {
    const id = ui.editExpense;
    ui.editExpense = null;
    renderBudget();
    $(`#page-budget [data-b="edit"][data-id="${CSS.escape(id)}"]`)?.focus();
  }
});
$('#page-budget').addEventListener('input', (e) => {
  const form = e.target.closest('.exp-form');
  if (form) {
    const ex = trip.expenses.find((x) => x.id === form.dataset.exp);
    const amt = form.amount.value;
    const problem = amt.trim() ? B.amountProblem(amt) : B.amountProblem('');
    const err = $('.form-error', form);
    err.hidden = !problem;
    err.textContent = problem ?? '';
    $('.exp-krw', form).textContent = problem ? '' : expensePreviewText(ex, amt, form.cur?.value ?? ex.cur);
    return;
  }
  if (e.target.id === 'bAmount') {
    updateKrwPreview();
    const v = e.target.value;
    const problem = v.trim() ? B.amountProblem(v) : null;
    const err = $('#bError');
    err.hidden = !problem;
    err.textContent = problem ?? '';
    if (problem) e.target.setAttribute('aria-invalid', 'true');
    else e.target.removeAttribute('aria-invalid');
  }
});
$('#page-budget').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'bAmount' || e.target.id === 'bMemo')) {
    e.preventDefault();
    addExpenseFromForm();
  }
});
$('#page-budget').addEventListener('change', (e) => {
  const form = e.target.closest('.exp-form');
  if (form) {
    const ex = trip.expenses.find((x) => x.id === form.dataset.exp);
    if (!B.amountProblem(form.amount.value)) $('.exp-krw', form).textContent = expensePreviewText(ex, form.amount.value, form.cur?.value ?? ex.cur);
    return;
  }
  const b = trip.budget;
  if (e.target.id === 'bTotal') {
    const v = B.parseAmount(e.target.value);
    if (v != null && !(v >= 0 && v <= B.MAX_AMOUNT)) {
      toast(t('예산은 0 이상 {max} 이하 숫자로 넣어 주세요', { max: num(B.MAX_AMOUNT) }), 3200);
      e.target.value = b.total ? num(b.total) : '';
      return;
    }
    b.total = Math.max(0, Math.round(v || 0));
    commit();
  } else if (e.target.id === 'bRate') {
    const v = B.parseAmount(e.target.value);
    if (v != null && !(v > 0)) {
      toast(t('환율은 0보다 큰 숫자로 넣어 주세요'), 3200);
      return renderBudget();
    }
    b.krwPerUnit = v > 0 ? v / B.CURRENCIES[b.currency].unit : 0;
    b.rateSource = 'manual';
    b.rateAt = new Date().toISOString();
    ui.rateError = false;
    const filled = B.fillPendingKrw(trip);
    saved(commit(), filled ? t('환율 미정이던 {n}건을 원화로 계산했어요', { n: filled }) : '');
  } else if (e.target.id === 'bCurrency') {
    B.confirmCurrency(trip, e.target.value);
    commit();
    fetchRate({ quiet: true });
  } else if (e.target.id === 'bDay') {
    budgetForm().day = Number(e.target.value);
  }
});

/* ───────── 체크리스트 ─────────
 * 체크 = 할 일 완료(쇼핑은 샀음). 예상 가격이 있는 항목을 체크하면 그 금액으로 가계부에 실제 결제가 기록된다.
 * 실제로 낸 돈이 다르면 '결제' 칩에서 고친다 (예상 가격은 그대로). 체크를 풀 때는 그 지출을 지울지 남길지 묻는다.
 */
/** 나라별 추천 쇼핑 목록 담기 버튼 (아직 안 담은 품목이 있는 목록만) */
function picksHtml() {
  if (ui.readonly) return '';
  return C.shopPickSets(trip)
    .map((set) => {
      const n = C.missingPicks(trip, set).length;
      if (!n) return '';
      return `<button class="picks-btn" data-c="picks" data-set="${esc(set.id)}">${esc(t('{title} {n}개 담기', { title: t(set.title), n }))}<small>${esc(t(set.note || k('한국 여행자들이 많이 사는 품목이에요')))}</small></button>`;
    })
    .join('');
}

ui.editPrice = null; // 가격을 고치는 중인 체크 항목 id
ui.editPaid = null; // 실제 결제 금액을 고치는 중인 체크 항목 id
ui.priceCur = 'local';

/** 체크 항목 가격 표시: "¥1,000 JPY" (원화로 적었으면 "₩25,000") */
function priceLabel(c) {
  if (!(c.price > 0)) return '';
  const budget = B.ensureBudget(trip);
  return c.cur === 'KRW' || budget.currency === 'KRW' ? B.won(c.price) : B.moneyCode(c.price, budget.currency);
}
const expenseLabel = (e) => (e.cur === 'KRW' ? B.won(e.amount) : B.moneyCode(e.amount, trip.budget.currency));

function checkRowHtml(c) {
  const budget = B.ensureBudget(trip);
  const local = budget.currency !== 'KRW';
  const paid = c.done ? C.linkedExpense(trip, c.id) : null;
  let price;
  if (ui.editPrice === c.id || ui.editPaid === c.id) {
    const paidMode = ui.editPaid === c.id;
    const cur = paidMode ? (paid?.cur === 'KRW' ? 'KRW' : 'local') : local ? ui.priceCur : 'KRW';
    const sym = cur === 'KRW' ? '₩' : B.CURRENCIES[budget.currency].symbol.trim();
    price = `<form class="price-form" data-id="${c.id}" data-mode="${paidMode ? 'paid' : 'price'}">
        ${local && !paidMode ? `<button type="button" class="cur-mini" data-c="pcur" aria-label="${esc(t('통화 바꾸기: 지금 {cur}', { cur: cur === 'KRW' ? 'KRW' : budget.currency }))}">${esc(sym)}</button>` : `<span class="cur-mini" aria-hidden="true">${esc(sym)}</span>`}
        <input name="amt" data-draft="price-${c.id}" inputmode="decimal" autocomplete="off" aria-label="${esc(paidMode ? t('{name} 실제 결제 금액', { name: C.checkText(c) }) : t('{name} 예상 가격', { name: C.checkText(c) }))}" placeholder="${esc(paidMode ? t('실제 결제') : t('예상 가격'))}" value="${paidMode ? paid?.amount ?? '' : c.price > 0 ? c.price : ''}">
        <button class="ok">${esc(t('확인'))}</button>
      </form>`;
  } else {
    price = `<button class="price-chip${c.price > 0 ? ' set' : ''}" data-c="price" data-id="${c.id}" title="${esc(t('예상 가격 (가계부 예상에 잡혀요)'))}" aria-label="${esc(c.price > 0 ? t('{name} 예상 가격 {amount} 고치기', { name: C.checkText(c), amount: priceLabel(c) }) : t('{name} 예상 가격 넣기', { name: C.checkText(c) }))}">${c.price > 0 ? `${esc(t('예상'))} ${esc(priceLabel(c))}` : esc(t('+ 가격'))}</button>`;
    if (paid) price += `<button class="price-chip paid" data-c="paid" data-id="${c.id}" title="${esc(t('가계부에 기록된 실제 결제 금액이에요. 눌러서 고쳐요'))}" aria-label="${esc(t('{name} 실제 결제 {amount} 고치기', { name: C.checkText(c), amount: expenseLabel(paid) }))}">${esc(t('결제'))} ${esc(expenseLabel(paid))}</button>`;
  }
  return `<li class="${c.done ? 'done' : ''}${ui.editPrice === c.id || ui.editPaid === c.id ? ' editing' : ''}">
      <label><input type="checkbox" data-c="toggle" data-id="${c.id}"${c.done ? ' checked' : ''}><span>${esc(C.checkText(c))}</span></label>
      ${price}
      <button class="icon" data-c="del" data-id="${c.id}" title="${esc(t('지우기'))}" aria-label="${esc(t('{name} 삭제', { name: C.checkText(c) }))}">✕</button>
    </li>`;
}

const checkViews = new Map();
const checkShortLabels = () => ({ todo: t('출발 전 체크'), pack: t('짐 싸기'), shop: t('쇼핑') });

function checkView(id = trip.id) {
  if (!checkViews.has(id)) checkViews.set(id, { group: 'todo', drafts: {} });
  return checkViews.get(id);
}

function renderChecks() {
  const before = JSON.stringify([trip.checksV, trip.checks?.length]);
  C.ensureChecks(trip);
  // 처음 만들었거나 예전 자동 쇼핑 목록을 정리했으면 저장
  if (!ui.readonly && before !== JSON.stringify([trip.checksV, trip.checks.length])) {
    store.trips[trip.id] = trip;
    persistSoon();
  }
  const el = $('#page-check');
  if (el.dataset.trip === trip.id) keepDrafts(el, () => drawChecks(el));
  else {
    if (el.dataset.trip) {
      const previous = checkView(el.dataset.trip);
      previous.drafts = Object.fromEntries($$('[data-draft]', el).map((input) => [input.dataset.draft, input.value]));
      previous.editor = { editPrice: ui.editPrice, editPaid: ui.editPaid, priceCur: ui.priceCur };
    }
    const view = checkView();
    ui.editPrice = view.editor?.editPrice ?? null;
    ui.editPaid = view.editor?.editPaid ?? null;
    ui.priceCur = view.editor?.priceCur;
    el.dataset.trip = trip.id;
    drawChecks(el);
    for (const input of $$('[data-draft]', el)) input.value = view.drafts[input.dataset.draft] ?? input.value;
  }
  if (ui.editPrice || ui.editPaid) {
    const input = $(`#page-check .price-form[data-id="${ui.editPrice || ui.editPaid}"] input`);
    if (document.activeElement !== input) {
      input?.focus();
      input?.select();
    }
  }
}

function drawChecks(el) {
  const plan = C.planned(trip);
  const active = checkView().group;
  const groups = Object.entries(C.CHECK_GROUPS);
  const shortLabels = checkShortLabels();
  el.innerHTML = `<div class="wrap">
    <h1 class="page-h">${esc(t('체크리스트'))}</h1>
    <ul class="page-sub check-legend">
      <li><b>${esc(t('체크'))}</b> ${esc(t('할 일을 끝냈거나 샀다는 표시예요.'))}</li>
      <li><b>${esc(t('예상'))}</b> ${esc(t('가격을 넣으면 가계부 “예상”에 잡혀요.'))}</li>
      <li><b>${esc(t('결제'))}</b> ${esc(t('가격이 있는 항목을 체크하면 그 금액이 가계부에 실제 지출로 기록돼요. 실제로 낸 돈이 다르면 ‘결제’ 금액을 고치세요.'))}</li>
    </ul>
    ${
      plan.priced
        ? `<div class="plan-bar"><span>${esc(t('체크리스트 예상'))} <b>${B.won(plan.total)}</b>${plan.noRate ? ` <small>(${esc(t('환율이 없어 {n}개 빠짐', { n: plan.noRate }))})</small>` : ''}</span><button class="linkbtn" data-c="to-budget">${esc(t('가계부에서 보기 →'))}</button></div>`
        : ''
    }
    <div class="check-tabs" role="group" aria-label="${esc(t('체크리스트'))}">${groups.map(([g, def]) => {
      const { done, total } = C.progress(trip, g);
      return `<button data-c="tab" data-group="${g}" aria-controls="check-panel-${g}" aria-pressed="${g === active}" aria-label="${esc(`${t(def.label)} ${done}/${total}`)}" class="${total && done === total ? 'complete' : ''}"><span>${esc(shortLabels[g])}</span> <b>${done}/${total}</b></button>`;
    }).join('')}</div>
    <div class="grid3 check-grid">${groups
      .map(([g, def]) => {
        const p = C.progress(trip, g);
        const list = trip.checks.filter((c) => c.group === g);
        const sum = plan.byGroup[g] ?? 0;
        return `<section class="box" id="check-panel-${g}" data-active="${g === active}" aria-labelledby="chk-${g}">
          <header class="check-top">
            <h3 class="check-head" id="chk-${g}">${esc(t(def.label))}<span class="count">${p.done}/${p.total}</span></h3>
            <div class="bulk">
              <button data-c="toggle-group" data-group="${g}" ${p.total ? '' : 'disabled'}>${esc(p.total && p.done === p.total ? t('전체 해제') : t('전체 체크'))}</button>
              <button data-c="delete-group" data-group="${g}" ${p.total ? '' : 'disabled'}>${esc(t('삭제'))}</button>
            </div>
          </header>
          <div class="cprog" aria-hidden="true"><i style="width:${p.total ? (p.done / p.total) * 100 : 0}%"></i></div>
          <ul class="checks">${list.map(checkRowHtml).join('')}</ul>
          ${list.length ? '' : `<p class="empty-note">${esc(t('아직 항목이 없어요. 아래에서 추가하세요.'))}</p>`}
          ${sum ? `<p class="check-sum">${esc(t('예상 합계'))} <b>${B.won(sum)}</b></p>` : ''}
          ${g === 'shop' ? picksHtml() : ''}
          <form class="addrow" data-group="${g}"><input name="text" data-draft="add-${g}" placeholder="${esc(t(def.placeholder))}" aria-label="${esc(t(def.placeholder))}" maxlength="80" autocomplete="off"><button>${esc(t('추가'))}</button></form>
        </section>`;
      })
      .join('')}</div>
  </div>`;
}

function savePrice(form) {
  const id = form.dataset.id;
  const v = form.amt.value;
  const problem = v.trim() ? B.amountProblem(v) : null;
  if (problem) {
    toast(problem, 3200);
    form.amt.focus();
    return;
  }
  if (form.dataset.mode === 'paid') {
    const e = C.linkedExpense(trip, id);
    ui.editPaid = null;
    if (e && v.trim()) B.updateExpenseAmount(trip, e.id, v);
    return void saved(commit(), e && v.trim() ? t('실제 결제 금액을 {amount}(으)로 고쳤어요', { amount: expenseLabel(e) }) : '');
  }
  const c = C.setPrice(trip, id, v, ui.priceCur);
  ui.editPrice = null;
  const r = commit();
  if (c?.price && B.toKrw(c.price, c.cur, trip.budget) == null) saved(r, t('가계부에서 환율을 정하면 원화 예상에 잡혀요'), 3200);
}

$('#page-check').addEventListener('change', (e) => {
  if (e.target.dataset.c !== 'toggle') return;
  const id = e.target.dataset.id;
  const c = trip.checks.find((x) => x.id === id);
  const linked = c?.done ? C.linkedExpense(trip, id) : null;
  const r = C.toggleCheck(trip, id, TODAY);
  const res = commit();
  $(`#page-check [data-c="toggle"][data-id="${CSS.escape(id)}"]`)?.focus();
  if (r.expense) saved(res, `${r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: B.won(r.expense.krw) })} · ${t('금액이 달랐다면 ‘결제’를 눌러 고치세요')}`, 3500);
  else if (linked) saved(res, t('체크를 풀었어요. 가계부 지출은 그대로 남겼어요'));
});
async function changeCheckGroup(group, action) {
  const id = trip.id;
  const items = () => trip.checks.filter((c) => c.group === group);
  const entries = items();
  if (!entries.length || ui.readonly || askDialog.open) return;
  const done = entries.filter((c) => c.done);
  const linked = (checks) => checks.map((c) => C.linkedExpense(trip, c.id)).filter(Boolean);
  const snapshot = () => JSON.stringify([items(), linked(items())]);
  const before = snapshot();
  const valid = () => trip?.id === id && !ui.readonly && prefs.page === 'check' && snapshot() === before;
  const restoreFocus = () => {
    const control = $(`#page-check [data-c="${action}"][data-group="${group}"]`);
    (control?.disabled ? $(`#check-panel-${group} .addrow input`) : control)?.focus({ preventScroll: true });
  };
  if (action === 'toggle-group') {
    const next = done.length !== entries.length;
    const expenses = linked(done);
    if (!next && expenses.length) {
      const choice = await ask({
        title: t('전체 해제'),
        body: t('연결된 지출 {n}건: {amounts}', { n: expenses.length, amounts: expenses.map(expenseLabel).join(', ') }),
        actions: [
          { value: 'keep', label: t('체크만 해제'), primary: true },
        ],
      });
      if (!choice || !valid()) return;
    }
    C.setGroupDone(trip, group, next, TODAY);
    saved(commit(), next ? t('{n}개를 체크했어요', { n: entries.length - done.length }) : t('{n}개를 해제했어요', { n: done.length }));
    restoreFocus();
    return;
  }
  const kept = (checks) => t('기록된 실제 지출 {n}건은 가계부에 남아요', { n: linked(checks).length });
  const choice = await ask({
    title: done.length ? t('완료한 {n}개 항목을 삭제할까요?', { n: done.length }) : t('삭제'),
    body: done.length ? kept(done) : t('완료한 항목 없음'),
    actions: [
      ...(done.length ? [{ value: 'done', label: t('완료한 {n}개 삭제', { n: done.length }), primary: true }] : []),
      { value: 'all', label: t('전체 {n}개 삭제', { n: entries.length }), danger: true },
    ],
  });
  if (!choice || !valid()) return;
  if (choice === 'all') {
    const confirmed = await ask({
      title: t('전체 {n}개 항목을 삭제할까요?', { n: entries.length }),
      body: kept(entries),
      actions: [{ value: 'all', label: t('전체 삭제'), danger: true }],
    });
    if (!confirmed || !valid()) return;
  }
  const n = choice === 'all' ? C.clearGroup(trip, group) : C.removeDone(trip, group);
  saved(commit(), t('{n}개를 지웠어요', { n }));
  restoreFocus();
}

$('#page-check').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-c="picks"]');
  if (pick) {
    const set = C.shopPickSets(trip).find((x) => x.id === pick.dataset.set);
    const n = C.addPicks(trip, pick.dataset.set);
    saved(commit(), t('{title} {n}개를 쇼핑 리스트에 담았어요', { title: t(set.title), n }));
    return;
  }
  const btn = e.target.closest('[data-c]');
  if (!btn) return;
  const act = btn.dataset.c;
  const g = btn.dataset.group;
  if (act === 'tab') {
    checkView().group = g;
    for (const tab of $$('.check-tabs button')) tab.setAttribute('aria-pressed', String(tab.dataset.group === g));
    for (const panel of $$('.check-grid > section')) panel.dataset.active = String(panel.id === `check-panel-${g}`);
  } else if (act === 'del') {
    C.removeCheck(trip, btn.dataset.id);
    commit();
  } else if (act === 'price') {
    const c = trip.checks.find((x) => x.id === btn.dataset.id);
    ui.editPrice = btn.dataset.id;
    ui.editPaid = null;
    ui.priceCur = c?.cur ?? (B.ensureBudget(trip).currency === 'KRW' ? 'KRW' : 'local');
    renderChecks();
  } else if (act === 'paid') {
    ui.editPaid = btn.dataset.id;
    ui.editPrice = null;
    renderChecks();
  } else if (act === 'pcur') {
    ui.priceCur = ui.priceCur === 'KRW' ? 'local' : 'KRW';
    btn.textContent = ui.priceCur === 'KRW' ? '₩' : B.CURRENCIES[trip.budget.currency].symbol.trim();
    btn.nextElementSibling?.focus();
  } else if (act === 'delete-group' || act === 'toggle-group') {
    void changeCheckGroup(g, act);
  } else if (act === 'to-budget') go('budget');
});
$('#page-check').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  if (form.classList.contains('price-form')) return savePrice(form);
  const input = form.text;
  if (!C.addCheck(trip, form.dataset.group, input.value)) return;
  const g = form.dataset.group;
  input.value = '';
  commit();
  $(`#page-check form[data-group="${g}"] input`)?.focus();
});
$('#page-check').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (ui.editPrice || ui.editPaid)) {
    const id = ui.editPrice || ui.editPaid;
    ui.editPrice = ui.editPaid = null;
    renderChecks();
    $(`#page-check [data-id="${CSS.escape(id)}"].price-chip`)?.focus();
  }
});
// 가격 칸 밖을 누르면 입력한 값으로 저장
$('#page-check').addEventListener('focusout', (e) => {
  const form = e.target.closest('.price-form');
  if (!form || form.contains(e.relatedTarget) || e.relatedTarget?.closest?.('.check-tabs, .pg, #tripSw, #tripsBtn')) return;
  const id = trip?.id;
  setTimeout(() => {
    if (trip?.id === id && prefs.page === 'check' && (ui.editPrice === form.dataset.id || ui.editPaid === form.dataset.id) && document.contains(form) && !askDialog.open) savePrice(form);
  }, 0);
});

/* ───────── 공유 링크 ─────────
 * 보내기: 짧은 링크 서버가 있는 곳(server.js)에서만 일정 사본을 서버에 맡기고 /s/<id>를 받는다.
 *   서버가 없는 곳(정적 호스팅, 지금 배포)에서는 서버로 보내지 않고 사본을 URL # 뒤에 담은 긴 링크를 만든다.
 *   (# 뒤는 브라우저가 서버로 보내지 않는다)
 * 받기: /s/<id> 또는 #s=… 로 열리면 보기 전용으로 보여주고, 원하면 "내 여행으로 저장"으로 사본을 만든다.
 */
const shareDialog = $('#shareDialog');
const SHARE_PATH = /\/s\/([A-Za-z0-9]{8})\/?$/;
const appBase = () => new URL('./', document.baseURI).href; // /s/<id> 페이지에서도 앱 루트
ui.share = null;
let shareRequest = 0;

/** 짧은 링크 서버가 있는지 먼저 묻는다 (없으면 일정 사본을 아무 데도 보내지 않는다) */
let shareServer = null;
async function hasShareServer() {
  if (shareServer != null) return shareServer;
  try {
    const r = await fetch(new URL('api/share', appBase()), { signal: AbortSignal.timeout(3000) });
    shareServer = r.ok && (await r.json())?.ok === true;
  } catch {
    shareServer = false;
  }
  return shareServer;
}

async function createShareUrl(code) {
  if (await hasShareServer()) {
    try {
      const r = await fetch(new URL('api/share', appBase()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return new URL((await r.json()).path, appBase()).href;
    } catch {
      /* 서버 문제 → 긴 링크 */
    }
  }
  return shareUrl(appBase(), code);
}

async function updateShare() {
  const request = ++shareRequest;
  const source = trip;
  const includePrivate = !$('#shareExcludePrivate').checked;
  const { title, line } = shareSummary(source);
  $('#shareTitle').textContent = title;
  $('#shareLine').textContent = line;
  $('#shareLink').textContent = t('링크 만드는 중…');
  for (const id of ['shareCopy', 'shareCopyLink', 'shareNative']) $(`#${id}`).disabled = true;
  for (const id of ['shareLong', 'shareTooLong', 'shareFile', 'shareError']) $(`#${id}`).hidden = true;
  ui.share = null;
  try {
    const code = await encodeShare(source, { includePrivate });
    const url = await createShareUrl(code);
    if (request !== shareRequest || !shareDialog.open) return;
    ui.share = { url, title, line, code, includePrivate, message: shareMessage({ ...source, title }, url) };
    $('#shareLink').textContent = url;
    $('#shareLong').hidden = !url.includes('#s=');
    const tooLong = !$('#shareLong').hidden && url.length > 2000;
    $('#shareTooLong').hidden = $('#shareFile').hidden = !tooLong;
    for (const id of ['shareCopy', 'shareCopyLink', 'shareNative']) $(`#${id}`).disabled = false;
  } catch {
    if (request !== shareRequest || !shareDialog.open) return;
    // 압축을 못 하는 브라우저: 링크 대신 같은 내용의 일정 파일로 보낸다
    ui.share = { url: '', title, line, code: null, includePrivate, message: '' };
    $('#shareLink').textContent = '';
    $('#shareError').textContent = t('이 브라우저에서는 공유 링크를 만들 수 없어요. 일정 파일(JSON)을 보내고, 받는 사람에게 ‘백업 파일 불러오기’를 안내하세요.');
    $('#shareError').hidden = false;
    $('#shareFile').hidden = false;
  }
}

/** 공유용 일정 파일 (링크와 같은 내용: 메모·예약번호 제외 옵션 그대로) */
function saveShareFile() {
  const current = ui.share;
  if (!current || !trip) return;
  downloadJson(sharedCopy(trip, { includePrivate: current.includePrivate }));
}

/** 복사. 클립보드가 막혀 있으면 직접 복사 창을 연다 (공유면 일정 파일로도 보낼 수 있게). */
async function copyText(text, done, { shareFile = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    openCopyDialog(text, { shareFile });
  }
}

const copyDialog = $('#copyDialog');
function openCopyDialog(text, { shareFile = false } = {}) {
  $('#copyText').value = text;
  $('#copyBackup').hidden = !shareFile;
  showDialog(copyDialog);
  $('#copyText').focus();
  $('#copyText').select();
}
$('#copyClose').addEventListener('click', () => copyDialog.close());
$('#copyBackup').addEventListener('click', saveShareFile);
$('#copyText').addEventListener('focus', (e) => e.target.select());

$('#shareBtn').addEventListener('click', () => {
  if (!trip) return;
  $('#shareExcludePrivate').checked = true;
  $('#shareNative').hidden = !navigator.share;
  showDialog(shareDialog);
  updateShare();
});
$('#shareExcludePrivate').addEventListener('change', updateShare);
$('#shareFile').addEventListener('click', saveShareFile);
$('#shareCopy').addEventListener('click', () => ui.share?.url && copyText(ui.share.message, t('복사했어요. 카톡이나 메신저에 붙여넣으세요'), { shareFile: true }));
$('#shareCopyLink').addEventListener('click', () => ui.share?.url && copyText(ui.share.url, t('링크만 복사했어요'), { shareFile: true }));
$('#shareNative').addEventListener('click', () => {
  if (!ui.share?.url) return;
  const { url, title, line } = ui.share;
  navigator.share({ title, text: `${title}\n${line}`, url }).catch(() => {});
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
  const r = await fetch(new URL(`api/share/${id}`, appBase()), { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r?.ok) throw new Error(r?.status === 404 ? t('공유 링크를 찾을 수 없어요. 보낸 사람에게 다시 받아 주세요.') : t('공유 일정을 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
  return (await r.json()).code;
}

/** 주소가 공유 링크면 그 일정을 보기 전용으로 연다. 열었으면 true. */
async function openSharedFromAddress() {
  try {
    const code = await shareCodeFromAddress();
    if (!code) return false;
    const shared = await decodeShare(code);
    setPicking(false);
    map.closePopup();
    trip = shared;
    ui.openItem = ui.openStay = null;
    ui.day = 0;
    ui.focusList = null;
    ui.target = null;
    ui.routePlan = ui.routeUndo = null;
    setReadonly(true);
    paintSharedBanner();
    return true;
  } catch (err) {
    clearShareAddress();
    ui.homeAlert = { kind: 'share', message: err.message };
    toast(err.message, 5000);
    return false;
  }
}
function paintSharedBanner() {
  if (!ui.readonly || !trip) return;
  $('#sharedTitle').textContent = trip.title;
  $('#sharedAt').hidden = !trip.sharedAt;
  if (trip.sharedAt) {
    const time = $('#sharedAt time');
    time.dateTime = trip.sharedAt;
    time.textContent = dateTime(trip.sharedAt);
  }
}

$('#sharedSave').addEventListener('click', () => {
  // 받은 일정은 새 id로 사본을 만들어 내 여행에 넣는다 (보낸 사람 일정과 섞이지 않게).
  const copy = { ...trip, title: t('{title} (공유 사본)', { title: trip.title }), id: M.uid(), createdAt: new Date().toISOString() };
  delete copy.sharedAt;
  switchTrip(copy, { save: true });
  if (store.trips[copy.id]) toast(t('내 여행으로 저장했어요. 이제 일정을 수정하거나 다시 공유할 수 있어요'), 4000);
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

/* ───────── 장소 보관함 (아래 고정 영역) / 날짜 옮기기 ───────── */
$('#inboxDock').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.item')?.dataset.id;
  if (btn.dataset.action === 'dock-toggle') {
    prefs.dockOpen = prefs.dockOpen === false;
    savePrefs();
    renderDays();
    $('#inboxDock .dock-toggle')?.focus();
  } else if (btn.dataset.action === 'locate') {
    const found = M.findItem(trip, id);
    if (!found) return;
    locateMapPlace(found.item);
  } else if (btn.dataset.action === 'delete') {
    const found = M.findItem(trip, id);
    if (found && confirm(t('"{name}"을(를) 삭제할까요?', { name: found.item.name }))) {
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
closeOnBackdrop(newTripDialog);
closeOnBackdrop(shareDialog);
closeOnBackdrop(copyDialog);

/* ───────── 개인정보처리방침 (메인 푸터) ─────────
 * 지금 언어로 연다. 닫기 버튼·Esc·바깥 누르기로 닫고, 닫으면 연 링크로 포커스를 돌려준다. 본문만 스크롤된다.
 */
const privacyDialog = $('#privacyDialog');
closeOnBackdrop(privacyDialog);
function renderPrivacy() {
  const doc = privacySections(getLang(), { contact: CONTACT });
  // 위쪽 차례: 저장·공유·외부 전송·삭제·문의로 바로 이동
  const toc = `<nav class="privacy-toc" aria-label="${esc(t('차례'))}"><ul>${doc.map((s, i) => `<li><a href="#pv-${i}" data-pv="${i}">${esc(s.title)}</a></li>`).join('')}</ul></nav>`;
  $('#privacyBody').innerHTML = toc + doc
    .map((s, i) => `<section id="pv-${i}" tabindex="-1"><h3>${esc(s.title)}</h3>${s.body.map((p) => (Array.isArray(p) ? `<ul>${p.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : `<p>${esc(p)}</p>`)).join('')}</section>`)
    .join('');
}
$('#privacyBody').addEventListener('click', (e) => {
  const i = e.target.closest('[data-pv]')?.dataset.pv;
  if (i == null) return;
  e.preventDefault(); // 주소(#/trip/…)는 바꾸지 않는다
  const sec = $(`#pv-${i}`);
  sec.scrollIntoView({ block: 'start' });
  sec.focus({ preventScroll: true });
});
function openPrivacy() {
  renderPrivacy();
  showDialog(privacyDialog);
  $('#privacyBody').scrollTop = 0;
  $('#privacyClose').focus();
}
$('#privacyClose').addEventListener('click', () => privacyDialog.close());

/* ───────── 장소 여러 개 한 번에 담기 ─────────
 * 링크 여러 개 / 테이크아웃 파일 → 미리 보기(체크) → 담기. 위치 없이 이름만 있는 곳은 "이름으로 찾기"를 눌러야 찾는다.
 * 검색창에 링크를 2개 이상 붙여넣어도 이 창이 열린다 (한 줄 입력칸은 줄바꿈을 지워서 링크가 붙어 버린다).
 */
const bulkDialog = $('#bulkDialog');
closeOnBackdrop(bulkDialog);
ui.bulk = { rows: [], shortLinks: 0, unsupported: 0, finding: false };
let bulkInputRevision = 0;

function openBulk(text = '') {
  if (!trip || ui.readonly) return;
  $('#bulkText').value = text;
  readBulk(text);
  const dest = $('#bulkDest');
  dest.innerHTML = `<option value="${M.INBOX}">${esc(t('장소 보관함'))}</option>${trip.days.map((d, i) => `<option value="${d.id}">${esc(M.dayTitle(d, i))}</option>`).join('')}`;
  showDialog(bulkDialog);
  if (!text) $('#bulkText').focus();
}

const normalizePlaceName = (name) => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function bulkDuplicateCheck() {
  const existing = [...allLists().flatMap((list) => list.items), ...(trip.stays ?? [])];
  const names = new Set(existing.map((item) => normalizePlaceName(item.name)).filter(Boolean));
  const hasCoordinates = ({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng);
  const positioned = existing.filter(hasCoordinates);
  return (place) => names.has(normalizePlaceName(place.name)) ||
    (hasCoordinates(place) && positioned.some((item) => M.distanceKm(place, item) <= 0.05));
}

function readBulk(text, fileName = '') {
  const r = parseLocationList(text);
  const count = r.places.length + r.names.length;
  const fileFormat = /\.(?:geo)?json$/i.test(fileName) ? /^[\s﻿]*[{\[]/ :
    /\.csv$/i.test(fileName) ? /^[\s﻿]*"?title"?\s*,/i : null;
  const error = fileFormat && !fileFormat.test(text)
    ? t('파일 형식을 읽을 수 없어요. Google Takeout의 저장 장소 JSON 또는 Title 열이 있는 CSV를 선택해 주세요.')
    : r.error;
  const isDuplicate = bulkDuplicateCheck();
  ui.bulk = {
    rows: error ? [] : [
      ...r.places.map((p) => {
        const dup = isDuplicate(p);
        return { ...p, kind: 'place', on: !dup, dup };
      }),
      ...r.names.map((n) => ({ ...n, kind: 'name', on: false, dup: isDuplicate(n) })),
    ],
    shortLinks: r.shortLinks,
    unsupported: r.unsupported,
    finding: false,
  };
  $('#bulkStatus').textContent = error || (count > 200 ? t('{n}곳을 찾았어요. 한 번에 200곳 이하로 나눠 담는 것을 권장해요.', { n: count })
    : text.trim() && !count && !r.shortLinks && !r.unsupported ? t('읽을 수 있는 장소가 없어요. 지도 링크나 내보내기 파일의 내용을 확인해 주세요.') : '');
  renderBulk();
}

function renderBulk() {
  const { rows, shortLinks, unsupported, finding } = ui.bulk;
  const names = rows.filter((x) => x.kind === 'name').length;
  const on = rows.filter((x) => x.on && x.kind === 'place').length;
  const parts = [
    rows.length ? t('{n}곳 찾음', { n: rows.length - names }) : '',
    names ? t('이름만 있는 곳 {n}개', { n: names }) : '',
    shortLinks ? t('짧은 링크 {n}개는 열 수 없어요 (한 번 연 뒤 긴 주소를 복사해 주세요)', { n: shortLinks }) : '',
    unsupported ? t('위치를 못 읽은 링크 {n}개', { n: unsupported }) : '',
  ].filter(Boolean);
  $('#bulkSummary').innerHTML = `${esc(parts.join(' · '))}${
    names ? ` <button type="button" class="linkbtn" data-bulk="find"${finding ? ' disabled' : ''}>${esc(finding ? t('찾는 중…') : t('이름으로 찾기'))}</button>` : ''
  }`;
  $('#bulkList').innerHTML = rows
    .map((x, i) => {
      if (x.kind === 'name') {
        return `<li class="bulk-row name"><span class="bulk-check"></span><span class="bulk-text"><b>${esc(x.name)}</b>${x.dup ? ` <span class="bulk-duplicate">${esc(t('이미 담긴 장소'))}</span>` : ''}<small>${esc(x.missing ? t('찾지 못했어요. 검색창에서 직접 찾아 주세요') : t('위치가 없어요. "이름으로 찾기"를 누르면 찾아요'))}</small></span></li>`;
      }
      const sub = x.found ? t('찾은 곳: {where}', { where: x.address || `${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}` }) : x.address || `${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}`;
      const name = x.name || t('이름 없는 장소');
      return `<li class="bulk-row${x.found ? ' found' : ''}"><label class="bulk-check"><input type="checkbox" data-bulk-i="${i}" aria-label="${esc(name)}${x.dup ? ` · ${esc(t('이미 담긴 장소'))}` : ''}"${x.on ? ' checked' : ''}></label>
        <span class="bulk-text"><b>${esc(name)}</b>${x.dup ? ` <span class="bulk-duplicate">${esc(t('이미 담긴 장소'))}</span>` : ''}<small>${esc(sub)}${x.memo ? ` · ${esc(x.memo)}` : ''}</small></span></li>`;
    })
    .join('');
  const btn = $('#bulkAdd');
  btn.disabled = !on;
  btn.textContent = on ? t('{n}곳 담기', { n: on }) : t('담기');
}

async function findBulkNames() {
  const b = ui.bulk;
  if (b.finding) return;
  if (!navigator.onLine) return toast(t('이름으로 찾으려면 인터넷이 필요해요'));
  b.finding = true;
  renderBulk();
  const c = trip.center ?? map.getCenter();
  const near = { lat: c.lat, lng: c.lng, zoom: 12 };
  const isDuplicate = bulkDuplicateCheck();
  const revision = bulkInputRevision;
  for (const row of b.rows.filter((x) => x.kind === 'name' && !x.missing)) {
    try {
      const hits = HANGUL.test(row.name) ? await searchPlacesKo(row.name, near) : await searchPlaces(row.name, near);
      const hit = hits[0];
      if (ui.bulk !== b || !bulkDialog.open || revision !== bulkInputRevision) return;
      if (hit) {
        const dup = isDuplicate({ ...row, lat: hit.lat, lng: hit.lng });
        Object.assign(row, { kind: 'place', lat: hit.lat, lng: hit.lng, address: hit.address, found: true, dup, on: !dup });
      }
      else row.missing = true;
    } catch {
      row.missing = true;
    }
    if (ui.bulk !== b || !bulkDialog.open || revision !== bulkInputRevision) return;
    renderBulk();
  }
  b.finding = false;
  renderBulk();
}

async function addBulk() {
  const picked = ui.bulk.rows.filter((x) => x.kind === 'place' && x.on);
  if (!picked.length) return;
  const dest = $('#bulkDest').value || M.INBOX;
  const added = picked.map((p) => M.addItem(trip, dest, { name: p.name || t('링크로 추가한 장소'), address: p.address, lat: p.lat, lng: p.lng, memo: p.memo ?? '' }));
  bulkDialog.close();
  if (dest === M.INBOX) {
    prefs.dockOpen = true;
    savePrefs();
  }
  saved(commit({ fit: true }), t('{n}곳을 {list}에 담았어요', { n: added.length, list: listName(dest) }));
  // 이름이 없던 곳(좌표만 있던 링크)은 주소로 이름을 찾아 채운다
  const nameless = added.filter((it, i) => !picked[i].name);
  for (const it of nameless) {
    const r = await reversePlace(it.lat, it.lng).catch(() => null);
    if (!r) continue;
    it.name = r.name || it.name;
    it.address = it.address || r.address || '';
  }
  if (nameless.length) commit();
}

$('#bulkBtn').addEventListener('click', () => openBulk());
$('#bulkClose').addEventListener('click', () => bulkDialog.close());
$('#bulkAdd').addEventListener('click', addBulk);
const readBulkInput = debounce((text, revision) => {
  if (bulkDialog.open && revision === bulkInputRevision) readBulk(text);
}, 250);
$('#bulkText').addEventListener('input', (e) => {
  $('#bulkAdd').disabled = true;
  readBulkInput(e.target.value, ++bulkInputRevision);
});
bulkDialog.addEventListener('close', () => { bulkInputRevision++; });
$('#bulkFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const revision = ++bulkInputRevision;
  readBulk('');
  $('#bulkText').value = '';
  if (f.size > 5 * 1024 * 1024) {
    $('#bulkStatus').textContent = t('파일이 5MB를 넘어요. 더 작은 목록을 선택하거나 여러 파일로 나눠 주세요.');
    return;
  }
  $('#bulkStatus').textContent = t('파일을 읽는 중이에요…');
  let text;
  try {
    text = await f.text();
  } catch {
    if (bulkDialog.open && revision === bulkInputRevision) $('#bulkStatus').textContent = t('파일을 읽지 못했어요. 다시 선택해 주세요.');
    return;
  }
  if (!bulkDialog.open || revision !== bulkInputRevision) return;
  $('#bulkText').value = text.length > 20000 ? t('{file} ({kb}KB)를 읽었어요', { file: f.name, kb: Math.round(f.size / 1024) }) : text;
  readBulk(text, f.name);
});
bulkDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-bulk="find"]')) findBulkNames();
});
bulkDialog.addEventListener('change', (e) => {
  const i = e.target.dataset.bulkI;
  if (i == null) return;
  ui.bulk.rows[Number(i)].on = e.target.checked;
  renderBulk();
});
// 검색창에 링크를 여러 개 붙여넣으면 이 창으로
searchEl.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  const r = parseLocationList(text);
  if (r.places.length + r.names.length + r.shortLinks + r.unsupported < 2) return;
  e.preventDefault();
  openBulk(text);
});
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
  toast(t('다시 인터넷에 연결됐어요'));
  if (!$('#tileError').hidden) $('#tileRetry').click();
  // 오프라인에서 현지 돈으로만 적은 지출이 있으면 환율을 받아 원화를 채운다
  if (trip && !ui.readonly && trip.budget && B.pendingKrw(trip).count) fetchRate({ quiet: true });
});
addEventListener('offline', syncOnline);
syncOnline();

/* ───────── 시작 ───────── */
if (/KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)) {
  $('#inAppBar').hidden = false;
  $('#inAppStatus').textContent = $('#inAppBar span').textContent;
}
$('#inAppBackup').addEventListener('click', saveTripBackup);
$('#inAppCopy').addEventListener('click', () => copyText(location.href, t('주소를 복사했어요. 기본 브라우저 주소창에 붙여넣으세요')));
$('#inAppClose').addEventListener('click', () => {
  $('#inAppBar').hidden = true;
  $('#inAppStatus').textContent = '';
  $('.menu summary').focus();
});
ui.storeProblem = store.problem;
syncLanguageSwitch();
document.documentElement.lang = LANGS[getLang()].html;
applyView();
applyTheme();
trip = null; // 주소(#/trip/<id>)를 보고 연다
if (await openSharedFromAddress()) {
  render({ fit: true });
  showPage('plan');
} else route();
renderSaveBar();
$('#appShell').hidden = true;
document.fonts?.ready.then(sizeDockCards); // 글꼴이 늦게 로드되면 다시 잰다
const getJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
Promise.all([getJson('data/trends.json'), getJson('data/trends-i18n.json').catch(() => null)])
  .then(([data, tr]) => {
    trends = data;
    trendsI18n = tr;
    if (prefs.page === 'home') renderHome();
    else if (trip && prefs.page === 'plan') renderDays();
  })
  .catch(() => {});
