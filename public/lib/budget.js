// 가계부: 여행 중 쓴 돈 기록. 순수 함수만 둔다.
// trip.budget = { total, currency, krwPerUnit, rateSource: 'auto'|'manual', rateAt }
//   total: 1인 예산(원), currency: 현지 통화 코드, krwPerUnit: 현지 통화 1단위가 몇 원인지
// trip.expenses = [{ id, amount, cur: 'local'|'KRW', krw, cat, pay, day, memo, at, ccy, rate, base?, baseRate? }]
//   ccy: 적은 통화 코드 (현지 통화를 나중에 바꿔도 이 기록은 원래 통화로 남는다), rate: 적용한 환율(1단위가 몇 원, 원화는 1)
//   base/baseRate: 기록할 때의 기준 통화와 그 환율(1단위가 몇 원) — 기준 통화 환율을 나중에 바꿔도 이 기록의 환산액은 그대로
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
  card: { label: '신용카드', icon: '💳' },
  debit: { label: '체크카드', icon: '💳' },
  easypay: { label: '간편결제', icon: '📱' },
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
  normalizeExpenses(trip);
  return trip.budget;
}

/**
 * 예전 버전 기록·백업 파일 하위 호환: 빠진 칸을 기본값으로 채운다 (여러 번 불러도 같다).
 * - 결제수단이 없거나 모르는 값이면 카드, 분류는 기타, 날짜는 출발 전
 * - 적은 통화(ccy)가 없으면 지금 현지 통화, 적용 환율(rate)은 저장된 원화 ÷ 금액 (원화가 없으면 미정 null)
 */
export function normalizeExpenses(trip) {
  const b = trip.budget ?? {};
  for (const e of trip.expenses ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (!Object.hasOwn(PAYMENTS, e.pay)) e.pay = 'card';
    if (!EXPENSE_CATS[e.cat]) e.cat = 'etc';
    if (e.cur !== 'KRW') e.cur = 'local';
    const d = e.day === '' || e.day == null ? NaN : Number(e.day);
    e.day = Number.isInteger(d) ? d : -1;
    e.amount = Number(e.amount) || 0;
    if (e.krw != null) e.krw = Number.isFinite(Number(e.krw)) ? Math.round(Number(e.krw)) : null;
    if (typeof e.memo !== 'string') e.memo = String(e.memo ?? '');
    if (!CURRENCIES[e.ccy]) e.ccy = e.cur === 'KRW' ? 'KRW' : CURRENCIES[b.currency] ? b.currency : 'USD';
    if (e.rate === undefined) e.rate = e.ccy === 'KRW' ? 1 : e.krw != null && e.amount > 0 ? e.krw / e.amount : null;
  }
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
  const a = parseAmount(amount) ?? 0; // "1,200"도 한 번만 읽어 저장·환산에 같은 숫자를 쓴다 (GPT 2차 #5)
  const e = {
    id: uid(),
    amount: a,
    cur: cur === 'KRW' ? 'KRW' : 'local',
    krw: toKrw(a, cur, budget), // 환율을 모르면 null (나중에 채움)
    cat: EXPENSE_CATS[cat] ? cat : 'etc',
    pay: Object.hasOwn(PAYMENTS, pay) ? pay : 'card',
    day: Number.isInteger(day) ? day : -1,
    memo: String(memo ?? '').trim(),
    at: new Date().toISOString(),
  };
  snapshotRate(e, budget);
  trip.expenses.push(e);
  return e;
}

/** 기록 시점의 환율을 그 지출에 남긴다 (적은 통화 · 적용 환율 · 기준 통화 환율) */
function snapshotRate(e, budget) {
  e.ccy = e.cur === 'KRW' || budget.currency === 'KRW' ? 'KRW' : budget.currency;
  e.rate = e.ccy === 'KRW' ? 1 : budget.krwPerUnit > 0 ? budget.krwPerUnit : null;
  const code = baseCode(budget);
  const r = krwPerBase(budget);
  if (code !== 'KRW' && r) {
    e.base = code;
    e.baseRate = r;
  } else {
    delete e.base;
    delete e.baseRate;
  }
}

