// F04: 화면에 나오는 앱 문구가 네 언어(한국어 키 · 영어 · 중국어 간체 · 일본어)로 모두 번역되어 있는지 검사한다.
// 키 찾는 곳: t('…') · k('…') 호출, index.html의 data-i18n / data-i18n-attr, 데이터 표(종류·통화·체크리스트 기본값 등).
import test from 'node:test';
import { appSource } from './helpers/app-source.js';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MESSAGES } from '../public/lib/messages.js';
import * as I from '../public/lib/i18n.js';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as C from '../public/lib/checklist.js';
import { CODES } from '../public/lib/weather.js';
import { privacySections } from '../public/lib/privacy.js';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');
const sources = [appSource(), ...readdirSync(new URL('lib/', pub)).filter((f) => f.endsWith('.js') && f !== 'messages.js').map((f) => read(`lib/${f}`))];
const unquote = (s) => s.replace(/\\'/g, "'").replace(/\\n/g, '\n');

export function usedKeys() {
  const keys = new Set();
  for (const source of sources) {
    for (const m of source.matchAll(/\b[tk]\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unquote(m[1]));
  }
  const html = read('index.html');
  for (const m of html.matchAll(/data-i18n="([^"]*)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n='([^']*)'/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]*)"/g)) {
    for (const pair of m[1].replace(/&#10;/g, '\n').split(';')) keys.add(pair.slice(pair.indexOf('=') + 1));
  }
  for (const m of html.matchAll(/<option value="[A-Z]{3}" label="([^"]+)">/g)) keys.add(m[1]); // 공항 이름
  for (const m of html.matchAll(/data-dp-pair="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/<input[^>]*type="(?:date|datetime-local)"[^>]*aria-label="([^"]+)"/g)) keys.add(m[1]);
  for (const c of Object.values(M.CATEGORIES)) keys.add(c.label);
  for (const v of Object.values(M.FLIGHT_KINDS)) keys.add(v);
  for (const c of Object.values(B.CURRENCIES)) keys.add(c.name);
  for (const c of [...Object.values(B.EXPENSE_CATS), ...Object.values(B.PAYMENTS)]) keys.add(c.label);
  for (const g of Object.values(C.CHECK_GROUPS)) keys.add(g.label).add(g.placeholder);
  for (const list of Object.values(C.DEFAULTS)) list.forEach((x) => keys.add(x));
  for (const sets of Object.values(C.SHOP_PICKS)) {
    for (const s of sets) {
      keys.add(s.title);
      if (s.note) keys.add(s.note);
      s.items.forEach((x) => keys.add(x));
    }
  }
  for (const [, text] of CODES) keys.add(text);
  for (const h of M.EXPORT_HEADER) keys.add(h);
  for (const x of ['작년 같은 날 실제 날씨예요. 예보는 출발 16일 전부터 보여요', '그날 실제 날씨예요', '현지 예보 (Open-Meteo)']) keys.add(x);
  for (const x of ['도쿄', '오사카', '교토', '후쿠오카']) keys.add(x); // 트렌드 도시 (data/trends.json)
  for (const x of ['형식', 'id/title', 'days', 'items', '장소', '좌표', 'day id', '숙소 기간', '항공편', '가계부', '체크리스트']) keys.add(x); // validateTrip
  for (const x of ['시작일', '종료일', '날짜']) keys.add(x); // 달력 기본 이름
  keys.delete('');
  return keys;
}

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('F04: 앱 문구는 모두 영어·중국어·일본어 번역이 있고, 변수 자리가 같다', () => {
  const missing = [];
  const broken = [];
  for (const key of usedKeys()) {
    const row = MESSAGES[key];
    if (!row || row.length !== 3 || row.some((x) => typeof x !== 'string' || !x.trim())) {
      missing.push(key);
      continue;
    }
    for (const [i, s] of row.entries()) {
      for (const part of s.split('|')) {
        if (vars(part) !== vars(key) && !(i === 0 && s.includes('|'))) broken.push(`${key} → ${s}`);
      }
      if (i === 0 && s.includes('|') && s.split('|').some((p) => vars(p) !== vars(key))) broken.push(`${key} → ${s}`);
    }
  }
  assert.deepEqual(missing, [], `번역 없는 키 ${missing.length}개`);
  assert.deepEqual(broken, [], '변수 자리가 다른 번역');
});

test('F04: 번역 사전에 쓰지 않는 키가 쌓이지 않는다', () => {
  const used = usedKeys();
  const unused = Object.keys(MESSAGES).filter((key) => !used.has(key));
  assert.deepEqual(unused, []);
});

test('F04·P0-7: 언어 선택 — 저장값이 없거나 이상하면 브라우저 언어, 저장이 막혀도 이번 화면은 바뀐다', () => {
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(I.loadLang(ok, ['ko-KR', 'en']), 'ko');
  assert.equal(I.loadLang(ok, ['fr-FR']), 'en');
  store.set(I.LANG_KEY, 'fr');
  assert.equal(I.loadLang(ok, ['ja-JP']), 'ja');
  store.set(I.LANG_KEY, 'ja');
  assert.equal(I.loadLang(ok, ['ko-KR']), 'ja', '사용자가 고른 언어가 먼저');
  assert.equal(I.t('일정'), MESSAGES['일정'][2]);
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(I.loadLang(denied, ['ko']), 'ko');
  I.setLang('en');
  assert.equal(I.saveLang(denied), false);
  assert.equal(I.getLang(), 'en');
  assert.equal(I.t('{n}곳', { n: 1 }), '1 place');
  assert.equal(I.t('{n}곳', { n: 3 }), '3 places');
  I.setLang('ko');
});

test('F04: 날짜·숫자·통화는 언어에 맞게, 금액과 통화 코드는 그대로', () => {
  const d = '2026-12-01';
  I.setLang('ko');
  assert.equal(M.formatDate(d), '12월 1일 (화)');
  assert.equal(B.money(1200, 'JPY'), '¥1,200');
  I.setLang('en');
  assert.equal(M.formatDate(d), 'Tue, Dec 1');
  assert.equal(M.dayTitle({ date: d }, 0), 'Day 1 · Tue, Dec 1');
  assert.equal(B.moneyCode(100, 'CNY'), '¥100.00 CNY'); // 정수 통화(KRW·JPY·VND) 밖은 소수점 둘째 자리까지 항상 표기
  assert.equal(B.won(1234567), '₩1,234,567');
  I.setLang('zh');
  assert.match(M.formatDate(d), /12月1日/);
  assert.equal(M.dayTitle({ date: '' }, 2), '第3天');
  I.setLang('ja');
  assert.match(M.formatDate(d), /12月1日/);
  assert.equal(B.moneyCode(1200, 'JPY'), '¥1,200 JPY');
  I.setLang('ko');
});

test('F05: 개인정보처리방침은 네 언어로 같은 항목을 안내하고 문의 메일을 넣는다', () => {
  const contact = 'xenobase.official@gmail.com';
  const ko = privacySections('ko', { contact });
  for (const lang of ['en', 'zh', 'ja']) {
    const doc = privacySections(lang, { contact });
    assert.equal(doc.length, ko.length, lang);
    const text = JSON.stringify(doc);
    assert.ok(text.includes(contact));
    for (const word of ['localStorage', 'xenotravel:v1', 'Photon', 'Nominatim', 'Open-Meteo', 'ExchangeRate-API', 'Esri']) assert.ok(text.includes(word), `${lang}: ${word}`);
  }
  assert.equal(privacySections('xx', { contact })[0].title, ko[0].title); // 모르는 언어는 한국어
});

test('3-2: 추천 카드(트렌드) 문구는 네 언어로 현지화되고, 번역이 없으면 원문 표시를 한다', async () => {
  const T = await import('../public/lib/trends.js');
  const data = JSON.parse(readFileSync(new URL('data/trends.json', pub), 'utf8'));
  const tr = JSON.parse(readFileSync(new URL('data/trends-i18n.json', pub), 'utf8'));
  for (const city of data.cities) {
    for (const p of city.places) {
      for (const lang of ['en', 'zh', 'ja']) {
        const loc = T.localizePlace(p, lang, tr);
        assert.equal(loc.original, false, `${p.id} ${lang}`);
        for (const f of ['area', 'category', 'summary', 'name']) assert.ok(!/[가-힣]/.test(loc[f]), `${p.id} ${lang} ${f}: ${loc[f]}`);
      }
      assert.equal(T.localizePlace(p, 'ko', tr).summary, p.summary);
    }
  }
  const unknown = T.localizePlace({ id: 'x', name: 'X', area: '어딘가', category: '카페', summary: '설명' }, 'en', tr);
  assert.equal(unknown.original, true);
  assert.equal(unknown.category, 'Café');
});

test('3-2: 체크리스트 기본 항목은 템플릿 그대로일 때만 지금 언어로 보이고, 사용자 항목·저장값은 그대로', () => {
  I.setLang('ko');
  const trip = M.createTrip({ title: 'x', startDate: '2026-12-01', endDate: '2026-12-02' });
  C.ensureChecks(trip);
  const passport = trip.checks.find((c) => c.text === '여권');
  C.addCheck(trip, 'pack', '내가 쓴 항목');
  const legacy = { id: 'l', group: 'pack', text: '세면도구', done: false }; // 예전 여행 (tpl 없음)
  const edited = { ...passport, id: 'e', text: '여권 사본' };
  I.setLang('en');
  assert.equal(C.checkText(passport), 'Passport');
  assert.equal(C.checkText(legacy), 'Toiletries');
  assert.equal(C.checkText(edited), '여권 사본');
  assert.equal(C.checkText(trip.checks.find((c) => c.text === '내가 쓴 항목')), '내가 쓴 항목');
  assert.equal(passport.text, '여권', '저장값은 그대로');
  I.setLang('ko');
});
