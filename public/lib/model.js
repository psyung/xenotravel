// 여행 데이터 모델. 브라우저와 Node 테스트에서 같이 쓰는 순수 함수만 둔다.
// trip = { id, title, destination, startDate, endDate, center, days: [{id, date, items}], inbox: [items] }
// item = { id, name, address, lat, lng, time, memo, url, category }

import { t, longDate, num, dayName, tripLength } from './i18n.js';

export const INBOX = 'inbox';
const MAX_DAYS = 60;

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3] ? null : d;
}

const toISODate = (d) => d.toISOString().slice(0, 10);

/** 시작~종료일(포함)의 날짜 배열. 종료일이 없거나 앞서면 하루짜리. */
export function dateRange(start, end) {
  const s = parseDate(start);
  if (!s) return [];
  let e = parseDate(end);
  if (!e || e < s) e = s;
  const out = [];
  for (const d = new Date(s); d <= e && out.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(toISODate(d));
  }
  return out;
}

export function createTrip({ title, destination = '', startDate, endDate, center = null } = {}) {
  const now = new Date().toISOString();
  const dates = dateRange(startDate, endDate);
  const list = dates.length ? dates : [''];
  return {
    version: 1,
    id: uid(),
    title: title?.trim() || (destination ? t('{dest} 여행', { dest: destination }) : t('새 여행')),
    destination,
    startDate: dates[0] ?? '',
    endDate: dates.at(-1) ?? '',
    center,
    days: list.map((date) => ({ id: uid(), date, items: [] })),
    inbox: [],
    stays: [],
    flights: [],
    expenses: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function selectRangeDate({ start, activeField }, date) {
  if (activeField !== 'end' || !start || date < start) return { start: date, end: '', activeField: 'end' };
  return { start, end: date, activeField: null };
}

/** 날짜를 바꾸면 사라지는 날의 장소 수 (확인 메시지용). */
export function overflowCount(trip, start, end) {
  const n = dateRange(start, end).length;
  if (!n) return 0;
  return trip.days.slice(n).reduce((sum, d) => sum + d.items.length, 0);
}

/**
 * 날짜를 바꾸면 영향받는 것 (바꾸기 전에 보여주는 확인 창용).
 * { days: 새 일수, removedDays, places: 보관함으로 갈 장소, expenses: '일정 외'로 남을 지출,
 *   stays: 기간이 줄어 일부 밤이 빠지는 숙소, flights: 새로 기간 밖이 되는 항공편, shifted: 시작일이 바뀌어 일차 날짜가 달라짐 }
 */
export function dateChangeImpact(trip, start, end) {
  const dates = dateRange(start, end);
  const n = dates.length;
  if (!n) return null;
  const removed = trip.days.slice(n);
  const inside = (d, a, b) => Boolean(a) && d >= a && d <= b;
  return {
    days: n,
    removedDays: removed.length,
    places: removed.flatMap((d) => d.items),
    expenses: (trip.expenses ?? []).filter((e) => Number.isInteger(e.day) && e.day >= n && e.day < trip.days.length),
    stays: n < trip.days.length ? (trip.stays ?? []).filter((s) => s.startIndex + s.nights > n) : [],
    flights: (trip.flights ?? []).filter((f) => {
      const d = f.departAt.slice(0, 10);
      return inside(d, trip.startDate, trip.endDate) && !inside(d, dates[0], dates.at(-1));
    }),
    shifted: Boolean(trip.startDate) && dates[0] !== trip.startDate,
  };
}

/**
 * 날짜 변경. 기존 일차는 순서대로 유지하고, 줄어든 날의 장소는 보관함으로 옮긴다.
 * 줄어든 날의 지출은 지우지 않고 원래 날짜(expense.date)를 적어 둔다 → 가계부에 '일정 외'로 잡힌다.
 */
export function setTripDates(trip, start, end) {
  const dates = dateRange(start, end);
  if (!dates.length) return { moved: 0 };
  for (const e of trip.expenses ?? []) {
    if (Number.isInteger(e.day) && e.day >= dates.length && trip.days[e.day]?.date && !e.date) e.date = trip.days[e.day].date;
  }
  const leftover = trip.days.slice(dates.length).flatMap((d) => d.items);
  trip.days = dates.map((date, i) => (trip.days[i] ? { ...trip.days[i], date } : { id: uid(), date, items: [] }));
  trip.inbox.push(...leftover);
  trip.startDate = dates[0];
  trip.endDate = dates.at(-1);
  return { moved: leftover.length };
}

export function getList(trip, listId) {
  if (listId === INBOX) return trip.inbox;
  return trip.days.find((d) => d.id === listId)?.items ?? null;
}

export function findItem(trip, itemId) {
  const lists = [{ id: INBOX, items: trip.inbox }, ...trip.days];
  for (const l of lists) {
    const index = l.items.findIndex((it) => it.id === itemId);
    if (index !== -1) return { listId: l.id, list: l.items, index, item: l.items[index] };
  }
  return null;
}

/* ───────── 장소 종류 ─────────
 * 지도 핀을 "종류" 색으로 볼 때와 카드 아이콘에 쓴다. '' = 정하지 않음.
 */
/** 라벨은 번역 키다 (화면에서는 t(label)). */
export const CATEGORIES = {
  sight: { label: '관광', icon: '📸', color: '#8b5cf6' },
  food: { label: '맛집', icon: '🍜', color: '#ef4444' },
  cafe: { label: '카페', icon: '☕', color: '#b7791f' },
  shop: { label: '쇼핑', icon: '🛍️', color: '#0ea5e9' },
  etc: { label: '기타', icon: '📍', color: '#64748b' },
};
export const STAY_COLOR = '#14b8a6'; // 종류 보기에서 숙소 색

const FOOD = /^(restaurant|fast_food|food_court|bar|pub|biergarten|izakaya)$/;
const CAFE = /^(cafe|bakery|ice_cream|confectionery|pastry|tea|coffee|dessert)$/;
const SIGHT_KEYS = /^(tourism|historic|leisure|natural)$/;
const SIGHT = /^(place_of_worship|theatre|arts_centre|planetarium|marketplace|townhall|fountain|clock|cinema|library)$/;
const SKIP = /^(hotel|hostel|guest_house|motel|apartment|information|yes)$/;

/** OSM 태그(key/value, 예: amenity/restaurant)로 종류 추측. 모르면 ''. */
export function categoryFromTag(key, value) {
  const k = String(key ?? '');
  const v = String(value ?? '');
  if (FOOD.test(v)) return 'food';
  if (CAFE.test(v)) return 'cafe';
  if (k === 'shop' || /^(mall|department_store|marketplace_shop)$/.test(v)) return 'shop';
  if (SKIP.test(v)) return '';
  if (SIGHT_KEYS.test(k) || SIGHT.test(v)) return 'sight';
  return '';
}

/** "쇼핑·복합시설", "맛집거리" 같은 한국어 분류 문구로 종류 추측. */
export function categoryFromText(text) {
  const t = String(text ?? '');
  if (!t) return '';
  if (/카페|디저트|베이커리/.test(t)) return 'cafe';
  if (/맛집|음식|식당|라멘|스시|이자카야/.test(t)) return 'food';
  if (/쇼핑|백화점|아울렛|몰/.test(t)) return 'shop';
  if (/숙소|호텔/.test(t)) return '';
  return 'sight';
}

export function itemCategory(place) {
  if (CATEGORIES[place.category]) return place.category;
  return categoryFromTag(place.osmKey, place.kind);
}

export function createItem(place) {
  return {
    id: uid(),
    name: (place.name ?? '').trim() || t('이름 없는 장소'),
    address: place.address ?? '',
    lat: Number(place.lat),
    lng: Number(place.lng),
    time: place.time ?? '',
    memo: place.memo ?? '',
    url: place.url ?? '',
    category: itemCategory(place),
  };
}

export function addItem(trip, listId, place) {
  const list = getList(trip, listId) ?? trip.inbox;
  const item = createItem(place);
  list.push(item);
  return item;
}

export function removeItem(trip, itemId) {
  const found = findItem(trip, itemId);
  if (!found) return false;
  found.list.splice(found.index, 1);
  return true;
}

/** 항목을 다른 목록(또는 같은 목록)의 toIndex 위치로 옮긴다. toIndex는 옮긴 뒤의 최종 위치. */
export function moveItem(trip, itemId, toListId, toIndex) {
  const from = findItem(trip, itemId);
  const to = getList(trip, toListId);
  if (!from || !to) return false;
  const [item] = from.list.splice(from.index, 1);
  const i = Math.max(0, Math.min(Number.isInteger(toIndex) ? toIndex : to.length, to.length));
  to.splice(i, 0, item);
  return true;
}

/** 시간이 있는 장소를 시간순으로, 시간이 없는 장소는 원래 순서대로 뒤에 둔다. */
export function sortByTime(items) {
  const timed = items.filter((it) => it.time).sort((a, b) => a.time.localeCompare(b.time));
  const untimed = items.filter((it) => !it.time);
  items.splice(0, items.length, ...timed, ...untimed);
  return items;
}

/** "12월 1일 (화)" (지금 언어) */
export const formatDate = (date) => longDate(date);

export function dayTitle(day, index) {
  const date = formatDate(day.date);
  return date ? `${dayName(index)} · ${date}` : dayName(index);
}

export function googleMapsUrl(item) {
  return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
}

/** 링크 칸에 넣은 주소를 href로 써도 되는지 (http/https만). 공유받은 일정에 javascript: 같은 링크가 섞여도 막는다. */
export function safeUrl(url) {
  return /^https?:\/\//i.test(String(url ?? '').trim()) ? String(url).trim() : '';
}

/* ───────── 동선 / 거리 / 길찾기 ───────── */
const EARTH_KM = 6371;
/** 두 지점의 직선(대원) 거리 km */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** 이 거리(직선) 이하면 걸어가는 걸로 본다. */
export const WALK_MAX_KM = 1.2;
// 실제 길은 직선보다 25% 정도 길고, 걷는 속도는 시속 4.5km로 잡는다.
const DETOUR = 1.25;
const WALK_KMH = 4.5;

// 보폭 0.7m (성인 평균). 실제 길은 직선보다 25% 길다고 본다.
const STRIDE_M = 0.7;
/** 직선거리(km)를 걸었을 때 예상 걸음 수 (100걸음 단위) */
export function walkSteps(km) {
  return Math.round((km * DETOUR * 1000) / STRIDE_M / 100) * 100;
}

/** 하루 도보 이동 예상 걸음 수: 걸어갈 만한 구간(1.2km 이하)만 더한다. 대중교통 구간·관광지 안에서 걷는 건 뺀다. */
export function daySteps(trip, dayIndex) {
  const r = dayRoute(trip, dayIndex);
  let steps = 0;
  for (let i = 1; i < r.length; i++) steps += routeLeg(r[i - 1], r[i])?.steps ?? 0;
  return steps;
}

/** "3,200" */
export const formatSteps = (n) => num(Math.round(n));

/** 하루 동선: 출발 숙소 → 장소들 → 귀가 숙소. 지도 선·거리·길찾기가 모두 이 순서를 쓴다. */
export function dayRoute(trip, dayIndex) {
  const day = trip.days[dayIndex];
  if (!day) return [];
  const { start, end } = dayStays(trip, dayIndex);
  return [...(start ? [start] : []), ...day.items, ...(end ? [end] : [])];
}

/** 이웃한 두 지점 사이 구간. 같은 곳(50m 미만)이면 null. */
export function routeLeg(from, to) {
  const km = distanceKm(from, to);
  if (!(km >= 0.05)) return null;
  const walk = km <= WALK_MAX_KM;
  return {
    km,
    mode: walk ? 'walking' : 'transit',
    walkMin: walk ? Math.max(1, Math.round(((km * DETOUR) / WALK_KMH) * 60)) : null,
    steps: walk ? walkSteps(km) : 0,
    url: directionsUrl(from, to, walk ? 'walking' : 'transit'),
  };
}

/** "850m" / "3.4km" / "12km" */
export function formatKm(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10}m`;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

const ll = (p) => `${p.lat},${p.lng}`;

/** 구글맵 길찾기 (앱이 있으면 앱으로 열린다). mode: walking | transit | driving */
export function directionsUrl(from, to, mode = 'transit') {
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=${mode}`;
}

// 구글맵 URL은 경유지를 9곳까지만 받는다.
const MAX_WAYPOINTS = 9;
/** 하루 전체 동선을 구글맵 길찾기로 연다. 두 곳 미만이거나 경유지가 너무 많으면 null. */
export function routeDirectionsUrl(points) {
  // 같은 곳이 연달아 나오면 (예: 출발·귀가 숙소가 같고 장소가 없음) 하나로 친다.
  const pts = points.filter((p, i) => i === 0 || routeLeg(points[i - 1], p));
  if (pts.length < 2 || pts.length - 2 > MAX_WAYPOINTS) return null;
  const mid = pts.slice(1, -1).map(ll).join('|');
  // 대중교통 모드는 경유지를 지원하지 않아서 이동 수단은 구글맵이 고르게 둔다.
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(pts[0])}&destination=${ll(pts.at(-1))}${
    mid ? `&waypoints=${encodeURIComponent(mid)}` : ''
  }`;
}

/* ───────── 동선 자동 정리 ─────────
 * 하루 장소를 "가장 덜 돌아가는 순서"로 바꾼다. 출발 숙소 → 장소들 → 귀가 숙소 직선거리 합이 기준이다.
 * 시간을 정했거나 "순서 고정"(item.pinned)한 장소는 지금 자리(몇 번째)에 그대로 두고, 나머지만 다시 넣는다.
 */
// 시간이 없는 장소가 이 개수 이하면 모든 경우를 따져 최단 순서를 찾는다 (2^12 × 12 정도라 금방 끝난다).
const EXACT_MAX = 12;

/** 지점 목록을 차례로 이은 직선거리 합(km). null인 지점(숙소 없음)은 건너뛴다. */
export function pathKm(points) {
  const pts = points.filter(Boolean);
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += distanceKm(pts[i - 1], pts[i]);
  return km;
}

/** 시간 없는 장소들을 빈 자리에 넣어 전체 순서를 만든다. */
function fillSlots(items, freeSlots, freeOrder) {
  const out = items.slice();
  freeSlots.forEach((slot, k) => (out[slot] = freeOrder[k]));
  return out;
}

/** 모든 경우 비교 (자리 순서대로 채워 가며 "쓴 장소 묶음 + 마지막 장소"별 최단 거리만 남긴다). */
function exactOrder(items, freeSlots, start, end) {
  const free = freeSlots.map((s) => items[s]);
  const isFree = new Set(freeSlots);
  const d = (a, b) => (a && b ? distanceKm(a, b) : 0);
  // 상태 키: mask(쓴 장소) + 마지막 장소 번호(-1 = 아직 없음 / 고정 장소는 자리 번호로 표시)
  let layer = new Map([['0|s', { km: 0, last: start ?? null, mask: 0, path: [] }]]);
  for (let p = 0; p < items.length; p++) {
    const next = new Map();
    const put = (key, st) => {
      const old = next.get(key);
      if (!old || st.km < old.km) next.set(key, st);
    };
    for (const st of layer.values()) {
      if (!isFree.has(p)) {
        const it = items[p];
        put(`${st.mask}|f${p}`, { km: st.km + d(st.last, it), last: it, mask: st.mask, path: st.path });
        continue;
      }
      for (let k = 0; k < free.length; k++) {
        if (st.mask & (1 << k)) continue;
        const it = free[k];
        put(`${st.mask | (1 << k)}|${k}`, { km: st.km + d(st.last, it), last: it, mask: st.mask | (1 << k), path: [...st.path, k] });
      }
    }
    layer = next;
  }
  let best = null;
  for (const st of layer.values()) {
    const km = st.km + d(st.last, end);
    if (!best || km < best.km) best = { km, path: st.path };
  }
  return fillSlots(items, freeSlots, best.path.map((k) => free[k]));
}

/** 장소가 많을 때: 가까운 곳부터 잇고, 구간 뒤집기·자리 바꾸기로 더 줄어들지 않을 때까지 다듬는다. */
function approxOrder(items, freeSlots, start, end) {
  const cost = (order) => pathKm([start, ...fillSlots(items, freeSlots, order), end]);
  const improve = (order) => {
    let cur = order.slice();
    let curKm = cost(cur);
    for (let round = 0, better = true; better && round < 50; round++) {
      better = false;
      for (let i = 0; i < cur.length - 1; i++) {
        for (let j = i + 1; j < cur.length; j++) {
          const rev = [...cur.slice(0, i), ...cur.slice(i, j + 1).reverse(), ...cur.slice(j + 1)];
          const swap = cur.slice();
          [swap[i], swap[j]] = [swap[j], swap[i]];
          for (const cand of [rev, swap]) {
            const km = cost(cand);
            if (km < curKm - 1e-9) [cur, curKm, better] = [cand, km, true];
          }
        }
      }
    }
    return { order: cur, km: curKm };
  };
  // 출발점(숙소 또는 첫 장소)에서 가장 가까운 곳을 차례로 고른 순서
  const rest = freeSlots.map((s) => items[s]);
  const greedy = [];
  let at = start ?? rest[0];
  while (rest.length) {
    let bi = 0;
    rest.forEach((p, i) => distanceKm(at, p) < distanceKm(at, rest[bi]) && (bi = i));
    at = rest.splice(bi, 1)[0];
    greedy.push(at);
  }
  const a = improve(freeSlots.map((s) => items[s]));
  const b = improve(greedy);
  return fillSlots(items, freeSlots, (b.km < a.km ? b : a).order);
}

/**
 * 하루 동선 정리 제안 (trip은 바꾸지 않는다).
 * { items: 새 순서, beforeKm, afterKm, savedKm, changed, fixed: 시간 고정 장소 수, movable: 옮길 수 있는 장소 수 }
 */
export function optimizeDay(trip, dayIndex) {
  const day = trip.days[dayIndex];
  if (!day) return null;
  const items = day.items;
  const { start, end } = dayStays(trip, dayIndex);
  const freeSlots = items.map((it, i) => (it.time || it.pinned ? -1 : i)).filter((i) => i !== -1);
  const beforeKm = pathKm([start, ...items, end]);
  const base = { items: items.slice(), beforeKm, afterKm: beforeKm, savedKm: 0, changed: false, fixed: items.length - freeSlots.length, movable: freeSlots.length };
  if (freeSlots.length < 2) return base;
  const order = (freeSlots.length <= EXACT_MAX ? exactOrder : approxOrder)(items, freeSlots, start, end);
  const afterKm = pathKm([start, ...order, end]);
  // 10m도 안 줄면 지금 순서가 이미 좋은 것으로 본다.
  if (!(afterKm < beforeKm - 0.01) || order.every((it, i) => it === items[i])) return base;
  return { ...base, items: order, afterKm, savedKm: beforeKm - afterKm, changed: true };
}

/** 두 날의 장소를 통째로 바꾼다 (날짜·숙소·항공편은 날짜에 붙어 있어서 그대로). */
export function swapDays(trip, a, b) {
  const da = trip.days[a];
  const db = trip.days[b];
  if (!da || !db || a === b) return false;
  [da.items, db.items] = [db.items, da.items];
  return true;
}

/* ───────── 동선 제안 직접 고치기 ─────────
 * 시간을 정했거나 고정한 장소는 그 자리(몇 번째)에 그대로 두고, 나머지 장소끼리만 순서를 바꾼다 (optimizeDay와 같은 규칙).
 */
export const isFixedInRoute = (it) => Boolean(it?.time || it?.pinned);

/** index 자리 장소를 dir(-1 위 / +1 아래) 쪽의 가장 가까운 '옮길 수 있는 자리'로. 못 옮기면 -1. */
export function routeStepTarget(order, index, dir) {
  if (!order[index] || isFixedInRoute(order[index])) return -1;
  for (let j = index + dir; j >= 0 && j < order.length; j += dir) if (!isFixedInRoute(order[j])) return j;
  return -1;
}

/** 한 칸 옮긴 새 순서 (못 옮기면 null) */
export function routeStep(order, index, dir) {
  const j = routeStepTarget(order, index, dir);
  if (j === -1) return null;
  const out = order.slice();
  [out[index], out[j]] = [out[j], out[index]];
  return out;
}

/** 끌어서 바꾼 순서에서 옮길 수 있는 장소의 순서만 받아, 고정 장소는 원래 자리에 둔 새 순서 */
export function routeReorder(order, draggedOrder) {
  const free = draggedOrder.filter((it) => !isFixedInRoute(it));
  return order.map((it) => (isFixedInRoute(it) ? it : free.shift()));
}

/** 제안받은 순서(장소 id 목록)를 적용한다. 그사이 장소가 바뀌었으면(추가·삭제·이동) 적용하지 않고 false. */
export function applyDayOrder(trip, dayIndex, ids) {
  const day = trip.days[dayIndex];
  if (!day || ids.length !== day.items.length) return false;
  const byId = new Map(day.items.map((it) => [it.id, it]));
  const next = ids.map((id) => byId.get(id));
  if (next.some((it) => !it) || new Set(ids).size !== ids.length) return false;
  day.items.splice(0, day.items.length, ...next);
  return true;
}

/* ───────── 숙소 ─────────
 * stay = { id, name, address, lat, lng, url, memo, startIndex, nights }
 * startIndex일차 밤부터 nights박. "n일차 밤"은 n일차가 끝나고 자는 곳이다.
 * 같은 밤에 숙소가 겹치면 나중에 추가한 숙소가 이긴다.
 */
export const DEFAULT_NIGHTS = 2;

function clampNights(trip, startIndex, nights) {
  const max = Math.max(1, trip.days.length - startIndex);
  return Math.max(1, Math.min(Math.round(Number(nights) || DEFAULT_NIGHTS), max));
}

export function addStay(trip, place, startIndex = 0, nights = DEFAULT_NIGHTS) {
  trip.stays ??= [];
  const start = Math.max(0, Math.min(Math.round(Number(startIndex) || 0), trip.days.length - 1));
  const base = createItem(place);
  const stay = {
    id: base.id,
    name: base.name,
    address: base.address,
    lat: base.lat,
    lng: base.lng,
    url: base.url,
    memo: base.memo,
    startIndex: start,
    nights: clampNights(trip, start, nights),
  };
  trip.stays.push(stay);
  return stay;
}

export function findStay(trip, stayId) {
  return (trip.stays ?? []).find((s) => s.id === stayId) ?? null;
}

/** 체크인 일차·박 수를 바꾼다. 범위를 벗어나면 맞춰 준다. */
export function updateStayRange(trip, stayId, { startIndex, nights }) {
  const stay = findStay(trip, stayId);
  if (!stay) return null;
  if (startIndex != null) stay.startIndex = Math.max(0, Math.min(Number(startIndex), trip.days.length - 1));
  stay.nights = clampNights(trip, stay.startIndex, nights ?? stay.nights);
  return stay;
}

export function removeStay(trip, stayId) {
  const before = (trip.stays ?? []).length;
  trip.stays = (trip.stays ?? []).filter((s) => s.id !== stayId);
  return trip.stays.length !== before;
}

/** nightIndex일차 밤에 자는 숙소 (없으면 null). */
export function nightStay(trip, nightIndex) {
  const stays = trip.stays ?? [];
  for (let i = stays.length - 1; i >= 0; i--) {
    const s = stays[i];
    if (nightIndex >= s.startIndex && nightIndex < s.startIndex + s.nights) return s;
  }
  return null;
}

/**
 * 하루의 출발·귀가 숙소. 출발 = 전날 밤 숙소, 귀가 = 오늘 밤 숙소.
 * 첫날 출발(전날 밤 없음)과 마지막 날 귀가(오늘 밤 없음)만 다른 쪽 숙소로 채워 하루에 2개가 보이게 한다.
 * 여행 중간에 숙소가 빈 밤은 채우지 않는다 (아직 정하지 않은 숙소).
 */
export function dayStays(trip, dayIndex) {
  const prev = dayIndex > 0 ? nightStay(trip, dayIndex - 1) : null;
  const tonight = nightStay(trip, dayIndex);
  const date = trip.days[dayIndex]?.date;
  const flights = date ? flightsOnDate(trip, date) : [];
  // 첫날 비행기로 도착하면 하루가 공항에서 시작하고, 마지막 날 비행기를 타면 공항에서 끝난다.
  const isFirst = dayIndex === 0 && !flights.some((x) => x.role !== 'depart');
  const isLast = dayIndex === trip.days.length - 1 && !flights.some((x) => x.role !== 'arrive');
  return {
    start: prev ?? (isFirst ? tonight : null),
    end: tonight ?? (isLast ? prev : null),
    checkIn: Boolean(tonight && tonight !== prev),
    checkOut: Boolean(prev && prev !== tonight),
  };
}

/** 첫날 기준 i일 뒤의 날짜 ('YYYY-MM-DD', 날짜 없는 여행이면 ''). 여행 기간 밖도 계산한다. */
export function dateAtIndex(trip, i) {
  const first = parseDate(trip.days[0]?.date);
  if (!first) return '';
  const d = new Date(first);
  d.setUTCDate(d.getUTCDate() + i);
  return toISODate(d);
}

/** 날짜가 첫날로부터 며칠째인지 (0부터). 날짜를 읽을 수 없으면 null. */
export function indexOfDate(trip, date) {
  const first = parseDate(trip.days[0]?.date);
  const d = parseDate(date);
  if (!first || !d) return null;
  return Math.round((d - first) / 86400000);
}

/** 달력에서 고른 체크인·체크아웃 날짜를 {startIndex, nights}로 바꾼다. 여행 기간 안으로 맞춘다. */
export function rangeFromDates(trip, checkIn, checkOut) {
  const n = trip.days.length;
  let start = indexOfDate(trip, checkIn);
  if (start == null) return null;
  start = Math.max(0, Math.min(start, n - 1));
  const out = indexOfDate(trip, checkOut);
  const nights = out == null ? DEFAULT_NIGHTS : out - start;
  return { startIndex: start, nights: Math.max(1, Math.min(nights, n - start)) };
}

/** 체크인·체크아웃 날짜 ('YYYY-MM-DD', 날짜 없는 여행이면 ''). */
export function stayDates(trip, stay) {
  return { checkIn: dateAtIndex(trip, stay.startIndex), checkOut: dateAtIndex(trip, stay.startIndex + stay.nights) };
}

/** 장소 카드 복제: 원본 바로 아래에 같은 내용의 새 카드를 만든다. */
export function duplicateItem(trip, itemId) {
  const found = findItem(trip, itemId);
  if (!found) return null;
  const { visited, ...rest } = found.item; // 다녀온 표시는 복사하지 않는다 (결제 기록은 원본 id에 묶여 있다)
  const copy = { ...rest, id: uid() };
  found.list.splice(found.index + 1, 0, copy);
  return copy;
}

/* ───────── 항공편 ─────────
 * flight = { id, kind: 'out'|'in'|'move', flightNo, from, to, departAt, arriveAt, bookingRef, memo }
 * departAt / arriveAt: 'YYYY-MM-DDTHH:MM' (현지 시각, 사용자가 입력한 그대로)
 */
export const FLIGHT_KINDS = { out: '출국', in: '귀국', move: '이동' };
/** 화면에 보일 항공편 구분 */
export const flightKind = (kind) => t(FLIGHT_KINDS[kind] ?? FLIGHT_KINDS.out);

export function normalizeFlight(data) {
  const kind = FLIGHT_KINDS[data.kind] ? data.kind : 'out';
  const clean = (v) => String(v ?? '').trim();
  return {
    kind,
    flightNo: clean(data.flightNo).toUpperCase().replace(/\s+/g, ''),
    from: clean(data.from),
    to: clean(data.to),
    departAt: clean(data.departAt),
    arriveAt: clean(data.arriveAt),
    bookingRef: clean(data.bookingRef),
    memo: clean(data.memo),
  };
}

/** 저장 전 검사. 문제가 있으면 사용자에게 보여줄 문구, 없으면 null. */
export function flightProblem(data) {
  const f = normalizeFlight(data);
  const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!DATETIME.test(f.departAt)) return t('출발 날짜와 시간을 입력해 주세요');
  if (f.arriveAt && !DATETIME.test(f.arriveAt)) return t('도착 시간을 다시 확인해 주세요');
  if (!f.from || !f.to) return t('출발·도착 공항을 입력해 주세요');
  return null;
}

/**
 * 저장은 되지만 한 번 더 확인할 것. 현지 시각이라 날짜 변경선을 동쪽으로 넘으면(예: 인천 → 호놀룰루)
 * 도착이 출발보다 빠를 수 있어서 막지 않는다.
 */
export function flightWarning(data) {
  const f = normalizeFlight(data);
  if (f.arriveAt && f.arriveAt < f.departAt) return t('도착 시간이 출발보다 빨라요. 현지 시각 기준으로 다시 확인해 주세요');
  return null;
}

export function addFlight(trip, data) {
  trip.flights ??= [];
  const flight = { id: uid(), ...normalizeFlight(data) };
  trip.flights.push(flight);
  sortFlights(trip);
  return flight;
}

export function updateFlight(trip, id, data) {
  const f = (trip.flights ?? []).find((x) => x.id === id);
  if (!f) return null;
  Object.assign(f, normalizeFlight(data));
  sortFlights(trip);
  return f;
}

export function removeFlight(trip, id) {
  const before = (trip.flights ?? []).length;
  trip.flights = (trip.flights ?? []).filter((x) => x.id !== id);
  return trip.flights.length !== before;
}

function sortFlights(trip) {
  trip.flights.sort((a, b) => a.departAt.localeCompare(b.departAt));
}

/**
 * 그날 걸린 항공편. role: 'both'(같은 날 출발·도착), 'depart'(출발만), 'arrive'(밤 비행기 다음 날 도착).
 */
export function flightsOnDate(trip, date) {
  const out = [];
  for (const f of trip.flights ?? []) {
    const dep = f.departAt.slice(0, 10);
    const arr = (f.arriveAt || f.departAt).slice(0, 10);
    if (dep === date && arr === date) out.push({ flight: f, role: 'both' });
    else if (dep === date) out.push({ flight: f, role: 'depart' });
    else if (arr === date) out.push({ flight: f, role: 'arrive' });
  }
  return out;
}

/** "KE723 ICN 09:00 → KIX 11:10" */
export function flightSummary(f) {
  const t = (v) => (v ? v.slice(11, 16) : '');
  const from = [f.from, t(f.departAt)].filter(Boolean).join(' ');
  const to = [f.to, t(f.arriveAt)].filter(Boolean).join(' ');
  return [f.flightNo, `${from} → ${to}`].filter(Boolean).join(' ');
}

/** 현재 위치에서 그곳까지 구글맵 길찾기 (출발지를 비우면 구글맵이 내 위치를 쓴다) */
export function directionsFromHereUrl(to, mode = 'transit') {
  return `https://www.google.com/maps/dir/?api=1&destination=${ll(to)}&travelmode=${mode}`;
}

