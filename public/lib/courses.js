// I-5: 가이드 코스를 일정으로 넣기 (DOM 없이 테스트한다).
// 코스 데이터: { id, destination, title: {ko,en,zh,ja}, days: [{ items: [{ name, address, lat, lng, time, memo, url? }] }], checklist: [{ group, text }] }
//  - name·memo·title·text는 4개 국어 맵(또는 글자). 좌표는 고정값 — 런타임 지오코딩을 하지 않는다 (P0-1 교훈)
//  - "그대로" = 보관함이 아니라 고른 일차에 글과 같은 순서로, 시간·메모까지
import * as M from './model.js';
import * as C from './checklist.js';

const LANG_KEYS = ['ko', 'en', 'zh', 'ja'];
const isMap = (v) => Boolean(v) && typeof v === 'object' && LANG_KEYS.every((l) => typeof v[l] === 'string' && v[l]);
export const localized = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.ko ?? '' : String(v ?? ''));

/** 코스가 쓸 수 있는 모양인지 (장소마다 이름과 유한한 좌표) */
export function validCourse(course) {
  return Boolean(course?.days?.length) && course.days.every((d) => d.items?.length
    && d.items.every((p) => localized(p.name, 'ko') && Number.isFinite(p.lat) && Number.isFinite(p.lng)));
}

export const courseDays = (course) => course.days.length;
export const coursePlaceCount = (course) => course.days.reduce((n, d) => n + d.items.length, 0);

/** 이 코스로 만든(넣은) 여행: 최근에 고친 것부터 */
export function courseTrips(trips, id) {
  return trips.filter((tr) => tr.sourceCourse === id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** "기존 여행에 넣기" 목록: 같은 여행지(목적지) 여행을 맨 위로 */
export function tripChoices(trips, destinationNames) {
  const names = new Set(destinationNames.map((n) => String(n).trim().toLowerCase()));
  const match = (tr) => names.has(String(tr.destination ?? '').trim().toLowerCase());
  return [...trips].sort((a, b) => Number(match(b)) - Number(match(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** 코스 일차의 장소를 새 장소 객체로 (지금 언어의 이름·메모, 이름은 4개 국어 맵도 함께 — 언어를 바꾸면 따라간다) */
export function courseItems(course, dayIndex, lang) {
  return course.days[dayIndex].items.map((p) => M.createItem({
    name: localized(p.name, lang),
    ...(isMap(p.name) ? { nameI18n: p.name } : {}),
    address: p.address ?? '',
    lat: p.lat,
    lng: p.lng,
    time: p.time ?? '',
    memo: localized(p.memo, lang),
    url: p.url ?? '',
  }));
}

/**
 * 코스를 여행의 startDay(0부터) 일차부터 넣는다. 그날 기존 장소 뒤에 붙인다.
 * 코스가 남은 일수보다 길면 남는 코스 일차는 마지막 날에 이어 붙인다.
 * withChecklist면 준비할 일을 체크리스트에 더한다 (같은 문구가 있으면 건너뜀). 예약금은 환불되므로 가계부에 넣지 않는다.
 * 돌려주는 값: { placed: 넣은 장소 수, checks: 더한 체크 수, firstDay }
 */
export function applyCourse(trip, course, { startDay = 0, lang = 'ko', withChecklist = true } = {}) {
  const last = trip.days.length - 1;
  const firstDay = Math.min(Math.max(0, startDay), last);
  let placed = 0;
  course.days.forEach((_, k) => {
    const items = courseItems(course, k, lang);
    trip.days[Math.min(firstDay + k, last)].items.push(...items);
    placed += items.length;
  });
  let checks = 0;
  if (withChecklist) {
    const have = new Set(C.ensureChecks(trip).map((c) => C.normalizeCheckText(C.checkText(c))));
    for (const item of course.checklist ?? []) {
      const text = localized(item.text, lang);
      if (!text || have.has(C.normalizeCheckText(text))) continue;
      if (C.addCheck(trip, item.group ?? 'todo', text)) {
        have.add(C.normalizeCheckText(text));
        checks++;
      }
    }
  }
  trip.sourceCourse = course.id;
  return { placed, checks, firstDay };
}

/** 기본 날짜: 다가오는 첫 토요일 (오늘이 토요일이면 다음 주 토요일) */
export function nextSaturday(today) {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (((6 - d.getUTCDay()) + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/** 시작일과 코스 일수로 끝나는 날 */
export function courseEndDate(start, days) {
  const d = new Date(start + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.max(1, days) - 1);
  return d.toISOString().slice(0, 10);
}
