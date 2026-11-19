// 장소 검색: Photon (OpenStreetMap 기반, 키 불필요, 입력 중 검색 허용)
// https://photon.komoot.io — 무료 공개 서버라 대량 호출은 피한다.
import { t, getLang } from './i18n.js';

const PHOTON = 'https://photon.komoot.io';

function unique(parts) {
  const seen = new Set();
  return parts.filter((p) => p && !seen.has(p) && seen.add(p));
}

export function featureToPlace(f) {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.state || t('이름 없는 장소');
  const address = unique([street, p.district, p.city, p.state, p.country]).filter((x) => x !== name).join(', ');
  // 지역: 같은 이름 후보를 구분할 수 있게 도시·나라
  const region = unique([p.city || p.county || p.state, p.country]).filter((x) => x !== name).join(', ');
  return { name, address, region, lat, lng, kind: p.osm_value ?? '', osmKey: p.osm_key ?? '', country: (p.countrycode ?? '').toLowerCase() };
}

async function getJSON(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw Object.assign(new Error(t('검색 서버에 연결하지 못했어요')), { kind: navigator?.onLine === false ? 'offline' : 'network' });
  }
  if (!res.ok) throw Object.assign(new Error(t('장소 검색 서버 오류 ({status})', { status: res.status })), { kind: res.status === 429 ? 'busy' : 'provider' });
  return res.json();
}

/** near: 지도 중심 {lat, lng, zoom} — 확대된 상태면 가까운 결과를 우선한다. */
export async function searchPlaces(query, near, signal) {
  const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' });
  if (near && near.zoom >= 5) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lng.toFixed(4));
  }
  const data = await getJSON(`${PHOTON}/api/?${params}`, signal);
  return (data.features ?? []).map(featureToPlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export async function reversePlace(lat, lng, signal) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en' });
  const data = await getJSON(`${PHOTON}/reverse?${params}`, signal);
  const f = data.features?.[0];
  return f ? featureToPlace(f) : null;
}

// 여행지(도시) 좌표: Nominatim (OpenStreetMap). Photon은 "오사카" 같은 한국어 도시 이름을 못 찾고
// 서울의 "오사카○○" 식당을 돌려주므로, 여행을 만들 때 한 번만 Nominatim을 쓴다.
// 사용 정책: 초당 1회 이하, 자동완성 금지 (https://operations.osmfoundation.org/policies/nominatim/)
const NOMINATIM = 'https://nominatim.openstreetmap.org';

const acceptLanguage = () => (getLang() === 'zh' ? 'zh-CN' : getLang());

/** 여행지 이름 → {lat, lng, country} (못 찾으면 null). 한국어·영어·현지어 모두 된다. country: 'cn' 같은 국가 코드 */
export async function geocodeDestination(query, signal) {
  const q = String(query ?? '').trim();
  if (!q) return null;
  try {
    const params = new URLSearchParams({ q, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': acceptLanguage() });
    const [hit] = await getJSON(`${NOMINATIM}/search?${params}`, signal);
    if (hit && Number.isFinite(+hit.lat) && Number.isFinite(+hit.lon)) {
      return { lat: +hit.lat, lng: +hit.lon, country: String(hit.address?.country_code ?? '').toLowerCase() };
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  // Nominatim이 막혔을 때만 Photon으로 (영어·현지어 이름은 잘 찾는다)
  const [first] = await searchPlaces(q, null, signal);
  return first ? { lat: first.lat, lng: first.lng, country: first.country } : null;
}

/* ───────── 한국어 장소 검색 (Nominatim) ─────────
 * Photon은 한국어 이름을 몰라서 "도톤보리"를 못 찾고 서울의 "오사카○○"를 돌려준다.
 * OSM에는 유명한 곳의 한국어 이름(name:ko)이 있어서 Nominatim은 찾는다.
 * 정책상 자동완성(입력 중 검색)은 금지라 Enter를 눌렀을 때만 부르고, 요청 간격을 1초 이상 둔다.
 */
export const HANGUL = /[ㄱ-ㆎ가-힣]/;

let lastNominatim = 0;
async function nominatim(params, signal) {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  lastNominatim = Date.now();
  return getJSON(`${NOMINATIM}/search?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', 'accept-language': acceptLanguage(), ...params })}`, signal);
}

/** Nominatim 결과 → 장소. 이름이 "오사카성;오사카 성"처럼 여러 개면 첫 번째만. */
export function nominatimToPlace(r) {
  const parts = String(r.display_name ?? '').split(',').map((s) => s.trim());
  const name = String(r.name || parts[0] || t('이름 없는 장소')).split(';')[0].trim();
  const names = new Set(String(r.name ?? '').split(';').map((x) => x.trim()).concat(name, parts[0]));
  // 이름 반복, 번지만 있는 칸, 우편번호는 뺀다.
  const address = parts.filter((p) => p && !names.has(p) && !/^\d{3}-?\d{4}$/.test(p) && !/^\d+$/.test(p)).slice(0, 4).join(', ');
  const a = r.address ?? {};
  const region = [a.city || a.town || a.county || a.state, a.country].filter(Boolean).join(', ');
  return { name, address, region, lat: +r.lat, lng: +r.lon, kind: r.type ?? '', osmKey: r.category ?? '', country: String(a.country_code ?? '').toLowerCase() };
}

/**
 * 한국어 검색. near(지도 중심)가 있으면 그 주변(약 ±50km)을 먼저 찾고, 없으면 전체에서 찾는다.
 */
export async function searchPlacesKo(query, near, signal) {
  const q = String(query ?? '').trim();
  // 같은 장소가 건물·입구 등으로 여러 번 나오면(이름 같고 300m 안쪽) 하나만 남긴다.
  const clean = (rows) =>
    rows
      .map(nominatimToPlace)
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .filter((p, i, all) => !all.slice(0, i).some((o) => o.name === p.name && Math.abs(o.lat - p.lat) + Math.abs(o.lng - p.lng) < 0.004));
  if (near && near.zoom >= 9) {
    const d = 0.5;
    const viewbox = [near.lng - d, near.lat + d, near.lng + d, near.lat - d].map((x) => x.toFixed(4)).join(',');
    const local = clean(await nominatim({ q, limit: '8', viewbox, bounded: '1' }, signal));
    if (local.length) return local;
  }
  return clean(await nominatim({ q, limit: '8' }, signal));
}
