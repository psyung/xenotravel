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

test('숙소: 박 수만큼 날짜마다 출발·귀가로 들어간다 (기본 2박)', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-24' }); // 5일
  const a = M.addStay(t, place('Hotel A'), 0); // 기본 2박: 1·2일차 밤
  assert.equal(a.nights, M.DEFAULT_NIGHTS);
  const b = M.addStay(t, place('Hotel B'), 2, 2); // 3·4일차 밤

  const names = (i) => {
    const s = M.dayStays(t, i);
    return [s.start?.name, s.end?.name, s.checkIn, s.checkOut];
  };
  assert.deepEqual(names(0), ['Hotel A', 'Hotel A', true, false]); // 첫날: 출발도 A로 채움
  assert.deepEqual(names(1), ['Hotel A', 'Hotel A', false, false]);
  assert.deepEqual(names(2), ['Hotel A', 'Hotel B', true, true]); // A 체크아웃 → B 체크인
  assert.deepEqual(names(3), ['Hotel B', 'Hotel B', false, false]);
  assert.deepEqual(names(4), ['Hotel B', 'Hotel B', false, true]); // 마지막 날: 귀가도 B로 채움

  assert.deepEqual(M.stayDates(t, a), { checkIn: '2026-12-20', checkOut: '2026-12-22' });
  assert.deepEqual(M.stayDates(t, b), { checkIn: '2026-12-22', checkOut: '2026-12-24' });
});

test('숙소: 박 수는 여행 기간 안으로 맞추고, 겹치면 나중 숙소가 우선', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-23' }); // 4일
  const a = M.addStay(t, place('A'), 0, 4);
  const b = M.addStay(t, place('B'), 2, 10);
  assert.equal(b.nights, 2, '여행 끝을 넘지 않음');
  assert.equal(M.nightStay(t, 1).name, 'A');
  assert.equal(M.nightStay(t, 2).name, 'B');

  M.updateStayRange(t, a.id, { nights: 1 });
  assert.equal(M.nightStay(t, 1), null);
  assert.ok(M.removeStay(t, b.id));
  assert.deepEqual(M.dayStays(t, 3), { start: null, end: null, checkIn: false, checkOut: false });
});

test('숙소: 엑셀 행에 출발·귀가로 포함', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-21' });
  M.addStay(t, place('Hotel A'), 0, 1);
  M.addItem(t, t.days[0].id, place('Spot'));
  const rows = M.tripToRows(t).map((r) => `${r['일차']}/${r['순서']}/${r['장소']}`);
  assert.deepEqual(rows, ['Day 1/숙소(출발)/Hotel A', 'Day 1/1/Spot', 'Day 1/숙소(귀가)/Hotel A', 'Day 2/숙소(출발)/Hotel A', 'Day 2/숙소(귀가)/Hotel A']);
});

test('duplicateItem: 원본 바로 아래에 새 id로 복제', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-20' });
  const a = M.addItem(t, t.days[0].id, place('A'));
  a.memo = '메모';
  M.addItem(t, t.days[0].id, place('B'));
  const copy = M.duplicateItem(t, a.id);
  assert.notEqual(copy.id, a.id);
  assert.deepEqual(t.days[0].items.map((i) => `${i.name}:${i.memo}`), ['A:메모', 'A:메모', 'B:']);
  copy.memo = '바뀜';
  assert.equal(a.memo, '메모', '복제본은 독립적');
});

test('숙소: 중간에 숙소가 빈 밤은 채우지 않는다', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-24' }); // 5일
  M.addStay(t, place('A'), 0, 1); // 1일차 밤만
  M.addStay(t, place('B'), 3, 1); // 4일차 밤만
  const v = (i) => {
    const s = M.dayStays(t, i);
    return `${s.start?.name ?? '-'}/${s.end?.name ?? '-'}`;
  };
  assert.deepEqual([0, 1, 2, 3, 4].map(v), ['A/A', 'A/-', '-/-', '-/B', 'B/B']);
});

test('달력 날짜 ↔ 숙소 기간 변환', () => {
  const t = M.createTrip({ startDate: '2026-12-30', endDate: '2027-01-02' }); // 4일, 연도 넘김
  assert.equal(M.dateAtIndex(t, 2), '2027-01-01');
  assert.equal(M.indexOfDate(t, '2027-01-02'), 3);
  assert.deepEqual(M.rangeFromDates(t, '2026-12-31', '2027-01-02'), { startIndex: 1, nights: 2 });
  assert.deepEqual(M.rangeFromDates(t, '2026-12-31', '2026-12-31'), { startIndex: 1, nights: 1 }, '최소 1박');
  assert.deepEqual(M.rangeFromDates(t, '2026-12-01', '2027-03-01'), { startIndex: 0, nights: 4 }, '여행 기간 안으로');
  assert.equal(M.rangeFromDates(t, '', ''), null);
});

