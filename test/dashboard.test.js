import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as C from '../public/lib/checklist.js';

const trip = () => M.createTrip({ title: '오사카', destination: '오사카', startDate: '2026-12-01', endDate: '2026-12-03' });

test('ddayInfo', () => {
  const t = trip();
  assert.deepEqual(M.ddayInfo(t, '2026-11-27'), { label: 'D-4', sub: '출발까지' });
  assert.equal(M.ddayInfo(t, '2026-12-01').label, 'D-DAY');
  assert.equal(M.ddayInfo(t, '2026-12-02').label, 'Day 2');
  assert.equal(M.ddayInfo(t, '2026-12-05').label, '다녀옴');
  assert.equal(M.todayIndex(t, '2026-12-02'), 1);
  assert.equal(M.todayIndex(t, '2026-11-01'), 0);
});

test('tripStats / daySummary', () => {
  const t = trip();
  M.addItem(t, t.days[0].id, { name: '난바', lat: 34.6656, lng: 135.5013, time: '13:00' });
  M.addItem(t, t.days[0].id, { name: '우메다', lat: 34.7025, lng: 135.4959, time: '10:00' });
  const s = M.tripStats(t, '2026-11-27');
  assert.equal(s.places, 2);
  assert.equal(s.length, '2박 3일');
  assert.ok(s.km > 4 && s.km < 4.3);
  const d = M.daySummary(t, 0);
  assert.equal(d.title, '난바 · 우메다');
  assert.equal(d.from, '10:00');
  assert.equal(d.to, '13:00');
});

test('tripNotices: 숙소 빈 밤, 기간 밖 항공편', () => {
  const t = trip();
  assert.match(M.tripNotices(t)[0], /숙소를 아직/);
  M.addStay(t, { name: 'H', lat: 34.6, lng: 135.5 }, 0, 1);
  assert.match(M.tripNotices(t)[0], /Day 2 밤/);
  M.addFlight(t, { kind: 'in', from: 'KIX', to: 'ICN', departAt: '2026-12-09T10:00' });
  assert.ok(M.tripNotices(t).some((x) => /기간 밖 항공편 1개/.test(x)));
});

test('budget: 통화 추측, 환율, 기록, 합계', () => {
  assert.equal(B.guessCurrency('오사카'), 'JPY');
  assert.equal(B.guessCurrency('다낭'), 'VND');
  assert.equal(B.guessCurrency('리스본'), 'EUR');
  assert.equal(B.guessCurrency('어딘가'), 'USD');
  const t = trip();
  const b = B.ensureBudget(t);
  assert.equal(b.currency, 'JPY');
  assert.equal(B.expenseProblem({ amount: 1000, cur: 'local' }, b), '환율을 먼저 정해 주세요');
  assert.equal(B.expenseProblem({ amount: 0, cur: 'KRW' }, b), '금액을 입력해 주세요');
  b.krwPerUnit = 9.12;
  b.total = 500000;
  assert.equal(B.rateLabel(b), '100엔 = 912원');
  B.addExpense(t, { amount: 1000, cat: 'food', pay: 'cash', day: 0 });
  B.addExpense(t, { amount: 30000, cur: 'KRW', cat: 'transport', day: -1 });
  const s = B.summarize(t);
  assert.equal(s.spent, 9120 + 30000);
  assert.equal(s.left, 500000 - 39120);
  assert.equal(s.byCat.food, 9120);
  assert.equal(s.byDay['-1'], 30000);
  // 환율이 바뀌어도 이미 적은 금액은 그대로
  b.krwPerUnit = 10;
  assert.equal(B.summarize(t).spent, 39120);
  const csv = B.expensesCsv(t);
  assert.ok(csv.startsWith('﻿"날짜"'));
  assert.match(csv, /"Day 1","식비","현금","1000","JPY","9120"/);
  assert.ok(B.removeExpense(t, t.expenses[0].id));
  assert.equal(t.expenses.length, 1);
});

