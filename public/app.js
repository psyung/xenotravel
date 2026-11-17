import * as M from './lib/model.js';
import { parseLocationInput } from './lib/links.js';
import { searchPlaces, reversePlace } from './lib/geo.js';
import { loadStore, saveStore } from './lib/store.js';
import { exportXlsx, downloadJson } from './lib/export.js';

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5c7cfa'];
const INBOX_COLOR = '#868e96';
const dayColor = (i) => COLORS[i % COLORS.length];

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
  for (const l of allLists()) {
    const dim = ui.focusList != null && ui.focusList !== l.id;
    const pts = l.items.map((it) => [it.lat, it.lng]);
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
  }
  $('#showAll').hidden = ui.focusList == null;
  if (fit) fitTo(bounds);
}

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
  document.title = `${trip.title} · XenoTravel`;
  const title = $('#tripTitle');
  if (document.activeElement !== title) title.value = trip.title;
  $('#startDate').value = trip.startDate;
  $('#endDate').value = trip.endDate;
  renderTarget();
  renderDays();
  renderMap({ fit });
}

function renderTarget() {
  const lists = allLists();
  if (!lists.some((l) => l.id === ui.target)) ui.target = trip.days[0]?.id ?? M.INBOX;
  $('#target').innerHTML = lists
    .map((l, i) => {
      const label = l.isDay ? M.dayTitle(trip.days[i], i) : '장소 보관함 (날짜 미정)';
      return `<option value="${l.id}"${l.id === ui.target ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
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
      <button class="icon" data-action="locate" title="지도에서 보기">◎</button>
    </div>
    ${
      open
        ? `<div class="editor">
      <label>이름<input data-field="name" value="${esc(it.name)}"></label>
      <label>시간<input type="time" data-field="time" value="${esc(it.time)}"></label>
      <label>메모<textarea data-field="memo" placeholder="영업시간, 예약번호, 꼭 먹을 것…">${esc(it.memo)}</textarea></label>
      <label>링크<input type="url" data-field="url" value="${esc(it.url)}" placeholder="예약 페이지, 블로그 등"></label>
      ${it.address ? `<p class="addr">${esc(it.address)}</p>` : ''}
      <div class="editor-actions">
        <a href="${M.googleMapsUrl(it)}" target="_blank" rel="noopener">구글맵에서 열기 ↗</a>
        <button data-action="delete" class="danger">삭제</button>
      </div>
    </div>`
        : ''
    }
  </li>`;
}

function renderDays() {
  ui.sortables.forEach((s) => s.destroy());
  ui.sortables = [];
  const daysEl = $('#days');
  daysEl.innerHTML = allLists()
    .map((l, i) => {
      const title = l.isDay ? M.dayTitle(trip.days[i], i) : '장소 보관함';
      const n = l.items.length;
      return `<section class="day${ui.focusList === l.id ? ' is-focus' : ''}" style="--c:${l.color}">
        <header class="day-head">
          <button class="day-title" data-action="focus" data-list="${l.id}" title="지도에서 이 날만 보기">
            <span class="dot"></span><strong>${esc(title)}</strong><span class="count">${n}곳</span>
          </button>
          <div class="day-tools">${l.isDay && n > 1 ? `<button data-action="sort-time" data-list="${l.id}">시간순</button>` : ''}</div>
        </header>
        <ol class="items" data-list="${l.id}">${l.items.map((it, j) => itemHtml(it, j, l.isDay)).join('')}</ol>
        ${n === 0 ? `<p class="empty-list">${l.isDay ? '장소를 검색해서 추가하거나 여기로 끌어오세요' : '날짜를 아직 정하지 않은 장소를 모아두는 곳이에요'}</p>` : ''}
      </section>`;
    })
    .join('');

  for (const ol of $$('ol.items', daysEl)) {
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
}

function openItem(id, { scroll = false } = {}) {
  ui.openItem = id;
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
    renderTarget();
    renderDays();
    renderMap({ fit: true });
  } else if (action === 'sort-time') {
    M.sortByTime(M.getList(trip, btn.dataset.list));
    commit();
  }
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

$('#showAll').addEventListener('click', () => {
  ui.focusList = null;
  renderDays();
  renderMap({ fit: true });
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

function addPlace(place, { edit = false } = {}) {
  if (!trip || !place) return;
  const listId = $('#target').value || ui.target;
  const item = M.addItem(trip, listId, place);
  ui.target = listId;
  ui.openItem = edit ? item.id : null;
  searchEl.value = '';
  hideResults();
  commit();
  map.setView([item.lat, item.lng], Math.max(map.getZoom(), 14));
  const label = $('#target').selectedOptions[0]?.textContent ?? '';
  toast(`"${item.name}" → ${label.split(' · ')[0]}에 추가했어요`);
  const el = $(`.item[data-id="${CSS.escape(item.id)}"]`);
  el?.scrollIntoView({ block: 'nearest' });
  el?.classList.add('flash');
}

$('#target').addEventListener('change', (e) => (ui.target = e.target.value));
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
          const rows = l.items
            .map(
              (it, j) => `<tr><td class="n">${l.isDay ? j + 1 : '•'}</td><td class="t">${esc(it.time)}</td>
                <td><strong>${esc(it.name)}</strong>${it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}</td>
                <td class="memo">${esc(it.memo)}${it.url ? `<div class="addr">${esc(it.url)}</div>` : ''}</td></tr>`,
            )
            .join('');
          return `<section class="print-day" style="--c:${l.color}">
            <h2>${esc(title)}</h2>
            ${l.items.length ? `<div class="print-map" data-list="${l.id}"></div>` : ''}
            ${
              l.items.length
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
    const pts = l.items.map((it) => [it.lat, it.lng]);
    if (l.isDay && pts.length > 1) L.polyline(pts, { color: l.color, weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(m);
    l.items.forEach((it, j) => L.marker([it.lat, it.lng], { icon: pinIcon(l.isDay ? j + 1 : '•', l.color, false) }).addTo(m));
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

render({ fit: true });
