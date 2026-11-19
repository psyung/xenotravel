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

/* ───────── 여러 개 한 번에 ─────────
 * 붙여넣은 글(링크 여러 개, "위도, 경도" 줄), 구글 테이크아웃 저장 장소(Saved Places.json, GeoJSON),
 * 테이크아웃 저장 목록 CSV(Title, Note, URL …)에서 장소를 모은다.
 * → { places: [{name, lat, lng, address, memo}], names: [{name, memo}] (위치 없이 이름만), shortLinks, unsupported }
 */
const URL_RE = /https?:\/\/[^\s<>"'，、]+/g;

/** 따옴표를 아는 아주 작은 CSV 파서 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function parseLocationList(text) {
  const out = { places: [], names: [], shortLinks: 0, unsupported: 0 };
  const s = String(text ?? '').replace(/^﻿/, '').trim();
  if (!s) return out;
  const seen = new Set();
  const addPlace = (p) => {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.places.push({ name: p.name || '', lat: p.lat, lng: p.lng, address: p.address || '', memo: p.memo || '' });
  };
  const addName = (name, memo = '') => {
    const n = String(name ?? '').trim();
    if (!n || out.names.some((x) => x.name === n)) return;
    out.names.push({ name: n, memo });
  };
  const take = (r, hint = '', memo = '') => {
    if (!r) return false;
    if (r.error === 'short-link') out.shortLinks++;
    else if (r.error) out.unsupported++;
    else if ('lat' in r) addPlace({ ...r, name: r.name || hint, memo });
    else if (r.query) addName(hint || r.query, memo);
    return true;
  };

  // 1) GeoJSON (구글 테이크아웃 "Saved Places.json")
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j.features)) {
        for (const f of j.features) {
          const p = f?.properties ?? {};
          const [lng, lat] = f?.geometry?.coordinates ?? [];
          const name = p.Title || p.title || p.location?.name || p.name || '';
          const c = coord(lat, lng, name);
          if (c && (c.lat !== 0 || c.lng !== 0)) addPlace({ ...c, address: p.location?.address || p.address || '' });
          else {
            // 좌표가 [0,0]이면 링크에서 찾고, 링크도 위치가 없으면(?cid=… 등) 이름으로 찾게 둔다
            const r = parseLocationInput(p.google_maps_url || p['Google Maps URL'] || '');
            if (r && 'lat' in r) addPlace({ ...r, name: name || r.name });
            else addName(name);
          }
        }
        return out;
      }
    } catch {
      /* JSON이 아니면 아래에서 글로 읽는다 */
    }
  }

  // 2) CSV (테이크아웃 저장 목록: 첫 줄이 Title,Note,URL …)
  const firstLine = s.split(/\r?\n/, 1)[0];
  if (/^\s*"?title"?\s*,/i.test(firstLine)) {
    const [head, ...rows] = parseCsv(s);
    const col = (re) => head.findIndex((h) => re.test(h.trim()));
    const ti = col(/^title$/i);
    const ni = col(/^note$/i);
    const ui = col(/^url$/i);
    for (const r of rows) {
      const name = r[ti] ?? '';
      const memo = ni >= 0 ? (r[ni] ?? '').trim() : '';
      const url = ui >= 0 ? (r[ui] ?? '').trim() : '';
      const parsed = url ? parseLocationInput(url) : null;
      if (parsed && 'lat' in parsed) addPlace({ ...parsed, name: name || parsed.name, memo });
      else addName(name, memo); // 테이크아웃 목록 URL은 대개 좌표가 없다 → 이름으로 찾는다
    }
    return out;
  }

  // 3) 그냥 글: 줄마다 링크들, 또는 "위도, 경도"
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const urls = t.match(URL_RE) ?? [];
    if (!urls.length) {
      const r = parseLocationInput(t);
      if (r && 'lat' in r) addPlace(r);
      continue;
    }
    // 한 줄에 링크가 하나면 링크 앞 글자를 이름으로 쓴다 ("이치란 도톤보리 https://…")
    const hint = urls.length === 1 ? t.slice(0, t.indexOf(urls[0])).replace(/[\s:：\-–—·|]+$/, '').trim() : '';
    for (const u of urls) take(parseLocationInput(u.replace(/[).,]+$/, '')), hint);
  }
  return out;
}
