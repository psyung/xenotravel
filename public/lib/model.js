// 여행 데이터 모델. 브라우저와 Node 테스트에서 같이 쓰는 순수 함수만 둔다.
// trip = { id, title, destination, startDate, endDate, center, days: [{id, date, items}], inbox: [items] }
// item = { id, name, address, lat, lng, time, memo, url }

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

export function createItem(place) {
  return {
    id: uid(),
    name: (place.name ?? '').trim() || '이름 없는 장소',
    address: place.address ?? '',
    lat: Number(place.lat),
    lng: Number(place.lng),
    time: '',
    memo: '',
    url: place.url ?? '',
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

export const EXPORT_HEADER = ['일차', '날짜', '순서', '시간', '장소', '주소', '메모', '링크', '구글맵', '위도', '경도'];

/** 엑셀 내보내기용 행 (헤더 이름을 키로 갖는 객체). */
export function tripToRows(trip) {
  const row = (dayLabel, date, order, it) => ({
    일차: dayLabel,
    날짜: date,
    순서: order,
    시간: it.time,
    장소: it.name,
    주소: it.address,
    메모: it.memo,
    링크: it.url,
    구글맵: googleMapsUrl(it),
    위도: it.lat,
    경도: it.lng,
  });
  const rows = trip.days.flatMap((d, i) => d.items.map((it, j) => row(`Day ${i + 1}`, d.date, j + 1, it)));
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
  return { ...obj, inbox: obj.inbox ?? [] };
}
