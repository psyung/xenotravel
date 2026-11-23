import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appSource } from './helpers/app-source.js';
import { cropRect, decode } from '../public/lib/covers.js';
import { destinationLabel } from '../public/lib/destinations.js';
import { setLang, t } from '../public/lib/i18n.js';
import { createTrip, tripStats } from '../public/lib/model.js';
import { encodeShare, decodeShare } from '../public/lib/share.js';
import { activePlaces, cityByName, distanceKm, localizePlace, trendToPlace } from '../public/lib/trends.js';

const source = appSource();
const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const data = JSON.parse(read('data/trends.json'));
const translations = JSON.parse(read('data/trends-i18n.json'));

test('P2-6: summary buttons reuse itinerary, date picker, groups and all-routes actions', () => {
  for (const target of ['data-summary="today"', 'data-summary="dates"', 'data-open-place-groups', 'data-summary="routes"']) {
    assert.ok(source.match(/function renderHero\(\) \{[\s\S]*?\n\}/)[0].includes(target));
  }
  assert.match(source, /openDateRange\(\$\('#startDate'\), button\)/);
  assert.match(source, /showTab\('map'\);\s*showAllRoutes\(\)/);
  assert.match(source, /const index = M\.todayIndex\(trip, TODAY\);\s*showTab\('plan'\)/);
  assert.match(source, /data-open-place-groups\]'\)\) return;\s*renderPlaceGroups\(\);\s*showDialog\(placeGroupsDialog\)/);
  for (const action of ['plan', 'budget', 'check', 'share', 'flights', 'backup']) {
    assert.ok(source.includes(`featureCard('${action}'`));
  }
  assert.match(source, /if \(!current\) return openNewTrip\(\)/);
  const css = read('styles.css');
  assert.match(css, /:is\(\.bento \.tile, \.feats li button\):enabled:is\(:focus-visible, :active\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*--action-lift: 0px/);
});

test('P2-7: cover crop centers landscape and portrait images at 16:9', () => {
  assert.deepEqual(cropRect(640, 360), [0, 0, 640, 360]);
  assert.deepEqual(cropRect(800, 360), [80, 0, 640, 360]);
  assert.deepEqual(cropRect(320, 640), [0, 230, 320, 180]);
});

test('P2-7: malformed and oversized backup covers are rejected and share links exclude covers', async () => {
  await assert.rejects(decode('data:image/svg+xml;base64,AAAA'));
  await assert.rejects(decode('data:image/jpeg;base64,AAAA'));
  await assert.rejects(decode(`data:image/jpeg;base64,${'A'.repeat(400004)}`));
  const trip = createTrip({ destination: '도쿄' });
  assert.equal(Object.hasOwn(decodeShare(await encodeShare({ ...trip, cover: 'backup-only' })), 'cover'), false);
  assert.match(read('sw.js'), /'lib\/covers\.js'/);
  assert.match(read('lib/covers.js'), /indexedDB\.open\('xenotravel-covers'/);
  assert.match(read('lib/covers.js'), /export const clear = .*store\.clear\(\)/);
  assert.match(source, /downloadJson\(\{ \.\.\.snapshot, cover:/);
  assert.match(source, /Covers\.put\(imported\.id, cover\)/);
});

test('P2-8: old and new trend schemas filter expired events and keep editorial picks separate', () => {
  const places = [{ id: 'expired', until: '2026-11-23' }, { id: 'current', until: '2026-11-24' }];
  const popular = [{ id: 'landmark' }];
  const today = '2026-11-24';
  assert.deepEqual(activePlaces({ places }, today), [places[1]]);
  assert.deepEqual(activePlaces({ trending: places, popular }, today), [places[1]]);
  assert.deepEqual(activePlaces({ places }, today, 'popular'), []);
  assert.deepEqual(activePlaces({ trending: places, popular }, today, 'popular'), popular);
  assert.deepEqual(activePlaces(null, today), []);
  assert.equal(cityByName(data.cities, '大阪')?.id, 'osaka');
});

test('P2-8: editorial picks have localized names, nearby coordinates and explicit attribution', () => {
  assert.match(data.researchedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.cities.length, 4);
  for (const city of data.cities) {
    assert.ok(city.popular.length >= 3 && city.popular.length <= 6);
    for (const place of city.popular) {
      assert.equal(place.source, '편집 선정');
      assert.ok(distanceKm(city.center, place) < 30);
      for (const lang of ['en', 'zh', 'ja']) {
        const local = localizePlace(place, lang, translations);
        assert.equal(local.original, false);
        assert.doesNotMatch(local.name, /[가-힣]/);
      }
      assert.equal(trendToPlace(place, city.name).category, 'sight');
    }
  }
  assert.match(source, /role="tablist"/);
  assert.match(source, /이 도시 추천은 준비 중이에요/);
});

test('C-1: known destinations translate across language switches and custom text stays intact', () => {
  const trip = createTrip({ destination: '자싱', title: '내가 정한 제목' });
  try {
    for (const [lang, expected] of [['en', 'Jiaxing'], ['zh', '嘉兴'], ['ja', '嘉興']]) {
      setLang(lang);
      assert.equal(destinationLabel(trip.destination), expected);
      assert.equal(destinationLabel('嘉兴'), expected);
      assert.equal(destinationLabel('우리 동네'), '우리 동네');
      assert.equal(trip.title, '내가 정한 제목');
    }
    setLang('zh');
    assert.equal(t('{dest} 여행', { dest: destinationLabel(trip.destination) }), '嘉兴之旅');
  } finally {
    setLang('ko');
  }
});

test('C-4: returning to plan renders fresh summary text even with the same trip and date', () => {
  const showPage = source.slice(source.indexOf('function showPage('), source.indexOf("$$('button.pg').forEach((b) => b.addEventListener"));
  assert.match(showPage, /if \(prefs\.page === 'plan'\) \{\s*renderHero\(\);\s*if \(!\$\('#days'\)\.childElementCount\)/);
  assert.match(source, /e\.key === LANG_KEY[^\n]*\{\s*setLang\(e\.newValue\);\s*applyLanguage\(\)/);
  const trip = createTrip({ destination: '자싱', startDate: '2026-11-24', endDate: '2026-11-24' });
  try {
    setLang('zh');
    const chinese = tripStats(trip, '2026-11-24');
    setLang('ko');
    const korean = tripStats(trip, '2026-11-24');
    assert.notEqual(korean.dday.sub, chinese.dday.sub);
    assert.notEqual(korean.length, chinese.length);
    assert.equal(korean.dday.sub, '오늘 출발');
  } finally {
    setLang('ko');
  }
});
