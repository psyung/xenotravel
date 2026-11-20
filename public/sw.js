// 오프라인용 서비스 워커. 해외에서 데이터가 안 터져도 앱을 새로 열 수 있게 한다.
// 여행 데이터 자체는 localStorage에 있으므로 여기서는 "앱 파일"만 챙긴다.
//  - 우리 파일: 인터넷이 되면 항상 새로 받고(개발 중 수정이 바로 보이게), 안 되면 저장해 둔 것
//  - CDN 라이브러리: 버전이 고정이라 저장해 둔 것을 먼저 쓴다
//  - 지도 타일·검색·날씨·환율 API: 저장하지 않는다 (날씨는 앱이 따로 저장, 타일은 이용 조건 확인 전)
const VERSION = 'v7';
const APP = `xenotravel-app-${VERSION}`;
const LIBS = `xenotravel-libs-${VERSION}`;

// test/pwa.test.js가 public/의 앱 파일이 빠짐없이 들어 있는지 검사한다 (일반 스크립트라 export 없음).
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'data/trends.json',
  'data/trends-i18n.json',
  'lib/budget.js',
  'lib/checklist.js',
  'lib/datepicker.js',
  'lib/export.js',
  'lib/geo.js',
  'lib/i18n.js',
  'lib/links.js',
  'lib/messages.js',
  'lib/model.js',
  'lib/privacy.js',
  'lib/share.js',
  'lib/store.js',
  'lib/suggestions.js',
  'lib/sync.js',
  'lib/trends.js',
  'lib/weather.js',
];

const LIB_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/cally@0.9.2/dist/cally.js',
  'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
];
// 글꼴 조각(woff2)과 Leaflet 그림 등은 쓰일 때 저장한다
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

const sw = globalThis.self;
if (sw?.registration) {
  sw.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const app = await caches.open(APP);
        await app.addAll(APP_FILES);
        // 라이브러리는 하나가 실패해도 설치를 막지 않는다
        const libs = await caches.open(LIBS);
        await Promise.all(LIB_URLS.map((u) => libs.add(new Request(u, { mode: 'cors' })).catch(() => {})));
        await sw.skipWaiting();
      })(),
    );
  });

  sw.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys()) if (key.startsWith('xenotravel-') && ![APP, LIBS].includes(key)) await caches.delete(key);
        await sw.clients.claim();
      })(),
    );
  });

  sw.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin === sw.location.origin) {
      if (url.pathname.startsWith('/api/')) return; // 공유 링크 서버: 항상 인터넷
      event.respondWith(networkFirst(req));
    } else if (LIB_HOSTS.includes(url.hostname)) {
      event.respondWith(cacheFirst(req));
    }
    // 나머지(지도 타일, 검색·날씨·환율 API)는 브라우저 기본 동작
  });
}

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // 화면 이동(주소창, 홈 화면 아이콘)은 앱 첫 화면으로
    if (req.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
  return res;
}
