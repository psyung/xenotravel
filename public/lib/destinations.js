// 새 여행 자동완성의 여행지 목록 (P0-1). 도시마다 고정 좌표와 국가 코드를 둔다 → 이 목록의 도시는 지오코딩하지 않는다.
// 예전에는 좌표 없이 "자싱"을 그대로 Nominatim에 보내 첫 결과(인도 라자스탄)를 믿었다.
// 이름(value)과 나라(detail)는 번역 키 (화면에서는 t()). en은 목록 밖 도시를 영어로 찾을 때도 쓰는 영어 이름.
import { k, t, allVersions } from './i18n.js';
import { distanceKm } from './model.js';

export const DESTINATIONS = [
  { value: k('오사카'), detail: k('일본'), cc: 'jp', en: 'Osaka', lat: 34.6937, lng: 135.5023, keywords: ['osaka', 'ㅇㅅㅋ', '大阪'] },
  { value: k('도쿄'), detail: k('일본'), cc: 'jp', en: 'Tokyo', lat: 35.6812, lng: 139.7671, keywords: ['tokyo', '동경', 'ㄷㅋ', '東京', '东京'] },
  { value: k('후쿠오카'), detail: k('일본'), cc: 'jp', en: 'Fukuoka', lat: 33.5902, lng: 130.4017, keywords: ['fukuoka', 'ㅎㅋㅇㅋ', '福岡'] },
  { value: k('교토'), detail: k('일본'), cc: 'jp', en: 'Kyoto', lat: 35.0116, lng: 135.7681, keywords: ['kyoto', 'ㄱㅌ', '京都'] },
  { value: k('삿포로'), detail: k('일본'), cc: 'jp', en: 'Sapporo', lat: 43.0618, lng: 141.3545, keywords: ['sapporo', 'ㅅㅍㄹ', '札幌'] },
  { value: k('오키나와'), detail: k('일본'), cc: 'jp', en: 'Naha', lat: 26.2124, lng: 127.6809, keywords: ['okinawa', 'naha', 'ㅇㅋㄴㅇ', '沖縄', '冲绳', '那覇'] },
  { value: k('다낭'), detail: k('베트남'), cc: 'vn', en: 'Da Nang', lat: 16.0544, lng: 108.2022, keywords: ['da nang', 'danang', 'ㄷㄴ', '岘港', 'ダナン'] },
  { value: k('방콕'), detail: k('태국'), cc: 'th', en: 'Bangkok', lat: 13.7563, lng: 100.5018, keywords: ['bangkok', 'ㅂㅋ', '曼谷', 'バンコク'] },
  { value: k('타이베이'), detail: k('대만'), cc: 'tw', en: 'Taipei', lat: 25.033, lng: 121.5654, keywords: ['taipei', 'ㅌㅇㅂㅇ', '台北'] },
  { value: k('파리'), detail: k('프랑스'), cc: 'fr', en: 'Paris', lat: 48.8566, lng: 2.3522, keywords: ['paris', 'ㅍㄹ', '巴黎', 'パリ'] },
  { value: k('도하'), detail: k('카타르'), cc: 'qa', en: 'Doha', lat: 25.2854, lng: 51.531, keywords: ['doha', 'ㄷㅎ', '多哈', 'ドーハ'] },
  { value: k('리스본'), detail: k('포르투갈'), cc: 'pt', en: 'Lisbon', lat: 38.7223, lng: -9.1393, keywords: ['lisbon', 'ㄹㅅㅂ', '里斯本', 'リスボン'] },
  { value: k('상하이'), detail: k('중국'), cc: 'cn', en: 'Shanghai', lat: 31.2304, lng: 121.4737, keywords: ['shanghai', 'ㅅㅎㅇ', '上海'] },
  { value: k('자싱'), detail: k('중국'), cc: 'cn', en: 'Jiaxing', lat: 30.7522, lng: 120.7555, keywords: ['jiaxing', 'ㅈㅅ', '嘉兴', '嘉興'] },
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function destinationById(id) {
  return DESTINATIONS.find((city) => city.keywords[0].replace(/\s+/g, '-').toLowerCase() === id);
}

/**
 * 여행지 글자 → 목록의 도시 { lat, lng, country, en, value } (없으면 null).
 * 화면 이름(4개 국어 번역 포함)·영어 이름·별칭이 정확히 같을 때만. extra: 트렌드 도시 [{ id, name, center, country }]
 */
export function resolveDestination(text, extra = []) {
  const q = norm(text);
  if (!q) return null;
  for (const d of DESTINATIONS) {
    const names = [...allVersions(d.value), d.en, ...d.keywords].map(norm);
    if (names.includes(q)) return { lat: d.lat, lng: d.lng, country: d.cc, en: d.en, value: d.value };
  }
  for (const c of extra) {
    const names = [...allVersions(c.name), c.id].map(norm);
    if (c.center && names.includes(q)) return { lat: c.center.lat, lng: c.center.lng, country: String(c.country ?? '').toLowerCase(), en: c.id, value: c.name };
  }
  return null;
}

/** 담긴 장소(일정·보관함·숙소)의 평균 좌표 (없으면 null) */
export function destinationLabel(destination) {
  const known = resolveDestination(destination);
  return known ? t(known.value) : String(destination ?? '').trim();
}

export function placesCenter(trip) {
  const pts = [...trip.days.flatMap((d) => d.items), ...(trip.inbox ?? []), ...(trip.stays ?? [])].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

/**
 * 저장된 여행의 여행지 좌표 고치기 (P0-1). 바꿨으면 true.
 *  1) 여행지 이름이 목록의 도시인데 좌표가 150km 넘게 떨어져 있으면 그 도시 좌표·국가로
 *  2) 아니면, 담긴 장소 평균과 300km 넘게 떨어져 있으면 장소 평균으로
 */
export function repairTripCenter(trip, extra = []) {
  if (trip.centerManual) return false; // 사용자가 직접 고른 위치는 그대로
  const known = resolveDestination(trip.destination, extra);
  if (known) {
    if (trip.center && distanceKm(trip.center, known) <= 150) return false;
    trip.center = { lat: known.lat, lng: known.lng };
    trip.country = known.country;
    return true;
  }
  const avg = placesCenter(trip);
  if (!avg || !trip.center || distanceKm(trip.center, avg) <= 300) return false;
  trip.center = avg;
  delete trip.country; // 같은 잘못된 검색에서 온 국가 코드일 수 있다
  return true;
}
