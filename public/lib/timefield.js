// P1-1: 시간 입력 공용 컴포넌트 (TimeField). 브라우저 기본 시간 선택기 대신 flatpickr(시간 전용, 24시간제, 5분 단위).
// 날짜는 지금처럼 cally(lib/datepicker.js), 시간만 이 컴포넌트를 쓴다 — 항공편 출발·도착 시각과 장소 시간 모두.
//  - 모바일에서도 같은 UI (flatpickr의 모바일 기본 선택기 끄기: disableMobile)
//  - 키보드로 직접 입력: "2045" · "20:45" · "9:5" → 20:45 / 09:05. 빈 값(지우기)도 된다.
//  - 값은 원래 칸 그대로 'HH:MM' 글자이고, 바뀌면 input·change 이벤트가 난다 (기존 저장 코드를 그대로 쓴다)
//  - flatpickr(vendor/flatpickr)가 없으면(불러오지 못하면) 글자 입력칸으로만 동작한다.
import { t } from './i18n.js';

/** 입력 글자 → 'HH:MM' (읽을 수 없으면 null, 빈 글자면 '') */
export function normalizeTime(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let h;
  let min;
  const sep = /^(\d{1,2})\s*[:.시h]\s*(\d{1,2})?\s*분?$/.exec(s);
  if (sep) [h, min] = [sep[1], sep[2] ?? '0'];
  else if (/^\d{1,2}$/.test(s)) [h, min] = [s, '0'];
  else if (/^\d{3,4}$/.test(s)) [h, min] = [s.slice(0, -2), s.slice(-2)];
  else return null;
  h = Number(h);
  min = Number(min);
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 시간 칸 하나를 TimeField로 바꾼다 (여러 번 불러도 한 번만) */
export function enhanceTime(input) {
  if (!input || input.dataset.tfReady) return;
  input.dataset.tfReady = '1';
  const value = input.value;
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.placeholder = input.placeholder || '--:--';
  input.classList.add('time-field');
  input.value = normalizeTime(value) ?? '';
  const fp = globalThis.flatpickr;
  const commit = () => {
    const v = normalizeTime(input.value);
    if (v == null) {
      input.setAttribute('aria-invalid', 'true');
      input.title = t('시간은 20:45처럼 적어 주세요');
      return;
    }
    input.removeAttribute('aria-invalid');
    input.removeAttribute('title');
    if (input.value !== v) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
  if (typeof fp !== 'function') return;
  fp(input, {
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    minuteIncrement: 5,
    disableMobile: true,
    allowInput: true,
    clickOpens: true,
    parseDate: (s) => {
      const v = normalizeTime(s);
      if (!v) return undefined;
      const [h, m] = v.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    },
    // 모달 <dialog> 안에서는 칸 바로 아래에 붙인다 (대화상자 스크롤과 함께 움직이게)
    static: Boolean(input.closest('dialog')),
  });
}

/** 다시 그리기 전에 root 안 TimeField의 flatpickr를 정리한다 (달력 노드·문서 이벤트가 남지 않게) */
export function destroyTimes(root = document) {
  for (const el of root.querySelectorAll('input.time-field')) el._flatpickr?.destroy();
}

/** root 안의 시간 칸(input[type=time] · [data-time-field])을 모두 TimeField로 */
export function enhanceTimes(root = document) {
  for (const el of root.querySelectorAll('input[type="time"], input[data-time-field]')) enhanceTime(el);
}
