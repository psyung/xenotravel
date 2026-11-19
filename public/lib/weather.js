// 일차별 날씨: Open-Meteo (키 불필요, 무료). https://open-meteo.com
//  - 오늘부터 15일 뒤까지: 예보 (forecast)
//  - 그보다 먼 날: 작년 같은 날 실제 날씨 (archive) — "작년 이맘때"로 따로 표시한다
//  - 지난 날(60일보다 전): 그날 실제 날씨 (archive)
// 위치는 그날 숙소(없으면 첫 장소, 여행지 중심). 소수 1자리(약 10km)로 묶어서 한 도시는 요청 한 번이다.
import { dayStays, parseDate } from './model.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_DAYS = 15; // 오늘 + 15일 = 16일치
const PAST_FORECAST_DAYS = 60; // 이보다 최근 지난 날은 예보 API가 그대로 돌려준다

/* WMO 날씨 코드 → 한국어 + 아이콘 종류 */
const CODES = [
  [[0], '맑음', 'sun'],
  [[1], '대체로 맑음', 'sun'],
  [[2], '구름 조금', 'partly'],
  [[3], '흐림', 'cloud'],
  [[45, 48], '안개', 'fog'],
  [[51, 53, 55, 56, 57], '이슬비', 'rain'],
  [[61], '약한 비', 'rain'],
  [[63], '비', 'rain'],
  [[65], '강한 비', 'rain'],
  [[66, 67], '어는 비', 'rain'],
  [[71], '약한 눈', 'snow'],
  [[73], '눈', 'snow'],
  [[75, 77], '많은 눈', 'snow'],
  [[80, 81], '소나기', 'rain'],
  [[82], '강한 소나기', 'rain'],
  [[85, 86], '눈 소나기', 'snow'],
  [[95, 96, 99], '뇌우', 'storm'],
];

export function describeCode(code) {
  const hit = CODES.find(([codes]) => codes.includes(Number(code)));
  return hit ? { text: hit[1], icon: hit[2] } : { text: '', icon: 'cloud' };
}

const shiftYear = (date, n) => {
  const d = parseDate(date);
  if (!d) return '';
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

/** 날씨를 볼 위치: 그날 묵는 숙소 → 출발 숙소 → 첫 장소 → 여행지 중심 */
export function dayPoint(trip, dayIndex) {
  const { start, end } = dayStays(trip, dayIndex);
  const p = end ?? start ?? trip.days[dayIndex]?.items[0] ?? trip.center;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
}

/**
 * 필요한 요청 목록. [{ kind: 'forecast'|'climate'|'past', lat, lng, start, end, days: [{ dayId, date, query }] }]
 * query = API에 물어볼 날짜 (climate는 1년 전).
 */
export function planRequests(trip, today) {
  const groups = new Map();
  trip.days.forEach((day, i) => {
    if (!parseDate(day.date)) return;
    const pt = dayPoint(trip, i);
    if (!pt) return;
    const ahead = daysBetween(today, day.date);
    const kind = ahead > FORECAST_DAYS ? 'climate' : ahead < -PAST_FORECAST_DAYS ? 'past' : 'forecast';
    const query = kind === 'climate' ? shiftYear(day.date, -1) : day.date;
    const lat = Math.round(pt.lat * 10) / 10;
    const lng = Math.round(pt.lng * 10) / 10;
    const key = `${kind}|${lat}|${lng}`;
    if (!groups.has(key)) groups.set(key, { kind, lat, lng, days: [] });
    groups.get(key).days.push({ dayId: day.id, date: day.date, query });
  });
  return [...groups.values()].map((g) => {
    const qs = g.days.map((d) => d.query).sort();
    return { ...g, start: qs[0], end: qs.at(-1) };
  });
}

export function requestUrl(req) {
  const daily = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'];
  if (req.kind === 'forecast') daily.push('precipitation_probability_max');
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lng),
    daily: daily.join(','),
    timezone: 'auto',
    start_date: req.start,
    end_date: req.end,
  });
  return `${req.kind === 'forecast' ? FORECAST : ARCHIVE}?${params}`;
}

