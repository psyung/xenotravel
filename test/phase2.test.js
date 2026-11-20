// 2차 안정화·고도화: 정산, 시간 겹침, 외부 지도 길찾기, 캘린더(항공·숙소), 샘플 편집 보존, 통화별 합계
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import * as B from '../public/lib/budget.js';
import * as S from '../public/lib/settle.js';
import { tripToCalendar } from '../public/lib/export.js';

const newTrip = () => M.createTrip({ title: '여행', destination: '도쿄', startDate: '2026-12-01', endDate: '2026-12-03', center: { lat: 35.68, lng: 139.76 } });

test('정산: 결제자·분담 대상으로 인당 부담과 최소 송금을 계산한다', () => {
  const trip = newTrip();
  B.ensureBudget(trip);
  trip.budget.currency = 'KRW';
  assert.equal(S.settlement(trip), null, '동행 2명 미만이면 정산하지 않는다');
  const me = S.addMember(trip, '나');
  const a = S.addMember(trip, '민수');
  const b = S.addMember(trip, '지영');
  assert.equal(S.addMember(trip, '나'), null, '같은 이름은 넣지 않는다');
  S.setExpenseShare(trip, B.addExpense(trip, { amount: 30000, cur: 'KRW' }), { payer: me.id });
  S.setExpenseShare(trip, B.addExpense(trip, { amount: 12000, cur: 'KRW' }), { payer: a.id, split: [a.id, b.id] });
  B.addExpense(trip, { amount: 5000, cur: 'KRW' }); // 결제자 없음 → 제외
  const s = S.settlement(trip);
  assert.equal(s.total, 42000);
  assert.equal(s.noPayer, 1);
  const by = Object.fromEntries(s.people.map((p) => [p.name, p]));
  assert.deepEqual([by['나'].paid, by['나'].share, by['나'].net], [30000, 10000, 20000]);
  assert.deepEqual([by['민수'].paid, by['민수'].share, by['민수'].net], [12000, 16000, -4000]);
  assert.deepEqual([by['지영'].paid, by['지영'].share, by['지영'].net], [0, 16000, -16000]);
  assert.deepEqual(s.transfers.map((x) => [x.from, x.to, x.amount]), [['지영', '나', 16000], ['민수', '나', 4000]]);
  assert.match(S.settlementText(trip, s, B.won), /지영 → 나: ₩16,000/);
  // 전원 분담이면 split을 저장하지 않는다 (나중에 동행이 늘어도 전원)
  const e = trip.expenses[0];
  assert.equal('split' in e, false);
  // 동행을 빼면 그 사람의 결제자·분담 표시도 지운다
  S.removeMember(trip, a.id);
  assert.equal(trip.expenses[1].payer, undefined);
  assert.deepEqual(trip.expenses[1].split, [b.id]);
});

test('정산: 환율 미정 지출은 빼고 개수만 알린다', () => {
  const trip = newTrip();
  B.ensureBudget(trip);
  trip.budget.currency = 'JPY';
  trip.budget.krwPerUnit = 0;
  const me = S.addMember(trip, '나');
  S.addMember(trip, '너');
  S.setExpenseShare(trip, B.addExpense(trip, { amount: 1000, cur: 'local' }), { payer: me.id });
  const s = S.settlement(trip);
  assert.equal(s.noRate, 1);
  assert.equal(s.total, 0);
  assert.deepEqual(s.transfers, []);
});

test('시간 겹침: 앞 장소보다 이르거나 같은 시각, 비행기 도착 전·출발 후를 찾고 30분씩 민다', () => {
  const items = [
    { id: 'a', time: '10:00' },
    { id: 'b', time: '' },
    { id: 'c', time: '09:30' },
    { id: 'd', time: '11:00' },
    { id: 'e', time: '11:00' },
  ];
  assert.deepEqual([...M.timeConflicts(items)], ['c', 'e']);
  assert.deepEqual([...M.timeConflicts([{ id: 'x', time: '08:00' }], { after: '09:10' })], ['x']);
  assert.deepEqual([...M.timeConflicts([{ id: 'y', time: '19:00' }], { before: '18:30' })], ['y']);
  assert.equal(M.shiftTimesFrom(items, 2, 30), 3);
  assert.deepEqual(items.map((x) => x.time), ['10:00', '', '10:00', '11:30', '11:30']);
  const late = [{ id: 'z', time: '23:50' }];
  M.shiftTimesFrom(late, 0, 30);
  assert.equal(late[0].time, '23:59', '자정을 넘기지 않는다');
});

