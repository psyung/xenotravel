// 일차 간 이동·복제와 일자 순서 바꾸기 (Phase 4). 순수 함수만 둔다 — 화면(미리보기·실행 취소)은 app.js.
// 일차의 날짜·숙소·항공편은 날짜에 붙어 있다. 옮기는 것은 장소(items)뿐이고, 미리보기에서 대상 날의 항공편·숙소와
// 시간 충돌을 먼저 계산해 보여 준다. 실행한 작업마다 되돌리기 함수를 만들어 실행 취소 스택에 따로 쌓는다.
import { uid, findItem, flightsForDay, flightTimeBounds, dayStays, timeConflictKinds, toMinutes } from './model.js';

const hhmm = (v) => (v ? String(v).slice(11, 16) : '');

/** 그날 일정이 들어갈 수 있는 시간 범위: after = 도착편 도착 시각, before = 출발(귀국)편 출발 시각 */
export function dayBounds(trip, dayIndex) {
  const flights = flightsForDay(trip, dayIndex); // 기간 밖 출국·귀국편(P0-2)은 시간 범위에 영향 없음
  return { ...flightTimeBounds(flights), flights };
}

/** 그날 시간 충돌: Map<장소 id, 'order'|'flight'> (app.js의 배지와 같은 규칙) */
export function dayConflicts(trip, dayIndex, items = trip.days[dayIndex]?.items) {
  const { after, before } = dayBounds(trip, dayIndex);
  return timeConflictKinds(items, { after, before });
}

/** 시간이 있는 장소는 시간 순서 자리에, 없으면 맨 끝에 넣을 위치 */
export function insertIndex(items, item) {
  const m = toMinutes(item.time);
  if (m == null) return items.length;
  const i = items.findIndex((x) => {
    const xm = toMinutes(x.time);
    return xm != null && xm > m;
  });
  return i < 0 ? items.length : i;
}

/** 복제본: 새 id, 다녀옴 표시 없음 (결제 기록은 원본 id에 묶여 있어 복사하지 않는다) */
function cloneItem(item) {
  const { visited, ...rest } = structuredClone(item);
  return { ...rest, id: uid() };
}

/**
 * 다른 일차로 옮기기/복제하기 전 미리보기. trip은 바꾸지 않는다.
 * → { ok, mode, item, from: 원래 일차(보관함이면 -1), to, index: 들어갈 자리, sameDay,
 *     flights: [{ kind, role, time, label }], stays: { start, end },
 *     conflicts: [{ id, name, kind, isTarget }] — 넣은 뒤 대상 날에서 생기는 충돌 전부,
 *     added: 지금은 없는데 새로 생기는 충돌 수, targetConflict: 옮긴 장소 자체의 충돌 종류('' = 없음) }
 */
export function placementPreview(trip, itemId, toDay, mode = 'move') {
  const found = findItem(trip, itemId);
  const day = trip.days[toDay];
  if (!found || !day) return { ok: false };
  const from = trip.days.findIndex((d) => d.id === found.listId);
  const sameDay = from === toDay;
  const item = mode === 'copy' ? { ...found.item, id: `${found.item.id}__copy` } : found.item;
  const base = day.items.filter((x) => x.id !== found.item.id || mode === 'copy');
  const index = insertIndex(base, item);
  const next = [...base.slice(0, index), item, ...base.slice(index)];
  const before = dayConflicts(trip, toDay, day.items);
  const after = dayConflicts(trip, toDay, next);
  const names = new Map(next.map((x) => [x.id, x.name]));
  const conflicts = [...after].map(([id, kind]) => ({ id, name: names.get(id) ?? '', kind, isTarget: id === item.id }));
  const { flights } = dayBounds(trip, toDay);
  return {
    ok: true,
    mode,
    item: found.item,
    from,
    to: toDay,
    index,
    sameDay,
    flights: flights.map(({ flight, role }) => ({
      kind: flight.kind,
      role,
      time: hhmm(role === 'arrive' ? flight.arriveAt : flight.departAt),
      label: [flight.flightNo, `${flight.from || '?'}→${flight.to || '?'}`].filter(Boolean).join(' '),
    })),
    stays: dayStays(trip, toDay),
    conflicts,
    added: [...after].filter(([id, kind]) => before.get(id) !== kind).length, // 새 충돌 + 종류가 바뀐 충돌(순서 → 항공편) (GPT 2차 #10)
    targetConflict: after.get(item.id) ?? '',
  };
}

/**
 * 다른 일차로 옮기기. 같은 날이면 아무것도 하지 않는다.
 * → { item, index, undo(trip) } | null   undo는 원래 목록·자리로 되돌린다 (그사이 지워졌으면 아무것도 안 함)
 */
export function moveToDay(trip, itemId, toDay) {
  const found = findItem(trip, itemId);
  const day = trip.days[toDay];
  if (!found || !day || found.listId === day.id) return null;
  const [item] = found.list.splice(found.index, 1);
  const index = insertIndex(day.items, item);
  day.items.splice(index, 0, item);
  const back = { listId: found.listId, index: found.index };
  return {
    item,
    index,
    undo(tr) {
      const now = findItem(tr, itemId);
      const list = back.listId === 'inbox' ? tr.inbox : tr.days.find((d) => d.id === back.listId)?.items;
      if (!now || !list) return false;
      const [it] = now.list.splice(now.index, 1);
      list.splice(Math.min(back.index, list.length), 0, it);
      return true;
    },
  };
}

