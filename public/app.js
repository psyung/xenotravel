import * as M from './lib/model.js';
import { parseLocationInput, parseLocationList } from './lib/links.js';
import { searchPlaces, searchPlacesKo, HANGUL, reversePlace, geocodeDestination, nearbyTourism } from './lib/geo.js';
import { reminderTodos } from './lib/flight-reminders.js';
import { openStore, appStorageKeys, KEY as STORE_KEY } from './lib/store.js';
import { exportXlsx, downloadJson, downloadAllTrips, downloadCalendar } from './lib/export.js';
import * as T from './lib/trends.js';
import * as B from './lib/budget.js';
import * as C from './lib/checklist.js';
import { encodeShare, decodeShare, shareUrl, shareCodeFromHash, shareSummary, shareMessage, sharedCopy } from './lib/share.js';
import { enhanceDates, openDateRange, refreshDates } from './lib/datepicker.js';
import { watchSelects } from './lib/select.js';
import * as Courses from './lib/courses.js';
import { enhanceSuggestions } from './lib/suggestions.js';
import { loadWeather, weatherSignature } from './lib/weather.js';
import { t, k, missing as i18nMissing, LANGS, LANG_KEY, getLang, setLang, loadLang, saveLang, locale, num, dayName, shortDate, dateTime, normalizeLang, tripLength, allVersions } from './lib/i18n.js';
import { adSlot, loadAds } from './lib/ads.js';
import { createUndoStack } from './lib/undo.js';
import { stayRangeWithin } from './lib/stays.js';
import { summaryModel, drawSummary, summaryFileName } from './lib/summary.js';
import { DESTINATIONS, destinationById, destinationLabel, resolveDestination, repairTripCenter } from './lib/destinations.js';
import { backupReason, backupReasonText, lastBackupLabel } from './lib/backup.js';
import * as Covers from './lib/covers.js';
import { init as initBudget, renderBudget, fetchRate } from './pages/budget.js';
import { init as initChecks, renderChecks, initPresets } from './pages/check.js';
import { init as initScrollFab } from './ui/scroll-fab.js';
import { init as initBoardPan, updateBoardNav } from './ui/board-pan.js';
import { init as initSearchBar } from './ui/search-bar.js';
import { init as initMap, initLegend, allLists, catIcon, clearCandidate, directionsHtml,
  expandMap, layer, locateMapPlace, map, mapControlsText, mapDayContext, mapDayOptions,
  mapTileKind, pinIcon, renderMap, showAllRoutes, showCandidate, syncTiles, tileGroup } from './map/map.js';
import { init as initPicking, initPickButtons, cancelMapHold, locationChoice,
  pickViewport, revealMap, setPicking } from './map/picking.js';
import { init as initPlan, initDialogs, initDock, initStays, bm, costTagHtml, currentRoutePlan,
  dayOptionAttrs, listName, openItem, openStays, renderDays, resumeStayFromMap, targetLabel } from './pages/plan.js';
import { init as initConfirm, ask, askDialog, closeOnBackdrop, showDialog } from './ui/dialog.js';
import { init as initToast, clearToast, pushUndo, toast } from './ui/toast.js';

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
const PREF_DEFAULTS = { view: 'list', mapHidden: false, pinColor: 'day', page: 'plan', theme: 'system', staySuggestions: true };
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

const isDark = () => prefs.theme === 'dark';

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

initToast({
  get trip() { return trip; },
  $, undoStack,
});

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

initMap({
  get trip() { return trip; },
  get openItem() { return openItem; },
  get currentRoutePlan() { return currentRoutePlan; },
  get searchEl() { return searchEl; },
  get resultsEl() { return resultsEl; },
  get trendsOpen() { return trendsOpen; },
  get trendCollection() { return trendCollection; },
  get trendLabel() { return trendLabel; },
  isDark, prefs, ui, savePrefs, $, toast, esc, dayColor, withoutTransitions, syncBrowserTheme, INBOX_COLOR,
  selectDay, showTab, href, runSearch, addPlace, $$, narrowMq, applyView, showMapPanel, currentCity, curView, TODAY, tp, origAttr,
  origTag,
});

/* ───────── 트렌드 (요즘 뜨는 곳) ─────────
 * 트렌드 장소 이름·요약은 조사한 원문 자료라 번역하지 않는다 (도시 이름과 상태 문구만 지금 언어로).
 */