test('항공편: 날짜별 배치, 요약, 검사', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-23' });
  const back = M.addFlight(t, { kind: 'in', flightNo: 'ke 724', from: 'KIX', to: 'ICN', departAt: '2026-12-23T18:00', arriveAt: '2026-12-23T20:00' });
  const out = M.addFlight(t, { kind: 'out', flightNo: 'KE723', from: 'ICN', to: 'KIX', departAt: '2026-12-20T09:00', arriveAt: '2026-12-20T11:10' });
  assert.deepEqual(t.flights.map((f) => f.id), [out.id, back.id], '출발 시각 순 정렬');
  assert.equal(back.flightNo, 'KE724');
  assert.equal(M.flightSummary(out), 'KE723 ICN 09:00 → KIX 11:10');
  assert.deepEqual(M.flightsOnDate(t, '2026-12-20').map((x) => x.role), ['both']);
  assert.deepEqual(M.flightsOnDate(t, '2026-12-21'), []);

  // 밤 비행기: 출발일과 도착일에 각각 걸린다
  const night = M.addFlight(t, { kind: 'move', from: 'KIX', to: 'CTS', departAt: '2026-12-21T23:30', arriveAt: '2026-12-22T01:10' });
  assert.equal(M.flightsOnDate(t, '2026-12-21')[0].role, 'depart');
  assert.equal(M.flightsOnDate(t, '2026-12-22')[0].role, 'arrive');
  M.removeFlight(t, night.id);

  assert.equal(M.flightProblem({ from: 'ICN', to: 'KIX', departAt: '' }), '출발 날짜와 시간을 입력해 주세요');
  // 날짜 변경선을 넘으면 현지 도착이 출발보다 빠를 수 있어 막지 않고 확인만 한다 (I06)
  assert.equal(M.flightProblem({ from: 'ICN', to: 'HNL', departAt: '2026-12-20T21:00', arriveAt: '2026-12-20T10:30' }), null);
  assert.match(M.flightWarning({ from: 'ICN', to: 'HNL', departAt: '2026-12-20T21:00', arriveAt: '2026-12-20T10:30' }), /출발보다 빨라요/);
  assert.equal(M.flightWarning({ from: 'ICN', to: 'KIX', departAt: '2026-12-20T09:00', arriveAt: '2026-12-20T11:00' }), null);
  assert.equal(M.flightProblem({ from: 'ICN', to: 'KIX', departAt: '2026-12-20T09:00' }), null);
});

test('항공편이 있으면 첫날 출발·마지막 날 귀가를 숙소로 채우지 않는다', () => {
  const t = M.createTrip({ startDate: '2026-12-20', endDate: '2026-12-22' });
  M.addStay(t, place('Hotel'), 0, 2);
  assert.equal(M.dayStays(t, 0).start?.name, 'Hotel', '항공편 없으면 채움');
  assert.equal(M.dayStays(t, 2).end?.name, 'Hotel');
  M.addFlight(t, { kind: 'out', from: 'ICN', to: 'KIX', departAt: '2026-12-20T09:00', arriveAt: '2026-12-20T11:00' });
  M.addFlight(t, { kind: 'in', from: 'KIX', to: 'ICN', departAt: '2026-12-22T18:00', arriveAt: '2026-12-22T20:00' });
  assert.equal(M.dayStays(t, 0).start, null, '첫날은 공항에서 시작');
  assert.equal(M.dayStays(t, 0).end?.name, 'Hotel');
  assert.equal(M.dayStays(t, 2).start?.name, 'Hotel');
  assert.equal(M.dayStays(t, 2).end, null, '마지막 날은 공항에서 끝');

  const rows = M.tripToRows(t).map((r) => `${r['일차']}/${r['순서']}/${r['장소']}`);
  assert.equal(rows[0], 'Day 1/항공(출국)/ICN 09:00 → KIX 11:00');
  assert.equal(rows.at(-1), 'Day 3/항공(귀국)/KIX 18:00 → ICN 20:00');
});