/**
 * 여행 당일 화면에 쓸 오늘 계획. 여행 기간이 아니면 null.
 * now = 'HH:MM' (기기 시각). 다음 장소 = 일정 순서대로 아직 안 다녀온 곳 중 첫 번째 (시간이 이미 지난 곳은 건너뛴다).
 * { dayIndex, items, nextId, stay: 오늘 밤 숙소(없으면 출발 숙소) }
 */
export function todayPlan(trip, today, now) {
  const i = indexOfDate(trip, today);
  if (i == null || i < 0 || i >= trip.days.length) return null;
  const items = trip.days[i].items;
  const next = items.find((it) => !it.visited && (!it.time || it.time >= now));
  const { start, end } = dayStays(trip, i);
  return { dayIndex: i, items, nextId: next?.id ?? null, stay: end ?? start ?? null };
}

/**
 * 카톡·메신저에 붙일 하루 일정 텍스트. 동행이 앱 없이 그날 계획을 볼 수 있게 한다.
 *   [오사카] Day 2 · 12월 1일 (화)
 *   09:00 출국 KE723 ICN 09:00 → KIX 11:00
 *   출발  난바 호텔
 *   1. 도톤보리
 *   12:00  2. 구로몬 시장 · 메모 첫 줄
 *   귀가  난바 호텔
 *   동선 지도 https://www.google.com/maps/dir/...
 */
