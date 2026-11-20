// Phase 4: QA 잔여 결함 수정 + 핵심 기능 4종 (일차 간 이동·복제·일자 순서, 요약 이미지, 스마트 체크리스트, 환율 스냅샷·결제수단)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as C from '../public/lib/checklist.js';
import * as S from '../public/lib/settle.js';
import * as D from '../public/lib/dayops.js';
import * as I from '../public/lib/i18n.js';
import { createUndoStack } from '../public/lib/undo.js';
import { summaryModel, projectRoutes, fitText, wrapText, summaryFileName } from '../public/lib/summary.js';
import { buildCommit, withBuildMeta } from '../scripts/build-version.mjs';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');
const presets = JSON.parse(read('data/checklist-presets.json'));

function tripWith() {
  const tr = M.createTrip({ title: 'T', destination: '오사카', startDate: '2026-12-20', endDate: '2026-12-23' });
  const add = (d, name, time = '') => M.addItem(tr, tr.days[d].id, { name, lat: 34.6 + d / 100, lng: 135.5, time });
  add(0, 'A', '12:00');
  add(0, 'B');
  add(1, 'C', '10:00');
  add(1, 'D', '15:00');
  add(2, 'E', '09:00');
  add(3, 'F', '10:00');
  add(3, 'G', '13:00');
  tr.flights = [
    { id: 'f1', kind: 'out', flightNo: 'KE1', from: 'ICN', to: 'KIX', departAt: '2026-12-20T09:00', arriveAt: '2026-12-20T11:00', bookingRef: 'SECRET1', memo: '' },
    { id: 'f2', kind: 'in', flightNo: 'KE2', from: 'KIX', to: 'ICN', departAt: '2026-12-23T14:00', arriveAt: '2026-12-23T16:00', bookingRef: 'SECRET2', memo: '' },
  ];
  return tr;
}
const names = (tr) => tr.days.map((d) => d.items.map((x) => x.name).join(''));
const idOf = (tr, name) => tr.days.flatMap((d) => d.items).find((x) => x.name === name).id;

/* ───────── 1단계: QA 잔여 결함 ───────── */

