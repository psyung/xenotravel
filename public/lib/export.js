// 엑셀(.xlsx)과 JSON 백업 내보내기. 엑셀은 전역 XLSX(SheetJS)를 쓴다.
import { EXPORT_HEADER, tripToRows, safeFileName, stayDates, flightKind, flightSummary } from './model.js';
import { t } from './i18n.js';

const COL_WIDTHS = { 일차: 8, 날짜: 11, 순서: 5, 시간: 7, 종류: 6, 장소: 28, 주소: 40, 메모: 40, 링크: 30, 구글맵: 22, 위도: 11, 경도: 11 };
const LINK_COLS = ['링크', '구글맵'];

// S-3: SheetJS는 페이지를 열 때가 아니라 [엑셀 내보내기]를 누를 때 vendor/에서 불러온다 (공식 배포본 0.20.3 고정)
export const XLSX_SRC = 'vendor/xlsx/xlsx.full.min.js';
let xlsxLoading = null;
/** SheetJS를 한 번만 불러온다. 실패하면 다음 클릭에 다시 시도한다 */
export function loadXlsx(doc = globalThis.document) {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  xlsxLoading ??= new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = XLSX_SRC;
    s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('XLSX')));
    s.onerror = () => {
      s.remove();
      reject(new Error('XLSX'));
    };
    doc.head.append(s);
  }).catch(() => {
    xlsxLoading = null;
    throw new Error(t('엑셀 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
  });
  return xlsxLoading;
}

export async function exportXlsx(trip) {
  const XLSX = await loadXlsx();
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

/** 일정 파일 이름: xenotravel-backup-{여행명}-{날짜}.json (전체 백업) / xenotravel-share-{여행명}-{날짜}.json (공유용 사본) */
export function jsonFileName(trip, kind = 'backup', now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `xenotravel-${kind === 'share' ? 'share' : 'backup'}-${safeFileName(trip.title)}-${d}.json`;
}

export function downloadJson(trip, { kind = 'backup' } = {}) {
  download(JSON.stringify(trip, null, 2), 'application/json', jsonFileName(trip, kind));
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

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const icsDateTime = (v) => {
  const m = DATETIME.exec(v ?? '');
  return m ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : '';
};
const icsDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v.replaceAll('-', '') : '');

/** 항공편: 출발~도착 (현지 시각 그대로, 시간대 없이) */
function flightEvents(trip, stamp) {
  return (trip.flights ?? []).flatMap((f) => {
    const start = icsDateTime(f.departAt);
    if (!start) return [];
    const end = f.arriveAt && f.arriveAt > f.departAt ? icsDateTime(f.arriveAt) : '';
    // 날짜변경선을 넘어 도착 현지 시각이 출발보다 이르면 DTEND를 쓸 수 없다 → 도착 현지 시각을 설명에 남긴다 (GPT 검수 #15)
    const arriveNote = f.arriveAt && !end ? t('도착 (현지 시각) {time}', { time: f.arriveAt.replace('T', ' ') }) : '';
    const desc = [arriveNote, f.bookingRef && t('예약번호 {ref}', { ref: f.bookingRef }), f.memo].filter(Boolean).join('\n');
    return [[
      'BEGIN:VEVENT',
      `UID:${calendarEscape(trip.id)}-flight-${calendarEscape(f.id)}@xenotravel`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      ...(end ? [`DTEND:${end}`] : []),
      `SUMMARY:${calendarEscape(`${flightKind(f.kind)} · ${flightSummary(f)}`)}`,
      ...(f.from || f.to ? [`LOCATION:${calendarEscape([f.from, f.to].filter(Boolean).join(' → '))}`] : []),
      ...(desc ? [`DESCRIPTION:${calendarEscape(desc)}`] : []),
      'END:VEVENT',
    ]];
  });
}

/** 숙소: 체크인 날부터 체크아웃 날까지 종일 일정 */
function stayEvents(trip, stamp) {
  return (trip.stays ?? []).flatMap((s) => {
    const { checkIn, checkOut } = stayDates(trip, s);
    const start = icsDate(checkIn);
    if (!start) return [];
    const end = icsDate(checkOut);
    return [[
      'BEGIN:VEVENT',
      `UID:${calendarEscape(trip.id)}-stay-${calendarEscape(s.id)}@xenotravel`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      ...(end && end > start ? [`DTEND;VALUE=DATE:${end}`] : []),
      `SUMMARY:${calendarEscape(t('숙소 {name}', { name: s.name }))}`,
      ...(s.address ? [`LOCATION:${calendarEscape(s.address)}`] : []),
      ...(s.memo ? [`DESCRIPTION:${calendarEscape(s.memo)}`] : []),
      'END:VEVENT',
    ]];
  });
}

/** 표준 캘린더(VCALENDAR 2.0): 항공편 · 숙소(체크인~체크아웃) · 날짜가 있는 일차의 장소(시간을 정했으면 그 시각, 아니면 종일) */
export function tripToCalendar(trip) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const placeEvents = (trip.days ?? []).flatMap(({ date, items }) => {
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
  const events = [...flightEvents(trip, stamp), ...(trip.days?.length ? stayEvents(trip, stamp) : []), ...placeEvents];
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
