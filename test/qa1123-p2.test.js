// docs/qa-2026-11-23.md Phase 2 (P1) 회귀 테스트
import test from 'node:test';
import { appSource } from './helpers/app-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../public/lib/model.js';

const pub = new URL('../public/', import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), 'utf8');

test('P1-3: 767px 이하는 목록만 (보드 전환 숨김), 저장값은 덮어쓰지 않는다', () => {
  const app = appSource();
  assert.match(app, /const narrowMq = matchMedia\('\(max-width: 767px\)'\);/);
  assert.match(app, /return narrowMq\.matches \? 'list' : prefs\.view;/);
  assert.match(read('styles.css'), /@media \(max-width: 767px\) \{ \.seg:has\(\[data-view="board"\]\) \{ display: none; \} \}/);
});

test('P1-6: 숙소가 빈 밤은 범위로 묶는다', () => {
  assert.equal(M.dayRanges([2, 3, 4, 5, 18, 20, 21]), 'Day 3–Day 6, Day 19, Day 21, Day 22');
  const t = M.createTrip({ title: 'J', startDate: '2026-11-23', endDate: '2026-12-12' });
  M.addStay(t, { name: 'H', lat: 30, lng: 120 }, 0, 2);
  const n = M.tripNotices(t).join(' ');
  assert.match(n, /Day 3–Day 19 밤 숙소 미정 \(17박\)/);
});