/** P0-8: 여행 페이지는 여행지 도시 데이터만 쓴다 (다른 도시를 고르는 칸 없음 — 도시 고르기는 홈에서만) */
function currentCity() {
  if (!trip || !trends.cities.length) return null;
  return T.cityByName(trends.cities, trip.destination);
}

const trendCollection = () => ui.trendCollection ?? 'trending';
let nearby = null;
let lastNearbyRequest = -Infinity;
const nearbyContext = () => trip?.center ? JSON.stringify([trip.id, trip.center.lat, trip.center.lng]) : '';

function resetNearby() {
  nearby?.controller?.abort();
  nearby = null;
}

async function loadNearby() {
  const context = nearbyContext();
  if (!context || ui.readonly || currentCity() || nearby?.controller ||
      (nearby?.context === context && nearby.places) || Date.now() - lastNearbyRequest < 1000) return;
  lastNearbyRequest = Date.now();
  const controller = new AbortController();
  const request = nearby = { context, controller };
  renderDays();
  $('#nearby-status')?.focus({ preventScroll: true });
  try {
    request.places = await nearbyTourism(trip.center, controller.signal);
  } catch (error) {
    if (error.name === 'AbortError') return;
    request.error = error.kind === 'busy' ? 'busy' : 'failed';
  } finally {
    request.controller = null;
    if (nearby === request && context === nearbyContext() && prefs.page === 'plan') {
      const restoreFocus = document.activeElement?.id === 'nearby-status';
      renderDays();
      if (restoreFocus) ($('#nearby-status') ?? $('[data-action="nearby-load"]'))?.focus({ preventScroll: true });
    }
  }
}

function nearbyHtml() {
  const places = nearby?.places;
  const status = nearby?.controller ? t('주변 명소를 찾는 중이에요')
    : nearby?.error === 'busy' ? t('장소 검색 서버 오류 ({status})', { status: 429 })
    : nearby?.error ? t('검색 서버에 연결하지 못했어요')
    : places?.length === 0 ? t('주변 명소를 찾지 못했어요') : '';
  // J-20: 실제 기능처럼 보이지 않게 흐린 모양 + "준비 중" 배지, 칸들의 맨 끝(보드는 맨 오른쪽)에 둔다
  return `<section class="trend-col card nearby-trends pending" style="--c:${TREND_COLOR}">
    <div class="trend-empty">
      <span class="dot" aria-hidden="true"></span><span>${esc(t('이 도시 추천은 준비 중이에요'))}</span><span class="soon-badge">${esc(t('준비 중'))}</span>
      <button type="button" class="link" data-action="trend-search">${esc(t('장소 검색하기'))}</button>
      ${nearbyContext() && !places && !nearby?.controller ? `<button type="button" class="btn" data-action="nearby-load">${esc(t('지도 데이터 기반 주변 명소'))}</button>` : ''}
    </div>
    ${status ? `<p id="nearby-status" class="trend-note" role="status" tabindex="-1">${esc(status)}</p>` : ''}
    ${places?.length ? `<ul class="trend-list">${places.map((place, index) => trendCardHtml({
      name: place.name, area: place.address, source: esc(t('지도 데이터 기반')), action: 'nearby-add', attributes: ` data-index="${index}"`,
    })).join('')}</ul>` : ''}
  </section>`;
}

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

function trendCardHtml({ name, area, source, action, attributes = '', badge = '', summary = '', approximate = false }) {
  return `<li class="trend-card"${attributes}>
    ${badge}<div class="tc-name">${esc(name)}</div>
    ${area ? `<div class="tc-area">${esc(area)}${approximate ? ` · ${esc(t('대략 위치'))}` : ''}</div>` : ''}
    ${summary}
    <div class="tc-foot"><span class="tc-src">${source}</span>
      <button type="button" class="tc-add" data-action="${action}" aria-label="${esc(t('{name} 일정에 담기', { name }))}">${esc(t('+ 담기'))}</button>
    </div>
  </li>`;
}

