import * as M from './lib/model.js';
import { parseLocationInput, parseLocationList } from './lib/links.js';
import { searchPlaces, searchPlacesKo, HANGUL, reversePlace, geocodeDestination } from './lib/geo.js';
import { openStore, KEY as STORE_KEY } from './lib/store.js';
import { exportXlsx, downloadJson, downloadCalendar } from './lib/export.js';
import * as T from './lib/trends.js';
import * as B from './lib/budget.js';
import * as C from './lib/checklist.js';
import { encodeShare, decodeShare, shareUrl, shareCodeFromHash, shareSummary, shareMessage, sharedCopy } from './lib/share.js';
import { enhanceDates, openDateRange, refreshDates } from './lib/datepicker.js';
import { enhanceTimes, destroyTimes, normalizeTime } from './lib/timefield.js';
import { watchSelects } from './lib/select.js';
import { enhanceSuggestions } from './lib/suggestions.js';
import { loadWeather, weatherSignature } from './lib/weather.js';
import { t, k, missing as i18nMissing, LANGS, LANG_KEY, getLang, setLang, loadLang, saveLang, locale, num, dayName, shortDate, weekday, dateTime, normalizeLang, tripLength, allVersions } from './lib/i18n.js';
import { privacySections } from './lib/privacy.js';
import { createUndoStack } from './lib/undo.js';
import * as D from './lib/dayops.js';
import { stayRangeWithin, overlappingStays, splitStayAround } from './lib/stays.js';
import { groupPlaces, removePlaceGroup } from './lib/place-groups.js';
import { summaryModel, drawSummary, summaryFileName } from './lib/summary.js';
import { DESTINATIONS, destinationLabel, resolveDestination, repairTripCenter } from './lib/destinations.js';
import { backupReason, backupReasonText, lastBackupLabel } from './lib/backup.js';
import * as Covers from './lib/covers.js';
import { init as initBudget, renderBudget, fetchRate } from './pages/budget.js';
import { init as initChecks, renderChecks, initPresets } from './pages/check.js';
import { init as initScrollFab } from './ui/scroll-fab.js';
import { init as initSearchBar } from './ui/search-bar.js';

watchSelects(document.body); // P1-2: [data-ui-select]는 공용 Select로
const undoStack = createUndoStack(); // 실행 취소 스택 (toast·pushUndo가 쓴다, 시작 중 알림도 안전하게 맨 위에 둔다)
// 일차 색: 색상환에서 고르게 벌려 지도 동선이 바로 구분되고, 흰 숫자 대비 5:1 이상 (시안 A)
const COLORS = ['#0A6FC2', '#C2410C', '#0F7B5F', '#6D4AE8', '#C7254E', '#0E7490', '#92400E', '#475569'];
const INBOX_COLOR = '#868e96';
const TREND_COLOR = '#C2410C'; // 요즘 뜨는 곳: 브랜드 블루와 겹치지 않는 오렌지
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
// P1-3: 767px 이하에서는 보드를 숨기고 늘 목록으로 (저장값 prefs.view는 그대로 — 데스크톱에선 보드 유지)
const narrowMq = matchMedia('(max-width: 767px)');
function curView() {
  return narrowMq.matches ? 'list' : prefs.view;
}
let trends = { cities: [] };
let trendsI18n = null; // data/trends-i18n.json (트렌드 문구 번역)
/** 트렌드 장소 문구를 지금 언어로. 번역이 없으면 한국어 원문 (original) */
const tp = (p) => T.localizePlace(p, getLang(), trendsI18n);
/** 원문(한국어)을 보여줄 때 언어를 드러낸다 */
const origAttr = (loc) => (loc.original ? ' lang="ko"' : '');
const origTag = (loc) => (loc.original ? ` <small class="orig-tag">${esc(t('한국어 원문'))}</small>` : '');

// 지도 타일: 라이트 모드는 Esri World Street Map 또는 Light Gray Canvas. 출처 표기 필수.
// 어두운 화면에서는 Dark Gray Canvas. (CARTO는 2025년부터 키가 필요하고, Stadia는 localhost 밖에서 키가 필요하다)
// Canvas 타일은 16단계까지라 더 확대하면 16단계 그림을 키워서 보여준다.
// 사용자가 늘면 ArcGIS 계정 키나 MapTiler·Stadia 키 기반으로 바꿔야 한다.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const STREET_ATTRIBUTION = 'Tiles &copy; Esri — Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community';
const TILES = {
  street: [`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
  gray: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  dark: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const TILE_OPTS = {
  maxZoom: 19,
  maxNativeZoom: 16,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
};
const tileGroup = (kind) => L.layerGroup(TILES[kind].map((url, index) => L.tileLayer(url, {
  ...TILE_OPTS,
  ...(kind === 'street' ? { maxNativeZoom: 19, attribution: STREET_ATTRIBUTION } : index ? { attribution: '' } : {}),
})));
const isDark = () => prefs.theme === 'dark';
const mapTileKind = () => isDark() ? 'dark' : prefs.mapStyle === 'gray' ? 'gray' : 'street';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
/** href 출력 (S-4): http/https만 통과(safeUrl)시키고 이스케이프한다. 앱이 만든 지도 주소도 같은 길로 */
const href = (u) => esc(M.safeUrl(u));
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
const mapStyleControl = L.control({ position: 'topright' });
mapStyleControl.onAdd = () => {
  const el = L.DomUtil.create('div', 'map-style-control');
  el.setAttribute('role', 'group');
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  for (const style of ['street', 'gray']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.style = style;
    btn.addEventListener('click', () => {
      prefs.mapStyle = style;
      savePrefs();
      syncTiles();
    });
    el.append(btn);
  }
  return el;
};
mapStyleControl.addTo(map);
function syncMapStyleControl() {
  const el = mapStyleControl.getContainer();
  el.hidden = isDark();
  el.setAttribute('aria-label', t('지도 스타일'));
  for (const btn of el.children) {
    btn.textContent = btn.dataset.style === 'gray' ? t('회색') : t('기본');
    btn.setAttribute('aria-pressed', String(btn.dataset.style === mapTileKind()));
  }
}
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
  syncMapStyleControl();
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
let baseKind = mapTileKind();
let baseTiles = watchTiles(tileGroup(baseKind)).addTo(map);
function watchTiles(group) {
  let fails = 0;
  for (const layer of group.getLayers()) {
    layer.on('tileerror', () => {
      if (++fails >= 4) {
        $('#tileError').hidden = false;
        setTilesDown(true);
      }
    });
    layer.on('tileload', () => {
      fails = 0;
      // 오프라인 중 HTTP 캐시에서 몇 장 나온 것만으로 미니맵을 거두지 않는다 (온라인 복귀 때 함께 복원)
      if (!navigator.onLine) return;
      $('#tileError').hidden = true;
      setTilesDown(false);
    });
  }
  return group;
}
$('#tileRetry').addEventListener('click', () => {
  $('#tileError').hidden = true;
  baseTiles.eachLayer((l) => l.redraw());
});
// 완전 오프라인이면 타일을 기다리지 않고 바로 SVG 동선 미니맵으로 (B10: 타일은 서비스 워커에 저장하지 않는다)
addEventListener('offline', () => setTilesDown(true));
addEventListener('online', () => {
  if (!ui.tilesDown) return;
  restoreTiles();
});
/**
 * 온라인 복귀: 미니맵을 거두고 원래 지도 타일을 다시 받는다.
 * 확대 단계·중심·선택한 일차(ui.focusList)는 그대로 둔다 — 다시 맞추기(fit)를 하지 않는다.
 */
function restoreTiles() {
  const view = { center: map.getCenter(), zoom: map.getZoom() };
  setTilesDown(false);
  $('#tileError').hidden = true;
  map.invalidateSize({ pan: false });
  map.setView(view.center, view.zoom, { animate: false });
  baseTiles.eachLayer((l) => l.redraw());
}
if (!navigator.onLine) queueMicrotask(() => setTilesDown(true));

/* ───────── 오프라인 SVG 동선 미니맵 ─────────
 * 바탕 타일을 인터넷으로도, 저장해 둔 것으로도 못 받으면 지도 대신 보여 준다.
 * 일정 좌표만으로 그리는 경량 그림: 일차별 연결선 · 북쪽(N) · 장소 사이 직선거리(km) · 숙소 위치.
 */
function setTilesDown(down) {
  if (ui.tilesDown === down) return;
  ui.tilesDown = down;
  renderMiniMap();
}
function renderMiniMap() {
  const el = $('#miniMap');
  if (!el) return;
  const hint = $('#miniHint');
  if (!ui.tilesDown || !trip) {
    el.hidden = true;
    el.innerHTML = '';
    if (hint) hint.hidden = true;
    $('#tileError').classList.remove('with-mini');
    return;
  }
  const focusDay = trip.days.findIndex((d) => d.id === ui.focusList);
  const days = trip.days.map((d, i) => i).filter((i) => focusDay < 0 || i === focusDay);
  const routes = days.map((i) => ({ i, color: dayColor(i), pts: M.dayRoute(trip, i) })).filter((r) => r.pts.length);
  const stays = new Map();
  for (const r of routes) for (const p of r.pts) if (trip.stays.includes(p)) stays.set(p.id, p);
  const all = routes.flatMap((r) => r.pts);
  // 먼저 보이게 해서(종류 칩·긴 안내가 접힌 뒤) 남은 자리를 잰다
  el.hidden = false;
  $('#tileError').classList.add('with-mini');
  // 그림 비율을 지금 지도 칸에 맞춘다 (좁은 화면에서도 꽉 차게). 위쪽은 일차 전환·범례, 아래쪽은 안내 띠 자리
  const box = $('.mapwrap').getBoundingClientRect();
  const W = Math.max(240, Math.round(box.width) || 400);
  const H = Math.max(180, Math.round(box.height) || 300);
  // 지도 위에 떠 있는 조작부(일차 전환·범례 / 확대·위치 버튼 / 안내 띠)를 피해 그린다
  const edge = (sel, side) => {
    const r = $(sel)?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return side === 'top' ? r.bottom - box.top : side === 'right' ? box.right - r.left : box.bottom - r.top;
  };
  const TOP = Math.min(H * 0.45, Math.max(40, edge('.map-top', 'top')) + 14);
  // 아래쪽: 안내 띠(시트가 있으면 시트 위에 떠 있다)까지 비운다. 시트가 가리는 높이는 30% 상한과 별개로 더한다 (GPT 6차 #4)
  const sheetH = sheetPad();
  const BOTTOM = Math.min(H * 0.3 + sheetH, Math.max(24 + sheetH, edge('#tileError', 'bottom')) + 18);
  const PADL = 26;
  const PADR = Math.min(W * 0.3, Math.max(26, edge('.mapwrap .leaflet-control-zoom', 'right')) + 10);
  let body = '';
  if (all.length) {
    const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = all.map((p) => p.lng * kx);
    const ys = all.map((p) => p.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min((W - PADL - PADR) / Math.max(maxX - minX, 1e-6), (H - TOP - BOTTOM) / Math.max(maxY - minY, 1e-6));
    const cx = PADL + (W - PADL - PADR - (maxX - minX) * scale) / 2;
    const cy = BOTTOM + (H - TOP - BOTTOM - (maxY - minY) * scale) / 2;
    const at = (p) => [cx + (p.lng * kx - minX) * scale, H - (cy + (p.lat - minY) * scale)];
    const f = (n) => n.toFixed(1);
    const legs = routes.reduce((n, r) => n + Math.max(0, r.pts.length - 1), 0);
    for (const r of routes) {
      const xy = r.pts.map(at);
      if (xy.length > 1) body += `<polyline points="${xy.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="${r.color}" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round"/>`;
      if (legs <= 14) {
        r.pts.forEach((p, k) => {
          const leg = k > 0 ? M.routeLeg(r.pts[k - 1], p) : null;
          if (!leg) return;
          const [x1, y1] = xy[k - 1];
          const [x2, y2] = xy[k];
          body += `<text class="mm-km" x="${f((x1 + x2) / 2)}" y="${f((y1 + y2) / 2 - 4)}" text-anchor="middle">${esc(M.formatKm(leg.km))}</text>`;
        });
      }
      let n = 0;
      r.pts.forEach((p, k) => {
        if (stays.has(p.id)) return;
        n++;
        const [x, y] = xy[k];
        body += `<g class="mm-pin" data-mini-item="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(`${dayName(r.i)} ${n} · ${p.name}`)}"><circle cx="${f(x)}" cy="${f(y)}" r="10" fill="${r.color}" stroke="#fff" stroke-width="2"/><text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle">${n}</text></g>`;
      });
    }
    for (const st of stays.values()) {
      const [x, y] = at(st);
      body += `<g class="mm-stay" aria-label="${esc(`${t('숙소')} · ${st.name}`)}"><rect x="${f(x - 9)}" y="${f(y - 9)}" width="18" height="18" rx="5" fill="${M.STAY_COLOR}" stroke="#fff" stroke-width="2"/><text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle">H</text></g>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('오프라인 동선 미니맵'))}">
      <g class="mm-north" transform="translate(${Math.round(W - PADR / 2 + 4)} ${Math.round(Math.max(edge('#mapLocate', 'top'), 40) + 26)})"><path d="M0 -14 L6 4 L0 0 L-6 4 Z"/><text y="18" text-anchor="middle">N</text></g>
      ${body}
    </svg>`;
  // 설명은 지도 위 안내 띠(#tileError)에 붙인다 (좁은 지도에서 그림을 가리지 않게)
  if (hint) {
    hint.textContent = all.length ? t('인터넷이 끊겨 바탕 지도 대신 일정 좌표로 그린 동선이에요. 거리는 직선거리예요.') : t('인터넷이 끊겨 바탕 지도를 못 불러왔어요. 장소를 넣으면 동선을 그려 보여 줘요.');
    hint.hidden = false;
  }
}
$('#miniMap').addEventListener('click', (e) => {
  const id = e.target.closest('[data-mini-item]')?.dataset.miniItem;
  if (id) openItem(id, { scroll: true });
});
$('#miniMap').addEventListener('keydown', (e) => {
  const id = (e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-mini-item]')?.dataset.miniItem;
  if (!id) return;
  e.preventDefault();
  openItem(id, { scroll: true });
});
/**
 * 밝기가 바뀌면 지도 타일만 바꾼다 (지도·핀·위치·확대 단계는 그대로).
 * 새 타일을 위에 먼저 깔고, 다 그려지면 이전 타일을 치운다 (그사이 빈 바탕이 깜빡이지 않게).
 */
function syncTiles() {
  syncMapStyleControl();
  const kind = mapTileKind();
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
/** 숙소 핀. inFocus=false(고른 일차의 숙소가 아님)면 종류 강조 없이 흐림으로 둔다 (B1) */
const stayPinHtml = (inFocus = true) => `<div class="stay-pin${inFocus ? catFilterClass('stay') : byCategory() && ui.catFilter ? ' cat-off' : ''}"${byCategory() ? ` style="--c:${M.STAY_COLOR};background:${M.STAY_COLOR};border-color:${M.STAY_COLOR};color:#fff"` : ''}><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg></div>`;
/** 종류별 필터: 고른 종류 핀만 또렷하게, 나머지는 흐리게 */
const catFilterClass = (cat) => (byCategory() && ui.catFilter ? (ui.catFilter === cat ? ' cat-on cat-pulse' : ' cat-off') : '');
/* 보케 펄스 부하 제한: 좁은 화면(767px 이하)에서 강조 핀이 15개 이상이면 지금 지도 화면 안의 핀만 반짝이고,
 * 화면 밖 핀은 고정 후광만 둔다. 지도를 움직이면 다시 고른다. */
const PULSE_LIMIT = 15;
const pulseViewport = matchMedia('(max-width: 767px)');
function updatePulse() {
  const on = [...markers.values()].map((m) => [m, m.getElement()?.querySelector('.cat-on')]).filter(([, el]) => el);
  const limit = pulseViewport.matches && on.length >= PULSE_LIMIT;
  const view = limit ? map.getBounds().pad(0.1) : null;
  for (const [m, el] of on) el.classList.toggle('cat-pulse', !limit || view.contains(m.getLatLng()));
}
const catLabel = (k) => (M.CATEGORIES[k] ? t(M.CATEGORIES[k].label) : '');
const catIcon = (it) => {
  const c = M.CATEGORIES[it.category];
  return c ? `<span class="cat-tag" style="--cc:${c.color}">${esc(t(c.label))}</span>` : '';
};

function renderPinLegend(empty = '') {
  const el = $('#pinLegend');
  el.innerHTML = `<div class="pin-seg" role="group" aria-label="${esc(t('핀 색 기준'))}">
      <button type="button" data-pin="day" aria-pressed="${!byCategory()}" class="${byCategory() ? '' : 'active'}">${esc(t('일차별'))}</button>
      <button type="button" data-pin="category" aria-pressed="${byCategory()}" class="${byCategory() ? 'active' : ''}">${esc(t('종류별'))}</button>
    </div>${
      byCategory()
        ? `<div class="legend${legendOpen() ? '' : ' folded'}" role="group" aria-label="${esc(t('종류별'))}">${[...Object.entries(M.CATEGORIES), ['stay', { label: '숙소', color: M.STAY_COLOR }]]
            .filter(([k]) => legendOpen() || ui.catFilter === k)
            .map(([k, c]) => `<button type="button" class="cat-chip${ui.catFilter === k ? ' on' : ''}" data-cat-filter="${k}" aria-pressed="${ui.catFilter === k}" style="--c:${c.color}"><i></i>${esc(t(c.label))}</button>`)
            .join('')}<button type="button" class="legend-toggle" data-legend-toggle aria-expanded="${legendOpen()}" title="${esc(legendOpen() ? t('범례 접기') : t('범례 펼치기'))}" aria-label="${esc(legendOpen() ? t('범례 접기') : t('범례 펼치기'))}">${legendOpen() ? '▴' : `${esc(t('범례'))} ▾`}</button></div>${empty ? `<p class="cat-empty" role="status">${esc(empty)}${catElsewhere() ? ` <button type="button" class="linkbtn" data-cat-all>${esc(t('전체 일차에서 보기 ({n}곳)', { n: catElsewhere() }))}</button>` : ''}</p>` : ''}`
        : ''
    }`;
}

/** 종류별 범례 펼침 (지도를 넓게 보려고 접어 둘 수 있다, 이 브라우저에 기억) */
const legendOpen = () => prefs.legendOpen !== false;

/** 종류별 필터로 고른 종류가 지금 보이는 범위(고른 일차 또는 전체)에 몇 곳인지 */
function catFilterCount() {
  const cat = ui.catFilter;
  const dayIdx = trip.days.findIndex((d) => d.id === ui.focusList);
  if (cat === 'stay') {
    if (dayIdx < 0) return trip.stays.length;
    const st = M.dayStays(trip, dayIdx);
    return [st.start, st.end].filter(Boolean).length;
  }
  const lists = dayIdx >= 0 ? [trip.days[dayIdx].items] : [...trip.days.map((d) => d.items), trip.inbox];
  return lists.flat().filter((it) => (M.CATEGORIES[it.category] ? it.category : 'etc') === cat).length;
}
/** 고른 일차에는 없지만 다른 일차(보관함 포함)에는 있는 그 종류 수 — 0건 안내에서 '전체 일차에서 보기'로 바로 넘어간다 */
function catElsewhere() {
  if (!byCategory() || !ui.catFilter || !trip.days.some((d) => d.id === ui.focusList)) return 0;
  if (ui.catFilter === 'stay') return trip.stays.length;
  return [...trip.days.flatMap((d) => d.items), ...trip.inbox].filter((it) => (M.CATEGORIES[it.category] ? it.category : 'etc') === ui.catFilter).length;
}
function catEmptyText() {
  if (!byCategory() || !ui.catFilter || catFilterCount()) return '';
  const day = trip.days.some((d) => d.id === ui.focusList);
  if (ui.catFilter === 'stay') return day ? t('이 일차에 등록된 숙소가 없어요') : t('이 여행에 등록된 숙소가 없어요');
  const name = catLabel(ui.catFilter);
  return day
    ? t('이 일차에 등록된 {cat} 장소가 없어요', { cat: name })
    : t('이 여행에 등록된 {cat} 장소가 없어요', { cat: name });
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
      // 종류별 필터가 켜져 있으면 동선은 0.25로 낮춰 강조 핀이 맨 위로 보이게 한다
      const faded = byCategory() && ui.catFilter;
      L.polyline(pts, { color: color === 'var(--accent)' ? 'var(--paper)' : 'var(--day-route-outline)', weight: 7, opacity: dim ? 0.12 : faded ? 0.25 : 1, interactive: false }).addTo(layer);
      L.polyline(pts, { color, weight: preview ? 4 : 3, opacity: dim ? 0.18 : faded ? 0.25 : 1, dashArray: preview ? null : '7 6', interactive: false }).addTo(layer);
    }
    l.items.forEach((it, i) => {
      const n = preview ? preview.indexOf(it) + 1 : i + 1;
      const m = L.marker([it.lat, it.lng], {
        // 일차 흐림이 종류 강조보다 우선: 고른 일차 밖 핀은 강조·펄스 없이 흐림 그대로 (B1)
        icon: pinIcon(l.isDay ? n : '•', pinColorOf(it, color), dim, dim ? '' : catFilterClass(M.CATEGORIES[it.category] ? it.category : 'etc').trim()),
        zIndexOffset: dim ? 0 : 1000,
      }).addTo(layer);
      const detail = [l.label, l.isDay ? t('{n}번째', { n }) : '', it.time].filter(Boolean).join(' · ');
      labelMarker(m, `${it.name} · ${detail}`);
      m.on('click', () => showMapPlace(it, detail, true, m));
      markers.set(it.id, m);
      if (!dim) bounds.push([it.lat, it.lng]);
    });
  });
  const focusIdx = trip.days.findIndex((d) => d.id === ui.focusList);
  const focusStays = focusIdx >= 0 ? new Set(Object.values(M.dayStays(trip, focusIdx)).filter((x) => x?.id).map((x) => x.id)) : null;
  for (const s of trip.stays) {
    const { checkIn, checkOut } = M.stayDates(trip, s);
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', html: stayPinHtml(!focusStays || focusStays.has(s.id)), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }),
      zIndexOffset: 1500,
    }).addTo(layer);
    const detail = `${t('숙소')} · ${t('{n}박', { n: s.nights })}${checkIn ? ` · ${M.formatDate(checkIn)} ~ ${M.formatDate(checkOut)}` : ''}`;
    labelMarker(m, `${s.name} · ${detail}`);
    m.on('click', () => showMapPlace(s, detail, false, m));
    markers.set(s.id, m);
    if (ui.focusList == null) bounds.push([s.lat, s.lng]);
  }
  renderTrendMarkers();
  renderPinLegend(catEmptyText());
  updatePulse();
  if (ui.tilesDown) renderMiniMap();
  const all = ui.focusList == null;
  $('#showAll').setAttribute('aria-pressed', String(all));
  const date = trip.days[ui.day]?.date;
  $('#mapDayLabel').textContent = `${dayName(ui.day)}${date ? ` · ${shortDate(date)}` : ''}`;
  $('#dayPrev').disabled = ui.day <= 0;
  $('#dayNext').disabled = ui.day >= trip.days.length - 1;
  if (ui.candidate) showCandidate(ui.candidate, { pan: false });
  renderMapSheet();
  if (fit) fitTo(bounds);
}