test('길찾기: 구글·애플 링크에 직전 장소를 출발지로 넣고, 중국 본토면 고덕·바이두를 더한다', () => {
  const to = { lat: 35.71, lng: 139.79, name: '센소지' };
  const from = { lat: 35.68, lng: 139.76, name: '호텔' };
  const links = M.directionsLinks(to, from);
  assert.deepEqual(links.map((x) => x.id), ['google', 'apple']);
  assert.match(links[0].url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=35\.68,139\.76&destination=35\.71,139\.79/);
  assert.equal(links[1].url, 'https://maps.apple.com/?saddr=35.68,139.76&daddr=35.71,139.79&dirflg=r');
  assert.doesNotMatch(M.directionsLinks(to).map((x) => x.url).join(), /origin=|saddr=/);
  const sh = M.directionsLinks({ lat: 31.24, lng: 121.49, name: '外滩' }, { lat: 31.23, lng: 121.47, name: '酒店' }, { china: true });
  assert.deepEqual(sh.map((x) => x.id), ['google', 'apple', 'amap', 'baidu']);
  assert.match(sh[2].url, /^https:\/\/uri\.amap\.com\/navigation\?from=[\d.]+,[\d.]+,.+&to=[\d.]+,[\d.]+,.+&mode=bus/);
  assert.match(sh[3].url, /coord_type=wgs84/);
  // 중국 본토 판정: 홍콩·마카오·대만·서울·도쿄는 아님
  assert.equal(M.inMainlandChina({ lat: 31.23, lng: 121.47 }), true);
  assert.equal(M.inMainlandChina({ lat: 39.9, lng: 116.4 }), true);
  for (const p of [[22.3, 114.17], [22.19, 113.54], [25.03, 121.56], [37.56, 126.97], [35.68, 139.76]]) assert.equal(M.inMainlandChina({ lat: p[0], lng: p[1] }), false, p.join());
  assert.equal(M.tripInMainlandChina({ country: 'cn' }), true);
  assert.equal(M.tripInMainlandChina({ country: 'hk', center: { lat: 31.2, lng: 121.4 } }), false);
});

test('캘린더: 항공편(출발~도착)과 숙소(체크인~체크아웃)를 함께 넣는다', () => {
  const trip = newTrip();
  trip.stays = [{ id: 's1', name: '호텔', startIndex: 0, nights: 2, memo: '' }];
  trip.flights = [{ id: 'f1', kind: 'out', flightNo: 'KE701', from: 'ICN', to: 'NRT', departAt: '2026-12-01T09:00', arriveAt: '2026-12-01T11:30', bookingRef: 'ABC123', memo: '' }];
  const ics = tripToCalendar(trip).replaceAll('\r\n ', '');
  assert.match(ics, /UID:[^\r]*-flight-f1@xenotravel\r\nDTSTAMP:\w+\r\nDTSTART:20261201T090000\r\nDTEND:20261201T113000\r\n/);
  assert.match(ics, /DESCRIPTION:예약번호 ABC123/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261203\r\nSUMMARY:숙소 호텔/);
});

test('샘플 여행: 사용자가 고친 뒤에는 언어를 바꿔도 여행 내용을 번역하지 않는다', () => {
  const map = { ko: '센소지', en: 'Senso-ji', zh: '浅草寺', ja: '浅草寺' };
  const trip = newTrip();
  trip.presetI18n = { title: { ko: '도쿄 샘플', en: 'Tokyo sample', zh: '东京示例', ja: '東京サンプル' } };
  trip.title = '도쿄 샘플';
  trip.isUserModified = false;
  const it = M.addItem(trip, trip.days[0].id, { name: '센소지', nameI18n: map, lat: 35.71, lng: 139.79 });
  assert.equal(M.localizePresets(trip, 'en'), true);
  assert.equal(it.name, 'Senso-ji');
  trip.isUserModified = true;
  assert.equal(M.localizePresets(trip, 'ja'), false);
  assert.equal(it.name, 'Senso-ji');
  assert.equal(trip.title, 'Tokyo sample');
});

test('가계부: 통화별 합계는 기록한 통화 그대로 더한다', () => {
  const trip = newTrip();
  B.ensureBudget(trip);
  trip.budget.currency = 'JPY';
  trip.budget.krwPerUnit = 9;
  B.addExpense(trip, { amount: 1000, cur: 'local' });
  B.addExpense(trip, { amount: 500, cur: 'local' });
  B.addExpense(trip, { amount: 20000, cur: 'KRW' });
  assert.deepEqual(B.currencyTotals(trip), { local: 1500, krw: 20000, localCount: 2, krwCount: 1, other: {} }); // other: 현지 통화를 바꾸기 전 다른 통화로 적은 기록 (Phase 4)
  assert.equal(B.summarize(trip).spent, 1500 * 9 + 20000);
});

test('보관함 "보낼 날" select: 포커스해도 보관함이 숨지 않고, 바깥 탭 닫기가 보관함을 다시 그리지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const hide = [...css.matchAll(/body:has\(([^{]*?)\)\s*\.inbox-dock/g)].map((m) => m[1]);
  assert.ok(hide.length, '입력 중 보관함 숨김 규칙이 있다');
  for (const sel of hide) {
    assert.doesNotMatch(sel, /\bselect\b/, 'select 포커스로 보관함을 숨기지 않는다');
    assert.match(sel, /:not\(\.inbox-dock \*\)/, '보관함 안의 칸은 제외한다');
  }
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const safe = /const OUTSIDE_SAFE = '([^']*)'/.exec(app)[1];
  assert.match(safe, /\.inbox-dock/);
  assert.match(safe, /\bselect\b/);
  assert.match(app, /handle: '\.drag'/, '드래그는 ⋮⋮ 손잡이에서만 시작한다');
});
