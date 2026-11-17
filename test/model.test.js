import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';

const place = (name, lat = 35, lng = 135) => ({ name, lat, lng, address: '' });

test('dateRange: 포함 범위, 잘못된 종료일, 최대 일수', () => {
  assert.deepEqual(M.dateRange('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(M.dateRange('2026-03-05', '2026-03-01'), ['2026-03-05']);
  assert.deepEqual(M.dateRange('2026-03-05', ''), ['2026-03-05']);
  assert.deepEqual(M.dateRange('', '2026-03-05'), []);
  assert.deepEqual(M.dateRange('2026-02-30', '2026-03-05'), []);
  assert.equal(M.dateRange('2026-01-01', '2027-01-01').length, 60);
});

test('createTrip: 날짜만큼 일차 생성, 제목 기본값', () => {
  const t = M.createTrip({ destination: '오사카', startDate: '2026-12-01', endDate: '2026-12-03' });
  assert.equal(t.title, '오사카 여행');
  assert.equal(t.days.length, 3);
  assert.equal(t.days[2].date, '2026-12-03');
  assert.deepEqual(t.inbox, []);
});

test('setTripDates: 줄이면 남는 장소는 보관함으로, 늘리면 기존 일차 유지', () => {
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-03' });
  const keepId = t.days[0].id;
  M.addItem(t, t.days[0].id, place('A'));
  M.addItem(t, t.days[2].id, place('C'));
  assert.equal(M.overflowCount(t, '2026-12-05', '2026-12-06'), 1);

  const r = M.setTripDates(t, '2026-12-05', '2026-12-06');
  assert.equal(r.moved, 1);
  assert.equal(t.days.length, 2);
  assert.equal(t.days[0].id, keepId);
  assert.equal(t.days[0].date, '2026-12-05');
  assert.deepEqual(t.inbox.map((i) => i.name), ['C']);

  M.setTripDates(t, '2026-12-05', '2026-12-08');
  assert.equal(t.days.length, 4);
  assert.equal(t.days[0].items[0].name, 'A');
});

test('moveItem: 같은 목록 안 순서 변경과 다른 날로 이동', () => {
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-02' });
  const [d1, d2] = t.days;
  const a = M.addItem(t, d1.id, place('A'));
  M.addItem(t, d1.id, place('B'));
  M.addItem(t, d1.id, place('C'));

  assert.ok(M.moveItem(t, a.id, d1.id, 2));
  assert.deepEqual(d1.items.map((i) => i.name), ['B', 'C', 'A']);

  assert.ok(M.moveItem(t, a.id, d2.id, 0));
  assert.deepEqual(d1.items.map((i) => i.name), ['B', 'C']);
  assert.deepEqual(d2.items.map((i) => i.name), ['A']);

  assert.ok(M.moveItem(t, a.id, M.INBOX, 99));
  assert.deepEqual(t.inbox.map((i) => i.name), ['A']);

  assert.equal(M.moveItem(t, a.id, 'no-such-list', 0), false);
  assert.deepEqual(t.inbox.map((i) => i.name), ['A'], '실패하면 원래 자리에 남아야 함');
});

test('sortByTime: 시간 있는 장소 먼저, 시간 없는 장소는 순서 유지', () => {
  const items = [
    { name: 'x', time: '' },
    { name: 'b', time: '14:00' },
    { name: 'y', time: '' },
    { name: 'a', time: '09:30' },
  ];
  M.sortByTime(items);
  assert.deepEqual(items.map((i) => i.name), ['a', 'b', 'x', 'y']);
});

test('dayTitle / formatDate', () => {
  assert.equal(M.dayTitle({ date: '2026-11-17' }, 0), 'Day 1 · 11월 17일 (화)');
  assert.equal(M.dayTitle({ date: '' }, 2), 'Day 3');
});

test('tripToRows: 일차·순서·보관함 포함', () => {
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-02' });
  const a = M.addItem(t, t.days[1].id, place('Osaka Castle', 34.6873, 135.5262));
  a.time = '10:00';
  a.memo = '입장권 예매';
  M.addItem(t, M.INBOX, place('Later'));
  const rows = M.tripToRows(t);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['일차'], 'Day 2');
  assert.equal(rows[0]['날짜'], '2026-12-02');
  assert.equal(rows[0]['순서'], 1);
  assert.equal(rows[0]['시간'], '10:00');
  assert.equal(rows[0]['구글맵'], 'https://www.google.com/maps/search/?api=1&query=34.6873,135.5262');
  assert.equal(rows[1]['일차'], '보관함');
  for (const r of rows) assert.deepEqual(Object.keys(r), M.EXPORT_HEADER);
});

test('validateTrip: 정상 백업 통과, 깨진 파일 거부', () => {
  const t = M.createTrip({ startDate: '2026-12-01', endDate: '2026-12-01' });
  M.addItem(t, t.days[0].id, place('A'));
  const copy = JSON.parse(JSON.stringify(t));
  assert.equal(M.validateTrip(copy).id, t.id);
  assert.throws(() => M.validateTrip({}), /백업 파일/);
  copy.days[0].items[0].lat = 'x';
  assert.throws(() => M.validateTrip(copy), /좌표/);
});

test('safeFileName', () => {
  assert.equal(M.safeFileName('도쿄/오사카: 5일?'), '도쿄_오사카_ 5일_');
  assert.equal(M.safeFileName(''), 'trip');
});
