// docs/qa-2026-11-23.md Phase 1 (P0) 회귀 테스트
import test from 'node:test';
import { appSource } from './helpers/app-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');
const place = (id, name = id) => ({ id, name, lat: 30.75, lng: 120.76, address: '', time: '', memo: '', url: '', category: '' });

/** Day 1 장소 · 숙소(Day 1부터 2박) · Day 1 지출이 있는 여행 */
function sample(start, end) {
  const t = M.createTrip({ title: 'J', startDate: start, endDate: end });
  t.days[0].items.push(place('a', '南湖'));
  M.addStay(t, { name: 'H', lat: 30.75, lng: 120.76 }, 0, 2);
  B.addExpense(t, { amount: 10, cur: 'CNY', cat: 'food', pay: 'card', day: 0 });
  return t;
}
const where = (t) => ({
  place: t.days.find((d) => d.items.some((x) => x.id === 'a'))?.date,
  checkIn: M.stayDates(t, t.stays[0]).checkIn,
  expense: t.days[B.expenseDay(t, t.expenses[0])]?.date,
});

for (const [label, start, end, earlier] of [
  ['다가올 여행', '2026-11-23', '2026-12-12', '2026-11-22'],
  ['지난 여행(복기)', '2025-10-13', '2025-10-17', '2025-10-12'],
]) {
  test(`P0-9: ${label} — 시작일을 하루 앞당겨도(날짜 기준 유지) 장소·숙소·지출이 원래 날짜에 남는다`, () => {
    const t = sample(start, end);
    const before = where(t);
    assert.deepEqual(before, { place: start, checkIn: start, expense: start });
    const impact = M.dateChangeImpact(t, earlier, end, { keepDates: true });
    assert.equal(impact.places.length + impact.expenses.length + impact.stays.length, 0);
    M.setTripDates(t, earlier, end, { keepDates: true });
    assert.equal(t.days[0].date, earlier);
    assert.equal(t.days[0].items.length, 0, '앞에 빈 날이 생긴다');
    assert.deepEqual(where(t), before);
  });

  test(`P0-9: ${label} — "일차 기준 유지"는 두 번째 선택지로 남아 모두 같이 민다`, () => {
    const t = sample(start, end);
    M.setTripDates(t, earlier, end);
    assert.deepEqual(where(t), { place: earlier, checkIn: earlier, expense: earlier });
  });
}

test('P0-9: 시작일을 늦추면 잘려 나간 날의 장소는 보관함, 지출은 일정 외, 숙소는 남는 밤만', () => {
  const t = sample('2026-11-23', '2026-11-26');
  M.setTripDates(t, '2026-11-24', '2026-11-26', { keepDates: true });
  assert.deepEqual(t.inbox.map((x) => x.id), ['a']);
  assert.equal(B.expenseDay(t, t.expenses[0]), 'out');
  assert.equal(t.expenses[0].date, '2026-11-23');
  assert.deepEqual([t.stays[0].startIndex, t.stays[0].nights], [0, 1]);
  // 다시 늘리면 일정 외 지출은 원래 날짜로 돌아온다
  M.setTripDates(t, '2026-11-23', '2026-11-26', { keepDates: true });
  assert.equal(t.days[B.expenseDay(t, t.expenses[0])].date, '2026-11-23');
});

test('P0-9: 숙소 기간 밖 날짜 → 늘릴 기간 (체크아웃 날은 밤이 아니라 포함하지 않는다)', () => {
  const t = sample('2026-11-23', '2026-12-12');
  assert.deepEqual(M.extendedRange(t, '2026-11-22', '2026-11-24', { checkout: true }), { start: '2026-11-22', end: '2026-12-12', tooLong: false });
  assert.equal(M.extendedRange(t, '2026-12-10', '2026-12-13', { checkout: true }), null, '마지막 날 다음 날 체크아웃은 기간 안');
  assert.deepEqual(M.extendedRange(t, '2026-12-11', '2026-12-15', { checkout: true }), { start: '2026-11-23', end: '2026-12-14', tooLong: false });
  const r = M.extendedRange(t, '2026-11-22', '2026-11-24', { checkout: true });
  M.setTripDates(t, r.start, r.end, { keepDates: true });
  assert.deepEqual(M.rangeFromDates(t, '2026-11-22', '2026-11-24'), { startIndex: 0, nights: 2 });
  assert.equal(where(t).place, '2026-11-23');
});

