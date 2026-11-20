import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';

const map = { ko: '센소지', en: 'Senso-ji', zh: '浅草寺', ja: '浅草寺' };

test('localizePresets: 프리셋 이름은 언어를 따라가고, 사용자가 고친 이름은 그대로', () => {
  const trip = M.createTrip({ title: '도쿄 3박 4일 샘플', destination: '도쿄', startDate: '2026-12-01', endDate: '2026-12-02' });
  trip.presetI18n = { title: { ko: '도쿄 3박 4일 샘플', en: 'Tokyo 4-day sample', zh: '东京4天3晚示例', ja: '東京3泊4日サンプル' } };
  const a = M.addItem(trip, trip.days[0].id, { name: '센소지', nameI18n: map, lat: 35.71, lng: 139.79 });
  const b = M.addItem(trip, trip.days[0].id, { name: '센소지', nameI18n: map, lat: 35.71, lng: 139.79 });
  b.name = '아사쿠사 산책';
  assert.equal(M.localizePresets(trip, 'en'), true);
  assert.equal(a.name, 'Senso-ji');
  assert.equal(trip.title, 'Tokyo 4-day sample');
  assert.equal(b.name, '아사쿠사 산책');
  M.localizePresets(trip, 'ja');
  assert.equal(a.name, '浅草寺');
  assert.equal(M.localizePresets(trip, 'zh'), true); // 浅草寺 (ja) → 浅草寺 (zh) 같은 글자여도 title이 바뀐다
  M.localizePresets(trip, 'ko');
  assert.equal(a.name, '센소지');
  assert.equal(M.localizePresets(trip, 'ko'), false);
});

test('createItem: 사용자가 만든 장소에는 번역 맵이 붙지 않는다', () => {
  assert.equal('nameI18n' in M.createItem({ name: '내 장소', lat: 1, lng: 2 }), false);
  assert.equal('nameI18n' in M.createItem({ name: 'x', nameI18n: { ko: 'x' }, lat: 1, lng: 2 }), false);
});