test('checklist: 기본 항목, 추가, 체크, 남은 할 일', () => {
  const t = trip();
  C.ensureChecks(t);
  const todo = C.progress(t, 'todo');
  assert.ok(todo.total >= 5 && todo.done === 0);
  assert.equal(C.pendingTodos(t), todo.total);
  const c = C.addCheck(t, 'shop', '  로이스 초콜릿 ');
  assert.equal(c.text, '로이스 초콜릿');
  assert.equal(C.addCheck(t, 'shop', '   '), null);
  C.toggleCheck(t, t.checks[0].id);
  assert.equal(C.pendingTodos(t), todo.total - 1);
  assert.ok(C.removeCheck(t, c.id));
  // 다 지운 뒤 다시 열어도 기본 항목을 또 넣지 않는다
  t.checks = [];
  assert.equal(C.ensureChecks(t).length, 0);
});

test('나라별 쇼핑 목록: 자동으로 넣지 않고, 담기를 눌러야 빠진 것만 들어간다', () => {
  const jp = trip(); // 오사카
  C.ensureChecks(jp);
  assert.equal(jp.checks.filter((c) => c.group === 'shop').length, 0);
  const [donki, akachan] = C.shopPickSets(jp);
  assert.equal(donki.title, '돈키호테 필수템');
  assert.equal(akachan.title, '아카짱혼포 육아템');
  assert.equal(C.missingPicks(jp, donki).length, donki.items.length);
  assert.equal(C.addPicks(jp, 'donki'), donki.items.length);
  assert.equal(C.addPicks(jp, 'donki'), 0);
  assert.equal(C.addPicks(jp, 'nope'), 0);

  // 이미 있는 품목은 다시 넣지 않는다
  const mine = trip();
  mine.checks = [{ id: 'x', group: 'shop', text: '휴족시간 (발 쿨링 시트)', done: true }];
  mine.checksV = 2;
  assert.equal(C.addPicks(mine, 'donki'), donki.items.length - 1);
  assert.equal(mine.checks.filter((c) => c.text === '휴족시간 (발 쿨링 시트)').length, 1);

  const mk = (dest) => M.createTrip({ title: dest, destination: dest, startDate: '2026-12-01', endDate: '2026-12-03' });
  assert.equal(C.shopPickSets(mk('상하이'))[0].title, '따룬파 마트템');
  assert.equal(C.shopPickSets(mk('타이베이'))[0].title, '까르푸 마트템');
  assert.equal(C.shopPickSets(mk('다낭'))[0].title, '롯데마트 쇼핑템');
  assert.equal(C.shopPickSets(mk('방콕'))[0].title, '빅씨 마트템');
  const paris = mk('파리');
  assert.deepEqual(C.shopPickSets(paris), []);
  paris.budget = { currency: 'CNY' }; // 가계부 통화를 위안으로 바꾸면 중국으로 본다
  assert.equal(C.shopPickSets(paris)[0].id, 'rtmart');
});

test('예전 버전이 자동으로 채운 쇼핑 리스트는 빼고, 손댄 리스트는 그대로 둔다', () => {
  const mk = () => M.createTrip({ title: '다낭', destination: '다낭', startDate: '2026-12-01', endDate: '2026-12-03' });
  const auto = C.SHOP_PICKS.VND[0].items;
  const todo = { id: 't', group: 'todo', text: '여권', done: false };

  const untouched = mk();
  untouched.checks = [todo, ...auto.map((text, i) => ({ id: 's' + i, group: 'shop', text, done: false }))];
  C.ensureChecks(untouched);
  assert.deepEqual(untouched.checks.map((c) => c.id), ['t']);

  const checked = mk();
  checked.checks = [todo, ...auto.map((text, i) => ({ id: 's' + i, group: 'shop', text, done: i === 0 }))];
  C.ensureChecks(checked);
  assert.equal(checked.checks.length, auto.length + 1);

  const added = mk();
  added.checks = [todo, ...auto.map((text, i) => ({ id: 's' + i, group: 'shop', text, done: false })), { id: 'z', group: 'shop', text: '코코넛 칩', done: false }];
  C.ensureChecks(added);
  assert.equal(added.checks.length, auto.length + 2);
});