/* ───────── 모바일 지도 하단 시트 ─────────
 * 지도 탭(900px 이하)에서 지도를 화면 가득 두고, 고른 일차(또는 전체 동선)의 장소 목록을 아래에서 끌어올린다.
 * 세 단계: 살짝(peek) · 반(half) · 크게(full). 손잡이를 누르면 살짝↔반, 끌면 가까운 단계로 붙는다. */
const SHEET_STATES = ['peek', 'half', 'full'];
let sheetState = 'peek';
function sheetHeights() {
  const wrap = $('.mapwrap');
  const H = wrap.clientHeight || 600;
  const peek = Math.min(112, Math.round(H * 0.4));
  // 크게: 위쪽 일차 전환·범례 바로 아래까지 (지도 출처 표기 한 줄 자리는 남긴다)
  const top = $('.map-top')?.getBoundingClientRect();
  const under = top?.height ? top.bottom - wrap.getBoundingClientRect().top + 34 : H * 0.14;
  // 낮은 화면에서도 살짝 ≤ 반 ≤ 크게 (겹치면 같은 높이로 합친다, GPT 6차 #5)
  const full = Math.max(peek, Math.round(Math.min(H * 0.86, H - under)));
  return { peek, half: Math.min(full, Math.max(peek, Math.round(H * 0.46))), full };
}
/** 지금 시트가 지도를 가리는 높이 (시트가 없으면 0) */
function sheetPad() {
  const el = $('#mapSheet');
  return el && el.offsetParent && getComputedStyle(el).display !== 'none' ? sheetHeights()[sheetState] : 0;
}
function setSheet(state) {
  const prev = sheetState;
  sheetState = SHEET_STATES.includes(state) ? state : 'peek';
  const el = $('#mapSheet');
  el.dataset.state = sheetState;
  $('.mapwrap').style.setProperty('--sheet-h', `${sheetHeights()[sheetState]}px`);
  $('#msHandle').setAttribute('aria-expanded', String(sheetState !== 'peek'));
  $('#msList').inert = sheetState === 'peek'; // 살짝 상태에서는 가려진 목록에 포커스가 가지 않게
  // 오프라인 미니맵은 시트를 뺀 자리에 다시 그린다. 크게 펼치면 가려진 핀은 탭 순서에서도 뺀다 (GPT 6차 #4)
  const mini = $('#miniMap');
  if (mini) mini.inert = sheetPad() > 0 && sheetState === 'full';
  if (ui.tilesDown && prev !== sheetState && !mini?.hidden) renderMiniMap();
}
function renderMapSheet() {
  if (!trip) return;
  const focus = trip.days.findIndex((d) => d.id === ui.focusList);
  const days = focus >= 0 ? [focus] : trip.days.map((_, i) => i);
  let count = 0;
  const rows = days.map((i) => {
    const day = trip.days[i];
    const route = M.dayRoute(trip, i);
    const head = focus < 0 ? `<li class="ms-day" style="--c:${dayColor(i)}"><span aria-hidden="true"></span>${esc(dayName(i))}${day.date ? ` · ${esc(shortDate(day.date))}` : ''}</li>` : '';
    if (!day.items.length) return `${head}<li class="ms-empty">${esc(t('이 날은 아직 장소가 없어요'))}</li>`;
    count += day.items.length;
    return head + route.map((p) => {
      const stay = trip.stays.includes(p);
      const n = day.items.indexOf(p) + 1;
      const cat = M.CATEGORIES[p.category];
      const meta = stay ? t('숙소') : [p.time, cat ? t(cat.label) : ''].filter(Boolean).join(' · ');
      return `<li><button type="button" class="ms-row" data-ms-item="${esc(p.id)}">
        <span class="ms-num${stay ? ' stay' : ''}" style="--c:${dayColor(i)}" aria-hidden="true">${stay ? '<svg class="ic"><use href="#i-home"/></svg>' : n}</span>
        <span class="ms-main"><b>${esc(p.name)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</span></button></li>`;
    }).join('');
  }).join('');
  const date = focus >= 0 ? trip.days[focus].date : '';
  $('#msTitle').textContent = focus >= 0 ? `${dayName(focus)}${date ? ` · ${shortDate(date)}` : ''}` : t('전체 동선');
  $('#msCount').textContent = count ? t('{n}곳', { n: count }) : '';
  $('#msList').innerHTML = rows;
  $('#msEdit').hidden = Boolean(ui.readonly) && focus < 0;
  setSheet(sheetState);
}
{
  const handle = $('#msHandle');
  let drag = null;
  let dragged = false;
  let suppressClick = 0; // 끌기를 마친 직후의 click만 무시한다 (키보드 Enter·Space는 영향 없음)
  handle.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    drag = { y: e.clientY, h: sheetHeights()[sheetState], id: e.pointerId };
    dragged = false;
    handle.setPointerCapture(e.pointerId); // 손잡이 밖으로 빨리 끌어도 계속 받는다 (마우스·펜)
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y - e.clientY;
    if (!dragged && Math.abs(dy) < 6) return;
    if (!dragged) {
      dragged = true;
      $('.mapwrap').classList.add('sheet-dragging');
    }
    const hs = sheetHeights();
    $('.mapwrap').style.setProperty('--sheet-h', `${Math.min(hs.full, Math.max(hs.peek, drag.h + dy))}px`);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    $('.mapwrap').classList.remove('sheet-dragging');
    if (dragged) {
      const h = drag.h + (drag.y - e.clientY);
      const hs = sheetHeights();
      setSheet(SHEET_STATES.reduce((a, s) => (Math.abs(hs[s] - h) < Math.abs(hs[a] - h) ? s : a), 'peek'));
      suppressClick = performance.now() + 400;
    }
    dragged = false;
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => {
    $('.mapwrap').classList.remove('sheet-dragging');
    if (drag) setSheet(sheetState); // 취소되면 원래 단계로
    dragged = false;
    drag = null;
  });
  handle.addEventListener('click', (e) => {
    if (e.detail && performance.now() < suppressClick) return; // 끌기 끝의 click은 무시
    const hs = sheetHeights();
    // 살짝 → 반 → 크게 → 살짝 (높이가 같은 단계는 건너뛴다) — 키보드·스크린리더로도 세 단계 모두 (GPT 6차 #3)
    const order = SHEET_STATES.filter((s, i) => i === 0 || hs[s] > hs[SHEET_STATES[i - 1]]);
    setSheet(order[(order.indexOf(sheetState) + 1) % order.length] ?? 'peek');
  });
  $('#msList').addEventListener('click', (e) => {
    const id = e.target.closest('[data-ms-item]')?.dataset.msItem;
    const m = id && markers.get(id);
    if (!m) return;
    setSheet('peek');
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: false });
    m.fire('click'); // 지도 장소 요약 카드(길찾기·일정 보기)를 연다
    // 시트는 카드가 열리면 숨는다 → 포커스를 카드로, 닫으면 이 행으로 돌아온다 (GPT 6차 #3)
    const card = $('#mapPlace');
    card.dataset.fromSheet = id;
    card.querySelector('a, button')?.focus({ preventScroll: true });
  });
  $('#msEdit').addEventListener('click', () => {
    setSheet('peek');
    showTab('plan');
    const focus = trip.days.findIndex((d) => d.id === ui.focusList);
    if (focus >= 0) requestAnimationFrame(() => $(`#day-${focus}`)?.scrollIntoView({ block: 'start' }));
  });
  new ResizeObserver(() => setSheet(sheetState)).observe($('.mapwrap'));
  new ResizeObserver(() => setSheet(sheetState)).observe($('.map-top')); // 범례를 펼치면 '크게' 높이도 다시
  visualViewport?.addEventListener('resize', () => setSheet(sheetState)); // 화면 키보드·회전
}

map.on('moveend', updatePulse);
pulseViewport.addEventListener('change', updatePulse);

/* ───────── 외부 지도 길찾기 ─────────
 * 직전 장소(출발 숙소 포함)가 있으면 출발지로 넣는다. 중국 본토 여행이면 고덕·바이두를 함께 보여 준다. */
function prevPointOf(item) {
  const dayIdx = trip.days.findIndex((d) => d.items.includes(item));
  if (dayIdx < 0) return null;
  const route = M.dayRoute(trip, dayIdx);
  const i = route.indexOf(item);
  return i > 0 ? route[i - 1] : null;
}
function directionsHtml(item, { from = prevPointOf(item), cls = 'dir-links' } = {}) {
  const china = M.tripInMainlandChina(trip) || M.inMainlandChina(item);
  const links = M.directionsLinks(item, from, { china });
  if (!links.length) return '';
  const label = from ? t('{name}에서 출발', { name: from.name || t('직전 장소') }) : t('현재 위치에서 출발');
  return `<span class="${cls}" role="group" aria-label="${esc(t('길찾기'))} · ${esc(label)}" title="${esc(label)}"><span class="dir-label">${esc(t('길찾기'))}</span>${links
    .map((x) => `<a href="${href(x.url)}" target="_blank" rel="noopener" data-dir="${x.id}">${esc(x.label)}</a>`)
    .join('')}</span>`;
}

function showMapPlace(item, detail, hasSchedule, marker) {
  const card = $('#mapPlace');
  delete card.dataset.fromSheet; // 지도 핀에서 열면 닫을 때 핀으로 돌아간다 (시트 행에서 열면 호출한 쪽이 다시 정한다)
  ui.candidate = null;
  markers.get(card.dataset.item)?.getElement()?.classList.remove('map-pin-selected');
  card.dataset.item = item.id;
  marker.getElement()?.classList.add('map-pin-selected');
  card.innerHTML = `<div><strong>${esc(item.name)}</strong><small>${esc(detail)}</small></div>
    ${directionsHtml(item, { from: hasSchedule ? prevPointOf(item) : null })}
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
    // 검색 결과의 '위치 보기'로 연 후보인데 그사이 검색어가 바뀌었으면 넣지 않고 다시 찾는다 (GPT 4차 #6)
    if (p.fromSearch != null && p.fromSearch !== searchEl.value.trim()) {
      clearCandidate();
      $('#mapPlace').hidden = true;
      return void runSearch({ explicit: true });
    }
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
    const fromSheet = card.dataset.fromSheet;
    delete card.dataset.fromSheet;
    const row = fromSheet && [...$$('#msList [data-ms-item]')].find((b) => b.dataset.msItem === fromSheet);
    if (row) {
      setSheet('half'); // 행이 보이고 포커스를 받을 수 있게 (살짝 상태 목록은 inert)
      row.focus({ preventScroll: false });
    } else marker?.focus({ preventScroll: true });
  }
});

function expandMap() {
  if (!prefs.mapHidden || narrowMq.matches) return;
  prefs.mapHidden = false;
  savePrefs();
  applyView();
  map.invalidateSize();
}

function locateMapPlace(item) {
  ui.keepView = $('.layout').dataset.tab !== 'map';
  expandMap();
  showTab('map');
  map.setView([item.lat, item.lng], Math.max(map.getZoom(), 16));
  setTimeout(() => markers.get(item.id)?.fire('click'), 0);
}

/* ───────── 트렌드 (요즘 뜨는 곳) ─────────
 * 트렌드 장소 이름·요약은 조사한 원문 자료라 번역하지 않는다 (도시 이름과 상태 문구만 지금 언어로).
 */
/** P0-8: 여행 페이지는 여행지 도시 데이터만 쓴다 (다른 도시를 고르는 칸 없음 — 도시 고르기는 홈에서만) */
function currentCity() {
  if (!trip || !trends.cities.length) return null;
  return T.cityByName(trends.cities, trip.destination);
}

const trendCollection = () => ui.trendCollection ?? 'trending';
const trendLabel = (collection) => collection === 'popular' ? t('많이 가는 곳') : t('요즘 뜨는 곳');

$('#days').addEventListener('keydown', (e) => {
  const tab = e.target.closest('[data-collection]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const collection = e.key === 'Home' ? 'trending' : e.key === 'End' ? 'popular' :
    (tab.dataset.collection === 'trending' ? 'popular' : 'trending');
  $(`#trend-tab-${collection}`)?.click();
});

function findTrend(id) {
  for (const c of trends.cities) {
    const p = [...T.activePlaces(c, TODAY), ...T.activePlaces(c, TODAY, 'popular')].find((x) => x.id === id);
    if (p) return { place: p, city: c };
  }
  return null;
}

const placeCount = () => (trip ? trip.days.reduce((n, d) => n + d.items.length, 0) + trip.inbox.length : 0);
/** 요즘 뜨는 곳 펼침: 직접 접거나 펼쳤으면 그대로, 아니면 장소가 없을 때만 펼친다 (장소가 생기면 Day 1이 아래로 밀리지 않게) */
const trendsOpen = () => curView() === 'board' || (prefs.trendsUser ?? placeCount() === 0);

function renderTrendMarkers() {
  const city = currentCity();
  if (!city || ui.readonly || (curView() === 'list' && !trendsOpen())) return;
  const collection = trendCollection();
  for (const p of T.activePlaces(city, TODAY, collection)) {
    const loc = tp(p);
    const m = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: '<div class="trend-pin" aria-hidden="true">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: -100,
    })
      .bindPopup(
        `<div class="popup-name">${esc(loc.name)}</div>` +
          `<div class="popup-meta">${esc(trendLabel(collection))}${p.status ? ` · ${esc(T.statusLabel(p, TODAY))}` : ''}</div>` +
          (loc.summary ? `<p class="popup-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>` : '') +
          `<button class="popup-add" data-add-trend="${esc(p.id)}">${esc(t('+ 일정에 담기'))}</button>`,
      )
      .addTo(layer);
    labelMarker(m, `${trendLabel(collection)}: ${loc.name}`);
  }
}

