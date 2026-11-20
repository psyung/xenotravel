// 여러 탭이 같은 저장소(localStorage)를 쓸 때 서로의 변경을 지우지 않도록 합친다 (3-way merge).
//   base   = 이 탭이 마지막으로 읽거나 쓴 저장 내용
//   local  = 이 탭의 지금 데이터
//   remote = 지금 저장소에 있는 데이터 (다른 탭이 그사이 저장했을 수 있다)
// 한쪽만 바꾼 것은 그대로 합치고, 같은 값을 양쪽이 다르게 바꾸거나 한쪽이 지운 항목을 다른 쪽이 고쳤으면 충돌로 돌려준다.
// 충돌은 choices({ 경로: 'local' | 'remote' })를 주고 다시 합치면 풀린다. 순수 함수만 둔다.

/** 키 순서와 상관없이 같은 값인지 비교하기 위한 문자열 */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return v === undefined ? 'undefined' : JSON.stringify(v);
}
const same = (a, b) => stable(a) === stable(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (path) => path.join('/');

/** 장소·지출처럼 id가 있는 목록 */
const ENTITY_LISTS = new Set(['expenses', 'checks', 'stays', 'flights']);
// 장소 배치(days/inbox)와 날짜는 따로 합친다. updatedAt은 늦은 쪽.
const SPECIAL = new Set(['days', 'inbox', 'startDate', 'endDate', 'updatedAt']);

function conflict(ctx, path, local, remote, base) {
  const choice = ctx.choices[keyOf(path)];
  if (choice === 'remote') return { value: remote, resolved: true };
  if (choice === 'local') return { value: local, resolved: true };
  ctx.conflicts.push({ path, local, remote, base });
  return { value: local, resolved: false };
}

/** 값 하나 (객체면 필드별로) */
export function mergeValue(base, local, remote, path, ctx) {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (isObj(local) && isObj(remote) && (base === undefined || isObj(base))) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const v = mergeValue(base?.[k], local[k], remote[k], [...path, k], ctx);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return conflict(ctx, path, local, remote, base).value;
}

/** id가 있는 항목 목록. 순서는 이 탭 기준, 다른 탭에서 새로 생긴 항목은 그 탭에서 놓인 자리 근처에 넣는다. */
export function mergeEntities(base = [], local = [], remote = [], path, ctx) {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const out = [];
  for (const x of local) {
    const p = [...path, `#${x.id}`];
    if (B.has(x.id) && !R.has(x.id)) {
      // 다른 탭에서 지움
      if (same(x, B.get(x.id))) continue;
      const c = conflict(ctx, p, x, null, B.get(x.id));
      if (c.value) out.push(c.value);
    } else if (R.has(x.id)) {
      const r = R.get(x.id);
      if (path.at(-1) === 'expenses' && !B.has(x.id) && x.checkId && x.checkId === r.checkId) {
        // 두 탭에서 동시에 체크해 만든 같은 지출은 최초 기록 시각을 쓴다.
        const at = x.at < r.at ? x.at : r.at;
        out.push(mergeValue(undefined, { ...x, at }, { ...r, at }, p, ctx));
      } else out.push(mergeValue(B.get(x.id), x, r, p, ctx));
    } else out.push(x);
  }
  remote.forEach((r, i) => {
    if (L.has(r.id)) return;
    if (B.has(r.id)) {
      // 이 탭에서 지움
      if (same(r, B.get(r.id))) return;
      const c = conflict(ctx, [...path, `#${r.id}`], null, r, B.get(r.id));
      if (!c.value) return;
    }
    // 다른 탭이 새로 만든 항목: remote에서 바로 앞에 있던 항목 뒤에
    const prev = remote.slice(0, i).reverse().find((x) => out.some((o) => o.id === x.id));
    const at = prev ? out.findIndex((o) => o.id === prev.id) + 1 : out.length;
    out.splice(at, 0, r);
  });
  return out;
}

const allItems = (t) => (t ? [...(t.days ?? []).flatMap((d) => d.items ?? []), ...(t.inbox ?? [])] : []);
const layout = (t) => {
  const m = new Map();
  if (!t) return m;
  for (const d of t.days ?? []) m.set(d.id, (d.items ?? []).map((x) => x.id));
  m.set('inbox', (t.inbox ?? []).map((x) => x.id));
  return m;
};
const dates = (t) => (t ? { startDate: t.startDate, endDate: t.endDate, days: (t.days ?? []).map(({ id, date }) => ({ id, date })) } : null);
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 목록 한 칸의 순서 */
function mergeOrder(b = [], l = [], r = []) {
  if (sameIds(l, b)) return r;
  if (sameIds(r, b)) return l;
  const removed = new Set(b.filter((id) => !r.includes(id)));
  const out = l.filter((id) => !removed.has(id));
  r.forEach((id, i) => {
    if (out.includes(id) || b.includes(id)) return;
    const prev = r.slice(0, i).reverse().find((x) => out.includes(x));
    out.splice(prev ? out.indexOf(prev) + 1 : out.length, 0, id);
  });
  return out;
}

/** 일정(날짜·장소 배치·장소 내용) */
function mergePlaces(base, local, remote, out, ctx, path) {
  const DL = dates(local);
  const DR = dates(remote);
  const DB = dates(base);
  let D;
  if (same(DL, DR) || same(DR, DB)) D = DL;
  else if (same(DL, DB)) D = DR;
  else D = conflict(ctx, [...path, '__dates'], DL, DR, DB).value;
  out.startDate = D.startDate;
  out.endDate = D.endDate;

  const items = mergeEntities(allItems(base), allItems(local), allItems(remote), [...path, 'items'], ctx);
  const byId = new Map(items.map((x) => [x.id, x]));
  const LB = layout(base);
  const LL = layout(local);
  const LR = layout(remote);
  const listIds = [...D.days.map((d) => d.id), 'inbox'];
  const where = (lay, id) => [...lay].find(([, ids]) => ids.includes(id))?.[0];
  const placed = new Map(); // item id → list id
  const lists = new Map();
  for (const listId of listIds) {
    const order = mergeOrder(LB.get(listId), LL.get(listId) ?? [], LR.get(listId) ?? []);
    const keep = [];
    for (const id of order) {
      if (!byId.has(id)) continue;
      if (placed.has(id)) {
        // 양쪽 탭이 같은 장소를 다른 날로 옮김: 이 탭에서 옮겼으면 이 탭 자리, 아니면 다른 탭 자리
        const movedHere = where(LL, id) !== where(LB, id);
        const prefer = movedHere ? where(LL, id) : where(LR, id);
        if (prefer !== listId) continue;
        const prevList = lists.get(placed.get(id));
        prevList.splice(prevList.indexOf(id), 1);
      }
      placed.set(id, listId);
      keep.push(id);
    }
    lists.set(listId, keep);
  }
  // 어디에도 안 놓인 장소(그 날이 사라졌거나 양쪽 순서에서 빠짐)는 원래 있던 칸, 없으면 보관함으로
  for (const it of items) {
    if (placed.has(it.id)) continue;
    const home = [where(LL, it.id), where(LR, it.id)].find((id) => id && lists.has(id)) ?? 'inbox';
    lists.get(home).push(it.id);
    placed.set(it.id, home);
  }
  const daySrc = new Map([...(base?.days ?? []), ...(remote?.days ?? []), ...(local?.days ?? [])].map((d) => [d.id, d]));
  out.days = D.days.map(({ id, date }) => {
    const { items: _, ...rest } = daySrc.get(id) ?? { id };
    return { ...rest, id, date, items: lists.get(id).map((x) => byId.get(x)) };
  });
  out.inbox = lists.get('inbox').map((x) => byId.get(x));
}

/** 여행 하나 */
export function mergeTrip(base, local, remote, ctx = { choices: {}, conflicts: [] }, path = []) {
  const out = {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    if (SPECIAL.has(k)) continue;
    if (!(k in local) && !(k in remote)) continue;
    const v = ENTITY_LISTS.has(k)
      ? mergeEntities(base?.[k] ?? [], local[k] ?? [], remote[k] ?? [], [...path, k], ctx)
      : mergeValue(base?.[k], local[k], remote[k], [...path, k], ctx);
    if (v !== undefined) out[k] = v;
  }
  mergePlaces(base, local, remote, out, ctx, path);
  out.updatedAt = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().at(-1) ?? new Date().toISOString();
  return out;
}

/**
 * 저장소 전체 ({ [tripId]: trip }) → { trips, conflicts }
 * conflicts: [{ tripId, path, key, local, remote, base }]  (key를 choices에 넣어 다시 부르면 풀린다)
 */
export function mergeStore(base = {}, local = {}, remote = {}, choices = {}) {
  const trips = {};
  const conflicts = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const [B, L, R] = [base[id], local[id], remote[id]];
    const ctx = { choices, conflicts: [] };
    let v;
    if (L && R) {
      if (same(L, R) || same(R, B)) v = L;
      else if (same(L, B)) v = R;
      else {
        v = mergeTrip(B, L, R, ctx, [id]);
        if (same(v, R)) v = R;
        else if (same(v, L)) v = L;
      }
    } else if (L) {
      v = !B ? L : same(L, B) ? undefined : conflict(ctx, [id, '__trip'], L, null, B).value; // 다른 탭에서 여행 삭제
    } else if (R) {
      v = !B ? R : same(R, B) ? undefined : conflict(ctx, [id, '__trip'], null, R, B).value; // 이 탭에서 여행 삭제
    }
    if (v) trips[id] = v;
    for (const c of ctx.conflicts) conflicts.push({ ...c, tripId: id, key: keyOf(c.path) });
  }
  return { trips, conflicts };
}
