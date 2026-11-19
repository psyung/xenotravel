// 엑셀(.xlsx)과 JSON 백업 내보내기. 엑셀은 전역 XLSX(SheetJS)를 쓴다.
import { EXPORT_HEADER, tripToRows, safeFileName } from './model.js';
import { t } from './i18n.js';

const COL_WIDTHS = { 일차: 8, 날짜: 11, 순서: 5, 시간: 7, 종류: 6, 장소: 28, 주소: 40, 메모: 40, 링크: 30, 구글맵: 22, 위도: 11, 경도: 11 };
const LINK_COLS = ['링크', '구글맵'];

export function exportXlsx(trip) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error(t('엑셀 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
  const rows = tripToRows(trip);
  const aoa = [EXPORT_HEADER.map((h) => t(h)), ...rows.map((r) => EXPORT_HEADER.map((h) => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  rows.forEach((r, i) => {
    for (const col of LINK_COLS) {
      const url = r[col];
      if (!/^https?:\/\//.test(url ?? '')) continue;
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: EXPORT_HEADER.indexOf(col) });
      if (col === '구글맵') ws[ref].v = t('지도 열기');
      ws[ref].l = { Target: url };
    }
  });
  ws['!cols'] = EXPORT_HEADER.map((h) => ({ wch: COL_WIDTHS[h] ?? 12 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t('일정').slice(0, 31));
  XLSX.writeFile(wb, `${safeFileName(trip.title)}.xlsx`);
}

export function downloadJson(trip) {
  download(JSON.stringify(trip, null, 2), 'application/json', `${safeFileName(trip.title)}.xenotravel.json`);
}

function download(content, type, filename) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const calendarEscape = (value) => String(value ?? '').replace(/\\/g, '\\\\')
  .replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');

function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  let folded = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += char;
    bytes += size;
  }
  return folded;
}

export function tripToCalendar(trip) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const events = trip.days.flatMap(({ date, items }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const day = date.replaceAll('-', '');
    return items.map((item) => {
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) ? item.time.replace(':', '') : '';
      return [
        'BEGIN:VEVENT',
        `UID:${calendarEscape(trip.id)}-${calendarEscape(item.id)}@xenotravel`,
        `DTSTAMP:${stamp}`,
        time ? `DTSTART:${day}T${time}00` : `DTSTART;VALUE=DATE:${day}`,
        `SUMMARY:${calendarEscape(item.name || trip.title)}`,
        ...(item.address ? [`LOCATION:${calendarEscape(item.address)}`] : []),
        ...(item.memo ? [`DESCRIPTION:${calendarEscape(item.memo)}`] : []),
        'END:VEVENT',
      ];
    });
  });
  if (!events.length) return '';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//XenoTravel//Trip Planner//KO',
    ...events.flat(), 'END:VCALENDAR', ''].map(foldCalendarLine).join('\r\n');
}

export function downloadCalendar(trip) {
  const calendar = tripToCalendar(trip);
  if (!calendar) return false;
  download(calendar, 'text/calendar;charset=utf-8', `${safeFileName(trip.title)}.ics`);
  return true;
}