function trendSectionHtml() {
  const city = currentCity();
  const board = curView() === 'board';
  const open = trendsOpen();
  const collection = trendCollection();
  const places = T.activePlaces(city, TODAY, collection);
  // P0-8: 여행지 트렌드 데이터가 없으면 접힌 한 줄 안내 + 장소 검색 바로가기만
  if (!city) {
    return `<section class="trend-col trend-empty card" style="--c:${TREND_COLOR}">
      <span class="dot" aria-hidden="true"></span><span>${esc(t('이 도시 추천은 준비 중이에요'))}</span>
      <button type="button" class="link" data-action="trend-search">${esc(t('장소 검색하기'))}</button>
    </section>`;
  }
  const cards = places
    .map((p) => [p, tp(p)])
    .map(
      ([p, loc]) => `<li class="trend-card" data-trend="${esc(p.id)}">
        ${p.status ? `<div class="tc-top"><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span><span class="tc-cat">${esc(loc.category)}</span></div>` : ''}
        <div class="tc-name">${esc(loc.name)}</div>
        ${loc.area ? `<div class="tc-area">${esc(loc.area)}${p.approx ? ` · ${esc(t('대략 위치'))}` : ''}</div>` : ''}
        ${loc.summary ? `<p class="tc-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>` : ''}
        <div class="tc-foot">
          <span class="tc-src">${p.source === '편집 선정' ? esc(t('편집 선정')) : `${esc(t('출처'))} ${(p.sources ?? []).map((s, i) => `<a href="${href(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}" aria-label="${esc(t('출처 {n}: {title}', { n: i + 1, title: s.title }))}">${i + 1}</a>`).join(' ')}`}</span>
          <button class="tc-add" data-action="add-trend" aria-label="${esc(t('{name} 일정에 담기', { name: loc.name }))}">${esc(t('+ 담기'))}</button>
        </div>
      </li>`,
    )
    .join('');
  const criterion = collection === 'popular' ? t('대표 명소 · 편집 선정') :
    t('{date} 조사 · 최근 SNS·뉴스 언급', { date: city.researchedAt ?? trends.researchedAt });
  const tabs = ['trending', 'popular'].map((type) => `<button type="button" class="btn" id="trend-tab-${type}" role="tab" aria-controls="trend-panel" aria-selected="${collection === type}" tabindex="${collection === type ? 0 : -1}" data-action="trend-collection" data-collection="${type}">${esc(trendLabel(type))}</button>`).join('');
  const body = `<div class="trend-tabs" role="tablist" aria-label="${esc(t('추천 장소'))}">${tabs}</div>
    <div id="trend-panel" role="tabpanel" aria-labelledby="trend-tab-${collection}"${open ? '' : ' hidden'}>
      ${open ? `<p class="trend-note">${esc(criterion)}</p><ul class="trend-list">${cards}</ul>` : ''}
    </div>`;
  return `<section class="day trend-col card" style="--c:${TREND_COLOR}">
    <header class="day-head">
      <button class="day-title" data-action="trend-toggle"${board ? ' disabled' : ` aria-expanded="${open}"`}>
        <span class="dot"></span><strong>${esc(t('추천 장소'))}</strong><span class="count">${esc(t('{n}곳', { n: places.length }))}${board ? '' : open ? ' ▾' : ' ▸'}</span>
      </button>
      ${!board && open && places.length > 1 ? `<span class="trend-arrows"><button type="button" class="icon" data-action="trend-scroll" data-dir="-1" aria-label="${esc(t('이전 카드'))}">‹</button><button type="button" class="icon" data-action="trend-scroll" data-dir="1" aria-label="${esc(t('다음 카드'))}">›</button></span>` : ''}
    </header>
    ${body}
  </section>`;
}

function addTrend(id, listId, index) {
  const found = findTrend(id);
  if (!found) return;
  const local = { ...found.place, ...tp(found.place) };
  if (listId == null) return addPlace(T.trendToPlace(local, t(found.city.name), found.place.category));
  const item = M.addItem(trip, listId, T.trendToPlace(local, t(found.city.name), found.place.category));
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
  const pad = sheetPad(); // 모바일 지도 시트가 가리는 아래쪽은 비워 두고 맞춘다
  if (bounds.length === 1) {
    map.setView(bounds[0], 15, { animate: false });
    if (pad) map.panBy([0, pad / 2], { animate: false });
  } else if (bounds.length > 1) map.fitBounds(bounds, { paddingTopLeft: [48, 48], paddingBottomRight: [48, 48 + pad], maxZoom: 16 });
  else if (trip?.center) map.setView([trip.center.lat, trip.center.lng], 12);
}

$('#pickConfirm').addEventListener('click', () => {
  if (!ui.picking || !trip || ui.readonly) return;
  const latlng = map.wrapLatLng(map.getCenter());
  const draft = stayMapDraft;
  stayMapDraft = null;
  setPicking(false);
  if (draft) resumeStayFromMap(draft, latlng);
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
    <button class="ctx-btn stay" data-ctx-add="stay"></button>`;
  const select = content.querySelector('select');
  const item = content.querySelector('[data-ctx-add="item"]');
  const stay = content.querySelector('[data-ctx-add="stay"]');
  const dayIndex = () => trip.days.findIndex((day) => day.id === dayId);
  function updateActions() {
    const start = dayIndex();
    item.disabled = start < 0;
    stay.disabled = start < 0;
    item.textContent = t('+ 이 위치 추가') + (start < 0 ? '' : ` (${dayName(start)})`);
    stay.textContent = t('숙소로 추가');
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
    if (context !== mapDayContext() || dayIndex() < 0) return;
    map.closePopup(popup);
    addPlace(place, { edit: true, listId: dayId });
  });
  stay.addEventListener('click', () => {
    const start = dayIndex();
    if (context !== mapDayContext() || start < 0) return;
    map.closePopup(popup);
    openStays({ place, start });
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
  const listId = ui.target;
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
  if (!on && stayMapDraft) {
    const draft = stayMapDraft;
    stayMapDraft = null;
    if (cancelled) resumeStayFromMap(draft);
    return;
  }
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
  // 고정 안내 높이(--savebar)는 아래 ResizeObserver가 다 그려진 뒤 실제 높이로 맞춘다 (GPT 2차 #14)
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
function commit({ fit = false, auto = false } = {}) {
  if (ui.readonly) {
    render({ fit });
    return { ok: true, changed: [] };
  }
  if (!auto) markEdited();
  M.touch(trip);
  store.trips[trip.id] = trip;
  const r = saveNow();
  render({ fit });
  if (r.ok && !auto) afterUserSave();
  return r;
}

/* ───────── F-1: 여행 데이터 유실 방지 ─────────
 * 첫 저장 때 브라우저에 영구 저장을 요청하고(거절되면 한 번 안내), 출발 7일 전·여행 끝난 다음 날·큰 변경 20회 뒤에 백업을 권한다.
 */
function afterUserSave() {
  prefs.changes ??= {};
  prefs.changes[trip.id] = (prefs.changes[trip.id] ?? 0) + 1;
  savePrefs();
  requestPersist();
  scheduleNag(2600); // 방금 저장 알림이 먼저 보이게
}
async function requestPersist() {
  if (prefs.persistAsked || !navigator.storage?.persist) return;
  prefs.persistAsked = true;
  savePrefs();
  try {
    if (await navigator.storage.persisted()) return;
    if (await navigator.storage.persist()) return;
  } catch {
    /* 지원하지 않으면 안내만 */
  }
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  toast(installed
    ? t('이 브라우저는 저장 공간 보호를 허락하지 않았어요. 일정이 사라지지 않게 가끔 백업 파일을 저장해 두세요')
    : t('이 브라우저는 저장 공간 보호를 허락하지 않았어요. 홈 화면에 추가해 앱으로 쓰거나, 가끔 백업 파일을 저장해 두세요'), 7000);
}
let nagTimer = 0;
/** 시간 기준 권유(출발 7일 전·여행 끝난 다음 날)는 편집하지 않고 열기만 해도 확인한다 */
function scheduleNag(ms = 3000) {
  clearTimeout(nagTimer);
  nagTimer = setTimeout(nagBackup, ms);
}
function nagBackup() {
  if (!trip || ui.readonly || prefs.page === 'home') return;
  if (undoStack.size()) return scheduleNag(Math.max(1000, undoStack.left() + 500)); // 실행 취소 알림을 가리지 않게 뒤로
  const r = backupReason(trip, { last: prefs.backups?.[trip.id] ?? 0, changes: prefs.changes?.[trip.id] ?? 0 });
  if (!r || prefs.backupNag?.[trip.id] === r.key) return;
  prefs.backupNag ??= {};
  prefs.backupNag[trip.id] = r.key;
  savePrefs();
  toast(backupReasonText(r.reason), 8000, { label: t('백업 저장'), run: saveTripBackup });
}

/**
 * 샘플 여행을 사용자가 한 번이라도 고치면 표시한다. 그 뒤로는 언어를 바꿔도 여행 내용(이름·장소)은 번역하지 않고 그대로 둔다.
 * (자동 환율 받기처럼 사용자가 하지 않은 저장은 commit({ auto: true })로 표시하지 않는다)
 */
function markEdited(tr = trip) {
  if (tr && !ui.readonly && tr.isUserModified === false) tr.isUserModified = true;
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
  // 고를 때 본 다른 탭 값도 함께 넘긴다: 창을 띄운 사이 또 바뀌었으면 그 항목은 다시 묻는다
  conflicts.forEach((c, i) => (choices[c.key] = { pick: askDialog.querySelector(`input[name="cf${i}"]:checked`)?.value ?? 'local', seen: c.remote }));
  resolving = false;
  const r = saveNow(choices);
  if (r.ok) {
    if (trip && !ui.readonly) trip = store.trips[trip.id] ?? trip;
    if (trip) render();
    else renderHome();
    toast(t('저장했어요'));
  }
}

const LIST_NAMES = { members: k('동행자'), expenses: k('지출'), checks: k('체크 항목'), items: k('장소'), stays: k('숙소'), flights: k('항공편') };
const FIELD_NAMES = { title: k('여행 이름'), destination: k('여행지'), total: k('1인 예산'), currency: k('현지 통화'), krwPerUnit: k('환율'), trendCity: k('트렌드 도시'), amount: k('금액'), memo: k('메모'), text: k('항목'), done: k('체크'), price: k('예상 가격'), name: k('이름'), time: k('시간'), payer: k('낸 사람'), split: k('나눠 낼 사람') };
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

/**
 * 저장된 여행의 여행지 좌표 고치기 (P0-1): 목록의 도시인데 멀면(예전 검색이 서울의 "오사카○○" 식당·인도의 동명 지역을 찾은 경우)
 * 도시 좌표로, 목록 밖이면 담긴 장소 평균과 300km 넘게 떨어졌을 때 장소 평균으로.
 */
function repairCenter() {
  if (trip.centerManual) return;
  const named = T.cityByName(trends.cities, trip.destination);
  const fixed = named && (!trip.center || T.distanceKm(trip.center, named.center) > 150)
    ? Boolean((trip.center = { ...named.center }))
    : repairTripCenter(trip, trends.cities);
  if (!fixed) return;
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
        <p>${esc(t('장소를 검색하거나 구글맵 링크를 붙여넣으면 {target}에 담겨요. 지도에서 찍을 때는 지도 일차를 사용해요.', { target: targetLabel() }))}</p>
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

function renderTarget() {
  const lists = allLists();
  if (!lists.some((l) => l.id === ui.target)) ui.target = trip.days[0]?.id ?? M.INBOX;
  $('#target').innerHTML =
    lists
      .map((l, i) => {
        const label = l.isDay ? M.dayTitle(trip.days[i], i) : t('장소 보관함 (날짜 미정)');
        return `<option value="${l.id}"${l.id === ui.target ? ' selected' : ''}${l.isDay ? dayOptionAttrs(i) : ''}>${esc(label)}</option>`;
      })
      .join('');
  renderPlanEmpty(); // 첫 장소 안내도 지금 고른 추가 대상을 따른다
}

function firstUncoveredNight() {
  return M.uncoveredStayNights(trip)[0] ?? 0;
}

const listName = (id) => {
  const i = trip.days.findIndex((d) => d.id === id);
  return i === -1 ? t('장소 보관함') : dayName(i);
};

function targetLabel() {
  return listName(ui.target);
}

function stayRowHtml(stay, dayIndex, pos, flags, leg = null) {
  const key = `${stay.id}|${dayIndex}|${pos}`;
  const open = ui.openStay === key;
  const tag = pos === 'start' && flags.checkOut ? t('체크아웃') : pos === 'end' && flags.checkIn ? t('체크인') : '';
  const editor = open ? detailHtml(stay, { stay: true }) : '';
  return `<div class="tl-row stay">${legHtml(leg)}<div class="tl-time"></div><div class="tl-box">
    <div class="stay-row ${pos}${open ? ' open' : ''}" data-stay="${stay.id}" data-key="${key}">
      <button class="stay-main" data-action="stay-toggle"${ui.readonly ? ` aria-expanded="${open}"` : ' aria-haspopup="dialog"'}>
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
  return `<a class="leg" href="${href(leg.url)}" target="_blank" rel="noopener"
      title="${esc(t('직선거리 기준 어림값이에요. 누르면 구글맵 길찾기({mode})가 열려요', { mode }))}">
      <span class="leg-how">${esc(how)}</span><span class="leg-go">${esc(t('길찾기'))}</span></a>`;
}

/** 보기 전용(공유받은 일정)에서 편집 창 대신 보여주는 상세 */
function detailHtml(x, { stay = false } = {}) {
  const url = M.safeUrl(x.url);
  const range = stay ? M.stayDates(trip, x) : null;
  const dateTimeLabel = (date, time) => [M.formatDate(date), time].filter(Boolean).join(' ');
  return `<div class="editor detail">
      ${stay ? `<p><b>${esc(t('{n}박', { n: x.nights }))}</b>${range.checkIn ? ` · ${esc(dateTimeLabel(range.checkIn, x.checkInTime))} ~ ${esc(dateTimeLabel(range.checkOut, x.checkOutTime))}` : ''}</p>` : ''}
      ${stay && x.bookingRef ? `<p>${esc(t('예약번호 {ref}', { ref: x.bookingRef }))}</p>` : ''}
      ${stay && x.phone ? `<p>${esc(t('전화번호'))} · ${esc(x.phone)}</p>` : ''}
      ${x.memo ? `<p class="memo-text">${esc(x.memo)}</p>` : ''}
      ${url ? `<p><a href="${href(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>` : ''}
      ${x.address ? `<p class="addr">${esc(x.address)}</p>` : ''}
      ${directionsHtml(x, stay ? { from: null } : {})}
      <div class="editor-actions"><a href="${href(M.googleMapsUrl(x))}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a></div>
    </div>`;
}

/* ───────── 장소 비용 ─────────
 * 예정 비용("¥1,200")은 카드 이름 옆에, 결제하면 "결제 ₩10,800"으로 바뀐다. 결제·취소는 편집 창과 오늘 카드에서.
 */
/** 원화(krw)로 저장된 금액을 이 여행의 기준 통화로 보여 준다 (C1) */
const bm = (krw) => B.baseMoney(krw, trip?.budget);
const tripCurrency = () => trip.budget?.currency ?? B.guessCurrency(trip.destination, trip.country);
function costTagHtml(it) {
  const paid = trip.expenses?.length ? B.placeExpense(trip, it.id) : null;
  if (paid) return `<span class="cost-tag paid" title="${esc(t('가계부에 기록됨'))}">${esc(t('결제 {amount}', { amount: paid.krw == null ? B.moneyCode(paid.amount, trip.budget.currency) : bm(paid.krw) }))}</span>`;
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
          ? `<span class="paid-note">${esc(t('가계부에 {amount} 기록됨', { amount: paid.krw == null ? B.moneyCode(paid.amount, b.currency) : bm(paid.krw) }))} <button type="button" data-action="unpay">${esc(t('결제 취소'))}</button></span>`
          : `<button type="button" class="pay-btn" data-action="pay">${esc(t('결제 완료로 기록'))}</button>`
      }
    </div>`;
}

function itemHtml(it, i, isDay, leg = null, listItems = null, overlap = '') {
  const open = ui.openItem === it.id;
  const sub = esc(it.memo || it.address); // 접힌 카드는 메모를 2줄까지만 (CSS line-clamp). 시간은 타임라인 왼쪽에 따로 보인다
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
      ${isDay || trip.days.length ? `<button class="icon" data-action="place-ops" title="${esc(t('다른 일차로 이동·복제'))}" aria-label="${esc(t('{name} 다른 일차로 이동·복제', { name: it.name }))}" aria-haspopup="dialog">⇄</button>` : ''}
      <button class="icon" data-action="locate" title="${esc(t('지도에서 보기'))}" aria-label="${esc(t('{name} 지도에서 보기', { name: it.name }))}">◎</button>
      ${open ? `<button class="icon collapse" data-action="toggle" title="${esc(t('접기'))}" aria-label="${esc(t('접기'))}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>` : ''}
    </div>
    ${overlap ? timeWarnHtml(overlap, dayFlightIdOf(it)) : ''}
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
      <label>${esc(t('다른 날로 옮기기'))}<select class="move-to" data-ui-select>${moveOptions(listIdOf(it.id), t('옮길 날 고르기'))}</select></label>
      ${it.address ? `<p class="addr">${esc(it.address)}</p>` : ''}
      ${directionsHtml(it)}
      <div class="editor-actions">
        <a href="${href(M.googleMapsUrl(it))}" target="_blank" rel="noopener">${esc(t('구글맵에서 열기 ↗'))}</a>
        <span class="ea-buttons"><button data-action="place-move" aria-haspopup="dialog">${esc(t('다른 일차로 이동'))}</button> <button data-action="place-copy" aria-haspopup="dialog">${esc(t('다른 일차로 복제'))}</button> <button data-action="duplicate">${esc(t('같은 날 복제'))}</button> <button data-action="delete" class="danger">${esc(t('삭제'))}</button></span>
      </div>
    </div>`
        : ''
    }
    </div>
  </li>`;
}

/**
 * 시간 겹침 배지 (B7). 원인에 따라 다르게 안내한다.
 *   order  → "시간 겹침 확인" + 이후 일정 30분씩 밀기
 *   flight → "항공편 시간 확인" + 항공편 보기 / 일정 시간 수정 (밀면 귀국편과 더 멀어질 수 있어 밀기 버튼은 없다)
 */
function timeWarnHtml(kind, flightId) {
  if (kind === 'flight') {
    return `<div class="time-warn flight" role="note"><span class="tw-badge">${esc(t('항공편 시간 확인'))}</span>${
      ui.readonly ? '' : `${flightId ? `<button type="button" data-action="flight-edit" data-flight="${esc(flightId)}">${esc(t('항공편 시간 보기'))}</button>` : ''}<button type="button" data-action="edit-time">${esc(t('일정 시간 수정'))}</button>`
    }<small>${esc(t('항공편 도착 전이나 출발 후로 잡혀 있어요'))}</small></div>`;
  }
  return `<div class="time-warn" role="note"><span class="tw-badge">${esc(t('시간 겹침 확인'))}</span>${
    ui.readonly ? '' : `<button type="button" data-action="push-30" title="${esc(t('이 장소부터 시간을 정한 일정을 30분씩 늦춰요'))}">${esc(t('이후 일정 30분씩 밀기'))}</button>`
  }</div>`;
}
/** 그 장소가 있는 날의 항공편 (출발편 우선) id */
function dayFlightIdOf(it) {
  const i = trip.days.findIndex((d) => d.items.includes(it));
  if (i < 0) return '';
  return (dayFlights(i, 'bottom')[0] ?? dayFlights(i, 'top')[0])?.flight.id ?? '';
}
/** 그날 시간이 꼬인 장소 id. 그날 비행기 도착 시각보다 이르거나, 귀국 비행기 출발 이후인 장소도 포함 */
function dayTimeConflicts(dayIndex) {
  return M.timeConflictKinds(trip.days[dayIndex]?.items, M.flightTimeBounds(M.flightsForDay(trip, dayIndex)));
}

/* ───────── 항공편 ───────── */
/** 그날 항공편(출발 시각순). top = 출국·이동(하루 시작), bottom = 귀국(하루 끝). 기간 밖 출국·귀국편은 Day 1·마지막 날 (P0-2) */
function dayFlights(dayIndex, where) {
  return M.flightsForDay(trip, dayIndex).filter(({ flight }) => (flight.kind === 'in') === (where === 'bottom'));
}

function flightRowsHtml(dayIndex, where) {
  return dayFlights(dayIndex, where)
    .map((x) => {
      const { flight: f, role } = x;
      const note = role === 'depart' ? t('출발') : role === 'arrive' ? (x.offset ? `${M.pinnedFlightNote(x)} · ${t('도착')}` : t('도착')) : role === 'pinned' ? M.pinnedFlightNote(x) : '';
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


const stayDialog = $('#stayDialog');
const stayForm = $('#stayForm');
const stayFields = stayForm.elements;
let stayEditId = null;
let stayLocation = null;
let stayMapDraft = null;
let staySearch = null;

function setStayLocation(place) {
  stayLocation = place;
  $('#stayLocation').textContent = place
    ? place.address || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
    : t('숙소 위치를 골라 주세요');
  if (place?.name && !stayFields.name.value.trim()) stayFields.name.value = place.name;
}

function renderStayList() {
  $('#stayList').hidden = !trip.stays.length;
  $('#stayList').innerHTML = [...trip.stays].sort((a, b) => a.startIndex - b.startIndex).map((stay) => {
    const { checkIn, checkOut } = M.stayDates(trip, stay);
    const meta = [
      checkIn ? [shortDate(checkIn), stay.checkInTime, '–', shortDate(checkOut), stay.checkOutTime].filter(Boolean).join(' ') : dayName(stay.startIndex),
      t('{n}박', { n: stay.nights }),
    ].join(' · ');
    return `<li>
      <button type="button" class="t-open" data-stay-edit="${esc(stay.id)}" aria-pressed="${stay.id === stayEditId}">
        <strong>${esc(stay.name)}</strong><span class="t-meta">${esc(meta)}</span>
      </button>
      <button type="button" class="icon danger" data-stay-remove="${esc(stay.id)}" aria-label="${esc(t('{name} 삭제', { name: stay.name }))}">✕</button>
    </li>`;
  }).join('');
}

function stayFormError(message = '') {
  $('#stayError').textContent = message;
  $('#stayError').hidden = !message;
}

function clearStaySearch() {
  staySearch?.abort();
  staySearch = null;
  $('#staySearchResults').replaceChildren();
}

function openStays({ id = null, place = null, start = firstUncoveredNight(), draft = null } = {}) {
  if (!trip || ui.readonly) return;
  const stay = id ? M.findStay(trip, id) : null;
  if (id && !stay) return;
  const checkIn = M.dateAtIndex(trip, start);
  const nights = Math.min(M.DEFAULT_NIGHTS, trip.days.length - start);
  const dates = stay ? M.stayDates(trip, stay) : { checkIn, checkOut: checkIn ? M.addDays(checkIn, nights) : '' };
  const values = draft ?? { ...(stay ?? place ?? {}), ...dates };
  stayEditId = stay?.id ?? null;
  stayForm.reset();
  clearStaySearch();
  $('#stayLocationQuery').value = '';
  $('#stayFormTitle').textContent = stay ? t('숙소 수정') : t('숙소 추가');
  const paid = draft?.paid ?? Boolean(stay && B.placeExpense(trip, stay.id));
  for (const field of ['name', 'checkIn', 'checkOut', 'bookingRef', 'phone', 'price', 'memo', 'cur', 'url']) {
    stayFields[field].value = values[field] ?? (field === 'cur' ? 'local' : '');
  }
  stayFields.paid.checked = paid;
  for (const field of ['checkInTime', 'checkOutTime']) {
    const input = stayFields[field];
    const time = values[field] ?? '';
    input.value = time;
    if (time) input._flatpickr?.setDate(time, false);
    else input._flatpickr?.clear(false);
  }
  stayFields.checkIn.dataset.dpSoftMin = M.dateAtIndex(trip, 0);
  stayFields.checkOut.dataset.dpSoftMax = M.dateAtIndex(trip, trip.days.length);
  enhanceTimes(stayForm);
  refreshDates();
  setStayLocation(place ?? stay);
  stayFormError();
  renderStayList();
  if (!stayDialog.open) showDialog(stayDialog);
  stayFields.name.focus();
}

async function searchStayLocation() {
  const query = $('#stayLocationQuery').value.trim() || stayFields.name.value.trim();
  if (!query) return $('#stayLocationQuery').focus();
  clearStaySearch();
  const request = new AbortController();
  staySearch = request;
  const results = $('#staySearchResults');
  results.textContent = t('검색 중…');
  const near = { ...(trip.center ?? map.getCenter()), zoom: map.getZoom() };
  try {
    const search = HANGUL.test(query) ? searchPlacesKo : searchPlaces;
    const places = await search(query, near, request.signal);
    if (staySearch !== request || !stayDialog.open) return;
    results.replaceChildren(...places.map((place) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = [place.name, place.address].filter(Boolean).join(' · ');
      button.addEventListener('click', () => {
        setStayLocation(place);
        clearStaySearch();
        $('#stayLocationQuery').focus();
      });
      return button;
    }));
    if (!places.length) results.textContent = t('검색 결과가 없어요. 영어나 현지어로도 검색해 보세요.');
  } catch {
    if (staySearch === request && stayDialog.open) results.textContent = t('위치를 검색하지 못했어요');
  }
}

function resumeStayFromMap(draft, latlng) {
  if (trip?.id !== draft.tripId || ui.readonly) return;
  showTab('plan');
  const place = latlng ? { lat: latlng.lat, lng: latlng.lng, name: t('선택한 위치') } : draft.place;
  openStays({ id: draft.id, place, draft: draft.values });
  if (latlng) reversePlace(place.lat, place.lng).then((result) => {
    if (result && stayDialog.open && stayLocation === place) setStayLocation({ ...place, name: result.name, address: result.address });
  }).catch(() => {});
}

$('#staysBtn').addEventListener('click', () => openStays());
$('#stayShortcut').addEventListener('click', () => openStays({ start: Math.max(0, trip.days.findIndex((day) => day.id === ui.target)) }));
$('#stayNew').addEventListener('click', () => openStays());
$('#stayClose').addEventListener('click', () => stayDialog.close());
stayDialog.addEventListener('close', () => {
  if (!stayDialog.open) clearStaySearch();
});
closeOnBackdrop(stayDialog);
$('#staySearchBtn').addEventListener('click', searchStayLocation);
$('#stayLocationQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchStayLocation();
  }
});
$('#stayPickBtn').addEventListener('click', () => {
  stayMapDraft = {
    tripId: trip.id, id: stayEditId, place: stayLocation,
    values: { ...Object.fromEntries(new FormData(stayForm)), paid: stayFields.paid.checked },
  };
  stayDialog.close();
  if (prefs.mapHidden && !narrowMq.matches) {
    prefs.mapHidden = false;
    savePrefs();
    applyView();
  }
  if (stayLocation) {
    ui.keepView = true;
    map.setView([stayLocation.lat, stayLocation.lng], Math.max(map.getZoom(), 14));
  }
  setPicking(true);
});

$('#stayList').addEventListener('click', async (e) => {
  const { stayEdit, stayRemove } = e.target.closest('button')?.dataset ?? {};
  if (stayEdit) return openStays({ id: stayEdit });
  const stay = stayRemove && M.findStay(trip, stayRemove);
  if (!stay || ui.readonly) return;
  const tripId = trip.id;
  const choice = await ask({
    title: t('숙소 "{name}"({n}박)을 삭제할까요?', { name: stay.name, n: stay.nights }),
    body: B.placeExpense(trip, stay.id) ? t('연결된 지출은 가계부에 남아요') : '',
    actions: [{ value: 'delete', label: t('삭제'), danger: true }],
  });
  if (choice !== 'delete' || trip?.id !== tripId || ui.readonly || !stayDialog.open) return;
  const index = trip.stays.findIndex((entry) => entry.id === stay.id);
  if (index < 0) return;
  const [removed] = trip.stays.splice(index, 1);
  const dates = M.stayDates(trip, removed);
  const result = commit();
  if (stayEditId === stay.id) openStays();
  else renderStayList();
  stayDialog.close();
  if (result.ok) pushUndo(t('"{name}"을(를) 삭제했어요', { name: stay.name }), () => {
    if (trip?.id !== tripId || ui.readonly || M.findStay(trip, removed.id)) return;
    const range = stayRangeWithin(trip, dates.checkIn, dates.checkOut);
    trip.stays.splice(index, 0, { ...removed, ...range });
    saved(commit(), t('되돌렸어요'));
  });
});

stayForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ui.readonly || askDialog.open) return;
  const form = new FormData(stayForm);
  const name = form.get('name').trim();
  const checkIn = form.get('checkIn');
  const checkOut = form.get('checkOut');
  const checkInTime = normalizeTime(form.get('checkInTime'));
  const checkOutTime = normalizeTime(form.get('checkOutTime'));
  const price = form.get('price') === '' ? null : Number(form.get('price'));
  const paid = stayFields.paid.checked;
  if (!name) {
    stayFields.name.focus();
    return stayFormError(t('숙소 이름을 입력해 주세요'));
  }
  if (!stayLocation) return stayFormError(t('숙소 위치를 골라 주세요'));
  if (!M.parseDate(checkIn) || !M.parseDate(checkOut) || checkIn >= checkOut) return stayFormError(t('체크아웃은 체크인 다음 날부터 가능해요'));
  if (checkInTime == null || checkOutTime == null) return stayFormError(t('시간은 20:45처럼 적어 주세요'));
  if (price != null && (!Number.isFinite(price) || price > B.MAX_AMOUNT)) return stayFormError(t('금액이 너무 커요. {max} 이하로 입력해 주세요', { max: num(B.MAX_AMOUNT) }));
  if (paid && !(price > 0)) return stayFormError(t('결제 금액을 입력해 주세요'));
  stayFormError();

  const id = stayEditId;
  const current = trip;
  const signature = () => JSON.stringify([trip.startDate, trip.endDate, trip.stays]);
  const before = signature();
  const unchanged = () => trip === current && !ui.readonly && stayDialog.open && stayEditId === id && before === signature();
  const period = await extendTripFor(checkIn, checkOut, { checkout: true });
  if (period === false || !unchanged()) return;
  let requested = stayRangeWithin(trip, checkIn, checkOut);
  if (period) {
    const basis = trip.startDate ? trip : { days: [{ date: period.start }] };
    const startIndex = M.indexOfDate(basis, checkIn);
    requested = { startIndex, nights: M.indexOfDate(basis, checkOut) - startIndex };
  }
  if (!requested) return stayFormError(t('여행 기간 안에 겹치는 숙박일이 없어요'));
  const conflicts = overlappingStays(trip.stays, requested, id);
  let choice = null;
  if (conflicts.length) {
    choice = await ask({
      title: t('숙소 날짜가 겹쳐요'),
      body: [conflicts.map((stay) => {
        const dates = M.stayDates(trip, stay);
        return [stay.name, [shortDate(dates.checkIn), shortDate(dates.checkOut)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ');
      }).join(', '), t('새 숙소를 겹치는 밤에 배정하고 기존 숙소의 나머지 밤을 남겨요')].join('\n'),
      actions: [
        { value: 'replace', label: t('교체'), danger: true },
        { value: 'split', label: t('나눠서 저장'), primary: true },
      ],
    });
    if (!choice || !unchanged()) return;
  }
  if (period) M.setTripDates(trip, period.start, period.end, { keepDates: true });
  const range = stayRangeWithin(trip, checkIn, checkOut);
  const conflictIds = new Set(conflicts.map((stay) => stay.id));
  if (choice) trip.stays = trip.stays.flatMap((stay) =>
    conflictIds.has(stay.id) ? (choice === 'split' ? splitStayAround(stay, range) : []) : [stay]);
  const dates = M.stayDates(trip, range);
  const place = {
    lat: stayLocation.lat, lng: stayLocation.lng, address: stayLocation.address ?? '',
    name, url: form.get('url').trim(), memo: form.get('memo').trim(),
    bookingRef: form.get('bookingRef').trim(), phone: form.get('phone').trim(), price, cur: form.get('cur'),
    checkInTime: dates.checkIn === checkIn ? checkInTime : '',
    checkOutTime: dates.checkOut === checkOut ? checkOutTime : '',
  };
  const existing = M.findStay(trip, id);
  const wasPaid = existing && B.placeExpense(trip, id);
  if (existing && name !== existing.name) delete existing.nameI18n;
  const stay = existing ? Object.assign(existing, place, range) : M.addStay(trip, place, range.startIndex, range.nights);
  if (paid && (!wasPaid || wasPaid.amount !== price || wasPaid.cur !== stay.cur)) B.payPlace(trip, stay.id, { today: TODAY });
  else if (!paid && wasPaid) B.unpayPlace(trip, stay.id);
  ui.routePlan = ui.routeUndo = null;
  stayDialog.close();
  saved(commit(), t('{name} 저장했어요', { name: stay.name }));
});

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
          <span class="t-meta">${esc(M.formatDate(f.departAt.slice(0, 10)))}${f.bookingRef ? ` · ${esc(t('예약번호 {ref}', { ref: f.bookingRef }))}` : ''}${M.pinnedFlight(trip, f) ? ` · ${esc(M.pinnedFlight(trip, f) === 'first' ? t('Day 1에 표시') : t('마지막 날에 표시'))}` : flightOutside(f) ? ` · <b class="warn-text">${esc(t('여행 기간 밖'))}</b>` : ''}</span>
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
flightForm.addEventListener('submit', async (e) => {
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
  // P0-2·P0-9: 출발일이 여행 기간 밖이면 여행을 늘릴지, 그대로 두고 Day 1(출국)·마지막 날(귀국)에 붙일지 고른다
  const dep = data.departAt.slice(0, 10);
  if (trip.startDate && (dep < trip.startDate || dep > trip.endDate)) {
    const found = M.extendedRange(trip, dep < trip.startDate ? dep : trip.startDate, dep > trip.endDate ? dep : trip.endDate);
    const r = found && !found.tooLong ? found : null;
    const keepLabel = data.kind === 'out' ? t('기간은 그대로, Day 1에 붙이기') : data.kind === 'in' ? t('기간은 그대로, 마지막 날에 붙이기') : t('기간은 그대로 저장');
    const choice = r
      ? await ask({
          title: t('출발일이 여행 기간 밖이에요'),
          body: t('{date} 출발이에요. 여행 기간({range})을 늘릴까요?', { date: M.formatDate(dep), range: `${M.formatDate(trip.startDate)} – ${M.formatDate(trip.endDate)}` }),
          actions: [
            { value: 'extend', label: t('여행 기간을 {range}로 늘리기', { range: `${M.formatDate(r.start)} – ${M.formatDate(r.end)}` }), primary: true },
            { value: 'keep', label: keepLabel },
          ],
        })
      : 'keep';
    if (choice !== 'extend' && choice !== 'keep') return;
    if (choice === 'extend') M.setTripDates(trip, r.start, r.end, { keepDates: true });
  }
  const savedFlight = ui.editFlight ? M.updateFlight(trip, ui.editFlight, data) : M.addFlight(trip, data);
  const r = commit();
  const hidden = flightOutside(savedFlight) && savedFlight.kind === 'move';
  saved(r, hidden ? t('저장했어요. 출발일이 여행 기간 밖이라 일정에는 보이지 않아요') : t('{name} 저장했어요', { name: M.flightSummary(savedFlight) }), hidden ? 4000 : 2200);
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
/**
 * P1-2: 공용 Select의 일차 항목 표시 — "● Day 3 · 11/25 (수) · 2곳", 오늘이면 배지
 * <option>에 data-color · data-label · data-sub · data-badge를 붙인다 (기본 select로 보여도 글자는 그대로)
 */
function dayOptionAttrs(i) {
  const d = trip.days[i];
  const sub = [d.date ? `${shortDate(d.date)} (${weekday(d.date)})` : '', t('{n}곳', { n: d.items.length })].filter(Boolean).join(' · ');
  return ` data-color="${dayColor(i)}" data-label="${esc(dayName(i))}" data-sub="${esc(sub)}"${d.date === TODAY ? ` data-badge="${esc(t('오늘'))}"` : ''}`;
}

function moveOptions(currentListId, placeholder) {
  const days = trip.days
    .map((d, i) => (d.id === currentListId ? '' : `<option value="${d.id}"${dayOptionAttrs(i)}>${esc(M.dayTitle(d, i))}</option>`))
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


function renderDock() {
  const dock = $('#inboxDock');
  const items = trip.inbox;
  dock.hidden = ui.readonly && !items.length; // 공유받은 일정: 빈 보관함은 보여줄 게 없다
  dock.classList.toggle('is-empty', !items.length);
  // P1-5: 모바일은 접힌 한 줄("장소 보관함 5")이 기본. 직접 펼치거나 접었으면 그대로
  const open = prefs.dockOpen ?? !narrowMq.matches;
  // 이름만 있는 칩: 누르면 액션 시트(보낼 날·지도에서 보기·삭제), 길게 눌러(터치) 끌면 일차로 옮긴다
  const chips = items
    .map(
      (it) => `<li class="item dock-card dock-chip" data-id="${it.id}" style="--c:${INBOX_COLOR}">
        <button type="button" class="chip-btn" data-action="chip-menu" title="${esc(it.name)}" aria-label="${esc(ui.readonly ? t('{name} 지도에서 보기', { name: it.name }) : t('{name} — 보낼 날·지도·삭제', { name: it.name }))}"><span class="nm">${esc(it.name)}</span></button>
      </li>`,
    )
    .join('');
  dock.innerHTML = `<div class="dock-head">
      <button class="dock-toggle" data-action="dock-toggle" aria-expanded="${open}">
        <span class="dot" style="--c:${INBOX_COLOR}"></span><strong>${esc(t('장소 보관함'))}</strong>
        <span class="count">${esc(t('{n}곳', { n: items.length }))}</span><span class="chev">${esc(open ? t('접기 ▾') : t('펼치기 ▴'))}</span>
      </button>
    </div>
    ${
      open
        ? `<ol class="items dock-items dock-chips" data-list="${M.INBOX}" data-empty="${esc(t('여기로 끌어오거나, 추가할 곳을 장소 보관함으로 고르세요'))}">${chips}</ol>`
        : ''
    }`;
}

/** P1-5: 보관함 칩을 누르면 — 보낼 날 / 지도에서 보기 / 삭제 */
async function openChipMenu(id) {
  const found = M.findItem(trip, id);
  if (!found) return;
  if (ui.readonly) return locateMapPlace(found.item); // 공유받은 일정: 지도에서 보기만
  const choice = await ask({
    title: found.item.name,
    html: `<label class="chip-send">${esc(t('보낼 날'))}<select id="chipMoveTo" class="inp" data-ui-select>${moveOptions(M.INBOX, t('보낼 날 →'))}</select></label>`,
    actions: [
      { value: 'delete', label: t('삭제'), danger: true },
      { value: 'locate', label: t('지도에서 보기') },
      { value: 'send', label: t('보내기'), primary: true },
    ],
  });
  const target = $('#chipMoveTo')?.value;
  if (choice === 'send' && target) moveToList(id, target);
  else if (choice === 'locate') locateMapPlace(found.item);
  else if (choice === 'delete') {
    const index = found.index;
    const copy = structuredClone(found.item);
    const tripId = trip.id;
    M.removeItem(trip, id);
    if (commit().ok) {
      pushUndo(t('"{name}"을(를) 삭제했어요', { name: copy.name }), () => {
        if (trip?.id !== tripId || ui.readonly || M.findItem(trip, copy.id)) return;
        trip.inbox.splice(Math.min(index, trip.inbox.length), 0, copy);
        saved(commit(), t('되돌렸어요'));
      });
    }
  }
}

/** 하루 타임라인 본문: 항공(출발) → 출발 숙소 → 장소들 → 귀가 숙소 → 항공(귀국) */
function dayBodyHtml(l) {
  const st = M.dayStays(trip, l.dayIndex);
  // 구간 거리: route[k-1] → route[k]. 출발 숙소가 있으면 장소 j는 route[j+1].
  const route = M.dayRoute(trip, l.dayIndex);
  const off = st.start ? 1 : 0;
  const legTo = (k) => (k > 0 && route[k] ? M.routeLeg(route[k - 1], route[k]) : null);
  const overlaps = dayTimeConflicts(l.dayIndex);
  return `<div class="timeline" style="--c:${l.color}">
      ${flightRowsHtml(l.dayIndex, 'top')}
      ${st.start ? stayRowHtml(st.start, l.dayIndex, 'start', st) : ''}
      <ol class="items" data-list="${l.id}" data-empty="${esc(ui.readonly ? t('아직 정한 곳이 없어요') : t('장소를 검색하거나 여기로 끌어오세요'))}">${l.items.map((it, j) => itemHtml(it, j, true, legTo(off + j), l.items, overlaps.get(it.id) ?? '')).join('')}</ol>
      ${st.end ? stayRowHtml(st.end, l.dayIndex, 'end', st, legTo(route.length - 1)) : ''}
      ${flightRowsHtml(l.dayIndex, 'bottom')}
    </div>`;
}

function dayToolsHtml(l) {
  const url = M.routeDirectionsUrl(M.dayRoute(trip, l.dayIndex));
  const link = url ? `<a class="route-link" href="${href(url)}" target="_blank" rel="noopener" title="${esc(t('이 날 동선 전체를 구글맵 길찾기로 열기'))}">${esc(t('길찾기'))}</a>` : '';
  const copy = `<button data-action="day-copy" data-day="${l.dayIndex}" title="${esc(t('이 날 일정을 카톡에 붙일 글로 복사해요'))}">${esc(t('카톡용 복사'))}</button>`;
  const route = link + copy;
  if (ui.readonly) return route;
  const movable = l.items.filter((it) => !it.time && !it.pinned).length;
  return `${route}${M.nightStay(trip, l.dayIndex) ? '' : `<button data-action="stay-here" data-day="${l.dayIndex}" title="${esc(t('이 날부터 묵을 숙소 추가'))}">${esc(t('+ 숙소'))}</button>`}${
    movable > 1 ? `<button data-action="route-opt" data-list="${l.id}" title="${esc(t('숙소 기준으로 덜 돌아가는 순서를 찾아요. 시간을 정한 장소는 그대로 둬요'))}">${esc(t('동선 정리'))}</button>` : ''
  }${l.items.length > 1 ? `<button data-action="sort-time" data-list="${l.id}">${esc(t('시간순'))}</button>` : ''}${
    trip.days.length > 1 ? `<button data-action="day-order" aria-haspopup="dialog" title="${esc(t('여러 날의 장소 묶음 순서를 한 번에 바꿔요 (날짜·숙소·항공편은 그대로)'))}">${esc(t('일자 순서'))}</button>` : ''
  }${
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
  const night = M.nightStay(trip, l.dayIndex);
  const date = M.formatDate(trip.days[l.dayIndex].date);
  const dayId = trip.days[l.dayIndex].id;
  const chips = [
    `<span class="wx-slot" data-wx="${dayId}">${wxChipHtml(ui.weather.data[dayId], dayId)}</span>`,
    sum.places ? `<span class="chip">${esc(t('{n}곳', { n: sum.places }))}</span>` : '',
    sum.km >= 0.05 ? `<span class="chip">${esc(t('이동 {km}', { km: M.formatKm(sum.km) }))}</span>` : '',
    sum.from ? `<span class="chip">${esc(sum.from)}${sum.to !== sum.from ? ` – ${esc(sum.to)}` : ''}</span>` : '',
    night ? `<span class="chip stay">${esc(t('오늘 밤 숙소'))} · ${esc(night.name)}</span>` : '',
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
  destroyTimes(daysEl); // P1-1: 다시 그리기 전에 시간 선택기(flatpickr)를 정리한다
  daysEl.innerHTML =
    (ui.readonly ? '' : trendSectionHtml()) + lists.map(dayCardHtml).join('');
  enhanceDates(daysEl);
  enhanceTimes(daysEl); // P1-1: 장소 시간도 같은 TimeField

  for (const ol of [...$$('ol.items', daysEl), ...$$('ol.items', $('#inboxDock'))]) {
    ui.sortables.push(
      new Sortable(ol, {
        group: 'plan',
        disabled: Boolean(ui.readonly),
        handle: ol.classList.contains('dock-chips') ? '.chip-btn' : '.drag', // P1-5: 칩은 칩 자체를 끈다 (터치는 길게 눌러서)
        animation: 150,
        ghostClass: 'ghost-item',
        emptyInsertThreshold: 24,
        // P1-4: 터치는 길게 눌러야 끌기 시작 (스크롤과 겹치지 않게)
        delay: 250,
        delayOnTouchOnly: true,
        touchStartThreshold: 6,
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
        // P1-4: 터치에서는 길게 눌러야(250ms) 끌기 시작 — 좌우로 밀면 늘 가로 스크롤
        delay: 250,
        delayOnTouchOnly: true,
        touchStartThreshold: 6,
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
  if (dayIdx !== -1 && dayIdx !== ui.day && curView() !== 'board') {
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
// 보관함과 select는 제외: 카드를 접으며 일정을 다시 그리면 열리던 "보낼 날" 드롭다운이 새 요소로 바뀌어 닫힌다
const OUTSIDE_SAFE = '#map, .mapwrap, .leaflet-container, .leaflet-popup, dialog, .dp-pop, .menu, .tripsw, .toast, #toast, .ctx, .inbox-dock, select, option';
let cardTap = null;
document.addEventListener('pointerdown', (e) => {
  cardTap = (ui.openItem || ui.openStay) && e.isPrimary ? { x: e.clientX, y: e.clientY, target: e.target, scrollY } : null;
}, true);
document.addEventListener('pointermove', (e) => {
  if (cardTap && Math.hypot(e.clientX - cardTap.x, e.clientY - cardTap.y) >= 8) cardTap = null;
}, true);
document.addEventListener('pointercancel', () => (cardTap = null), true);
// 손가락을 뗄 때 좌표가 제자리로 돌아와도, 그사이 화면이 스크롤됐다면 드래그다 (관성 스크롤 포함)
addEventListener('scroll', () => (cardTap = null), { capture: true, passive: true });
document.addEventListener('pointerup', (e) => {
  const tap = cardTap;
  cardTap = null;
  if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 8 || Math.abs(scrollY - tap.scrollY) >= 8) return;
  const target = tap.target;
  if (!(target instanceof Element) || !document.contains(target)) return;
  if (target.closest(OUTSIDE_SAFE)) return;
  const card = ui.openItem
    ? $(`.item[data-id="${CSS.escape(ui.openItem)}"]`)
    : $(`.stay-row[data-key="${CSS.escape(ui.openStay)}"]`)?.closest('.tl-row');
  if (!card || card.contains(target)) return;
  // 입력 중인 칸이 카드 안에 있으면 (키보드가 떠 있는 상태 등) 닫지 않는다
  const active = document.activeElement;
  if (active && card.contains(active) && active.matches('select, input[type="time"], input.time-field, input[type="date"]') && target === document.documentElement) return;
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
  } else if (action === 'edit-time') {
    ui.openItem = id;
    ui.openStay = null;
    renderDays();
    $(`.item[data-id="${CSS.escape(id)}"] [data-field="time"]`)?.focus();
  } else if (action === 'push-30') {
    const found = M.findItem(trip, id);
    if (!found || ui.readonly) return;
    const n = M.shiftTimesFrom(found.list, found.index, 30);
    saved(commit(), n ? t('{n}곳의 시간을 30분씩 늦췄어요', { n }) : t('더 늦출 수 있는 시간이 없어요'));
    $(`.item[data-id="${CSS.escape(id)}"] [data-action="push-30"]`)?.focus({ preventScroll: true });
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
    renderTarget();
    renderDays();
    renderMap({ fit: true });
  } else if (action === 'trend-scroll') {
    const list = $('.trend-list');
    const card = list?.querySelector('.trend-card');
    if (list && card) list.scrollBy({ left: Number(btn.dataset.dir) * (card.offsetWidth + 8), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } else if (action === 'trend-search') {
    const q = $('#search');
    q.scrollIntoView({ block: 'center', behavior: 'smooth' });
    q.focus({ preventScroll: true });
  } else if (action === 'trend-collection') {
    if (btn.dataset.collection === trendCollection() && trendsOpen()) return;
    ui.trendCollection = btn.dataset.collection;
    if (!trendsOpen()) {
      prefs.trendsUser = true;
      savePrefs();
    }
    renderDays();
    renderMap();
    $(`#trend-tab-${ui.trendCollection}`)?.focus({ preventScroll: true });
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
    saved(commit(), r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: bm(r.expense.krw) }));
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
  } else if (action === 'place-ops' || action === 'place-move' || action === 'place-copy') {
    openPlaceOps(id, action === 'place-copy' ? 'copy' : 'move');
  } else if (action === 'day-order') {
    openDayOrder();
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
    const row = btn.closest('.stay-row');
    if (!ui.readonly) return openStays({ id: row.dataset.stay });
    const key = row.dataset.key;
    ui.openStay = ui.openStay === key ? null : key;
    ui.openItem = null;
    renderDays();
  } else if (action === 'stay-locate') {
    const s = M.findStay(trip, btn.closest('.stay-row').dataset.stay);
    if (!s) return;
    locateMapPlace(s);
  } else if (action === 'stay-here') {
    openStays({ start: Number(btn.dataset.day) });
  }
});

const refreshMapSoon = debounce(() => renderMap(), 300);
$('#days').addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  const id = e.target.closest('.item')?.dataset.id;
  const found = id && M.findItem(trip, id);
  if (!field || !found) return;
  // P1-1: 시간 칸은 입력 중인 글자를 저장하지 않는다 — TimeField가 'HH:MM'(또는 빈 값)으로 확정할 때만
  if (field === 'time' && e.target.classList.contains('time-field') && !/^(\d{2}:\d{2})?$/.test(e.target.value)) return;
  found.item[field] = field === 'name' ? e.target.value || t('이름 없는 장소') : e.target.value;
  markEdited();
  M.touch(trip);
  persistSoon();
  const li = e.target.closest('.item');
  const it = found.item;
  $('.item-name', li).innerHTML = nameHtml(it);
  $('.item-sub', li).textContent = li.classList.contains('dock-card') ? it.memo.split('\n')[0] || it.address : it.memo || it.address;
  const timeEl = $('.tl-time', li);
  if (timeEl) timeEl.textContent = it.time;
  refreshMapSoon();
});

