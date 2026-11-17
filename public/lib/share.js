// 공유 링크: 여행 전체를 압축해서 URL의 # 뒤에 담는다. 서버에 아무것도 저장하지 않는다.
// # 뒤(fragment)는 브라우저가 서버로 보내지 않으므로 일정 내용이 서버 로그에도 남지 않는다.
// 링크는 만든 순간의 사본이라, 일정을 고친 뒤에는 링크를 다시 만들어 보내야 한다.
import { uid, validateTrip, parseDate } from './model.js';

/** 짧은 링크 id: 영문·숫자 8자 */
export const SHORT_ID = /^[A-Za-z0-9]{8}$/;
/** 링크용 코드 형식 (서버에서 받을 때도 검사) */
export const CODE_RE = /^1\.[A-Za-z0-9_-]+$/;

const md = (s) => {
  const d = parseDate(s);
  return d ? `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일` : '';
};

/**
 * 공유 미리보기 문구. 카톡 미리보기 카드(서버)와 복사되는 메시지(브라우저)가 같이 쓴다.
 * → { title: '오사카 먹방', line: '12월 1일 ~ 12월 3일 · 2박 3일 · 장소 5곳' }
 */
export function shareSummary(trip) {
  const n = trip.days.length;
  const places = trip.days.reduce((s, d) => s + d.items.length, 0);
  const s = md(trip.startDate);
  const e = md(trip.endDate);
  const range = s ? (s === e ? s : `${s} ~ ${e}`) : '';
  const length = n > 1 ? `${n - 1}박 ${n}일` : '당일치기';
  return {
    title: trip.title || '여행 일정',
    line: [range, length, places ? `장소 ${places}곳` : ''].filter(Boolean).join(' · '),
  };
}

/** 메신저에 붙여넣을 메시지 */
export function shareMessage(trip, url) {
  const { title, line } = shareSummary(trip);
  return `${title}\n${line}\n\n일정 보기 (설치 없이 바로 열려요)\n${url}`;
}

export const SHARE_PREFIX = '#s=';
const FORMAT = '1'; // 압축 형식이 바뀌면 올린다

const noId = ({ id, ...rest }) => rest;

/** 공유에 필요 없는 값은 뺀다. id는 받는 쪽에서 새로 만들므로 넣지 않는다 (무작위 문자열이라 압축이 안 돼 링크가 길어진다). */
function snapshot(trip) {
  const { id, createdAt, updatedAt, ...rest } = trip;
  return {
    ...rest,
    days: trip.days.map((d) => ({ ...noId(d), items: d.items.map(noId) })),
    inbox: (trip.inbox ?? []).map(noId),
    stays: (trip.stays ?? []).map(noId),
    flights: (trip.flights ?? []).map(noId),
  };
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

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 여행 → 링크용 문자열 ('1.' + base64url(deflate(JSON))) */
export async function encodeShare(trip) {
  const json = new TextEncoder().encode(JSON.stringify(snapshot(trip)));
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
    throw new Error('공유 링크가 잘렸거나 올바르지 않아요. 링크 전체를 다시 복사해 주세요.');
  };
  const [format, data] = String(code ?? '').split('.');
  if (format !== FORMAT || !data) fail();
  let raw;
  try {
    const bytes = await pipe(fromBase64Url(decodeURIComponent(data)), new DecompressionStream('deflate-raw'));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail();
  }
  let t;
  try {
    t = validateTrip(withPlaceholderIds(raw));
  } catch {
    fail();
  }
  const item = (it) => ({
    id: uid(),
    name: str(it.name) || '이름 없는 장소',
    address: str(it.address),
    lat: it.lat,
    lng: it.lng,
    time: str(it.time),
    memo: str(it.memo),
    url: str(it.url),
    category: str(it.category),
  });
  const now = new Date().toISOString();
  return {
    version: 1,
    id: uid(),
    title: str(t.title) || '공유받은 여행',
    destination: str(t.destination),
    startDate: str(t.startDate),
    endDate: str(t.endDate),
    center: Number.isFinite(t.center?.lat) && Number.isFinite(t.center?.lng) ? { lat: t.center.lat, lng: t.center.lng } : null,
    trendCity: typeof t.trendCity === 'string' ? t.trendCity : null,
    days: t.days.map((d) => ({ id: uid(), date: str(d.date), items: d.items.map(item) })),
    inbox: t.inbox.map(item),
    stays: t.stays.map((s) => {
      const { id, time, category, ...rest } = item(s);
      return { ...rest, id, startIndex: s.startIndex, nights: s.nights };
    }),
    flights: t.flights.map((f) => ({
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
  };
}
