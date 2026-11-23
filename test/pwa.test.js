import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { screenFiles } from './helpers/app-source.js';

const pub = new URL('../public/', import.meta.url);
const sw = readFileSync(new URL('sw.js', pub), 'utf8');
/** sw.js의 `const NAME = [ ... ];` 배열을 읽는다 (서비스 워커는 일반 스크립트라 import할 수 없다) */
function list(name) {
  const start = sw.indexOf('[', sw.indexOf(`const ${name} = [`));
  const end = sw.indexOf('];', start);
  const items = sw.slice(start + 1, end).split(',').map((s) => s.trim()).filter(Boolean);
  return items.map((s) => s.slice(1, -1)); // 'a' → a
}

test('sw.js: 오프라인에 필요한 앱 파일이 빠짐없이 들어 있다', () => {
  const files = list('APP_FILES');
  const libs = readdirSync(new URL('lib/', pub)).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`);
  for (const f of ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'data/trends.json', ...libs, ...screenFiles()]) {
    assert.ok(files.includes(f), `${f}이(가) APP_FILES에 없어요`);
  }
  for (const f of files.filter((x) => x !== './')) readFileSync(new URL(f, pub)); // 없는 파일을 적으면 설치가 실패한다
});

test('sw.js: index.html이 불러오는 CDN 파일을 모두 저장한다', () => {
  const html = readFileSync(new URL('index.html', pub), 'utf8');
  const cdn = [...html.matchAll(/(?:src|href)="(https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)[^"]+)"/g)].map((m) => m[1]);
  assert.ok(cdn.length >= 1); // S-2: 스크립트는 vendor/로 옮기고 CDN에는 글꼴 CSS만 남는다
  const libs = list('LIB_URLS');
  for (const u of cdn) assert.ok(libs.includes(u), `${u}이(가) LIB_URLS에 없어요`);
});

test('GPT 3차 #5: 앱 시작에 필수인 지도·끌기 라이브러리는 앱과 함께 배포하고 필수 캐시(APP_FILES)에 넣는다', () => {
  const html = readFileSync(new URL('index.html', pub), 'utf8');
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/(leaflet|Sortable)/, 'CDN에서 받지 않는다');
  assert.match(html, /<script src="vendor\/leaflet\/leaflet\.min\.js"><\/script>/);
  assert.match(html, /<script src="vendor\/sortable\/Sortable\.min\.js"><\/script>/);
  const files = list('APP_FILES');
  for (const f of ['vendor/leaflet/leaflet.min.css', 'vendor/leaflet/leaflet.min.js', 'vendor/sortable/Sortable.min.js']) assert.ok(files.includes(f), f);
  const css = readFileSync(new URL('vendor/leaflet/leaflet.min.css', pub), 'utf8');
  for (const m of css.matchAll(/url\((images\/[^)]+)\)/g)) assert.ok(files.includes(`vendor/leaflet/${m[1]}`), m[1]);
});

test('manifest: 설치에 필요한 값', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', pub), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) readFileSync(new URL(i.src, pub));
});

test('앱 셸과 본문이 하나의 main을 공유하고 설치 리소스가 연결된다', () => {
  const html = readFileSync(new URL('index.html', pub), 'utf8');
  assert.equal([...html.matchAll(/<main\b/gi)].length, 1);
  for (const rel of ['manifest', 'icon', 'apple-touch-icon']) {
    const href = html.match(new RegExp(`<link\\b[^>]*\\brel="${rel}"[^>]*\\bhref="([^"]+)"`))?.[1];
    assert.ok(href, rel);
    assert.ok(list('APP_FILES').includes(href));
    readFileSync(new URL(href, pub));
  }
});

test('sw.js의 앱 파일은 모두 git에 들어간다 (.gitignore에 걸려 배포에서 빠지지 않게)', async () => {
  const { execFileSync } = await import('node:child_process');
  const files = list('APP_FILES').filter((x) => x !== './').map((f) => `public/${f}`);
  let ignored = '';
  try {
    ignored = execFileSync('git', ['check-ignore', ...files], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  } catch (err) {
    if (err.status !== 1) return; // git이 없는 환경이면 건너뛴다 (1 = 무시된 파일 없음)
  }
  assert.equal(ignored.trim(), '', `배포에서 빠지는 파일: ${ignored}`);
});

test('sw.js: 오프라인 저장본은 빌드마다 따로 설치 때 한 번에 받고, 실행 중에는 덧쓰지 않는다 (GPT 3차 #6)', async () => {
  assert.match(sw, /^const BUILD = 'dev';/m, '배포·서버가 바꿔 넣을 자리');
  assert.match(sw, /const VERSION = `v\d+-\$\{BUILD\}`;/);
  assert.match(sw, /app\.addAll\(APP_FILES\.map\(\(u\) => new Request\(u, \{ cache: 'reload' \}\)\)\)/);
  assert.doesNotMatch(sw, /cache\.put\(req, res\.clone\(\)\)/, '앱 파일 저장본에 실행 중 덧쓰기 없음');
  const { withSwBuild } = await import('../scripts/build-version.mjs');
  const out = withSwBuild(sw, 'abc1234-x');
  assert.match(out, /^const BUILD = 'abc1234-x';/m);
  assert.equal(out.replace("'abc1234-x'", "'dev'"), sw, '다른 곳은 그대로');
  assert.match(readFileSync(new URL('../vercel.json', pub), 'utf8'), /"source": "\/sw\.js", "headers": \[\{ "key": "cache-control", "value": "no-cache" \}\]/);
});