// 시간을 확정하면 그날 시간 겹침을 다시 계산한다 (입력 칸 포커스는 유지)
$('#days').addEventListener('change', (e) => {
  if (e.target.dataset.field !== 'time') return;
  const id = e.target.closest('.item')?.dataset.id;
  const field = e.target;
  setTimeout(() => {
    if (!trip || ui.openItem !== id) return;
    const li = field.closest('.item');
    const focus = document.activeElement;
    // Tab으로 같은 장소의 다른 칸으로 옮겼으면 그 칸을 떠날 때 다시 그린다 (포커스를 빼앗지 않게)
    if (li && focus !== field && li.contains(focus)) {
      const later = (ev) => {
        if (li.contains(ev.relatedTarget)) return;
        li.removeEventListener('focusout', later);
        setTimeout(() => trip && ui.openItem === id && renderDays());
      };
      li.addEventListener('focusout', later);
      return;
    }
    const keep = focus === field;
    renderDays();
    if (keep) $(`.item[data-id="${CSS.escape(id)}"] [data-field="time"]`)?.focus({ preventScroll: true });
  });
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


$('#pinLegend').addEventListener('click', (e) => {
  if (e.target.closest('[data-legend-toggle]')) {
    prefs.legendOpen = !legendOpen();
    savePrefs();
    renderPinLegend(catEmptyText());
    $('#pinLegend [data-legend-toggle]')?.focus();
    return;
  }
  if (e.target.closest('[data-cat-all]')) {
    // 0건 안내에서 '전체 일차에서 보기': 일차 강조를 풀고 같은 종류를 전체 여행에서 강조한다
    const cat = ui.catFilter;
    ui.focusList = null;
    renderDays();
    renderMap({ fit: true });
    $(`#pinLegend [data-cat-filter="${cat}"]`)?.focus();
    return;
  }
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

function showAllRoutes() {
  ui.focusList = null;
  renderDays();
  renderMap({ fit: true });
}

$('#showAll').addEventListener('click', () => {
  if (ui.focusList == null) return selectDay(ui.day, { scroll: false });
  showAllRoutes();
});

initScrollFab({ $, $$ });

initSearchBar({ $, prefs, curView, get ui() { return ui; } });

/* ───────── 보기 방식 (기본형 / 보드형) ───────── */
// P1-3: 767px 이하에서는 보드를 숨기고 늘 목록으로. 저장값(prefs.view)은 덮어쓰지 않아 데스크톱으로 돌아가면 보드가 유지된다
narrowMq.addEventListener('change', () => {
  if (prefs.view !== 'board') return;
  if (trip) ui.focusList = curView() === 'list' ? trip.days[ui.day ?? 0]?.id ?? null : null;
  applyView();
  if (trip) {
    renderDays();
    renderMap();
  }
});
function applyView() {
  const layout = $('.layout');
  layout.dataset.view = curView();
  layout.classList.toggle('map-hidden', !narrowMq.matches && prefs.mapHidden); // P1-7: 목록 보기에서도 데스크톱은 지도를 접을 수 있다
  document.body.dataset.view = curView();
  $$('.seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === curView());
    b.setAttribute('aria-pressed', String(b.dataset.view === curView()));
  });
  $('#mapToggle').textContent = prefs.mapHidden ? t('지도 보기') : t('지도 숨기기');
  $('#miniMapToggle').textContent = prefs.mapHidden ? t('지도 보기') : t('지도 숨기기');
  setTimeout(() => map.invalidateSize(), 0);
}
$$('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    if (prefs.view === b.dataset.view) return;
    prefs.view = b.dataset.view;
    // 날짜별 보기는 고른 날만 강조, 보드는 전체
    if (trip) ui.focusList = curView() === 'list' ? trip.days[ui.day ?? 0]?.id ?? null : null;
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
  ui.resultsFor = null;
  $('#resultsStatus').textContent = '';
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

/**
 * 검색 결과. forQuery = 이 결과를 요청한 검색어 (늦게 온 옛 응답이 지금 검색어의 결과로 취급되지 않게, GPT 2차 #11).
 * 결과마다 '추가'·'위치 보기' 버튼이 따로 있는 일반 목록이다 (listbox 안에 버튼을 넣지 않는다, GPT 2차 #18).
 * 방향키로 고른 결과는 화면에서 강조하고 스크린리더에는 상태 문구로 알린다.
 */
function showResults(places, forQuery = searchEl.value.trim()) {
  ui.results = places;
  ui.resultsFor = forQuery;
  ui.activeResult = places.length ? 0 : -1;
  if (!places.length) return showMessage(t('검색 결과가 없어요. 영어나 현지어로도 검색해 보세요.'));
  resultsEl.setAttribute('aria-label', t('검색 결과'));
  resultsEl.innerHTML = places
    .map(
      (p, i) =>
        `<li id="result-${i}" data-i="${i}"${i === 0 ? ' class="active" aria-current="true"' : ''}><div class="r-main"><div class="r-name">${esc(p.name)}</div><div class="r-addr">${esc(candidateMeta(p))}</div></div>
          <button type="button" class="r-add" data-add="${i}" aria-label="${esc(t('{name} 추가', { name: p.name }))}">${esc(t('추가'))}</button>
          <button type="button" class="r-preview" data-preview="${i}" aria-label="${esc(t('{name} 위치 미리 보기', { name: p.name }))}">${esc(t('위치 보기'))}</button></li>`,
    )
    .join('');
  resultsEl.hidden = false;
  searchEl.setAttribute('aria-controls', 'results');
  searchEl.setAttribute('aria-expanded', 'true');
  announceResult();
}
/** 방향키로 고른 결과를 스크린리더에 알린다 (Enter로 추가) */
function announceResult() {
  const p = ui.results[ui.activeResult];
  $('#resultsStatus').textContent = p ? t('{n}개 중 {i}번째: {name} · Enter로 추가', { n: ui.results.length, i: ui.activeResult + 1, name: p.name }) : '';
}

function hideResults() {
  resultsEl.hidden = true;
  ui.results = [];
  ui.resultsFor = null;
  searchEl.setAttribute('aria-expanded', 'false');
  $('#resultsStatus').textContent = '';
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
  const sourceUrl = parsed && q.length <= 2000 ? M.safeUrl(q) : '';
  try {
    if (parsed && 'lat' in parsed) {
      let place = { name: parsed.name ?? '', address: '', lat: parsed.lat, lng: parsed.lng, url: sourceUrl };
      // 주소를 찾는 동안 추가해도 '위치 확인 중…'이 이름으로 남지 않게: 찾으면 나중에 채운다
      const lookup = reversePlace(parsed.lat, parsed.lng, ctrl.signal).catch(() => null);
      showResults([{ ...place, name: place.name || t('위치 확인 중…'), lookup, unnamed: !place.name }], q);
      const r = await lookup;
      place = { ...place, name: place.name || r?.name || t('링크로 추가한 장소'), address: r?.address ?? '', region: r?.region ?? '' };
      if (!ctrl.signal.aborted) showResults([place], q);
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
      return showResults(sourceUrl ? places.map((place) => ({ ...place, url: sourceUrl })) : places, q);
    }
    showMessage(t('검색 중…'));
    const places = await searchPlaces(query, near, ctrl.signal);
    if (!ctrl.signal.aborted) showResults(sourceUrl ? places.map((place) => ({ ...place, url: sourceUrl })) : places, q);
  } catch (err) {
    if (err.name !== 'AbortError') showMessage(searchErrorText(err), { retry: true });
  }
}

searchEl.addEventListener('input', () => {
  ui.resultsFor = null; // 입력이 바뀌는 순간 보이는 결과는 옛 검색어의 것 (Enter·클릭이 넣지 않게)
  if (ui.candidate?.fromSearch != null) {
    // 검색 결과의 '위치 보기'로 연 지도 후보도 치운다 — 검색어를 되돌려도 옛 후보를 넣지 않게 (GPT 5차 #6)
    clearCandidate();
    $('#mapPlace').hidden = true;
  }
});
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
    $$('li', resultsEl).forEach((li, i) => {
      li.classList.toggle('active', i === ui.activeResult);
      if (i === ui.activeResult) li.setAttribute('aria-current', 'true');
      else li.removeAttribute('aria-current');
    });
    announceResult(); // 스크린리더가 지금 고른 결과를 읽게
    $(`#result-${ui.activeResult}`)?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // 결과가 지금 검색어에서 나온 것일 때만 추가 (검색어를 바꾸고 바로 Enter → 새로 검색, GPT 검수 #8)
    const p = ui.resultsFor === searchEl.value.trim() ? ui.results[ui.activeResult] : null;
    if (p) addPlace(p);
    else runSearch({ explicit: true });
  }
});
resultsEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return void runSearch({ explicit: true });
  const add = e.target.closest('[data-add]');
  if (add) {
    if (ui.resultsFor !== searchEl.value.trim()) return void runSearch({ explicit: true }); // 옛 검색어 결과는 넣지 않고 다시 찾는다
    const p = ui.results[Number(add.dataset.add)];
    if (p) addPlace(p);
    return;
  }
  const pv = e.target.closest('[data-preview]');
  if (pv) {
    if (ui.resultsFor !== searchEl.value.trim()) return void runSearch({ explicit: true });
    const found = ui.results[Number(pv.dataset.preview)];
    if (!found) return;
    const p = { ...found, fromSearch: ui.resultsFor }; // 지도 카드에서 추가할 때 다시 확인한다
    if (pickViewport.matches) {
      resultsEl.hidden = true;
      showTab('map');
      setTimeout(() => showCandidate(p), 50);
    } else showCandidate(p);
    return;
  }
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  if (ui.resultsFor !== searchEl.value.trim()) return void runSearch({ explicit: true }); // 결과 본문을 눌러도 옛 검색어 결과는 넣지 않는다 (GPT 3차 #9)
  addPlace(ui.results[+li.dataset.i]);
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
      const found = M.findItem(trip, ui.lastAddedId);
      const it = found?.item;
      if (!it || it.lat !== rest.lat) return;
      if (unnamed && it.name === tmpName) it.name = r.name || tmpName;
      if (!it.address) it.address = r.address ?? '';
      commit();
    });
    place = { ...rest, name: tmpName };
  }
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
  renderPlanEmpty();
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
  // P0-9: 기본은 "날짜 기준 유지" — 장소·숙소·지출이 원래 날짜에 남는다. 시작일이 바뀌면 "일차 기준"도 고를 수 있다.
  const impact = M.dateChangeImpact(trip, start, end, { keepDates: true });
  if (!impact) return render();
  const hasContent = placeCount() || trip.stays.length || (trip.expenses ?? []).some((e) => Number.isInteger(e.day) && e.day >= 0);
  const choose = impact.shifted && M.dateShift(trip, start) != null && hasContent;
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
  if (choose) {
    const byIndex = M.dateChangeImpact(trip, start, end);
    const extra = [
      byIndex.places.length ? t('장소 {n}곳은 장소 보관함으로 옮겨요', { n: byIndex.places.length }) : '',
      byIndex.expenses.length ? t('지출 {n}건은 ‘일정 외’로 남아요', { n: byIndex.expenses.length }) : '',
    ].filter(Boolean).join(' · ');
    items.push([
      t('기존 장소·숙소·지출은 날짜 그대로 유지돼요'),
      t('‘일차 순서대로 옮기기’를 고르면 모두 일차 번호를 따라 {date}부터로 함께 옮겨져요', { date: M.formatDate(start) }) + (extra ? ` (${extra})` : ''),
    ]);
  }
  let mode = 'date';
  if (items.length) {
    mode = await ask({
      title: t('여행 날짜를 바꿀까요?'),
      html: `<p>${esc(`${M.formatDate(start)} – ${M.formatDate(end)} · ${tripLength(M.dateRange(start, end).length)}`)}</p>
        <ul class="impact">${items.map(([head, detail]) => `<li><b>${esc(head)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</li>`).join('')}</ul>`,
      actions: choose
        ? [
            { value: 'date', label: t('날짜 그대로 두고 바꾸기'), primary: true },
            { value: 'index', label: t('일차 순서대로 옮기기') },
          ]
        : [{ value: 'date', label: t('날짜 바꾸기'), primary: true }],
    });
    if (mode !== 'date' && mode !== 'index') return render();
  }
  const res = M.setTripDates(trip, start, end, { keepDates: mode === 'date' });
  if (ui.bf && ui.bf.day >= trip.days.length) ui.bf.day = -1;
  saved(commit(), res.moved || impact.expenses.length ? t('날짜를 바꿨어요') : '');
}

