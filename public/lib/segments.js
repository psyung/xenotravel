// J-10 · J-16: 구간별 이동 수단
// trip.segments = { 'fromId>toId': { mode, minutes?, trainNo?, dep?, arr?, buffer? } }
//   - 두 지점(장소·숙소)의 id 쌍이 키다. 순서를 바꿔 구간이 사라져도 설정은 남겨 두었다가, 같은 두 곳이 다시 붙으면 되살린다.
//   - 지정하지 않은 구간은 자동 판별: 1.5km 이하 도보 · 30km 미만 그날(여행) 기본 수단 · 30km 이상은 "장거리(수단 미정)"로 합계에서 뺀다.
//   - 사용자가 정한 값은 자동 판별보다 항상 우선한다.
import { estimateMinutes, isLongLeg } from './route-check.js';

export const SEG_MODES = ['walking', 'transit', 'driving', 'rail', 'flight', 'custom'];
/** 시간을 직접 적는 수단 (나머지는 직선거리로 어림한다) */
export const TIMED_MODES = new Set(['rail', 'flight', 'custom']);
export const WALK_AUTO_KM = 1.5;
export const MAX_SEGMENTS = 2000;
export const SEG_ICONS = { walking: '🚶', transit: '🚇', driving: '🚕', rail: '🚄', flight: '✈️', custom: '⏱' };

export const segKey = (from, to) => `${from.id}>${to.id}`;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** 출발·도착 시각으로 소요 시간(분). 도착이 출발보다 이르면 다음 날 도착(야간열차)으로 본다. */
export function spanMinutes(dep, arr) {
  if (!HHMM.test(dep ?? '') || !HHMM.test(arr ?? '')) return null;
  const d = minutesOf(arr) - minutesOf(dep);
  return d > 0 ? d : d + 1440;
}

const wholeMinutes = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 7 * 1440 ? n : null;
};

/** 저장·불러오기용 정리: 모르는 값은 버리고, 시간 칸은 분 단위 정수로 */
export function cleanSegment(raw) {
  if (!raw || typeof raw !== 'object' || !SEG_MODES.includes(raw.mode)) return null;
  const seg = { mode: raw.mode };
  if (TIMED_MODES.has(raw.mode)) {
    const span = raw.mode === 'custom' ? null : spanMinutes(raw.dep, raw.arr);
    const minutes = span ?? wholeMinutes(raw.minutes);
    if (minutes == null) return null;
    seg.minutes = minutes;
  }
  if (raw.mode === 'rail' || raw.mode === 'flight') {
    if (typeof raw.trainNo === 'string' && raw.trainNo.trim()) seg.trainNo = raw.trainNo.trim().slice(0, 20);
    if (HHMM.test(raw.dep ?? '')) seg.dep = raw.dep;
    if (HHMM.test(raw.arr ?? '')) seg.arr = raw.arr;
  }
  const buffer = wholeMinutes(raw.buffer);
  if (buffer) seg.buffer = Math.min(buffer, 600);
  return seg;
}

/** trip.segments 전체 정리. ids가 있으면 지금 여행에 없는 장소·숙소를 가리키는 설정은 버린다. */
export function cleanSegments(raw, ids = null) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const [a, b, extra] = key.split('>');
    if (!a || !b || extra != null) continue;
    if (ids && (!ids.has(a) || !ids.has(b))) continue;
    const seg = cleanSegment(value);
    if (seg) out[key] = seg;
    if (Object.keys(out).length >= MAX_SEGMENTS) break;
  }
  return out;
}

/** 여행 안의 모든 지점 id (장소·보관함·숙소) */
export function pointIds(trip) {
  return new Set([
    ...trip.days.flatMap((d) => d.items.map((it) => it.id)),
    ...(trip.inbox ?? []).map((it) => it.id),
    ...(trip.stays ?? []).map((s) => s.id),
  ]);
}

const STATION = /站|駅|역$|역\s|역\(|station|\bstn\b|railway|bahnhof|gare/i;
export const looksLikeStation = (place) => STATION.test(`${place?.name ?? ''} ${place?.category === 'station' ? 'station' : ''}`);

/**
 * 구간 하나의 계획.
 * { mode, minutes, buffer, source: 'user' | 'auto', long: 수단 미정 장거리, station: 양끝이 역(고속철 제안) }
 * minutes는 여유 시간(buffer)을 뺀 이동 시간. 장거리·수단 미정이면 null.
 */
export function legPlan(trip, from, to, km, dayMode = '') {
  const seg = trip.segments?.[segKey(from, to)];
  if (seg) {
    const minutes = TIMED_MODES.has(seg.mode) ? seg.minutes : estimateMinutes(km, seg.mode);
    return { mode: seg.mode, minutes, buffer: seg.buffer ?? 0, source: 'user', long: false, station: false, seg };
  }
  if (isLongLeg(km)) {
    return { mode: '', minutes: null, buffer: 0, source: 'auto', long: true, station: looksLikeStation(from) && looksLikeStation(to) };
  }
  const mode = dayMode || (km <= WALK_AUTO_KM ? 'walking' : 'transit');
  return { mode, minutes: estimateMinutes(km, mode), buffer: 0, source: 'auto', long: false, station: false };
}

/** 구간 설정 저장 (seg가 null이면 자동으로 되돌린다) */
export function setSegment(trip, from, to, raw) {
  const key = segKey(from, to);
  trip.segments ??= {};
  const seg = raw == null ? null : cleanSegment(raw);
  if (seg) trip.segments[key] = seg;
  else delete trip.segments[key];
  return seg;
}
