// 장소 검색: Photon (OpenStreetMap 기반, 키 불필요, 입력 중 검색 허용)
// https://photon.komoot.io — 무료 공개 서버라 대량 호출은 피한다.
const PHOTON = 'https://photon.komoot.io';

function unique(parts) {
  const seen = new Set();
  return parts.filter((p) => p && !seen.has(p) && seen.add(p));
}

export function featureToPlace(f) {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.state || '이름 없는 장소';
  const address = unique([street, p.district, p.city, p.state, p.country]).filter((x) => x !== name).join(', ');
  return { name, address, lat, lng, kind: p.osm_value ?? '' };
}

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`장소 검색 서버 오류 (${res.status})`);
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
