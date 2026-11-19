import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSuggestions } from '../public/lib/suggestions.js';
import { createTrip, selectRangeDate } from '../public/lib/model.js';
import { summarize } from '../public/lib/budget.js';
import { loadStore } from '../public/lib/store.js';

test('여행지 자동완성은 한 글자, 분해된 한글, 영문, 국가명과 초성을 찾는다', () => {
  const tokyo = { value: '도쿄', detail: '일본', keywords: ['tokyo', '동경', 'ㄷㅋ'] };
  const doha = { value: '도하', detail: '카타르', keywords: ['doha'] };
  const kyoto = { value: '교토', detail: '일본', keywords: ['교토도'] };
  const options = [kyoto, tokyo, doha];
  assert.deepEqual(matchSuggestions(options, '도'), [tokyo, doha, kyoto]);
  for (const q of ['도쿄'.normalize('NFD'), 'TOK', '동경', 'ㄷㅋ']) {
    assert.deepEqual(matchSuggestions(options, q), [tokyo]);
  }
  assert.deepEqual(matchSuggestions(options, '일본'), [kyoto, tokyo]);
  assert.deepEqual(matchSuggestions(options, ''), []);
});

test('달력 범위는 시작일 선택 후 종료일로 이동하고 더 이른 날짜는 새 시작일이 된다', () => {
  const start = selectRangeDate({ start: '2026-11-18', activeField: 'start' }, '2026-11-22');
  assert.deepEqual(start, { start: '2026-11-22', end: '', activeField: 'end' });
  const earlier = selectRangeDate(start, '2026-11-20');
  assert.deepEqual(earlier, { start: '2026-11-20', end: '', activeField: 'end' });
  assert.deepEqual(selectRangeDate(earlier, '2026-11-21'), {
    start: '2026-11-20', end: '2026-11-21', activeField: null,
  });
});

test('새 여행의 지출은 비어 있고 기존 샘플의 자동 생성 기록만 제외한다', () => {
  const fresh = createTrip({ destination: '도쿄' });
  assert.deepEqual(fresh.expenses, []);
  assert.equal(summarize(fresh).spent, 0);
  const sample = { ...fresh, title: '도쿄 3박 4일 샘플' };
  const seed = { amount: 1200, cur: 'local', cat: 'food', pay: 'card', day: 0, memo: '점심 식사 예시', at: sample.createdAt };
  sample.expenses = [seed, { ...seed, at: new Date(Date.parse(sample.createdAt) + 60000).toISOString() }];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => JSON.stringify({ trips: { fresh, sample }, currentId: 'sample' }) },
  });
  try {
    assert.deepEqual(loadStore().trips.sample.expenses, [sample.expenses[1]]);
    assert.deepEqual(loadStore().trips.fresh.expenses, []);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