/**
 * Ask how to handle dates outside the trip. Return a proposed extension, null
 * for dates inside the trip or clipping, and false for cancellation.
 */
async function extendTripFor(from, to, opts) {
  const r = M.extendedRange(trip, from, to, opts);
  if (!r) return null;
  const actions = [];
  if (!r.tooLong) actions.push({ value: 'extend', label: t('여행 기간 늘리기'), primary: true });
  if (stayRangeWithin(trip, from, to)) actions.push({ value: 'clip', label: t('기간 안만 저장(잘라서)') });
  const choice = await ask({
    title: trip.startDate ? t('여행 기간을 늘릴까요?') : t('여행 날짜를 정할까요?'),
    body: r.tooLong
      ? t('여행은 최대 {n}일까지예요. 기간을 늘리지 않았어요', { n: M.MAX_DAYS })
      : t('여행을 {range}로 늘릴까요? 기존 일정은 날짜 그대로 유지돼요', { range: `${M.formatDate(r.start)} – ${M.formatDate(r.end)}` }),
    actions,
  });
  return choice === 'extend' ? r : choice === 'clip' ? null : false;
}
/**
 * P0-1: 여행지 위치 확인·다시 고르기. 작은 지도에 지금 여행지 좌표를 보여 주고, 지도를 누르거나 핀을 끌어 옮긴다.
 * 여행지 좌표는 장소가 없는 날의 지도 중심·날씨·장소 검색 거리 기준으로 쓰인다.
 */
async function openDestLocation() {
  if (!trip || ui.readonly) return;
  const start = trip.center ?? map.getCenter();
  let pick = { lat: start.lat, lng: start.lng };
  const choice = ask({
    title: t('여행지 위치'),
    html: `<p>${esc(t('장소가 없는 날의 지도·날씨와 검색 거리는 이 위치를 기준으로 해요. 지도를 누르거나 핀을 끌어 옮기세요.'))}</p>
      <div id="destMiniMap" class="dest-mini" role="application" aria-label="${esc(t('여행지 위치 지도'))}"></div>
      <p class="fine" id="destMiniCoord"></p>`,
    actions: [{ value: 'ok', label: t('이 위치로 정하기'), primary: true }],
  });
  const el = $('#destMiniMap');
  const mini = L.map(el, { zoomControl: true, attributionControl: true }).setView([pick.lat, pick.lng], trip.center ? 10 : 4);
  tileGroup(mapTileKind()).addTo(mini);
  const pin = L.marker([pick.lat, pick.lng], { draggable: true, keyboard: true, title: t('여행지 위치') }).addTo(mini);
  const show = () => ($('#destMiniCoord').textContent = `${pick.lat.toFixed(4)}, ${pick.lng.toFixed(4)}`);
  const move = (ll) => {
    pick = { lat: ll.lat, lng: ll.lng };
    pin.setLatLng(ll);
    show();
  };
  pin.on('dragend', () => move(pin.getLatLng()));
  mini.on('click', (e) => move(e.latlng));
  show();
  requestAnimationFrame(() => mini.invalidateSize());
  const v = await choice;
  mini.remove();
  if (v !== 'ok' || !trip) return;
  trip.center = { lat: +pick.lat.toFixed(6), lng: +pick.lng.toFixed(6) };
  trip.centerManual = true; // 직접 고른 위치는 자동 고치기(repairCenter)가 되돌리지 않는다
  saved(commit(), t('여행지 위치를 바꿨어요'));
}
$('#destLocBtn').addEventListener('click', openDestLocation);

$('#startDate').addEventListener('change', onDatesChange);
$('#endDate').addEventListener('change', onDatesChange);

