// 브라우저 저장소. 이 버전은 서버 없이 이 브라우저에만 저장한다.
// 같은 여행을 여러 탭에서 열어도 서로의 변경을 지우지 않게, 저장할 때마다 저장소의 최신 내용과 합친다 (sync.js).
//
//   const db = openStore(localStorage);   탭마다 하나
//   const store = db.load();               { trips, currentId, problem }
//   db.save(store)  → { ok: true, changed: 다른 탭 변경이 들어와 바뀐 여행 id들 }
//                   | { ok: false, conflicts }   같은 항목을 양쪽에서 다르게 바꿈 → 고른 뒤 { choices }로 다시 저장
//                   | { ok: false, error: 'quota' | 'denied' | 'unavailable' }  쓰지 못함 (메모리의 데이터는 그대로)
//
// 저장 문자열에는 rev(이번 저장 id)와 prev(어느 저장을 보고 썼는지)를 함께 쓴다.
// 두 탭이 같은 저장을 읽고 거의 동시에 쓰면 먼저 쓴 쪽이 덮어써진다(localStorage에는 잠금이 없다).
// chain에는 최근 저장 rev 200개(자기 자신부터 조상 순)를 남긴다. 다음 저장 때 상대 저장의 chain에 내 마지막 rev가 없고
// 내 저장의 조상(prev)은 있으면, 상대가 내 저장을 못 보고 썼다(사라졌다) — 그 뒤에 상대가 몇 번 더 저장했어도 알아챈다.
// 그때는 내 저장의 바로 앞 버전(공통 조상)을 기준으로 다시 합쳐 내 변경을 되살린다 (GPT 검수 1차 #2, 2차 #1·#4).
import { mergeStore, stable } from './sync.js';

export const KEY = 'xenotravel:v1';
const LEGACY_KEYS = ['tripnote:v1']; // 이름 변경 전 저장분을 이어받는다
export const CORRUPT_KEY = 'xenotravel:corrupt'; // 읽지 못한 저장분을 지우지 않고 옮겨 둔다

function removeSampleExpense(trip) {
  if (trip?.title !== '도쿄 3박 4일 샘플' || trip.destination !== '도쿄' || !Array.isArray(trip.expenses)) return;
  const first = trip.expenses[0];
  const age = Date.parse(first?.at) - Date.parse(trip.createdAt);
  if (age >= 0 && age < 1000 && first.amount === 1200 && first.cur === 'local' &&
      first.cat === 'food' && first.pay === 'card' && first.day === 0 && first.memo === '점심 식사 예시') {
    trip.expenses.shift();
  }
}

const validTrip = (t) => t && typeof t === 'object' && typeof t.id === 'string' && Array.isArray(t.days) && t.days.length > 0;

/** 저장 문자열 → { trips, currentId, dropped } (형식이 틀리면 null) */
function parse(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s.trips !== 'object' || !s.trips || Array.isArray(s.trips)) return null;
    // 하나가 망가져도 나머지 여행은 연다
    const trips = Object.fromEntries(Object.entries(s.trips).filter(([, t]) => validTrip(t)));
    return { trips, currentId: s.currentId ?? null, dropped: Object.keys(s.trips).length - Object.keys(trips).length, rev: typeof s.rev === 'string' ? s.rev : null, prev: typeof s.prev === 'string' ? s.prev : null, chain: Array.isArray(s.chain) ? s.chain.filter((x) => typeof x === 'string').slice(0, CHAIN) : typeof s.rev === 'string' ? [s.rev] : [] };
  } catch {
    return null;
  }
}

const CHAIN = 200; // 다른 탭이 이만큼 연달아 저장해도 덮어쓰기를 알아챈다 (GPT 4차 #1, 약 4KB)
const newRev = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const errorKind = (err) => (err?.name === 'QuotaExceededError' || err?.code === 22 || /quota/i.test(String(err?.message)) ? 'quota' : 'denied');

