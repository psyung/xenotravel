// 가져오는 데이터의 크기 제한 (S-5). 백업 파일·공유 링크·장소 일괄 가져오기에 같은 값을 쓴다.
// 제한을 넘으면 기존 데이터를 건드리지 않고 이유를 알린다 (검사는 저장 전에 끝난다).
import { t, k } from './i18n.js';

export const LIMITS = Object.freeze({
  days: 120, // 여행 1개의 일수
  places: 2000, // 일정·보관함·숙소 장소 합계
  expenses: 5000, // 지출 기록
  name: 200, // 이름·제목 글자 수
  memo: 5000, // 메모 글자 수
  url: 2000, // 링크 글자 수
  shareCode: 200 * 1024, // 공유 링크 코드 글자 수
});

/** 제한을 넘었을 때의 오류 (code: 'limit') */
export function limitError(what, max) {
  return Object.assign(new Error(t('데이터가 너무 커서 가져올 수 없어요: {what} 최대 {max}', { what: t(what), max: max.toLocaleString('en-US') })), { code: 'limit' });
}

/** 개수·글자 수 검사. 넘으면 limitError를 던진다 */
export function checkMax(value, max, what) {
  if (value > max) throw limitError(what, max);
}

/** 여행 객체의 개수·글자 수 제한 검사 (validateTrip이 모양을 검사한 뒤 부른다) */
export function checkTripLimits(obj) {
  const len = (v) => (typeof v === 'string' ? v.length : 0);
  checkMax(obj.days.length, LIMITS.days, k('일수'));
  const places = [...obj.days.flatMap((d) => d.items), ...(obj.inbox ?? []), ...(obj.stays ?? [])];
  checkMax(places.length, LIMITS.places, k('장소 수'));
  if (Array.isArray(obj.expenses)) checkMax(obj.expenses.length, LIMITS.expenses, k('지출 수'));
  checkMax(len(obj.title), LIMITS.name, k('이름 글자 수'));
  for (const p of places) {
    checkMax(len(p.name), LIMITS.name, k('이름 글자 수'));
    checkMax(len(p.address), LIMITS.memo, k('메모 글자 수'));
    checkMax(len(p.memo), LIMITS.memo, k('메모 글자 수'));
    checkMax(len(p.url), LIMITS.url, k('링크 글자 수'));
  }
  for (const f of obj.flights ?? []) checkMax(len(f.memo), LIMITS.memo, k('메모 글자 수'));
  for (const e of Array.isArray(obj.expenses) ? obj.expenses : []) {
    checkMax(len(e?.memo), LIMITS.memo, k('메모 글자 수'));
  }
  for (const c of Array.isArray(obj.checks) ? obj.checks : []) checkMax(len(c?.text), LIMITS.name, k('이름 글자 수'));
}