$('#exportXlsx').addEventListener('click', async () => {
  try {
    await exportXlsx(trip);
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
  else if (action === 'stays') openStays();
  else if (action === 'share') {
    $('.menu summary').focus();
    $('#shareBtn').click();
  }
  else if (action === 'theme') $('#themeBtn').click();
  else if (action === 'about') {
    $('.menu summary').focus();
    ask({ title: t('앱 정보'), body: `XenoTravel · ${t('빌드')} ${buildCommit}`, actions: [], cancel: t('닫기') });
  }
});

const BACKUP_INTERVAL = 3 * 24 * 60 * 60 * 1000;
function renderBackupReminder() {
  const last = prefs.backups?.[trip?.id];
  const count = trip ? trip.days.reduce((n, day) => n + day.items.length, trip.expenses?.length ?? 0) : 0;
  const due = Boolean(trip && !ui.readonly && prefs.page !== 'home' &&
    (last ? Date.now() - last >= BACKUP_INTERVAL : count >= 10 || Date.now() - Date.parse(trip.createdAt) >= BACKUP_INTERVAL));
  $('#backupDot').hidden = !due;
  $('#backupAge').textContent = trip && !ui.readonly ? lastBackupLabel(last) : '';
  if (trip && !ui.readonly && prefs.page !== 'home' && trip.id !== ui.nagChecked) {
    ui.nagChecked = trip.id; // 여행을 열 때 한 번
    scheduleNag();
  }
  $('.menu summary').setAttribute('aria-label', due ? t('더보기 · 백업 파일을 저장할 때예요') : t('더보기'));
}

function openBackup() {
  ask({
    title: t('전체 백업 저장 (.json)'),
    body: t('백업 파일로 여행을 다른 기기에 옮길 수 있어요.'),
    actions: [{ value: 'save', label: t('백업 파일 저장'), primary: true }],
  }).then((choice) => { if (choice === 'save') saveTripBackup(); });
}

async function saveTripBackup() {
  if (!trip) return;
  const snapshot = structuredClone(trip);
  const readonly = ui.readonly;
  try {
    const blob = readonly ? null : await Covers.get(snapshot.id);
    downloadJson({ ...snapshot, cover: blob ? await Covers.encode(blob) : null });
  } catch {
    toast(t('백업 파일을 저장하지 못했어요'), 4000);
    return;
  }
  if (readonly) return;
  prefs.backups ??= {};
  prefs.backups[snapshot.id] = Date.now();
  if (prefs.changes) prefs.changes[snapshot.id] = 0;
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
  let imported, cover;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error(t('파일이 너무 커요 (10MB 이하)'));
    const data = JSON.parse(await file.text());
    imported = M.validateTrip(data);
    if (Object.hasOwn(data, 'cover')) {
      try {
        cover = data.cover === null ? null : await Covers.decode(data.cover);
      } catch {
        throw new Error(t('커버 사진을 읽지 못했어요'));
      }
    }
    if (imported.expenses) B.normalizeExpenses(imported); // 예전 백업: 결제수단·통화·적용 환율 기본값
  } catch (err) {
    return void ask({
      title: t('백업 파일을 불러오지 못했어요'),
      body: `${err instanceof SyntaxError ? t('JSON 파일을 읽을 수 없어요. 파일이 잘렸거나 다른 형식이에요.') : err.message} ${t('지금 있는 여행은 바뀌지 않았어요.')}`,
      actions: [{ value: 'ok', label: t('확인'), primary: true }],
      cancel: null,
    });
  }
  // 지출·체크 중 읽지 못한 기록이 있으면 미리 알리고, 같은 여행이 있으면 덮어쓰지 않고 사본으로만 가져온다
  const dropped = (imported.dropped?.expenses ?? 0) + (imported.dropped?.checks ?? 0);
  if (dropped) {
    const ok = await ask({
      title: t('일부 기록을 읽지 못했어요'),
      body: t('지출 {e}건 · 체크 항목 {c}건이 형식이 맞지 않아 빠져요. 나머지는 그대로 가져와요.', { e: imported.dropped.expenses, c: imported.dropped.checks }),
      actions: [{ value: 'go', label: t('나머지 가져오기'), primary: true }],
    });
    if (!ok) return;
  }
  const existing = store.trips[imported.id];
  if (existing) {
    let same = !dropped && JSON.stringify(existing) === JSON.stringify(imported);
    if (same && cover !== undefined) {
      try {
        const current = await Covers.get(imported.id);
        same = cover && current ? await Covers.encode(cover) === await Covers.encode(current) : !cover && !current;
      } catch {
        return toast(t('커버 사진을 읽지 못했어요'), 4000);
      }
    }
    const choice = await ask({
      title: t('이미 있는 여행이에요'),
      body: same
        ? t('"{title}"이(가) 이미 같은 내용으로 있어요. 사본을 하나 더 만들까요?', { title: existing.title })
        : t('"{title}"이(가) 이미 있어요. 사본으로 가져오면 지금 여행은 그대로 두고 새 여행을 하나 더 만들어요. 덮어쓰면 지금 여행이 백업 파일 내용으로 바뀌어요.', { title: existing.title }),
      actions: same || dropped ? [{ value: 'copy', label: t('사본으로 가져오기'), primary: true }] : [
        { value: 'overwrite', label: t('덮어쓰기'), danger: true },
        { value: 'copy', label: t('사본으로 가져오기'), primary: true },
      ],
    });
    if (!choice) return;
    if (choice === 'copy') imported = { ...imported, id: M.uid(), title: t('{title} (사본)', { title: imported.title }), createdAt: new Date().toISOString() };
  }
  let previousCover;
  if (cover !== undefined) {
    try {
      previousCover = await Covers.get(imported.id);
      if (cover) await Covers.put(imported.id, cover);
      else if (previousCover) await Covers.remove(imported.id);
    } catch {
      return toast(t('커버 사진을 저장하지 못했어요'), 4000);
    }
  }
  const r = switchTrip(imported, { save: true });
  if (r?.ok) {
    toast(dropped ? t('"{title}"을(를) 불러왔어요 · 읽지 못한 기록 {n}건은 빠졌어요', { title: imported.title, n: dropped }) : t('"{title}"을(를) 불러왔어요', { title: imported.title }), dropped ? 5000 : 2200);
  } else if (cover !== undefined) {
    try {
      if (previousCover) await Covers.put(imported.id, previousCover);
      else if (cover) await Covers.remove(imported.id);
    } catch {
      toast(t('커버 사진을 저장하지 못했어요'), 4000);
    }
  }
});

/* ───────── 메인 페이지 · 주소(라우팅) ─────────
 * #/               메인 (새 여행 만들기 · 내 여행 · 요즘 뜨는 곳)
 * #/trip/<id>      일정   (#/trip/<id>/budget, #/trip/<id>/check)
 * 공유 링크(/s/<id>, #s=…)는 따로 처리한다.
 */
const POPULAR = [k('오사카'), k('도쿄'), k('후쿠오카'), k('교토'), k('삿포로'), k('오키나와'), k('다낭'), k('방콕'), k('타이베이'), k('파리')];
// 여행지 목록(고정 좌표·국가 코드)은 lib/destinations.js (P0-1)

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

let homeFeature = null;

/** 화면 이동: 주소를 바꾸면 hashchange → route()가 그린다 (뒤로 가기도 같은 길로) */
function go(page, id = trip?.id ?? store.currentId) {
  const h = tripHash(page, id);
  if (location.hash === h || (h === '#/' && !location.hash)) route();
  else location.hash = h;
}

/** 주소에 맞는 화면을 그린다. 이 브라우저에 없는 여행 주소면 이유와 복구 방법을 메인에 보여준다. */
function route() {
  if (ui.readonly) return;
  const feature = homeFeature?.hash === location.hash ? homeFeature.action : null;
  homeFeature = null;
  const m = /^#\/trip\/([^/]+)(?:\/(budget|check))?$/.exec(location.hash);
  let id = null;
  try {
    id = m ? decodeURIComponent(m[1]) : null;
  } catch {
    id = m[1]; // 잘못된 % 인코딩(#/trip/%)도 '찾을 수 없는 여행' 안내로 보낸다 (시작 화면이 멈추지 않게)
  }
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
  if (feature === 'share') $('#shareBtn').click();
  else if (feature === 'flights') openFlights();
  else if (feature === 'backup') openBackup();
}

/** 여행 열기 (화면 이동 없이 상태만) */
function openTrip(tr, { save = false } = {}) {
  leaveShared();
  setPicking(false);
  map.closePopup();
  clearCandidate();
  trip = tr;
  ui.trendCollection = 'trending';
  ui.mapLastDay = null;
  store.currentId = tr.id;
  if (save) store.trips[tr.id] = tr;
  ui.openItem = null;
  ui.routePlan = ui.routeUndo = null;
  ui.day = M.todayIndex(tr, TODAY);
  ui.focusList = curView() === 'list' ? tr.days[ui.day]?.id ?? null : null;
  ui.target = null;
  ui.bf = null;
  const res = save ? saveNow() : (persistSoon(), null);
  if (!trip) return res;
  render({ fit: true });
  return res;
}

/** 다른 여행으로 바꾸기. save면 저장 결과({ ok, conflicts?, error? })를 돌려준다 — 저장이 실제로 된 뒤에만 성공을 알린다 */
function switchTrip(tr, { save = false } = {}) {
  const r = openTrip(tr, { save });
  if (trip) go('plan', trip.id);
  return r;
}

function deleteTrip(id) {
  const tr = store.trips[id];
  if (!tr || !confirm(t('"{title}" 여행을 삭제할까요? 되돌릴 수 없어요.', { title: tr.title }))) return;
  delete store.trips[id];
  if (trip?.id === id) {
    trip = null;
    store.currentId = Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;
  }
  if (saved(saveNow(), t('"{title}"을(를) 삭제했어요', { title: tr.title }))) {
    Covers.remove(id).catch(() => {});
  }
  go('home');
}

/** 새 여행: 여행지 좌표(와 나라)를 찾고 만든 뒤 일정 화면으로. 나라를 알면 가계부 통화도 그 나라 돈으로 시작한다. */
async function createTripFrom({ destination, title = '', startDate, endDate }, submit) {
  const label = submit?.textContent;
  if (submit) {
    submit.disabled = true;
    submit.textContent = t('여행지 찾는 중…');
  }
  // P0-1: 자동완성 목록(과 트렌드 도시)은 고정 좌표·국가 코드를 쓰고 지오코딩하지 않는다
  let found = resolveDestination(destination, trends.cities);
  if (!found) {
    try {
      found = await geocodeDestination(destination);
    } catch {
      /* 여행지 좌표를 못 찾아도 여행은 만든다 */
    }
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
        <span class="tc-cover" data-cover-image="${esc(tr.id)}"><span class="tc-dday">${esc(s.dday.label)}</span><span class="tc-dest">${esc(destinationLabel(tr.destination) || t('여행'))}</span></span>
        <span class="tc-body">
          <b>${esc(tr.title)}</b>
          <small>${tr.startDate ? `${shortDate(tr.startDate)} – ${shortDate(tr.endDate)} · ` : ''}${esc(s.length)} · ${esc(t('{n}곳', { n: s.places }))}</small>
        </span>
      </button>
      <button type="button" class="btn tc-edit-cover" data-edit-cover="${esc(tr.id)}" aria-haspopup="dialog" aria-label="${esc(t('{name} 커버 바꾸기', { name: tr.title }))}">${esc(t('커버 바꾸기'))}</button>
      <button class="icon tc-del" data-del="${tr.id}" title="${esc(t('삭제'))}" aria-label="${esc(t('{name} 삭제', { name: tr.title }))}">✕</button>
    </li>`;
}

function paintCover(el, blob) {
  $('img', el)?.remove();
  if (!blob) return;
  const img = document.createElement('img');
  img.alt = '';
  const url = URL.createObjectURL(blob);
  const release = () => URL.revokeObjectURL(url);
  img.addEventListener('load', release, { once: true });
  img.addEventListener('error', () => { release(); img.remove(); }, { once: true });
  img.src = url;
  el.prepend(img);
}

const coverDialog = $('#coverDialog');
let coverTripId = null;
let coverBusy = false;
closeOnBackdrop(coverDialog, () => !coverBusy);
$('#closeCover').addEventListener('click', () => coverDialog.close());
coverDialog.addEventListener('cancel', (e) => { if (coverBusy) e.preventDefault(); });

function openCover(id) {
  if (coverBusy || !store.trips[id]) return;
  coverTripId = id;
  $('#coverStatus').textContent = '';
  showDialog(coverDialog);
}

async function editCover(file) {
  const id = coverTripId;
  if (!id || coverBusy || !store.trips[id]) return;
  coverBusy = true;
  const controls = $$('#coverDialog input, #coverDialog button');
  for (const control of controls) control.disabled = true;
  $('#coverStatus').textContent = '';
  try {
    const blob = file ? await Covers.compress(file) : null;
    if (!store.trips[id]) return;
    if (blob) await Covers.put(id, blob);
    else await Covers.remove(id);
    const el = $(`[data-cover-image="${CSS.escape(id)}"]`);
    if (el) paintCover(el, blob);
    coverDialog.close();
  } catch {
    $('#coverStatus').textContent = t('커버 사진을 저장하지 못했어요');
  } finally {
    for (const control of controls) control.disabled = false;
    coverBusy = false;
  }
}

$('#coverFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) editCover(file);
});
$('#resetCover').addEventListener('click', () => editCover(null));

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
      <p class="foot-copy">© 2026 XenoTravel ${esc(t('모든 권리 보유.'))}${debugBuild ? ` <span class="foot-build" title="${esc(t('배포 버전 (커밋)'))}">${esc(t('빌드'))} <code id="buildCommit">${esc(buildCommit)}</code></span>` : ''}</p>`;
}
/* 배포 식별자: <meta name="build-commit">(서버·빌드가 넣음) → 없으면 version.json. QA 때 어느 커밋이 떠 있는지 바로 확인한다 */
const debugBuild = new URLSearchParams(location.search).get('debug') === '1';
let buildCommit = document.querySelector('meta[name="build-commit"]')?.content || 'dev';
if (!/^[0-9a-f]{7}$/.test(buildCommit)) {
  fetch(new URL('version.json', document.baseURI), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (!/^[0-9a-f]{7}$/.test(v?.commit ?? '')) return;
      buildCommit = v.commit;
      document.querySelector('meta[name="build-commit"]')?.setAttribute('content', buildCommit);
      const el = $('#buildCommit');
      if (el) el.textContent = buildCommit;
    })
    .catch(() => {});
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
      <div class="dest-chips"><span>${esc(t('추천 여행지'))}</span>${POPULAR.map((d) => `<button type="button" data-dest="${esc(t(d))}">${esc(t(d))}</button>`).join('')}</div>
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
        ${featureCard('plan', t('지도와 일정을 한 화면에'), t('날짜별 타임라인과 지도 동선을 같이 보고, 끌어서 순서·날짜를 바꿔요.'))}
        ${featureCard('share', t('설치 없이 공유'), t('링크 하나면 친구가 앱 없이 바로 봐요. 원하면 자기 여행으로 저장해 고쳐요.'))}
        ${featureCard('plan', t('어디든 장소 추가'), t('한국어 검색, 구글맵 링크 붙여넣기, 지도에서 찍기. 소도시도 빠짐없이.'))}
        ${featureCard('plan', t('거리 · 길찾기'), t('장소 사이 거리와 도보 시간, 누르면 구글맵 길찾기가 열려요.'))}
        ${featureCard('budget', t('가계부'), t('현지 돈으로 적으면 원화도 같이.'))}
        ${featureCard('check', t('체크리스트'), t('출발 전 할 일, 짐, 쇼핑 리스트까지.'))}
        ${featureCard('flights', t('항공편'), t('출국·귀국편과 여행 중 항공편을 기록해요.'))}
        ${featureCard('backup', t('백업 저장'), t('백업 파일로 여행을 다른 기기에 옮길 수 있어요.'))}
      </ul>
    </section>
  </div>`;
  for (const cover of $$('[data-cover-image]', el)) {
    Covers.get(cover.dataset.coverImage).then((blob) => {
      if (blob && cover.isConnected && !$('img', cover)) paintCover(cover, blob);
    }).catch(() => {});
  }
  if (keep) for (const [k, v] of Object.entries(keep)) if (v) $(`#homeNew [name="${k}"]`).value = v;
  enhanceDates(el);
  const destination = $('#homeNewDestination');
  enhanceSuggestions(destination, destinationOptions);
  if (caret) {
    destination.focus({ preventScroll: true });
    destination.setSelectionRange(...caret);
  } else if (focusSel) $(focusSel, el)?.focus({ preventScroll: true });
}

function featureCard(action, title, detail) {
  return `<li><button type="button" data-feature="${action}"><b>${esc(title)}</b><span>${esc(detail)}</span></button></li>`;
}

function openHomeFeature(action) {
  const current = store.trips[store.currentId] ??
    Object.values(store.trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!current) return openNewTrip();
  const page = action === 'budget' || action === 'check' ? action : 'plan';
  homeFeature = { hash: tripHash(page, current.id), action };
  go(page, current.id);
}

$('#page-home').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]')?.dataset.open;
  const del = e.target.closest('[data-del]')?.dataset.del;
  const dest = e.target.closest('[data-dest]')?.dataset.dest;
  const cityId = e.target.closest('[data-city]')?.dataset.city;
  const home = e.target.closest('[data-home]')?.dataset.home;
  const feature = e.target.closest('[data-feature]')?.dataset.feature;
  const cover = e.target.closest('[data-edit-cover]')?.dataset.editCover;
  if (feature) openHomeFeature(feature);
  else if (cover) openCover(cover);
  else if (open && store.trips[open]) go('plan', open);
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
    sample.isUserModified = false; // 고치기 전까지는 언어를 바꾸면 샘플 내용도 그 언어로
    sample.presetI18n = { title: presetMap('도쿄 3박 4일 샘플'), destination: presetMap('도쿄') };
    // 종류를 고르게 넣어 두어 처음 온 사람도 '종류별' 필터를 바로 눌러 볼 수 있게 한다 (관광·맛집·카페·쇼핑·기타·숙소)
    const days = [
      [[k('센소지'), 35.7148, 139.7967, 'sight'], [k('도쿄 스카이트리'), 35.7101, 139.8107, 'sight'], [k('블루보틀 커피 기요스미시라카와'), 35.6807, 139.7967, 'cafe']],
      [[k('메이지 신궁'), 35.6764, 139.6993, 'sight'], [k('시부야 스크램블 교차로'), 35.6595, 139.7005, 'shop']],
      [[k('츠키지 장외시장'), 35.6655, 139.7707, 'food'], [k('도쿄 타워'), 35.6586, 139.7454, 'sight']],
      [[k('도쿄역'), 35.6812, 139.7671, 'etc']],
    ];
    days.forEach((places, i) => {
      places.forEach(([name, lat, lng, category]) => M.addItem(sample, sample.days[i].id, { name: t(name), nameI18n: presetMap(name), lat, lng, category }));
    });
    M.addStay(sample, { name: t(k('도쿄역 근처 호텔 (샘플)')), nameI18n: presetMap('도쿄역 근처 호텔 (샘플)'), lat: 35.6797, lng: 139.7702 }, 0, 3);
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

/** 여행 핸드북 첫머리: 여행 개요 · 항공편 · 숙소 (A4 표) */
function handbookOverviewHtml() {
  const flights = trip.flights ?? [];
  const stays = [...trip.stays].sort((a, b) => a.startIndex - b.startIndex);
  const places = trip.days.reduce((n, d) => n + d.items.length, 0);
  const facts = [
    trip.destination && [t('여행지'), trip.destination],
    trip.startDate && [t('기간'), `${M.formatDate(trip.startDate)} ~ ${M.formatDate(trip.endDate)} (${tripLength(trip.days.length)})`],
    [t('일정'), t('{n}곳', { n: places })],
  ].filter(Boolean);
  return `<section class="hb-overview">
      <h2>${esc(t('여행 개요'))}</h2>
      <dl class="hb-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${flights.length ? `<h3>${esc(t('항공편'))}</h3><table class="hb-table"><thead><tr><th>${esc(t('구분'))}</th><th>${esc(t('항공편'))}</th><th>${esc(t('예약번호'))}</th><th>${esc(t('메모'))}</th></tr></thead><tbody>${flights
        .map((f) => `<tr><td>${esc(M.flightKind(f.kind))}</td><td><strong>${esc(M.flightSummary(f))}</strong><div class="addr">${esc(f.departAt.slice(0, 10))}</div></td><td>${esc(f.bookingRef)}</td><td class="memo">${esc(f.memo)}</td></tr>`)
        .join('')}</tbody></table>` : ''}
      ${stays.length ? `<h3>${esc(t('숙소'))}</h3><table class="hb-table"><thead><tr><th>${esc(t('숙소'))}</th><th>${esc(t('체크인 ~ 체크아웃'))}</th><th>${esc(t('메모'))}</th></tr></thead><tbody>${stays
        .map((st) => {
          const { checkIn, checkOut } = M.stayDates(trip, st);
          return `<tr><td><strong>${esc(st.name)}</strong>${st.address ? `<div class="addr">${esc(st.address)}</div>` : ''}</td><td>${checkIn ? `${esc(M.formatDate(checkIn))} ~ ${esc(M.formatDate(checkOut))}<br>` : ''}${esc(t('{n}박', { n: st.nights }))}</td><td class="memo">${esc(st.memo)}</td></tr>`;
        })
        .join('')}</tbody></table>` : ''}
    </section>`;
}