export function dayShareText(trip, dayIndex) {
  const day = trip.days[dayIndex];
  if (!day) return '';
  const date = formatDate(day.date);
  const lines = [`[${trip.title}] ${dayName(dayIndex)}${date ? ` · ${date}` : ''}`];
  const { start, end } = dayStays(trip, dayIndex);
  const flights = day.date ? flightsOnDate(trip, day.date) : [];
  const flightLine = ({ flight: f, role }) => {
    const tm = (role === 'arrive' ? f.arriveAt : f.departAt).slice(11, 16);
    return `${tm ? `${tm} ` : ''}${flightKind(f.kind)} ${flightSummary(f)}`;
  };
  lines.push(...flights.filter((x) => x.flight.kind !== 'in').map(flightLine));
  if (start) lines.push(`${t('출발')}  ${start.name}`);
  day.items.forEach((it, i) => {
    const memo = String(it.memo ?? '').split('\n')[0].trim();
    lines.push(`${it.time ? `${it.time}  ` : ''}${i + 1}. ${it.name}${memo ? ` · ${memo}` : ''}`);
  });
  if (!day.items.length) lines.push(`(${t('아직 정한 곳이 없어요')})`);
  if (end) lines.push(`${t('귀가')}  ${end.name}`);
  lines.push(...flights.filter((x) => x.flight.kind === 'in').map(flightLine));
  const url = routeDirectionsUrl(dayRoute(trip, dayIndex));
  if (url) lines.push(`${t('동선 지도')} ${url}`);
  else if (day.items[0]) lines.push(`${t('지도')} ${googleMapsUrl(day.items[0])}`);
  return lines.join('\n');
}