test('P4-1: 375px 이하 머리 바는 grid 칸으로 나눠 로고·여행 이름·메뉴·언어 버튼이 겹치지 않는다', () => {
  const css = read('styles.css');
  const block = /@media \(max-width: 375px\) \{\n  \.topbar \{ display: grid;[\s\S]*?\n\}/.exec(css)?.[0];
  assert.ok(block, '375px 이하 grid 머리 바 규칙');
  assert.match(block, /grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(block, /\.lang-switch \{ gap: 0; \}/);
  assert.match(block, /\.lang-switch button \{ min-width: 24px; width: 24px;/, '언어 버튼은 24px 이상 (WCAG 2.5.8)');
  assert.match(block, /-webkit-line-clamp: 2/, '긴 여행 이름은 두 줄까지 보인다');
});

test('P4-2: 일괄 삭제 확인 창 — 전체 수는 실제 항목 수, 완료 = 전체면 버튼 하나만', () => {
  const tr = { checks: [], checksV: 2 };
  const add = (group, done) => tr.checks.push({ id: M.uid(), group, text: 'x', done });
  add('pack', true);
  add('pack', true);
  add('pack', false); // 멀티 어댑터처럼 남은 항목
  add('todo', true);
  assert.deepEqual(C.bulkDeleteOptions(tr, 'pack'), { done: 2, total: 3, options: ['done', 'all'] });
  assert.deepEqual(C.bulkDeleteOptions(tr, 'todo'), { done: 1, total: 1, options: ['done'] });
  assert.deepEqual(C.bulkDeleteOptions(tr, 'shop'), { done: 0, total: 0, options: [] });
  tr.checks.forEach((c) => (c.done = false));
  assert.deepEqual(C.bulkDeleteOptions(tr, 'pack').options, ['all']);
  const app = read('app.js');
  assert.match(app, /all: t\('전체 \{n\}개 삭제', \{ n: opt\.total \}\)/, '전체 버튼은 실제 전체 수에 묶는다');
});

test('P4-3: 연속 삭제 실행 취소 — 스택으로 쌓여 앞 삭제의 복구 데이터가 덮어쓰이지 않는다', () => {
  let now = 0;
  const st = createUndoStack({ now: () => now });
  const log = [];
  st.push({ text: 'a', run: () => log.push('a') });
  now = 3000;
  st.push({ text: 'b', run: () => log.push('b') });
  assert.equal(st.size(), 2);
  assert.equal(st.peek().text, 'b');
  st.undo();
  now = 7000; // 첫 작업은 원래 5초가 지났지만, 되돌리기를 누른 순간 남은 작업에 5초가 다시 주어졌다
  assert.equal(st.size(), 1);
  st.undo();
  assert.deepEqual(log, ['b', 'a']);
  st.push({ text: 'c', run: () => {} });
  now = 13000;
  assert.equal(st.size(), 0, '5초가 지나면 버린다');
});

test('P4-3: 체크 항목 연속 삭제 → 거꾸로 되돌려도 원래 순서, 연결된 지출도 복원', () => {
  const tr = M.createTrip({ title: 'T', startDate: '2026-12-20', endDate: '2026-12-21' });
  B.ensureBudget(tr);
  C.ensureChecks(tr);
  const pack = () => tr.checks.filter((c) => c.group === 'pack').map((c) => c.text);
  const original = pack();
  const [first, second] = tr.checks.filter((c) => c.group === 'pack');
  C.setPrice(tr, first.id, 3000, 'KRW');
  C.toggleCheck(tr, first.id, '2026-12-20'); // 가격 있는 항목 체크 → 지출 기록
  const expense = C.linkedExpense(tr, first.id);
  assert.ok(expense);
  const snap1 = C.takeChecksSnapshot(tr, [first.id]);
  C.removeCheck(tr, first.id);
  const snap2 = C.takeChecksSnapshot(tr, [second.id]);
  C.removeCheck(tr, second.id);
  B.removeExpense(tr, expense.id); // 그사이 가계부에서도 지웠다
  // 두 번째 삭제부터 되돌린 뒤 첫 번째 삭제
  C.restoreChecks(tr, snap2);
  C.restoreChecks(tr, snap1);
  assert.deepEqual(pack(), original, '순서가 섞이지 않는다');
  assert.equal(C.linkedExpense(tr, first.id)?.id, expense.id, '연결된 지출도 함께 되살아난다');
  // 순서를 바꿔 되돌려도 같다
  const s1 = C.takeChecksSnapshot(tr, [first.id]);
  C.removeCheck(tr, first.id);
  const s2 = C.takeChecksSnapshot(tr, [second.id]);
  C.removeCheck(tr, second.id);
  C.restoreChecks(tr, s1);
  C.restoreChecks(tr, s2);
  assert.deepEqual(pack(), original);
  assert.equal(tr.expenses.filter((e) => e.checkId === first.id).length, 1, '지출이 두 번 생기지 않는다');
});

test('P4-4: KRW·JPY는 정수, USD·EUR는 소수점 둘째 자리로 일관되게', () => {
  I.setLang('ko');
  assert.equal(B.formatMoney(1234.5, 'KRW'), '₩1,235');
  assert.equal(B.formatMoney(1500.4, 'JPY'), '¥1,500 JPY');
  assert.equal(B.formatMoney(12.5, 'USD'), '$12.50');
  assert.equal(B.formatMoney(3, 'EUR'), '€3.00');
  assert.equal(B.money(12.5, 'USD'), '$12.50');
  assert.equal(B.formatUnits(1001, 'USD'), '$10.01');
  assert.equal(B.toUnits(10.005, 'USD'), 1001);
  assert.equal(B.toUnits(99.6, 'JPY'), 100);
});

test('P4-4: 1/N 정산 — 반올림 나머지를 보정해 인당 부담 합계 = 총액 (KRW·USD)', () => {
  assert.deepEqual(S.splitUnits(100, 3), [34, 33, 33]);
  assert.deepEqual(S.splitUnits(1000, 3), [334, 333, 333]);
  assert.equal(S.splitUnits(1, 3).reduce((a, b) => a + b), 1);
  const tr = M.createTrip({ title: 'T', startDate: '2026-12-20', endDate: '2026-12-21' });
  tr.members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  tr.budget = { currency: 'KRW', krwPerUnit: 0, total: 0 };
  tr.expenses = [
    { id: 'e1', amount: 100, cur: 'KRW', krw: 100, payer: 'b' },
    { id: 'e2', amount: 10000, cur: 'KRW', krw: 10000, payer: 'a' },
    { id: 'e3', amount: 7, cur: 'KRW', krw: 7, payer: 'c', split: ['a', 'c'] },
  ];
  const s = S.settlement(tr);
  assert.equal(s.people.reduce((n, p) => n + p.share, 0), s.total);
  assert.equal(s.people.reduce((n, p) => n + p.net, 0), 0);
  const sent = s.transfers.reduce((n, x) => n + x.amount, 0);
  assert.equal(sent, s.people.filter((p) => p.net > 0).reduce((n, p) => n + p.net, 0), '송금 합 = 받을 돈 합');
  // 달러 기준: 지출마다 센트로 바꿔 나눈다 (USD 10.00 / 3 → 3.34 + 3.33 + 3.33)
  tr.budget = { currency: 'KRW', krwPerUnit: 0, total: 0, base: 'USD', baseKrwPerUnit: 1000 };
  tr.expenses = [{ id: 'u', amount: 10000, cur: 'KRW', krw: 10000, payer: 'a' }];
  const u = S.settlement(tr, { unitsOf: (e) => B.expenseBaseUnits(e, tr.budget) });
  assert.equal(u.total, 1000);
  assert.deepEqual(u.people.map((p) => p.share), [334, 333, 333]);
});

test('P4-6: 배포 식별자 — 커밋 7자리를 메타에 넣고, 푸터에 보인다', () => {
  assert.equal(buildCommit({ VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890' }), 'abcdef1');
  assert.match(buildCommit({}), /^([0-9a-f]{7}|dev)$/);
  assert.match(withBuildMeta('<meta name="build-commit" content="dev">', '1234abc'), /content="1234abc"/);
  assert.match(read('index.html'), /<meta name="build-commit" content="[^"]+">/);
  assert.match(read('app.js'), /id="buildCommit"/);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.buildCommand, 'node scripts/build-version.mjs');
});

test('P4-6: 파비콘은 밝은 배지 + 흰 탭에서도 보이는 테두리, 다크 탭(#202124) 대비 충분', () => {
  const svg = read('icons/logo-xeno-route.svg');
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const fill = /fill="(#[0-9A-F]{6})" stroke="(#[0-9A-F]{6})"/i.exec(svg);
  assert.ok(ratio(fill[1], '#202124') > 10, '다크 탭 위 배지');
  assert.ok(ratio(fill[2], '#FFFFFF') >= 2.5, '흰 탭 위 배지 테두리');
  assert.ok(ratio('#18181B', fill[1]) > 15, '배지 위 경로 획');
});

test('P4-7: 잘못된 공유 주소는 404 (서버: 형식 오류·없는 링크·없는 경로), 404 페이지는 네 언어', async () => {
  const html = read('404.html');
  for (const s of ['페이지나 공유 링크를 찾을 수 없어요', 'Page or shared link not found', '找不到该页面或分享链接', 'ページまたは共有リンクが見つかりません']) assert.ok(html.includes(s));
  const port = 5300 + Math.floor(Math.random() * 400);
  const srv = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), SHARE_DIR: '/nonexistent-share-dir' }, stdio: 'pipe' });
  try {
    await new Promise((resolve, reject) => {
      srv.stdout.on('data', (d) => String(d).includes('http://') && resolve());
      srv.on('error', reject);
      setTimeout(() => reject(new Error('server start timeout')), 5000);
    });
    const get = (p) => fetch(`http://localhost:${port}${p}`);
    assert.equal((await get('/s/AAAAAAAA')).status, 404);
    const bad = await get('/s/bad');
    assert.equal(bad.status, 404);
    assert.match(await bad.text(), /XenoTravel · 404/);
    assert.equal((await get('/no/such/page')).status, 404);
    assert.equal((await get('/api/share/AAAAAAAA')).status, 404);
    const index = await (await get('/')).text();
    assert.match(index, /<meta name="build-commit" content="([0-9a-f]{7}|dev)">/);
    const v = await (await get('/version.json')).json();
    assert.match(v.commit, /^([0-9a-f]{7}|dev)$/);
  } finally {
    srv.kill();
  }
});

test('P4-7: 오프라인 → 온라인 복귀는 지도를 다시 맞추지 않고 확대·일차를 그대로 둔다', () => {
  const app = read('app.js');
  const fn = /function restoreTiles\(\) \{([\s\S]*?)\n\}/.exec(app)?.[1];
  assert.ok(fn);
  assert.match(fn, /map\.setView\(view\.center, view\.zoom/);
  assert.doesNotMatch(fn, /fit|focusList/);
  assert.match(app, /if \(!navigator\.onLine\) return;/, '오프라인 중 캐시 타일로 미니맵을 거두지 않는다');
});

/* ───────── 2단계: 일차 간 이동·복제 · 일자 순서 ───────── */

test('P4-8: 다른 일차로 이동 미리보기 — 항공편·숙소와 시간 충돌을 확정 전에 계산 (trip은 그대로)', () => {
  const tr = tripWith();
  const before = JSON.stringify(tr);
  const ok = D.placementPreview(tr, idOf(tr, 'A'), 3, 'move'); // 12:00 → Day 4 (귀국 14:00 전)
  assert.equal(ok.index, 1);
  assert.equal(ok.targetConflict, '');
  assert.equal(ok.flights[0].time, '14:00');
  const bad = D.placementPreview(tr, idOf(tr, 'E'), 0, 'copy'); // 09:00 → Day 1 (도착 11:00 전)
  assert.equal(bad.targetConflict, 'flight');
  assert.equal(bad.added, 1);
  const order = D.placementPreview(tr, idOf(tr, 'D'), 3, 'move'); // 15:00 → 귀국 14:00 이후
  assert.equal(order.targetConflict, 'flight');
  assert.equal(JSON.stringify(tr), before, '미리보기는 데이터를 바꾸지 않는다');
});

test('P4-8: 이동·복제는 시간순 자리에 넣고, 연속 실행 취소로 거꾸로 되돌린다', () => {
  const tr = tripWith();
  const start = names(tr);
  const mv = D.moveToDay(tr, idOf(tr, 'A'), 3);
  assert.deepEqual(names(tr), ['B', 'CD', 'E', 'FAG']);
  const cp = D.copyToDay(tr, idOf(tr, 'C'), 2);
  assert.deepEqual(names(tr), ['B', 'CD', 'EC', 'FAG']);
  assert.notEqual(cp.item.id, idOf(tr, 'C'));
  assert.equal(cp.item.visited, undefined);
  cp.undo(tr);
  mv.undo(tr);
  assert.deepEqual(names(tr), start);
  assert.equal(D.moveToDay(tr, idOf(tr, 'A'), 0), null, '같은 날 이동은 하지 않는다');
});

test('P4-8: 일자 순서 바꾸기 — 날짜·항공편은 그대로, 충돌 미리보기, 되돌리기', () => {
  const tr = tripWith();
  const dates = tr.days.map((d) => d.date);
  const p = D.dayOrderPreview(tr, [1, 0, 2, 3]);
  assert.ok(p.changed);
  assert.equal(p.added, 1, 'Day 2 묶음(10:00)이 Day 1(도착 11:00)로 오면 충돌 1건');
  assert.equal(D.dayOrderPreview(tr, [0, 0, 1, 2]).ok, false, '순열이 아니면 거부');
  const r = D.reorderDays(tr, [3, 1, 0, 2]);
  assert.deepEqual(names(tr), ['FG', 'CD', 'AB', 'E']);
  assert.deepEqual(tr.days.map((d) => d.date), dates);
  r.undo(tr);
  assert.deepEqual(names(tr), ['AB', 'CD', 'E', 'FG']);
  assert.deepEqual(D.moveInOrder([0, 1, 2], 0, 1), [1, 0, 2]);
  assert.deepEqual(D.moveInOrder([0, 1, 2], 0, -1), [0, 1, 2]);
});

/* ───────── 2단계: 일정 요약 이미지 ───────── */

test('P4-9: 요약 이미지 내용 — 여행명·날짜·대표 장소·동선만, 메모·예약번호·가계부 제외', () => {
  I.setLang('ko');
  const tr = tripWith();
  tr.days[0].items[0].memo = '메모 비밀';
  tr.days[0].items[0].address = '주소 비밀';
  tr.expenses = [{ id: 'x', amount: 1, cur: 'KRW', krw: 1, memo: '지출 비밀' }];
  const m = summaryModel(tr, { colors: ['#111111', '#222222'] });
  const text = JSON.stringify(m);
  for (const secret of ['메모 비밀', '주소 비밀', '지출 비밀', 'SECRET1', 'SECRET2']) assert.ok(!text.includes(secret), secret);
  assert.equal(m.title, 'T');
  assert.equal(m.days.length, 4);
  assert.deepEqual(m.days[0].places, ['A', 'B']);
  assert.equal(m.days[1].color, '#222222');
  const many = summaryModel({ ...tr, days: Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, date: '', items: [] })) }, { maxDays: 10 });
  assert.equal(many.hiddenDays, 4);
  const labels = {};
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    I.setLang(lang);
    labels[lang] = summaryModel(tr).days[0].label;
  }
  assert.deepEqual(labels, { ko: 'Day 1', en: 'Day 1', zh: '第1天', ja: '1日目' }, '네 언어 일차 이름');
  I.setLang('ko');
  assert.match(summaryFileName(tr, new Date('2026-11-20T12:00:00Z')), /^xenotravel-summary-T-2026-11-2\d\.png$/);
});

