// 엑셀(.xlsx)과 JSON 백업 내보내기. 엑셀은 전역 XLSX(SheetJS)를 쓴다.
import { EXPORT_HEADER, tripToRows, safeFileName } from './model.js';

const COL_WIDTHS = { 일차: 8, 날짜: 11, 순서: 5, 시간: 7, 종류: 6, 장소: 28, 주소: 40, 메모: 40, 링크: 30, 구글맵: 22, 위도: 11, 경도: 11 };
const LINK_COLS = ['링크', '구글맵'];

export function exportXlsx(trip) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  const rows = tripToRows(trip);
  const aoa = [EXPORT_HEADER, ...rows.map((r) => EXPORT_HEADER.map((h) => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  rows.forEach((r, i) => {
    for (const col of LINK_COLS) {
      const url = r[col];
      if (!/^https?:\/\//.test(url ?? '')) continue;
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: EXPORT_HEADER.indexOf(col) });
      if (col === '구글맵') ws[ref].v = '지도 열기';
      ws[ref].l = { Target: url };
    }
  });
  ws['!cols'] = EXPORT_HEADER.map((h) => ({ wch: COL_WIDTHS[h] ?? 12 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일정');
  XLSX.writeFile(wb, `${safeFileName(trip.title)}.xlsx`);
}

export function downloadJson(trip) {
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(trip.title)}.xenotravel.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