/** 엑셀 열 (키는 한국어, 내보낼 때 t()로 바꾼다) */
export const EXPORT_HEADER = ['일차', '날짜', '순서', '시간', '종류', '장소', '주소', '메모', '링크', '구글맵', '위도', '경도'];

/** 엑셀 내보내기용 행 (헤더 이름을 키로 갖는 객체). */
export function tripToRows(trip) {
  const row = (dayLabel, date, order, it) => ({
    일차: dayLabel,
    날짜: date,
    순서: order,
    시간: it.time ?? '',
    종류: CATEGORIES[it.category] ? t(CATEGORIES[it.category].label) : it.stay ? t('숙소') : '',
    장소: it.name,
    주소: it.address,
    메모: it.memo,
    링크: it.url,
    구글맵: it.lat === '' ? '' : googleMapsUrl(it),
    위도: it.lat,
    경도: it.lng,
  });
  const rows = trip.days.flatMap((d, i) => {
    const { start, end } = dayStays(trip, i);
    const label = dayName(i);
    const fl = flightsOnDate(trip, d.date);
    const flightRow = ({ flight: f }) =>
      row(label, d.date, t('항공({kind})', { kind: flightKind(f.kind) }), {
        name: flightSummary(f),
        address: '',
        memo: [f.bookingRef && t('예약번호 {ref}', { ref: f.bookingRef }), f.memo].filter(Boolean).join(' / '),
        url: '',
        time: f.departAt.slice(0, 10) === d.date ? f.departAt.slice(11, 16) : (f.arriveAt || '').slice(11, 16),
        lat: '',
        lng: '',
      });
    return [
      ...fl.filter((x) => x.flight.kind !== 'in').map(flightRow),
      ...(start ? [row(label, d.date, t('숙소(출발)'), { ...start, stay: true })] : []),
      ...d.items.map((it, j) => row(label, d.date, j + 1, it)),
      ...(end ? [row(label, d.date, t('숙소(귀가)'), { ...end, stay: true })] : []),
      ...fl.filter((x) => x.flight.kind === 'in').map(flightRow),
    ];
  });
  rows.push(...trip.inbox.map((it, j) => row(t('보관함'), '', j + 1, it)));
  return rows;
}