test('P4-9: 동선 투영은 칸 안에 들어가고, 긴 글자는 …로 자른다 (CJK 포함)', () => {
  const routes = [{ color: '#000', pts: [{ lat: 35.6, lng: 139.7 }, { lat: 35.7, lng: 139.8 }, { lat: 35.65, lng: 139.75 }] }];
  const box = { x: 10, y: 20, w: 300, h: 200, pad: 20 };
  for (const p of projectRoutes(routes, box)[0].pts) {
    assert.ok(p.x >= box.x + box.pad - 0.01 && p.x <= box.x + box.w - box.pad + 0.01);
    assert.ok(p.y >= box.y + box.pad - 0.01 && p.y <= box.y + box.h - box.pad + 0.01);
  }
  const measure = (s) => [...s].length * 10;
  assert.equal(fitText('東京スカイツリー展望デッキ', 60, measure), '東京スカイ…'); // 5글자 + … = 60px
  assert.equal(fitText('short', 100, measure), 'short');
  const lines = wrapText('Tokyo Skytree and Asakusa walking day', 120, measure, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => measure(l) <= 120));
});

/* ───────── 2단계: 스마트 체크리스트 ───────── */

test('P4-10: 추천 데이터는 네 언어가 모두 있고 그룹·여행 성격이 올바르다', () => {
  assert.ok(presets.items.length >= 30);
  const types = Object.keys(presets.types);
  for (const k of ['business', 'resort', 'shopping']) assert.ok(types.includes(k));
  for (const it of presets.items) {
    for (const l of ['ko', 'en', 'zh', 'ja']) assert.ok(it.text[l]?.trim(), `${it.id} ${l}`);
    assert.ok(C.CHECK_GROUPS[it.group], it.id);
    assert.ok(it.types.length && it.types.every((x) => types.includes(x)), it.id);
  }
  for (const d of Object.values(presets.durations)) for (const l of ['ko', 'en', 'zh', 'ja']) assert.ok(d[l]);
  assert.equal(C.durationKey(3), 'short');
  assert.equal(C.durationKey(4), 'mid');
  assert.equal(C.durationKey(8), 'long');
});

