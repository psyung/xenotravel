import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';

// 오사카 근처 좌표
const NAMBA = { name: '난바', lat: 34.6656, lng: 135.5013 };
const DOTON = { name: '도톤보리', lat: 34.6687, lng: 135.5013 }; // 난바에서 북쪽 약 350m
const UMEDA = { name: '우메다', lat: 34.7025, lng: 135.4959 }; // 난바에서 약 4km
const HOTEL = { name: '호텔', lat: 34.6700, lng: 135.5000 };

function tripWith(items, { stay = false } = {}) {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-03' });
  for (const p of items) M.addItem(t, t.days[1].id, p);
  if (stay) M.addStay(t, HOTEL, 0, 2);
  return t;
}

test('distanceKm: 가까운 거리와 먼 거리', () => {
  assert.ok(Math.abs(M.distanceKm(NAMBA, DOTON) - 0.345) < 0.02);
  assert.ok(Math.abs(M.distanceKm(NAMBA, UMEDA) - 4.1) < 0.2);
});

test('routeLeg: 가까우면 도보(분), 멀면 대중교통, 같은 곳이면 null', () => {
  const walk = M.routeLeg(NAMBA, DOTON);
  assert.equal(walk.mode, 'walking');
  assert.ok(walk.walkMin >= 4 && walk.walkMin <= 7, `walkMin=${walk.walkMin}`);
  assert.match(walk.url, /travelmode=walking/);
  assert.match(walk.url, /origin=34\.6656,135\.5013&destination=34\.6687,135\.5013/);

  const far = M.routeLeg(NAMBA, UMEDA);
  assert.equal(far.mode, 'transit');
  assert.equal(far.walkMin, null);
  assert.match(far.url, /travelmode=transit/);

  assert.equal(M.routeLeg(NAMBA, { ...NAMBA }), null);
});

test('formatKm', () => {
  assert.equal(M.formatKm(0.345), '350m');
  assert.equal(M.formatKm(3.44), '3.4km');
  assert.equal(M.formatKm(12.6), '13km');
});

test('dayRoute: 출발 숙소 → 장소 → 귀가 숙소 순서', () => {
  const t = tripWith([NAMBA, UMEDA], { stay: true });
  assert.deepEqual(M.dayRoute(t, 1).map((p) => p.name), ['호텔', '난바', '우메다', '호텔']);
  assert.deepEqual(M.dayRoute(tripWith([NAMBA]), 1).map((p) => p.name), ['난바']);
  assert.deepEqual(M.dayRoute(t, 99), []);
});

test('routeDirectionsUrl: 경유지, 중복 제거, 너무 많으면 null', () => {
  const t = tripWith([NAMBA, UMEDA], { stay: true });
  const url = M.routeDirectionsUrl(M.dayRoute(t, 1));
  assert.match(url, /origin=34\.67,135\.5&destination=34\.67,135\.5/);
  assert.match(url, /waypoints=34\.6656%2C135\.5013%7C34\.7025%2C135\.4959/);
  assert.doesNotMatch(url, /travelmode/);

  // 장소 없이 같은 숙소만 → 길찾기 없음
  const empty = tripWith([], { stay: true });
  assert.equal(M.routeDirectionsUrl(M.dayRoute(empty, 1)), null);

  const many = Array.from({ length: 12 }, (_, i) => ({ lat: 34.6 + i * 0.01, lng: 135.5 }));
  assert.equal(M.routeDirectionsUrl(many), null);
  assert.ok(M.routeDirectionsUrl(many.slice(0, 11)));
});

test('safeUrl: http(s)만 허용', () => {
  assert.equal(M.safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(M.safeUrl('javascript:alert(1)'), '');
  assert.equal(M.safeUrl(''), '');
  assert.equal(M.safeUrl(undefined), '');
});

test('걸음 수: 도보 구간만, 100걸음 단위', () => {
  // 350m 직선 → 437m 실제 → 625걸음 → 600
  assert.equal(M.walkSteps(0.35), 600);
  assert.equal(M.routeLeg(NAMBA, DOTON).steps, 600);
  assert.equal(M.routeLeg(NAMBA, UMEDA).steps, 0); // 4km는 대중교통으로 본다
  const t = tripWith([NAMBA, DOTON, UMEDA]);
  assert.equal(M.daySteps(t, 1), 600);
  assert.equal(M.daySummary(t, 1).steps, 600);
  assert.equal(M.tripStats(t, '2026-11-01').steps, 600);
  assert.equal(M.formatSteps(12345), '12,345');
});

test('dayShareText: 카톡용 하루 일정 (항공·숙소·시간·메모·동선 링크)', () => {
  const t = M.createTrip({ title: '오사카', startDate: '2026-12-01', endDate: '2026-12-03' });
  M.addStay(t, HOTEL, 0, 2);
  M.addFlight(t, { kind: 'out', flightNo: 'KE723', from: 'ICN', to: 'KIX', departAt: '2026-12-01T09:00', arriveAt: '2026-12-01T11:10' });
  M.addItem(t, t.days[0].id, NAMBA);
  const lunch = M.addItem(t, t.days[0].id, { ...DOTON, time: '12:00', memo: '예약 2명\n두 번째 줄' });
  lunch.time = '12:00';
  const text = M.dayShareText(t, 0);
  assert.equal(text.split('\n')[0], '[오사카] Day 1 · 12월 1일 (화)');
  assert.match(text, /^09:00 출국 KE723 ICN 09:00 → KIX 11:10$/m);
  assert.doesNotMatch(text, /^출발/m); // 첫날은 비행기로 도착해서 공항에서 시작한다
  assert.match(M.dayShareText(t, 1), /^출발  호텔$/m);
  assert.match(text, /^1\. 난바$/m);
  assert.match(text, /^12:00  2\. 도톤보리 · 예약 2명$/m);
  assert.doesNotMatch(text, /두 번째 줄/);
  assert.match(text, /^귀가  호텔$/m);
  assert.match(text, /^동선 지도 https:\/\/www\.google\.com\/maps\/dir\//m);
  assert.match(M.dayShareText(t, 2), /아직 정한 곳이 없어요/);
  assert.equal(M.dayShareText(t, 9), '');
});

test('todayPlan: 여행 중일 때만, 다음 장소는 지금 이후 첫 시간', () => {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-03' });
  M.addStay(t, HOTEL, 0, 2);
  const a = M.addItem(t, t.days[1].id, NAMBA);
  const b = M.addItem(t, t.days[1].id, DOTON);
  const c = M.addItem(t, t.days[1].id, UMEDA);
  b.time = '13:00';
  c.time = '18:30';
  assert.equal(M.todayPlan(t, '2026-11-30', '10:00'), null);
  assert.equal(M.todayPlan(t, '2026-12-04', '10:00'), null);
  const p = M.todayPlan(t, '2026-12-02', '14:05');
  assert.equal(p.dayIndex, 1);
  assert.equal(p.nextId, c.id);
  assert.equal(p.stay.name, '호텔');
  assert.equal(M.todayPlan(t, '2026-12-02', '20:00').nextId, null);
  assert.equal(M.todayPlan(t, '2026-12-02', '09:00').nextId, b.id);
  assert.equal(a.time, '');
  // 마지막 날: 오늘 밤 숙소가 없으면 출발 숙소
  assert.equal(M.todayPlan(t, '2026-12-03', '09:00').stay.name, '호텔');
  assert.match(M.directionsFromHereUrl(NAMBA), /dir\/\?api=1&destination=34\.6656,135\.5013&travelmode=transit$/);
});
