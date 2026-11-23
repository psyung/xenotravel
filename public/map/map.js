import { locationChoice } from './picking.js';
import { getLang, t, k, dayName, shortDate } from '../lib/i18n.js';
import * as M from '../lib/model.js';
import { staySuggestions } from '../lib/route-check.js';
import * as T from '../lib/trends.js';

let boundAllLists, boundCatIcon, boundClearCandidate, boundDirectionsHtml, boundExpandMap, mapLayer, boundLocateMapPlace, mapInstance, boundMapControlsText, boundMapDayContext, boundMapDayOptions, boundMapTileKind, boundPinIcon, boundRenderMap, boundShowCandidate, boundSyncTiles, boundTileGroup, boundShowAllRoutes, registerLegend;
export { boundAllLists as allLists };
export { boundCatIcon as catIcon };
export { boundClearCandidate as clearCandidate };
export { boundDirectionsHtml as directionsHtml };
export { boundExpandMap as expandMap };
export { mapLayer as layer };
export { boundLocateMapPlace as locateMapPlace };
export { mapInstance as map };
export { boundMapControlsText as mapControlsText };
export { boundMapDayContext as mapDayContext };
export { boundMapDayOptions as mapDayOptions };
export { boundMapTileKind as mapTileKind };
export { boundPinIcon as pinIcon };
export { boundRenderMap as renderMap };
export { boundShowCandidate as showCandidate };
export { boundSyncTiles as syncTiles };
export { boundTileGroup as tileGroup };
export { boundShowAllRoutes as showAllRoutes };