test('P4-10: 이미 있는 항목(다른 언어·기본 항목 포함)은 빼고, 고른 것만 추가 — 기존 항목·체크·지출은 그대로', () => {
  I.setLang('ko');
  const tr = M.createTrip({ title: 'T', startDate: '2026-12-20', endDate: '2026-12-23' });
  B.ensureBudget(tr);
  C.ensureChecks(tr);
  tr.checks.push({ id: 'mine', group: 'pack', text: 'Comfortable walking shoes', done: true, price: 50, cur: 'KRW' }); // 영어로 직접 넣은 같은 항목
  C.toggleCheck(tr, 'mine');
  C.toggleCheck(tr, 'mine');
  const before = JSON.stringify(tr.checks);
  const beforeExp = JSON.stringify(tr.expenses);
  const { items, skipped } = C.presetCandidates(tr, presets, { type: 'city', days: 4 });
  assert.ok(skipped.some((x) => x.id === 'walking-shoes'), '다른 언어로 이미 있는 항목은 뺀다');
  assert.ok(!items.some((x) => x.id === 'walking-shoes'));
  assert.ok(!items.some((x) => x.id === 'laundry-plan'), '6일 이상만 필요한 항목은 4일 여행에 안 나온다');
  const pick = items.slice(0, 2).map((x) => x.id);
  const added = C.addPresetItems(tr, presets, pick, { type: 'city', days: 4 });
  assert.deepEqual(added.map((c) => c.preset), pick, '고른 것만');
  assert.equal(JSON.stringify(tr.checks.slice(0, -2)), before, '기존 항목은 순서·글자·체크·가격 그대로');
  assert.equal(JSON.stringify(tr.expenses), beforeExp, '연결된 지출 그대로');
  assert.equal(C.presetCandidates(tr, presets, { type: 'city', days: 4 }).items.some((x) => pick.includes(x.id)), false, '두 번 넣지 않는다');
  I.setLang('ja');
  assert.equal(C.checkText(added[0]), presets.items.find((x) => x.id === pick[0]).text.ja, '고치지 않은 추천 항목은 언어를 따라간다');
  I.setLang('ko');
});