export function openStore(storage = globalThis.localStorage) {
  let base = {}; // 이 탭이 마지막으로 읽거나 쓴 여행들 (깊은 복사)
  let baseRaw = null; // 그때의 저장 문자열
  let baseRev = null; // 그 저장의 rev
  let baseChain = []; // 그 저장의 chain (최근 rev들)
  let lastWrite = null; // 내 마지막 저장 { rev, prev, ancestor: 그때 기준으로 삼은 여행들 } — 덮어써졌는지 알아보는 데 쓴다
  let corruptRaw = null; // 읽지 못한 원본 (백업 파일로 내려받을 수 있게)

  function keepCorrupt(raw) {
    corruptRaw = raw;
    try {
      if (storage.getItem(CORRUPT_KEY) !== raw) storage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* 공간이 없으면 메모리에만 (화면에서 파일로 내려받을 수 있다) */
    }
  }

  /**
   * → { trips, currentId, problem: null | 'corrupt' | 'partial' | 'unavailable' }
   *   corrupt: 저장분을 읽지 못했다 (원본은 xenotravel:corrupt에 옮겨 두고 빈 상태로 시작)
   *   partial: 일부 여행이 망가져 빼고 열었다 (원본은 같은 곳에)
   */
  function load() {
    let problem = null;
    try {
      for (const key of [KEY, ...LEGACY_KEYS]) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const s = parse(raw);
        if (!s) {
          keepCorrupt(raw);
          problem = 'corrupt';
          continue;
        }
        if (s.dropped) {
          keepCorrupt(raw);
          problem = 'partial';
        }
        Object.values(s.trips).forEach(removeSampleExpense);
        if (key === KEY) {
          baseRaw = raw;
          base = parse(raw).trips;
          baseRev = s.rev;
          baseChain = s.chain;
        }
        return { trips: s.trips, currentId: s.currentId, problem };
      }
    } catch {
      problem = 'unavailable';
    }
    return { trips: {}, currentId: null, problem };
  }

  function apply(store, trips, changed) {
    for (const id of changed) {
      if (trips[id]) store.trips[id] = trips[id];
      else delete store.trips[id];
    }
  }

  /** 저장. 그사이 다른 탭이 저장했으면 합친 결과를 쓰고 store.trips도 그 결과로 바꾼다. */
  function save(store, { choices = {} } = {}) {
    let raw;
    try {
      raw = storage.getItem(KEY);
    } catch {
      return { ok: false, error: 'unavailable' };
    }
    let trips = store.trips;
    let prevTrips = base; // 이번 저장이 기준으로 삼는 버전의 여행들 (= prev가 가리키는 내용)
    let nextRev = baseRev; // 이번 저장의 prev (상대 저장을 합쳤으면 그 rev)
    let nextChain = baseChain;
    const changed = [];
    if (raw !== baseRaw) {
      // 다른 탭이 저장했다
      let remote = raw ? parse(raw) : { trips: {}, currentId: null };
      if (!remote) {
        keepCorrupt(raw);
        remote = { trips: {}, currentId: null };
      }
      // 상대가 내 마지막 저장을 못 보고 같은 조상에서 썼다 → 내 저장이 덮어써졌다. 공통 조상 기준으로 다시 합친다
      const chain = remote.chain ?? [];
      // 상대 저장 이력(chain)에 내 마지막 저장이 없으면 상대는 그것을 보지 못하고 썼다 → 덮어써졌다.
      // 공통 조상이 이력에서 밀려나 판별이 애매해도 같은 쪽(내 변경 보존)으로 판단한다 (GPT 5차 #1)
      const lost = lastWrite && remote.rev != null && baseRev === lastWrite.rev && !chain.includes(lastWrite.rev);
      const merged = mergeStore(lost ? lastWrite.ancestor : base, store.trips, remote.trips, choices);
      if (merged.conflicts.length) return { ok: false, conflicts: merged.conflicts };
      trips = merged.trips;
      for (const id of new Set([...Object.keys(store.trips), ...Object.keys(trips)])) {
        if (store.trips[id] !== trips[id]) changed.push(id);
      }
      // 합친 결과가 저장소와 같으면 다시 쓰지 않는다 (탭끼리 서로 깨우며 계속 쓰는 것을 막는다)
      if (raw && stable(trips) === stable(remote.trips)) {
        apply(store, trips, changed);
        baseRaw = raw;
        base = parse(raw).trips;
        baseRev = remote.rev;
        baseChain = remote.chain ?? [];
        return { ok: true, changed };
      }
      // 상대 저장의 버전 정보는 실제로 쓴 뒤에만 이 탭의 기준으로 삼는다 — 쓰기에 실패하면 다음 시도가 덮어쓰기를 다시 알아챈다 (GPT 3차 #1)
      nextRev = remote.rev;
      nextChain = remote.chain ?? [];
      prevTrips = remote.trips;
    }
    // 내용(여행·현재 여행)이 저장소와 같으면 쓰지 않는다 — rev만 바뀐 저장으로 다른 탭을 깨우지 않게
    const content = JSON.stringify({ trips, currentId: store.currentId });
    if (raw && raw === baseRaw) {
      try {
        const cur = JSON.parse(raw);
        if (JSON.stringify({ trips: cur.trips, currentId: cur.currentId ?? null }) === content) {
          apply(store, trips, changed);
          return { ok: true, changed };
        }
      } catch {}
    }
    const rev = newRev();
    const chainOut = [rev, ...nextChain.filter((x) => x !== rev)].slice(0, CHAIN);
    const out = JSON.stringify({ trips, currentId: store.currentId, rev, prev: nextRev, chain: chainOut });
    try {
      storage.setItem(KEY, out);
    } catch (err) {
      return { ok: false, error: errorKind(err) };
    }
    apply(store, trips, changed);
    lastWrite = { rev, prev: nextRev, ancestor: JSON.parse(JSON.stringify(prevTrips)) }; // 조상 = prev 버전 그대로 (2차 #4)
    baseRaw = out;
    base = JSON.parse(out).trips;
    baseRev = rev;
    baseChain = chainOut;
    return { ok: true, changed };
  }

  /** 저장소가 마지막으로 읽은 뒤 바뀌었는지 */
  function stale() {
    try {
      return storage.getItem(KEY) !== baseRaw;
    } catch {
      return false;
    }
  }

  return { load, save, stale, corruptBackup: () => corruptRaw };
}

/** 예전 방식 호환: 한 번 읽기 (테스트·간단한 도구용) */
export const loadStore = (storage = globalThis.localStorage) => openStore(storage).load();
