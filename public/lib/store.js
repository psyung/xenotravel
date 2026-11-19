// 브라우저 저장소. 이 버전은 서버 없이 이 브라우저에만 저장한다.
const KEY = 'xenotravel:v1';
const LEGACY_KEYS = ['tripnote:v1']; // 이름 변경 전 저장분을 이어받는다

function removeSampleExpense(trip) {
  if (trip?.title !== '도쿄 3박 4일 샘플' || trip.destination !== '도쿄' || !Array.isArray(trip.expenses)) return;
  const first = trip.expenses[0];
  const age = Date.parse(first?.at) - Date.parse(trip.createdAt);
  if (age >= 0 && age < 1000 && first.amount === 1200 && first.cur === 'local' &&
      first.cat === 'food' && first.pay === 'card' && first.day === 0 && first.memo === '점심 식사 예시') {
    trip.expenses.shift();
  }
}

export function loadStore() {
  try {
    for (const key of [KEY, ...LEGACY_KEYS]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const s = JSON.parse(raw);
      if (s && typeof s.trips === 'object' && s.trips) {
        Object.values(s.trips).forEach(removeSampleExpense);
        return { trips: s.trips, currentId: s.currentId ?? null };
      }
    }
  } catch {
    /* 저장소를 쓸 수 없는 환경: 빈 상태로 시작 */
  }
  return { trips: {}, currentId: null };
}

/** 성공하면 true. 시크릿 모드·용량 초과 등으로 실패하면 false. */
export function saveStore(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ trips: store.trips, currentId: store.currentId }));
    return true;
  } catch {
    return false;
  }
}