/** 여행 핸드북 본문 (인쇄 미리보기와 브라우저 인쇄 단축키 공용). maps = 일차별 지도 칸을 넣을지 */
function handbookHtml({ maps = true } = {}) {
  const lists = allLists().filter((l) => l.isDay || l.items.length);
  const range = trip.startDate ? `${M.formatDate(trip.startDate)} ~ ${M.formatDate(trip.endDate)} · ${t('{n}일', { n: trip.days.length })}` : '';
  return `<div class="print-page" lang="${LANGS[getLang()].html}">
      <h1>${esc(trip.title)}</h1>
      <p class="p-sub">${esc(range)}</p>
      ${handbookOverviewHtml()}
      ${lists
        .map((l, i) => {
          const title = l.isDay ? M.dayTitle(trip.days[i], i) : t('장소 보관함 (날짜 미정)');
          const st = l.isDay ? M.dayStays(trip, i) : {};
          const stayRow = (stay, label) =>
            stay ? `<tr class="stay"><td class="n">${esc(t('숙'))}</td><td class="t">${esc(label)}</td><td><strong>${esc(stay.name)}</strong>${stay.address ? `<div class="addr">${esc(stay.address)}</div>` : ''}</td><td class="memo">${esc(stay.memo)}</td></tr>` : '';
          const has = l.items.length || st.start || (l.isDay && dayFlights(i, 'top').length + dayFlights(i, 'bottom').length);
          const flightRows = (where) =>
            dayFlights(i, where)
              .map((x) => ({ fl: x.flight, note: x.role === 'pinned' ? M.pinnedFlightNote(x) : '' }))
              .map(({ fl, note }) => `<tr class="flight"><td class="n">${esc(t('항'))}</td><td class="t">${esc(M.flightKind(fl.kind))}</td><td><strong>${esc(M.flightSummary(fl))}</strong>${note ? ` <small>(${esc(note)})</small>` : ''}</td><td class="memo">${esc([fl.bookingRef && t('예약번호 {ref}', { ref: fl.bookingRef }), fl.memo].filter(Boolean).join(' / '))}</td></tr>`)
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
            ${has && maps ? `<div class="print-map" data-list="${l.id}" data-day="${i}"></div>` : ''}
            ${
              has
                ? `<table><thead><tr><th></th><th>${esc(t('시간'))}</th><th>${esc(t('장소'))}</th><th>${esc(t('메모'))}</th></tr></thead><tbody>${rows}</tbody></table>`
                : `<p class="addr">${esc(t('아직 일정이 없어요'))}</p>`
            }
          </section>`;
        })
        .join('')}
    </div>`;
}

function openPrint() {
  const el = $('#print');
  const lists = allLists().filter((l) => l.isDay || l.items.length);
  const empty = !placeCount() && !trip.stays.length && !trip.flights.length;
  el.innerHTML = `
    <div class="print-toolbar">
      <span id="printStatus" role="status">${esc(empty ? t('아직 일정이 비어 있어요. 빈 일정표로 인쇄돼요.') : t('지도를 불러오는 중…'))}</span>
      <button class="btn" id="doPrint">${esc(t('인쇄 / PDF로 저장'))}</button>
      <button class="btn" id="closePrint">${esc(t('닫기'))}</button>
    </div>
    ${handbookHtml()}`;
  el.hidden = false;
  document.body.classList.remove('print-auto');
  document.body.classList.add('printing');

  const loads = $$('.print-map', el).map((div) => {
    const l = lists.find((x) => x.id === div.dataset.list);
    // 장소·숙소 좌표가 없는 날(항공편만 있는 날)은 지도 칸을 치운다 — 빈 좌표로 fitBounds를 부르면 미리보기 전체가 멈춘다 (GPT 3차 #4)
    const route = l.isDay ? M.dayRoute(trip, Number(div.dataset.day)) : l.items;
    if (!route.length) {
      div.remove();
      return Promise.resolve();
    }
    const m = L.map(div, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false });
    printMaps.push(m);
    const tiles = tileGroup(mapTileKind());
    const loaded = new Promise((resolve) => {
      Promise.all(tiles.getLayers().map((tile) => new Promise((ready) => tile.once('load', ready)))).then(resolve);
      setTimeout(resolve, 8000);
    });
    tiles.addTo(m);
    const st = l.isDay ? M.dayStays(trip, Number(div.dataset.day)) : {};
    const pts = (l.isDay ? M.dayRoute(trip, Number(div.dataset.day)) : l.items).map((it) => [it.lat, it.lng]);
    if (l.isDay && pts.length > 1) {
      L.polyline(pts, { color: 'var(--day-route-outline)', weight: 7, interactive: false }).addTo(m);
      L.polyline(pts, { color: l.color, weight: 3, dashArray: '6 6', interactive: false }).addTo(m);
    }
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

/* 브라우저 인쇄(Ctrl+P · 공유 → 인쇄)를 바로 눌러도 앱 화면 대신 여행 핸드북이 인쇄되게 한다 (지도 없이 표만). */
addEventListener('beforeprint', () => {
  if (!trip || document.body.classList.contains('printing')) return;
  const el = $('#print');
  el.innerHTML = handbookHtml({ maps: false });
  el.hidden = false;
  document.body.classList.add('printing', 'print-auto');
});
addEventListener('afterprint', () => {
  if (!document.body.classList.contains('print-auto')) return;
  const el = $('#print');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('printing', 'print-auto');
});

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
  if (tab === 'map') setTimeout(() => {
    map.invalidateSize();
    renderMap({ fit: !ui.keepView && !ui.candidate });
    ui.keepView = false;
    if (pickViewport.matches) revealMap(); // 모바일 지도 탭: 지도가 화면을 채우도록 맞춘다 (B5)
  }, 0);
}
$$('.mtabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* 토스트: 사라지면 글자도 지운다 (다른 화면의 접근성 트리·읽기 순서에 지난 안내가 남지 않게) */
let toastTimer;
function toast(text, ms = 2200, action = null) {
  if (!text) return;
  // 실행 취소가 아직 유효하면 일반 알림이 버튼을 지우지 않게 함께 둔다 (5초 안 되돌리기 보장)
  if (!action && undoStack.size()) {
    const n = undoStack.size();
    action = { label: n > 1 ? t('실행 취소 ({n})', { n }) : t('실행 취소'), run: () => {
      undoStack.undo();
      if (undoStack.size()) showUndoToast(t('되돌렸어요'));
    } };
    ms = Math.max(ms, undoStack.left());
  }
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('has-action', Boolean(action));
  const hide = () => {
    clearTimeout(toastTimer);
    el.classList.remove('show', 'has-action');
    toastTimer = setTimeout(() => (el.textContent = ''), 250);
  };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      hide();
      action.run();
    }, { once: true });
    el.append(' ', b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, ms);
}

/*
 * 실행 취소 스택 (5초): 연달아 지우거나 옮겨도 앞선 작업의 복구 데이터가 덮어쓰이지 않는다.
 * 토스트에는 가장 최근 작업과 남은 되돌리기 개수를 보여 주고, 누를 때마다 하나씩 거꾸로 되돌린다.
 */
function pushUndo(text, run) {
  undoStack.push({ text, run, scope: trip?.id });
  showUndoToast();
}
function showUndoToast(prefix = '') {
  const top = undoStack.peek();
  if (!top) return;
  const n = undoStack.size();
  toast(prefix ? `${prefix} · ${top.text}` : top.text, undoStack.left(), {
    label: n > 1 ? t('실행 취소 ({n})', { n }) : t('실행 취소'),
    run: () => {
      const done = undoStack.undo();
      if (!done) return;
      if (undoStack.size()) showUndoToast(t('되돌렸어요'));
    },
  });
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
  ui.target = id;
  renderTarget();
  renderDays();
  renderMap({ fit: true });
  if (scroll && curView() === 'list' && $('.layout').dataset.tab !== 'map') $(`#day-${ui.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const dest = destinationLabel(trip.destination);
  $('#heroTag').textContent = dest ? t('{dest} 여행', { dest }) : t('여행 계획');
  const staysTxt = trip.stays.length ? `${trip.stays[0].name}${trip.stays.length > 1 ? ` ${t('외 {n}곳', { n: trip.stays.length - 1 })}` : ''}` : '';
  $('#heroMeta').textContent = [s.length, staysTxt].filter(Boolean).join(' · ');
  const km = s.km >= 10 ? Math.round(s.km) : s.km.toFixed(1);
  $('#heroStats').innerHTML = `
    <button type="button" class="tile dday" data-summary="today"><span>${esc(s.dday.sub)}</span><b>${esc(s.dday.label)}</b></button>
    <button type="button" class="tile" data-summary="dates" aria-haspopup="dialog" aria-controls="datePicker" aria-expanded="false"${ui.readonly ? ' disabled' : ''}><span>${esc(t('여행 기간'))}</span><b>${s.days}<small>${esc(t('일'))}</small></b></button>
    <button type="button" class="tile" data-open-place-groups><span>${esc(t('들를 곳'))}</span><b>${s.places}<small>${esc(t('곳'))}</small></b></button>
    <button type="button" class="tile wide" data-summary="routes"><span>${esc(t('이동 (직선)'))}</span><b>${num(Number(km), { maximumFractionDigits: 1 })}<small>km</small></b></button>`;
  const out = trip.flights.find((f) => f.kind === 'out');
  const back = trip.flights.find((f) => f.kind === 'in');
  const flights = [out, ...trip.flights.filter((f) => f.kind === 'move'), back].filter(Boolean);
  $('#heroFlight').innerHTML = flights.length
    ? flights.map(flightRoute).join('')
    : ui.readonly
    ? ''
    : `<button class="route add" data-hero="flights"><span class="rt-kind">${esc(t('항공편'))}</span><span class="rt-add">${esc(t('+ 출국·귀국편 넣기'))}</span></button>`;
}