/* ───────── 2단계: 환율 스냅샷 · 결제수단 ───────── */

test('P4-11: 지출마다 기록 시점 환율을 남기고, 기준 환율을 바꿔도 과거 환산액은 그대로', () => {
  const tr = M.createTrip({ title: 'T', destination: '도쿄', startDate: '2026-12-20', endDate: '2026-12-21' });
  const b = B.ensureBudget(tr);
  b.krwPerUnit = 9.1;
  b.base = 'USD';
  b.baseKrwPerUnit = 1300;
  const e = B.addExpense(tr, { amount: 1000, cur: 'local', pay: 'cash' });
  assert.deepEqual([e.ccy, e.rate, e.krw, e.base, e.baseRate], ['JPY', 9.1, 9100, 'USD', 1300]);
  const units = B.expenseBaseUnits(e, b);
  assert.equal(units, 700); // 9100 / 1300 = $7.00
  b.krwPerUnit = 10; // 현지 환율 변경
  b.baseKrwPerUnit = 1500; // 기준 통화 환율 변경
  assert.equal(e.krw, 9100);
  assert.equal(B.expenseBaseUnits(e, b), 700, '기록할 때의 기준 환율 그대로');
  B.confirmCurrency(tr, 'TWD'); // 현지 통화를 바꿔도 이 기록은 엔으로 남는다
  assert.equal(e.ccy, 'JPY');
  // 기준 통화로 직접 적은 지출은 환산 없이 그 금액
  b.currency = 'USD';
  b.krwPerUnit = 1500;
  b.base = 'USD';
  const usd = B.addExpense(tr, { amount: 12.34, cur: 'local' });
  assert.equal(B.expenseBaseUnits(usd, b), 1234);
});

