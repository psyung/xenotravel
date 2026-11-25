import { dayRoute, distanceKm, flightTimeBounds, flightsForDay, routeLeg, timeConflictKinds, uncoveredStayNights } from './model.js';

// Minutes per straight-line kilometre, allowing for typical detours.
export const WALK_FACTOR = 60 * 1.25 / 4.5;
export const TRANSIT_FACTOR = 60 * 1.35 / 20;
export const TAXI_FACTOR = 60 * 1.3 / 30;
const factors = { walking: WALK_FACTOR, transit: TRANSIT_FACTOR, driving: TAXI_FACTOR };
export const estimateMinutes = (km, mode) => Math.round(km * (factors[mode] ?? TRANSIT_FACTOR));
// J-10: 직선 30km 이상은 도시 사이 이동(고속철·버스·비행기)일 때가 많아 도심 계수로 계산하면 몇 시간짜리 틀린 값이 나온다.
// 수단을 정하기 전까지는 하루 합계와 "3시간 초과" 경고에서 빼고 "장거리 n구간(수단 미정)"으로 따로 보여 준다.
export const LONG_LEG_KM = 30;
export const isLongLeg = (km) => km >= LONG_LEG_KM;

export function hoursWarning(place, date) {
  if (!date) return '';
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  if (place.closedWeekdays?.includes(weekday)) return 'closed';
  const { time, opensAt: open, closesAt: close } = place;
  if (!time || !open || !close) return '';
  const inside = open < close ? time >= open && time < close : time >= open || time < close;
  return inside ? '' : 'hours';
}

export function checkDay(trip, index, mode) {
  const { items, date } = trip.days[index];
  const route = dayRoute(trip, index);
  const bounds = flightTimeBounds(flightsForDay(trip, index));
  const warnings = [...timeConflictKinds(items)].map(([id]) => ({ id, kind: 'order' }));
  for (const [id, kind] of timeConflictKinds(items, bounds)) {
    if (kind === 'flight') warnings.push({ id, kind });
  }
  let minutes = 0;
  let longLegs = 0;
  for (let i = 1; i < route.length; i++) {
    const leg = routeLeg(route[i - 1], route[i]);
    if (!leg) continue;
    if (isLongLeg(leg.km)) {
      longLegs++;
      continue;
    }
    minutes += estimateMinutes(leg.km, mode || leg.mode);
    if (minutes > 180 && items.length && !warnings.some((w) => w.kind === 'movement')) {
      const target = items.includes(route[i]) ? route[i] : items.at(-1);
      warnings.push({ id: target.id, kind: 'movement' });
    }
  }
  if (items.length >= 8) warnings.push({ id: items[7].id, kind: 'count' });
  for (const place of items) {
    const kind = hoursWarning(place, date);
    if (kind) warnings.push({ id: place.id, kind });
  }
  const firstKm = items.length && route[0] !== items[0] ? distanceKm(route[0], items[0]) : null;
  return { minutes, longLegs, warnings, firstKm };
}

export function staySuggestions(trip) {
  const periods = [];
  for (const night of uncoveredStayNights(trip)) {
    const last = periods.at(-1);
    if (last?.end === night - 1) last.end = night;
    else periods.push({ start: night, end: night });
  }
  return periods.flatMap(({ start, end }) => {
    const places = trip.days.slice(start, end + 1).flatMap((day) => day.items);
    if (!places.length) return [];
    const lat = places.reduce((sum, p) => sum + p.lat, 0) / places.length;
    // Average longitude around the first point to handle the antimeridian.
    const origin = places[0].lng;
    const offset = places.reduce((sum, p) => sum + ((p.lng - origin + 540) % 360 - 180), 0) / places.length;
    return [{ start, end, lat, lng: (origin + offset + 540) % 360 - 180 }];
  });
}
