// 여행 데이터 모델. 브라우저와 Node 테스트에서 같이 쓰는 순수 함수만 둔다.
// trip = { id, title, destination, startDate, endDate, center, days: [{id, date, items}], inbox: [items] }
// item = { id, name, address, lat, lng, time, memo, url, category }

import { t, longDate, dayName, tripLength } from './i18n.js';
import { checkTripLimits } from './limits.js';

export const INBOX = 'inbox';
export const MAX_DAYS = 60;

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

/** 'YYYY-MM-DD' + n일 (읽을 수 없으면 '') */
export function addDays(date, n) {
  const d = parseDate(date);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

/**
 * 날짜 기준 유지(P0-9)에서 기존 일차 i가 옮겨 가는 새 일차 번호의 차이 k (새 일차 = i + k).
 * 시작일을 k일 앞당기면 +k, 늦추면 -k. 날짜 없는 여행이면 null → 일차 기준으로 바꾼다.
 */
export function dateShift(trip, start) {
  const a = parseDate(trip.days[0]?.date);
  const b = parseDate(start);
  if (!a || !b || !trip.startDate) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * 여행 기간 밖 날짜(숙소 체크인~체크아웃, 항공편 날짜)를 담도록 늘린 기간 { start, end }. 이미 안이면 null.
 * checkout: true면 to는 체크아웃 날이라 그 전날 밤까지만 여행에 들어오면 된다.
 */
export function extendedRange(trip, from, to = from, { checkout = false } = {}) {
  if (!parseDate(from)) return null;
  const last = checkout && parseDate(to) ? addDays(to, -1) : to || from;
  const start = !trip.startDate || from < trip.startDate ? from : trip.startDate;
  const end = !trip.endDate || last > trip.endDate ? last : trip.endDate;
  if (start === trip.startDate && end === trip.endDate) return null;
  // 최대 일수를 넘으면 늘리지 않는다 (늘리면 끝쪽 날이 잘려 일정이 보관함으로 밀린다)
  const days = Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
  return { start, end, tooLong: days > MAX_DAYS };
}

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
export function dateChangeImpact(trip, start, end, { keepDates = false } = {}) {
  const dates = dateRange(start, end);
  const n = dates.length;
  if (!n) return null;
  // keepDates(P0-9 날짜 기준 유지): 기존 일차 i는 새 일차 i+k로 간다 (일차 기준이면 k = 0)
  const k = (keepDates ? dateShift(trip, start) : null) ?? 0;
  const out = (i) => i + k < 0 || i + k >= n;
  const removed = trip.days.filter((_, i) => out(i));
  const inside = (d, a, b) => Boolean(a) && d >= a && d <= b;
  return {
    days: n,
    removedDays: removed.length,
    places: removed.flatMap((d) => d.items),
    expenses: (trip.expenses ?? []).filter((e) => Number.isInteger(e.day) && e.day >= 0 && e.day < trip.days.length && !e.date && out(e.day)),
    stays: (trip.stays ?? []).filter((s) => s.startIndex + k < 0 || s.startIndex + s.nights + k > n),
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
export function setTripDates(trip, start, end, { keepDates = false } = {}) {
  const dates = dateRange(start, end);
  if (!dates.length) return { moved: 0 };
  const n = dates.length;
  // 날짜 기준 유지(P0-9): 시작일을 k일 앞당기면 앞에 빈 날 k개, 일차·숙소·지출 번호 +k (늦추면 반대)
  const k = (keepDates ? dateShift(trip, start) : null) ?? 0;
  const old = trip.days;
  for (const e of trip.expenses ?? []) {
    if (!Number.isInteger(e.day) || e.day < 0 || e.date) continue;
    const j = e.day + k;
    if (j >= 0 && j < n) e.day = j;
    else if (old[e.day]?.date) e.date = old[e.day].date; // 잘려 나간 날: '일정 외'
  }
  const leftover = old.filter((_, i) => i + k < 0 || i + k >= n).flatMap((d) => d.items);
  trip.days = dates.map((date, j) => (old[j - k] ? { ...old[j - k], date } : { id: uid(), date, items: [] }));
  trip.inbox.push(...leftover);
  if (k) {
    // 숙소: 남는 밤만 두고, 남는 밤이 없으면 보관함 장소로 (지우지 않는다)
    const keep = [];
    for (const s of trip.stays ?? []) {
      const a = Math.max(0, s.startIndex + k);
      const b = Math.min(n, s.startIndex + s.nights + k);
      if (b > a) keep.push(Object.assign(s, { startIndex: a, nights: b - a }));
      else {
        const { startIndex: _s, nights: _n, ...place } = s;
        trip.inbox.push({ time: '', category: '', ...place });
        leftover.push(place);
      }
    }
    trip.stays = keep;
  }
  trip.startDate = dates[0];
  trip.endDate = dates.at(-1);
  // '일정 외'로 남겨 둔 지출은 원래 날짜가 다시 여행 기간에 들어올 때만 그날로 돌아간다 (일차 번호로 붙이지 않는다)
  for (const e of trip.expenses ?? []) {
    if (!e.date) continue;
    const i = dates.indexOf(e.date);
    if (i >= 0) {
      e.day = i;
      delete e.date;
    }
  }
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
    closedWeekdays: [...(place.closedWeekdays ?? [])],
    opensAt: place.opensAt ?? '',
    closesAt: place.closesAt ?? '',
    memo: place.memo ?? '',
    url: place.url ?? '',
    category: itemCategory(place),
    // 내장 프리셋(샘플 일정 등)만 4개 국어 이름을 함께 가진다. 사용자가 고친 이름은 덮어쓰지 않는다.
    ...(isI18nMap(place.nameI18n) ? { nameI18n: { ...place.nameI18n } } : {}),
  };
}

const PRESET_LANGS = ['ko', 'en', 'zh', 'ja'];
const isI18nMap = (m) => Boolean(m) && typeof m === 'object' && PRESET_LANGS.every((l) => typeof m[l] === 'string' && m[l]);
/** 프리셋 문구가 아직 원문(어느 언어든 프리셋 값 그대로)이면 지금 언어로 바꾼다. 사용자가 고친 값이면 그대로 둔다. */
const localizeField = (value, map, lang) => (isI18nMap(map) && Object.values(map).includes(value) ? map[lang] : value);

/**
 * 내장 프리셋 데이터(샘플 여행 제목·도시, 장소 이름)를 지금 언어로 맞춘다. 바뀐 것이 있으면 true.
 * 프리셋은 { ko, en, zh, ja } 맵으로 저장하고, 사용자가 직접 고친 문자열은 원문 그대로 둔다.
 */
export function localizePresets(trip, lang) {
  // isUserModified === true: 샘플을 사용자가 고친 여행. 화면 글자만 번역하고 여행 내용은 그대로 둔다.
  if (!trip || !PRESET_LANGS.includes(lang) || trip.isUserModified === true) return false;
  let changed = false;
  const set = (obj, key, map) => {
    const next = localizeField(obj[key], map, lang);
    if (next !== obj[key]) {
      obj[key] = next;
      changed = true;
    }
  };
  if (trip.presetI18n) {
    set(trip, 'title', trip.presetI18n.title);
    set(trip, 'destination', trip.presetI18n.destination);
  }
  for (const list of [...(trip.days ?? []).map((d) => d.items), trip.inbox ?? []]) {
    for (const it of list) if (it.nameI18n) set(it, 'name', it.nameI18n);
  }
  for (const st of trip.stays ?? []) if (st.nameI18n) set(st, 'name', st.nameI18n);
  return changed;
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

/**
 * 끌어서 옮긴 장소의 시간이 새 자리의 앞뒤 시간과 어긋나면 맞춘다.
 * 앞 장소(시간 있는 것) + 30분, 그게 다음 시간과 같거나 늦으면 둘의 가운데(5분 단위), 자리가 없으면 시간을 비운다.
 * → 바뀌면 { from, to } (to가 ''이면 비움), 순서가 맞거나 시간이 없으면 null
 */
export function fitMovedTime(items, index) {
  const item = items[index];
  const own = toMinutes(item?.time ?? '');
  if (own == null) return null;
  const prev = items.slice(0, index).map((it) => toMinutes(it.time ?? '')).filter((m) => m != null).at(-1) ?? null;
  const next = items.slice(index + 1).map((it) => toMinutes(it.time ?? '')).find((m) => m != null) ?? null;
  if ((prev == null || prev <= own) && (next == null || own <= next)) return null;
  const round5 = (m) => Math.round(m / 5) * 5;
  let to = prev != null ? prev + 30 : next - 30;
  if (next != null && prev != null && to >= next) to = round5((prev + next) / 2);
  const fits = to >= 0 && to <= 23 * 60 + 55 && (prev == null || to > prev) && (next == null || to < next);
  const hhmm = fits ? `${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}` : '';
  const from = item.time;
  item.time = hhmm;
  return { from, to: hhmm };
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

function stayFields(stay) {
  return {
    checkInTime: stay.checkInTime ?? '',
    checkOutTime: stay.checkOutTime ?? '',
    bookingRef: stay.bookingRef ?? '',
    phone: stay.phone ?? '',
    price: stay.price ?? null,
    cur: stay.cur ?? 'local',
  };
}

export function addStay(trip, place, startIndex = 0, nights = DEFAULT_NIGHTS) {
  // 샘플 숙소 같은 내장 프리셋만 4개 국어 이름을 가진다 (localizePresets)
  const i18n = isI18nMap(place.nameI18n) ? { nameI18n: { ...place.nameI18n } } : {};
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
    ...stayFields(place),
    ...i18n,
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
  const flights = flightsForDay(trip, dayIndex);
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

/**
 * P0-2: 여행 기간 밖 날짜의 출국·귀국편은 날짜가 아니라 종류로 붙인다.
 * 'first' = 출국편 → Day 1 맨 위, 'last' = 귀국편 → 마지막 날 맨 아래. 이동편이나 기간 안 항공편은 null(날짜로 붙임).
 */
export function pinnedFlight(trip, f) {
  if (!trip.startDate || !trip.endDate || f.kind === 'move') return null;
  const inside = (d) => d >= trip.startDate && d <= trip.endDate;
  const dep = f.departAt.slice(0, 10);
  const arr = (f.arriveAt || f.departAt).slice(0, 10);
  if (inside(dep) || inside(arr)) return null;
  return f.kind === 'in' ? 'last' : 'first';
}

/**
 * 그 일차에 보일 항공편 (출발 시각순). flightsOnDate + 종류로 붙인 출국·귀국편(role 'pinned', offset = 출발일 - 그날, 일 단위).
 * pinned 항공편은 그날 시간 범위(도착 후·출발 전)에 영향을 주지 않는다.
 */
export function flightsForDay(trip, dayIndex) {
  const date = trip.days[dayIndex]?.date;
  if (!date) return [];
  const out = flightsOnDate(trip, date)
    .filter(({ flight }) => !pinnedFlight(trip, flight))
    .map((x) => {
      // 전날 밤 출발해 그날 도착하는 비행기: 도착 시각은 그대로 쓰고 "전날 출발"을 함께 보여 준다
      const dep = x.flight.departAt.slice(0, 10);
      return x.role === 'arrive' && dep < date ? { ...x, offset: Math.round((parseDate(dep) - parseDate(date)) / 86400000) } : x;
    });
  const last = trip.days.length - 1;
  for (const f of trip.flights ?? []) {
    const p = pinnedFlight(trip, f);
    if ((p === 'first' && dayIndex === 0) || (p === 'last' && dayIndex === last)) {
      out.push({ flight: f, role: 'pinned', offset: Math.round((parseDate(f.departAt.slice(0, 10)) - parseDate(date)) / 86400000) });
    }
  }
  return out.sort((a, b) => (a.flight.departAt < b.flight.departAt ? -1 : a.flight.departAt > b.flight.departAt ? 1 : 0));
}

/** pinned 항공편 배지: "전날 출발" · "다음 날 출발" · "11/22 출발" */
export function pinnedFlightNote(x) {
  if (x.offset === -1) return t('전날 출발');
  if (x.offset === 1) return t('다음 날 출발');
  return t('{date} 출발', { date: formatDate(x.flight.departAt.slice(0, 10)) });
}

/** 그날 장소가 들어갈 시간 범위: after = 그날 도착한 비행기의 도착 시각, before = 그날 떠나는 귀국편 출발 시각 */
export function flightTimeBounds(flights) {
  const hhmm = (v) => (v ? String(v).slice(11, 16) : '');
  const after = flights.filter(({ flight, role }) => flight.kind !== 'in' && (role === 'both' || role === 'arrive')).map(({ flight }) => hhmm(flight.arriveAt)).filter(Boolean).sort().at(-1) ?? '';
  const before = flights.filter(({ flight, role }) => flight.kind === 'in' && (role === 'both' || role === 'depart')).map(({ flight }) => hhmm(flight.departAt)).filter(Boolean).sort()[0] ?? '';
  return { after, before };
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
  const flights = flightsForDay(trip, dayIndex);
  const flightLine = (x) => {
    const { flight: f, role } = x;
    const tm = (role === 'arrive' ? f.arriveAt : f.departAt).slice(11, 16);
    return `${tm ? `${tm} ` : ''}${flightKind(f.kind)} ${flightSummary(f)}${role === 'pinned' ? ` (${pinnedFlightNote(x)})` : ''}`;
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
    const fl = flightsForDay(trip, i);
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
      if (it.closedWeekdays != null && (!Array.isArray(it.closedWeekdays) ||
        it.closedWeekdays.length > 7 || it.closedWeekdays.some((n) => !Number.isInteger(n) || n < 0 || n > 6))) fail('장소');
      for (const time of [it.opensAt, it.closesAt]) {
        if (time != null && time !== '' && (typeof time !== 'string' || toMinutes(time) == null)) fail('장소');
      }
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
    for (const value of [st.checkInTime, st.checkOutTime]) {
      if (value != null && (typeof value !== 'string' || (value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))) fail('숙소');
    }
    for (const value of [st.bookingRef, st.phone]) {
      if (value != null && (typeof value !== 'string' || value.length > 200)) fail('숙소');
    }
    if (st.price != null && (!Number.isFinite(st.price) || st.price < 0)) fail('숙소');
    if (st.cur != null && st.cur !== 'local' && st.cur !== 'KRW') fail('숙소');
  }
  // 항공편: 시각 칸은 'YYYY-MM-DDTHH:MM' 글자여야 화면이 깨지지 않는다 (예전 백업에서 빠진 칸만 기본값)
  const isTime = (v) => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(v));
  for (const fl of obj.flights ?? []) {
    if (typeof fl?.id !== 'string' || !isTime(fl.departAt) || !fl.departAt) fail('항공편');
    if (fl.arriveAt != null && !isTime(fl.arriveAt)) fail('항공편');
    for (const key of ['kind', 'flightNo', 'from', 'to', 'bookingRef', 'memo']) if (fl[key] != null && typeof fl[key] !== 'string') fail('항공편');
  }
  if (obj.expenses != null && !Array.isArray(obj.expenses)) fail('가계부');
  checkTripLimits(obj); // S-5: 개수·글자 수 제한 (넘으면 저장 전에 멈춘다)
  // 예전 버전 백업은 메모·주소 같은 칸이 없을 수 있다: 빈 글자로 채워 화면이 깨지지 않게
  const str = (v) => (typeof v === 'string' ? v : '');
  const fillItem = (it) => ({
    ...it, address: str(it.address), time: str(it.time), memo: str(it.memo), url: str(it.url), category: str(it.category),
    closedWeekdays: [...new Set(it.closedWeekdays ?? [])], opensAt: str(it.opensAt), closesAt: str(it.closesAt),
  });
  const out = {
    ...obj,
    days: obj.days.map((d) => ({ ...d, date: str(d.date), items: d.items.map(fillItem) })),
    inbox: (obj.inbox ?? []).map(fillItem),
    stays: (obj.stays ?? []).map((st) => ({ ...st, ...stayFields(st), address: str(st.address), memo: str(st.memo), url: str(st.url) })),
    flights: (obj.flights ?? []).map((f) => ({ kind: 'out', flightNo: '', from: '', to: '', arriveAt: '', bookingRef: '', memo: '', ...f })),
  };
  const dropped = { expenses: 0, checks: 0 };
  if (obj.expenses != null) {
    if (!Array.isArray(obj.expenses)) fail('가계부');
    out.expenses = obj.expenses.filter((e) => typeof e?.id === 'string' && Number.isFinite(Number(e.amount)));
    dropped.expenses = obj.expenses.length - out.expenses.length;
  }
  if (obj.checks != null) {
    if (!Array.isArray(obj.checks)) fail('체크리스트');
    out.checks = obj.checks.filter((c) => typeof c?.id === 'string' && typeof c.text === 'string');
    dropped.checks = obj.checks.length - out.checks.length;
  }
  if (obj.budget != null && (typeof obj.budget !== 'object' || Array.isArray(obj.budget))) fail('가계부');
  // 읽지 못해 뺀 기록 수 (저장되는 데이터에는 넣지 않는다). 있으면 덮어쓰기 대신 사본으로만 가져온다.
  Object.defineProperty(out, 'dropped', { value: dropped, enumerable: false });
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
    from: times[0] ?? '',
    to: times.at(-1) ?? '',
  };
}

/** 일차 번호(0부터) 목록 → "Day 3–Day 19, Day 21" (이어진 날은 범위로) */
export function dayRanges(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    const b = sorted[i];
    parts.push(a === b ? dayName(a) : b === a + 1 ? `${dayName(a)}, ${dayName(b)}` : `${dayName(a)}–${dayName(b)}`);
  }
  return parts.join(', ');
}

/** 숙소가 필요한데 아직 비어 있는 밤의 일차 번호 (0부터). */
export function uncoveredStayNights(trip) {
  const n = trip.days.length;
  const returnFlights = (trip.flights ?? []).filter((f) => f.kind === 'in');
  const lastFlightIn = returnFlights.some((f) => f.departAt.slice(0, 10) === trip.endDate);
  const empty = [];
  for (let i = 0; i < n - 1; i++) if (!nightStay(trip, i)) empty.push(i);
  // 귀국편이 다른 날이면 여행 기간 마지막 밤도 확인한다.
  if (n > 1 && !lastFlightIn && !nightStay(trip, n - 1) && returnFlights.length) empty.push(n - 1);
  return empty;
}

/** 확인할 것 (상단 알림): 숙소가 빈 밤, 여행 기간 밖 항공편 */
export function tripNotices(trip) {
  const out = [];
  const empty = uncoveredStayNights(trip);
  // P1-6: 하나씩 나열하지 않고 범위로 묶는다 — "Day 3–Day 19 밤 숙소 미정 (17박)"
  if (empty.length && (trip.stays ?? []).length) out.push(t('{days} 밤 숙소 미정 ({n}박)', { days: dayRanges(empty), n: empty.length }));
  else if (empty.length) out.push(t('숙소를 아직 정하지 않았어요'));
  // 출국·귀국편은 기간 밖이어도 Day 1·마지막 날에 붙는다 (P0-2). 일정에 안 보이는 것은 기간 밖 이동편뿐
  const outside = (trip.flights ?? []).filter((f) => f.kind === 'move' && trip.startDate && (f.departAt.slice(0, 10) < trip.startDate || f.departAt.slice(0, 10) > trip.endDate));
  if (outside.length) out.push(t('여행 기간 밖 항공편 {n}개는 일정에 안 보여요', { n: outside.length }));
  return out;
}

/* ───────── 외부 지도 길찾기 (구글·애플, 중국 본토는 고덕·바이두 추가) ───────── */

/** 중국 본토인지 (홍콩·마카오·대만 제외). 나라 코드가 있으면 그것을, 없으면 좌표로 어림한다. */
export function inMainlandChina(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  const { lat, lng } = p;
  if (lat < 18 || lat > 53.6 || lng < 73.5 || lng > 135) return false;
  if (lat > 22.13 && lat < 22.57 && lng > 113.5 && lng < 114.45) return false; // 홍콩·마카오
  if (lat > 21.8 && lat < 25.4 && lng > 119.9 && lng < 122.1) return false; // 대만
  if (lat > 37.5 && lng > 124.6) return false; // 한반도·일본 쪽
  if (lat < 22.5 && lng > 102 && lng < 108) return false; // 베트남 북부
  if ((lat > 46.5 && lng > 87.7 && lng < 116) || (lat > 42.6 && lng > 96 && lng < 111.5)) return false; // 몽골 (나라 코드가 없을 때의 어림값)
  return true;
}
/** 여행이 중국 본토인가: 여행 나라 코드 → 여행지 중심 좌표 */
export function tripInMainlandChina(trip) {
  if (trip?.country) return trip.country === 'cn';
  return inMainlandChina(trip?.center);
}

// WGS-84(GPS) → GCJ-02(중국 지도 좌표). 고덕지도는 GCJ-02를 쓰므로 그대로 넣으면 수백 m 어긋난다.
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function gcjDelta(lat, lng) {
  const x = lng - 105;
  const y = lat - 35;
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  dLat += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  dLat += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  dLat += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dLng += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  dLng += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  dLng += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  const rad = (lat / 180) * Math.PI;
  const magic = 1 - GCJ_EE * Math.sin(rad) ** 2;
  const sq = Math.sqrt(magic);
  return {
    lat: (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sq)) * Math.PI),
    lng: (dLng * 180) / ((GCJ_A / sq) * Math.cos(rad) * Math.PI),
  };
}
export function wgsToGcj(p) {
  if (!inMainlandChina(p)) return { lat: p.lat, lng: p.lng };
  const d = gcjDelta(p.lat, p.lng);
  return { lat: p.lat + d.lat, lng: p.lng + d.lng };
}
const fix6 = (n) => Number(n.toFixed(6));

/**
 * 장소까지 외부 지도 길찾기 링크. from(직전 장소)이 있으면 출발지로 넣는다.
 * → [{ id: 'google'|'apple'|'amap'|'baidu', label, url }]
 */
export function directionsLinks(to, from = null, { china = false, korea = false, mode = 'transit' } = {}) {
  const has = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  if (!has(to)) return [];
  const origin = has(from) && routeLeg(from, to) ? from : null;
  const out = [
    { id: 'google', label: 'Google Maps', url: origin ? directionsUrl(origin, to, mode) : `https://www.google.com/maps/dir/?api=1&destination=${ll(to)}&travelmode=${mode}` },
    { id: 'apple', label: 'Apple Maps', url: `https://maps.apple.com/?${origin ? `saddr=${ll(origin)}&` : ''}daddr=${ll(to)}&dirflg=r` },
  ];
  if (china) {
    const name = (p) => encodeURIComponent(String(p.name ?? '').replace(/,/g, ' ').slice(0, 40));
    const g = (p) => {
      const c = wgsToGcj(p);
      return `${fix6(c.lng)},${fix6(c.lat)},${name(p)}`;
    };
    const amapMode = mode === 'walking' ? 'walk' : mode === 'driving' ? 'car' : 'bus';
    out.push({ id: 'amap', label: '高德地图', url: `https://uri.amap.com/navigation?${origin ? `from=${g(origin)}&` : ''}to=${g(to)}&mode=${amapMode}&src=xenotravel&callnative=1` });
    const b = (p) => `latlng:${p.lat},${p.lng}|name:${name(p)}`;
    out.push({
      id: 'baidu',
      label: '百度地图',
      url: origin
        ? `https://api.map.baidu.com/direction?origin=${b(origin)}&destination=${b(to)}&mode=transit&region=${name(to) || 'China'}&coord_type=wgs84&output=html&src=xenotravel`
        : `https://api.map.baidu.com/marker?location=${to.lat},${to.lng}&title=${name(to)}&content=${name(to)}&coord_type=wgs84&output=html&src=xenotravel`,
    });
  }
  if (korea) {
    const name = (p) => encodeURIComponent(String(p.name ?? '').replace(/[,/]/g, ' '));
    const naverPoint = (p) => `${p.lng},${p.lat},${name(p)},,PLACE_POI`;
    const naverMode = mode === 'walking' ? 'walk' : mode === 'driving' ? 'car' : 'transit';
    out.push({ id: 'naver', label: 'Naver Map', url: origin
      ? `https://map.naver.com/p/directions/${naverPoint(origin)}/${naverPoint(to)}/-/${naverMode}`
      : `https://map.naver.com/p/search/${name(to) || encodeURIComponent(ll(to))}` });
    const kakaoPoint = (p) => `${name(p)},${ll(p)}`;
    const kakaoMode = mode === 'walking' ? 'foot' : 'car';
    out.push({ id: 'kakao', label: 'Kakao Map', url: origin
      ? mode === 'transit'
        ? `https://map.kakao.com/link/from/${kakaoPoint(origin)}/to/${kakaoPoint(to)}`
        : `https://map.kakao.com/link/by/${kakaoMode}/${kakaoPoint(origin)}/${kakaoPoint(to)}`
      : `https://map.kakao.com/link/to/${kakaoPoint(to)}` });
  }
  return out;
}

export const DIRECTIONS_APPS = Object.freeze({
  google: 'Google Maps', apple: 'Apple Maps', amap: '高德地图', baidu: '百度地图',
  naver: 'Naver Map', kakao: 'Kakao Map',
});

export function tripDirectionsLinks(trip, to, from, preference, mode) {
  const china = tripInMainlandChina(trip);
  const korea = trip?.country === 'kr';
  const primary = Object.hasOwn(DIRECTIONS_APPS, preference) ? preference : china ? 'amap' : korea ? 'naver' : 'google';
  const links = directionsLinks(to, from, {
    china: china || primary === 'amap' || primary === 'baidu',
    korea: korea || primary === 'naver' || primary === 'kakao',
    mode,
  });
  const order = [primary, ...(korea ? ['naver', 'kakao'] : china ? ['amap', 'baidu'] : []), 'google', 'apple'];
  return [...new Set(order)].map((id) => links.find((link) => link.id === id)).filter(Boolean);
}

/* ───────── 시간 겹침 ───────── */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMinutes = (hhmm) => {
  const m = HHMM.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/**
 * 하루 안에서 시간이 꼬인 장소 id 집합.
 * 시간을 정한 장소끼리 순서대로 비교해, 앞 장소와 같은 시각이거나 더 이른 시각이면 겹침으로 본다.
 * after: 그날 비행기 도착 같은 'HH:MM' 하한 (그보다 이른 장소도 겹침), before: 그날 출국 비행기 출발 'HH:MM' 상한.
 */
export function timeConflicts(items, bounds = {}) {
  return new Set(timeConflictKinds(items, bounds).keys());
}

/**
 * 시간 겹침과 그 원인: Map<장소 id, 'order' | 'flight'>
 *   order  = 앞 장소와 같은 시각이거나 더 이름 → "이후 일정 30분 밀기"로 풀 수 있다
 *   flight = 그날 도착편 도착 전이거나 출발편(귀국편) 출발 이후 → 밀면 더 나빠질 수 있어 항공편·시간 확인만 안내
 */
export function timeConflictKinds(items, { after = '', before = '' } = {}) {
  const out = new Map();
  const arrive = toMinutes(after);
  const end = toMinutes(before);
  let prev = null;
  for (const it of items ?? []) {
    const m = toMinutes(it.time);
    if (m == null) continue;
    if ((arrive != null && m < arrive) || (end != null && m >= end)) out.set(it.id, 'flight');
    else if (prev != null && m <= prev) out.set(it.id, 'order');
    prev = prev == null ? m : Math.max(prev, m);
  }
  return out;
}

/**
 * index번째 장소부터 시간을 정한 장소들을 minutes분씩 미룬다 (23:59를 넘기지 않는다).
 * 바뀐 개수를 돌려준다.
 */
export function shiftTimesFrom(items, index, minutes = 30) {
  let n = 0;
  for (const it of (items ?? []).slice(Math.max(0, index))) {
    const m = toMinutes(it.time);
    if (m == null) continue;
    const next = fromMinutes(Math.min(23 * 60 + 59, m + minutes));
    if (next !== it.time) {
      it.time = next;
      n++;
    }
  }
  return n;
}
