import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as C from '../public/lib/checklist.js';
import * as W from '../public/lib/weather.js';
import { stayRangeWithin } from '../public/lib/stays.js';
import { encodeShare, decodeShare, sharedCopy } from '../public/lib/share.js';
import { privacySections } from '../public/lib/privacy.js';
import { appStorageKeys } from '../public/lib/store.js';
import { downloadAllTrips } from '../public/lib/export.js';
import { MESSAGES } from '../public/lib/messages.js';

const read = (file) => readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const app = read('app.js');
const html = read('index.html');
const check = read('pages/check.js');
const budget = read('pages/budget.js');
const plan = read('pages/plan.js');
const map = read('map/map.js');
const picking = read('map/picking.js');
const point = { name: 'Museum', lat: 35, lng: 139 };
const trip = () => M.createTrip({ title: 'Old trip', startDate: '2020-01-10', endDate: '2020-01-12', center: point });
const flight = {
  kind: 'out', flightNo: 'KE101', from: 'ICN', to: 'HND',
  departAt: '2020-01-10T07:00', arriveAt: '2020-01-10T09:00', bookingRef: 'FLIGHT-REF',
};

test('P3-1: past trips support place, stay, flight, expense and checklist edits', () => {
  const t = trip();
  assert.equal(M.tripEnded(t, '2026-11-23'), true);
  const place = M.addItem(t, t.days[0].id, point);
  M.moveItem(t, place.id, t.days[1].id, 0);
  place.memo = 'Museum notes';
  place.visited = true;
  assert.equal(M.findItem(t, place.id).listId, t.days[1].id);

  const range = stayRangeWithin(t, '2020-01-10', '2020-01-11');
  const stay = M.addStay(t, point, range.startIndex, range.nights);
  M.updateStayRange(t, stay.id, { startIndex: 1, nights: 2 });
  assert.deepEqual(M.stayDates(t, stay), { checkIn: '2020-01-11', checkOut: '2020-01-13' });

  const f = M.addFlight(t, flight);
  assert.equal(M.updateFlight(t, f.id, { ...flight, memo: 'Airport notes' }).memo, 'Airport notes');
  const expense = B.addExpense(t, { amount: 1500, cur: 'KRW', day: 0 });
  assert.equal(B.updateExpense(t, expense.id, { amount: 2000, day: 1 }).amount, 2000);
  assert.equal(B.spentUnits(t), 2000);
  const item = C.addCheck(t, 'shop', 'Souvenir');
  C.toggleCheck(t, item.id, '2026-11-23');
  assert.deepEqual(C.progress(t, 'shop'), { done: 1, total: 1 });

  const restored = M.validateTrip(JSON.parse(JSON.stringify(t)));
  assert.equal(restored.days[1].items[0].memo, 'Museum notes');
  assert.equal(restored.days[1].items[0].visited, true);
  assert.equal(restored.checks.find((c) => c.id === item.id).done, true);
  assert.equal(M.removeItem(t, place.id), true);
  assert.equal(M.removeStay(t, stay.id), true);
  assert.equal(M.removeFlight(t, f.id), true);
  B.removeExpense(t, expense.id);
  C.removeCheck(t, item.id);
  assert.equal(B.spentUnits(t), 0);
  assert.equal(C.progress(t, 'shop').total, 0);
});