/** 다른 일차(같은 날도 가능)에 복제. → { item: 복제본, index, undo(trip) } | null */
export function copyToDay(trip, itemId, toDay) {
  const found = findItem(trip, itemId);
  const day = trip.days[toDay];
  if (!found || !day) return null;
  const copy = cloneItem(found.item);
  const index = insertIndex(day.items, copy);
  day.items.splice(index, 0, copy);
  return {
    item: copy,
    index,
    undo(tr) {
      const now = findItem(tr, copy.id);
      if (!now) return false;
      now.list.splice(now.index, 1);
      return true;
    },
  };
}

/** order가 0..n-1을 한 번씩 담은 순열인지 */
export const isPermutation = (order, n) => Array.isArray(order) && order.length === n && new Set(order).size === n && order.every((x) => Number.isInteger(x) && x >= 0 && x < n);

/**
 * 일자 순서 바꾸기 미리보기. order[i] = 새 i번째 날에 들어갈 지금 일차 번호. trip은 바꾸지 않는다.
 * → { ok, changed, days: [{ to, from, count, firstName, conflicts: [{name, kind}], flights: n, stays }], added, total }
 *   added: 지금은 없는데 새로 생기는 충돌 수 (항공편 시간·앞뒤 순서)
 */
export function dayOrderPreview(trip, order) {
  const n = trip.days.length;
  if (!isPermutation(order, n)) return { ok: false };
  const nowKeys = new Set(trip.days.flatMap((_, i) => [...dayConflicts(trip, i)].map(([id, kind]) => `${i}:${id}:${kind}`)));
  let added = 0;
  let total = 0;
  const days = order.map((from, to) => {
    const items = trip.days[from].items;
    const c = dayConflicts(trip, to, items);
    total += c.size;
    for (const [id, kind] of c) if (!nowKeys.has(`${to}:${id}:${kind}`)) added++;
    const names = new Map(items.map((x) => [x.id, x.name]));
    return {
      to,
      from,
      count: items.length,
      firstName: items[0]?.name ?? '',
      conflicts: [...c].map(([id, kind]) => ({ id, name: names.get(id) ?? '', kind })),
      flights: dayBounds(trip, to).flights.length,
      stays: dayStays(trip, to),
    };
  });
  return { ok: true, changed: order.some((x, i) => x !== i), days, added, total };
}

/**
 * 일자 순서 바꾸기: 날짜·숙소·항공편은 그 자리에 두고 각 날의 장소 묶음을 order대로 옮긴다.
 * → { undo(trip) } | null   undo는 역순열을 적용한다 (그사이 일수가 바뀌었으면 아무것도 안 함)
 */
export function reorderDays(trip, order) {
  const n = trip.days.length;
  if (!isPermutation(order, n) || order.every((x, i) => x === i)) return null;
  const lists = trip.days.map((d) => d.items);
  const original = lists.map((items) => items.map((x) => x.id)); // 바꾸기 전 날마다의 장소 id
  trip.days.forEach((d, i) => (d.items = lists[order[i]]));
  const dayIds = trip.days.map((d) => d.id);
  const placed = new Map(trip.days.flatMap((d) => d.items.map((x) => [x.id, d.id]))); // 이 작업이 둔 날 (일차 id)
  const placedLists = trip.days.map((d) => d.items.map((x) => x.id)); // 이 작업 직후 날마다의 순서
  const origDay = new Map(original.flatMap((ids, i) => ids.map((id) => [id, dayIds[i]]))); // 원래 날 (일차 id)
  return {
    /**
     * 이 작업이 옮긴 장소만 원래 날·순서로 되돌린다. 그 뒤에 새로 넣은 장소는 지금 날에 그대로 두고,
     * 보관함으로 뺀 장소는 다시 끌어오지 않는다 (GPT 2차 #9).
     */
    undo(tr) {
      const byId = new Map(tr.days.flatMap((d) => d.items.map((x) => [x.id, x])));
      const dayOf = new Map(tr.days.flatMap((d) => d.items.map((x) => [x.id, d.id])));
      const alive = new Set(tr.days.map((d) => d.id));
      // 이 작업이 둔 날(일차 id)에 아직 있고 원래 날이 지금도 있는 장소만 되돌린다.
      // 그 뒤 다른 날로 옮겼거나, 원래 날이 지워졌다 새로 생겼으면(id가 다름) 지금 자리에 둔다 (GPT 3차 #8, 5차 #5)
      const back = new Set(original.flat().filter((id) => dayOf.get(id) === placed.get(id) && placed.get(id) !== origDay.get(id) && alive.has(origDay.get(id))));
      const stay = tr.days.map((d) => d.items.filter((x) => !back.has(x.id)));
      const nowAll = tr.days.flatMap((x) => x.items.map((it) => it.id)); // 바꾸기 전에 지금 순서를 고정해 둔다
      tr.days.forEach((d, i) => {
        const oi = dayIds.indexOf(d.id); // 이 일차의 원래 자리 (일차 id로 찾는다)
        const returning = oi < 0 ? [] : original[oi].filter((id) => back.has(id));
        if (!returning.length) return void (d.items = stay[i]); // 이 작업으로 다른 날에서 돌아올 장소가 없는 날은 그대로 (GPT 4차 #5)
        // 돌아오는 장소끼리의 순서: 그 뒤 같은 날 안에서 바꿨으면(옮겨 간 날에서의 상대 순서가 바뀜) 바뀐 순서를 지킨다
        const nowOrder = nowAll.filter((id) => returning.includes(id));
        const placedOrder = placedLists.flat().filter((id) => returning.includes(id));
        const keepNow = nowOrder.join() !== placedOrder.join();
        d.items = [...(keepNow ? nowOrder : returning).map((id) => byId.get(id)), ...stay[i]];
      });
      return true;
    },
  };
}

/** 순서 배열에서 한 칸 옮기기 (접근성 ↑↓ 버튼) */
export function moveInOrder(order, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
