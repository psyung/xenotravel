// B01: 같은 여행을 두 탭에서 열고 따로 저장해도 서로의 변경이 지워지지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as C from '../public/lib/checklist.js';
import { openStore, KEY, CORRUPT_KEY } from '../public/lib/store.js';
import { mergeStore } from '../public/lib/sync.js';

/** localStorage 흉내 (탭끼리 공유). failWith를 주면 쓰기가 실패한다. */
function memoryStorage() {
  const data = new Map();
  return {
    data,
    failWith: null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (this.failWith) throw this.failWith;
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

/** 저장소에 여행 하나를 만들고, 그 저장소를 연 탭 두 개를 돌려준다. */
function twoTabs() {
  const storage = memoryStorage();
  const t = M.createTrip({ title: '오사카', destination: '오사카', startDate: '2026-12-01', endDate: '2026-12-04' });
  B.ensureBudget(t);
  M.addItem(t, t.days[0].id, { name: '도톤보리', lat: 34.6687, lng: 135.5013 });
  M.addItem(t, t.days[0].id, { name: '오사카성', lat: 34.6873, lng: 135.5262 });
  storage.setItem(KEY, JSON.stringify({ trips: { [t.id]: t }, currentId: t.id }));
  const tab = () => {
    const db = openStore(storage);
    const store = db.load();
    return { db, store, trip: () => store.trips[t.id] };
  };
  return { storage, id: t.id, a: tab(), b: tab() };
}

test('B01: 갱신하지 않은 탭이 저장해도 다른 탭의 지출이 남는다', () => {
  const { storage, id, a, b } = twoTabs();
  B.addExpense(a.trip(), { amount: 1200, cat: 'food', day: 0, memo: 'A 점심' });
  assert.equal(a.db.save(a.store).ok, true);
  // B는 그사이 새로 읽지 않았다
  B.addExpense(b.trip(), { amount: 800, cat: 'transport', day: 1, memo: 'B 택시' });
  const r = b.db.save(b.store);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, [id]); // A의 지출이 B 화면에도 들어왔다
  // 새로고침(다시 읽기) 후에도 둘 다 있다
  const reloaded = openStore(storage).load().trips[id];
  assert.deepEqual(reloaded.expenses.map((e) => e.memo).sort(), ['A 점심', 'B 택시']);
  assert.deepEqual(b.trip().expenses.map((e) => e.memo).sort(), ['A 점심', 'B 택시']);
  // A가 다시 저장해도 B의 지출이 지워지지 않는다
  B.addExpense(a.trip(), { amount: 500, cat: 'etc', day: 2, memo: 'A 간식' });
  assert.equal(a.db.save(a.store).ok, true);
  assert.equal(openStore(storage).load().trips[id].expenses.length, 3);
});

test('B01: 서로 다른 종류의 변경(장소·체크·예산)도 합친다', () => {
  const { storage, id, a, b } = twoTabs();
  M.addItem(a.trip(), a.trip().days[1].id, { name: '유니버설', lat: 34.6654, lng: 135.4323 });
  a.trip().budget.total = 500000;
  a.db.save(a.store);
  C.addCheck(b.trip(), 'todo', '환전');
  M.moveItem(b.trip(), b.trip().days[0].items[1].id, b.trip().days[0].id, 0); // 순서 바꾸기
  b.trip().title = '오사카 먹방';
  assert.equal(b.db.save(b.store).ok, true);
  const t = openStore(storage).load().trips[id];
  assert.equal(t.title, '오사카 먹방');
  assert.equal(t.budget.total, 500000);
  assert.deepEqual(t.days[0].items.map((x) => x.name), ['오사카성', '도톤보리']);
  assert.deepEqual(t.days[1].items.map((x) => x.name), ['유니버설']);
  assert.ok(t.checks.some((c) => c.text === '환전'));
});

test('B01: 같은 지출을 양쪽에서 다르게 고치면 충돌로 알리고, 고른 쪽으로 저장한다', () => {
  const { storage, id, a, b } = twoTabs();
  const e = B.addExpense(a.trip(), { amount: 1000, day: 0, memo: '저녁' });
  a.db.save(a.store);
  b.db.save(b.store); // B도 지출을 받는다
  a.trip().expenses[0].amount = 1500;
  a.db.save(a.store);
  b.trip().expenses[0].amount = 2000;
  const before = storage.getItem(KEY);
  const r = b.db.save(b.store);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0].path, [id, 'expenses', `#${e.id}`, 'amount']);
  assert.equal(storage.getItem(KEY), before, '충돌이면 아무것도 쓰지 않는다');
  assert.equal(b.trip().expenses[0].amount, 2000, '이 탭의 입력은 그대로 남는다');
  const ok = b.db.save(b.store, { choices: { [r.conflicts[0].key]: 'remote' } });
  assert.equal(ok.ok, true);
  assert.equal(openStore(storage).load().trips[id].expenses[0].amount, 1500);
});

