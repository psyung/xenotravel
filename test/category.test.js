import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import * as T from '../public/lib/trends.js';
import { nominatimToPlace, HANGUL } from '../public/lib/geo.js';
import { encodeShare, decodeShare } from '../public/lib/share.js';

test('categoryFromTag: OSM 태그로 종류 추측', () => {
  assert.equal(M.categoryFromTag('amenity', 'restaurant'), 'food');
  assert.equal(M.categoryFromTag('amenity', 'fast_food'), 'food');
  assert.equal(M.categoryFromTag('amenity', 'cafe'), 'cafe');
  assert.equal(M.categoryFromTag('shop', 'bakery'), 'cafe');
  assert.equal(M.categoryFromTag('shop', 'clothes'), 'shop');
  assert.equal(M.categoryFromTag('shop', 'mall'), 'shop');
  assert.equal(M.categoryFromTag('historic', 'castle'), 'sight');
  assert.equal(M.categoryFromTag('tourism', 'attraction'), 'sight');
  assert.equal(M.categoryFromTag('tourism', 'hotel'), '');
  assert.equal(M.categoryFromTag('railway', 'station'), '');
  assert.equal(M.categoryFromTag('', ''), '');
});

test('categoryFromText: 트렌드 분류 문구', () => {
  assert.equal(M.categoryFromText('카페'), 'cafe');
  assert.equal(M.categoryFromText('맛집거리'), 'food');
  assert.equal(M.categoryFromText('쇼핑·복합시설'), 'shop');
  assert.equal(M.categoryFromText('테마파크'), 'sight');
  assert.equal(M.categoryFromText('숙소'), '');
  assert.equal(M.categoryFromText(''), '');
});

test('createItem: 정한 종류가 우선, 없으면 검색 결과 태그로', () => {
  assert.equal(M.createItem({ name: 'a', lat: 1, lng: 2, category: 'shop', kind: 'restaurant' }).category, 'shop');
  assert.equal(M.createItem({ name: 'a', lat: 1, lng: 2, osmKey: 'amenity', kind: 'restaurant' }).category, 'food');
  assert.equal(M.createItem({ name: 'a', lat: 1, lng: 2, category: 'nope' }).category, '');
  assert.equal(M.createItem({ name: 'a', lat: 1, lng: 2 }).category, '');
});

test('트렌드 카드를 담으면 종류가 붙는다', () => {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-01' });
  const it = M.addItem(t, t.days[0].id, T.trendToPlace({ name: 'x', lat: 1, lng: 2, category: '카페', sources: [] }, '오사카'));
  assert.equal(it.category, 'cafe');
});

test('엑셀 행에 종류 열', () => {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-02' });
  M.addItem(t, t.days[0].id, { name: '라멘', lat: 34.6, lng: 135.5, category: 'food' });
  M.addStay(t, { name: '호텔', lat: 34.6, lng: 135.5 }, 0, 1);
  const rows = M.tripToRows(t);
  assert.ok(M.EXPORT_HEADER.includes('종류'));
  assert.equal(rows.find((r) => r.장소 === '라멘').종류, '맛집');
  assert.equal(rows.find((r) => r.장소 === '호텔').종류, '숙소');
});

test('공유 링크에 종류가 유지된다', async () => {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-01' });
  M.addItem(t, t.days[0].id, { name: '라멘', lat: 34.6, lng: 135.5, category: 'food' });
  const back = await decodeShare(await encodeShare(t));
  assert.equal(back.days[0].items[0].category, 'food');
});

test('nominatimToPlace: 한국어 이름·주소·종류', () => {
  const p = nominatimToPlace({
    name: '오사카성;오사카 성',
    display_name: '오사카성, 1, 大阪城, 中央区, 大阪市, 大阪府, 540-0002, 일본',
    lat: '34.6873',
    lon: '135.5262',
    category: 'historic',
    type: 'castle',
  });
  assert.equal(p.name, '오사카성');
  assert.equal(p.lat, 34.6873);
  assert.doesNotMatch(p.address, /540-0002|오사카 성/);
  assert.match(p.address, /^大阪城, 中央区/);
  assert.equal(M.createItem(p).category, 'sight');
});

test('HANGUL: 한국어가 섞였는지', () => {
  assert.ok(HANGUL.test('도톤보리'));
  assert.ok(HANGUL.test('이치란 ramen'));
  assert.ok(!HANGUL.test('Dotonbori'));
  assert.ok(!HANGUL.test('道頓堀'));
});
