// 날짜 고르기: 브라우저 기본 달력(<input type="date">) 대신 Cally 달력 팝오버를 쓴다.
// https://github.com/WickyNilliams/cally (웹 컴포넌트, index.html에서 불러온다)
//
// 원래 input은 숨긴 채로 그대로 두고 value만 채운다. 그래서 기존 change 핸들러·FormData가 그대로 동작한다.
//  - 기간: [data-dp-pair] 안의 input[data-dp="start"] + input[data-dp="end"]. 하나의 달력에서 시작~끝을 고른다.
//    data-dp-pair="여행 날짜"처럼 값에 제목을, data-dp-min-nights="1"로 최소 박 수를 줄 수 있다.
//    고른 뒤 "적용"을 누르면 end input에 change(버블링)를 한 번만 보낸다.
//  - 날짜+시간: input[type="datetime-local"] → 날짜 버튼 + 시간 칸.
import { formatDate, parseDate } from './model.js';

const ICON_CAL = '<svg class="dp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16V20H4z M4 10.5h16 M8.5 3.5v4 M15.5 3.5v4"/></svg>';
const CHEV = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const mobile = () => matchMedia('(max-width: 640px)').matches;
const nights = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

/** "12월 1일 (화)" — 올해가 아니면 앞에 연도 */
function label(date) {
  const d = parseDate(date);
  if (!d) return '';
  const y = d.getUTCFullYear() !== new Date().getFullYear() ? `${d.getUTCFullYear()}년 ` : '';
  return y + formatDate(date);
}

function rangeText(a, b) {
  if (!a) return '날짜를 골라 주세요';
  if (!b) return `${label(a)} → 끝나는 날을 골라 주세요`;
  const n = nights(a, b);
  return `${label(a)} – ${label(b)} · ${n ? `${n}박 ${n + 1}일` : '당일'}`;
}

/* ───────── 팝오버 (화면에 하나만) ───────── */
let pop = null;
let state = null; // { kind: 'range'|'date', anchor, onApply, minNights, start, end, value }

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'datePicker';
  pop.className = 'dp-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'datePickerTitle');
  pop.innerHTML = `<div class="dp-scrim" data-dp-close></div>
    <div class="dp-panel" tabindex="-1">
      <div class="dp-grip" aria-hidden="true"></div>
      <div class="dp-head">
        <div><h2 class="dp-title" id="datePickerTitle"></h2><p class="dp-sum" role="status"></p></div>
        <button type="button" class="dp-dismiss" data-dp-close aria-label="달력 닫기">×</button>
      </div>
      <div class="dp-cal"></div>
      <p class="dp-err" role="status" hidden></p>
      <div class="dp-foot">
        <button type="button" class="dp-btn ghost" data-dp-close>취소</button>
        <button type="button" class="dp-btn primary" data-dp-apply>적용</button>
      </div>
      <span class="dp-focus-end" tabindex="0"></span>
    </div>`;
  document.body.append(pop);
  $q('.dp-focus-end').addEventListener('focus', () => $q('.dp-dismiss').focus());
  pop.addEventListener('click', (e) => {
    if (e.target.closest('[data-dp-close]')) close();
    else if (e.target.closest('[data-dp-apply]')) apply();
  });
  document.addEventListener('keydown', (e) => {
    if (!state) return;
    if (e.key === 'Escape') {
      e.preventDefault(); // 항공편 창(<dialog>)까지 닫히지 않게
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && mobile()) {
      const active = document.activeElement;
      const last = $q('[data-dp-apply]:not(:disabled)')?.offsetWidth
        ? $q('[data-dp-apply]')
        : state.kind === 'range' ? $q('.dp-foot [data-dp-close]') : $q('.dp-c');
      const first = $q('.dp-dismiss');
      if (!pop.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (state && !mobile() && !pop.contains(e.target) && !state.anchor.contains(e.target)) close();
  });
  document.addEventListener('close', (e) => {
    if (state && e.target === pop.parentElement && !e.target.open) close(false);
  }, true);
  addEventListener('resize', () => state && place());
  return pop;
}

function calendarHtml(kind, months) {
  const tag = kind === 'range' ? 'calendar-range' : 'calendar-date';
  const monthsHtml = Array.from({ length: months }, (_, i) => `<calendar-month${i ? ` offset="${i}"` : ''}></calendar-month>`).join('');
  return `<${tag} class="dp-c" months="${months}" locale="ko-KR" first-day-of-week="0" show-outside-days="false">
      <span slot="previous" aria-label="이전 달">${CHEV('m14.5 6-6 6 6 6')}</span>
      <span slot="next" aria-label="다음 달">${CHEV('m9.5 6 6 6-6 6')}</span>
      <div class="dp-months">${monthsHtml}</div>
    </${tag}>`;
}

function open(opts) {
  ensurePop();
  if (state?.anchor === opts.anchor) return close();
  if (state) close(false);
  state = { ...opts };
  opts.anchor.setAttribute('aria-expanded', 'true');
  const months = opts.kind === 'range' && !mobile() ? 2 : 1;
  $q('.dp-title').textContent = opts.title;
  $q('.dp-cal').innerHTML = calendarHtml(opts.kind, months);
  const cal = $q('.dp-c');
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
  if (opts.min) cal.setAttribute('min', opts.min);
  if (opts.max) cal.setAttribute('max', opts.max);
  if (opts.kind === 'range') {
    if (opts.start && opts.end) cal.value = `${opts.start}/${opts.end}`;
    cal.focusedDate = opts.start || opts.min || today;
    cal.addEventListener('rangestart', (e) => {
      state.start = toISO(e.detail);
      state.end = '';
      update();
    });
    cal.addEventListener('change', () => {
      [state.start, state.end] = cal.value.split('/');
      update();
    });
  } else {
    if (opts.value) cal.value = opts.value;
    cal.focusedDate = opts.value || opts.near || opts.min || today;
    cal.addEventListener('change', () => {
      state.value = cal.value;
      // 날짜 하나는 고르면 바로 적용 (시간은 옆 칸에서)
      apply();
    });
  }
  $q('.dp-foot').hidden = opts.kind !== 'range';
  // 모달 <dialog> 안에서 열면 그 안에 붙여야 위에 보인다 (모달은 최상위 층에 그려진다)
  const host = opts.anchor.closest('dialog[open]') ?? document.body;
  if (pop.parentNode !== host) host.append(pop);
  pop.hidden = false;
  update();
  place();
  // 달력(웹 컴포넌트)이 그려진 뒤 높이가 정해지므로 한 번 더 자리를 잡는다.
  customElements.whenDefined('calendar-month').then(() =>
    requestAnimationFrame(() => {
      if (cal !== $q('.dp-c')) return;
      place();
      pop.classList.add('show');
      cal.focus();
    }),
  );
}

function $q(s) {
  return pop.querySelector(s);
}

const toISO = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''));