test('P0-9: 숙소 달력은 여행 기간 밖을 막지 않고 흐리게만 (data-dp-soft-*)', () => {
  const app = appSource();
  assert.doesNotMatch(app, /inEl\.min = M\.dateAtIndex\(trip, 0\)/);
  assert.match(app, /data-dp-soft-min=/);
  assert.match(app, /data-dp-soft-max=/);
  assert.match(read('lib/datepicker.js'), /getDayParts/);
  assert.match(read('styles.css'), /::part\(off-trip\)/);
  assert.match(app, /extendTripFor\(checkIn, checkOut, \{ checkout: true \}\)/);
});

test('P0-2: 기간 밖 출국편은 Day 1 맨 위(전날 출발), 귀국편은 마지막 날 맨 아래, 이동편은 날짜로', () => {
  const t = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-12-12' });
  M.addFlight(t, { kind: 'out', flightNo: 'OZ367', from: 'ICN', to: 'PVG', departAt: '2026-11-22T20:45', arriveAt: '2026-11-22T21:55' });
  M.addFlight(t, { kind: 'out', flightNo: 'OZ361', from: 'ICN', to: 'PVG', departAt: '2026-11-22T08:00', arriveAt: '2026-11-22T09:10' });
  M.addFlight(t, { kind: 'in', flightNo: 'OZ368', from: 'PVG', to: 'ICN', departAt: '2026-12-13T01:10', arriveAt: '2026-12-13T04:00' });
  M.addFlight(t, { kind: 'move', flightNo: 'MU1', from: 'PVG', to: 'PEK', departAt: '2026-12-20T10:00' });
  const day1 = M.flightsForDay(t, 0);
  assert.deepEqual(day1.map((x) => x.flight.flightNo), ['OZ361', 'OZ367'], '여러 개면 시간순');
  assert.ok(day1.every((x) => x.role === 'pinned' && x.offset === -1));
  assert.equal(M.pinnedFlightNote(day1[0]), '전날 출발');
  const last = M.flightsForDay(t, t.days.length - 1);
  assert.deepEqual(last.map((x) => [x.flight.flightNo, M.pinnedFlightNote(x)]), [['OZ368', '다음 날 출발']]);
  assert.equal(t.days.slice(1, -1).flatMap((_, i) => M.flightsForDay(t, i + 1)).length, 0, '이동편은 기간 밖이라 안 보인다');
  // 전날 밤 도착은 Day 1 시간 범위에 영향을 주지 않는다
  assert.deepEqual(M.flightTimeBounds(day1), { after: '', before: '' });
  const notices = M.tripNotices(t).join(' ');
  assert.match(notices, /기간 밖 항공편 1개/, '이동편만 경고');
  // 인쇄·엑셀(tripToRows)·하루 공유 글에도 같은 위치
  assert.ok(M.tripToRows(t).some((r) => r.일차 === 'Day 1' && /OZ367/.test(r.장소)));
  assert.match(M.dayShareText(t, 0), /OZ367.*전날 출발/);
});

test('P0-2: 기간 안 항공편은 지금처럼 날짜로 붙고 도착 시각이 그날 시간 범위가 된다', () => {
  const t = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-11-25' });
  M.addFlight(t, { kind: 'out', from: 'ICN', to: 'PVG', departAt: '2026-11-23T09:00', arriveAt: '2026-11-23T10:10' });
  const d = M.flightsForDay(t, 0);
  assert.equal(d[0].role, 'both');
  assert.equal(M.flightTimeBounds(d).after, '10:10');
  assert.equal(M.pinnedFlight(t, t.flights[0]), null);
});