test('B01: 한쪽이 지운 지출을 다른 쪽이 고쳤으면 충돌, 둘 다 지웠으면 그냥 지운다', () => {
  const { a, b } = twoTabs();
  B.addExpense(a.trip(), { amount: 1000, day: 0, memo: '저녁' });
  a.db.save(a.store);
  b.db.save(b.store);
  const eid = a.trip().expenses[0].id;
  B.removeExpense(a.trip(), eid);
  a.db.save(a.store);
  b.trip().expenses[0].memo = '저녁 (수정)';
  const r = b.db.save(b.store);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts[0].remote, null);
  assert.equal(b.db.save(b.store, { choices: { [r.conflicts[0].key]: 'local' } }).ok, true);
  assert.equal(b.trip().expenses.length, 1);

  const { a: a2, b: b2 } = twoTabs();
  B.addExpense(a2.trip(), { amount: 1, day: 0 });
  a2.db.save(a2.store);
  b2.db.save(b2.store);
  const id2 = a2.trip().expenses[0].id;
  B.removeExpense(a2.trip(), id2);
  a2.db.save(a2.store);
  B.removeExpense(b2.trip(), id2);
  assert.equal(b2.db.save(b2.store).ok, true);
});

test('B01: 다른 탭이 저장한 내용과 같으면 다시 쓰지 않는다 (탭끼리 계속 깨우지 않게)', () => {
  const { storage, a, b } = twoTabs();
  B.addExpense(a.trip(), { amount: 10, day: 0 });
  a.db.save(a.store);
  let writes = 0;
  const set = storage.setItem;
  storage.setItem = function (...args) {
    writes++;
    return set.apply(this, args);
  };
  assert.equal(b.db.save(b.store).ok, true); // storage 이벤트를 받은 탭
  assert.equal(writes, 0);
  assert.equal(b.db.save(b.store).ok, true);
  assert.equal(writes, 0);
});

test('저장 실패(용량 초과·거부)는 ok:false로 알리고 저장소의 기존 데이터는 그대로', () => {
  const { storage, id, a } = twoTabs();
  const before = storage.getItem(KEY);
  storage.failWith = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  B.addExpense(a.trip(), { amount: 10, day: 0 });
  assert.deepEqual(a.db.save(a.store), { ok: false, error: 'quota' });
  assert.equal(storage.getItem(KEY), before);
  assert.equal(a.trip().expenses.length, 1, '메모리의 입력은 남는다');
  storage.failWith = new Error('SecurityError');
  assert.equal(a.db.save(a.store).error, 'denied');
  storage.failWith = null;
  assert.equal(a.db.save(a.store).ok, true); // 다시 시도하면 저장된다
  assert.equal(openStore(storage).load().trips[id].expenses.length, 1);
});

test('손상된 저장분은 지우지 않고 옮겨 두고, 일부만 망가졌으면 나머지는 연다', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, '{"trips": {"x": ');
  const db = openStore(storage);
  const s = db.load();
  assert.equal(s.problem, 'corrupt');
  assert.deepEqual(s.trips, {});
  assert.equal(storage.getItem(CORRUPT_KEY), '{"trips": {"x": ');
  assert.equal(db.corruptBackup(), '{"trips": {"x": ');

  const good = M.createTrip({ title: 'ok', startDate: '2026-01-01', endDate: '2026-01-02' });
  storage.setItem(KEY, JSON.stringify({ trips: { [good.id]: good, bad: { id: 'bad' } } }));
  const s2 = openStore(storage).load();
  assert.equal(s2.problem, 'partial');
  assert.deepEqual(Object.keys(s2.trips), [good.id]);
});

test('mergeStore: 다른 탭에서 만든 여행은 더하고, 지운 여행은 지운다', () => {
  const t1 = M.createTrip({ title: 'a', startDate: '2026-01-01', endDate: '2026-01-01' });
  const t2 = M.createTrip({ title: 'b', startDate: '2026-01-01', endDate: '2026-01-01' });
  const base = { [t1.id]: t1 };
  const r = mergeStore(base, { [t1.id]: t1 }, { [t2.id]: t2 });
  assert.deepEqual(Object.keys(r.trips), [t2.id]);
});
