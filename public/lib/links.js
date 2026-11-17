// 붙여넣은 지도 링크나 "위도, 경도" 텍스트에서 위치를 읽는다.
// 반환: null(링크/좌표 아님) | {lat, lng, name} | {query} (좌표 없이 장소 이름만 있음) | {error}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const COORD_RE = new RegExp(`^${NUM}\\s*,\\s*${NUM}$`);

function coord(lat, lng, name = null) {
  lat = Number(lat);
  lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, name };
}

const decode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' ')).trim();
  } catch {
    return s.trim();
  }
};

function coordFromParam(value, name) {
  const m = COORD_RE.exec((value ?? '').trim());
  return m ? coord(m[1], m[2], name) : null;
}

function parseGoogle(raw, url) {
  const placeName = /\/place\/([^/@?]+)/.exec(url.pathname)?.[1];
  const name = placeName ? decode(placeName) : null;

  // !3d<lat>!4d<lng> 는 장소 자체의 좌표라 가장 정확하다.
  const pin = [...raw.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].at(-1);
  if (pin) return coord(pin[1], pin[2], name);

  for (const key of ['q', 'query', 'll', 'center', 'destination']) {
    const value = url.searchParams.get(key);
    const c = coordFromParam(value, name);
    if (c) return c;
  }

  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(raw);
  if (at) return coord(at[1], at[2], name);

  const text = name ?? url.searchParams.get('q') ?? url.searchParams.get('query');
  return text ? { query: text } : { error: 'unsupported' };
}

export function parseLocationInput(text) {
  const s = (text ?? '').trim();
  if (!s) return null;

  const plain = COORD_RE.exec(s);
  if (plain) return coord(plain[1], plain[2]) ?? { error: 'unsupported' };

  if (!/^https?:\/\//i.test(s)) return null;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps'))) {
    return { error: 'short-link' };
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return parseGoogle(s, url);

  if (host === 'maps.apple.com') {
    const name = url.searchParams.get('q');
    for (const key of ['ll', 'coordinate', 'sll']) {
      const c = coordFromParam(url.searchParams.get(key), name);
      if (c) return c;
    }
    return name ? { query: name } : { error: 'unsupported' };
  }

  if (host.endsWith('openstreetmap.org')) {
    const c = coord(url.searchParams.get('mlat'), url.searchParams.get('mlon'));
    if (url.searchParams.has('mlat') && c) return c;
    const m = /map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/.exec(url.hash);
    if (m) return coord(m[1], m[2]);
  }

  return { error: 'unsupported' };
}