export function init(ctx) {
  const {
    isDark, prefs, ui, savePrefs, $, toast, esc, dayColor, withoutTransitions, syncBrowserTheme, INBOX_COLOR,
    selectDay, showTab, href, runSearch, addPlace, $$, narrowMq, applyView, currentCity, curView, TODAY, tp,
    origAttr, origTag,
  } = ctx;

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

  const mapTileKind = () => isDark() ? 'dark' : prefs.mapStyle === 'gray' ? 'gray' : 'street';

  /* ───────── 지도 ───────── */
  const map = L.map('map', { worldCopyJump: true, tapHold: false }).setView([30, 20], 2);

  const mapDayContext = () => JSON.stringify([ctx.trip?.id, ui.day, ui.focusList, getLang(), ctx.trip?.days.map(({ id, date }) => [id, date])]);
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
    if (!ui.tilesDown || !ctx.trip) {
      el.hidden = true;
      el.innerHTML = '';
      if (hint) hint.hidden = true;
      $('#tileError').classList.remove('with-mini');
      return;
    }
    const focusDay = ctx.trip.days.findIndex((d) => d.id === ui.focusList);
    const days = ctx.trip.days.map((d, i) => i).filter((i) => focusDay < 0 || i === focusDay);
    const routes = days.map((i) => ({ i, color: dayColor(i), pts: M.dayRoute(ctx.trip, i) })).filter((r) => r.pts.length);
    const stays = new Map();
    for (const r of routes) for (const p of r.pts) if (ctx.trip.stays.includes(p)) stays.set(p.id, p);
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
    if (id) ctx.openItem(id, { scroll: true });
  });
  $('#miniMap').addEventListener('keydown', (e) => {
    const id = (e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-mini-item]')?.dataset.miniItem;
    if (!id) return;
    e.preventDefault();
    ctx.openItem(id, { scroll: true });
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
      ${ctx.trip && staySuggestions(ctx.trip).length ? `<button type="button" data-stay-suggestions aria-pressed="${Boolean(prefs.staySuggestions)}" class="${prefs.staySuggestions ? 'active' : ''}">${esc(t('숙소 추천 위치'))}</button>` : ''}
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
    const dayIdx = ctx.trip.days.findIndex((d) => d.id === ui.focusList);
    if (cat === 'stay') {
      if (dayIdx < 0) return ctx.trip.stays.length;
      const st = M.dayStays(ctx.trip, dayIdx);
      return [st.start, st.end].filter(Boolean).length;
    }
    const lists = dayIdx >= 0 ? [ctx.trip.days[dayIdx].items] : [...ctx.trip.days.map((d) => d.items), ctx.trip.inbox];
    return lists.flat().filter((it) => (M.CATEGORIES[it.category] ? it.category : 'etc') === cat).length;
  }
  /** 고른 일차에는 없지만 다른 일차(보관함 포함)에는 있는 그 종류 수 — 0건 안내에서 '전체 일차에서 보기'로 바로 넘어간다 */
  function catElsewhere() {
    if (!byCategory() || !ui.catFilter || !ctx.trip.days.some((d) => d.id === ui.focusList)) return 0;
    if (ui.catFilter === 'stay') return ctx.trip.stays.length;
    return [...ctx.trip.days.flatMap((d) => d.items), ...ctx.trip.inbox].filter((it) => (M.CATEGORIES[it.category] ? it.category : 'etc') === ui.catFilter).length;
  }
  function catEmptyText() {
    if (!byCategory() || !ui.catFilter || catFilterCount()) return '';
    const day = ctx.trip.days.some((d) => d.id === ui.focusList);
    if (ui.catFilter === 'stay') return day ? t('이 일차에 등록된 숙소가 없어요') : t('이 여행에 등록된 숙소가 없어요');
    const name = catLabel(ui.catFilter);
    return day
      ? t('이 일차에 등록된 {cat} 장소가 없어요', { cat: name })
      : t('이 여행에 등록된 {cat} 장소가 없어요', { cat: name });
  }

  function allLists() {
    return [
      ...ctx.trip.days.map((d, i) => ({ id: d.id, items: d.items, color: dayColor(i), label: dayName(i), isDay: true })),
      { id: M.INBOX, items: ctx.trip.inbox, color: INBOX_COLOR, label: t('보관함'), isDay: false },
    ];
  }

  function renderMap({ fit = false } = {}) {
    if (locationChoice && locationChoice.context !== mapDayContext()) map.closePopup(locationChoice.popup);
    if (!ui.candidate) $('#mapPlace').hidden = true;
    layer.clearLayers();
    markers.clear();
    if (!ctx.trip) return;
    const bounds = [];
    const plan = ctx.currentRoutePlan();
    allLists().forEach((l, dayIndex) => {
      const dim = ui.focusList != null && ui.focusList !== l.id;
      const color = l.isDay && ui.focusList === l.id ? 'var(--accent)' : l.color;
      // 동선 정리 미리 보기 중인 날은 제안 순서로 선과 번호를 그린다 (실선 = 아직 적용 전 제안).
      const preview = plan?.listId === l.id ? plan.ids.map((id) => l.items.find((it) => it.id === id)) : null;
      // 동선: 출발 숙소 → 장소들 → 귀가 숙소
      const { start, end } = l.isDay ? M.dayStays(ctx.trip, dayIndex) : {};
      const route = preview ? [start, ...preview, end].filter(Boolean) : l.isDay ? M.dayRoute(ctx.trip, dayIndex) : l.items;
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
    const focusIdx = ctx.trip.days.findIndex((d) => d.id === ui.focusList);
    const focusStays = focusIdx >= 0 ? new Set(Object.values(M.dayStays(ctx.trip, focusIdx)).filter((x) => x?.id).map((x) => x.id)) : null;
    if (prefs.staySuggestions && (!byCategory() || !ui.catFilter || ui.catFilter === 'stay')) {
      for (const { start, end, lat, lng } of staySuggestions(ctx.trip)) {
        if (focusIdx >= 0 && (focusIdx < start || focusIdx > end)) continue;
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'stay-suggestion-marker', iconSize: [40, 40], iconAnchor: [20, 20] }),
        }).addTo(layer);
        const label = `${t('숙소 추천 위치')} · ${M.dayRanges(Array.from({ length: end - start + 1 }, (_, i) => start + i))}`;
        labelMarker(marker, label);
        marker.bindPopup(esc(label));
      }
    }
    for (const s of ctx.trip.stays) {
      const { checkIn, checkOut } = M.stayDates(ctx.trip, s);
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
    const date = ctx.trip.days[ui.day]?.date;
    $('#mapDayLabel').textContent = `${dayName(ui.day)}${date ? ` · ${shortDate(date)}` : ''}`;
    $('#dayPrev').disabled = ui.day <= 0;
    $('#dayNext').disabled = ui.day >= ctx.trip.days.length - 1;
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
    $('#msDay').parentElement.hidden = sheetState === 'peek';
    $('#msList').inert = sheetState === 'peek'; // 살짝 상태에서는 가려진 목록에 포커스가 가지 않게
    // 오프라인 미니맵은 시트를 뺀 자리에 다시 그린다. 크게 펼치면 가려진 핀은 탭 순서에서도 뺀다 (GPT 6차 #4)
    const mini = $('#miniMap');
    if (mini) mini.inert = sheetPad() > 0 && sheetState === 'full';
    if (ui.tilesDown && prev !== sheetState && !mini?.hidden) renderMiniMap();
  }
  function mapDayOptions() {
    return ctx.trip.days.map((day, i) => `<option value="${esc(day.id)}">${esc(dayName(i))}${day.date ? ` · ${esc(shortDate(day.date))}` : ''}</option>`).join('');
  }

  function renderMapSheet() {
    if (!ctx.trip) return;
    const focus = ctx.trip.days.findIndex((d) => d.id === ui.focusList);
    const days = focus >= 0 ? [focus] : ctx.trip.days.map((_, i) => i);
    let count = 0;
    const rows = days.map((i) => {
      const day = ctx.trip.days[i];
      const route = M.dayRoute(ctx.trip, i);
      const head = focus < 0 ? `<li class="ms-day" style="--c:${dayColor(i)}"><span aria-hidden="true"></span>${esc(dayName(i))}${day.date ? ` · ${esc(shortDate(day.date))}` : ''}</li>` : '';
      if (!day.items.length) return `${head}<li class="ms-empty">${esc(t('이 날은 아직 장소가 없어요'))}</li>`;
      count += day.items.length;
      return head + route.map((p) => {
        const stay = ctx.trip.stays.includes(p);
        const n = day.items.indexOf(p) + 1;
        const cat = M.CATEGORIES[p.category];
        const meta = stay ? t('숙소') : [p.time, cat ? t(cat.label) : ''].filter(Boolean).join(' · ');
        return `<li><button type="button" class="ms-row" data-ms-item="${esc(p.id)}">
        <span class="ms-num${stay ? ' stay' : ''}" style="--c:${dayColor(i)}" aria-hidden="true">${stay ? '<svg class="ic"><use href="#i-home"/></svg>' : n}</span>
        <span class="ms-main"><b>${esc(p.name)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</span></button></li>`;
      }).join('');
    }).join('');
    const date = focus >= 0 ? ctx.trip.days[focus].date : '';
    $('#msTitle').textContent = focus >= 0 ? `${dayName(focus)}${date ? ` · ${shortDate(date)}` : ''}` : t('전체 동선');
    $('#msCount').textContent = count ? t('{n}곳', { n: count }) : '';
    const picker = $('#msDay');
    picker.innerHTML = `<option value="">${esc(t('전체 동선'))}</option>${mapDayOptions()}`;
    picker.value = focus >= 0 ? ui.focusList : '';
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
    $('#msDay').addEventListener('change', (e) => {
      const index = ctx.trip.days.findIndex((day) => day.id === e.target.value);
      if (index >= 0) selectDay(index, { scroll: false });
      else boundShowAllRoutes();
    });
    $('#msEdit').addEventListener('click', () => {
      setSheet('peek');
      showTab('plan');
      const focus = ctx.trip.days.findIndex((d) => d.id === ui.focusList);
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
    const dayIdx = ctx.trip.days.findIndex((d) => d.items.includes(item));
    if (dayIdx < 0) return null;
    const route = M.dayRoute(ctx.trip, dayIdx);
    const i = route.indexOf(item);
    return i > 0 ? route[i - 1] : null;
  }
  function directionsHtml(item, { from = prevPointOf(item), cls = 'dir-links' } = {}) {
    const links = M.tripDirectionsLinks(ctx.trip, item, from, prefs.directionsApp);
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
      ctx.openItem(id, { scroll: true });
    }
    if (e.target.closest('[data-cand-add]') && ui.candidate) {
      const p = ui.candidate;
      // 검색 결과의 '위치 보기'로 연 후보인데 그사이 검색어가 바뀌었으면 넣지 않고 다시 찾는다 (GPT 4차 #6)
      if (p.fromSearch != null && p.fromSearch !== ctx.searchEl.value.trim()) {
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
      ctx.searchEl.focus();
      if (ui.results.length) ctx.resultsEl.hidden = false;
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

  function renderTrendMarkers() {
    const city = currentCity();
    if (!city || ui.readonly || (curView() === 'list' && !ctx.trendsOpen())) return;
    const collection = ctx.trendCollection();
    for (const p of T.activePlaces(city, TODAY, collection)) {
      const loc = tp(p);
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: '<div class="trend-pin" aria-hidden="true">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        zIndexOffset: -100,
      })
        .bindPopup(
          `<div class="popup-name">${esc(loc.name)}</div>` +
            `<div class="popup-meta">${esc(ctx.trendLabel(collection))}${p.status ? ` · ${esc(T.statusLabel(p, TODAY))}` : ''}</div>` +
            (loc.summary ? `<p class="popup-sum"${origAttr(loc)}>${esc(loc.summary)}${origTag(loc)}</p>` : '') +
            `<button class="popup-add" data-add-trend="${esc(p.id)}">${esc(t('+ 일정에 담기'))}</button>`,
        )
        .addTo(layer);
      labelMarker(m, `${ctx.trendLabel(collection)}: ${loc.name}`);
    }
  }

  function fitTo(bounds) {
    const pad = sheetPad(); // 모바일 지도 시트가 가리는 아래쪽은 비워 두고 맞춘다
    if (bounds.length === 1) {
      map.setView(bounds[0], 15, { animate: false });
      if (pad) map.panBy([0, pad / 2], { animate: false });
    } else if (bounds.length > 1) map.fitBounds(bounds, { paddingTopLeft: [48, 48], paddingBottomRight: [48, 48 + pad], maxZoom: 16 });
    else if (ctx.trip?.center) map.setView([ctx.trip.center.lat, ctx.trip.center.lng], 12);
  }

  registerLegend = ({ renderDays }) => {
    $('#pinLegend').addEventListener('click', (e) => {
      if (e.target.closest('[data-stay-suggestions]')) {
        prefs.staySuggestions = !prefs.staySuggestions;
        savePrefs();
        renderMap();
        $('#pinLegend [data-stay-suggestions]')?.focus({ preventScroll: true });
        return;
      }
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

    boundShowAllRoutes = showAllRoutes;
  };

  boundAllLists = allLists;
  boundCatIcon = catIcon;
  boundClearCandidate = clearCandidate;
  boundDirectionsHtml = directionsHtml;
  boundExpandMap = expandMap;
  mapLayer = layer;
  boundLocateMapPlace = locateMapPlace;
  mapInstance = map;
  boundMapControlsText = mapControlsText;
  boundMapDayContext = mapDayContext;
  boundMapDayOptions = mapDayOptions;
  boundMapTileKind = mapTileKind;
  boundPinIcon = pinIcon;
  boundRenderMap = renderMap;
  boundShowCandidate = showCandidate;
  boundSyncTiles = syncTiles;
  boundTileGroup = tileGroup;
}


export function initLegend(ctx) {
  registerLegend(ctx);
}
