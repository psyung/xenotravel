// P1-2: 공용 Select 컴포넌트. 브라우저 기본 <select>를 그대로 두고(값·폼·change 이벤트는 원래 select) 겉모습만 바꾼다.
//  - 데스크톱: 버튼 아래 팝오버 · 모바일(600px 미만): 바텀시트
//  - 항목이 10개를 넘으면 위에 검색칸
//  - 일차 항목: <option data-color data-sub data-badge>로 "● Day 3 · 11/25 (수) · 2곳", 오늘 배지, 지금 값은 체크
//  - 키보드: ↑↓ · Home/End · Enter · Esc · 글자 입력으로 이동, role=listbox/option, 닫으면 버튼으로 포커스 복귀
// 쓰는 법: <select data-ui-select>를 화면에 넣으면 자동으로 바뀐다 (watchSelects). 앱이 option을 다시 그려도 따라간다.
import { t } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SEARCH_FROM = 10;
let open = null; // { select, button, pop, list, items, active, query }

/** select의 지금 값 라벨 (option의 data-label이 있으면 그것) */
function labelOf(select) {
  const o = select.selectedOptions[0];
  return o ? o.dataset.label || o.textContent : '';
}

function syncButton(select) {
  const btn = select._uiButton;
  if (!btn) return;
  const o = select.selectedOptions[0];
  btn.querySelector('.uis-text').textContent = labelOf(select);
  const dot = btn.querySelector('.uis-dot');
  dot.hidden = !o?.dataset.color;
  if (o?.dataset.color) dot.style.background = o.dataset.color;
  btn.disabled = select.disabled;
}

/** 앱이 포커스를 줄 때: 바뀐 select면 보이는 버튼에, 아니면 원래 select에 */
export function focusSelect(select) {
  (select?._uiButton ?? select)?.focus();
}

/** select 하나를 바꾼다 (여러 번 불러도 한 번만) */
export function enhanceSelect(select) {
  if (!select || select._uiButton) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ui-select ${select.className}`.trim();
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = select.getAttribute('aria-label') || select.closest('label')?.textContent.trim() || '';
  if (label) btn.setAttribute('aria-label', label);
  btn.innerHTML = '<span class="uis-dot" aria-hidden="true" hidden></span><span class="uis-text"></span><svg class="ic uis-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  select.after(btn);
  select.classList.add('ui-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select._uiButton = btn;
  syncButton(select);
  new MutationObserver(() => syncButton(select)).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  select.addEventListener('change', () => syncButton(select));
  btn.addEventListener('click', () => (open?.select === select ? close() : show(select)));
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show(select);
    }
  });
}

/** root 안과 앞으로 추가되는 [data-ui-select]를 자동으로 바꾼다 */
export function watchSelects(root = document.body) {
  const run = (el) => {
    if (el.matches?.('select[data-ui-select]')) enhanceSelect(el);
    for (const s of el.querySelectorAll?.('select[data-ui-select]') ?? []) enhanceSelect(s);
  };
  run(root);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) run(n);
  }).observe(root, { childList: true, subtree: true });
}

const mobile = () => matchMedia('(max-width: 599px)').matches;

function optionHtml(o, i, current) {
  const sub = o.dataset.sub ? `<span class="uis-sub">${esc(o.dataset.sub)}</span>` : '';
  const badge = o.dataset.badge ? `<span class="uis-badge">${esc(o.dataset.badge)}</span>` : '';
  const dot = o.dataset.color ? `<span class="uis-dot" style="background:${esc(o.dataset.color)}" aria-hidden="true"></span>` : '';
  return `<li role="option" id="uis-o-${i}" data-i="${i}" aria-selected="${o.index === current}"${o.disabled ? ' aria-disabled="true"' : ''} class="${o.disabled ? 'off' : ''}">
    ${dot}<span class="uis-main">${esc(o.dataset.label || o.textContent)}</span>${sub}${badge}<svg class="ic uis-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg></li>`;
}