import * as C from '../public/lib/checklist.js';

function checkTrip() {
  const t = M.createTrip({ title: 'J', destination: '도쿄', startDate: '2026-11-23', endDate: '2026-11-25' });
  B.ensureBudget(t);
  const a = C.addCheck(t, 'shop', 'A');
  const b = C.addCheck(t, 'shop', 'B');
  C.setPrice(t, a.id, 100);
  C.setPrice(t, b.id, 200);
  return { t, a, b };
}

test('P0-3: 자동 기록 그대로인 지출은 체크 해제 때 함께 지우고, 고친 지출은 "고침"으로 구분한다', () => {
  const { t, a } = checkTrip();
  C.toggleCheck(t, a.id, '2026-11-23');
  const e = C.linkedExpense(t, a.id);
  assert.ok(e);
  assert.equal(C.expenseEdited(t, a), false);
  const r = C.toggleCheck(t, a.id, '2026-11-23', { dropExpense: true });
  assert.equal(r.removed, e);
  assert.equal(C.linkedExpense(t, a.id), null);
  C.toggleCheck(t, a.id, '2026-11-23');
  B.updateExpenseAmount(t, C.linkedExpense(t, a.id).id, 130);
  assert.equal(C.expenseEdited(t, a), true);
  C.toggleCheck(t, a.id, '2026-11-23'); // 체크만 해제
  assert.ok(C.linkedExpense(t, a.id), '지출은 남는다');
});

test('P0-4: 전체 해제 + 지출 삭제는 고친 지출만 남긴다', () => {
  const { t, a, b } = checkTrip();
  C.setGroupDone(t, 'shop', true, '2026-11-23');
  assert.equal(t.expenses.length, 2);
  B.updateExpenseAmount(t, C.linkedExpense(t, b.id).id, 250);
  const removed = C.setGroupDone(t, 'shop', false, '2026-11-23', { dropExpenses: true });
  assert.deepEqual(removed.map((e) => e.checkId), [a.id]);
  assert.deepEqual(t.expenses.map((e) => e.checkId), [b.id]);
  assert.ok(t.checks.every((c) => !c.done));
});