test('P4-11: 결제수단별 합계·건수, 목록 합 = 총합', () => {
  const tr = M.createTrip({ title: 'T', startDate: '2026-12-20', endDate: '2026-12-21' });
  const b = B.ensureBudget(tr);
  b.currency = 'KRW';
  B.addExpense(tr, { amount: 1000, cur: 'KRW', pay: 'cash' });
  B.addExpense(tr, { amount: 2500, cur: 'KRW', pay: 'card' });
  B.addExpense(tr, { amount: 500, cur: 'KRW', pay: 'cash' });
  const by = B.byPayment(tr);
  assert.deepEqual(by.cash, { units: 1500, count: 2 });
  assert.deepEqual(by.card, { units: 2500, count: 1 });
  assert.equal(B.spentUnits(tr), 4000);
  assert.equal(B.spentUnits(tr, (e) => e.pay === 'cash'), 1500);
});

test('P4-11: 예전 JSON 백업(결제수단·통화·환율 칸 없음)도 기본값으로 불러온다', () => {
  const old = {
    id: 'old', title: '예전 여행', days: [{ id: 'd1', date: '2026-01-01', items: [] }],
    budget: { currency: 'JPY', krwPerUnit: 9, total: 0 },
    expenses: [
      { id: 'a', amount: 1000, cur: 'local', krw: 9000, cat: 'food', day: 0 },
      { id: 'b', amount: '200', krw: null, day: '1', pay: 'bitcoin', cat: 'nope' },
      { id: 'c', amount: 5000, cur: 'KRW', krw: 5000 },
    ],
  };
  const tr = M.validateTrip(JSON.parse(JSON.stringify(old)));
  B.normalizeExpenses(tr);
  const [a, b2, c] = tr.expenses;
  assert.deepEqual([a.pay, a.ccy, a.rate, a.cur], ['card', 'JPY', 9, 'local']);
  assert.deepEqual([b2.pay, b2.cat, b2.amount, b2.day, b2.rate, b2.cur], ['card', 'etc', 200, 1, null, 'local']);
  assert.deepEqual([c.ccy, c.rate, c.day], ['KRW', 1, -1]);
  const again = JSON.stringify(tr.expenses);
  B.normalizeExpenses(tr);
  assert.equal(JSON.stringify(tr.expenses), again, '여러 번 불러도 같다');
  assert.match(read('app.js'), /B\.normalizeExpenses\(imported\)/, '백업 불러오기에서 기본값을 채운다');
});

