// 체크리스트: 할 일 · 짐 · 쇼핑. 순수 함수만 둔다.
// trip.checks = [{ id, group: 'todo'|'pack'|'shop', text, done }]
import { uid } from './model.js';

export const CHECK_GROUPS = {
  todo: { label: '출발 전 할 일', icon: '🗓️', placeholder: '할 일 추가' },
  pack: { label: '짐 싸기', icon: '🧳', placeholder: '챙길 것 추가' },
  shop: { label: '쇼핑 리스트', icon: '🛍️', placeholder: '사고 싶은 것 추가' },
};

const DEFAULTS = {
  todo: ['여권 유효기간 확인 (6개월 이상)', '여행자 보험', 'eSIM / 포켓와이파이', '환전 · 트래블카드 준비', '숙소 주소 현지어로 캡처', '항공 온라인 체크인'],
  pack: ['여권', '충전기 · 보조배터리', '멀티 어댑터', '상비약', '세면도구'],
  shop: [],
};

/** 처음 열 때 기본 항목을 채운다. 이미 있으면 그대로. */
export function ensureChecks(trip) {
  if (!Array.isArray(trip.checks)) {
    trip.checks = Object.entries(DEFAULTS).flatMap(([group, list]) => list.map((text) => ({ id: uid(), group, text, done: false })));
  }
  return trip.checks;
}

export function addCheck(trip, group, text) {
  const t = String(text ?? '').trim();
  if (!t || !CHECK_GROUPS[group]) return null;
  const c = { id: uid(), group, text: t, done: false };
  ensureChecks(trip).push(c);
  return c;
}

export function toggleCheck(trip, id) {
  const c = ensureChecks(trip).find((x) => x.id === id);
  if (c) c.done = !c.done;
  return c ?? null;
}

export function removeCheck(trip, id) {
  const before = ensureChecks(trip).length;
  trip.checks = trip.checks.filter((x) => x.id !== id);
  return trip.checks.length !== before;
}

/** 그룹별 {done, total} */
export function progress(trip, group) {
  const list = ensureChecks(trip).filter((c) => c.group === group);
  return { done: list.filter((c) => c.done).length, total: list.length };
}

/** 탭 배지에 보일 숫자: 남은 "출발 전 할 일" */
export function pendingTodos(trip) {
  return (trip.checks ?? []).filter((c) => c.group === 'todo' && !c.done).length;
}
