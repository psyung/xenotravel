// 가계부: 여행 중 쓴 돈 기록. 순수 함수만 둔다.
// trip.budget = { total, currency, krwPerUnit, rateSource: 'auto'|'manual', rateAt }
//   total: 1인 예산(원), currency: 현지 통화 코드, krwPerUnit: 현지 통화 1단위가 몇 원인지
// trip.expenses = [{ id, amount, cur: 'local'|'KRW', krw, cat, pay, day, memo, at }]
//   day: -1 = 출발 전, 0.. = Day n,  krw: 기록한 순간의 환율로 바꾼 원화 (나중에 환율이 바뀌어도 그대로)
import { uid } from './model.js';

export const CURRENCIES = {
  JPY: { name: '엔', symbol: '¥', unit: 100 },
  USD: { name: '달러', symbol: '$', unit: 1 },
  EUR: { name: '유로', symbol: '€', unit: 1 },
  GBP: { name: '파운드', symbol: '£', unit: 1 },
  TWD: { name: '대만 달러', symbol: 'NT$', unit: 1 },
  HKD: { name: '홍콩 달러', symbol: 'HK$', unit: 1 },
  CNY: { name: '위안', symbol: '¥', unit: 1 },
  THB: { name: '바트', symbol: '฿', unit: 1 },
  VND: { name: '동', symbol: '₫', unit: 100 },
  SGD: { name: '싱가포르 달러', symbol: 'S$', unit: 1 },
  PHP: { name: '페소', symbol: '₱', unit: 1 },
  AUD: { name: '호주 달러', symbol: 'A$', unit: 1 },
  CHF: { name: '프랑', symbol: 'CHF ', unit: 1 },
  KRW: { name: '원', symbol: '₩', unit: 1 },
};

export const EXPENSE_CATS = {
  food: { label: '식비', icon: '🍜' },
  transport: { label: '교통', icon: '🚇' },
  shop: { label: '쇼핑', icon: '🛍️' },
  ticket: { label: '입장권', icon: '🎟️' },
  stay: { label: '숙소', icon: '🏨' },
  flight: { label: '항공', icon: '✈️' },
  etc: { label: '기타', icon: '📦' },
};

export const PAYMENTS = {
  cash: { label: '현금', icon: '💴' },
  card: { label: '카드', icon: '💳' },
  transit: { label: '교통카드', icon: '🚃' },
  travel: { label: '트래블카드', icon: '🌐' },
};

// 여행지 이름 → 통화. 모르면 USD.
const PLACE_CURRENCY = [
  [/일본|도쿄|오사카|교토|후쿠오카|삿포로|오키나와|나고야|고베|나라|요코하마|히로시마|japan|tokyo|osaka|kyoto|fukuoka|sapporo|okinawa/i, 'JPY'],
  [/대만|타이베이|타이중|가오슝|taiwan|taipei/i, 'TWD'],
  [/홍콩|hong ?kong/i, 'HKD'],
  [/중국|상하이|베이징|칭다오|청두|광저우|선전|china|shanghai|beijing/i, 'CNY'],
  [/베트남|다낭|하노이|호치민|나트랑|푸꾸옥|vietnam|danang|hanoi/i, 'VND'],
  [/태국|방콕|치앙마이|푸켓|파타야|thailand|bangkok|phuket/i, 'THB'],
  [/싱가포르|singapore/i, 'SGD'],
  [/필리핀|세부|보라카이|마닐라|philippines|cebu|manila/i, 'PHP'],
  [/호주|시드니|멜버른|australia|sydney|melbourne/i, 'AUD'],
  [/스위스|취리히|인터라켄|switzerland|zurich/i, 'CHF'],
  [/영국|런던|에든버러|uk|london/i, 'GBP'],
  [/프랑스|파리|이탈리아|로마|밀라노|피렌체|베네치아|스페인|바르셀로나|마드리드|독일|베를린|뮌헨|포르투갈|리스본|포르투|네덜란드|암스테르담|오스트리아|비엔나|빈|그리스|아테네|체코|프라하|europe|paris|rome|barcelona|lisbon|berlin|prague|vienna/i, 'EUR'],
  [/미국|뉴욕|하와이|괌|사이판|LA|로스앤젤레스|샌프란시스코|라스베이거스|usa|new york|hawaii|guam/i, 'USD'],
];