function trendSectionHtml() {
  const city = currentCity();
  const board = curView() === 'board';
  const open = trendsOpen();
  const collection = trendCollection();
  const places = T.activePlaces(city, TODAY, collection);
  // P0-8: 여행지 트렌드 데이터가 없으면 접힌 한 줄 안내 + 장소 검색 바로가기만
  if (!city) {
    return nearbyHtml();
  }
  const cards = places.map((p) => {
    const loc = tp(p);
    const source = p.source === '편집 선정' ? esc(t('편집 선정'))
      : `${esc(t('출처'))} ${(p.sources ?? []).map((s, i) => `<a href="${href(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}" aria-label="${esc(t('출처 {n}: {title}', { n: i + 1, title: s.title }))}">${i + 1}</a>`).join(' ')}`;
    return trendCardHtml({
      name: loc.name, area: loc.area, approximate: p.approx, source, action: 'add-trend', attributes: ` data-trend="${esc(p.id)}"`,
      badge: p.status ? `<div class="tc-top"><span class="tc-badge s-${esc(p.status)}">${esc(T.statusLabel(p, TODAY))}</span><span class="tc-cat">${esc(loc.category)}</span></div>` : '',
      summary: loc.summary ? `<p class="tc-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>` : '',
    });
  }).join('');
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


initPicking({
  get trip() { return trip; },
  get stayMapDraft() { return stayMapDraft; },
  get resumeStayFromMap() { return resumeStayFromMap; },
  get openStays() { return openStays; },
  set stayMapDraft(value) { stayMapDraft = value; },
  $, ui, map, mapDayContext, esc, mapDayOptions, addPlace, $$, toast, clearCandidate, showTab,
});

/* ───────── 저장 ─────────
 * 바로 저장하고(다른 탭이 그사이 저장했으면 합쳐서), 성공했을 때만 "저장했어요"류 안내를 보여준다.
 * 실패하면 화면의 데이터는 그대로 두고 위에 고정 안내를 띄운다 (다시 저장 · 백업 파일 저장).
 */
const SAVE_ERRORS = {
  quota: k('브라우저 저장 공간이 가득 차서 저장하지 못했어요. 화면의 내용은 그대로 있으니 백업 파일로 저장한 뒤, 오래된 여행이나 다른 사이트 데이터를 지우고 다시 저장해 주세요.'),
  denied: k('이 브라우저에서 저장이 막혀 있어요(시크릿 모드·사이트 데이터 차단 등). 새로고침하면 사라지니 백업 파일로 저장해 주세요.'),
  unavailable: k('이 브라우저에서 저장소를 쓸 수 없어요. 새로고침하면 사라지니 백업 파일로 저장해 주세요.'),
};

let wipingDevice = false;
function saveNow(choices) {
  persistSoon.cancel();
  if (ui.readonly || wipingDevice) return { ok: true, changed: [] };
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
  if (e.key === STORE_KEY && e.newValue === null && localStorage.getItem(STORE_KEY) === null) {
    persistSoon.cancel();
    history.replaceState(null, '', appBase());
    location.reload();
    return;
  }
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

initConfirm({
  $, esc,
});

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
    renderRetrospective();
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


let stayMapDraft = null;
initStays({
  get trip() { return trip; },
  get stayMapDraft() { return stayMapDraft; },
  set stayMapDraft(value) { stayMapDraft = value; },
  $, esc, ui, showDialog, map, showTab, closeOnBackdrop, prefs, narrowMq, savePrefs, applyView, showMapPanel, setPicking, ask,
  commit, pushUndo, saved, askDialog, extendTripFor, TODAY,
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
  const message = hidden ? t('저장했어요. 출발일이 여행 기간 밖이라 일정에는 보이지 않아요') : t('{name} 저장했어요', { name: M.flightSummary(savedFlight) });
  fillFlightForm(null);
  if (r.ok) offerFlightReminders(savedFlight, message);
});

function offerFlightReminders(savedFlight, message) {
  const ownerId = trip.id;
  const flightId = savedFlight.id;
  if (!reminderTodos(savedFlight, trip.checks).length) {
    toast(message);
    return;
  }
  flightDialog.close();
  toast(`${message} · ${t('출발 전 항공편 알림을 추가할까요?')}`, 10000, {
    label: t('할 일로 추가'),
    run: () => {
      if (ui.readonly || trip?.id !== ownerId) return;
      const flight = trip.flights.find((f) => f.id === flightId);
      if (!flight) return;
      const suggestions = reminderTodos(flight, trip.checks);
      for (const { id, textI18n } of suggestions) {
        const text = textI18n[getLang()];
        const check = trip.checks?.find((c) => c.flightReminder === id) ?? C.addCheck(trip, 'todo', text);
        Object.assign(check, { flightReminder: id, textI18n, text });
      }
      if (suggestions.length) saved(commit(), t('출발 전 할 일을 저장했어요'));
    },
  });
}
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

function wxDayVisible(dayId) {
  const day = trip?.days.find((d) => d.id === dayId);
  return day?.date >= TODAY;
}

function wxChipHtml(w, dayId) {
  if (!w || !wxDayVisible(dayId)) return '';
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

function wxHintHtml(w, dayId) {
  if (!w?.wet || !wxDayVisible(dayId)) return '';
  const what = w.icon === 'snow' ? t('눈') : t('비');
  return `<p class="wx-hint">${esc(t('{what} 소식이 있어요{prob}. 실내 장소 위주로 짜거나 우산을 챙기세요', { what, prob: w.prob != null ? ` (${what} ${w.prob}%)` : '' }))}</p>`;
}

function paintWeather() {
  for (const el of $$('[data-wx]')) el.innerHTML = wxChipHtml(ui.weather.data[el.dataset.wx], el.dataset.wx);
  for (const el of $$('[data-wx-hint]')) el.innerHTML = wxHintHtml(ui.weather.data[el.dataset.wxHint], el.dataset.wxHint);
}

function refreshWeather() {
  if (!trip) return;
  const sig = `${trip.id}#${weatherSignature(trip, TODAY)}`;
  if (sig === ui.weather.sig) return;
  ui.weather.sig = sig;
  ui.weather.data = {};
  paintWeather();
  loadWeather(trip, TODAY)
    .then((data) => {
      if (ui.weather.sig !== sig) return; // 그사이 날짜·여행이 바뀜
      ui.weather.data = data;
      paintWeather();
    })
    .catch(() => {});
}
const refreshWeatherSoon = debounce(refreshWeather, 600);

initPlan({
  get trip() { return trip; },
  get nearby() { return nearby; },
  ui, esc, prefs, href, directionsHtml, catIcon, TODAY, dayFlights, dayColor, saved, commit, $, narrowMq,
  INBOX_COLOR, locateMapPlace, ask, pushUndo, flightRowsHtml, toast, renderMap, wxChipHtml, wxHintHtml,
  nearbyContext, currentCity, resetNearby, allLists, renderDayTabs, trendSectionHtml, $$, addTrend, curView,
  showTab, renderTarget, loadNearby, addPlace, trendCollection, trendsOpen, savePrefs, paintWeather, copyText,
  openFlights, debounce, markEdited, persistSoon, renderRetrospective,
});

initLegend({ renderDays });

initScrollFab({ $, $$ });
initBoardPan({ $, curView, t });

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
/* J-21: 지도 패널 숨기기·보이기 — 목록과 보드는 따로 기억한다 (보드는 처음엔 목록 값을 따른다) */
const mapHiddenKey = () => (curView() === 'board' ? 'mapHiddenBoard' : 'mapHidden');
const isMapHidden = () => Boolean(prefs[mapHiddenKey()] ?? prefs.mapHidden);
function setMapHidden(hidden) {
  prefs[mapHiddenKey()] = hidden;
  savePrefs();
  applyView();
}
/** 지도에서 찍기·위치 보기처럼 지도가 꼭 필요할 때 숨긴 지도를 다시 연다 (데스크톱) */
function showMapPanel() {
  if (narrowMq.matches || !isMapHidden()) return false;
  setMapHidden(false);
  return true;
}
const PANEL_ICON = (filled) => `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.5" y="3.5" width="15" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="11.5" y="4.3" width="5.2" height="11.4" rx="1.6" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${filled ? 0 : 1.2}" opacity="${filled ? 1 : .55}"/><line x1="11.5" y1="4" x2="11.5" y2="16" stroke="currentColor" stroke-width="1.6"/></svg>`;
function paintMapToggle(btn, hidden) {
  const label = hidden ? t('지도 보기') : t('지도 숨기기');
  btn.innerHTML = PANEL_ICON(!hidden);
  btn.setAttribute('aria-pressed', String(!hidden));
  btn.setAttribute('aria-label', label);
  btn.title = `${label} (M)`;
}
function applyView() {
  const layout = $('.layout');
  layout.dataset.view = curView();
  layout.classList.toggle('map-hidden', !narrowMq.matches && isMapHidden()); // P1-7·J-21: 데스크톱은 목록·보드 모두 지도를 접을 수 있다
  document.body.dataset.view = curView();
  $$('.seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === curView());
    b.setAttribute('aria-pressed', String(b.dataset.view === curView()));
  });
  paintMapToggle($('#mapToggle'), isMapHidden());
  paintMapToggle($('#miniMapToggle'), isMapHidden());
  const daysEl = $('#days');
  daysEl.tabIndex = curView() === 'board' ? 0 : -1; // J-19: 보드에 포커스를 두고 ← → 로 한 칸씩
  if (curView() === 'board') daysEl.setAttribute('aria-label', t('일정 보드 (← → 로 한 칸씩 이동)'));
  else daysEl.removeAttribute('aria-label');
  updateBoardNav?.();
  setTimeout(() => map.invalidateSize(), 0);
  setTimeout(() => map.invalidateSize(), 260); // 접기·펼치기 전환이 끝난 뒤 타일이 회색으로 비지 않게
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
$('#mapToggle').addEventListener('click', () => setMapHidden(!isMapHidden()));
// J-21: M 키로 지도 숨기기·보이기 (입력 중이거나 창이 열려 있으면 동작하지 않음)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'm' && e.key !== 'M') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || narrowMq.matches || !trip || prefs.page !== 'plan') return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]') || $('dialog[open]')) return;
  $('#mapToggle').click();
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
initPickButtons({ $, get ui() { return ui; } });

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

async function chooseDirectionsApp() {
  const active = prefs.directionsApp ?? '';
  const options = { '': t('국가별 기본값'), ...M.DIRECTIONS_APPS };
  const result = await ask({
    title: t('길찾기 앱'),
    html: `<select id="directionsPreference" data-ui-select aria-label="${esc(t('길찾기 앱'))}">${Object.entries(options)
      .map(([value, label]) => `<option value="${value}"${value === active ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`,
    actions: [{ value: 'save', label: t('저장'), primary: true }],
  });
  if (result !== 'save') return;
  prefs.directionsApp = $('#directionsPreference').value;
  savePrefs();
  render();
}

$('.menu .menu-pop').addEventListener('click', (e) => {
  const action = e.target.closest('[data-menu]')?.dataset.menu;
  $('.menu').open = false;
  if (action === 'backup') saveTripBackup();
  else if (action === 'calendar' && !downloadCalendar(trip)) toast(t('캘린더에 내보낼 일정이 없어요. 날짜가 있는 일차에 장소를 넣으면 내보낼 수 있어요'), 3500);
  else if (action === 'import') $('#importFile').click();
  else if (action === 'delete') deleteTrip(trip.id);
  else if (action === 'wipe-device') {
    $('.menu summary').focus();
    void wipeDevice();
  }
  else if (action === 'flights') openFlights();
  else if (action === 'directions') {
    $('.menu summary').focus();
    void chooseDirectionsApp();
  }
  else if (action === 'stays') openStays();
  else if (action === 'share') {
    $('.menu summary').focus();
    $('#shareBtn').click();
  }
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

async function backupCover(id) {
  const cover = await Covers.get(id);
  return cover ? Covers.encode(cover) : null;
}

async function wipeDevice() {
  if (wipingDevice) return;
  const count = Object.keys(store.trips).length;
  const choice = await ask({
    title: t('이 기기에서 모든 데이터 지우기'),
    focusCancel: true,
    body: t('여행 {n}개와 이 기기의 앱 설정을 지워요. 지운 데이터는 되돌릴 수 없어요.', { n: num(count) }),
    actions: [
      { value: 'backup', label: t('백업 후 지우기') },
      { value: 'wipe', label: t('지우기'), danger: true },
    ],
  });
  if (!choice) return;
  wipingDevice = true;
  document.body.inert = true;
  try {
    if (choice === 'backup') {
      const trips = structuredClone(Object.values(store.trips));
      const snapshots = await Promise.all(trips.map(async (snapshot) => ({ ...snapshot, cover: await backupCover(snapshot.id) })));
      await downloadAllTrips(snapshots);
    }
    persistSoon.cancel();
    refreshWeatherSoon.cancel();
    if (globalThis.indexedDB) await Covers.clear();
    const worker = await navigator.serviceWorker?.getRegistration(appBase());
    await worker?.unregister();
    if (globalThis.caches) {
      const keys = (await caches.keys()).filter((key) => key.startsWith('xenotravel-'));
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    for (const key of appStorageKeys(localStorage)) localStorage.removeItem(key);
    history.replaceState(null, '', appBase());
    location.reload();
  } catch {
    wipingDevice = false;
    document.body.inert = false;
    toast(t('백업 또는 데이터 삭제를 완료하지 못했어요'), 4000);
  }
}

async function saveTripBackup() {
  if (!trip) return;
  const snapshot = structuredClone(trip);
  const readonly = ui.readonly;
  try {
    downloadJson({ ...snapshot, cover: readonly ? null : await backupCover(snapshot.id) });
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
    if (location.hash.startsWith('#/?')) {
      const params = new URLSearchParams(location.hash.slice(3));
      const id = params.get('dest');
      const destination = destinationById(id);
      if (destination) {
        $('#homeNewDestination').value = t(destination.value);
        if (params.get('course') === id) void importCourse(id, location.hash);
      }
    }
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
  resetNearby();
  leaveShared();
  setPicking(false);
  map.closePopup();
  clearCandidate();
  trip = tr;
  ui.trendCollection = 'trending';
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
async function createTripFrom({ destination, title = '', startDate, endDate, places = [], course = null, withChecklist = true }, submit) {
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
  tr.inbox.push(...places.map(M.createItem));
  // I-5: 가이드 코스는 보관함이 아니라 Day 1부터 글의 순서·시간·메모 그대로
  const placed = course ? Courses.applyCourse(tr, course, { startDay: 0, lang: getLang(), withChecklist }) : null;
  if (found?.country) tr.country = found.country;
  B.ensureBudget(tr); // 통화를 정해 둔다 (근거가 없으면 첫 기록 전에 확인받는다)
  switchTrip(tr, { save: true });
  if (placed) {
    selectDay(placed.firstDay, { scroll: false });
    return tr;
  }
  if (center) map.setView([center.lat, center.lng], 12);
  setTimeout(() => searchEl.focus(), 50);
  return tr;
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
// 사진을 상자에 끌어다 놓아도 된다
{
  const drop = $('#coverDrop');
  drop.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) editCover(file);
  });
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

/** 공통 푸터 (모든 화면 아래): 개인정보처리방침 · 이용약관 · 문의 — 모두 현재 언어의 웹페이지 링크 (I-1) */
function renderFooter() {
  $('#siteFoot').innerHTML = `
      <nav class="foot-links" aria-label="${esc(t('사이트 정보'))}">
        <a href="/${getLang()}/privacy/">${esc(t('개인정보처리방침'))}</a>
        <a href="/${getLang()}/terms/">${esc(t('이용약관'))}</a>
        <a href="/${getLang()}/contact/">${esc(t('문의'))}</a>
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
  if (act === 'import' && !ui.readonly) $('#importFile').click();
});

let guideCatalog;
let catalogRequest;
function readGuideCatalog() {
  catalogRequest ??= fetch('/guide-catalog.json')
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null)
    .then((data) => {
      guideCatalog = data;
      if (data && prefs.page === 'home' && !ui.readonly) renderHome();
      return data;
    });
  return catalogRequest;
}

/* ───────── I-5: 가이드 코스로 일정 만들기 (/#/?dest=shanghai&course=shanghai) ─────────
 * 링크로 들어와도 확인 창에서 [만들기]를 눌러야만 저장한다 (남이 보낸 링크로 여행이 생기지 않게).
 * 같은 코스로 만든 여행이 있으면 먼저 [그 여행 열기] [하나 더 만들기]. 날짜는 지난 날짜도 고를 수 있다(복기용). */
async function importCourse(id, hash) {
  const data = await readGuideCatalog();
  if (location.hash !== hash || ui.readonly) return;
  history.replaceState(null, '', '#/');
  const course = data?.courses?.[id];
  if (!Courses.validCourse(course)) {
    toast(t('가이드 코스를 불러오지 못했어요.'));
    return;
  }
  const trips = Object.values(store.trips);
  const made = Courses.courseTrips(trips, id);
  if (made.length) {
    const pick = await ask({
      title: t('이미 이 코스로 만든 여행이 있어요'),
      body: made[0].title,
      actions: [{ value: 'open', label: t('그 여행 열기') }, { value: 'more', label: t('하나 더 만들기'), primary: true }],
    });
    if (pick === 'open') switchTrip(made[0]);
    if (pick !== 'more') return;
  }
  const dest = destinationById(course.destination);
  const destNames = dest ? allVersions(dest.value) : [];
  const choices = Courses.tripChoices(trips, destNames);
  const title = Courses.localized(course.title, getLang());
  const dayOptions = (tr) => tr.days.map((d, i) => `<option value="${i}">${esc(dayName(i))}${d.date ? ` · ${esc(shortDate(d.date))}` : ''}</option>`).join('');
  const html = `<p>${esc(t('{title}({n}곳)를 일정으로 만들까요?', { title, n: Courses.coursePlaceCount(course) }))}</p>
    <p class="hint">${esc(t('시간과 메모도 함께 들어가요. 시간은 제안값이라 바꿀 수 있어요.'))}</p>
    <div class="course-form">
      <fieldset><legend>${esc(t('넣을 곳'))}</legend>
        <label><input type="radio" name="courseTarget" value="new" checked> ${esc(t('새 여행으로 만들기'))}</label>
        <label><input type="radio" name="courseTarget" value="existing"${choices.length ? '' : ' disabled'}> ${esc(t('기존 여행에 넣기'))}</label>
      </fieldset>
      <label class="course-new"><span>${esc(t('여행 날짜'))}</span><input type="date" class="inp" id="courseDate" value="${Courses.nextSaturday(TODAY)}"></label>
      <div class="course-existing" hidden>
        <label><span>${esc(t('여행'))}</span><select id="courseTrip" class="inp" data-ui-select>${choices.map((tr) => `<option value="${esc(tr.id)}">${esc(tr.title)}</option>`).join('')}</select></label>
        <label><span>${esc(t('일차'))}</span><select id="courseDay" class="inp" data-ui-select>${choices[0] ? dayOptions(choices[0]) : ''}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="courseChecklist" checked> ${esc(t('준비할 일도 체크리스트에 추가'))}</label>
    </div>`;
  const answer = ask({ title, html, actions: [{ value: 'create', label: t('만들기'), primary: true }] });
  const body = $('#askBody');
  const sync = () => {
    const existing = $('input[name="courseTarget"]:checked', body)?.value === 'existing';
    $('.course-new', body).hidden = existing;
    $('.course-existing', body).hidden = !existing;
  };
  body.addEventListener('change', (e) => {
    if (e.target.name === 'courseTarget') sync();
    if (e.target.id === 'courseTrip') $('#courseDay', body).innerHTML = dayOptions(store.trips[e.target.value]);
  });
  // 날짜 칸에서 Enter를 눌러도 [취소]가 아니라 [만들기]로
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      $('#askActions .primary')?.click();
    }
  });
  if (await answer !== 'create') return;
  const withChecklist = $('#courseChecklist', body).checked;
  if ($('input[name="courseTarget"]:checked', body).value === 'existing') {
    const tr = store.trips[$('#courseTrip', body).value];
    if (!tr) return;
    if (trip?.id !== tr.id) switchTrip(tr);
    const before = structuredClone(trip);
    const { placed, firstDay } = Courses.applyCourse(trip, course, { startDay: Number($('#courseDay', body).value) || 0, lang: getLang(), withChecklist });
    if (!commit().ok) return;
    selectDay(firstDay, { scroll: true });
    pushUndo(t('{day}에 {n}곳을 넣었어요', { day: dayName(firstDay), n: placed }), () => {
      if (trip?.id !== before.id) return;
      for (const key of Object.keys(trip)) if (!(key in before)) delete trip[key];
      Object.assign(trip, before);
      commit();
    });
    return;
  }
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test($('#courseDate', body).value) ? $('#courseDate', body).value : Courses.nextSaturday(TODAY);
  await createTripFrom({
    destination: dest ? t(dest.value) : title,
    title,
    startDate,
    endDate: Courses.courseEndDate(startDate, Courses.courseDays(course)),
    course,
    withChecklist,
  });
}

function homeGuides() {
  const localized = guideCatalog?.guides?.[getLang()];
  const guides = localized?.length ? localized : guideCatalog?.guides?.ko;
  if (!guides?.length) return '';
  const lang = localized?.length ? getLang() : 'ko';
  return `<section class="home-sec">
    <div class="sec-head"><h2>${esc(t('여행 가이드'))}</h2><a href="/${lang}/guides/">${esc(t('가이드 전체 보기'))}</a></div>
    <ul class="insp" lang="${LANGS[lang].html}">${guides.map((guide) =>
      `<li><b><a href="${esc(guide.href)}">${esc(guide.title)}</a></b><p>${esc(guide.description)}</p></li>`).join('')}</ul>
  </section>`;
}

function renderHome() {
  const el = $('#page-home');
  void readGuideCatalog();
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

    ${homeGuides()}
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
    ${ui.readonly ? '' : adSlot('home')}
  </div>`;
  void loadAds(el, () => prefs.page === 'home' && !ui.readonly);
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
  if (tab !== 'map') {
    if (ui.picking) setPicking(false);
    cancelMapHold();
    if (locationChoice) map.closePopup(locationChoice.popup);
  }
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

function renderRetrospective() {
  const el = $('#retrospective');
  el.hidden = !trip || !M.tripEnded(trip, TODAY);
  if (el.hidden) {
    el.innerHTML = '';
    return;
  }
  const budget = B.ensureBudget(trip);
  const spent = B.formatUnits(B.spentUnits(trip), B.shownBaseCode(budget));
  const pending = trip.expenses.filter((entry) => B.expenseBaseUnits(entry, budget) == null).length;
  const places = trip.days.flatMap((day) => day.items);
  const visited = places.filter((place) => place.visited);
  const notes = [...places, ...trip.inbox, ...trip.stays, ...trip.flights]
    .filter((entry) => entry.memo?.trim());
  const list = (entries, row) => `<ul>${entries.map((entry) => `<li>${row(entry)}</li>`).join('')}</ul>`;
  el.innerHTML = `<h2 id="retrospectiveTitle">${esc(t('지난 여행 돌아보기'))}</h2>
    <p>${esc(t('실제 지출 합계'))} <b>${esc(spent)}</b>${pending ? ` <small>${esc(t('환율 미정 {n}건 제외', { n: pending }))}</small>` : ''}</p>
    <h3>${esc(t('방문한 곳'))} · ${esc(t('{n}곳', { n: visited.length }))}</h3>
    ${visited.length ? list(visited, (place) => esc(place.name)) : ''}
    <h3>${esc(t('메모'))}</h3>
    ${notes.length ? list(notes, (entry) => `<b>${esc(entry.name || entry.flightNo || t('항공편'))}</b> ${esc(entry.memo)}`) : `<p>${esc(t('남긴 메모가 없어요'))}</p>`}`;
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
    if (nearby?.controller) resetNearby();
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
    renderRetrospective();
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
  // 밝을 때는 달(어둡게 바꾸기), 어두울 때는 해(밝게 바꾸기) — I-4
  const label = th === 'dark' ? t('밝은 화면으로 바꾸기') : t('어두운 화면으로 바꾸기');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.querySelector('use').setAttribute('href', th === 'dark' ? '#i-sun' : '#i-moon');
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
  clearToast();
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
  renderSaveBar();
  renderFooter();
  if (trip && prefs.page !== 'home') {
    render();
    showPage(prefs.page, { scroll: false });
  } else showPage('home', { scroll: false });
}
function syncLanguageSwitch() {
  for (const button of $$('#langSwitch [data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  const select = $('#langSelect');
  if (select.value !== getLang()) {
    select.value = getLang();
    select.dispatchEvent(new Event('change')); // 공용 Select 버튼 글자("KO ▾")도 맞춘다
  }
}
function chooseLanguage(lang) {
  if (!LANGS[lang] || lang === getLang()) return false;
  setLang(lang);
  saveLang(); // 저장이 막혀도 이번 화면에서는 바뀐 언어로 계속 쓴다
  applyLanguage();
  return true;
}
$('#langSwitch').addEventListener('click', (e) => {
  const button = e.target.closest('[data-lang]');
  if (button && chooseLanguage(button.dataset.lang)) button.focus({ preventScroll: true });
});
$('#langSelect').addEventListener('change', (e) => chooseLanguage(e.target.value));

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

initDock({
  get trip() { return trip; },
  $, prefs, narrowMq, savePrefs, locateMapPlace, commit,
});

closeOnBackdrop(flightDialog);
closeOnBackdrop(newTripDialog);
closeOnBackdrop(shareDialog);
closeOnBackdrop(copyDialog);

initDialogs({
  get trip() { return trip; },
  $, esc, ui, showDialog, selectDay, showTab, prefs, savePrefs, renderMap, locateMapPlace, ask, commit, pushUndo,
  saved, closeOnBackdrop, toast,
});

initPresets({
  get trip() { return trip; },
  get ui() { return ui; },
  $, $$, esc, commit, saved, toast, pushUndo, showDialog, closeOnBackdrop,
});

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
