// 공유 링크: 여행 전체를 압축해서 URL의 # 뒤에 담는다. 서버에 아무것도 저장하지 않는다.
// # 뒤(fragment)는 브라우저가 서버로 보내지 않으므로 일정 내용이 서버 로그에도 남지 않는다.
// 링크는 만든 순간의 사본이라, 일정을 고친 뒤에는 링크를 다시 만들어 보내야 한다.
import { uid, validateTrip } from './model.js';
import { LIMITS, limitError } from './limits.js';
import { cleanSegments, MAX_SEGMENTS } from './segments.js';
import { t, k, monthDay, tripLength } from './i18n.js';

/** 짧은 링크 id: 영문·숫자 8자 */
export const SHORT_ID = /^[A-Za-z0-9]{8}$/;
/** 링크용 코드 형식 (서버에서 받을 때도 검사) */
export const CODE_RE = /^1\.[A-Za-z0-9_-]+$/;

/**
 * 공유 미리보기 문구. 카톡 미리보기 카드(서버)와 복사되는 메시지(브라우저)가 같이 쓴다.
 * → { title: '오사카 먹방', line: '12월 1일 ~ 12월 3일 · 2박 3일 · 장소 5곳' }
 */
export function shareSummary(trip) {
  const n = trip.days.length;
  const places = trip.days.reduce((s, d) => s + d.items.length, 0);
  const s = monthDay(trip.startDate);
  const e = monthDay(trip.endDate);
  const range = s ? (s === e ? s : `${s} ~ ${e}`) : '';
  return {
    title: trip.title || t('여행 일정'),
    line: [range, tripLength(n, '당일치기'), places ? t('장소 {n}곳', { n: places }) : ''].filter(Boolean).join(' · '),
  };
}

/** 메신저에 붙여넣을 메시지 */
export function shareMessage(trip, url) {
  const { title, line } = shareSummary(trip);
  return `${title}\n${line}\n\n${t('일정 보기 (설치 없이 바로 열려요)')}\n${url}`;
}

export const SHARE_PREFIX = '#s=';
const FORMAT = '1'; // 압축 형식이 바뀌면 올린다

/** 받는 화면에서 사용하는 일정 필드만 링크에 넣는다. */
function shareSnapshot(trip, { includePrivate = false } = {}) {
  const { version, title, destination, startDate, endDate, center, country, trendCity } = trip;
  const place = ({ name, address, lat, lng, url, memo }) => ({
    name, address, lat, lng, url, ...(includePrivate ? { memo } : {}),
  });
  const stop = (it) => ({
    ...place(it), time: it.time, category: it.category,
    closedWeekdays: it.closedWeekdays?.length ? it.closedWeekdays : undefined,
    opensAt: it.opensAt || undefined, closesAt: it.closesAt || undefined,
  });
  return {
    version, title, destination, startDate, endDate, center, country, trendCity,
    sharedAt: new Date().toISOString(),
    days: trip.days.map(({ date, items, travelMode }) => ({ date, travelMode, items: items.map(stop) })),
    inbox: (trip.inbox ?? []).map(stop),
    stays: (trip.stays ?? []).map((stay) => ({
      ...place(stay), startIndex: stay.startIndex, nights: stay.nights,
      checkInTime: stay.checkInTime || undefined, checkOutTime: stay.checkOutTime || undefined,
      ...(includePrivate ? { bookingRef: stay.bookingRef, phone: stay.phone } : {}),
    })),
    flights: (trip.flights ?? []).map(({ kind, flightNo, from, to, departAt, arriveAt, bookingRef, memo }) => ({
      kind, flightNo, from, to, departAt, arriveAt, ...(includePrivate ? { bookingRef, memo } : {}),
    })),
    segs: shareSegments(trip),
  };
}

/** J-10: 구간별 이동 수단은 id 대신 자리(d일차.순번 · i보관함 · s숙소)로 담는다 (받는 쪽에서 id를 새로 만든다) */
function pointRefs(trip, idOf = (x) => x.id) {
  const refs = new Map();
  trip.days.forEach((d, di) => d.items.forEach((it, ii) => refs.set(idOf(it), `d${di}.${ii}`)));
  (trip.inbox ?? []).forEach((it, ii) => refs.set(idOf(it), `i${ii}`));
  (trip.stays ?? []).forEach((st, si) => refs.set(idOf(st), `s${si}`));
  return refs;
}
function shareSegments(trip) {
  const refs = pointRefs(trip);
  const out = [];
  for (const [key, seg] of Object.entries(trip.segments ?? {})) {
    const [a, b] = key.split('>');
    if (refs.has(a) && refs.has(b)) out.push([refs.get(a), refs.get(b), seg]);
  }
  return out.length ? out : undefined;
}
function readSharedSegments(trip, segs) {
  if (!Array.isArray(segs)) return {};
  const byRef = new Map([...pointRefs(trip)].map(([id, ref]) => [ref, id]));
  const raw = {};
  for (const entry of segs.slice(0, MAX_SEGMENTS)) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [a, b, seg] = entry;
    if (byRef.has(a) && byRef.has(b)) raw[`${byRef.get(a)}>${byRef.get(b)}`] = seg;
  }
  return cleanSegments(raw);
}

