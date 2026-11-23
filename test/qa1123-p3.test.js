// docs/qa-2026-11-23.md Phase 3 (P2) and Part C regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appSource } from './helpers/app-source.js';
import * as B from '../public/lib/budget.js';
import { exportXlsx } from '../public/lib/export.js';
import { setLang } from '../public/lib/i18n.js';
import { createTrip, validateTrip } from '../public/lib/model.js';
import { addMember, settlement } from '../public/lib/settle.js';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');

test('P2-4: master and group checkboxes update selection and the live add action', () => {
  const app = appSource();
  assert.match(app, /name="pAll"[^\n]*t\('전체 선택'\)/);
  assert.match(app, /class="pp-group"[^\n]*name="pGroup"/);
  assert.match(app, /box\.checked = n > 0 && n === items\.length/);
  assert.match(app, /box\.indeterminate = n > 0 && n < items\.length/);
  assert.match(app, /e\.target\.closest\('\.pp-group'\) \?\? presetDialog/);
  assert.match(app, /btn\.disabled = n === 0[\s\S]*t\('선택한 \{n\}개 추가', \{ n \}\)/);
  assert.match(read('index.html'), /data-p="add" aria-live="polite" disabled/);
});

test('P2-5: old and new payment keys survive backup validation and normalization', () => {
  const trip = createTrip({ title: 'Shanghai', startDate: '2026-11-23', endDate: '2026-11-23' });
  trip.expenses = ['card', 'debit', 'easypay', undefined, 'obsolete', 'constructor'].map((pay, id) => ({
    id: String(id), cur: 'KRW', amount: 1000, krw: 1000, pay,
  }));
  const imported = validateTrip(JSON.parse(JSON.stringify(trip)));
  B.normalizeExpenses(imported);
  const normalized = structuredClone(imported.expenses);
  B.normalizeExpenses(imported);
  assert.deepEqual(imported.expenses, normalized);
  assert.deepEqual(normalized.map((e) => e.pay), ['card', 'debit', 'easypay', 'card', 'card', 'card']);
  assert.equal(B.PAYMENTS.card.label, '신용카드');
  assert.equal(B.addExpense(imported, { amount: 1000, cur: 'KRW', pay: 'debit' }).pay, 'debit');
  assert.equal(B.updateExpense(imported, '0', { pay: 'easypay' }).pay, 'easypay');
});

