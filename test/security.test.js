// Phase 0 (보안 기본, docs/qa-2026-11-23.md PART G S-1 ~ S-5) 회귀 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../public/lib/model.js';
import { LIMITS } from '../public/lib/limits.js';
import { encodeShare, decodeShare } from '../public/lib/share.js';
import { parseLocationList } from '../public/lib/links.js';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

test('S-1: vercel.json에 보안 헤더가 모든 경로에 붙는다 (CSP는 Report-Only로 시작)', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, '전체 경로 규칙');
  const h = Object.fromEntries(all.headers.map(({ key, value }) => [key, value]));
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Permissions-Policy'], /geolocation=\(self\)/);
  assert.match(h['Permissions-Policy'], /camera=\(\)/);
  const csp = h['Content-Security-Policy-Report-Only'];
  assert.ok(csp, 'Report-Only로 먼저 배포');
  assert.equal(h['Content-Security-Policy'], undefined, '강제 모드는 위반 내역 확인 뒤에');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/, '스크립트는 우리 서버 것만 (인라인 없음)');
  for (const host of ['server.arcgisonline.com', 'photon.komoot.io', 'nominatim.openstreetmap.org', 'api.open-meteo.com', 'open.er-api.com', 'cdn.jsdelivr.net']) {
    assert.ok(csp.includes(host), host);
  }
});

test('S-1: index.html·404.html에 인라인 스크립트가 없다 (CSP script-src \'self\')', () => {
  for (const f of ['public/index.html', 'public/404.html']) {
    const html = read(f);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /\bsrc="/, `${f}: ${m[0]}`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${f}: 인라인 이벤트 속성`);
  }
});

test('S-2·S-3: 외부 CDN 스크립트 없이 vendor/에서, 글꼴 CSS는 SRI, 엑셀은 내보낼 때 불러온다', () => {
  const html = read('public/index.html');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/, '외부 스크립트');
  assert.match(html, /<script type="module" src="vendor\/cally\/cally\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]*xlsx/i, '엑셀 라이브러리는 첫 화면에서 받지 않는다');
  for (const m of html.matchAll(/<link[^>]+href="https:[^"]+"[^>]*>/g)) {
    assert.match(m[0], /integrity="sha384-[A-Za-z0-9+/=]+"/, m[0]);
    assert.match(m[0], /crossorigin="anonymous"/, m[0]);
  }
  const exp = read('public/lib/export.js');
  assert.match(exp, /XLSX_SRC = 'vendor\/xlsx\/xlsx\.full\.min\.js'/);
  assert.match(read('public/vendor/xlsx/xlsx.full.min.js').slice(0, 200), /SheetJS/);
  const sw = read('public/sw.js');
  assert.match(sw, /'vendor\/xlsx\/xlsx\.full\.min\.js'/, '오프라인 엑셀 내보내기용으로 LIBS에 저장');
  assert.doesNotMatch(sw, /0\.18\.5/, '옛 SheetJS 주소가 남지 않는다');
  assert.match(sw, /const LIBS = 'xenotravel-libs-v14'/, '라이브러리 목록이 바뀌어 캐시 버전을 올린다');
});

test('S-4: 모든 href 출력은 safeUrl 검사와 이스케이프를 거친다 (정적 검사)', () => {
  for (const f of ['public/app.js', 'public/lib/summary.js', 'public/lib/export.js']) {
    const src = read(f);
    for (const m of src.matchAll(/href="\$\{([^}]*)\}/g)) {
      assert.match(m[1], /^(href|esc)\(/, `${f}: href="\${${m[1]}}"`);
    }
  }
  assert.match(read('public/app.js'), /const href = \(u\) => esc\(M\.safeUrl\(u\)\);/);
});

/** 장소 n개짜리 최소 여행 */
function tripWith({ days = 1, places = 0, expenses = 0, name = 'A', memo = '', url = '' } = {}) {
  const ds = Array.from({ length: days }, (_, i) => ({ id: `d${i}`, date: '', items: [] }));
  for (let i = 0; i < places; i++) ds[i % days].items.push({ id: `p${i}`, name: i === 0 ? name : 'P', lat: 35, lng: 139, memo: i === 0 ? memo : '', url: i === 0 ? url : '' });
  return { id: 't', title: 'T', days: ds, expenses: Array.from({ length: expenses }, (_, i) => ({ id: `e${i}`, amount: 1 })) };
}
const isLimit = (fn) => assert.throws(fn, (e) => e.code === 'limit');

test('S-5: 경계값 — 일수·장소·지출 수 (이하/정확히/초과)', () => {
  M.validateTrip(tripWith({ days: LIMITS.days }));
  isLimit(() => M.validateTrip(tripWith({ days: LIMITS.days + 1 })));
  M.validateTrip(tripWith({ days: 10, places: LIMITS.places }));
  M.validateTrip(tripWith({ days: 10, places: LIMITS.places - 1 }));
  isLimit(() => M.validateTrip(tripWith({ days: 10, places: LIMITS.places + 1 })));
  M.validateTrip(tripWith({ expenses: LIMITS.expenses }));
  isLimit(() => M.validateTrip(tripWith({ expenses: LIMITS.expenses + 1 })));
});

test('S-5: 경계값 — 이름 200자 · 메모 5000자 · URL 2000자', () => {
  const s = (n) => 'x'.repeat(n);
  M.validateTrip(tripWith({ places: 1, name: s(LIMITS.name), memo: s(LIMITS.memo), url: s(LIMITS.url) }));
  isLimit(() => M.validateTrip(tripWith({ places: 1, name: s(LIMITS.name + 1) })));
  isLimit(() => M.validateTrip(tripWith({ places: 1, memo: s(LIMITS.memo + 1) })));
  isLimit(() => M.validateTrip(tripWith({ places: 1, url: s(LIMITS.url + 1) })));
  const t = tripWith();
  t.title = s(LIMITS.name + 1);
  isLimit(() => M.validateTrip(t));
});

test('S-5: 공유 링크 코드는 200KB까지, 넘으면 이유를 알린다', async () => {
  await assert.rejects(decodeShare(`1.${'A'.repeat(LIMITS.shareCode)}`), (e) => e.code === 'limit' && /200,000|204,800/.test(e.message));
  const code = await encodeShare(tripWith({ places: 2 }));
  assert.ok(code.length <= LIMITS.shareCode);
  assert.equal((await decodeShare(code)).days[0].items.length, 2);
});

test('S-5: 장소 일괄 가져오기는 2000곳을 넘으면 아무것도 넣지 않는다', () => {
  const line = (i) => `${(i / 1000).toFixed(4)}, 139.${String(i).padStart(4, '0')}`;
  const ok = parseLocationList(Array.from({ length: LIMITS.places }, (_, i) => line(i)).join('\n'));
  assert.equal(ok.places.length, LIMITS.places);
  assert.equal(ok.error, undefined);
  const over = parseLocationList(Array.from({ length: LIMITS.places + 1 }, (_, i) => line(i)).join('\n'));
  assert.equal(over.places.length, 0);
  assert.match(over.error, /2,000/);
});
