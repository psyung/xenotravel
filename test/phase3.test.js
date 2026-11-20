// 3차 마감: 시간 겹침 원인(B7), 공유 파일 이름(B6), /api/share 미호출(B9), 타일 미저장(B10), 파비콘 배지(B8),
// 토스트 버튼 대비(B4), 기준 통화(C1), 숙소 프리셋 이름
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import { jsonFileName } from '../public/lib/export.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('B7: 시간 겹침 원인을 장소 순서(order)와 항공편(flight)으로 나눈다', () => {
  const items = [
    { id: 'early', time: '08:00' }, // 도착편 09:10 전
    { id: 'a', time: '10:00' },
    { id: 'b', time: '09:30' }, // 앞 장소보다 이름
    { id: 'late', time: '19:00' }, // 귀국편 18:30 이후
  ];
  const kinds = M.timeConflictKinds(items, { after: '09:10', before: '18:30' });
  assert.deepEqual([...kinds], [['early', 'flight'], ['b', 'order'], ['late', 'flight']]);
  assert.deepEqual([...M.timeConflicts(items, { after: '09:10', before: '18:30' })], ['early', 'b', 'late']);
});

test('B6: 공유용 파일과 전체 백업 파일 이름을 구분한다', () => {
  const now = new Date('2026-11-20T12:00:00');
  assert.match(jsonFileName({ title: '도쿄 여행' }, 'share', now), /^xenotravel-share-도쿄 여행-2026-11-20\.json$/);
  assert.match(jsonFileName({ title: '도쿄 여행' }, 'backup', now), /^xenotravel-backup-도쿄 여행-2026-11-20\.json$/);
});

test('B9·B10: /api/share를 부르지 않고, Esri 타일을 서비스 워커에 저장하지 않는다', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /fetch\(new URL\('api\/share', appBase\(\)\)/, '공유 링크를 만들 때 /api/share를 부르지 않는다');
  const sw = read('sw.js');
  assert.doesNotMatch(sw, /arcgisonline|TILE_HOSTS|tileFirst/, '타일 요청을 가로채 저장하지 않는다');
  assert.match(app, /addEventListener\('offline', \(\) => setTilesDown\(true\)\)/, '오프라인이면 바로 미니맵');
});

test('B8: 파비콘은 밝은 원형 배지를 내장하고, 헤더 인라인 로고는 투명 배경 그대로', () => {
  const svg = read('icons/logo-xeno-route.svg');
  assert.match(svg, /<circle cx="16" cy="16" r="15" fill="#FAF9F6" stroke="#E4E4E7"/);
  assert.doesNotMatch(svg, /prefers-color-scheme/);
  const header = /<span class="logo">([\s\S]*?)<\/span>/.exec(read('index.html'))[1];
  assert.doesNotMatch(header, /#FAF9F6/);
});

test('B4: 실행 취소 버튼은 토스트 색을 뒤집은 고대비 필이다', () => {
  const css = read('styles.css');
  const rule = /\.toast-act \{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /background: var\(--paper\)/);
  assert.match(rule, /color: var\(--ink\)/);
});

test('C1: 기준 통화 — 저장은 원화, 표시는 기준 통화(정수/소수 둘째 자리)', () => {
  const b = { currency: 'JPY', krwPerUnit: 9, total: 0 };
  assert.equal(B.baseCode(b), 'KRW');
  assert.equal(B.baseMoney(12345, b), '₩12,345');
  B.setBase({ budget: b, expenses: [], destination: '', days: [] }, 'JPY');
  assert.equal(B.baseCode(b), 'JPY');
  assert.equal(B.baseMoney(9000, b), '¥1,000 JPY');
  b.base = 'USD';
  assert.equal(B.krwPerBase(b), null);
  assert.equal(B.baseMoney(13000, b), '₩13,000', '환율을 모르면 원화로 보여 준다');
  b.baseKrwPerUnit = 1300;
  assert.equal(B.baseMoney(13000, b), '$10.00');
  assert.equal(B.baseMoney(13650, b), '$10.50');
  assert.equal(B.fromBase(10.5, b), 13650);
  assert.equal(B.toBase(26000, b), 20);
});

test('B2: 샘플 숙소 같은 프리셋 숙소 이름도 언어를 따라가고, 사용자가 고치면 그대로', () => {
  const trip = M.createTrip({ title: 't', destination: 'd', startDate: '2026-12-01', endDate: '2026-12-03' });
  trip.isUserModified = false;
  const st = M.addStay(trip, { name: '도쿄역 근처 호텔 (샘플)', nameI18n: { ko: '도쿄역 근처 호텔 (샘플)', en: 'Hotel near Tokyo Station (sample)', zh: '东京站附近酒店（示例）', ja: '東京駅近くのホテル（サンプル）' }, lat: 35.68, lng: 139.77 }, 0, 2);
  M.localizePresets(trip, 'en');
  assert.equal(st.name, 'Hotel near Tokyo Station (sample)');
  st.name = '내 호텔';
  M.localizePresets(trip, 'ja');
  assert.equal(st.name, '내 호텔');
  assert.equal('nameI18n' in M.addStay(trip, { name: 'x', lat: 1, lng: 2 }, 0, 1), false);
});