test('P2-5: payment chart, expense controls, exports and settlement account for all three payment types', async () => {
  setLang('en');
  const app = appSource();
  assert.match(app, /barRows\(s\.byPay, B\.PAYMENTS,/);
  assert.match(app, /Object\.entries\(B\.PAYMENTS\)[\s\S]*data-b="pay"/);
  assert.match(app, /<select name="pay" data-ui-select>\$\{Object\.entries\(B\.PAYMENTS\)/);
  assert.match(app, /ctx\.trip\.country === 'cn' \? 'easypay' : 'card'/);
  const trip = createTrip({ title: 'Shanghai', startDate: '2026-11-23', endDate: '2026-11-23' });
  const payer = addMember(trip, 'A');
  addMember(trip, 'B');
  for (const pay of ['card', 'debit', 'easypay']) {
    B.addExpense(trip, { amount: 1000, cur: 'KRW', pay }).payer = payer.id;
  }
  assert.deepEqual(B.summarize(trip).byPay, { card: 1000, debit: 1000, easypay: 1000 });
  const labels = ['Credit card', 'Debit card', 'Digital wallet'];
  for (const label of labels) assert.ok(B.expensesCsv(trip).includes('"' + label + '"'));
  const sheets = [];
  globalThis.XLSX = {
    utils: { aoa_to_sheet: (rows) => rows, book_new: () => ({}), book_append_sheet: (_wb, rows) => sheets.push(rows) },
    writeFile() {},
  };
  try {
    await exportXlsx(trip);
  } finally {
    delete globalThis.XLSX;
    setLang('ko');
  }
  assert.deepEqual(sheets[1].slice(1).map((row) => row[2]), labels);
  assert.equal(settlement(trip).total, 3000);
  assert.equal(settlement(trip).counted, 3);
  assert.deepEqual(settlement(trip).byPay, { card: 1000, debit: 1000, easypay: 1000 });
  assert.match(app, /Object.hasOwn\(st\.byPay, key\)/);
});

test('P2-9: preference selects Street or Gray, dark overrides it, and print uses the same tiles', () => {
  const app = appSource();
  assert.match(app, /street: \[\x60\$\{ESRI\}\/World_Street_Map\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\x60\]/);
  assert.match(app, /const mapTileKind = \(\) => isDark\(\) \? 'dark' : prefs\.mapStyle === 'gray' \? 'gray' : 'street'/);
  assert.match(app, /prefs\.mapStyle = style;\s*savePrefs\(\);\s*syncTiles\(\);/);
  assert.match(app, /printMaps\.push\(m\);\s*const tiles = tileGroup\(mapTileKind\(\)\)/);
  assert.match(app, /STREET_ATTRIBUTION = 'Tiles &copy; Esri — Source: Esri, HERE, Garmin[\s\S]*and the GIS User Community'/);
  assert.doesNotMatch(read('sw.js'), /server\.arcgisonline\.com|World_Street_Map/);
});

test('P2-9: day colors have at least 3:1 contrast against the route outline and 4.5:1 against pin numbers', () => {
  const app = appSource();
  assert.match(app, /color: 'var\(--day-route-outline\)', weight: 7/);
  const colors = app.match(/const COLORS = \[([^\]]+)\]/)[1].match(/#[\da-f]{6}/gi);
  for (const color of colors) {
    const channels = color.slice(1).match(/../g).map((hex) => parseInt(hex, 16) / 255);
    const [r, g, b] = channels.map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    const contrast = 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
    assert.ok(contrast >= 4.5, color + ' against white');
  }
});

test('P2-10: footer hash is debug-only and About can show it in normal use', () => {
  const app = appSource();
  const html = read('index.html');
  assert.match(app, /get\('debug'\) === '1'/);
  assert.match(app, /© 2026 XenoTravel \$\{esc\(t\('모든 권리 보유\.'\)\)\}\$\{debugBuild \? .*class="foot-build"/);
  assert.match(app, /action === 'about'[\s\S]*title: t\('앱 정보'\)[^\n]*buildCommit/);
  assert.match(html, /data-menu="about" data-i18n="앱 정보"/);
  assert.match(html, /<meta name="build-commit"/);
});

test('C-2: yuan and yen remain distinct on compact controls, recorded expenses and totals', () => {
  assert.equal(B.currencySymbol('JPY'), 'JP¥');
  assert.equal(B.currencySymbol('CNY'), 'CN¥');
  assert.equal(B.currencySymbol('CHF'), 'CHF');
  assert.equal(B.currencySymbol('USD'), '$');
  assert.match(B.moneyCode(10, 'JPY'), / JPY$/);
  assert.match(B.formatMoney(10, 'CNY'), / CNY$/);
  assert.match(appSource(), /B\.currencySymbol\(b\.currency\)/);
});

test('C-3: recording and base selectors share the full currency list', () => {
  const app = appSource();
  assert.match(app, /function currencyOptions\(selected\) \{\s*return Object\.entries\(B\.CURRENCIES\)/);
  assert.match(app, /id="bCurrency"[^\n]*currencyOptions\(b\.currency\)/);
  assert.match(app, /id="bBase"[^\n]*currencyOptions\(code\)/);
  const trip = { budget: { currency: 'USD' } };
  for (const code of Object.keys(B.CURRENCIES)) {
    B.setBase(trip, code);
    assert.equal(B.baseCode(trip.budget), code);
  }
});