export function safeFileName(name) {
  return (name || 'trip').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'trip';
}

export function touch(trip) {
  trip.updatedAt = new Date().toISOString();
}

/**
 * 백업 파일 검증. 올바르지 않으면 Error를 던진다.
 * 예전 버전 백업(숙소·항공·가계부·체크가 없는 것)도 받는다. 가계부·체크는 형식이 맞는 항목만 남긴다.
 */
export function validateTrip(obj) {
  const fail = (what) => {
    throw new Error(t('올바른 여행 백업 파일이 아니에요 ({what})', { what: t(what) }));
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('형식');
  if (typeof obj.id !== 'string' || typeof obj.title !== 'string') fail('id/title');
  if (!Array.isArray(obj.days) || !obj.days.length) fail('days');
  const checkItems = (items) => {
    if (!Array.isArray(items)) fail('items');
    for (const it of items) {
      if (typeof it?.id !== 'string' || typeof it.name !== 'string') fail('장소');
      if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) fail('좌표');
    }
  };
  for (const d of obj.days) {
    if (typeof d?.id !== 'string') fail('day id');
    checkItems(d.items);
  }
  checkItems(obj.inbox ?? []);
  checkItems(obj.stays ?? []);
  for (const st of obj.stays ?? []) {
    if (!Number.isInteger(st.startIndex) || !Number.isInteger(st.nights) || st.nights < 1) fail('숙소 기간');
  }
  for (const fl of obj.flights ?? []) {
    if (typeof fl?.id !== 'string' || typeof fl.departAt !== 'string') fail('항공편');
  }
  const out = { ...obj, inbox: obj.inbox ?? [], stays: obj.stays ?? [], flights: obj.flights ?? [] };
  if (obj.expenses != null) {
    if (!Array.isArray(obj.expenses)) fail('가계부');
    out.expenses = obj.expenses.filter((e) => typeof e?.id === 'string' && Number.isFinite(Number(e.amount)));
  }
  if (obj.checks != null) {
    if (!Array.isArray(obj.checks)) fail('체크리스트');
    out.checks = obj.checks.filter((c) => typeof c?.id === 'string' && typeof c.text === 'string');
  }
  if (obj.budget != null && (typeof obj.budget !== 'object' || Array.isArray(obj.budget))) fail('가계부');
  return out;
}

