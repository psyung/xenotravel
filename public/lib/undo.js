// 실행 취소 스택: 5초 안에 연달아 한 작업(삭제·이동·복제 등)을 하나씩 되돌린다. 순수 로직만 둔다 (화면은 app.js).
// 새 작업이 앞선 작업의 복구 데이터를 덮어쓰지 않는다 — 각 작업이 자기 되돌리기 함수를 따로 갖고 쌓인다.
// 되돌리기를 누를 때마다 남은 작업의 시간이 다시 ttl만큼 늘어난다 (연속 되돌리기).

export const UNDO_TTL = 5000;

export function createUndoStack({ ttl = UNDO_TTL, now = () => Date.now(), max = 20 } = {}) {
  let list = [];
  const prune = () => {
    const t = now();
    list = list.filter((x) => x.until > t);
  };
  return {
    /** entry = { text, run, scope? } → 쌓인 개수 */
    push(entry) {
      prune();
      list.push({ ...entry, until: now() + ttl });
      if (list.length > max) list.shift();
      return list.length;
    },
    /** 가장 최근 작업을 꺼내 되돌린다. 남은 작업은 시간을 새로 준다. → 꺼낸 작업 | null */
    undo() {
      prune();
      const top = list.pop() ?? null;
      if (top) {
        const until = now() + ttl;
        for (const x of list) x.until = until;
        top.run();
      }
      return top;
    },
    peek() {
      prune();
      return list.at(-1) ?? null;
    },
    size() {
      prune();
      return list.length;
    },
    /** 남은 시간(ms) — 토스트를 그만큼 보여 준다 */
    left() {
      prune();
      return list.length ? Math.max(0, list.at(-1).until - now()) : 0;
    },
    /** 범위(여행 id 등)가 다른 작업은 버린다 (다른 여행으로 바꿨을 때) */
    keepScope(scope) {
      list = list.filter((x) => x.scope == null || x.scope === scope);
    },
    clear() {
      list = [];
    },
  };
}