/** API 응답 → { 'YYYY-MM-DD': { code, max, min, rainMm, prob } } */
export function parseDaily(json) {
  const d = json?.daily;
  const out = {};
  (d?.time ?? []).forEach((date, i) => {
    const max = d.temperature_2m_max?.[i];
    const min = d.temperature_2m_min?.[i];
    if (max == null || min == null) return; // 아직 없는 날 (archive는 며칠 늦게 채워진다)
    out[date] = {
      code: d.weather_code?.[i] ?? null,
      max,
      min,
      rainMm: d.precipitation_sum?.[i] ?? null,
      prob: d.precipitation_probability_max?.[i] ?? null,
    };
  });
  return out;
}

/** 비·눈 소식: 예보에서 비 올 확률 60% 이상이거나 비·눈·뇌우 코드 */
export function isWet(w) {
  if (!w) return false;
  const icon = describeCode(w.code).icon;
  if (w.prob != null) return w.prob >= 60 || (['rain', 'snow', 'storm'].includes(icon) && w.prob >= 40);
  return ['rain', 'snow', 'storm'].includes(icon) && (w.rainMm ?? 1) >= 1;
}

/** 일차 카드에 붙일 요약. { kind, text, icon, temp: '18° / 9°', prob, wet, title } */
export function summarize(w, kind) {
  if (!w) return null;
  const { text, icon } = describeCode(w.code);
  const temp = `${Math.round(w.max)}° / ${Math.round(w.min)}°`;
  const wet = kind === 'forecast' && isWet(w);
  const title =
    kind === 'climate'
      ? '작년 같은 날 실제 날씨예요. 예보는 출발 16일 전부터 보여요'
      : kind === 'past'
        ? '그날 실제 날씨예요'
        : '현지 예보 (Open-Meteo)';
  return { kind, text, icon, temp, prob: kind === 'forecast' ? w.prob : null, rainMm: w.rainMm, wet, title };
}

/* ───────── 가져오기 + 캐시 ─────────
 * 같은 요청은 예보 3시간, 과거 기록 30일 동안 다시 묻지 않는다. 인터넷이 끊기면 오래된 캐시라도 쓴다.
 */
const CACHE_KEY = 'xenotravel:wx';
const TTL = { forecast: 3 * 3600e3, climate: 30 * 86400e3, past: 30 * 86400e3 };
const MAX_ENTRIES = 40;

function readCache(storage) {
  try {
    return JSON.parse(storage?.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeCache(storage, cache) {
  try {
    const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    storage?.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* 저장 못 해도 날씨는 보인다 */
  }
}

/**
 * 여행 전체 날씨. { [dayId]: summary } — 못 가져온 날은 빠진다.
 * opts: { fetch, storage, now } (테스트용)
 */
export async function loadWeather(trip, today, { fetch: fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now() } = {}) {
  const reqs = planRequests(trip, today);
  const cache = readCache(storage);
  const result = {};
  let dirty = false;
  await Promise.all(
    reqs.map(async (req) => {
      const url = requestUrl(req);
      let entry = cache[url];
      if (!entry || now - entry.at > TTL[req.kind]) {
        try {
          const res = await fetchImpl(url);
          if (!res.ok) throw new Error(String(res.status));
          entry = { at: now, data: parseDaily(await res.json()) };
          cache[url] = entry;
          dirty = true;
        } catch {
          // 오프라인 등: 있으면 오래된 캐시라도 쓴다
        }
      }
      if (!entry) return;
      for (const d of req.days) {
        const s = summarize(entry.data[d.query], req.kind);
        if (s) result[d.dayId] = s;
      }
    }),
  );
  if (dirty) writeCache(storage, cache);
  return result;
}

/** 다시 가져와야 하는지 비교할 때 쓰는 값 (날짜·위치가 같으면 같은 값) */
export function weatherSignature(trip, today) {
  return planRequests(trip, today)
    .map((r) => `${r.kind}:${r.lat},${r.lng}:${r.days.map((d) => `${d.dayId}@${d.query}`).join('+')}`)
    .join('|');
}