/* ───────── 대시보드 (상단 요약) ───────── */

/** 출발까지 남은 날: { label: 'D-4' | 'D-DAY' | 'Day 2' | '다녀옴', sub } */
export function ddayInfo(trip, today) {
  const start = parseDate(trip.startDate);
  const end = parseDate(trip.endDate);
  const now = parseDate(today);
  if (!start || !now) return { label: '—', sub: t('날짜 미정') };
  const diff = Math.round((start - now) / 86400000);
  if (diff > 0) return { label: `D-${diff}`, sub: t('출발까지') };
  if (diff === 0) return { label: 'D-DAY', sub: t('오늘 출발') };
  const day = Math.round((now - start) / 86400000);
  if (end && now <= end) return { label: dayName(day), sub: t('여행 중') };
  return { label: t('다녀옴'), sub: t('여행 끝') };
}

/** 이미 다녀온 여행인지 (끝난 날 다음부터) */
export const tripEnded = (trip, today) => Boolean(trip.endDate) && trip.endDate < today;

/** 오늘이 여행 중이면 그날 인덱스, 아니면 0 */
export function todayIndex(trip, today) {
  const i = indexOfDate(trip, today);
  return i != null && i >= 0 && i < trip.days.length ? i : 0;
}

/** 하루 동선 거리(직선, km) */
export function dayKm(trip, dayIndex) {
  const r = dayRoute(trip, dayIndex);
  let km = 0;
  for (let i = 1; i < r.length; i++) km += distanceKm(r[i - 1], r[i]);
  return km;
}

