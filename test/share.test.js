import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/lib/model.js';
import { encodeShare, decodeShare, shareUrl, shareCodeFromHash } from '../public/lib/share.js';

function sampleTrip() {
  const t = M.createTrip({ title: '오사카 3박', destination: '오사카', startDate: '2026-12-01', endDate: '2026-12-04', center: { lat: 34.69, lng: 135.5 } });
  M.addItem(t, t.days[0].id, { name: '도톤보리', address: '오사카', lat: 34.6687, lng: 135.5013, memo: '타코야키\n줄 김', url: 'https://example.com' });
  M.addItem(t, M.INBOX, { name: '우메다 스카이빌딩', lat: 34.7053, lng: 135.4896 });
  M.addStay(t, { name: '난바 호텔', lat: 34.665, lng: 135.501 }, 0, 3);
  M.addFlight(t, { kind: 'out', flightNo: 'ke723', from: 'ICN', to: 'KIX', departAt: '2026-12-01T09:00', arriveAt: '2026-12-01T11:00' });
  return t;
}

test('공유 링크: 왕복하면 내용이 같고 id는 새로 만든다', async () => {
  const t = sampleTrip();
  const code = await encodeShare(t, { includePrivate: true });
  assert.match(code, /^1\.[A-Za-z0-9_-]+$/); // URL에 그대로 넣을 수 있는 문자만
  const back = await decodeShare(code);

  assert.equal(back.title, '오사카 3박');
  assert.deepEqual(back.center, t.center);
  assert.deepEqual(back.days.map((d) => d.date), t.days.map((d) => d.date));
  assert.equal(back.days[0].items[0].memo, '타코야키\n줄 김');
  assert.equal(back.inbox[0].name, '우메다 스카이빌딩');
  assert.equal(back.stays[0].nights, 3);
  assert.equal(back.flights[0].flightNo, 'KE723');

  assert.notEqual(back.id, t.id);
  assert.notEqual(back.days[0].id, t.days[0].id);
  assert.notEqual(back.days[0].items[0].id, t.days[0].items[0].id);
  assert.doesNotThrow(() => M.validateTrip(back));
});

test('공유 링크 기본값: 개인 기록을 원본에만 두고 기준 시각을 공유한다', async () => {
  const t = sampleTrip();
  t.inbox[0].memo = t.stays[0].memo = t.flights[0].memo = 'PRIVATE';
  t.flights[0].bookingRef = 'BOOKING123';
  t.budget = { expenses: [{ memo: 'BUDGET123' }] };
  t.checks = [{ text: 'CHECK123' }];
  const code = await encodeShare(t);
  const compressed = Buffer.from(code.slice(2), 'base64url');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const raw = JSON.parse(await new Response(stream).text());
  assert.doesNotMatch(JSON.stringify(raw), /타코야키|PRIVATE|BOOKING123|BUDGET123|CHECK123/);
  const back = await decodeShare(code);
  assert.equal(back.sharedAt, raw.sharedAt);
  assert.ok(Number.isFinite(Date.parse(back.sharedAt)));
  assert.equal(t.flights[0].bookingRef, 'BOOKING123');
  assert.equal((await decodeShare(await encodeShare(t, { includePrivate: true }))).flights[0].bookingRef, 'BOOKING123');
});

test('공유 링크: 남이 만든 id에 HTML이 있어도 새 id로 바뀐다', async () => {
  const t = sampleTrip();
  t.days[0].id = '"><img src=x onerror=alert(1)>';
  t.days[0].items[0].id = '"><script>';
  const back = await decodeShare(await encodeShare(t));
  const ids = [back.id, ...back.days.map((d) => d.id), ...back.days.flatMap((d) => d.items.map((i) => i.id))];
  for (const id of ids) assert.doesNotMatch(id, /[<>"]/);
});

test('공유 링크: 빠진 문자열 필드는 빈 문자열로 채운다', async () => {
  const t = sampleTrip();
  delete t.days[0].items[0].memo;
  delete t.days[0].items[0].time;
  const back = await decodeShare(await encodeShare(t));
  assert.equal(back.days[0].items[0].memo, '');
  assert.equal(back.days[0].items[0].time, '');
});

test('공유 링크: 잘리거나 엉뚱한 코드는 알아듣는 오류', async () => {
  const code = await encodeShare(sampleTrip());
  for (const bad of [code.slice(0, code.length / 2), '1.abc', '2.' + code.slice(2), '', 'hello']) {
    await assert.rejects(decodeShare(bad), /공유 링크/);
  }
});

test('shareUrl / shareCodeFromHash', () => {
  assert.equal(shareUrl('http://localhost:5173/#s=old', '1.xyz'), 'http://localhost:5173/#s=1.xyz');
  assert.equal(shareCodeFromHash('#s=1.xyz'), '1.xyz');
  assert.equal(shareCodeFromHash('#other'), null);
  assert.equal(shareCodeFromHash(''), null);
});

test('공유 링크 길이: 장소 40곳 일정도 메신저에 보낼 만한 길이', async () => {
  const t = M.createTrip({ title: '긴 여행', startDate: '2026-12-01', endDate: '2026-12-08' });
  for (let i = 0; i < 40; i++) {
    M.addItem(t, t.days[i % 8].id, { name: `장소 ${i} 라멘집`, address: `Osaka, Chuo Ward, Namba ${i}-chome`, lat: 34.6 + i / 1000, lng: 135.5 + i / 1000, memo: '영업시간 11~22시, 현금만' });
  }
  const code = await encodeShare(t);
  assert.ok(code.length < 8000, `length=${code.length}`);
});

test('shareSummary / shareMessage: 카톡에 붙일 요약', async () => {
  const { shareSummary, shareMessage } = await import('../public/lib/share.js');
  const t = sampleTrip(); // 12/1~12/4, 장소 1곳(보관함 제외)
  assert.deepEqual(shareSummary(t), { title: '오사카 3박', line: '12월 1일 ~ 12월 4일 · 3박 4일 · 장소 1곳' });
  const one = M.createTrip({ title: '당일', startDate: '2026-12-01', endDate: '2026-12-01' });
  assert.equal(shareSummary(one).line, '12월 1일 · 당일치기');
  const msg = shareMessage(t, 'https://x.example/s/Ab3dE9xk');
  assert.match(msg, /^오사카 3박\n12월 1일 ~ 12월 4일/);
  assert.ok(msg.endsWith('https://x.example/s/Ab3dE9xk'));
});