test('P4-12: 새 모듈과 추천 데이터는 오프라인(서비스 워커)에 들어 있다', () => {
  const sw = read('sw.js');
  for (const f of ['lib/undo.js', 'lib/dayops.js', 'lib/summary.js', 'data/checklist-presets.json']) assert.ok(sw.includes(`'${f}'`), f);
});

/* ───────── GPT 교차 검수 1차 (2026-11-20) 반영 ───────── */

test('R1-3: 항공편 시각이 글자가 아니면(숫자 등) 백업을 거부한다 — 화면이 .slice()에서 멈추지 않게', () => {
  const base = { id: 'x', title: 'T', days: [{ id: 'd', date: '2026-01-01', items: [] }] };
  const fl = (patch) => ({ ...base, flights: [{ id: 'f', departAt: '2026-01-01T09:00', ...patch }] });
  assert.throws(() => M.validateTrip(fl({ arriveAt: 123 })));
  assert.throws(() => M.validateTrip(fl({ departAt: 5 })));
  assert.throws(() => M.validateTrip(fl({ flightNo: 7 })));
  assert.doesNotThrow(() => M.validateTrip(fl({ arriveAt: '' })));
  assert.equal(M.validateTrip(fl({})).flights[0].arriveAt, '', '예전 백업에서 빠진 칸만 기본값');
});

