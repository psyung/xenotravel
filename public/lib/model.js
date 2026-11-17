// 여행 데이터 모델. 브라우저와 Node 테스트에서 같이 쓰는 순수 함수만 둔다.
// trip = { id, title, destination, startDate, endDate, center, days: [{id, date, items}], inbox: [items] }
// item = { id, name, address, lat, lng, time, memo, url, category }

export const INBOX = 'inbox';
const MAX_DAYS = 60;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

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
    title: title?.trim() || (destination ? `${destination} 여행` : '새 여행'),
    destination,
    startDate: dates[0] ?? '',
    endDate: dates.at(-1) ?? '',
    center,
    days: list.map((date) => ({ id: uid(), date, items: [] })),
    inbox: [],
    stays: [],
    flights: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 날짜를 바꾸면 사라지는 날의 장소 수 (확인 메시지용). */
export function overflowCount(trip, start, end) {
  const n = dateRange(start, end).length;
  if (!n) return 0;
  return trip.days.slice(n).reduce((sum, d) => sum + d.items.length, 0);
}

/** 날짜 변경. 기존 일차는 순서대로 유지하고, 줄어든 날의 장소는 보관함으로 옮긴다. */
export function setTripDates(trip, start, end) {
  const dates = dateRange(start, end);
  if (!dates.length) return { moved: 0 };
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
    name: (place.name ?? '').trim() || '이름 없는 장소',
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

export function formatDate(date) {
  const d = parseDate(date);
  if (!d) return '';
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAYS[d.getUTCDay()]})`;
}

export function dayTitle(day, index) {
  const date = formatDate(day.date);
  return date ? `Day ${index + 1} · ${date}` : `Day ${index + 1}`;
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
  const copy = { ...found.item, id: uid() };
  found.list.splice(found.index + 1, 0, copy);
  return copy;
}

/* ───────── 항공편 ─────────
 * flight = { id, kind: 'out'|'in'|'move', flightNo, from, to, departAt, arriveAt, bookingRef, memo }
 * departAt / arriveAt: 'YYYY-MM-DDTHH:MM' (현지 시각, 사용자가 입력한 그대로)
 */
export const FLIGHT_KINDS = { out: '출국', in: '귀국', move: '이동' };

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
  if (!DATETIME.test(f.departAt)) return '출발 날짜와 시간을 입력해 주세요';
  if (f.arriveAt && !DATETIME.test(f.arriveAt)) return '도착 시간을 다시 확인해 주세요';
  if (f.arriveAt && f.arriveAt < f.departAt) return '도착 시간이 출발보다 빨라요. 현지 시각 기준으로 다시 확인해 주세요';
  if (!f.from || !f.to) return '출발·도착 공항을 입력해 주세요';
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

export const EXPORT_HEADER = ['일차', '날짜', '순서', '시간', '종류', '장소', '주소', '메모', '링크', '구글맵', '위도', '경도'];

/** 엑셀 내보내기용 행 (헤더 이름을 키로 갖는 객체). */
export function tripToRows(trip) {
  const row = (dayLabel, date, order, it) => ({
    일차: dayLabel,
    날짜: date,
    순서: order,
    시간: it.time ?? '',
    종류: CATEGORIES[it.category]?.label ?? (it.stay ? '숙소' : ''),
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
    const label = `Day ${i + 1}`;
    const fl = flightsOnDate(trip, d.date);
    const flightRow = ({ flight: f }) =>
      row(label, d.date, `항공(${FLIGHT_KINDS[f.kind]})`, {
        name: flightSummary(f),
        address: '',
        memo: [f.bookingRef && `예약번호 ${f.bookingRef}`, f.memo].filter(Boolean).join(' / '),
        url: '',
        time: f.departAt.slice(0, 10) === d.date ? f.departAt.slice(11, 16) : (f.arriveAt || '').slice(11, 16),
        lat: '',
        lng: '',
      });
    return [
      ...fl.filter((x) => x.flight.kind !== 'in').map(flightRow),
      ...(start ? [row(label, d.date, '숙소(출발)', { ...start, stay: true })] : []),
      ...d.items.map((it, j) => row(label, d.date, j + 1, it)),
      ...(end ? [row(label, d.date, '숙소(귀가)', { ...end, stay: true })] : []),
      ...fl.filter((x) => x.flight.kind === 'in').map(flightRow),
    ];
  });
  rows.push(...trip.inbox.map((it, j) => row('보관함', '', j + 1, it)));
  return rows;
}

export function safeFileName(name) {
  return (name || 'trip').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'trip';
}

export function touch(trip) {
  trip.updatedAt = new Date().toISOString();
}

/** 백업 파일 검증. 올바르지 않으면 Error를 던진다. */
export function validateTrip(obj) {
  const fail = (msg) => {
    throw new Error(`올바른 여행 백업 파일이 아니에요 (${msg})`);
  };
  if (!obj || typeof obj !== 'object') fail('형식');
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
  return { ...obj, inbox: obj.inbox ?? [], stays: obj.stays ?? [], flights: obj.flights ?? [] };
}
