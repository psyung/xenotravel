import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import * as W from '../public/lib/weather.js';

const TODAY = '2026-11-19';
const OSAKA = { lat: 34.6937, lng: 135.5023 };

function trip(start, end, { stay = true } = {}) {
  const t = M.createTrip({ title: 't', startDate: start, endDate: end, center: OSAKA });
  if (stay) M.addStay(t, { name: '호텔', lat: 34.665, lng: 135.501 }, 0, t.days.length);
  return t;
}

const memStorage = () => {
  const m = {};
  return { getItem: (k) => m[k] ?? null, setItem: (k, v) => (m[k] = v), m };
};

/** Open-Meteo 응답 흉내: 요청한 날짜 범위를 채워 준다 */
function fakeFetch(calls, { code = 0, prob = 10, fail = false } = {}) {
  return async (url) => {
    calls.push(url);
    if (fail) throw new Error('offline');
    const u = new URL(url);
    const dates = M.dateRange(u.searchParams.get('start_date'), u.searchParams.get('end_date'));
    const n = dates.length;
    const daily = {
      time: dates,
      weather_code: Array(n).fill(code),
      temperature_2m_max: Array(n).fill(18.4),
      temperature_2m_min: Array(n).fill(8.6),
      precipitation_sum: Array(n).fill(code >= 61 ? 6 : 0),
    };
    if (u.searchParams.get('daily').includes('probability')) daily.precipitation_probability_max = Array(n).fill(prob);
    return { ok: true, json: async () => ({ daily }) };
  };
}

test('describeCode: WMO 코드 → 한국어', () => {
  assert.deepEqual(W.describeCode(0), { text: '맑음', icon: 'sun' });
  assert.equal(W.describeCode(63).text, '비');
  assert.equal(W.describeCode(73).icon, 'snow');
  assert.equal(W.describeCode(95).icon, 'storm');
  assert.equal(W.describeCode(1234).text, '');
});

test('planRequests: 16일 안은 예보, 먼 날은 작년 같은 날, 한 도시는 요청 하나', () => {
  const t = trip('2026-11-30', '2026-12-08');
  const reqs = W.planRequests(t, TODAY);
  assert.equal(reqs.length, 2);
  const [f, c] = [reqs.find((r) => r.kind === 'forecast'), reqs.find((r) => r.kind === 'climate')];
  assert.deepEqual([f.start, f.end], ['2026-11-30', '2026-12-04']); // 11/19 + 15일
  assert.deepEqual([c.start, c.end], ['2025-12-05', '2025-12-08']);
  assert.equal(f.days.length + c.days.length, 9);
  assert.equal(f.lat, 34.7);
  assert.match(W.requestUrl(f), /api\.open-meteo\.com\/v1\/forecast.*precipitation_probability_max/);
  assert.match(W.requestUrl(c), /archive-api\.open-meteo\.com\/v1\/archive/);
  assert.doesNotMatch(W.requestUrl(c), /probability/);
});

test('planRequests: 지난 여행과 날짜 없는 여행은 요청 없음', () => {
  assert.deepEqual(W.planRequests(trip('2025-03-01', '2025-03-02'), TODAY), []);
  const undated = M.createTrip({ title: 'x', center: OSAKA });
  assert.deepEqual(W.planRequests(undated, TODAY), []);
});

test('dayPoint: 숙소 → 첫 장소 → 여행지 중심', () => {
  const t = trip('2026-12-01', '2026-12-02', { stay: false });
  assert.deepEqual(W.dayPoint(t, 0), OSAKA);
  M.addItem(t, t.days[0].id, { name: 'a', lat: 35, lng: 136 });
  assert.deepEqual(W.dayPoint(t, 0), { lat: 35, lng: 136 });
  M.addStay(t, { name: 'h', lat: 34.1, lng: 135.1 }, 0, 1);
  assert.deepEqual(W.dayPoint(t, 0), { lat: 34.1, lng: 135.1 });
});

test('summarize / isWet: 비 올 확률이 높으면 비 소식, 작년 기록은 비 안내 없음', () => {
  const sunny = W.summarize({ code: 0, max: 18.4, min: 8.6, prob: 10, rainMm: 0 }, 'forecast');
  assert.equal(sunny.temp, '18° / 9°');
  assert.equal(sunny.wet, false);
  assert.equal(W.summarize({ code: 3, max: 10, min: 5, prob: 70, rainMm: 3 }, 'forecast').wet, true);
  assert.equal(W.summarize({ code: 61, max: 10, min: 5, prob: 45, rainMm: 3 }, 'forecast').wet, true);
  assert.equal(W.summarize({ code: 63, max: 10, min: 5, prob: null, rainMm: 8 }, 'climate').wet, false);
  assert.equal(W.summarize(undefined, 'forecast'), null);
});

test('loadWeather: 일차별로 붙이고, 캐시가 있으면 다시 묻지 않는다', async () => {
  const t = trip('2026-11-30', '2026-12-08');
  const calls = [];
  const storage = memStorage();
  const now = Date.parse('2026-11-19T00:00:00Z');
  const wx = await W.loadWeather(t, TODAY, { fetch: fakeFetch(calls, { code: 63, prob: 80 }), storage, now });
  assert.equal(calls.length, 2);
  assert.equal(Object.keys(wx).length, 9);
  const first = wx[t.days[0].id];
  assert.equal(first.kind, 'forecast');
  assert.equal(first.text, '비');
  assert.equal(first.prob, 80);
  assert.equal(first.wet, true);
  const far = wx[t.days.at(-1).id];
  assert.equal(far.kind, 'climate');
  assert.equal(far.forecastFrom, '2026-11-23'); // 12/8 - 15일
  assert.equal(far.ref.text, '비'); // 작년 기록은 ref에만
  assert.equal(far.ref.wet, false); // 작년 기록으로는 비 안내를 하지 않는다

  // 1시간 뒤: 캐시 사용
  await W.loadWeather(t, TODAY, { fetch: fakeFetch(calls), storage, now: now + 3600e3 });
  assert.equal(calls.length, 2);
  // 4시간 뒤 + 오프라인: 예보는 다시 물으려다 실패 → 오래된 캐시로 보여준다
  const offline = await W.loadWeather(t, TODAY, { fetch: fakeFetch(calls, { fail: true }), storage, now: now + 4 * 3600e3 });
  assert.equal(calls.length, 3);
  assert.equal(Object.keys(offline).length, 9);
});

test('loadWeather: 처음부터 오프라인이면 빈 결과 (오류 없이)', async () => {
  const wx = await W.loadWeather(trip('2026-12-01', '2026-12-02'), TODAY, { fetch: fakeFetch([], { fail: true }), storage: memStorage() });
  assert.deepEqual(wx, {});
});

test('loadWeather: 먼 여행은 오프라인이어도 "예보 전"은 보여준다', async () => {
  const t = trip('2027-03-01', '2027-03-02');
  const wx = await W.loadWeather(t, TODAY, { fetch: fakeFetch([], { fail: true }), storage: memStorage() });
  assert.deepEqual(Object.values(wx), [
    { kind: 'climate', forecastFrom: '2027-02-14', ref: null },
    { kind: 'climate', forecastFrom: '2027-02-15', ref: null },
  ]);
});

test('weatherSignature: 날짜나 숙소 위치가 바뀌면 달라진다', () => {
  const t = trip('2026-12-01', '2026-12-03');
  const a = W.weatherSignature(t, TODAY);
  assert.equal(W.weatherSignature(t, TODAY), a);
  M.setTripDates(t, '2026-12-02', '2026-12-04');
  assert.notEqual(W.weatherSignature(t, TODAY), a);
});
