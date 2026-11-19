import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';

// 가로로 늘어선 점들 (경도 0.01 ≈ 0.9km). 순서가 섞여 있으면 왔다 갔다 하게 된다.
const P = (name, x, extra = {}) => ({ name, lat: 34.67, lng: 135.5 + x * 0.01, ...extra });
const HOTEL = P('호텔', 0);

function tripWith(places, { stay = true } = {}) {
  const t = M.createTrip({ title: 't', startDate: '2026-12-01', endDate: '2026-12-03' });
  for (const p of places) {
    const it = M.addItem(t, t.days[1].id, p);
    if (p.time) it.time = p.time;
  }
  if (stay) M.addStay(t, HOTEL, 0, 2);
  return t;
}
const names = (items) => items.map((it) => it.name);

test('optimizeDay: 숙소 기준으로 덜 돌아가는 순서를 찾는다', () => {
  const t = tripWith([P('C', 3), P('A', 1), P('D', 4), P('B', 2)]);
  const r = M.optimizeDay(t, 1);
  assert.equal(r.changed, true);
  // 호텔(0) → 1 → 2 → 3 → 4 → 호텔, 또는 그 반대 방향
  assert.ok(['A,B,C,D', 'D,C,B,A'].includes(names(r.items).join(',')), names(r.items).join(','));
  assert.ok(r.afterKm < r.beforeKm);
  assert.ok(Math.abs(r.savedKm - (r.beforeKm - r.afterKm)) < 1e-9);
  // 미리 보기만 하고 trip은 그대로
  assert.deepEqual(names(t.days[1].items), ['C', 'A', 'D', 'B']);
});

test('optimizeDay: 숙소가 없으면 열린 경로로 계산한다', () => {
  const t = tripWith([P('B', 2), P('D', 4), P('A', 1), P('C', 3)], { stay: false });
  const r = M.optimizeDay(t, 1);
  assert.ok(['A,B,C,D', 'D,C,B,A'].includes(names(r.items).join(',')));
});

test('optimizeDay: 시간을 정한 장소는 제자리에 둔다', () => {
  const t = tripWith([P('C', 3), P('점심', 9, { time: '12:00' }), P('A', 1), P('B', 2)]);
  const r = M.optimizeDay(t, 1);
  assert.equal(r.items[1].name, '점심');
  assert.equal(r.fixed, 1);
  assert.equal(r.movable, 3);
  assert.ok(r.afterKm <= r.beforeKm);
});

test('optimizeDay: 이미 좋은 순서거나 옮길 장소가 1곳 이하면 바꾸지 않는다', () => {
  const good = M.optimizeDay(tripWith([P('A', 1), P('B', 2), P('C', 3)]), 1);
  assert.equal(good.changed, false);
  assert.equal(good.savedKm, 0);
  const one = M.optimizeDay(tripWith([P('A', 1, { time: '10:00' }), P('B', 3), P('C', 2, { time: '15:00' })]), 1);
  assert.equal(one.changed, false);
  assert.equal(M.optimizeDay(tripWith([]), 99), null);
});

test('optimizeDay: 장소가 많아도(근사 계산) 거리가 늘지 않고 고정 장소를 지킨다', () => {
  // 0~15를 섞어 둔 16곳 + 5번째 자리 고정
  const xs = [7, 2, 14, 9, 0.5, 11, 4, 15, 1, 13, 6, 3, 12, 8, 10, 5];
  const places = xs.map((x, i) => P(`p${x}`, x, i === 4 ? { time: '13:00' } : {}));
  const t = tripWith(places);
  const r = M.optimizeDay(t, 1);
  assert.equal(r.items[4].name, 'p0.5');
  assert.equal(r.items.length, 16);
  assert.equal(new Set(r.items).size, 16);
  assert.ok(r.afterKm < r.beforeKm * 0.6, `${r.beforeKm} → ${r.afterKm}`);
});

test('applyDayOrder: 제안 순서를 적용하고, 장소가 바뀌었으면 거절한다', () => {
  const t = tripWith([P('C', 3), P('A', 1), P('B', 2)]);
  const r = M.optimizeDay(t, 1);
  const ids = r.items.map((it) => it.id);
  assert.equal(M.applyDayOrder(t, 1, ids), true);
  assert.deepEqual(names(t.days[1].items), names(r.items));
  assert.equal(M.applyDayOrder(t, 1, ids.slice(1)), false);
  assert.equal(M.applyDayOrder(t, 1, [ids[0], ids[0], ids[1]]), false);
});