test('P0-3·P0-4: 확인 창 선택지와 실행 취소, 가계부의 출처 아이콘', () => {
  const app = appSource();
  assert.match(app, /value: 'drop', label: t\('지출도 삭제'\)/);
  assert.match(app, /value: 'drop', label: t\('체크 해제 \+ 지출 \{n\}건 삭제'/);
  assert.match(app, /t\('직접 고친 지출 \{n\}건은 남겨요'/);
  assert.match(app, /pushUndo\(t\('체크를 풀고 가계부 지출 \{amount\}도 지웠어요'/);
  assert.match(app, /class="src-tag"/);
});

test('P0-5: 날짜별 막대 — 20일은 일차별 + 라벨 간격, 30일 이상은 주 단위, 카드 폭을 넘지 않는 CSS', () => {
  const t20 = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-12-12' });
  const by = Object.fromEntries(t20.days.map((_, i) => [i, 10]));
  const a = B.dayBars(t20, by);
  assert.equal(a.bars.filter((x) => x.kind === 'day').length, 20);
  assert.equal(a.step, 3);
  assert.deepEqual(a.bars.filter((x) => x.kind === 'day' && x.label).map((x) => x.key), [2, 5, 8, 11, 14, 17]);
  assert.ok(a.bars[0].kind === 'pre' && a.bars[0].label);
  const t40 = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2027-01-01' });
  const by40 = Object.fromEntries(t40.days.map((_, i) => [i, 1]));
  const w = B.dayBars(t40, { ...by40, out: 5 });
  const weeks = w.bars.filter((x) => x.kind === 'week');
  assert.equal(weeks.length, 6);
  assert.deepEqual(weeks.map((x) => x.value), [7, 7, 7, 7, 7, 5], '마지막 주는 남은 날만');
  assert.equal(w.bars.at(-1).kind, 'out');
  const css = read('styles.css');
  assert.match(css, /\.daybars \{[^}]*overflow: hidden/);
  assert.match(css, /\.daybars div \{[^}]*min-width: 0/);
});

test('P0-6: 대화상자 공통 규칙 — 600px 이상 가운데 모달, 600px 미만 폭 100% 바텀시트(새 여행 모달 포함)', () => {
  const css = read('styles.css');
  assert.match(css, /dialog:modal \{ margin: auto; \}/);
  const sheet = css.match(/@media \(max-width: 599px\) \{\s*dialog:modal,([^{]*)\{([^}]*)\}/);
  assert.ok(sheet, '600px 미만 시트 규칙');
  assert.match(sheet[1], /dialog#new-trip-modal:modal/);
  assert.match(sheet[2], /width: 100%; max-width: 100%; margin: auto 0 0;/);
  assert.match(sheet[2], /dvh/);
  assert.match(sheet[2], /safe-area-inset-bottom/);
  assert.match(css, /#new-trip-modal \{ width: min\(560px, calc\(100vw - 32px\)\);/);
  // 900px 구간에 데스크톱 폭과 섞이던 시트 규칙이 남지 않는다
  assert.doesNotMatch(css, /@media \(max-width: 900px\) \{[^@]*dialog, dialog#flightDialog, dialog\.share-dialog, dialog\.bulk-dialog \{\s*width: 100%/);
});

import vm from 'node:vm';
import * as I from '../public/lib/i18n.js';

/** public/boot.js를 가짜 브라우저에서 돌려 <html lang>을 얻는다 */
function bootLang(languages, saved = null) {
  const root = { lang: 'ko', dataset: {}, classList: { toggle() {} } };
  const ctx = {
    document: { documentElement: root },
    navigator: { languages, language: languages[0] },
    localStorage: { getItem: (k) => (k === 'xenotravel:lang' ? saved : null) },
    matchMedia: () => ({ matches: false }),
    JSON,
    String,
  };
  vm.runInNewContext(read('boot.js'), ctx);
  return root.lang;
}

test('P0-7: 저장값이 없으면 브라우저 언어 — 앱(detectLang)과 첫 화면(boot.js)이 같은 규칙', () => {
  const HTML = { ko: 'ko', en: 'en', zh: 'zh-Hans', ja: 'ja' };
  const cases = [
    [['ko-KR', 'en-US'], 'ko'], [['ja'], 'ja'], [['zh-CN'], 'zh'], [['zh-SG'], 'zh'], [['zh-Hans-CN'], 'zh'],
    [['zh-TW'], 'zh'], [['zh-HK'], 'zh'], [['zh-Hant'], 'zh'], [['en-GB'], 'en'], [['fr-FR', 'de'], 'en'],
    [['fr-FR', 'ja-JP'], 'ja'], [['kok'], 'en'], [[], 'en'],
  ];
  for (const [langs, want] of cases) {
    assert.equal(I.detectLang(langs), want, langs.join(','));
    assert.equal(bootLang(langs), HTML[want], `boot.js ${langs.join(',')}`);
  }
  assert.equal(bootLang(['ko-KR'], 'ja'), 'ja', '언어 버튼으로 고른 값이 먼저');
  assert.equal(bootLang(['ko-KR'], 'xx'), 'ko');
});

test('P0-7: 언어는 언어 버튼을 누를 때만 저장한다', () => {
  const app = appSource();
  assert.equal([...app.matchAll(/\bsaveLang\(\)/g)].length, 1);
  assert.match(app, /setLang\(button\.dataset\.lang\);\n  saveLang\(\);/);
});

test('P0-8: 여행 페이지 "요즘 뜨는 곳"은 여행지 도시만 — 도시 선택 칸 없음, 데이터가 없으면 접힌 한 줄 안내', () => {
  const app = appSource();
  assert.doesNotMatch(app, /class="trend-city"/);
  assert.doesNotMatch(app, /trip\.trendCity = /);
  const fn = app.slice(app.indexOf('function currentCity()'), app.indexOf('function findTrend('));
  assert.doesNotMatch(fn, /trendCity/);
  assert.match(app, /trend-empty card/);
  assert.match(app, /data-action="trend-search"/);
});

import * as Dest from '../public/lib/destinations.js';

test('P0-1: 자동완성 목록의 도시는 고정 좌표·국가 코드 — 4개 국어 이름·영어·별칭 모두 같은 도시', () => {
  for (const q of ['자싱', 'Jiaxing', '嘉兴', 'jiaxing ']) {
    const r = Dest.resolveDestination(q);
    assert.equal(r?.country, 'cn', q);
    assert.ok(Math.abs(r.lat - 30.75) < 0.1 && Math.abs(r.lng - 120.76) < 0.1, q);
  }
  for (const d of Dest.DESTINATIONS) {
    assert.match(d.cc, /^[a-z]{2}$/);
    assert.ok(Number.isFinite(d.lat) && Number.isFinite(d.lng), d.value);
  }
  assert.equal(Dest.resolveDestination('자싱 맛집 투어'), null, '정확히 같은 이름만');
  const trendCity = { id: 'osaka-x', name: '나라', center: { lat: 34.68, lng: 135.8 }, country: 'JP' };
  assert.equal(Dest.resolveDestination('나라', [trendCity]).country, 'jp');
  const app = appSource();
  assert.match(app, /let found = resolveDestination\(destination, trends\.cities\);\n  if \(!found\) \{/, '목록 도시는 지오코딩하지 않는다');
});

test('P0-1: 저장된 여행 좌표 고치기 — 목록 도시면 도시 좌표, 아니면 장소 평균과 300km 넘게 멀 때 장소 평균', () => {
  const bad = { destination: '자싱', center: { lat: 24.14, lng: 74.95 }, country: 'in', days: [{ items: [] }], inbox: [], stays: [] };
  assert.equal(Dest.repairTripCenter(bad), true);
  assert.equal(bad.country, 'cn');
  assert.ok(Math.abs(bad.center.lat - 30.75) < 0.1);
  assert.equal(Dest.repairTripCenter(bad), false, '두 번째는 그대로');
  const other = { destination: '어딘가', center: { lat: 24.14, lng: 74.95 }, country: 'in', days: [{ items: [place('a'), place('b')] }], inbox: [], stays: [] };
  assert.equal(Dest.repairTripCenter(other), true);
  assert.ok(Math.abs(other.center.lat - 30.75) < 0.01);
  assert.equal(other.country, undefined);
  const near = { destination: '어딘가', center: { lat: 30.9, lng: 120.9 }, days: [{ items: [place('a')] }], inbox: [], stays: [] };
  assert.equal(Dest.repairTripCenter(near), false, '300km 안이면 그대로');
});

test('P0-1: 목록 밖 도시 지오코딩은 고른 국가와 다른 결과를 버린다', async () => {
  const { geocodeDestination } = await import('../public/lib/geo.js');
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ lat: '24.14', lon: '74.95', address: { country_code: 'in' } }]), { headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal(await geocodeDestination('자싱', undefined, { country: 'cn', en: 'Jiaxing' }), null);
    assert.match(calls[0], /countrycodes=cn/);
    assert.match(calls[0], /q=Jiaxing/);
    assert.equal((await geocodeDestination('어딘가'))?.country, 'in', '국가를 모르면 그대로');
  } finally {
    globalThis.fetch = orig;
  }
});

import * as Bk from '../public/lib/backup.js';

test('F-1: 백업 권유 — 출발 7일 전, 여행 끝난 다음 날, 큰 변경 20회 (한 번 권한 이유는 key로 구분)', () => {
  const trip = { startDate: '2026-12-10', endDate: '2026-12-15' };
  const at = (d) => Date.parse(`${d}T12:00:00`);
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-01') }), null);
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-03') })?.reason, 'before');
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-05'), last: at('2026-12-04') }), null, '권유 기간에 이미 백업');
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-12') }), null, '여행 중');
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-16'), last: at('2026-12-03') })?.reason, 'after');
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-12'), changes: 20 })?.reason, 'changes');
  assert.equal(Bk.backupReason(trip, { now: at('2026-12-12'), changes: 19 }), null);
  assert.equal(Bk.lastBackupLabel(0), '아직 백업하지 않았어요');
  assert.equal(Bk.lastBackupLabel(at('2026-12-01'), at('2026-12-04')), '마지막 백업: 3일 전');
});

test('F-1: 첫 저장 때 영구 저장 요청, 메뉴에 마지막 백업 표시, 백업하면 변경 횟수 초기화', () => {
  const app = appSource();
  assert.match(app, /navigator\.storage\.persist\(\)/);
  assert.match(app, /if \(r\.ok && !auto\) afterUserSave\(\);/);
  assert.match(app, /\$\('#backupAge'\)\.textContent = /);
  assert.match(app, /if \(prefs\.changes\) prefs\.changes\[trip\.id\] = 0;/);
  assert.match(read('index.html'), /id="backupAge"/);
});

test('교차 리뷰 #1: 최대 일수를 넘는 늘리기는 하지 않는다 (끝쪽 날이 잘리지 않게)', () => {
  const t = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2027-01-21' }); // 60일
  assert.equal(t.days.length, M.MAX_DAYS);
  assert.equal(M.extendedRange(t, '2026-11-22', '2026-11-24', { checkout: true }).tooLong, true);
  const short = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-11-30' });
  assert.equal(M.extendedRange(short, '2026-11-22', '2026-11-24', { checkout: true }).tooLong, false);
  assert.match(appSource(), /if \(r\.tooLong\) \{/);
});

test('교차 리뷰 #2: 통화만 바꾼 지출도 "고친 지출", 예전 기록(auto 없음)은 물어본다', () => {
  const { t, a } = checkTrip();
  C.toggleCheck(t, a.id, '2026-11-23');
  const e = C.linkedExpense(t, a.id);
  assert.equal(C.expenseEdited(t, a), false);
  e.cur = 'KRW';
  assert.equal(C.expenseEdited(t, a), true);
  e.cur = e.auto.cur;
  delete e.auto;
  assert.equal(C.expenseEdited(t, a), true);
});

test('교차 리뷰 #3·#4·#6·#7·#8: 실행 취소는 날짜로 복원, 직접 고른 위치 유지, 일차 기준 결과 미리보기, 열 때 백업 권유, 트렌드는 이름 일치만', () => {
  const app = appSource();
  assert.match(app, /const i = ctx\.trip\.days\.findIndex\(\(d\) => d\.date === date\);/);
  assert.match(app, /trip\.centerManual = true;/);
  assert.match(app, /if \(trip\.centerManual\) return;/);
  const manual = { destination: '자싱', center: { lat: 35, lng: 139 }, centerManual: true, days: [{ items: [] }] };
  assert.equal(Dest.repairTripCenter(manual), false);
  assert.match(app, /const byIndex = M\.dateChangeImpact\(trip, start, end\);/);
  assert.match(app, /ui\.nagChecked = trip\.id;/);
  const fn = app.slice(app.indexOf('function currentCity()'), app.indexOf('function findTrend('));
  assert.doesNotMatch(fn, /nearestCity/);
});

test('교차 리뷰 #5: 전날 밤 출발해 Day 1에 도착하는 출국편은 도착 시각 그대로 + "전날 출발"', () => {
  const t = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-11-25' });
  M.addFlight(t, { kind: 'out', from: 'ICN', to: 'PVG', departAt: '2026-11-22T22:00', arriveAt: '2026-11-23T01:00' });
  const [x] = M.flightsForDay(t, 0);
  assert.equal(x.role, 'arrive');
  assert.equal(M.pinnedFlightNote(x), '전날 출발');
  assert.equal(M.flightTimeBounds([x]).after, '01:00');
  assert.match(appSource(), /if \(trip\.startDate && \(dep < trip\.startDate \|\| dep > trip\.endDate\)\) \{/);
});