/** 환율을 몰라 원화가 비어 있는 기록을 지금 환율로 채운다. 채운 개수를 돌려준다. */
export function fillPendingKrw(trip) {
  const budget = ensureBudget(trip);
  let n = 0;
  for (const e of trip.expenses) {
    if (e.krw != null) continue;
    // 적은 통화(ccy)가 지금 현지 통화와 다르면 지금 환율로 채우지 않는다 — 1,000엔을 달러 환율로 바꾸지 않게 (GPT 2차 #2)
    if (e.cur !== 'KRW' && e.ccy && e.ccy !== 'KRW' && e.ccy !== budget.currency) continue;
    const krw = toKrw(e.amount, e.cur, budget);
    if (krw != null) {
      e.krw = krw;
      snapshotRate(e, budget);
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
  // 기간을 줄여 원래 날짜(e.date)를 남긴 지출: 그 날짜가 있는 일차에만 붙고, 없으면 '일정 외' (GPT 검수 #6)
  if (e.date) {
    const i = trip.days.findIndex((x) => x.date === e.date);
    return i >= 0 ? i : 'out';
  }
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

/**
 * 통화별 합계: 현지 돈으로 적은 것과 원화로 적은 것을 따로 더한다 (기록한 통화 그대로).
 * → { local: 현지 통화 합계, krw: 원화로 적은 합계, localCount, krwCount }
 */
export function currencyTotals(trip) {
  const cur = ensureBudget(trip).currency;
  const out = { local: 0, krw: 0, localCount: 0, krwCount: 0, other: {} };
  for (const e of trip.expenses ?? []) {
    const ccy = e.cur === 'KRW' ? 'KRW' : e.ccy ?? cur;
    if (ccy === 'KRW') {
      out.krw += Number(e.amount) || 0;
      out.krwCount++;
    } else if (ccy === cur) {
      out.local += Number(e.amount) || 0;
      out.localCount++;
    } else {
      // 현지 통화를 바꾸기 전에 적은 다른 통화 (예: 엔으로 적고 달러로 바꿈) — 섞어 더하지 않는다 (GPT 2차 #6)
      out.other[ccy] ??= { amount: 0, count: 0 };
      out.other[ccy].amount += Number(e.amount) || 0;
      out.other[ccy].count++;
    }
  }
  return out;
}

/** 예산 상태: unset(예산 없음) · within(남음) · reached(딱 맞게 다 씀) · over(초과) */
export function budgetState(total, spent) {
  if (!(total > 0)) return 'unset';
  if (spent > total) return 'over';
  return spent === total ? 'reached' : 'within';
}

export const won = (n) => `₩${Math.round(Number(n) || 0).toLocaleString(locale())}`;

/** 통화 선택 버튼처럼 기호만 표시할 때도 엔과 위안을 구분한다. */
export function currencySymbol(code) {
  if (code === 'JPY') return 'JP¥';
  if (code === 'CNY') return 'CN¥';
  return CURRENCIES[code]?.symbol.trim() ?? '';
}

export function money(amount, code) {
  const c = CURRENCIES[code] ?? CURRENCIES.USD;
  const n = Number(amount) || 0;
  const digits = fractionDigits(code);
  return `${c.symbol}${n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/* ───────── 기준 통화 (C1) ─────────
 * trip.budget.base = 'KRW' | 'USD' | … (없으면 KRW). 지출은 계속 원화(krw)로 저장하고, 합계·정산을 보여 줄 때만 기준 통화로 바꾼다.
 * 기준 통화가 현지 통화면 현지 환율(krwPerUnit)을, 그 밖이면 baseKrwPerUnit(기준 통화 1단위가 몇 원)을 쓴다.
 * 환율을 아직 모르면 원화로 보여 준다.
 */
export const baseCode = (budget) => (CURRENCIES[budget?.base] ? budget.base : 'KRW');
const INT_CODES = new Set(['KRW', 'JPY', 'VND']);
/** 통화별 소수 자리: KRW·JPY·VND는 정수, 그 밖(USD·EUR 등)은 소수점 둘째 자리 */
export const fractionDigits = (code) => (INT_CODES.has(code) ? 0 : 2);
/** 금액을 통화의 최소 단위 정수로 (USD 12.345 → 1235센트, JPY 1500.4 → 1500) */
export const toUnits = (value, code) => Math.round((Number(value) || 0) * 10 ** fractionDigits(code));
export const fromUnits = (units, code) => units / 10 ** fractionDigits(code);
export function krwPerBase(budget) {
  const code = baseCode(budget);
  if (code === 'KRW') return 1;
  // baseKrwPerUnit은 baseRateCode 통화의 환율이다. 기준 통화를 바꾸면 예전 통화 환율을 쓰지 않는다 (GPT 2차 #3)
  const r = code === budget?.currency ? budget.krwPerUnit : !budget?.baseRateCode || budget.baseRateCode === code ? budget?.baseKrwPerUnit : null;
  return r > 0 ? r : null;
}
/** 원화 금액 → 기준 통화 숫자 (환율을 모르면 null) */
export function toBase(krw, budget) {
  const r = krwPerBase(budget);
  return r ? (Number(krw) || 0) / r : null;
}
/** 기준 통화 숫자 → 원화 (환율을 모르면 그대로 원화로 본다) */
export function fromBase(value, budget) {
  const r = krwPerBase(budget) ?? 1;
  return Math.round((Number(value) || 0) * r);
}
/** 지금 실제로 보여 주는 기준 통화 (기준 통화 환율을 모르면 원화) */
export const shownBaseCode = (budget) => (krwPerBase(budget) ? baseCode(budget) : 'KRW');

/** 기준 통화 숫자 표시: KRW·JPY는 정수, 그 밖은 소수점 2자리. 같은 기호(¥) 통화는 코드를 붙인다 */
export function formatMoney(value, code) {
  const c = CURRENCIES[code] ?? CURRENCIES.KRW;
  const digits = fractionDigits(code);
  const v = fromUnits(toUnits(value, code), code); // 표시 자리에서 한 번만 반올림
  const sign = v < 0 ? '-' : '';
  const text = `${sign}${c.symbol}${Math.abs(v).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  if (code === 'KRW') return text;
  const shared = Object.entries(CURRENCIES).some(([k, x]) => k !== code && x.symbol === c.symbol);
  return shared ? `${text} ${code}` : text;
}
/** 최소 단위 정수 → 표시 (정산처럼 단위로 계산한 값) */
export const formatUnits = (units, code) => formatMoney(fromUnits(units, code), code);

/** 원화 금액을 기준 통화로 표시: KRW·JPY는 정수, 그 밖은 소수점 2자리. 같은 기호(¥) 통화는 코드를 붙인다 */
export function baseMoney(krw, budget) {
  const code = baseCode(budget);
  const v = toBase(krw, budget);
  if (code === 'KRW' || v == null) return won(krw);
  return formatMoney(v, code);
}

/**
 * 지출 하나를 지금 보여 주는 기준 통화의 최소 단위 정수로 (환율 미정이면 null).
 * 기록할 때 남긴 환율을 우선한다 — 기준 통화 환율을 나중에 바꿔도 과거 지출의 환산액은 그대로.
 *  1) 적은 통화가 기준 통화면 적은 금액 그대로  2) 같은 기준 통화로 기록했으면 그때 환율  3) 그 밖은 지금 환율
 */
export function expenseBaseUnits(e, budget) {
  const code = shownBaseCode(budget);
  if (e.krw == null) return null;
  if (code === 'KRW') return Math.round(Number(e.krw) || 0);
  const ccy = e.ccy ?? (e.cur === 'KRW' ? 'KRW' : budget.currency);
  if (ccy === code) return toUnits(e.amount, code);
  if (e.base === code && e.baseRate > 0) return toUnits(e.krw / e.baseRate, code);
  return toUnits(toBase(e.krw, budget), code);
}

/** 쓴 돈 합계(기준 통화 최소 단위) — 기록마다 반올림한 값을 더해 목록 합과 총합이 항상 같다 */
export function spentUnits(trip, pick = () => true) {
  const b = ensureBudget(trip);
  return trip.expenses.filter(pick).reduce((s, e) => s + (expenseBaseUnits(e, b) ?? 0), 0);
}

/** 결제수단별 합계(기준 통화 최소 단위)와 건수 → { [pay]: { units, count } } */
export function byPayment(trip) {
  const b = ensureBudget(trip);
  const out = {};
  for (const e of trip.expenses) {
    const k = PAYMENTS[e.pay] ? e.pay : 'card';
    out[k] ??= { units: 0, count: 0 };
    out[k].units += expenseBaseUnits(e, b) ?? 0;
    out[k].count++;
  }
  return out;
}
/** 기준 통화 바꾸기. 바뀌었으면 true */
export function setBase(trip, code) {
  const b = ensureBudget(trip);
  const next = CURRENCIES[code] ? code : 'KRW';
  if (baseCode(b) === next) return false;
  if (next === 'KRW') delete b.base;
  else b.base = next;
  // 다른 통화의 기준 환율은 버린다 (새 통화 환율을 받을 때까지 원화로 보여 준다)
  if (b.baseKrwPerUnit && (b.baseRateCode ?? null) !== next) {
    delete b.baseKrwPerUnit;
    delete b.baseRateAt;
    delete b.baseRateCode;
  }
  return true;
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

/** CSV와 XLSX에서 공유하는 가계부 열과 기록. */
export function expenseRows(trip) {
  ensureBudget(trip);
  const head = ['날짜', '분류', '결제', '금액', '통화', '원화', '메모', '기록 시각'].map((h) => t(h));
  const rows = trip.expenses.map((e) => [
    expenseDayLabel(trip, e),
    EXPENSE_CATS[e.cat] ? t(EXPENSE_CATS[e.cat].label) : '',
    PAYMENTS[e.pay] ? t(PAYMENTS[e.pay].label) : '',
    e.amount,
    e.ccy,
    e.krw ?? '',
    e.memo,
    e.at,
  ]);
  return [head, ...rows];
}

/** 엑셀에서 바로 열리는 CSV (BOM 포함). */
export function expensesCsv(trip) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + expenseRows(trip).map((r) => r.map(q).join(',')).join('\r\n');
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
    snapshotRate(old, budget); // 새로 기록한 결제이므로 통화·환율도 지금 값으로 (GPT 2차 #7)
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

/* ───────── 저장한 지출 고치기 ─────────
 * 메모·분류·날짜·결제수단만 바꾸면 원화 환산액(기록 당시 환율)은 그대로 둔다.
 * 금액·통화를 바꾸면: 원화 → 그 금액, 현지 돈 → 이 기록에 적용했던 환율(있으면), 없으면 지금 환율, 그것도 없으면 '환율 미정'.
 */
/** 고치는 지출이 적힌 실제 통화: 원화로 바꾸면 KRW, 현지 돈 그대로면 그 기록의 통화(ccy) — 지금 현지 통화가 아니라 (GPT 3차 #2) */
export const editCurrency = (trip, e, cur) => (cur === 'KRW' ? 'KRW' : e.cur !== 'KRW' && e.ccy ? e.ccy : ensureBudget(trip).currency);

export function expenseKrwPreview(trip, e, { amount, cur }) {
  const b = ensureBudget(trip);
  const a = parseAmount(amount);
  if (!(a > 0)) return null;
  if (editCurrency(trip, e, cur) === 'KRW') return { krw: Math.round(a), rate: null, source: 'krw' };
  if (e.cur !== 'KRW' && (e.rate > 0 || (e.krw != null && e.amount > 0))) {
    const rate = e.rate > 0 ? e.rate : e.krw / e.amount; // 기록할 때 남긴 환율 (반올림 전 값)
    return { krw: Math.round(a * rate), rate, source: 'recorded' };
  }
  if (e.cur !== 'KRW' && e.ccy && e.ccy !== b.currency) return { krw: null, rate: null, source: 'none' }; // 다른 통화 기록에 지금 환율을 쓰지 않는다
  if (b.krwPerUnit > 0) return { krw: Math.round(a * b.krwPerUnit), rate: b.krwPerUnit, source: 'current' };
  return { krw: null, rate: null, source: 'none' };
}

/** 저장한 지출 고치기 (id는 그대로). 잘못된 금액이면 null */
export function updateExpense(trip, id, patch) {
  const e = (trip.expenses ?? []).find((x) => x.id === id);
  if (!e) return null;
  const amount = patch.amount != null ? parseAmount(patch.amount) : e.amount;
  if (!(amount > 0) || amount > MAX_AMOUNT) return null;
  const cur = patch.cur === 'KRW' ? 'KRW' : patch.cur === 'local' ? 'local' : e.cur;
  if (amount !== e.amount || cur !== e.cur) {
    const p = expenseKrwPreview(trip, e, { amount, cur });
    const code = editCurrency(trip, e, cur);
    e.amount = amount;
    e.cur = code === 'KRW' ? 'KRW' : 'local';
    e.krw = p.krw;
    // 적용 환율은 이 기록에 남긴 값 그대로 (통화를 바꿨을 때만 새로)
    e.ccy = code;
    e.rate = code === 'KRW' ? 1 : p.rate ?? e.rate ?? null;
  }
  if (patch.memo != null) e.memo = String(patch.memo).trim();
  if (EXPENSE_CATS[patch.cat]) e.cat = patch.cat;
  if (Object.hasOwn(PAYMENTS, patch.pay)) e.pay = patch.pay;
  if (patch.day != null && patch.day !== 'out') {
    const d = Number(patch.day);
    if (Number.isInteger(d) && d >= -1 && d < trip.days.length) {
      e.day = d;
      delete e.date;
    }
  }
  return e;
}

/**
 * P0-5: 가계부 "날짜별" 막대. 막대는 카드 폭을 넘지 않게 줄이고 라벨은 n개 간격으로만 붙인다.
 * 여행이 weekFrom(30)일 이상이면 7일씩 묶어 주 단위로 보여 준다 (마지막 주는 남은 날만).
 * → { bars: [{ key, kind: 'pre'|'day'|'week'|'out', from, to, value, label }], step }
 *   label: 라벨을 보일지 ('출발 전'·'일정 외'는 항상, 일차·주는 step 간격 — step이 1이면 모두)
 */
export function dayBars(trip, byDay, { weekFrom = 30, maxLabels = 7, hasOut = byDay.out != null } = {}) {
  const n = trip.days.length;
  const periods = [];
  if (n >= weekFrom) {
    for (let a = 0; a < n; a += 7) {
      const to = Math.min(n, a + 7) - 1;
      let value = 0;
      for (let i = a; i <= to; i++) value += byDay[i] ?? 0;
      periods.push({ key: `w${a / 7}`, kind: 'week', from: a, to, value });
    }
  } else {
    for (let i = 0; i < n; i++) periods.push({ key: i, kind: 'day', from: i, to: i, value: byDay[i] ?? 0 });
  }
  const step = Math.max(1, Math.ceil(periods.length / maxLabels));
  // 간격이 있으면 D{step}, D{2·step}…에만 붙인다 (맨 앞 '출발 전' 라벨과 겹치지 않게)
  periods.forEach((p, i) => (p.label = (i + 1) % step === 0));
  const bars = [{ key: -1, kind: 'pre', from: -1, to: -1, value: byDay[-1] ?? 0, label: true }, ...periods];
  if (hasOut) bars.push({ key: 'out', kind: 'out', from: null, to: null, value: byDay.out ?? 0, label: true });
  return { bars, step };
}