/** validateTrip이 요구하는 id 자리를 채운다 (진짜 id는 decodeShare에서 새로 만든다). */
function withPlaceholderIds(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) return raw;
  const fill = (list) => (Array.isArray(list) ? list.map((x) => (x && typeof x === 'object' ? { ...x, id: '' } : x)) : list);
  return {
    ...raw,
    id: '',
    days: raw.days.map((d) => (d && typeof d === 'object' ? { ...d, id: '', items: fill(d.items) } : d)),
    inbox: fill(raw.inbox),
    stays: fill(raw.stays),
    flights: fill(raw.flights),
  };
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 공유 코드를 풀었을 때 허용하는 최대 크기 (장소 수천 곳도 1MB 안팎) — 작은 코드가 거대하게 풀리는 압축 폭탄 방지 (GPT 3차 #3) */
export const MAX_INFLATED = 5 * 1024 * 1024;
/** 압축 풀기: 나오는 대로 세다가 상한을 넘으면 바로 멈춘다 (전부 메모리에 모으기 전에) */
async function inflateLimited(bytes, max = MAX_INFLATED) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * 공유 링크에 담기는 것과 같은 사본 (메모·예약번호 제외 옵션 그대로). 압축을 못 하는 브라우저에서 파일로 보낼 때 쓴다.
 * id는 새로 만든다.
 */
export function sharedCopy(trip, options) {
  return fromSnapshot(JSON.parse(JSON.stringify(shareSnapshot(trip, options))));
}

/** 여행 → 링크용 문자열 ('1.' + base64url(deflate(JSON))) */
export async function encodeShare(trip, options) {
  const json = new TextEncoder().encode(JSON.stringify(shareSnapshot(trip, options)));
  // 받는 쪽 상한(MAX_INFLATED)을 넘는 일정은 링크로 만들지 않는다 — 열리지 않는 링크를 보내지 않게 (GPT 4차 #3)
  if (json.length > MAX_INFLATED) throw Object.assign(new Error('too large'), { code: 'too-large' });
  return `${FORMAT}.${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

export function shareUrl(base, code) {
  return `${base.split('#')[0]}${SHARE_PREFIX}${code}`;
}

/** location.hash에서 공유 코드만 꺼낸다. 공유 링크가 아니면 null. */
export function shareCodeFromHash(hash) {
  return hash?.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * 링크 문자열 → 여행. 남이 만든 데이터이므로 검증하고, 화면에 그대로 쓰이는 id는 모두 새로 만든다.
 * 잘못된 링크면 Error를 던진다.
 */
export async function decodeShare(code) {
  const fail = () => {
    throw new Error(t('공유 링크가 잘렸거나 올바르지 않아요. 링크 전체를 다시 복사해 주세요.'));
  };
  if (String(code ?? '').length > LIMITS.shareCode) throw limitError(k('공유 링크 글자 수'), LIMITS.shareCode); // S-5
  const [format, data] = String(code ?? '').split('.');
  if (format !== FORMAT || !data) fail();
  let raw;
  try {
    const bytes = await inflateLimited(fromBase64Url(decodeURIComponent(data)));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail();
  }
  try {
    return fromSnapshot(raw);
  } catch (err) {
    if (err?.code === 'limit') throw err; // 크기 제한은 그 이유를 그대로 알린다
    fail();
  }
}

/** 검증한 뒤 화면에 쓰일 id를 모두 새로 만든다 (형식이 틀리면 Error) */
function fromSnapshot(raw) {
  const v = validateTrip(withPlaceholderIds(raw));
  const item = (it) => ({
    id: uid(),
    name: str(it.name) || t('이름 없는 장소'),
    address: str(it.address),
    lat: it.lat,
    lng: it.lng,
    time: str(it.time),
    memo: str(it.memo),
    url: str(it.url),
    category: str(it.category),
  });
  const stop = (it) => ({
    ...item(it), closedWeekdays: it.closedWeekdays, opensAt: it.opensAt, closesAt: it.closesAt,
  });
  const now = new Date().toISOString();
  const trip = {
    version: 1,
    id: uid(),
    title: str(v.title) || t('공유받은 여행'),
    destination: str(v.destination),
    startDate: str(v.startDate),
    endDate: str(v.endDate),
    center: Number.isFinite(v.center?.lat) && Number.isFinite(v.center?.lng) ? { lat: v.center.lat, lng: v.center.lng } : null,
    country: typeof v.country === 'string' && /^[a-z]{2}$/.test(v.country) ? v.country : undefined,
    trendCity: typeof v.trendCity === 'string' ? v.trendCity : null,
    days: v.days.map((d) => ({
      id: uid(), date: str(d.date), items: d.items.map(stop),
      ...(['walking', 'transit', 'driving'].includes(d.travelMode) ? { travelMode: d.travelMode } : {}),
    })),
    inbox: v.inbox.map(stop),
    stays: v.stays.map((s) => {
      const { id, time, category, ...rest } = item(s);
      return { ...rest, id, startIndex: s.startIndex, nights: s.nights,
        checkInTime: s.checkInTime, checkOutTime: s.checkOutTime, bookingRef: s.bookingRef, phone: s.phone };
    }),
    flights: v.flights.map((f) => ({
      id: uid(),
      kind: ['out', 'in', 'move'].includes(f.kind) ? f.kind : 'out',
      flightNo: str(f.flightNo),
      from: str(f.from),
      to: str(f.to),
      departAt: str(f.departAt),
      arriveAt: str(f.arriveAt),
      bookingRef: str(f.bookingRef),
      memo: str(f.memo),
    })),
    createdAt: now,
    updatedAt: now,
    sharedAt: typeof raw.sharedAt === 'string' && Number.isFinite(Date.parse(raw.sharedAt)) ? raw.sharedAt : null,
  };
  trip.segments = readSharedSegments(trip, raw.segs);
  return trip;
}