$('#heroStats').addEventListener('click', (e) => {
  const button = e.target.closest('[data-summary]');
  const action = button?.dataset.summary;
  if (!trip || !action) return;
  if (action === 'dates') {
    openDateRange($('#startDate'), button);
  } else if (action === 'routes') {
    expandMap();
    showTab('map');
    showAllRoutes();
    revealMap();
  } else if (action === 'today') {
    const index = M.todayIndex(trip, TODAY);
    showTab('plan');
    selectDay(index, { scroll: false });
    const card = $(`#day-${index}`);
    card?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
});

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
        <a href="${href(M.directionsFromHereUrl(it))}" target="_blank" rel="noopener" title="${esc(t('지금 위치에서 길찾기'))}" aria-label="${esc(t('{name} 길찾기', { name: it.name }))}">${esc(t('길찾기'))}</a>
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
          <div class="td-acts"><button type="button" data-today="copy" data-text="${esc(stayAddr)}">${esc(t('주소'))}</button><a href="${href(M.directionsFromHereUrl(s))}" target="_blank" rel="noopener">${esc(t('숙소로 가기'))}</a></div></div>`
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
    saved(commit(), r.expense.krw == null ? t('가계부에 기록했어요. 원화는 환율을 받으면 계산해요') : t('가계부에 {amount} 기록했어요', { amount: bm(r.expense.krw) }));
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
  if (!ui.readonly && total && plan > total) list.push(t('예상 비용({plan})이 예산({total})보다 {diff} 많아요', { plan: bm(plan), total: bm(total), diff: bm(plan - total) }));
  const el = $('#notice');
  el.hidden = !list.length;
  const noStay = !ui.readonly && M.uncoveredStayNights(trip).length > 0;
  el.innerHTML = list.length
    ? `<b>${esc(t('확인할 것'))}</b><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${noStay ? `<button type="button" class="btn notice-act" data-notice="stay">${esc(t('+ 숙소 추가'))}</button>` : ''}`
    : '';
}

$('#notice').addEventListener('click', (e) => {
  if (e.target.closest('[data-notice="stay"]')) openStays();
});
$('#dayTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  const i = Number(b.dataset.day);
  const hadFocus = document.activeElement === b; // Enter·Space로 누른 경우: 다시 그린 같은 날짜 칩으로 포커스를 돌려준다 (GPT 검수 #14)
  selectDay(i);
  if (hadFocus) $(`#dayTabs [data-day="${i}"]`)?.focus({ preventScroll: true });
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
  if (!trip || prefs.page !== 'plan' || curView() === 'board' || e.altKey || e.ctrlKey || e.metaKey) return;
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
    renderHero();
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

initBudget({
  get trip() { return trip; },
  get ui() { return ui; },
  $, $$, esc, TODAY, prefs, commit, saved, bm, go, toast, keepDrafts, copyText,
});

initChecks({
  get trip() { return trip; },
  get ui() { return ui; },
  $, $$, esc, TODAY, prefs, store, persistSoon, commit, saved, askDialog, ask, render, bm, go, toast, pushUndo, keepDrafts,
});

/* ───────── 공유 링크 ─────────
 * 보내기: 일정 사본을 URL # 뒤에 압축해 담은 링크를 만든다 (# 뒤는 브라우저가 서버로 보내지 않는다).
 *   짧은 링크 서버(/api/share)는 배포 전이라 부르지 않는다. 링크 길이는 게이지로 보여 주고(메신저 한도 2,000자),
 *   길면 메모 제외나 공유용 일정 파일을 권한다.
 * 받기: /s/<id> 또는 #s=… 로 열리면 보기 전용으로 보여주고, 원하면 "내 여행으로 저장"으로 사본을 만든다.
 */
const shareDialog = $('#shareDialog');
const SHARE_PATH = /\/s\/([A-Za-z0-9]{8})\/?$/;
const appBase = () => new URL('./', document.baseURI).href; // /s/<id> 페이지에서도 앱 루트
ui.share = null;
let shareRequest = 0;

// 짧은 링크 서버(/api/share)는 아직 배포하지 않았다 (B9). 없는 주소를 불러 404를 내지 않도록 바로 압축 링크(#s=)를 만든다.
async function createShareUrl(code) {
  return shareUrl(appBase(), code);
}

/* 공유 링크 길이 게이지 (B9): 2,000자를 넘기 전에 미리 알려 메모 제외·파일 저장을 고를 수 있게 한다 */
const SHARE_LIMIT = 2000;
const SHARE_NEAR = 1600;
function renderShareGauge(len) {
  const el = $('#shareGauge');
  if (len == null) return void (el.hidden = true);
  const state = len > SHARE_LIMIT ? 'over' : len > SHARE_NEAR ? 'near' : 'ok';
  el.dataset.state = state;
  $('i', el).style.width = `${Math.min(100, (len / SHARE_LIMIT) * 100)}%`;
  const n = { len: num(len), max: num(SHARE_LIMIT) };
  $('#shareGaugeText').textContent =
    state === 'ok' ? t('{len} / {max}자 · 메신저 전송 안전', n)
      : state === 'near' ? t('{len} / {max}자 · 거의 찼어요. 메모를 빼거나 파일로 보내면 안전해요', n)
      : t('{len} / {max}자 · 메신저에서 잘릴 수 있어요', n);
  el.hidden = false;
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
  renderShareGauge(null);
  ui.share = null;
  try {
    const code = await encodeShare(source, { includePrivate }); // 받는 쪽이 못 여는 크기면 encodeShare가 오류 → 아래에서 파일로 안내 (GPT 4차 #3)
    const url = await createShareUrl(code);
    if (request !== shareRequest || !shareDialog.open) return;
    // 링크와 파일이 같은 내용이 되게, 링크를 만든 순간의 사본을 같이 둔다 (GPT 3차 #11)
    ui.share = { url, title, line, code, includePrivate, message: shareMessage({ ...source, title }, url), copy: sharedCopy(source, { includePrivate }) };
    $('#shareLink').textContent = url;
    $('#shareLong').hidden = !url.includes('#s=');
    const tooLong = url.length > SHARE_LIMIT;
    $('#shareTooLong').hidden = !tooLong;
    $('#shareFile').hidden = false; // 길이와 상관없이 파일로도 보낼 수 있게
    renderShareGauge(url.length);
    for (const id of ['shareCopy', 'shareCopyLink', 'shareNative']) $(`#${id}`).disabled = false;
  } catch (err) {
    if (request !== shareRequest || !shareDialog.open) return;
    // 압축을 못 하는 브라우저 또는 링크로 담기엔 너무 큰 일정: 링크 대신 같은 내용의 일정 파일로 보낸다
    ui.share = { url: '', title, line, code: null, includePrivate, message: '', copy: sharedCopy(source, { includePrivate }) };
    $('#shareLink').textContent = '';
    $('#shareError').textContent = err?.code === 'too-large'
      ? t('일정이 너무 커서 링크로 보낼 수 없어요. 일정 파일(JSON)을 보내고, 받는 사람에게 ‘백업 파일 불러오기’를 안내하세요.')
      : t('이 브라우저에서는 공유 링크를 만들 수 없어요. 일정 파일(JSON)을 보내고, 받는 사람에게 ‘백업 파일 불러오기’를 안내하세요.');
    $('#shareError').hidden = false;
    $('#shareFile').hidden = false;
  }
}

/** 공유용 일정 파일 (링크와 같은 내용: 메모·예약번호 제외 옵션 그대로) */
function saveShareFile() {
  const current = ui.share;
  if (!current || !trip) return;
  const copy = current.copy ?? sharedCopy(trip, { includePrivate: current.includePrivate });
  // 받는 쪽 '백업 파일 불러오기' 상한(10MB)을 넘으면 열리지 않는 파일이다 — 메모를 빼도록 안내 (GPT 5차 #2)
  if (new TextEncoder().encode(JSON.stringify(copy, null, 2)).length > 10 * 1024 * 1024) {
    return toast(t('일정 파일이 10MB를 넘어 받는 사람이 열 수 없어요. ‘메모·예약번호 제외’를 켜고 다시 저장해 주세요'), 5000);
  }
  downloadJson(copy, { kind: 'share' });
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
  renderSummaryPreview();
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

/* ───────── Phase 4: 일정 요약 이미지 ─────────
 * 여행명·날짜·일차별 대표 장소·동선 그림을 한 장(PNG)으로. 지도 타일 없이 일정 좌표로 그려서 오프라인에서도 만든다.
 * 메모·예약번호·가계부·체크리스트는 넣지 않는다. 지금 언어와 화면 밝기(라이트/다크)를 따른다.
 */
function summaryCanvas() {
  const model = summaryModel(trip, { colors: COLORS });
  return drawSummary(document.createElement('canvas'), model, {
    theme: isDark() ? 'dark' : 'light',
    labels: {
      brand: 'XenoTravel',
      mapNote: t('일정 좌표로 그린 직선 동선이에요 (지도 타일 없음)'),
      privacy: t('XenoTravel로 만든 일정 요약 · 메모·예약번호·가계부는 포함하지 않아요'),
      moreDays: (n) => t('외 {n}일', { n }),
      morePlaces: (n) => t('외 {n}곳', { n }),
      noPlaces: t('아직 장소가 없어요'),
    },
  });
}
const canvasBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
let summaryPreviewUrl = '';
async function renderSummaryPreview() {
  const img = $('#shareImgPreview');
  try {
    await document.fonts?.ready;
    const blob = await canvasBlob(summaryCanvas());
    if (summaryPreviewUrl) URL.revokeObjectURL(summaryPreviewUrl);
    summaryPreviewUrl = URL.createObjectURL(blob);
    img.src = summaryPreviewUrl;
    img.alt = t('{title} 일정 요약 이미지 미리보기', { title: trip.title });
    img.hidden = false;
    const file = new File([blob], summaryFileName(trip), { type: 'image/png' });
    $('#shareImgSend').hidden = !(navigator.canShare?.({ files: [file] }));
  } catch {
    img.hidden = true;
  }
}
$('#shareImgSave').addEventListener('click', async () => {
  if (!trip) return;
  try {
    await document.fonts?.ready;
    const blob = await canvasBlob(summaryCanvas());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = summaryFileName(trip);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(t('요약 이미지를 저장했어요'));
  } catch {
    toast(t('이미지를 만들지 못했어요. 다른 브라우저에서 다시 시도해 주세요'), 3500);
  }
});
$('#shareImgSend').addEventListener('click', async () => {
  if (!trip) return;
  try {
    const blob = await canvasBlob(summaryCanvas());
    const file = new File([blob], summaryFileName(trip), { type: 'image/png' });
    await navigator.share({ files: [file], title: trip.title });
  } catch {}
});

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
  const r = switchTrip(copy, { save: true });
  if (r?.ok) toast(t('내 여행으로 저장했어요. 이제 일정을 수정하거나 다시 공유할 수 있어요'), 4000);
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
  if (btn.dataset.action === 'chip-menu') {
    openChipMenu(id);
  } else if (btn.dataset.action === 'dock-toggle') {
    prefs.dockOpen = !(prefs.dockOpen ?? !narrowMq.matches);
    savePrefs();
    renderDays();
    $('#inboxDock .dock-toggle')?.focus();
  } else if (btn.dataset.action === 'locate') {
    const found = M.findItem(trip, id);
    if (!found) return;
    locateMapPlace(found.item);
  } else if (/^place-(ops|move|copy)$/.test(btn.dataset.action)) {
    openPlaceOps(id, btn.dataset.action === 'place-copy' ? 'copy' : 'move');
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

/* ───────── Phase 4: 다른 일차로 이동·복제 · 일자 순서 바꾸기 ─────────
 * 확정 전에 대상 일차의 항공편·숙소와 시간 충돌을 미리 보여 준다(D.placementPreview / D.dayOrderPreview).
 * 실행하면 작업마다 되돌리기를 실행 취소 스택에 쌓는다 — 5초 안에 연달아 한 작업을 하나씩 거꾸로 되돌린다.
 */

const placeGroupsDialog = $('#placeGroupsDialog');

function renderPlaceGroups() {
  const rows = groupPlaces(trip, $('#placeGroupsSort').value, locale());
  $('#placeGroupsList').innerHTML = rows.length ? rows.map(({ place, entries }) => {
    const visits = new Map();
    for (const entry of entries) {
      if (!visits.has(entry.listId)) visits.set(entry.listId, entry);
    }
    return `<article class="p3-row">
      <h3>${esc(place.name)}</h3><small>${esc(t('{n}회 등장', { n: entries.length }))}</small>
      <div class="p3-actions">${[...visits.values()].map(({ item, listId }) =>
        `<button type="button" class="btn place-visit" data-group-open="${esc(item.id)}">${esc(listId === M.INBOX ? t('보관함') : listName(listId))}</button>`).join('')}</div>
      <div class="p3-actions">
        <button type="button" class="btn" data-group-map="${esc(place.id)}">${esc(t('지도에서 보기'))}</button>
        ${ui.readonly ? '' : `<button type="button" class="btn danger" data-group-delete="${esc(place.id)}">${esc(t('모든 일정에서 삭제'))}</button>`}
      </div>
    </article>`;
  }).join('') : `<p>${esc(t('등록된 장소가 없어요'))}</p>`;
}

for (const el of [$('#placeGroupsBtn'), $('#heroStats')]) el.addEventListener('click', (e) => {
  if (!trip || !e.target.closest('[data-open-place-groups]')) return;
  renderPlaceGroups();
  showDialog(placeGroupsDialog);
});
$('#placeGroupsSort').addEventListener('change', renderPlaceGroups);
placeGroupsDialog.addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close-place-groups')) return placeGroupsDialog.close();
  const { groupOpen, groupMap, groupDelete } = button.dataset;
  const found = (groupOpen || groupMap) && M.findItem(trip, groupOpen || groupMap);
  if (found) {
    placeGroupsDialog.close();
    const index = trip.days.findIndex((day) => day.id === found.listId);
    if (index >= 0) selectDay(index, { scroll: false });
    if (groupOpen) {
      if (index >= 0) {
        openItem(found.item.id, { scroll: true });
      } else {
        showTab('plan');
        prefs.dockOpen = true;
        savePrefs();
        renderDays();
        const chip = $(`#inboxDock [data-id="${CSS.escape(found.item.id)}"] button`);
        chip?.scrollIntoView({ block: 'nearest' });
        chip?.focus({ preventScroll: true });
        openChipMenu(found.item.id);
      }
    } else {
      if (index < 0) {
        ui.focusList = null;
        renderMap();
      }
      locateMapPlace(found.item);
    }
    return;
  }
  if (!groupDelete || ui.readonly) return;
  const group = groupPlaces(trip).find(({ place }) => place.id === groupDelete);
  if (!group) return;
  const ids = new Set(group.entries.map(({ item }) => item.id));
  const tripId = trip.id;
  const keepExpenses = trip.expenses?.some((expense) => ids.has(expense.placeId));
  const choice = await ask({
    title: t('{n}개 일정에서 삭제할까요?', { n: group.entries.length }),
    body: [group.place.name, keepExpenses ? t('연결된 지출은 가계부에 남아요') : ''].filter(Boolean).join(' · '),
    actions: [{ value: 'delete', label: t('삭제'), danger: true }],
  });
  if (choice !== 'delete' || trip?.id !== tripId || ui.readonly) return;
  const restore = removePlaceGroup(trip, ids);
  if (ids.has(ui.openItem)) ui.openItem = null;
  ui.routePlan = ui.routeUndo = null;
  const result = commit();
  placeGroupsDialog.close();
  if (result.ok) pushUndo(t('"{name}"을(를) 삭제했어요', { name: group.place.name }), () => {
    if (trip?.id !== tripId || ui.readonly) return;
    restore(trip);
    saved(commit(), t('되돌렸어요'));
  });
});
closeOnBackdrop(placeGroupsDialog);

const dayOpsDialog = $('#dayOpsDialog');
ui.ops = null; // { kind: 'place', itemId, mode, to } | { kind: 'order', order }
const dayLabelOf = (i) => `${dayName(i)}${trip.days[i]?.date ? ` · ${M.formatDate(trip.days[i].date)}` : ''}`;
const conflictName = (kind) => (kind === 'flight' ? t('항공편 시간 확인') : t('시간 겹침'));

function openPlaceOps(itemId, mode = 'move') {
  const found = M.findItem(trip, itemId);
  if (!found || ui.readonly) return;
  const from = trip.days.findIndex((d) => d.id === found.listId);
  // 이동은 인접 일차, 복제는 같은 장소가 없는 일차에서 시작한다.
  const to = from < 0 ? 0 : from + 1 < trip.days.length ? from + 1 : Math.max(0, from - 1);
  ui.ops = { kind: 'place', itemId, mode, to, copy: D.defaultCopyDays(trip, itemId, to), sig: daySig() };
  renderDayOps();
  showDialog(dayOpsDialog);
  $('#dayOpsBody input[name="opsDay"]:checked')?.focus();
}

function openDayOrder() {
  if (ui.readonly || trip.days.length < 2) return;
  ui.ops = { kind: 'order', order: trip.days.map((_, i) => i), sig: daySig() };
  renderDayOps();
  showDialog(dayOpsDialog);
  $('#dayOpsBody .do-move')?.focus();
}

function flightsLine(p) {
  if (!p.flights.length) return `<li class="ok">${esc(t('항공편 없음'))}</li>`;
  return p.flights
    .map((f) => {
      const what = f.role === 'arrive' ? t('{time} 도착', { time: f.time }) : f.role === 'depart' ? t('{time} 출발', { time: f.time }) : t('{time} 출발', { time: f.time });
      return `<li><svg class="ic" aria-hidden="true"><use href="#i-ticket"/></svg> ${esc(M.flightKind(f.kind))} · ${esc(f.label)} · <b>${esc(what)}</b></li>`;
    })
    .join('');
}
function staysLine(st) {
  const name = (s) => (s ? s.name : t('미정'));
  if (!st.start && !st.end) return `<li>${esc(t('숙소 미정'))}</li>`;
  return `<li><svg class="ic" aria-hidden="true"><use href="#i-home"/></svg> ${esc(t('출발 {a} → 귀가 {b}', { a: name(st.start), b: name(st.end) }))}</li>`;
}

function placeOpsHtml(op) {
  const found = M.findItem(trip, op.itemId);
  if (!found) return '';
  const from = trip.days.findIndex((d) => d.id === found.listId);
  const copying = op.mode === 'copy';
  const choices = copying ? D.copyDayChoices(trip, op.itemId) : [];
  const days = trip.days
    .map((d, i) => {
      const same = i === from;
      const disabled = same;
      const duplicate = choices[i]?.duplicate && !same;
      const hasFlight = D.dayBounds(trip, i).flights.length;
      return `<label class="do-day${disabled ? ' off' : ''}"><input type="${copying ? 'checkbox' : 'radio'}" name="opsDay" value="${i}"${(copying ? op.copy.has(i) : i === op.to) ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="do-day-name">${esc(dayName(i))}${d.date ? ` · ${esc(shortDate(d.date))}` : ''}</span>
        <small>${esc(t('{n}곳', { n: d.items.length }))}${hasFlight ? ` · ${esc(t('항공편'))}` : ''}${same ? ` · ${esc(t('지금 날'))}` : ''}${duplicate ? ` · ${esc(t('이미 있음'))}` : ''}</small></label>`;
    })
    .join('');
  const preview = (copying ? [...op.copy].sort((a, b) => a - b) : [op.to])
    .map((day) => placeOpsPreview(op, found, day)).join('');
  return `<div class="pin-seg do-mode" role="group" aria-label="${esc(t('이동 또는 복제'))}">
      <button type="button" data-ops-mode="move" aria-pressed="${op.mode === 'move'}" class="${op.mode === 'move' ? 'active' : ''}">${esc(t('이동'))}</button>
      <button type="button" data-ops-mode="copy" aria-pressed="${op.mode === 'copy'}" class="${op.mode === 'copy' ? 'active' : ''}">${esc(t('복제'))}</button>
    </div>
    <p class="fine do-what"><b>${esc(found.item.name)}</b>${from >= 0 ? ` · ${esc(t('지금 {day}', { day: dayName(from) }))}` : ` · ${esc(t('장소 보관함'))}`}</p>
    ${copying ? `<div class="p3-actions"><button type="button" class="btn" data-ops="all">${esc(t('전체 선택'))}</button>
      <button type="button" class="btn" data-ops="none">${esc(t('전체 해제'))}</button>
      <span role="status">${esc(t('{n}개 선택', { n: op.copy.size }))}</span></div>` : ''}
    <fieldset class="do-days"><legend>${esc(op.mode === 'move' ? t('옮길 날') : t('복제할 날'))}</legend>${days}</fieldset>
    ${preview}`;
}

function placeOpsPreview(op, found, day) {
  const p = D.placementPreview(trip, op.itemId, day, op.mode);
  const conflicts = p.ok ? p.conflicts : [];
  return p.ok
    ? `<section class="do-preview" aria-live="polite">
        <h3>${esc(t('{day} 미리보기', { day: dayLabelOf(day) }))}</h3>
        <p class="do-pos">${esc(found.item.time ? t('{time} 기준 시간순으로 {n}번째에 들어가요', { time: found.item.time, n: p.index + 1 }) : t('시간이 없어 맨 끝({n}번째)에 들어가요', { n: p.index + 1 }))}</p>
        <ul class="do-facts">${flightsLine(p)}${staysLine(p.stays)}</ul>
        ${
          conflicts.length
            ? `<ul class="do-conflicts">${conflicts
                .map((c) => `<li class="${c.kind}${c.isTarget ? ' me' : ''}"><span class="tw-badge">${esc(conflictName(c.kind))}</span> ${esc(c.isTarget ? t('{name} (옮길 장소)', { name: c.name }) : c.name)}</li>`)
                .join('')}</ul>
              <p class="do-warn" role="status">${esc(p.added ? t('확정하면 시간 충돌이 {n}건 새로 생겨요. 그래도 진행할 수 있고, 5초 안에 되돌릴 수 있어요.', { n: p.added }) : t('이미 있던 시간 충돌이에요. 새로 생기는 충돌은 없어요.'))}</p>`
            : `<p class="do-ok" role="status">✓ ${esc(t('항공편·기존 일정과 시간 충돌이 없어요'))}</p>`
        }
      </section>`
    : '';
}

function orderOpsHtml(op) {
  const p = D.dayOrderPreview(trip, op.order);
  const n = op.order.length;
  const rows = p.days
    .map((d, i) => {
      const moved = d.from !== d.to;
      return `<li class="do-row${moved ? ' moved' : ''}" data-from="${d.from}">
        <span class="do-slot">${esc(dayLabelOf(i))}</span>
        <span class="drag do-drag" aria-hidden="true">⋮⋮</span>
        <span class="do-block"><b>${esc(d.firstName || t('장소 없음'))}</b><small>${esc(d.count > 1 ? t('외 {n}곳', { n: d.count - 1 }) : d.count ? '' : '')}${moved ? ` · ${esc(t('원래 {day}', { day: dayName(d.from) }))}` : ''}</small>
          ${d.conflicts.length ? `<span class="do-row-warn">${d.conflicts.map((c) => `<span class="tw-badge ${c.kind}" title="${esc(c.name)}">${esc(conflictName(c.kind))}</span>`).join('')}</span>` : ''}</span>
        <span class="do-arrows">
          <button type="button" class="do-move" data-dir="-1" data-i="${i}"${i ? '' : ' disabled'} aria-label="${esc(t('{day} 장소 묶음을 하루 앞으로', { day: dayName(i) }))}">↑</button>
          <button type="button" class="do-move" data-dir="1" data-i="${i}"${i < n - 1 ? '' : ' disabled'} aria-label="${esc(t('{day} 장소 묶음을 하루 뒤로', { day: dayName(i) }))}">↓</button>
        </span>
      </li>`;
    })
    .join('');
  return `<p class="fine">${esc(t('날짜·숙소·항공편은 그대로 두고 각 날의 장소 묶음 순서를 바꿔요. 끌거나 ↑↓ 버튼으로 옮기세요.'))}</p>
    <ol class="do-order" aria-label="${esc(t('일자 순서'))}">${rows}</ol>
    <p class="${p.added ? 'do-warn' : 'do-ok'}" role="status" aria-live="polite">${esc(
      !p.changed ? t('순서를 바꾸면 여기서 충돌을 미리 알려 줘요') : p.added ? t('확정하면 항공편·시간 충돌이 {n}건 새로 생겨요. 그래도 진행할 수 있고, 5초 안에 되돌릴 수 있어요.', { n: p.added }) : `✓ ${t('새로 생기는 항공편·시간 충돌이 없어요')}`,
    )}</p>`;
}

let orderSortable = null;
function renderDayOps({ focus } = {}) {
  const op = ui.ops;
  if (!op || !trip) return;
  orderSortable?.destroy();
  orderSortable = null;
  if (op.kind === 'place') {
    const found = M.findItem(trip, op.itemId);
    if (!found) return void dayOpsDialog.close();
    $('#dayOpsTitle').textContent = op.mode === 'move' ? t('다른 일차로 이동') : t('다른 일차로 복제');
    $('#dayOpsBody').innerHTML = placeOpsHtml(op);
    const ok = op.mode === 'move' ? Boolean(trip.days[op.to] && trip.days[op.to].id !== found.listId) : op.copy.size > 0;
    $('#dayOpsActions').innerHTML = `<button type="button" class="btn ghost" data-ops="cancel">${esc(t('취소'))}</button><button type="button" class="btn primary" data-ops="apply"${ok ? '' : ' disabled'}>${esc(op.mode === 'move' ? t('{day}(으)로 이동', { day: dayName(op.to) }) : t('{n}개 날에 복제', { n: op.copy.size }))}</button>`;
  } else {
    $('#dayOpsTitle').textContent = t('일자 순서 바꾸기');
    $('#dayOpsBody').innerHTML = orderOpsHtml(op);
    const changed = op.order.some((x, i) => x !== i);
    $('#dayOpsActions').innerHTML = `<button type="button" class="btn ghost" data-ops="cancel">${esc(t('취소'))}</button>${changed ? `<button type="button" class="btn" data-ops="reset">${esc(t('처음대로'))}</button>` : ''}<button type="button" class="btn primary" data-ops="apply"${changed ? '' : ' disabled'}>${esc(t('이 순서로 바꾸기'))}</button>`;
    // 끌어서 순서 바꾸기 (마우스·터치 모두 SortableJS). 날짜 칸(.do-slot)은 그대로 두고 장소 묶음만 옮긴 것으로 계산한다
    orderSortable = new Sortable($('#dayOpsBody .do-order'), {
      handle: '.do-drag',
      animation: 150,
      ghostClass: 'ghost-item',
      delay: 120,
      delayOnTouchOnly: true,
      onEnd: (e) => {
        if (e.oldIndex === e.newIndex) return;
        const next = [...op.order];
        const [x] = next.splice(e.oldIndex, 1);
        next.splice(e.newIndex, 0, x);
        op.order = next;
        renderDayOps();
      },
    });
  }
  if (focus) $(focus, dayOpsDialog)?.focus();
}

/** 대화상자를 연 뒤 일정(날짜·장소 배치)이 바뀌었는지 보는 표식 — 다른 탭 저장 등 */
const daySig = () => JSON.stringify([
  trip.days.map((d) => [d.id, d.date, d.items.map((x) => [x.id, x.time, x.name, x.lat, x.lng, x.url])]),
  trip.inbox.map((x) => [x.id, x.time, x.name, x.lat, x.lng, x.url]),
  // 항공편·숙소도 미리보기 계산과 화면(편명·공항·숙소 이름)에 쓴다 (GPT 3차 #7, 4차 #4)
  (trip.flights ?? []).map((f) => [f.id, f.kind, f.departAt, f.arriveAt, f.flightNo, f.from, f.to]),
  (trip.stays ?? []).map((s) => [s.id, s.startIndex, s.nights, s.name]),
]);
function applyDayOps() {
  const op = ui.ops;
  if (!op || ui.readonly) return;
  // 미리보기를 본 뒤 일정이 바뀌었으면 그대로 적용하지 않고 새 미리보기를 보여 준다 (GPT 2차 #8)
  if (op.sig !== daySig()) {
    op.sig = daySig();
    if (op.kind === 'order' && !D.isPermutation(op.order, trip.days.length)) op.order = trip.days.map((_, i) => i);
    if (op.kind === 'place') {
      if (!trip.days[op.to]) op.to = 0;
      op.copy = D.defaultCopyDays(trip, op.itemId, op.to);
    }
    renderDayOps({ focus: '[data-ops="apply"]' });
    toast(t('그사이 일정이 바뀌어 미리보기를 새로 고쳤어요. 확인하고 다시 눌러 주세요'), 4000);
    return;
  }
  const tripId = trip.id;
  if (op.kind === 'place') {
    const found = M.findItem(trip, op.itemId);
    if (!found) return;
    const name = found.item.name;
    const res = op.mode === 'move' ? D.moveToDay(trip, op.itemId, op.to) : D.copyToDays(trip, op.itemId, op.copy);
    if (!res) return;
    ui.openItem = null;
    ui.routePlan = ui.routeUndo = null;
    dayOpsDialog.close();
    if (!commit().ok) return;
    for (const item of res.items ?? [res.item]) $(`.item[data-id="${CSS.escape(item.id)}"]`)?.classList.add('flash');
    const msg = op.mode === 'move' ? t('"{name}" → {day}(으)로 옮겼어요', { name, day: dayName(op.to) }) : t('"{name}"을(를) {n}개 날에 복제했어요', { name, n: res.items.length });
    pushUndo(msg, () => {
      if (trip?.id !== tripId || ui.readonly) return;
      if (res.undo(trip)) saved(commit(), t('되돌렸어요'));
    });
  } else {
    const res = D.reorderDays(trip, op.order);
    if (!res) return;
    ui.routePlan = ui.routeUndo = null;
    dayOpsDialog.close();
    if (!commit().ok) return;
    pushUndo(t('일자 순서를 바꿨어요'), () => {
      if (trip?.id !== tripId || ui.readonly) return;
      if (res.undo(trip)) saved(commit(), t('되돌렸어요'));
    });
  }
}

dayOpsDialog.addEventListener('click', (e) => {
  const op = ui.ops;
  if (!op) return;
  const mode = e.target.closest('[data-ops-mode]')?.dataset.opsMode;
  if (mode && op.kind === 'place') {
    op.mode = mode;
    const from = trip.days.findIndex((d) => d.id === M.findItem(trip, op.itemId)?.listId);
    if (mode === 'move' && op.to === from) op.to = from + 1 < trip.days.length ? from + 1 : Math.max(0, from - 1);
    return renderDayOps({ focus: `[data-ops-mode="${mode}"]` });
  }
  const mv = e.target.closest('.do-move');
  if (mv && op.kind === 'order') {
    const i = Number(mv.dataset.i);
    const dir = Number(mv.dataset.dir);
    op.order = D.moveInOrder(op.order, i, dir);
    const j = i + dir;
    renderDayOps();
    // 옮긴 묶음의 같은 방향 버튼으로 포커스 (끝에 닿으면 반대 버튼)
    ($(`.do-move[data-i="${j}"][data-dir="${dir}"]:not(:disabled)`, dayOpsDialog) ?? $(`.do-move[data-i="${j}"]:not(:disabled)`, dayOpsDialog))?.focus();
    return;
  }
  const act = e.target.closest('[data-ops]')?.dataset.ops;
  if (act === 'all' || act === 'none') {
    op.copy = new Set(act === 'all' ? D.copyDayChoices(trip, op.itemId).filter((day) => !day.disabled).map((day) => day.index) : []);
    renderDayOps({ focus: `[data-ops="${act}"]` });
  } else if (act === 'cancel') dayOpsDialog.close();
  else if (act === 'reset' && op.kind === 'order') {
    op.order = trip.days.map((_, i) => i);
    renderDayOps({ focus: '.do-move' });
  } else if (act === 'apply') applyDayOps();
});
dayOpsDialog.addEventListener('change', (e) => {
  if (e.target.name !== 'opsDay' || ui.ops?.kind !== 'place') return;
  const day = Number(e.target.value);
  if (ui.ops.mode === 'copy') {
    if (e.target.checked) ui.ops.copy.add(day);
    else ui.ops.copy.delete(day);
  } else ui.ops.to = day;
  renderDayOps({ focus: `input[name="opsDay"][value="${day}"]` });
});
dayOpsDialog.addEventListener('close', () => {
  orderSortable?.destroy();
  orderSortable = null;
  ui.ops = null;
});
closeOnBackdrop(dayOpsDialog);


initPresets({
  get trip() { return trip; },
  get ui() { return ui; },
  $, $$, esc, commit, saved, toast, pushUndo, showDialog, closeOnBackdrop,
});

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
/**
 * 머리 바 아래 고정 안내(오프라인 띠 → 저장 오류 띠)의 실제 높이를 CSS 변수로 둔다. 날짜 칩·일차 스크롤 위치가 이 높이만큼 내려간다.
 * 문구가 줄바꿈되거나 버튼이 나타나 높이가 바뀌어도 ResizeObserver가 다시 잰다 (GPT 1차 #9, 2차 #14).
 */
function syncBarHeights() {
  const h = (el) => (el.hidden ? 0 : el.offsetHeight);
  document.body.style.setProperty('--offbar', `${h($('#offlineBar'))}px`);
  document.body.style.setProperty('--savebar', `${h($('#saveBar'))}px`);
}
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(syncBarHeights);
  ro.observe($('#offlineBar'));
  ro.observe($('#saveBar'));
}
new MutationObserver(syncBarHeights).observe($('#saveBar'), { attributes: true, attributeFilter: ['hidden'] });
function syncOnline() {
  const off = !navigator.onLine;
  document.body.classList.toggle('offline', off);
  $('#offlineBar').hidden = !off;
  // 모바일 '지도' 탭은 화면 높이에 맞춰 그리므로 안내 띠 높이만큼 줄인다 (띠가 지도 조작부를 가리지 않게)
  syncBarHeights();
  if (pickViewport.matches && $('.layout')?.dataset.tab === 'map' && prefs.page === 'plan') {
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      revealMap();
    });
  }
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
const getJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
Promise.all([getJson('data/trends.json'), getJson('data/trends-i18n.json').catch(() => null)])
  .then(([data, tr]) => {
    trends = data;
    trendsI18n = tr;
    if (prefs.page === 'home') renderHome();
    else if (trip && prefs.page === 'plan') renderDays();
  })
  .catch(() => {});
