import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { appSource } from './helpers/app-source.js';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as D from '../public/lib/dayops.js';
import { stayRangeWithin, overlappingStays, splitStayAround } from '../public/lib/stays.js';
import { samePlace, groupPlaces, removePlaceGroup } from '../public/lib/place-groups.js';
import { encodeShare, decodeShare } from '../public/lib/share.js';

const journey = () => M.createTrip({ title: 'Trip', startDate: '2026-12-01', endDate: '2026-12-05' });
const place = { name: 'Museum', lat: 35, lng: 139 };

test('P2-1: legacy and new stays validate, and private fields require opt-in', async () => {
  const trip = journey();
  const stay = M.addStay(trip, place);
  for (const key of ['checkInTime', 'checkOutTime', 'bookingRef', 'phone', 'price', 'cur']) delete stay[key];
  const legacy = M.validateTrip(trip).stays[0];
  assert.equal(legacy.checkInTime, '');
  assert.equal(legacy.price, null);
  Object.assign(stay, { checkInTime: '18:10', checkOutTime: '09:00', bookingRef: 'REF01', phone: '+81 10', price: 8200, cur: 'KRW', memo: 'private' });
  assert.deepEqual(M.validateTrip(JSON.parse(JSON.stringify(trip))).stays[0], stay);
  for (const [key, invalid] of Object.entries({ checkInTime: '25:00', checkOutTime: '9:30', bookingRef: 12, phone: [], price: -1, cur: 'invalid' })) {
    assert.throws(() => M.validateTrip({ ...trip, stays: [{ ...stay, [key]: invalid }] }), key);
  }
  for (const includePrivate of [false, true]) {
    const code = await encodeShare(trip, { includePrivate });
    const raw = JSON.parse(inflateRawSync(Buffer.from(code.slice(2), 'base64url'))).stays[0];
    for (const key of ['memo', 'bookingRef', 'phone']) assert.equal(Object.hasOwn(raw, key), includePrivate);
    const [decoded] = (await decodeShare(code)).stays;
    assert.equal(decoded.bookingRef, includePrivate ? 'REF01' : '');
    assert.equal(decoded.phone, includePrivate ? '+81 10' : '');
    assert.equal(decoded.checkInTime, '18:10');
  }
});

test('P2-1: clip, extend and split nights without duplicating budget entries', () => {
  const trip = journey();
  const stay = M.addStay(trip, { ...place, price: 9000, cur: 'KRW', checkInTime: '15:00', checkOutTime: '10:00' }, 0, 5);
  assert.equal(stayRangeWithin(trip, '2026-11-26', '2026-12-01'), null);
  assert.deepEqual(stayRangeWithin(trip, '2026-11-30', '2026-12-02'), { startIndex: 0, nights: 1 });
  const period = M.extendedRange(trip, '2026-11-30', '2026-12-08', { checkout: true });
  M.setTripDates(trip, period.start, period.end, { keepDates: true });
  assert.equal(M.stayDates(trip, stay).checkIn, '2026-12-01');
  assert.deepEqual(stayRangeWithin(trip, '2026-11-30', '2026-12-08'), { startIndex: 0, nights: 8 });
  const { expense } = B.payPlace(trip, stay.id);
  assert.equal(expense.cat, 'stay');
  assert.equal(expense.placeId, stay.id);
  assert.equal(B.payPlace(trip, stay.id).created, false);
  const incoming = { startIndex: 2, nights: 2 };
  assert.deepEqual(overlappingStays(trip.stays, incoming, stay.id), []);
  assert.deepEqual(overlappingStays(trip.stays, incoming), [stay]);
  const [head, tail] = splitStayAround(stay, incoming);
  assert.deepEqual([head.startIndex, head.nights, tail.startIndex, tail.nights], [1, 1, 4, 2]);
  assert.equal(head.id, stay.id);
  assert.equal(head.checkOutTime, '');
  assert.equal(tail.checkInTime, '');
  assert.notEqual(tail.id, stay.id);
  trip.stays = [head, tail];
  assert.equal(B.placePlanned(trip).byCat.stay, 9000);
  assert.equal(B.placeExpense(trip, head.id), expense);
  assert.equal(M.nightStay(trip, 2), null);
});

