// 언어 선택과 공통 형식(날짜·숫자). 브라우저와 Node 테스트에서 같이 쓴다.
// 번역 키는 한국어 원문이다: t('여행 기간') → 지금 언어의 문구. 번역이 없으면 한국어를 그대로 보여준다.
// 변수: t('{n}곳', { n: 3 }). 영어는 'a|b' 형태로 n이 1일 때(a)와 아닐 때(b)를 나눌 수 있다.
// 사용자 데이터(여행 이름·장소 이름·메모)와 외부 원문(검색 결과·트렌드 조사 자료)은 번역하지 않는다.
import { MESSAGES } from './messages.js';

export const LANGS = {
  ko: { label: '한국어', short: 'KO', tag: 'ko-KR', html: 'ko' },
  en: { label: 'English', short: 'EN', tag: 'en-US', html: 'en' },
  zh: { label: '简体中文', short: 'ZH', tag: 'zh-CN', html: 'zh-Hans' },
  ja: { label: '日本語', short: 'JA', tag: 'ja-JP', html: 'ja' },
};
const COLUMN = { en: 0, zh: 1, ja: 2 };
export const LANG_KEY = 'xenotravel:lang';

let lang = 'ko';
/** 번역이 없는 키 (개발 중 확인용) */
export const missing = new Set();

export const normalizeLang = (v) => (Object.hasOwn(LANGS, v) ? v : 'ko');
export const getLang = () => lang;
export const setLang = (v) => (lang = normalizeLang(v));
export const locale = () => LANGS[lang].tag;

/**
 * P0-7: 브라우저 언어 목록(navigator.languages)에서 앞에서부터 지원 언어를 찾는다.
 * ko* → 한국어, ja* → 일본어, zh*(번체 zh-TW·zh-HK·zh-Hant 포함, 번체 지원 전까지 간체) → 중국어, en* → 영어.
 * 하나도 없으면 영어. (public/boot.js가 첫 화면에서 같은 규칙을 쓴다)
 */
export function detectLang(languages = globalThis.navigator?.languages ?? [globalThis.navigator?.language]) {
  for (const raw of languages ?? []) {
    const l = String(raw ?? '').toLowerCase();
    for (const code of ['ko', 'ja', 'zh', 'en']) if (l === code || l.startsWith(`${code}-`)) return code;
  }
  return 'en';
}

/**
 * 시작 언어: 사용자가 언어 버튼으로 고른 저장값이 있으면 그것, 없거나 이상하면 브라우저 언어(detectLang).
 * 저장은 언어 버튼을 누를 때만 한다 (saveLang). 저장소를 못 써도(시크릿 모드 등) 브라우저 언어로.
 */
export function loadLang(storage = globalThis.localStorage, languages) {
  let saved = null;
  try {
    saved = storage?.getItem(LANG_KEY);
  } catch {
    /* 저장소를 못 쓰면 브라우저 언어 */
  }
  return setLang(Object.hasOwn(LANGS, saved ?? '') ? saved : detectLang(languages));
}

/** 저장 성공 여부. 실패해도 지금 화면의 언어는 그대로 바뀐다. */
export function saveLang(storage = globalThis.localStorage) {
  try {
    storage.setItem(LANG_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

/** 한 키의 모든 언어 문구 (원문 + 번역). 템플릿에서 온 값이 사용자가 바꾸지 않은 그대로인지 볼 때 쓴다. */
export const allVersions = (key) => [key, ...(MESSAGES[key] ?? [])];

/** 나중에 t()로 바꿀 문구라는 표시 (값은 그대로). 번역 누락 검사(test/i18n.test.js)가 찾는다. */
export const k = (s) => s;

export function t(key, vars) {
  let s = key;
  if (lang !== 'ko') {
    const v = MESSAGES[key]?.[COLUMN[lang]];
    if (v == null) missing.add(key);
    else s = v;
  }
  if (lang === 'en' && s.includes('|')) {
    const [one, many] = s.split('|');
    s = Number(vars?.n) === 1 ? one : many;
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/* ───────── 숫자 · 날짜 ───────── */
export const num = (n, opts) => Number(n || 0).toLocaleString(locale(), opts);

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3] ? null : d;
};
const fmt = (d, opts) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(d);

/** "12월 1일 (화)" · "Tue, Dec 1" · "12月1日 周二" · "12月1日(火)" */
export function longDate(s) {
  const d = parse(s);
  if (!d) return '';
  if (lang === 'ko') return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAYS_KO[d.getUTCDay()]})`;
  return fmt(d, { month: 'short', day: 'numeric', weekday: 'short' });
}

/** "12월 1일" · "Dec 1" · "12月1日" */
export function monthDay(s) {
  const d = parse(s);
  if (!d) return '';
  if (lang === 'ko') return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  return fmt(d, { month: 'short', day: 'numeric' });
}

/* J-2: 날짜·일차 범위는 이 함수로만 만든다. 한국어 " ~ ", 일본어 "〜", 중국어·영어 "–"(공백 없음).
 * 시작과 끝이 같으면 하나만 ("11/28"). 화면 곳곳에서 기호를 직접 붙이지 않는다. */
const RANGE_SEP = { ko: ' ~ ', en: '–', zh: '–', ja: '〜' };
export const rangeSep = () => RANGE_SEP[lang];
export function formatRange(a, b) {
  if (!a) return b || '';
  if (!b || a === b) return a;
  return `${a}${RANGE_SEP[lang]}${b}`;
}

/** "12/1" (모든 언어 공통 숫자 표기) */
export function shortDate(s) {
  const d = parse(s);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '';
}

/** 요일 한 글자/약자 */
export function weekday(s) {
  const d = parse(s);
  if (!d) return '';
  return lang === 'ko' ? WEEKDAYS_KO[d.getUTCDay()] : fmt(d, { weekday: 'short' });
}

/** 올해가 아니면 연도를 붙인 긴 날짜 */
export function longDateYear(s, thisYear = new Date().getFullYear()) {
  const d = parse(s);
  if (!d) return '';
  if (d.getUTCFullYear() === thisYear) return longDate(s);
  if (lang === 'ko') return `${d.getUTCFullYear()}년 ${longDate(s)}`;
  return fmt(d, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
}

/** "12월" · "Dec" (트렌드 '2026-12' 같은 달 표기) */
export function monthName(month) {
  if (lang === 'ko') return `${month}월`;
  return fmt(new Date(Date.UTC(2000, month - 1, 1)), { month: 'short' });
}

/** 날짜·시각 (ISO 문자열 → 지금 언어, 기기 시간대) */
export function dateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** "Day 3" 같은 일차 이름 */
export const dayName = (i) => t('Day {n}', { n: i + 1 });

/** "3박 4일" / "당일" */
export function tripLength(days, dayTrip) {
  if (days > 1) return t('{n}박 {d}일', { n: days - 1, d: days });
  return dayTrip === undefined ? t('당일') : t(dayTrip);
}
