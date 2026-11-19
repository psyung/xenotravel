// 가계부: 여행 중 쓴 돈 기록. 순수 함수만 둔다.
// trip.budget = { total, currency, krwPerUnit, rateSource: 'auto'|'manual', rateAt }
//   total: 1인 예산(원), currency: 현지 통화 코드, krwPerUnit: 현지 통화 1단위가 몇 원인지
// trip.expenses = [{ id, amount, cur: 'local'|'KRW', krw, cat, pay, day, memo, at }]
//   day: -1 = 출발 전, 0.. = Day n,  krw: 기록한 순간의 환율로 바꾼 원화 (나중에 환율이 바뀌어도 그대로)
//   krw: null = 환율을 모를 때(오프라인 등) 현지 돈으로만 적은 것. 환율이 정해지면 fillPendingKrw가 채운다.
//   date: 여행 기간을 줄여 그 날이 사라졌을 때 남겨 두는 원래 날짜 → '일정 외'로 집계한다
// trip.budget.currencyConfirmed: false = 여행지로 통화를 확신하지 못해 첫 기록 전에 확인이 필요함 (없으면 확인된 것으로 본다)
import { uid, findItem, indexOfDate } from './model.js';
import { t, num, locale, dayName, shortDate } from './i18n.js';

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

// 여행지 이름 → 통화 (한국어·영어·중국어·일본어 이름). 국가 코드를 알면 그쪽이 먼저다.
const PLACE_CURRENCY = [
  [/일본|도쿄|오사카|교토|후쿠오카|삿포로|오키나와|나고야|고베|나라|요코하마|히로시마|가나자와|하코네|japan|tokyo|osaka|kyoto|fukuoka|sapporo|okinawa|nagoya|日本|東京|大阪|京都|福岡|札幌|沖縄|名古屋|横浜|神戸|广岛|広島/i, 'JPY'],
  [/대만|타이베이|타이중|가오슝|타이난|taiwan|taipei|kaohsiung|台湾|臺灣|台北|臺北|高雄|台中/i, 'TWD'],
  [/홍콩|hong ?kong|香港/i, 'HKD'],
  [/중국|상하이|베이징|칭다오|청두|광저우|선전|자싱|항저우|쑤저우|난징|시안|우한|충칭|톈진|다롄|선양|하얼빈|샤먼|구이린|장자제|쿤밍|리장|옌지|우시|닝보|싼야|하이난|china|shanghai|beijing|qingdao|chengdu|guangzhou|shenzhen|jiaxing|hangzhou|suzhou|nanjing|xi'?an|wuhan|chongqing|tianjin|dalian|xiamen|guilin|zhangjiajie|kunming|sanya|中国|上海|北京|青岛|成都|广州|深圳|嘉兴|杭州|苏州|南京|西安|武汉|重庆|天津|大连|厦门|桂林|三亚/i, 'CNY'],
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

// 나라(ISO 3166-1 alpha-2) → 통화. 여행지 좌표를 찾을 때 받은 국가 코드로 쓴다.
const COUNTRY_CURRENCY = {
  jp: 'JPY', cn: 'CNY', tw: 'TWD', hk: 'HKD', vn: 'VND', th: 'THB', sg: 'SGD', ph: 'PHP', au: 'AUD', ch: 'CHF', gb: 'GBP', us: 'USD',
  gu: 'USD', mp: 'USD', kr: 'KRW',
  fr: 'EUR', it: 'EUR', es: 'EUR', de: 'EUR', pt: 'EUR', nl: 'EUR', at: 'EUR', gr: 'EUR', be: 'EUR', fi: 'EUR', ie: 'EUR', hr: 'EUR', sk: 'EUR', si: 'EUR', ee: 'EUR', lv: 'EUR', lt: 'EUR', lu: 'EUR', mt: 'EUR', cy: 'EUR',
};

/**
 * 여행지 → { code, sure }. sure가 false면 근거가 없어 USD를 임시로 둔 것 (첫 기록 전에 확인받는다).
 * country: 여행지 좌표를 찾을 때 받은 국가 코드 ('cn' 등)
 */
export function detectCurrency(destination, country) {
  const byCountry = COUNTRY_CURRENCY[String(country ?? '').toLowerCase()];
  if (byCountry) return { code: byCountry, sure: true };
  const d = String(destination ?? '');
  const byName = PLACE_CURRENCY.find(([re]) => re.test(d))?.[1];
  return byName ? { code: byName, sure: true } : { code: 'USD', sure: false };
}

/** 여행지 이름 → 통화. 모르면 USD. */
export function guessCurrency(destination, country) {
  return detectCurrency(destination, country).code;
}

export function ensureBudget(trip) {
  trip.budget ??= {};
  trip.budget.total = Number(trip.budget.total) || 0;
  if (!CURRENCIES[trip.budget.currency]) {
    const d = detectCurrency(trip.destination, trip.country);
    trip.budget.currency = d.code;
    if (!d.sure) trip.budget.currencyConfirmed = false;
  }
  trip.budget.krwPerUnit = Number(trip.budget.krwPerUnit) || 0;
  trip.expenses ??= [];
  return trip.budget;
}

/** 첫 기록 전에 통화를 확인해야 하는지 (여행지로 통화를 알 수 없었고, 아직 기록이 없다) */
export const needsCurrency = (trip) => ensureBudget(trip).currencyConfirmed === false;

/** 통화를 고르거나 확인했다. 이미 적은 기록은 그대로 둔다. */
export function confirmCurrency(trip, code) {
  const b = ensureBudget(trip);
  if (CURRENCIES[code] && code !== b.currency) {
    b.currency = code;
    b.krwPerUnit = 0;
    b.rateAt = '';
  }
  delete b.currencyConfirmed;
  return b;
}

/** 금액 → 원화. 환율이 없으면 null. */
export function toKrw(amount, cur, budget) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return null;
  if (cur === 'KRW' || budget.currency === 'KRW') return Math.round(a);
  return budget.krwPerUnit > 0 ? Math.round(a * budget.krwPerUnit) : null;
}

/** 한 번에 적을 수 있는 가장 큰 금액 (자릿수 실수 방지) */
export const MAX_AMOUNT = 1_000_000_000;

/** "1,200" · "12.5" · " 3000 " → 숫자. 읽을 수 없으면 NaN. */
export function parseAmount(v) {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s ? NaN : null;
}

/** 금액 칸 검사. 문제가 있으면 사용자에게 보여줄 문구, 없으면 null. */
export function amountProblem(v) {
  const a = parseAmount(v);
  if (a == null) return t('금액을 입력해 주세요');
  if (Number.isNaN(a)) return t('숫자만 입력해 주세요 (예: 1200 또는 12.5)');
  if (a <= 0) return t('0보다 큰 금액을 입력해 주세요');
  if (a > MAX_AMOUNT) return t('금액이 너무 커요. {max} 이하로 입력해 주세요', { max: num(MAX_AMOUNT) });
  return null;
}

/** 저장 전 검사. 문제가 있으면 사용자에게 보여줄 문구, 없으면 null. */
export function expenseProblem({ amount }) {
  return amountProblem(amount); // 환율이 없어도 현지 돈으로 적어 둔다 (해외에서 인터넷이 안 될 때)
}

export function addExpense(trip, { amount, cur = 'local', cat = 'etc', pay = 'card', day = -1, memo = '' }) {
  const budget = ensureBudget(trip);
  const e = {
    id: uid(),
    amount: parseAmount(amount) ?? 0,
    cur: cur === 'KRW' ? 'KRW' : 'local',
    krw: toKrw(amount, cur, budget), // 환율을 모르면 null (나중에 채움)
    cat: EXPENSE_CATS[cat] ? cat : 'etc',
    pay: PAYMENTS[pay] ? pay : 'card',
    day: Number.isInteger(day) ? day : -1,
    memo: String(memo ?? '').trim(),
    at: new Date().toISOString(),
  };
  trip.expenses.push(e);
  return e;
}

/** 환율을 몰라 원화가 비어 있는 기록을 지금 환율로 채운다. 채운 개수를 돌려준다. */
export function fillPendingKrw(trip) {
  const budget = ensureBudget(trip);
  let n = 0;
  for (const e of trip.expenses) {
    if (e.krw != null) continue;
    const krw = toKrw(e.amount, e.cur, budget);
    if (krw != null) {
      e.krw = krw;
      n++;
    }
  }
  return n;
}

/** 원화가 아직 없는 기록: { count, amount(현지 돈 합계) } */
export function pendingKrw(trip) {
  const list = (trip.expenses ?? []).filter((e) => e.krw == null);
  return { count: list.length, amount: list.reduce((s, e) => s + (Number(e.amount) || 0), 0) };
}

export function removeExpense(trip, id) {
  const before = (trip.expenses ?? []).length;
  trip.expenses = (trip.expenses ?? []).filter((e) => e.id !== id);
  return trip.expenses.length !== before;
}

/**
 * 지출이 잡히는 날: -1(출발 전) | 일차 번호 | 'out'(여행 기간을 줄여 사라진 날 — 일정 외)
 * 날짜별 합계와 전체 합계가 항상 같도록 어느 칸에도 안 들어가는 지출이 없게 한다.
 */
export function expenseDay(trip, e) {
  const d = Number(e.day);
  if (!Number.isInteger(d) || d < 0) return -1;
  return d < trip.days.length ? d : 'out';
}

/** "Day 2" · "출발 전" · "일정 외 · 12/4" */
export function expenseDayLabel(trip, e) {
  const k = expenseDay(trip, e);
  if (k === -1) return t('출발 전');
  if (k === 'out') return e.date ? `${t('일정 외')} · ${shortDate(e.date)}` : t('일정 외');
  return dayName(k);
}

/** 합계와 분류별·날짜별·결제수단별 금액(원). byDay 키: -1, 0..n-1, 'out' */
export function summarize(trip) {
  const budget = ensureBudget(trip);
  const spent = trip.expenses.reduce((s, e) => s + (e.krw || 0), 0);
  const group = (keyOf) => {
    const m = {};
    for (const e of trip.expenses) {
      const k = keyOf(e);
      m[k] = (m[k] ?? 0) + (e.krw || 0);
    }
    return m;
  };
  return {
    total: budget.total,
    spent,
    left: budget.total - spent,
    pending: pendingKrw(trip), // 환율 미정 (spent에 아직 안 들어감)
    byCat: group((e) => e.cat),
    byDay: group((e) => expenseDay(trip, e)),
    byPay: group((e) => e.pay),
  };
}

/** 예산 상태: unset(예산 없음) · within(남음) · reached(딱 맞게 다 씀) · over(초과) */
export function budgetState(total, spent) {
  if (!(total > 0)) return 'unset';
  if (spent > total) return 'over';
  return spent === total ? 'reached' : 'within';
}

export const won = (n) => `₩${Math.round(Number(n) || 0).toLocaleString(locale())}`;

export function money(amount, code) {
  const c = CURRENCIES[code] ?? CURRENCIES.USD;
  const n = Number(amount) || 0;
  const digits = code === 'KRW' || code === 'JPY' || code === 'VND' ? 0 : 2;
  return `${c.symbol}${n.toLocaleString(locale(), { maximumFractionDigits: digits })}`;
}

/** 같은 기호를 쓰는 통화(엔 ¥ · 위안 ¥)도 구분되게 코드를 붙인다: "¥100 CNY" */
export function moneyCode(amount, code) {
  const sym = CURRENCIES[code]?.symbol;
  const shared = Object.entries(CURRENCIES).some(([k, c]) => k !== code && c.symbol === sym);
  return shared ? `${money(amount, code)} ${code}` : money(amount, code);
}

/** 통화 이름 (지금 언어) */
export const currencyName = (code) => t(CURRENCIES[code]?.name ?? code);

/** "100엔 = 912원" */
export function rateLabel(budget) {
  const c = CURRENCIES[budget.currency];
  if (!c || budget.currency === 'KRW') return '';
  if (!(budget.krwPerUnit > 0)) return t('환율 미정');
  const v = budget.krwPerUnit * c.unit;
  return t('{unit}{name} = {krw}원', { unit: c.unit === 1 ? '1' : c.unit, name: t(c.name), krw: v.toLocaleString(locale(), { maximumFractionDigits: 2 }) });
}

/** 엑셀에서 바로 열리는 CSV (BOM 포함). 통화 코드 열이 있어서 엔·위안을 구분한다. */
export function expensesCsv(trip) {
  const budget = ensureBudget(trip);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['날짜', '분류', '결제', '금액', '통화', '원화', '메모', '기록 시각'].map((h) => t(h));
  const rows = trip.expenses.map((e) => [
    expenseDayLabel(trip, e),
    EXPENSE_CATS[e.cat] ? t(EXPENSE_CATS[e.cat].label) : '',
    PAYMENTS[e.pay] ? t(PAYMENTS[e.pay].label) : '',
    e.amount,
    e.cur === 'KRW' ? 'KRW' : budget.currency,
    e.krw ?? '',
    e.memo,
    e.at,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

/**
 * 실제 결제 금액 고치기 (체크리스트 예상 가격과 다르게 냈을 때).
 * 원화는 기록할 때의 환율을 그대로 쓴다 (환율이 없던 기록은 지금 환율, 그것도 없으면 '환율 미정').
 */
export function updateExpenseAmount(trip, id, amount) {
  const e = (trip.expenses ?? []).find((x) => x.id === id);
  const a = parseAmount(amount);
  if (!e || !(a > 0)) return null;
  const rate = e.krw != null && e.amount > 0 ? e.krw / e.amount : null;
  e.amount = a;
  e.krw = rate != null ? Math.round(a * rate) : toKrw(a, e.cur, ensureBudget(trip));
  return e;
}

/* ───────── 장소 비용 ─────────
 * item.cost = { price, cur: 'local'|'KRW' }  예정 비용 (입장료, 식사 등). 가계부 "예상"에 잡힌다.
 * 결제 완료 = 가계부 지출 하나가 그 장소와 연결된다 (expense.placeId = item.id).
 *   여러 번 눌러도, 장소를 다른 날로 옮겨도 지출은 하나뿐이다. 취소하면 그 지출을 지운다.
 * item.visited = 다녀왔는지 (결제와 따로. 무료 관광지는 다녀오기만, 선결제 숙소·티켓은 결제만 한다)
 */
export const PLACE_CAT = { food: 'food', cafe: 'food', sight: 'ticket', shop: 'shop', etc: 'etc' };

/** 예정 비용 정하기 (0이나 빈 값이면 지운다) */
export function setPlaceCost(item, price, cur = 'local') {
  const n = Number(String(price ?? '').replace(/,/g, ''));
  if (n > 0) item.cost = { price: n, cur: cur === 'KRW' ? 'KRW' : 'local' };
  else delete item.cost;
  return item;
}

/** 그 장소와 연결된 지출 (없으면 null) */
export function placeExpense(trip, itemId) {
  return (trip.expenses ?? []).find((e) => e.placeId === itemId) ?? null;
}

/**
 * 결제 완료로 기록. amount/cur를 안 주면 예정 비용으로 적는다.
 * 이미 기록돼 있으면 새로 만들지 않고 금액만 고친다. today가 여행 중이면 그날, 아니면 "출발 전"(선결제)으로 적는다.
 * → { expense, created } | null (장소가 없거나 금액이 없음)
 */
export function payPlace(trip, itemId, { amount, cur, today = '' } = {}) {
  const found = findItem(trip, itemId);
  if (!found) return null;
  const it = found.item;
  const price = Number(String(amount ?? it.cost?.price ?? '').replace(/,/g, ''));
  if (!(price > 0)) return null;
  const c = (cur ?? it.cost?.cur) === 'KRW' ? 'KRW' : 'local';
  const budget = ensureBudget(trip);
  const old = placeExpense(trip, itemId);
  if (old) {
    old.amount = price;
    old.cur = c;
    old.krw = toKrw(price, c, budget);
    return { expense: old, created: false };
  }
  const i = indexOfDate(trip, today);
  const day = i != null && i >= 0 && i < trip.days.length ? i : -1;
  const e = addExpense(trip, { amount: price, cur: c, cat: PLACE_CAT[it.category] ?? 'etc', pay: 'card', day, memo: it.name });
  e.placeId = it.id;
  return { expense: e, created: true };
}

/** 결제 취소: 연결된 지출을 지운다. 지운 개수. */
export function unpayPlace(trip, itemId) {
  const before = (trip.expenses ?? []).length;
  trip.expenses = (trip.expenses ?? []).filter((e) => e.placeId !== itemId);
  return before - trip.expenses.length;
}

/**
 * 일정에 넣은 장소의 예정 비용 (보관함 제외, 원). { total, byCat, priced, noRate }
 * 결제한 장소도 계획에는 그대로 넣는다 (계획 대비 실제를 보려고).
 */
export function placePlanned(trip) {
  const budget = ensureBudget(trip);
  const out = { total: 0, byCat: {}, priced: 0, noRate: 0 };
  for (const d of trip.days) {
    for (const it of d.items) {
      if (!(it.cost?.price > 0)) continue;
      out.priced++;
      const krw = toKrw(it.cost.price, it.cost.cur, budget);
      if (krw == null) {
        out.noRate++;
        continue;
      }
      const cat = PLACE_CAT[it.category] ?? 'etc';
      out.total += krw;
      out.byCat[cat] = (out.byCat[cat] ?? 0) + krw;
    }
  }
  return out;
}

/** 예상 합치기 (체크리스트 + 장소) */
export function combinePlans(...plans) {
  const out = { total: 0, byCat: {}, priced: 0, noRate: 0 };
  for (const p of plans) {
    out.total += p.total;
    out.priced += p.priced;
    out.noRate += p.noRate;
    for (const [k, v] of Object.entries(p.byCat)) out.byCat[k] = (out.byCat[k] ?? 0) + v;
  }
  return out;
}