export function guessCurrency(destination) {
  const d = String(destination ?? '');
  return PLACE_CURRENCY.find(([re]) => re.test(d))?.[1] ?? 'USD';
}

export function ensureBudget(trip) {
  trip.budget ??= {};
  trip.budget.total = Number(trip.budget.total) || 0;
  if (!CURRENCIES[trip.budget.currency]) trip.budget.currency = guessCurrency(trip.destination);
  trip.budget.krwPerUnit = Number(trip.budget.krwPerUnit) || 0;
  trip.expenses ??= [];
  return trip.budget;
}

/** 금액 → 원화. 환율이 없으면 null. */
export function toKrw(amount, cur, budget) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return null;
  if (cur === 'KRW' || budget.currency === 'KRW') return Math.round(a);
  return budget.krwPerUnit > 0 ? Math.round(a * budget.krwPerUnit) : null;
}

/** 저장 전 검사. 문제가 있으면 사용자에게 보여줄 문구, 없으면 null. */
export function expenseProblem({ amount, cur }, budget) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return '금액을 입력해 주세요';
  if (cur !== 'KRW' && budget.currency !== 'KRW' && !(budget.krwPerUnit > 0)) return '환율을 먼저 정해 주세요';
  return null;
}

export function addExpense(trip, { amount, cur = 'local', cat = 'etc', pay = 'card', day = -1, memo = '' }) {
  const budget = ensureBudget(trip);
  const e = {
    id: uid(),
    amount: Number(amount),
    cur: cur === 'KRW' ? 'KRW' : 'local',
    krw: toKrw(amount, cur, budget) ?? 0,
    cat: EXPENSE_CATS[cat] ? cat : 'etc',
    pay: PAYMENTS[pay] ? pay : 'card',
    day: Number.isInteger(day) ? day : -1,
    memo: String(memo ?? '').trim(),
    at: new Date().toISOString(),
  };
  trip.expenses.push(e);
  return e;
}

export function removeExpense(trip, id) {
  const before = (trip.expenses ?? []).length;
  trip.expenses = (trip.expenses ?? []).filter((e) => e.id !== id);
  return trip.expenses.length !== before;
}

/** 합계와 분류별·날짜별·결제수단별 금액(원). */
export function summarize(trip) {
  const budget = ensureBudget(trip);
  const spent = trip.expenses.reduce((s, e) => s + (e.krw || 0), 0);
  const group = (key) => {
    const m = {};
    for (const e of trip.expenses) m[e[key]] = (m[e[key]] ?? 0) + (e.krw || 0);
    return m;
  };
  return {
    total: budget.total,
    spent,
    left: budget.total - spent,
    byCat: group('cat'),
    byDay: group('day'),
    byPay: group('pay'),
  };
}

export const won = (n) => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;

export function money(amount, code) {
  const c = CURRENCIES[code] ?? CURRENCIES.USD;
  const n = Number(amount) || 0;
  const digits = code === 'KRW' || code === 'JPY' || code === 'VND' ? 0 : 2;
  return `${c.symbol}${n.toLocaleString('ko-KR', { maximumFractionDigits: digits })}`;
}

/** "100엔 = 912원" */
export function rateLabel(budget) {
  const c = CURRENCIES[budget.currency];
  if (!c || budget.currency === 'KRW') return '';
  if (!(budget.krwPerUnit > 0)) return '환율 미정';
  const v = budget.krwPerUnit * c.unit;
  return `${c.unit === 1 ? '1' : c.unit}${c.name} = ${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
}

/** 엑셀에서 바로 열리는 CSV (BOM 포함). */
export function expensesCsv(trip) {
  const budget = ensureBudget(trip);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['날짜', '분류', '결제', '금액', '통화', '원화', '메모', '기록 시각'];
  const rows = trip.expenses.map((e) => [
    e.day < 0 ? '출발 전' : `Day ${e.day + 1}`,
    EXPENSE_CATS[e.cat]?.label ?? '',
    PAYMENTS[e.pay]?.label ?? '',
    e.amount,
    e.cur === 'KRW' ? 'KRW' : budget.currency,
    e.krw,
    e.memo,
    e.at,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
