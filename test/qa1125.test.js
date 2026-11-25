// 2026-11-25 재점검(PART J) 회귀 테스트: I-6·J-18 보드 깨짐, J-17 동선 정리 버튼, J-19 보드 끌어 이동, J-20 준비 중 위치, J-21 지도 토글, J-22 소개 문구
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appSource } from './helpers/app-source.js';
import { MESSAGES } from '../public/lib/messages.js';
import { chrome } from '../scripts/site-copy.mjs';

const read = (p) => readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');
const css = read('styles.css');

test('I-6: 보드 타임라인은 "시간 없는 날" 규칙보다 우선해 한 칸으로 (이동 구간이 폭 0으로 줄지 않게)', () => {
  const board = css.indexOf('.layout[data-view="board"] .timeline .tl-row,');
  const noTimes = css.indexOf('.timeline.no-times .tl-row');
  assert.ok(board > 0 && noTimes > 0);
  // 보드 규칙(0,4,0)이 no-times 규칙(0,3,0)보다 구체적이어서 어느 쪽이 뒤에 있어도 이긴다
  assert.match(css, /\.layout\[data-view="board"\] \.timeline \.tl-row,\n\.layout\[data-view="board"\] \.timeline \.item:not\(\.dock-card\) \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.layout\[data-view="board"\] \.timeline \.leg-how \{ flex: 1 1 140px; min-width: 120px; \}/);
  assert.match(css, /\.leg-how \{ word-break: keep-all; \}/);
});

test('I-6·J-18: 머리는 고정 높이 없이, 칸은 화면 높이에 맞추고 칸 안에서 세로 스크롤, 줄은 줄어들지 않는다', () => {
  assert.match(css, /\.layout\[data-view="board"\] \.dc-head \.dc-title-btn \{ flex: none;/);
  assert.match(css, /max-height: max\(360px, calc\(100dvh - var\(--head\) - var\(--dock-h, 56px\) - 32px\)\)/);
  assert.match(css, /\.layout\[data-view="board"\] \.daycard > \.timeline > \*,/);
  assert.match(css, /\.day-chips \.chip\.stay \.chip-text \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  assert.match(css, /\.layout\[data-view="board"\] \.day-chips \.chips-more \{ display: none; \}/);
  const app = appSource();
  assert.match(app, /data-action="day-info"/);
  assert.match(app, /new ResizeObserver\(\(\) => document\.documentElement\.style\.setProperty\('--dock-h'/);
  assert.match(app, /const open = prefs\.dockOpen \?\? !\(narrowMq\.matches \|\| curView\(\) === 'board'\);/);
});

test('I-6·J-17: 하루 도구는 [길찾기] [동선 정리] [⋯] — 동선 정리는 늘 보이고 못 쓸 때는 aria-disabled + 이유', () => {
  const app = appSource();
  assert.match(app, /<details class="day-more"><summary/);
  assert.match(app, /return `\$\{link\}\$\{routeBtn\}<details class="day-more">/);
  assert.match(app, /aria-disabled="true" aria-label=/);
  assert.match(app, /if \(action === 'route-opt' && btn\.getAttribute\('aria-disabled'\) === 'true'\) \{\n\s+toast\(btn\.title\);/);
  assert.match(css, /\.day-more-pop \{ position: fixed;/);
});

test('J-18: 빨강은 데이터 오류(시간 겹침·항공편)만, 그 밖의 경고는 주의 색', () => {
  const app = appSource();
  assert.match(app, /const level = kind === 'order' \|\| kind === 'flight' \? 'error' : 'caution';/);
  assert.match(css, /\.day-warnings \.day-warning\.caution \{ color: color-mix\(in srgb, var\(--warn\)/);
});

test('J-19: 마우스로만 보드 끌어 이동, 카드·버튼에서 시작하면 원래 동작, 5px 미만은 클릭, ‹ › 와 ← →', () => {
  const pan = read('ui/board-pan.js');
  assert.match(pan, /e\.pointerType !== 'mouse'/);
  assert.match(pan, /if \(e\.target\.closest\(NO_PAN\)\) return;/);
  assert.match(pan, /Math\.abs\(dx\) < 5/);
  assert.match(pan, /e\.key !== 'ArrowLeft' && e\.key !== 'ArrowRight'/);
  assert.match(read('index.html'), /id="boardPrev" class="board-nav prev" hidden/);
  assert.match(read('sw.js'), /'ui\/board-pan\.js',/);
});

test('J-20: "이 도시 추천은 준비 중" 안내는 칸들의 맨 끝, 흐린 모양 + 준비 중 배지', () => {
  const app = appSource();
  assert.match(app, /daysEl\.innerHTML = \(pending \? '' : trendsHtml\) \+ lists\.map\(dayCardHtml\)\.join\(''\) \+ \(pending \? trendsHtml : ''\);/);
  assert.match(app, /class="trend-col card nearby-trends pending"/);
  assert.ok(MESSAGES['준비 중']);
});

test('J-21: 지도 토글은 아이콘 버튼 하나, 목록·보드 따로 기억, aria-pressed, M 키', () => {
  const app = appSource();
  assert.match(app, /const mapHiddenKey = \(\) => \(curView\(\) === 'board' \? 'mapHiddenBoard' : 'mapHidden'\);/);
  assert.match(app, /btn\.setAttribute\('aria-pressed', String\(!hidden\)\);/);
  assert.match(app, /if \(e\.key !== 'm' && e\.key !== 'M'\) return;/);
  assert.match(app, /setTimeout\(\(\) => map\.invalidateSize\(\), 260\);/);
  assert.match(read('index.html'), /<button id="mapToggle" type="button" class="icon map-toggle"/);
});

test('J-22: 소개·개인정보 페이지에 개인 아이디나 "저장소 관리자"가 없고 이름은 SITE_NAME에서', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    assert.doesNotMatch(chrome[lang].operator, /psyung|저장소|repository|仓库|リポジトリ/i);
    assert.match(chrome[lang].operator, /^XenoTravel/);
  }
  assert.match(readFileSync(new URL('../scripts/site-copy.mjs', import.meta.url), 'utf8'), /operator: `\$\{SITE_NAME\}/);
  assert.doesNotMatch(read('lib/privacy.js'), /psyung/);
  assert.match(read('lib/privacy.js'), /개인정보 보호책임자: XenoTravel 운영팀 · \$\{c\}/);
});