function update() {
  if (!state) return;
  if (state.kind === 'range') {
    $q('.dp-sum').textContent = rangeText(state.start, state.end);
    const short = state.end && state.minNights && nights(state.start, state.end) < state.minNights;
    const err = $q('.dp-err');
    err.hidden = !short;
    err.textContent = short ? `${state.minNights}박 이상 골라 주세요` : '';
    $q('[data-dp-apply]').disabled = !state.end || short;
  } else {
    $q('.dp-sum').textContent = state.value ? label(state.value) : '날짜를 골라 주세요';
  }
}

/** 넓은 화면: 누른 칸 아래(모자라면 위)에 띄운다. 좁은 화면: 아래에서 올라오는 시트. */
function place() {
  const panel = $q('.dp-panel');
  pop.classList.toggle('sheet', mobile());
  if (mobile()) pop.setAttribute('aria-modal', 'true');
  else pop.removeAttribute('aria-modal');
  panel.style.left = panel.style.top = '';
  if (mobile()) return;
  const r = state.anchor.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
  const below = r.bottom + 8;
  const top = below + h > innerHeight - 12 ? Math.min(r.top - h - 8, innerHeight - h - 12) : below;
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(12, top)}px`;
}

function apply() {
  if (!state) return;
  const s = state;
  if (s.kind === 'range' && (!s.end || (s.minNights && nights(s.start, s.end) < s.minNights))) return;
  close();
  s.onApply(s);
}

function close(restoreFocus = true) {
  if (!state) return;
  const anchor = state.anchor;
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && (document.activeElement === document.body || pop.contains(document.activeElement))) {
    anchor.focus({ preventScroll: true });
  }
  state = null;
  pop.classList.remove('show');
  pop.hidden = true;
  $q('.dp-cal').innerHTML = '';
}

/* ───────── input 감싸기 ───────── */
const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/** input.value = ... 로 바꿔도(다시 그리기, form.reset 등) 버튼 글자가 따라오게 한다. */
function watch(input, onChange) {
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return VALUE.get.call(this);
    },
    set(v) {
      VALUE.set.call(this, v);
      onChange();
    },
  });
  new MutationObserver(onChange).observe(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max'] });
  input.form?.addEventListener('reset', () => setTimeout(onChange));
}

function fieldButton(input, placeholder) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dp-field';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-controls', 'datePicker');
  btn.setAttribute('aria-expanded', 'false');
  btn.dataset.label = input.getAttribute('aria-label') || input.closest('label')?.firstChild?.textContent.trim() || placeholder;
  btn.innerHTML = `${ICON_CAL}<span class="dp-val"></span>`;
  btn.dataset.placeholder = placeholder;
  input.classList.add('dp-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.after(btn);
  return btn;
}

function shortLabel(date) {
  const d = parseDate(date);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${formatDate(date).slice(-2, -1)})` : '';
}

