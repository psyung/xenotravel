// 트렌드(요즘 뜨는 곳) 데이터 처리. 순수 함수만 둔다.

import { distanceKm } from './model.js';

export { distanceKm };

/** 여행의 기준 위치: 여행지 좌표, 없으면 담긴 장소들의 평균. */
export function tripAnchor(trip) {
  if (trip.center) return trip.center;
  const items = [...trip.days.flatMap((d) => d.items), ...trip.inbox];
  if (!items.length) return null;
  return {
    lat: items.reduce((s, it) => s + it.lat, 0) / items.length,
    lng: items.reduce((s, it) => s + it.lng, 0) / items.length,
  };
}

/** 기준 위치에서 maxKm 안의 가장 가까운 도시. 없으면 null. */
export function nearestCity(cities, point, maxKm = 150) {
  if (!point) return null;
  let best = null;
  for (const c of cities) {
    const d = distanceKm(point, c.center);
    if (d <= maxKm && (!best || d < best.d)) best = { city: c, d };
  }
  return best?.city ?? null;
}

/** 이미 끝난 기간 한정 이벤트는 뺀다. today: 'YYYY-MM-DD' */
export function activePlaces(city, today) {
  return (city?.places ?? []).filter((p) => !p.until || p.until >= today);
}

const md = (s) => {
  const m = /^\d{4}-(\d{2})(?:-(\d{2}))?$/.exec(s ?? '');
  if (!m) return s ?? '';
  return m[2] ? `${+m[1]}/${+m[2]}` : `${+m[1]}월`;
};

export function statusLabel(p, today) {
  if (p.status === 'event') {
    if (p.since && p.since > today) return `${md(p.since)}~${md(p.until)} 기간 한정`;
    return p.until ? `~${md(p.until)} 기간 한정` : '기간 한정';
  }
  if (p.status === 'upcoming') return p.since ? `${md(p.since)} 오픈 예정` : '오픈 예정';
  if (p.status === 'new') return '새로 오픈';
  return '꾸준한 인기';
}

/** 트렌드 장소를 일정 항목용 장소로 바꾼다. */
export function trendToPlace(p, cityName) {
  return {
    name: p.name,
    address: [p.area, cityName].filter(Boolean).join(', '),
    lat: p.lat,
    lng: p.lng,
    url: p.sources?.[0]?.url ?? '',
    memo: p.summary ?? '',
  };
}
