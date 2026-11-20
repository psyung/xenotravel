// 동행자 정산(더치페이). 순수 함수만 둔다.
// trip.members = [{ id, name }]  (2명 이상일 때 정산)
// expense.payer = 낸 사람 id, expense.split = 나눠 낼 사람 id 목록 (없거나 비면 전원)
// 금액은 지출에 저장된 원화(krw)로 계산한다. 환율 미정(krw == null) 지출은 정산에서 빼고 개수만 알려 준다.
import { uid } from './model.js';
import { t } from './i18n.js';

export const MAX_MEMBERS = 12;

export function members(trip) {
  return Array.isArray(trip?.members) ? trip.members : [];
}

/** 동행자 추가. 빈 이름·중복 이름·인원 초과면 null */
export function addMember(trip, name) {
  const n = String(name ?? '').trim().slice(0, 20);
  const list = (trip.members ??= []);
  if (!n || list.length >= MAX_MEMBERS || list.some((m) => m.name === n)) return null;
  const m = { id: uid(), name: n };
  list.push(m);
  return m;
}

/** 동행자 빼기: 그 사람이 낸 지출의 결제자와 분담 대상에서도 뺀다 */
export function removeMember(trip, id) {
  const before = members(trip).length;
  trip.members = members(trip).filter((m) => m.id !== id);
  for (const e of trip.expenses ?? []) {
    if (e.payer === id) delete e.payer;
    if (Array.isArray(e.split)) {
      e.split = e.split.filter((x) => x !== id);
      if (!e.split.length) delete e.split;
    }
  }
  return trip.members.length !== before;
}

/** 지출의 결제자·분담 대상 정하기. split이 전원이면 저장하지 않는다 (나중에 동행이 늘어도 전원으로) */
export function setExpenseShare(trip, expense, { payer, split } = {}) {
  const ids = new Set(members(trip).map((m) => m.id));
  if (payer !== undefined) {
    if (ids.has(payer)) expense.payer = payer;
    else delete expense.payer;
  }
  if (split !== undefined) {
    const list = [...new Set((split ?? []).filter((x) => ids.has(x)))];
    if (!list.length || list.length === ids.size) delete expense.split;
    else expense.split = list;
  }
  return expense;
}

/** 이 지출을 나눠 낼 사람 id 목록 */
export function splitOf(trip, e) {
  const ids = members(trip).map((m) => m.id);
  const list = Array.isArray(e.split) ? e.split.filter((x) => ids.includes(x)) : [];
  return list.length ? list : ids;
}

/**
 * 정수 금액을 n명에게 나눈다: 몫을 똑같이 주고 남는 단위(나머지)는 앞사람부터 1씩 — 합계가 항상 원래 금액과 같다.
 * 예: 100원 3명 → [34, 33, 33], $10.00(1000센트) 3명 → [334, 333, 333]
 */
export function splitUnits(amount, n) {
  if (!(n > 0)) return [];
  const a = Math.round(amount);
  const q = Math.floor(a / n);
  let r = a - q * n;
  return Array.from({ length: n }, () => q + (r-- > 0 ? 1 : 0));
}

/**
 * 정산 결과. 동행이 2명 미만이면 null.
 * → { people: [{ id, name, paid, share, net }], transfers: [{ from, to, amount }], total, counted, noPayer, noRate }
 *   net > 0: 받을 돈, net < 0: 보낼 돈. transfers는 큰 금액끼리 먼저 맞춰 송금 횟수를 줄인다.
 * unitsOf(e): 지출을 정산 통화의 최소 단위 정수로 (원화는 1원, 달러는 1센트). 없으면 저장된 원화(krw).
 *   모든 계산을 정수 단위로 하고, 1/N 나머지는 결제자에게 먼저 붙여 (인당 부담 합 = 총액)이 반올림 오차 없이 맞는다.
 */
export function settlement(trip, { unitsOf = (e) => (e.krw == null ? null : Math.round(Number(e.krw) || 0)) } = {}) {
  const list = members(trip);
  if (list.length < 2) return null;
  const byId = new Map(list.map((m) => [m.id, { id: m.id, name: m.name, paid: 0, share: 0, net: 0 }]));
  let total = 0;
  let counted = 0;
  let noPayer = 0;
  let noRate = 0;
  for (const e of trip.expenses ?? []) {
    if (!byId.has(e.payer)) {
      noPayer++;
      continue;
    }
    const amount = unitsOf(e);
    if (amount == null) {
      noRate++;
      continue;
    }
    // 결제자가 분담에 들어 있으면 나머지 단위를 결제자에게 먼저 (송금액이 늘지 않게)
    const split = splitOf(trip, e);
    const order = split.includes(e.payer) ? [e.payer, ...split.filter((x) => x !== e.payer)] : split;
    const parts = splitUnits(amount, order.length);
    byId.get(e.payer).paid += amount;
    order.forEach((id, i) => (byId.get(id).share += parts[i]));
    total += amount;
    counted++;
  }
  const people = [...byId.values()].map((p) => ({ ...p, net: p.paid - p.share }));
  return { people, transfers: minTransfers(people), total, counted, noPayer, noRate };
}

/** 받을 사람·보낼 사람을 큰 금액끼리 맞춘다 (1원 미만 오차는 버린다) */
export function minTransfers(people) {
  const give = people.filter((p) => p.net < 0).map((p) => ({ id: p.id, name: p.name, left: -p.net }));
  const take = people.filter((p) => p.net > 0).map((p) => ({ id: p.id, name: p.name, left: p.net }));
  const out = [];
  while (give.length && take.length) {
    give.sort((a, b) => b.left - a.left);
    take.sort((a, b) => b.left - a.left);
    const g = give[0];
    const r = take[0];
    const amount = Math.min(g.left, r.left);
    if (amount >= 1) out.push({ from: g.name, fromId: g.id, to: r.name, toId: r.id, amount: Math.round(amount) });
    g.left -= amount;
    r.left -= amount;
    if (g.left < 1) give.shift();
    if (r.left < 1) take.shift();
  }
  return out;
}

/** 메신저에 붙일 정산 글 */
export function settlementText(trip, s, won) {
  const lines = [t('[정산] {title}', { title: trip.title }), t('함께 쓴 돈 {amount} · {n}건', { amount: won(s.total), n: s.counted })];
  lines.push('', t('인당 부담'));
  for (const p of s.people) lines.push(`· ${p.name}: ${won(p.share)} (${t('낸 돈 {amount}', { amount: won(p.paid) })})`);
  lines.push('', t('보낼 돈'));
  if (s.transfers.length) for (const x of s.transfers) lines.push(`· ${x.from} → ${x.to}: ${won(x.amount)}`);
  else lines.push(`· ${t('주고받을 돈이 없어요')}`);
  if (s.noRate || s.noPayer) {
    lines.push('');
    if (s.noPayer) lines.push(t('결제자를 정하지 않은 지출 {n}건은 빠졌어요', { n: s.noPayer }));
    if (s.noRate) lines.push(t('환율 미정 지출 {n}건은 빠졌어요', { n: s.noRate }));
  }
  return lines.join('\n');
}
