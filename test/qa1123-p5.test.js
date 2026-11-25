import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import { checkDay, estimateMinutes, hoursWarning } from '../public/lib/route-check.js';
import { flightReminders, reminderTodos } from '../public/lib/flight-reminders.js';
import { tripToCalendar } from '../public/lib/export.js';
import { budgetPace } from '../public/lib/budget.js';
import { nearbyTourism, tourismPlaces } from '../public/lib/geo.js';
import { mergeTrip } from '../public/lib/sync.js';
import { appSource } from './helpers/app-source.js';

const tripFor = (endDate = '2026-11-25') => M.createTrip({ startDate: '2026-11-23', endDate });
const point = (name, lng) => ({ name, lat: 0, lng });
const add = (trip, day, name, lng, time = '') =>
  M.addItem(trip, trip.days[day].id, { ...point(name, lng), time });

test('F-2 estimates each travel mode and identifies the stops that trigger day warnings', () => {
  assert.deepEqual(['walking', 'transit', 'driving'].map((mode) => estimateMinutes(10, mode)), [167, 41, 26]);
  const trip = tripFor();
  M.addFlight(trip, { kind: 'out', from: 'ICN', to: 'PVG', departAt: '2026-11-23T10:30', arriveAt: '2026-11-23T11:30' });
  M.addFlight(trip, { kind: 'in', from: 'PVG', to: 'ICN', departAt: '2026-11-25T16:30' });
  const stops = Array.from({ length: 8 }, (_, i) => add(trip, 0, `Stop ${i}`, i * 0.2, '10:00')); // 약 22km 간격 (장거리 30km 미만)
  const late = add(trip, 2, 'Late stop', 0, '17:00');
  const result = checkDay(trip, 0, 'walking');
  assert.ok(result.minutes > 180);
  assert.equal(result.longLegs, 0);
  for (const warning of [
    { kind: 'flight', id: stops[0].id }, { kind: 'order', id: stops[1].id },
    { kind: 'movement', id: stops[1].id }, { kind: 'count', id: stops[7].id },
  ]) assert.ok(result.warnings.some((w) => w.kind === warning.kind && w.id === warning.id));
  assert.deepEqual(checkDay(trip, 2).warnings, [{ id: late.id, kind: 'flight' }]);
});

test('F-3 stay legs contribute to distance and travel time (J-3: stay suggestions removed)', () => {
  const trip = tripFor('2026-11-28');
  add(trip, 0, 'First stop', 0.1);
  add(trip, 1, 'Stop A', 179);
  add(trip, 2, 'Stop B', -179);
  add(trip, 3, 'Stop C', 60);
  add(trip, 4, 'Stop D', 55);
  M.addStay(trip, point('Hotel A', 0), 0, 1);
  M.addStay(trip, point('Hotel B', 60), 3, 1);
  const result = checkDay(trip, 0, 'transit');
  assert.ok(result.firstKm > 11 && result.firstKm < 11.2);
  assert.equal(M.dayKm(trip, 0), result.firstKm * 2);
  assert.equal(result.minutes, estimateMinutes(result.firstKm, 'transit') * 2);
});

test('F-6 backs up hours, validates inputs, and handles closed weekdays and overnight service', () => {
  const trip = tripFor();
  const place = add(trip, 0, 'Late café', 1, '01:30');
  delete place.closedWeekdays;
  delete place.opensAt;
  delete place.closesAt;
  assert.deepEqual(M.validateTrip(trip).days[0].items[0].closedWeekdays, []);
  Object.assign(place, { closedWeekdays: [1], opensAt: '22:00', closesAt: '02:00' });
  assert.equal(hoursWarning(place, '2026-11-23'), 'closed');
  assert.deepEqual(checkDay(trip, 0).warnings, [{ id: place.id, kind: 'closed' }]);
  assert.equal(hoursWarning(place, '2026-11-24'), '');
  assert.equal(hoursWarning({ ...place, time: '02:00' }, '2026-11-24'), 'hours');
  assert.equal(hoursWarning({ ...place, time: '' }, '2026-11-24'), '');
  assert.equal(M.validateTrip(JSON.parse(JSON.stringify(trip))).days[0].items[0].opensAt, '22:00');
  assert.throws(() => M.validateTrip({ ...trip, inbox: [{ ...place, closedWeekdays: [7] }] }));
  assert.throws(() => M.validateTrip({ ...trip, inbox: [{ ...place, opensAt: '29:00' }] }));
});

test('F-7 reminders roll across midnight, offer updates without duplicates and export two alarms', () => {
  const trip = tripFor();
  const flight = M.addFlight(trip, { from: 'ICN', to: 'PVG', departAt: '2026-11-23T01:15', flightNo: 'KE123' });
  assert.deepEqual(flightReminders(flight).map(({ at }) => at), ['2026-11-22T01:15', '2026-11-22T22:15']);
  assert.deepEqual(flightReminders({ departAt: '2026-02-30T00:00' }), []);
  const todos = reminderTodos(flight);
  assert.match(todos[0].textI18n.en, /Online check-in.*2026-11-22 01:15.*KE123/);
  const existing = todos.map(({ id, textI18n }, i) => ({ id: `local-${i}`, flightReminder: id, text: textI18n.en, textI18n }));
  assert.deepEqual(reminderTodos(flight, existing), []);
  const updated = { ...flight, departAt: '2026-11-23T02:15' };
  assert.deepEqual(reminderTodos(updated, existing).map((c) => c.id), todos.map((c) => c.id));
  existing[0].text = 'Edited by user';
  assert.equal(reminderTodos(updated, existing).length, 1);
  const remote = existing.map((c) => ({ ...c, id: 'remote-' + c.id }));
  assert.equal(mergeTrip(trip, { ...trip, checks: existing }, { ...trip, checks: remote }).checks.length, 2);
  const ics = tripToCalendar(trip);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /TRIGGER:-PT24H/);
  assert.match(ics, /TRIGGER:-PT3H/);
});