test('P3-1: plan card and editing routes are wired without date lockouts', () => {
  assert.match(html, /id="retrospective"[^>]+hidden/);
  const card = /function renderRetrospective\(\) \{[\s\S]+?\n\}/.exec(app)[0];
  assert.match(card, /!M\.tripEnded\(trip, TODAY\)/);
  assert.match(card, /B\.spentUnits\(trip\)/);
  assert.match(card, /places\.filter\(\(place\) => place\.visited\)/);
  assert.match(card, /esc\(entry\.memo\)/);
  assert.match(plan, /found\.item\.visited = e\.target\.checked;\s+commit\(\)/);
  assert.doesNotMatch(app, /\.min\s*=\s*TODAY|setAttribute\(['"]min['"], TODAY\)/);
  assert.doesNotMatch(app, /ui\.readonly\s*=\s*.*(?:tripEnded|endDate)/);
  for (const [source, calls] of [
    [app, ['M.addItem(trip, target', 'M.updateFlight(trip, ui.editFlight']],
    [plan, ['M.addStay(ctx.trip, place, range.startIndex']],
    [budget, ['B.addExpense(ctx.trip, data)', 'B.updateExpense(ctx.trip, id, data)']],
    [check, ['C.addCheck(ctx.trip,', 'C.toggleCheck(ctx.trip,']],
  ]) for (const call of calls) assert.ok(source.includes(call), call);
});

test('P3-1: mixed-date weather skips past dates and failed forecasts produce no chip', async () => {
  const t = trip();
  assert.deepEqual(W.planRequests(t, '2020-01-13'), []);
  const today = '2020-01-11';
  const requests = W.planRequests(t, today);
  assert.deepEqual(requests.flatMap((req) => req.days.map((d) => d.date)), ['2020-01-11', '2020-01-12']);
  const result = await W.loadWeather(t, today, { fetch: async () => ({ ok: false }), storage: null });
  assert.deepEqual(result, {});
  assert.match(app, /if \(!w \|\| !wxDayVisible\(dayId\)\) return ''/);
  assert.match(app, /if \(!w\?\.wet \|\| !wxDayVisible\(dayId\)\) return ''/);
});

test('P3-2: list tabs, all routes, and bottom sheet share the map day and invalidate stale popups', () => {
  assert.match(app, /\$\('#dayTabs'\)\.addEventListener\('click'[\s\S]*?selectDay\(i\)/);
  assert.match(app, /function selectDay\([\s\S]*?ui\.day = [\s\S]*?ui\.focusList = id;[\s\S]*?renderMap\(/);
  const tab = /function showTab\(tab\) \{[\s\S]+?\n\}/.exec(app)[0];
  assert.match(tab, /tab === 'map'[\s\S]*?renderMap\(/);
  assert.doesNotMatch(tab, /ui\.(?:day|focusList)\s*=/);
  assert.match(map, /function showAllRoutes\(\) \{\s*clearMapActive\(\);\s*ui\.focusList = null;[\s\S]*?renderMap\(/);
  assert.match(map, /if \(ui\.focusList == null\) return selectDay\(ui\.day, \{ scroll: false \}\)/);
  assert.match(html, /id="msDay" data-ui-select/);
  assert.match(map, /\$\('#msDay'\)\.addEventListener\('change'[\s\S]*?selectDay\(index, \{ scroll: false \}\)/);
  assert.match(map, /mapDayContext = .*ui\.day, ui\.focusList/);
  assert.match(map, /if \(locationChoice && locationChoice\.context !== mapDayContext\(\)\) map\.closePopup/);
});

test('P3-2: all-route popup waits for an explicit day and both actions use that day', () => {
  const popup = /^  async function showLocationChoices\([\s\S]+?\n  \}/m.exec(picking)[0];
  assert.match(popup, /let dayId = all \? '' : ui\.focusList/);
  assert.match(popup, /<select data-ui-select[^>]*>\s*<option value="">/);
  assert.match(popup, /select\.addEventListener\('change'[\s\S]*?dayId = select\.value;\s*updateActions/);
  assert.match(popup, /item\.disabled = start < 0;\s*stay\.disabled = start < 0/);
  assert.match(popup, /addPlace\(place, \{ edit: true, listId: dayId \}\)/);
  assert.match(popup, /ctx\.openStays\(\{ place, start \}\)/);
  assert.match(plan, /const nights = Math.min\(place \? 1 : M.DEFAULT_NIGHTS/);
  for (const key of ['+ 이 위치 추가 ({day})', '숙소로 추가 ({day}부터 1박)']) {
    assert.ok(popup.includes(key));
    assert.equal(MESSAGES[key].length, 3);
    for (const translation of [key, ...MESSAGES[key]]) assert.match(translation, /\{day\}/);
  }
});

test('P3-3: Shopping at 0/0 shows the empty hint and disables both bulk actions', () => {
  const t = trip();
  C.ensureChecks(t);
  assert.deepEqual(C.progress(t, 'shop'), { done: 0, total: 0 });
  assert.deepEqual(C.bulkDeleteOptions(t, 'shop'), { done: 0, total: 0, options: [] });
  assert.match(check, /list\.length \? '' : .*아직 항목이 없어요\. 아래에서 추가하세요\./);
  for (const action of ['toggle-group', 'delete-group']) {
    const button = check.split('\n').find((line) => line.includes('data-c="' + action + '"'));
    assert.ok(button.includes("p.total ? '' : 'disabled'"), action);
  }
});

test('S-7: link and file omit notes, flight and stay booking refs and stay phone by default', async () => {
  const t = trip();
  const place = M.addItem(t, t.days[0].id, { ...point, memo: 'PLACE-NOTE' });
  const stay = M.addStay(t, { ...point, memo: 'STAY-NOTE', bookingRef: 'STAY-REF', phone: '+81 123 456' }, 0, 1);
  const f = M.addFlight(t, { ...flight, memo: 'FLIGHT-NOTE' });
  for (const opts of [undefined, { includePrivate: false }, { includePrivate: true }]) {
    for (const copy of [sharedCopy(t, opts), await decodeShare(await encodeShare(t, opts))]) {
      const values = [copy.days[0].items[0].memo, copy.stays[0].memo, copy.stays[0].bookingRef, copy.stays[0].phone, copy.flights[0].memo, copy.flights[0].bookingRef];
      assert.deepEqual(values, opts?.includePrivate ? [place.memo, stay.memo, stay.bookingRef, stay.phone, f.memo, f.bookingRef] : ['', '', '', '', '', '']);
    }
  }
  assert.match(html, /id="shareExcludePrivate" type="checkbox" checked/);
  assert.match(app, /\$\('#shareExcludePrivate'\)\.checked = true;[\s\S]*?updateShare\(\)/);
  assert.match(app, /const includePrivate = !\$\('#shareExcludePrivate'\)\.checked/);
});

test('S-8: select only app-owned localStorage keys, including its migration source', () => {
  const keys = ['xenotravel:v1', 'xenotravel:prefs', 'xenotravel:wx', 'tripnote:v1', 'other:key', 'tripnote:other', 'xenotravel-libs'];
  assert.deepEqual(appStorageKeys({ length: keys.length, key: (i) => keys[i] }), keys.slice(0, 4));
});

test('S-8: confirm with trip count and optional full backup before app-scoped wipe and reload', () => {
  const wipe = /async function wipeDevice\(\) \{[\s\S]+?\n\}/.exec(app)[0];
  assert.match(html, /data-menu="wipe-device"/);
  assert.match(app, /action === 'wipe-device'[\s\S]*?void wipeDevice\(\)/);
  assert.match(wipe, /count = Object.keys\(store.trips\).length/);
  assert.match(wipe, /value: 'backup'.+백업 후 지우기/);
  assert.match(wipe, /value: 'wipe'.+danger: true/);
  assert.match(wipe, /if \(!choice\) return/);
  assert.match(wipe, /trips.map\(async \(snapshot\) => \(\{ \.\.\.snapshot, cover: await backupCover\(snapshot.id\) \}\)\)\);[\s\S]*?await downloadAllTrips\(snapshots\);[\s\S]*?Covers.clear\(\)/);
  assert.match(wipe, /startsWith\('xenotravel-'\)[\s\S]*?caches.delete\(key\)/);
  assert.match(wipe, /appStorageKeys\(localStorage\)\) localStorage.removeItem\(key\);[\s\S]*?location.reload\(\)/);
});

test('S-8: the ZIP contains separate importable JSON files with travel records and cover data', async (t) => {
  const vendor = runInNewContext(read('vendor/xlsx/xlsx.full.min.js') + '\nXLSX');
  let saved;
  let filename;
  t.mock.method(URL, 'createObjectURL', (blob) => {
    saved = blob;
    return 'blob:xenotravel-test';
  });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const previous = [globalThis.XLSX, globalThis.document];
  globalThis.XLSX = vendor;
  globalThis.document = { createElement: () => ({ click() { filename = this.download; } }) };
  try {
    const first = { ...trip(), title: '서울', cover: 'data:image/jpeg;base64,/9j/' };
    const second = { ...trip(), cover: null };
    B.addExpense(first, { amount: 100, cur: 'KRW' });
    await downloadAllTrips([first, second]);
    assert.match(filename, /^xenotravel-backup-all-.*\.zip$/);
    assert.equal(saved.type, 'application/zip');
    const archive = vendor.CFB.read(new Uint8Array(await saved.arrayBuffer()), { type: 'array' });
    const files = Array.from(archive.FileIndex).filter((file) => file.name.endsWith('.json'));
    assert.deepEqual(files.map((file) => JSON.parse(new TextDecoder().decode(Uint8Array.from(file.content)))), [first, second]);
    for (const file of files) assert.doesNotThrow(() => M.validateTrip(JSON.parse(new TextDecoder().decode(Uint8Array.from(file.content)))));
  } finally {
    [globalThis.XLSX, globalThis.document] = previous;
  }
});

test('S-6: the self-hosted link retention period is disclosed in all four languages', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) assert.match(JSON.stringify(privacySections(lang, { contact: 'test@example.com' })), /180/, lang);
});
