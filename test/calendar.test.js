import test from 'node:test';
import assert from 'node:assert/strict';
import { tripToCalendar } from '../public/lib/export.js';

test('캘린더 내보내기는 종일 일정과 시간 지정 일정을 함께 저장한다', () => {
  const name = '여행 일정'.repeat(20);
  const calendar = tripToCalendar({
    id: 'trip', title: '여행',
    days: [{
      date: '2026-11-19',
      items: [{ id: 'a', name }, { id: 'b', name: '식사', time: '09:30', memo: '예약, 확인\n완료' }],
    }],
    inbox: [{ id: 'c', name: '보관함' }],
  });
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = calendar.replaceAll('\r\n ', '');
  assert.ok(unfolded.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20261119\r\n'));
  assert.ok(unfolded.includes('DTSTART:20261119T093000\r\n'));
  assert.ok(unfolded.includes(`SUMMARY:${name}\r\n`));
  assert.ok(unfolded.includes('DESCRIPTION:예약\\, 확인\\n완료\r\n'));
  assert.equal([...unfolded.matchAll(/BEGIN:VEVENT/g)].length, 2);
  assert.equal(tripToCalendar({ days: [] }), '');
});