function paint(btn, value, disabled, short = false) {
  const v = btn.querySelector('.dp-val');
  v.textContent = value ? (short ? shortLabel(value) : label(value)) : btn.dataset.placeholder;
  btn.setAttribute('aria-label', `${btn.dataset.label} · ${value ? label(value) : '날짜 선택'}`);
  btn.classList.toggle('empty', !value);
  btn.disabled = disabled;
}

function enhancePair(scope) {
  const start = scope.querySelector('input[data-dp="start"]');
  const end = scope.querySelector('input[data-dp="end"]');
  if (!start || !end || start.dataset.dpReady) return;
  start.dataset.dpReady = end.dataset.dpReady = '1';
  const bs = fieldButton(start, '시작일');
  const be = fieldButton(end, '종료일');
  const sync = () => {
    paint(bs, start.value, start.disabled);
    paint(be, end.value, end.disabled);
  };
  watch(start, sync);
  watch(end, sync);
  sync();
  const show = (anchor) =>
    open({
      kind: 'range',
      anchor,
      title: scope.dataset.dpPair || '날짜',
      minNights: Number(scope.dataset.dpMinNights) || 0,
      start: start.value,
      end: end.value,
      min: start.min || '',
      max: end.max || '',
      onApply: ({ start: a, end: b }) => {
        VALUE.set.call(start, a);
        VALUE.set.call(end, b);
        sync();
        end.dispatchEvent(new Event('input', { bubbles: true }));
        end.dispatchEvent(new Event('change', { bubbles: true }));
      },
    });
  bs.addEventListener('click', () => show(bs));
  be.addEventListener('click', () => show(be));
}

function enhanceDateTime(input) {
  if (input.dataset.dpReady) return;
  input.dataset.dpReady = '1';
  const wrap = document.createElement('span');
  wrap.className = 'dp-dt';
  input.after(wrap);
  const btn = fieldButton(input, '날짜');
  wrap.append(btn);
  const time = document.createElement('input');
  time.type = 'time';
  time.className = 'dp-time';
  time.setAttribute('aria-label', '시간');
  wrap.append(time);
  const parts = () => {
    const [d = '', t = ''] = VALUE.get.call(input).split('T');
    return { d, t };
  };
  const sync = () => {
    const { d, t } = parts();
    paint(btn, d, input.disabled, true);
    if (document.activeElement !== time) time.value = t.slice(0, 5);
    time.disabled = input.disabled;
  };
  const write = (d, t) => {
    VALUE.set.call(input, d ? `${d}T${t || '09:00'}` : '');
    sync();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  watch(input, sync);
  sync();
  time.addEventListener('change', () => {
    const { d } = parts();
    if (d) write(d, time.value);
  });
  btn.addEventListener('click', () => {
    // 도착 칸은 출발 날짜 근처 달을 먼저 보여준다
    const near = input.form?.querySelector('input[type="datetime-local"]:not([name="' + input.name + '"])')?.value.slice(0, 10);
    open({
      kind: 'date',
      anchor: btn,
      title: input.closest('label')?.firstChild?.textContent.trim() || '날짜',
      value: parts().d,
      near,
      onApply: ({ value }) => write(value, time.value || parts().t),
    });
  });
}

/** root 안의 날짜 칸을 모두 감싼다. 다시 그린 뒤 불러도 된다 (이미 감싼 칸은 건너뛴다). */
export function enhanceDates(root = document) {
  if (!customElements.get('calendar-range')) {
    // Cally를 못 불러오면(오프라인 첫 방문 등) 기본 달력을 그대로 쓴다.
    customElements.whenDefined('calendar-range').then(() => enhanceDates(root));
    return;
  }
  root.querySelectorAll('[data-dp-pair]').forEach(enhancePair);
  root.querySelectorAll('input[type="datetime-local"]').forEach(enhanceDateTime);
}

export function closeDatePicker() {
  close();
}
