// F-1: 여행 데이터 유실 방지 — 백업 권유 규칙 (순수 함수). 화면(알림·메뉴 배지)은 app.js.
// 데이터는 이 브라우저의 localStorage에만 있다. Safari는 7일 동안 방문하지 않은 사이트의 저장 데이터를 지울 수 있어
// 영구 저장(navigator.storage.persist)을 요청하고, 아래 때에 백업 파일 저장을 권한다.
import { t } from './i18n.js';

export const BIG_CHANGES = 20; // 마지막 백업 뒤 이만큼 고치면 권한다

const DAY = 86400000;
const dayStart = (iso) => Date.parse(`${iso}T00:00:00`);

/**
 * 지금 백업을 권할 이유 (없으면 null). 같은 이유는 한 번만 권하도록 key를 돌려준다.
 *  - 'before': 출발 7일 전부터 (그 뒤로 백업하지 않았으면)
 *  - 'after': 여행 끝난 다음 날부터 (그 뒤로 백업하지 않았으면)
 *  - 'changes': 마지막 백업 뒤 큰 변경 20회
 * → { reason, key } | null
 */
export function backupReason(trip, { last = 0, changes = 0, now = Date.now() } = {}) {
  if (!trip) return null;
  if (trip.startDate) {
    const start = dayStart(trip.startDate);
    const from = start - 7 * DAY;
    if (now >= from && now < start && last < from) return { reason: 'before', key: `before:${trip.startDate}` };
  }
  if (trip.endDate) {
    const after = dayStart(trip.endDate) + DAY;
    if (now >= after && last < after) return { reason: 'after', key: `after:${trip.endDate}` };
  }
  if (changes >= BIG_CHANGES) return { reason: 'changes', key: `changes:${last}` };
  return null;
}

/** 권유 문구 */
export function backupReasonText(reason) {
  if (reason === 'before') return t('출발이 일주일 남았어요. 일정이 사라지지 않게 백업 파일을 저장해 두세요');
  if (reason === 'after') return t('여행이 끝났어요. 기록이 사라지지 않게 백업 파일을 저장해 두세요');
  return t('일정을 많이 고쳤어요. 백업 파일을 저장해 두세요');
}

/** 메뉴의 "마지막 백업: n일 전" */
export function lastBackupLabel(last, now = Date.now()) {
  if (!last) return t('아직 백업하지 않았어요');
  const days = Math.floor((now - last) / DAY);
  return days < 1 ? t('마지막 백업: 오늘') : t('마지막 백업: {n}일 전', { n: days });
}
