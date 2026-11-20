// 트렌드(요즘 뜨는 곳) 데이터 처리. 순수 함수만 둔다.

import { distanceKm, categoryFromText } from './model.js';
import { t, monthName } from './i18n.js';

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
/** 여행지 이름에 트렌드 도시 이름이 들어 있으면 그 도시 ("오사카", "오사카 먹방", "Osaka"). */
export function cityByName(cities, destination) {
  const d = String(destination ?? '').trim().toLowerCase();
  if (!d) return null;
  return cities.find((c) => d.includes(c.name.toLowerCase()) || d.includes(c.id.toLowerCase())) ?? null;
}

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
  return m[2] ? `${+m[1]}/${+m[2]}` : monthName(+m[1]);
};

export function statusLabel(p, today) {
  if (p.status === 'event') {
    if (p.since && p.since > today) return t('{range} 기간 한정', { range: `${md(p.since)}~${md(p.until)}` });
    return p.until ? t('{range} 기간 한정', { range: `~${md(p.until)}` }) : t('기간 한정');
  }
  if (p.status === 'upcoming') return p.since ? t('{when} 오픈 예정', { when: md(p.since) }) : t('오픈 예정');
  if (p.status === 'new') return t('새로 오픈');
  return t('꾸준한 인기');
}

/**
 * 트렌드 장소를 일정 항목용 장소로 바꾼다.
 * rawCategory: 번역 전 원문 분류(한국어). 화면 언어와 상관없이 같은 장소는 같은 종류로 저장된다 (GPT 3차 #13).
 */
export function trendToPlace(p, cityName, rawCategory = p.category) {
  return {
    name: p.name,
    address: [p.area, cityName].filter(Boolean).join(', '),
    lat: p.lat,
    lng: p.lng,
    url: p.sources?.[0]?.url ?? '',
    memo: p.summary ?? '',
    category: categoryFromText(rawCategory),
  };
}

/**
 * 서비스가 작성한 트렌드 문구를 지금 언어로 (data/trends-i18n.json).
 * 장소 이름은 번역이 있을 때만 바꾸고(한국어 설명이 섞인 이름), 없으면 원래 이름을 둔다.
 * 번역이 없는 장소는 한국어 원문을 그대로 쓰고 original: true로 알려 준다 (화면에서 lang="ko"와 '한국어 원문' 표시).
 */
export function localizePlace(p, lang, i18n) {
  const base = { name: p.name, area: p.area, category: p.category, summary: p.summary, original: false };
  if (!lang || lang === 'ko') return base;
  const tr = i18n?.places?.[p.id]?.[lang];
  const category = i18n?.categories?.[p.category]?.[lang] ?? p.category;
  if (!tr) return { ...base, category, original: true };
  return { name: tr.name ?? p.name, area: tr.area ?? p.area, category, summary: tr.summary ?? p.summary, original: !tr.summary };
}
