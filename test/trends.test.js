import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../public/lib/trends.js';
import * as M from '../public/lib/model.js';

const data = JSON.parse(readFileSync(new URL('../public/data/trends.json', import.meta.url), 'utf8'));

test('trends.json: 필수 필드와 좌표가 도시 근처에 있다', () => {
  const ids = new Set();
  for (const c of data.cities) {
    assert.ok(c.id && c.name && c.center);
    for (const p of c.places) {
      assert.ok(!ids.has(p.id), `중복 id ${p.id}`);
      ids.add(p.id);
      assert.ok(p.name && p.summary && p.category, p.id);
      assert.ok(['new', 'event', 'upcoming', 'classic'].includes(p.status), p.id);
      assert.ok(p.sources?.length && p.sources.every((s) => /^https:\/\//.test(s.url)), `${p.id} 출처`);
      assert.ok(T.distanceKm(c.center, p) < 60, `${p.id}가 ${c.name}에서 너무 멀다`);
      if (p.status === 'event' && p.until) assert.ok(p.until >= p.since, p.id);
    }
  }
});

test('nearestCity: 가까운 도시 선택, 멀면 null', () => {
  const dotonbori = { lat: 34.6687, lng: 135.5013 };
  assert.equal(T.nearestCity(data.cities, dotonbori).id, 'osaka');
  assert.equal(T.nearestCity(data.cities, { lat: 35.0, lng: 135.76 }).id, 'kyoto');
  assert.equal(T.nearestCity(data.cities, { lat: 37.56, lng: 126.97 }), null);
  assert.equal(T.nearestCity(data.cities, null), null);
});

test('tripAnchor: 여행지 좌표 우선, 없으면 장소 평균', () => {
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-01' });
  assert.equal(T.tripAnchor(t), null);
  M.addItem(t, t.days[0].id, { name: 'a', lat: 34, lng: 135 });
  M.addItem(t, M.INBOX, { name: 'b', lat: 36, lng: 137 });
  assert.deepEqual(T.tripAnchor(t), { lat: 35, lng: 136 });
  t.center = { lat: 1, lng: 2 };
  assert.deepEqual(T.tripAnchor(t), { lat: 1, lng: 2 });
});

test('activePlaces / statusLabel: 끝난 이벤트 제외, 상태 문구', () => {
  const city = {
    places: [
      { id: 'a', status: 'event', since: '2026-10-03', until: '2026-12-06' },
      { id: 'b', status: 'event', since: '2026-01-01', until: '2026-02-01' },
      { id: 'c', status: 'new', since: '2026-03-28' },
    ],
  };
  assert.deepEqual(T.activePlaces(city, '2026-11-17').map((p) => p.id), ['a', 'c']);
  assert.equal(T.statusLabel(city.places[0], '2026-11-17'), '~12/6 기간 한정');
  assert.equal(T.statusLabel({ status: 'event', since: '2026-12-11', until: '2026-12-25' }, '2026-11-17'), '12/11~12/25 기간 한정');
  assert.equal(T.statusLabel({ status: 'upcoming', since: '2026-12' }, '2026-11-17'), '12월 오픈 예정');
  assert.equal(T.statusLabel({ status: 'classic' }, '2026-11-17'), '꾸준한 인기');
});

test('trendToPlace → addItem: 메모·출처 링크가 일정에 들어간다', () => {
  const p = data.cities[1].places[0];
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-01' });
  const item = M.addItem(t, t.days[0].id, T.trendToPlace(p, '오사카'));
  assert.equal(item.name, p.name);
  assert.equal(item.memo, p.summary);
  assert.equal(item.url, p.sources[0].url);
  assert.match(item.address, /오사카$/);
});

test('cityByName: 여행지 이름으로 트렌드 도시 찾기', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/trends.json', import.meta.url), 'utf8'));
  assert.equal(T.cityByName(data.cities, '오사카')?.id, 'osaka');
  assert.equal(T.cityByName(data.cities, '오사카 먹방')?.id, 'osaka');
  assert.equal(T.cityByName(data.cities, 'Osaka')?.id, 'osaka');
  assert.equal(T.cityByName(data.cities, '교토')?.id, 'kyoto');
  assert.equal(T.cityByName(data.cities, '다낭'), null);
  assert.equal(T.cityByName(data.cities, ''), null);
});
