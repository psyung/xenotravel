import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
  for (const f of ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'data/trends.json', ...libs]) {
    assert.ok(files.includes(f), `${f}이(가) APP_FILES에 없어요`);
  }
  for (const f of files.filter((x) => x !== './')) readFileSync(new URL(f, pub)); // 없는 파일을 적으면 설치가 실패한다
});

test('sw.js: index.html이 불러오는 CDN 파일을 모두 저장한다', () => {
  const html = readFileSync(new URL('index.html', pub), 'utf8');
  const cdn = [...html.matchAll(/(?:src|href)="(https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)[^"]+)"/g)].map((m) => m[1]);
  assert.ok(cdn.length >= 5);
  const libs = list('LIB_URLS');
  for (const u of cdn) assert.ok(libs.includes(u), `${u}이(가) LIB_URLS에 없어요`);
});

test('manifest: 설치에 필요한 값', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', pub), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) readFileSync(new URL(i.src, pub));
});