test('R1-4: 읽지 못해 뺀 지출·체크 수를 알려 주고(저장 데이터에는 안 들어감), 덮어쓰기 대신 사본만', () => {
  const tr = M.validateTrip({
    id: 'x', title: 'T', days: [{ id: 'd', date: '2026-01-01', items: [] }],
    expenses: [{ id: 'a', amount: 1 }, { id: 'b', amount: 'abc' }],
    checks: [{ id: 'c', text: 'ok' }, { id: 'd' }],
  });
  assert.deepEqual(tr.dropped, { expenses: 1, checks: 1 });
  assert.ok(!('dropped' in JSON.parse(JSON.stringify(tr))), '저장할 JSON에는 없다');
  const app = read('app.js');
  assert.match(app, /actions: same \|\| dropped \? \[\{ value: 'copy'/);
});

test('R1-1·7·14·16: 저장 실패 시 성공 알림 금지 · 일반 알림이 실행 취소를 지우지 않음 · 날짜 칩 포커스 · 잘못된 주소', () => {
  const app = read('app.js');
  assert.match(app, /const r = switchTrip\(imported, \{ save: true \}\);\n  if \(r\?\.ok\)/, '백업 불러오기는 실제 저장 성공 후에만 알린다');
  assert.match(app, /const r = switchTrip\(copy, \{ save: true \}\);\n  if \(r\?\.ok\)/, '공유 사본 저장도 마찬가지');
  assert.match(app, /if \(!action && undoStack\.size\(\)\) \{/, '실행 취소가 남아 있으면 일반 알림에도 버튼을 둔다');
  assert.ok(app.indexOf('const undoStack = createUndoStack()') < app.indexOf('function toast('), '시작 중 알림도 안전하게 (TDZ 없음)');
  assert.match(app, /if \(hadFocus\) \$\(`#dayTabs \[data-day="\$\{i\}"\]`\)\?\.focus/);
  assert.match(app, /id = m\[1\]; \/\/ 잘못된 % 인코딩/);
});

test('R1-8·12: 검색어가 바뀐 뒤 Enter는 옛 결과를 넣지 않고, 결과는 listbox/option + 추가 버튼', () => {
  const app = read('app.js');
  assert.match(app, /const p = ui\.resultsFor === searchEl\.value\.trim\(\) \? ui\.results\[ui\.activeResult\] : null;/);
  assert.match(app, /role="option" aria-selected=/);
  assert.match(app, /searchEl\.setAttribute\('aria-activedescendant'/);
  assert.match(app, /class="r-add" data-add=/);
});

test('R1-9·13: 고정 안내는 쌓이고(오프라인 → 저장 오류 → 날짜 칩), 경고·완료 글자는 AA 대비', () => {
  const css = read('styles.css');
  assert.match(css, /\.daytabs \{ top: calc\(var\(--head\) \+ var\(--offbar, 0px\) \+ var\(--savebar, 0px\)\); \}/);
  assert.match(css, /\.save-bar \{ top: calc\(var\(--head\) \+ var\(--offbar, 0px\)\); \}/);
  assert.match(css, /\.time-warn\.flight \.tw-badge[^{]*\{ color: color-mix\(in srgb, var\(--warn\) 50%, var\(--ink\)\); \}/);
});