test('F-8 budget pace handles before, during, after, undated, and unset budgets', () => {
  const trip = tripFor();
  trip.budget = { total: 90000 };
  trip.expenses = [{ day: 0, krw: 25000 }, { date: '2026-11-24', krw: 5000 }, { day: 1, krw: null }];
  assert.deepEqual(budgetPace(trip, '2026-11-22'), {
    todaySpent: 0, recommended: 30000, remainingDays: 3, remainingPerDay: 20000, status: 'before', pending: true,
  });
  assert.deepEqual(budgetPace(trip, '2026-11-24'), {
    todaySpent: 5000, recommended: 30000, remainingDays: 2, remainingPerDay: 30000, status: 'during', pending: true,
  });
  assert.equal(budgetPace(trip, '2026-11-26').remainingPerDay, null);
  assert.equal(budgetPace(trip, '2026-11-26').status, 'after');
  assert.equal(budgetPace(M.createTrip(), '2026-11-23').status, 'undated');
  trip.budget.total = 0;
  assert.equal(budgetPace(trip, '2026-11-24').recommended, null);
  trip.budget.total = 1;
  assert.equal(budgetPace(trip, '2026-11-24').remainingPerDay, 0);
});

test('F-9 Photon request is bounded and abortable, with up to ten unique named sights', async (context) => {
  const feature = (i, kind = 'museum') => ({
    properties: { name: `Sight ${i}`, osm_key: 'tourism', osm_value: kind },
    geometry: { coordinates: [120 + i / 100, 30] },
  });
  const features = [feature(0, 'hotel'), feature(1), feature(1), { ...feature(2), geometry: { coordinates: ['oops', 30] } },
    ...Array.from({ length: 12 }, (_, i) => feature(i + 3))];
  assert.equal(tourismPlaces(features).length, 10);
  assert.deepEqual(tourismPlaces(features).slice(0, 2).map((p) => p.name), ['Sight 1', 'Sight 3']);
  const signal = new AbortController().signal;
  const fetch = context.mock.method(globalThis, 'fetch', async (request, options) => {
    const url = new URL(request);
    assert.equal(url.hostname, 'photon.komoot.io');
    assert.equal(url.pathname, '/reverse');
    assert.equal(url.searchParams.get('lat'), '30');
    assert.equal(url.searchParams.get('lon'), '120');
    assert.equal(url.searchParams.get('radius'), '15');
    assert.ok(url.searchParams.getAll('osm_tag').includes('tourism:museum'));
    assert.equal(options.signal, signal);
    return Response.json({ features });
  });
  assert.equal((await nearbyTourism({ lat: 30, lng: 120 }, signal)).length, 10);
  assert.equal(fetch.mock.callCount(), 1);
});

test('F-10 country chooses the primary app, with overrides and safe coordinate links', () => {
  const from = { name: 'Start', lat: 37.5, lng: 127 };
  const to = { name: 'Stop / <', lat: 37.52, lng: 127.04 };
  const links = (country, preference) => M.tripDirectionsLinks({ country }, to, from, preference);
  assert.deepEqual(links('kr').slice(0, 2).map((link) => link.id), ['naver', 'kakao']);
  assert.equal(links('cn')[0].id, 'amap');
  assert.equal(links('jp')[0].id, 'google');
  assert.equal(links('kr', 'kakao')[0].id, 'kakao');
  assert.equal(links('jp', 'naver')[0].id, 'naver');
  assert.equal(links('cn', 'invalid')[0].id, 'amap');
  for (const { url } of [...links('kr'), ...links('cn')]) assert.ok(M.safeUrl(url));
});

test('Part F UI uses explicit actions, safe links, and resets current toasts on language change', () => {
  const source = appSource();
  assert.match(source, /action === 'day-warning'[\s\S]*?scrollIntoView/);
  assert.doesNotMatch(source, /data-stay-suggestions|staySuggestion/); // J-3: 숙소 추천 위치 삭제
  assert.match(source, /type="time" data-hours="opensAt"/);
  assert.match(source, /label: t\('할 일로 추가'\),\s*run: \(\) => \{[\s\S]*?C\.addCheck/);
  assert.match(source, /action === 'nearby-load'\) \{\s*void loadNearby\(\)/);
  assert.match(source, /action === 'nearby-add'/);
  assert.match(source, /id="directionsPreference" data-ui-select/);
  assert.match(source, /href="\$\{href\(link\.url\)\}"/);
  assert.match(source, /function applyLanguage\(\) \{\s*clearToast\(\)/);
});

test('J-10: 직선 30km 이상 구간은 도심 계수로 계산하지 않고 장거리(수단 미정)로 따로 센다', () => {
  const trip = tripFor();
  add(trip, 0, '嘉兴南站', 0);
  add(trip, 0, 'Near the station', 0.02); // 약 2.2km
  add(trip, 0, '杭州东站', 0.67); // 약 72km
  add(trip, 0, 'Hangzhou café', 0.69);
  const result = checkDay(trip, 0, 'walking');
  assert.equal(result.longLegs, 1);
  assert.equal(result.minutes, estimateMinutes(M.distanceKm(trip.days[0].items[0], trip.days[0].items[1]), 'walking')
    + estimateMinutes(M.distanceKm(trip.days[0].items[2], trip.days[0].items[3]), 'walking'));
  assert.ok(!result.warnings.some((w) => w.kind === 'movement'), '장거리 구간 때문에 "3시간 초과" 경고가 나오면 안 된다');
});
