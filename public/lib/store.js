// 브라우저 저장소. 이 버전은 서버 없이 이 브라우저에만 저장한다.
const KEY = 'xenotravel:v1';
const LEGACY_KEYS = ['tripnote:v1']; // 이름 변경 전 저장분을 이어받는다

export function loadStore() {
  try {
    for (const key of [KEY, ...LEGACY_KEYS]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const s = JSON.parse(raw);
      if (s && typeof s.trips === 'object' && s.trips) return { trips: s.trips, currentId: s.currentId ?? null };
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
