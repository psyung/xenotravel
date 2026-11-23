// 오프라인용 서비스 워커. 해외에서 데이터가 안 터져도 앱을 새로 열 수 있게 한다.
// 여행 데이터 자체는 localStorage에 있으므로 여기서는 "앱 파일"만 챙긴다.
//  - 우리 파일: 인터넷이 되면 항상 새로 받고, 안 되면 저장해 둔 것.
//    저장본은 빌드마다 따로(BUILD = 커밋) 설치 때 한 번에(addAll — 하나라도 실패하면 설치 실패, 옛 빌드 유지) 받는다.
//    실행 중에는 저장본에 덧쓰지 않는다 — 받다가 끊겨 옛·새 파일이 섞인 저장본이 생기지 않게 (GPT 3차 #6)
//  - 라이브러리(글꼴 CDN · vendor/xlsx 엑셀 — 없어도 앱은 열린다): 버전이 고정이라 저장해 둔 것을 먼저 쓴다
//  - 지도 타일(Esri): 이용 약관상 오프라인 장기 저장을 하지 않는다. 브라우저 기본 HTTP 캐시만 쓰고,
//    오프라인이면 앱이 일정 좌표로 그린 SVG 동선 미니맵을 보여 준다. (예전 버전이 저장한 타일 캐시는 activate에서 지운다)
//  - 검색·날씨·환율 API: 저장하지 않는다 (날씨는 앱이 따로 저장)
const BUILD = 'dev'; // 배포 빌드의 커밋 — scripts/build-version.mjs(Vercel)와 server.js(로컬)가 바꿔 넣는다. 바뀌면 새 서비스 워커가 설치된다
const VERSION = `v13-${BUILD}`;
const APP = `xenotravel-app-${VERSION}`;
const LIBS = 'xenotravel-libs-v14'; // 글꼴·엑셀 라이브러리는 주소에 버전이 고정 → 빌드마다 다시 받지 않는다 (LIB_URLS를 바꿀 때만 올린다)

// test/pwa.test.js가 public/의 앱 파일이 빠짐없이 들어 있는지 검사한다 (일반 스크립트라 export 없음).
// vendor/: 지도(Leaflet)·끌기(Sortable) 라이브러리 — 앱 시작에 필수라 CDN이 아니라 앱 파일과 함께 한 번에 설치한다 (GPT 3차 #5)
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/logo-xeno-route.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'vendor/leaflet/leaflet.min.css',
  'vendor/leaflet/leaflet.min.js',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/sortable/Sortable.min.js',
  'vendor/cally/cally.js',
  'boot.js',
  'boot-load.js',
  'data/trends.json',
  'data/trends-i18n.json',
  'data/checklist-presets.json',
  'lib/backup.js',
  'lib/budget.js',
  'lib/checklist.js',
  'lib/datepicker.js',
  'lib/destinations.js',
  'lib/dayops.js',
  'lib/export.js',
  'lib/geo.js',
  'lib/i18n.js',
  'lib/limits.js',
  'lib/links.js',
  'lib/messages.js',
  'lib/model.js',
  'lib/privacy.js',
  'lib/settle.js',
  'lib/share.js',
  'lib/store.js',
  'lib/suggestions.js',
  'lib/summary.js',
  'lib/sync.js',
  'lib/trends.js',
  'lib/undo.js',
  'lib/weather.js',
];

const LIB_URLS = [
  'vendor/xlsx/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
];
// 우리 서버에 있지만 크고 버전이 고정인 라이브러리(엑셀): 빌드마다 다시 받지 않고 LIBS 저장본을 먼저 쓴다
const LIB_PATHS = ['/vendor/xlsx/'];
// 글꼴 조각(woff2)과 Leaflet 그림 등은 쓰일 때 저장한다
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

const sw = globalThis.self;
if (sw?.registration) {
  sw.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const app = await caches.open(APP);
        await app.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' }))); // HTTP 캐시가 아닌 서버의 이번 빌드 파일
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
      if (LIB_PATHS.some((p) => url.pathname.startsWith(p))) return event.respondWith(cacheFirst(req));
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
    return await fetch(req); // 저장본은 설치 때 빌드 단위로만 채운다 (덧쓰지 않는다)
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // 화면 이동(주소창, 홈 화면 아이콘)은 앱 첫 화면으로
    if (req.mode === 'navigate') return (await appShell(cache)) ?? Response.error();
    throw err;
  }
}

/**
 * 오프라인 화면 이동의 대체 첫 화면. 공유 주소(/s/<id>)처럼 앱 루트가 아닌 경로에서도
 * styles.css·app.js를 앱 루트에서 찾도록 <base>를 넣는다 (GPT 6차 #1 — 서버의 공유 페이지와 같은 처리)
 */
async function appShell(cache) {
  const hit = await cache.match('index.html');
  if (!hit) return null;
  const html = (await hit.text()).replace('<head>', `<head>\n  <base href="${new URL('./', sw.registration.scope).pathname}">`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function cacheFirst(req) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
  return res;
}