test('P1-8: 맨 위로/맨 아래로 — 600px 넘게 내리면 보이고, 아래 고정 요소 위에, 인쇄 때 숨김, 4개 국어 라벨', () => {
  const html = read('index.html');
  assert.match(html, /data-fab="top" data-i18n-attr="aria-label=맨 위로/);
  assert.match(html, /data-fab="bottom" data-i18n-attr="aria-label=맨 아래로/);
  const app = appSource();
  assert.match(app, /const scrolled = scrollY > 600;/);
  assert.match(app, /const FAB_BELOW = '\.pagebar, \.inbox-dock, \.map-sheet, #toast\.show';/);
  assert.match(read('styles.css'), /@media print \{ \.scroll-fab \{ display: none !important; \} \}/);
});

test('P1-4: 터치에서는 길게 눌러야 끌기 — 좌우 스와이프는 스크롤, 카드 단위 스냅, 데스크톱 화살표', () => {
  const app = appSource();
  assert.ok([...app.matchAll(/delay: 250,\n\s+delayOnTouchOnly: true,/g)].length >= 2, '트렌드 목록과 일정·보관함 목록');
  assert.match(app, /data-action="trend-scroll"/);
  const css = read('styles.css');
  assert.match(css, /\.trend-list \{ scroll-snap-type: x mandatory;/);
  assert.match(css, /\.trend-card \{ flex: 0 0 min\(236px, 80%\); scroll-snap-align: start; \}/);
  assert.match(css, /@media \(hover: none\) \{ \.trend-arrows \{ display: none; \} \}/);
});

test('P1-5: 보관함은 이름만 있는 칩 — 모바일 기본 접힘, 2줄까지, 누르면 액션 시트', () => {
  const app = appSource();
  assert.match(app, /const open = prefs\.dockOpen \?\? !narrowMq\.matches;/);
  assert.match(app, /class="chip-btn" data-action="chip-menu"/);
  assert.doesNotMatch(app, /dock-hint/, '설명 문구 없음');
  assert.match(app, /async function openChipMenu\(id\)/);
  const css = read('styles.css');
  assert.match(css, /\.dock-items\.dock-chips \{[^}]*max-height: calc\(2 \* 34px \+ 6px\);/);
  assert.match(css, /\.dock-chip \.chip-btn \{[^}]*height: 34px; max-width: 160px;/);
});

test('패치 회귀 방지: 여러 요소를 도는 코드는 $$()를 쓴다 ($()는 요소 하나)', () => {
  const app = appSource();
  assert.doesNotMatch(app, /for \(const \w+ of \$\(/);
  assert.doesNotMatch(app, /\[\.\.\.\$\('[^']*'\)\]/);
});

test('P1-7: 스크롤하면 검색창이 머리 바 아래 얇은 고정 바로, 일차 탭은 그 아래(--search), 데스크톱은 목록에서도 지도 접기', () => {
  const app = appSource();
  assert.match(app, /function setSearchCompact\(on\)/);
  assert.match(app, /document\.documentElement\.style\.setProperty\('--search', on \? '52px' : '0px'\);/);
  assert.match(app, /layout\.classList\.toggle\('map-hidden', !narrowMq\.matches && prefs\.mapHidden\);/);
  const css = read('styles.css');
  assert.match(css, /\.search\.card\.compact \{ position: fixed;/);
  assert.match(css, /\.daytabs \{ top: calc\(var\(--head\) \+ var\(--offbar, 0px\) \+ var\(--savebar, 0px\) \+ var\(--search, 0px\)\); \}/);
  assert.match(read('index.html'), /data-mini-tab="map"/);
});

import { normalizeTime } from '../public/lib/timefield.js';

test('P1-1: TimeField — 직접 입력 "2045"·"20:45"·"9:5", 빈 값, 잘못된 값', () => {
  assert.equal(normalizeTime('2045'), '20:45');
  assert.equal(normalizeTime('20:45'), '20:45');
  assert.equal(normalizeTime('9:5'), '09:05');
  assert.equal(normalizeTime('905'), '09:05');
  assert.equal(normalizeTime(''), '');
  assert.equal(normalizeTime('24:00'), null);
  assert.equal(normalizeTime('abc'), null);
  const tf = read('lib/timefield.js');
  for (const opt of ['noCalendar: true', 'time_24hr: true', 'minuteIncrement: 5', 'disableMobile: true', 'allowInput: true']) assert.ok(tf.includes(opt), opt);
  assert.match(read('lib/datepicker.js'), /enhanceTime\(time\);/, '항공편 시각');
  assert.match(appSource(), /enhanceTimes\(daysEl\);/, '장소 시간');
  assert.match(read('index.html'), /<script src="vendor\/flatpickr\/flatpickr\.min\.js"><\/script>/);
});

test('P1-2: 공용 Select — 팝오버/바텀시트, 10개 넘으면 검색, 키보드, 일차 항목 색 점·날짜·장소 수·오늘 배지', () => {
  const sel = read('lib/select.js');
  assert.match(sel, /const SEARCH_FROM = 10;/);
  assert.match(sel, /role="listbox"/);
  assert.match(sel, /role="option"/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End']) assert.ok(sel.includes(`'${key}'`), key);
  assert.match(sel, /button\.focus\(\{ preventScroll: true \}\)/, '닫으면 버튼으로 포커스');
  assert.match(sel, /matchMedia\('\(max-width: 599px\)'\)/, '모바일은 바텀시트');
  const app = appSource();
  assert.match(app, /watchSelects\(document\.body\);/);
  assert.match(app, /data-color="\$\{dayColor\(i\)\}" data-label="\$\{esc\(dayName\(i\)\)\}" data-sub=/);
  for (const id of ['#target', 'move-to', 'chipMoveTo', 'bCurrency', 'bDay', 'bBase']) {
    const src = id === '#target' ? read('index.html') : app;
    assert.match(src, new RegExp(`${id.replace('#', 'id="')}[^>]*data-ui-select|data-ui-select[^>]*${id.replace('#', '')}`), id);
  }
});

test('Phase 2 교차 리뷰: 시간 초안 미저장 · Tab 이동 · 공유 칩 지도 · 숨긴 지도 펼치기 · 검색 중 추가 대상 표시 · 포커스 · flatpickr 정리', () => {
  const app = appSource();
  assert.ok(app.includes(String.raw`if (field === 'time' && e.target.classList.contains('time-field') && !/^(\d{2}:\d{2})?$/.test(e.target.value)) return;`));
  assert.match(read('lib/select.js'), /\} else if \(e\.key === 'Tab'\) \{\n\s+close\(\);[^\n]*\n\s+return;/);
  assert.match(app, /if \(ui\.readonly\) return locateMapPlace\(found\.item\);/);
  assert.match(app, /if \(prefs\.mapHidden && !narrowMq\.matches\) \{/);
  assert.match(read('styles.css'), /\.search\.card\.compact:not\(:focus-within\):not\(:has\(\.results li\)\) \.target-row/);
  assert.match(app, /focusSelect\(\$\('#bConfirmCur'\)\);/);
  assert.match(app, /destroyTimes\(daysEl\);/);
  assert.match(app, /if \(keep\) \$\(/, 'Tab으로 옮긴 포커스를 빼앗지 않는다');
});