function show(select) {
  close(false);
  const btn = select._uiButton;
  const opts = [...select.options].filter((o) => !o.hidden && o.value !== ''); // '보낼 날 →' 같은 빈 안내 항목은 빼고
  const host = btn.closest('dialog[open]') ?? document.body;
  const pop = document.createElement('div');
  pop.className = `uis-pop${mobile() ? ' sheet' : ''}`;
  const search = opts.length > SEARCH_FROM;
  pop.innerHTML = `${mobile() ? `<div class="uis-head"><b>${esc(btn.getAttribute('aria-label') || '')}</b></div>` : ''}
    ${search ? `<input class="uis-search" type="search" placeholder="${esc(t('검색'))}" aria-label="${esc(t('검색'))}">` : ''}
    <ul class="uis-list" role="listbox" tabindex="-1" aria-label="${esc(btn.getAttribute('aria-label') || '')}"></ul>`;
  if (mobile()) {
    const shade = document.createElement('div');
    shade.className = 'uis-shade';
    shade.addEventListener('click', () => close());
    host.append(shade);
    pop._shade = shade;
  }
  host.append(pop);
  const list = pop.querySelector('.uis-list');
  open = { select, button: btn, pop, list, opts, items: opts, active: Math.max(0, opts.findIndex((o) => o.selected)), typed: '', typedAt: 0 };
  render();
  btn.setAttribute('aria-expanded', 'true');
  place();
  (pop.querySelector('.uis-search') ?? list).focus({ preventScroll: true });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li && !li.classList.contains('off')) choose(Number(li.dataset.i));
  });
  pop.addEventListener('keydown', onKey);
  pop.querySelector('.uis-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    open.items = open.opts.filter((o) => `${o.dataset.label || o.textContent} ${o.dataset.sub || ''}`.toLowerCase().includes(q));
    open.active = 0;
    render();
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  addEventListener('resize', place);
}

function render() {
  const { list, items, select, active } = open;
  list.innerHTML = items.length ? items.map((o, i) => optionHtml(o, i, select.selectedIndex)).join('') : `<li class="uis-empty">${esc(t('결과 없음'))}</li>`;
  const li = list.querySelector(`#uis-o-${active}`);
  list.setAttribute('aria-activedescendant', li ? li.id : '');
  li?.classList.add('active');
  li?.scrollIntoView({ block: 'nearest' });
}

function place() {
  if (!open || open.pop.classList.contains('sheet')) return;
  const r = open.button.getBoundingClientRect();
  const pop = open.pop;
  pop.style.minWidth = `${Math.max(200, r.width)}px`;
  const h = Math.min(pop.scrollHeight, 360);
  const below = innerHeight - r.bottom - 8 >= h || r.top < h;
  pop.style.top = `${Math.round(below ? r.bottom + 4 : r.top - h - 4)}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)))}px`;
}

function onKey(e) {
  if (!open) return;
  const n = open.items.length;
  const move = (i) => {
    open.active = Math.max(0, Math.min(n - 1, i));
    render();
  };
  if (e.key === 'ArrowDown') move(open.active + 1);
  else if (e.key === 'ArrowUp') move(open.active - 1);
  else if (e.key === 'Home') move(0);
  else if (e.key === 'End') move(n - 1);
  else if (e.key === 'Enter') {
    if (n) choose(open.active);
  } else if (e.key === 'Escape') {
    e.stopPropagation(); // 대화상자까지 닫히지 않게
    close();
  } else if (e.key === 'Tab') {
    close(); // 버튼으로 돌아간 뒤 기본 Tab 동작으로 다음(Shift+Tab이면 이전) 칸으로
    return;
  }
  else if (e.key.length === 1 && !e.target.matches('.uis-search')) {
    // 글자를 치면 그 글자로 시작하는 항목으로
    const now = Date.now();
    open.typed = (now - open.typedAt < 700 ? open.typed : '') + e.key.toLowerCase();
    open.typedAt = now;
    const i = open.items.findIndex((o) => (o.dataset.label || o.textContent).toLowerCase().startsWith(open.typed));
    if (i >= 0) move(i);
  } else return;
  e.preventDefault();
}

function choose(i) {
  const o = open.items[i];
  if (!o || o.disabled) return;
  const select = open.select;
  close();
  if (select.value === o.value) return;
  select.value = o.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function outside(e) {
  if (!open || open.pop.contains(e.target) || open.button.contains(e.target)) return;
  close(false);
}

export function closeFor(select) {
  if (open?.select === select) close(false);
}

/** 닫기 (focus: 버튼으로 포커스 돌려주기) */
export function close(focus = true) {
  if (!open) return;
  const { pop, button } = open;
  pop._shade?.remove();
  pop.remove();
  button.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  removeEventListener('resize', place);
  open = null;
  if (focus && button.isConnected) button.focus({ preventScroll: true });
}