test('P2-2: default selection skips duplicates and one undo removes every copy', () => {
  const trip = journey();
  const source = M.addItem(trip, trip.days[0].id, { ...place, time: '14:00' });
  source.visited = true;
  const duplicate = M.addItem(trip, trip.days[1].id, { ...place, lat: 35.0001 });
  M.addItem(trip, trip.days[2].id, { ...place, name: 'Morning', time: '09:00' });
  const choices = D.copyDayChoices(trip, source.id);
  assert.deepEqual(choices.slice(0, 3).map(({ disabled, duplicate }) => [disabled, duplicate]), [[true, true], [false, true], [false, false]]);
  assert.deepEqual([...D.defaultCopyDays(trip, source.id, 1)], [2]);
  const op = D.copyToDays(trip, source.id, [0, 1, 2, 2, 3, 99]);
  assert.equal(op.items.length, 3);
  assert.equal(new Set(op.items.map((item) => item.id)).size, 3);
  assert.equal(trip.days[2].items[1].time, '14:00');
  assert.ok(op.items.every((item) => item.id !== source.id && !item.visited));
  assert.ok(op.undo(trip));
  assert.deepEqual(trip.days.map((day) => day.items.length), [1, 1, 1, 0, 0]);
  assert.equal(trip.days[1].items[0], duplicate);
});

test('P2-3: group by distance or Maps URL, sort and restore all lists', () => {
  const trip = journey();
  const url = 'https://www.google.com/maps/place/Museum';
  const first = M.addItem(trip, trip.days[0].id, { ...place, url });
  const keep = M.addItem(trip, trip.days[0].id, { ...place, name: 'Avenue' });
  const nearby = M.addItem(trip, trip.days[0].id, { ...place, lat: 35.00044 });
  const inbox = M.addItem(trip, M.INBOX, { ...place, name: 'Gallery', lat: 36, url });
  assert.ok(samePlace(first, nearby));
  assert.ok(samePlace(first, inbox));
  assert.ok(!samePlace(first, { ...nearby, lat: 35.002 }));
  assert.ok(!samePlace({ ...first, url: 'https://example.org/maps' }, { ...inbox, url: 'https://example.org/maps' }));
  const [group] = groupPlaces(trip);
  assert.deepEqual(group.entries.map(({ item }) => item.id), [first.id, nearby.id, inbox.id]);
  assert.equal(groupPlaces(trip, 'name', 'en')[0].place.id, keep.id);
  assert.equal(groupPlaces(trip, 'count')[0].entries.length, 3);
  const { expense } = B.payPlace(trip, nearby.id, { amount: 500, cur: 'KRW' });
  const undo = removePlaceGroup(trip, new Set(group.entries.map(({ item }) => item.id)));
  assert.deepEqual(trip.days[0].items, [keep]);
  assert.deepEqual(trip.inbox, []);
  assert.deepEqual(trip.expenses, [expense]);
  undo(trip);
  undo(trip);
  assert.deepEqual(trip.days[0].items, [first, keep, nearby]);
  assert.deepEqual(trip.inbox, [inbox]);
  assert.deepEqual(trip.expenses, [expense]);
});

test('P2-1–P2-3: app entry points use shared controls and batch operations', () => {
  const app = appSource();
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-menu="stays"/);
  assert.match(html, /id="stayShortcut"/);
  assert.match(html, /data-dp-pair="숙소 날짜"/);
  assert.match(html, /type="time"/);
  assert.match(app, /enhanceTimes\(stayForm\)/);
  assert.match(app, /openStays\(\{ place, start \}\)/);
  assert.match(app, /resumeStayFromMap\(draft, latlng\)/);
  assert.match(app, /splitStayAround\(stay, range\)/);
  assert.doesNotMatch(app + html, /STAY_TARGET|stayOpts/);
  assert.match(app, /copying \? 'checkbox' : 'radio'/);
  assert.match(app, /D\.copyToDays\(trip, op\.itemId, op\.copy\)/);
  assert.match(html, /id="placeGroupsSort" data-ui-select/);
  assert.match(app, /class="tile" data-open-place-groups/);
  assert.match(app, /removePlaceGroup\(trip, ids\)/);
});
