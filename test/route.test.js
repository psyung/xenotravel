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