export function tripStats(trip, today) {
  const places = trip.days.reduce((s, d) => s + d.items.length, 0);
  const km = trip.days.reduce((s, _, i) => s + dayKm(trip, i), 0);
  const n = trip.days.length;
  return {
    dday: ddayInfo(trip, today),
    length: tripLength(n),
    days: n,
    places,
    km,
    steps: trip.days.reduce((s, _, i) => s + daySteps(trip, i), 0),
  };
}

/** 하루 요약: 제목(장소 이름 이어 붙이기), 장소 수, 거리, 시간 범위 */
export function daySummary(trip, dayIndex) {
  const day = trip.days[dayIndex];
  if (!day) return null;
  const times = day.items.map((it) => it.time).filter(Boolean).sort();
  return {
    title: day.items.map((it) => it.name).join(' · '),
    places: day.items.length,
    km: dayKm(trip, dayIndex),
    steps: daySteps(trip, dayIndex),
    from: times[0] ?? '',
    to: times.at(-1) ?? '',
  };
}

/** 확인할 것 (상단 알림): 숙소가 빈 밤, 여행 기간 밖 항공편 */
export function tripNotices(trip) {
  const out = [];
  const n = trip.days.length;
  const lastFlightIn = (trip.flights ?? []).some((f) => f.kind === 'in' && f.departAt.slice(0, 10) === trip.endDate);
  const empty = [];
  for (let i = 0; i < n - 1; i++) if (!nightStay(trip, i)) empty.push(i + 1);
  // 마지막 밤은 귀국편이 없을 때만 (당일 귀국이면 숙소가 필요 없다)
  if (n > 1 && !lastFlightIn && !nightStay(trip, n - 1) && (trip.flights ?? []).some((f) => f.kind === 'in')) empty.push(n);
  if (empty.length && (trip.stays ?? []).length) out.push(t('{days} 밤 숙소가 아직 비어 있어요', { days: empty.map((d) => dayName(d - 1)).join(', ') }));
  else if (!(trip.stays ?? []).length && n > 1) out.push(t('숙소를 아직 정하지 않았어요. 검색할 때 "추가할 곳"을 숙소로 고르세요'));
  const outside = (trip.flights ?? []).filter((f) => trip.startDate && (f.departAt.slice(0, 10) < trip.startDate || f.departAt.slice(0, 10) > trip.endDate));
  if (outside.length) out.push(t('여행 기간 밖 항공편 {n}개는 일정에 안 보여요', { n: outside.length }));
  return out;
}
