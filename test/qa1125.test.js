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

test('J-4: 오늘 카드는 체크아웃하는 숙소를 "오늘 밤 숙소"로 보여 주지 않는다', async () => {
  const M = await import('../public/lib/model.js');
  const trip = M.createTrip({ startDate: '2026-11-23', endDate: '2026-12-02' });
  const hotel = { name: 'Hyatt Place', lat: 30.75, lng: 120.75 };
  M.addStay(trip, hotel, 0, 2); // 11/23~11/25 체크아웃
  M.addStay(trip, { ...hotel, name: 'Next Hotel' }, 4, 2);
  let p = M.todayPlan(trip, '2026-11-25', '10:00'); // Day 3: 체크아웃만
  assert.equal(p.checkOut.name, 'Hyatt Place');
  assert.equal(p.tonight, null);
  p = M.todayPlan(trip, '2026-11-24', '10:00'); // Day 2: 계속 묵음
  assert.equal(p.tonight.name, 'Hyatt Place');
  assert.equal(p.checkOut, null);
  p = M.todayPlan(trip, '2026-11-27', '10:00'); // Day 5: 체크인
  assert.equal(p.tonight.name, 'Next Hotel');
  assert.equal(p.checkOut, null);
  M.addStay(trip, { ...hotel, name: 'Third' }, 6, 1);
  p = M.todayPlan(trip, '2026-11-29', '10:00'); // Day 7: 숙소 이동 — 둘 다
  assert.equal(p.checkOut.name, 'Next Hotel');
  assert.equal(p.tonight.name, 'Third');
  const app = appSource();
  assert.match(app, /p\.checkOut \? stayBox\(t\('체크아웃'\), p\.checkOut\)/);
  assert.match(app, /t\('오늘 밤 숙소를 아직 정하지 않았어요'\)/);
});

test('J-10·J-16: 구간 수단 — 자동 판별(1.5km 도보 · 30km 미만 기본 수단 · 30km 이상 수단 미정), 사용자 값 우선, 야간열차', async () => {
  const S = await import('../public/lib/segments.js');
  const M = await import('../public/lib/model.js');
  const { checkDay } = await import('../public/lib/route-check.js');
  const trip = M.createTrip({ startDate: '2026-12-26', endDate: '2026-12-27' });
  const day = trip.days[0].id;
  const jx = M.addItem(trip, day, { name: '嘉兴南站', lat: 30.70, lng: 120.75 });
  const near = M.addItem(trip, day, { name: 'Café', lat: 30.705, lng: 120.755 }); // 약 0.7km
  const hz = M.addItem(trip, day, { name: '杭州东站', lat: 30.29, lng: 120.21 }); // 약 70km
  const lake = M.addItem(trip, day, { name: '西湖', lat: 30.25, lng: 120.15 }); // 약 7km
  const km = (a, b) => M.distanceKm(a, b);
  assert.equal(S.legPlan(trip, jx, near, km(jx, near)).mode, 'walking');
  assert.equal(S.legPlan(trip, hz, lake, km(hz, lake)).mode, 'transit');
  assert.equal(S.legPlan(trip, hz, lake, km(hz, lake), 'driving').mode, 'driving');
  const long = S.legPlan(trip, near, hz, km(near, hz));
  assert.ok(long.long && long.minutes == null);
  assert.equal(S.legPlan(trip, jx, hz, km(jx, hz)).station, true); // 역 ↔ 역이면 고속철 제안
  let day1 = checkDay(trip, 0);
  assert.equal(day1.longLegs, 1);
  // 고속철 25분 + 여유 15분 지정
  S.setSegment(trip, near, hz, { mode: 'rail', dep: '09:30', arr: '09:55', trainNo: 'G7512', buffer: 15 });
  assert.deepEqual(trip.segments[`${near.id}>${hz.id}`], { mode: 'rail', minutes: 25, trainNo: 'G7512', dep: '09:30', arr: '09:55', buffer: 15 });
  day1 = checkDay(trip, 0);
  assert.equal(day1.longLegs, 0);
  assert.equal(day1.byMode.rail, 40);
  assert.ok(!day1.warnings.some((w) => w.kind === 'movement'));
  // 야간열차: 도착이 다음 날
  assert.equal(S.spanMinutes('22:10', '06:40'), 510);
  // 직접 입력은 분이 있어야, 모르는 수단은 버린다
  assert.equal(S.cleanSegment({ mode: 'custom' }), null);
  assert.equal(S.cleanSegment({ mode: 'boat', minutes: 10 }), null);
  // 자동으로 되돌리기
  S.setSegment(trip, near, hz, null);
  assert.equal(trip.segments[`${near.id}>${hz.id}`], undefined);
  // 순서가 바뀌어도 설정은 남고, 없는 장소를 가리키는 설정은 불러올 때 버린다
  S.setSegment(trip, hz, lake, { mode: 'driving' });
  M.moveItem(trip, lake.id, day, 0);
  const saved = M.validateTrip(JSON.parse(JSON.stringify({ ...trip, segments: { ...trip.segments, 'gone>x': { mode: 'walking' } } })));
  assert.deepEqual(Object.keys(saved.segments), [`${hz.id}>${lake.id}`]);
  // 예전 백업(segments 없음)도 열린다
  const { segments, ...old } = JSON.parse(JSON.stringify(trip));
  assert.deepEqual(M.validateTrip(old).segments, {});
});

test('J-10: 공유 링크에도 구간 수단이 자리 기준으로 실려 새 id에 다시 붙는다', async () => {
  const S = await import('../public/lib/segments.js');
  const M = await import('../public/lib/model.js');
  const { encodeShare, decodeShare } = await import('../public/lib/share.js');
  const trip = M.createTrip({ title: 'share', startDate: '2026-12-26', endDate: '2026-12-26' });
  const a = M.addItem(trip, trip.days[0].id, { name: 'A站', lat: 30.70, lng: 120.75 });
  const b = M.addItem(trip, trip.days[0].id, { name: 'B站', lat: 30.29, lng: 120.21 });
  S.setSegment(trip, a, b, { mode: 'rail', minutes: 25 });
  const copy = await decodeShare(await encodeShare(trip));
  const [ca, cb] = copy.days[0].items;
  assert.notEqual(ca.id, a.id);
  assert.deepEqual(copy.segments[`${ca.id}>${cb.id}`], { mode: 'rail', minutes: 25 });
});

test('J-12: 지도 "기본/회색" 전환을 없애고 예전 설정이 남아 있어도 컬러 지도', () => {
  const app = appSource();
  assert.doesNotMatch(app, /map-style-control|World_Light_Gray|prefs\.mapStyle = /);
  assert.match(app, /const mapTileKind = \(\) => \(isDark\(\) \? 'dark' : 'street'\);/);
  assert.ok(!MESSAGES['회색'] && !MESSAGES['지도 스타일']);
  assert.doesNotMatch(css, /map-style-control/);
});

test('J-13: 핀 ↔ 목록 연동 — 핀은 확대·목록 강조, 목록은 보이는 지도에서만 핀 강조, 빈 지도·Esc·전체 동선은 해제, 겹친 핀은 벌린다', () => {
  const app = appSource();
  assert.match(app, /flyToPlace\(item\);\n\s+markListActive\(item\.id, \{ scroll: true \}\);/);
  assert.match(app, /const zoom = Math\.max\(map\.getZoom\(\), 16\);/);
  assert.match(app, /if \(!mapShown\) return;/);
  assert.match(app, /map\.on\('click', \(\) => \{\n\s+if \(!ui\.picking\) clearMapActive\(\);/);
  assert.match(app, /function showAllRoutes\(\) \{\s*clearMapActive\(\);/);
  assert.match(app, /ctx\.focusMapPlace\?\.\(id\);/);
  assert.match(app, /iconAnchor: \[14 - nudge, 14\]/);
  assert.match(css, /\.item\.map-active > \.tl-box \{ box-shadow: 0 0 0 2px var\(--accent\);/);
});

test('J-14: PDF 표는 열 너비 고정(번호 8mm · 시간 16mm · 장소 40%), 숙소는 번호 없는 한 줄', () => {
  const app = appSource();
  assert.match(app, /<colgroup><col class="c-n"><col class="c-t"><col class="c-place"><col class="c-memo"><\/colgroup>/);
  assert.match(app, /<tr class="stay"><td colspan="4"><span class="stay-label">🏨/);
  assert.doesNotMatch(app, /t\('숙'\)|t\('항'\)/);
  assert.match(css, /\.print-day col\.c-n \{ width: 8mm; \}\n\.print-day col\.c-t \{ width: 16mm; \}\n\.print-day col\.c-place \{ width: 40%; \}/);
});

test('J-2: 기간 표기는 formatRange 하나로 — 한국어 " ~ ", 일본어 "〜", 중국어·영어 "–", 같은 날은 하나', async () => {
  const I = await import('../public/lib/i18n.js');
  const M = await import('../public/lib/model.js');
  const cases = { ko: '12/25 ~ 12/28', en: '12/25–12/28', zh: '12/25–12/28', ja: '12/25〜12/28' };
  for (const [lang, want] of Object.entries(cases)) {
    I.setLang(lang);
    assert.equal(I.formatRange('12/25', '12/28'), want);
    assert.equal(I.formatRange('11/28', '11/28'), '11/28');
    assert.equal(I.formatRange(I.shortDate('2026-12-28'), I.shortDate('2027-01-03')), lang === 'ko' ? '12/28 ~ 1/3' : lang === 'ja' ? '12/28〜1/3' : '12/28–1/3');
  }
  I.setLang('ko');
  assert.equal(M.dayRanges([2, 3, 4, 5]), 'Day 3 ~ Day 6');
  const app = appSource();
  assert.doesNotMatch(app, /\$\{[^}]*\}\s?[–~]\s?\$\{/, '범위 기호를 직접 붙이는 코드가 남아 있으면 안 된다');
});

test('J-1: 여행 카드 커버는 D-day 하나, 도시는 제목에 없을 때만 정보 줄에, 커버 바꾸기·삭제는 ⋯ 메뉴', async () => {
  const { destinationNames } = await import('../public/lib/destinations.js');
  const names = destinationNames('도쿄');
  for (const n of ['도쿄', 'Tokyo', '东京', '東京']) assert.ok(names.includes(n), n);
  const app = appSource();
  assert.doesNotMatch(app, /class="tc-dest"|class="btn tc-edit-cover"|class="icon tc-del"/);
  assert.match(app, /const city = tr\.destination && !destinationNames\(tr\.destination\)\.some\(\(name\) => title\.includes\(name\)\)/);
  assert.match(app, /<details class="tc-more">/);
  assert.match(css, /\.tc-body b \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.tc-body small \{[^}]*-webkit-line-clamp: 2;/);
});

test('J-7~J-9: 소개 카드는 hover만, 트렌드·가이드 카드는 카드 전체가 링크, 공용 hover는 (hover: hover)에서만', () => {
  const app = appSource();
  assert.doesNotMatch(app, /data-feature|openHomeFeature/);
  assert.match(app, /<li class="card-hover card-link"><span class="tc-badge s-\$\{esc\(p\.status\)\}">/);
  assert.match(app, /<b><a href="\$\{esc\(trendHref\(p\.id\)\)\}">/);
  assert.match(app, /guide\.experience \? `<span class="tc-badge">\$\{esc\(t\('직접 다녀온 후기'\)\)\}<\/span>`/);
  assert.match(app, /const trendCard = !btn && !e\.target\.closest\('a, button, input, select, textarea'\) && e\.target\.closest\('\.trend-card\[data-href\]'\);/);
  assert.match(css, /@media \(hover: hover\) \{\n  \.card-hover:hover \{ border-color: var\(--accent\); transform: translateY\(-2px\);/);
  assert.match(css, /\.feats li \{[^}]*cursor: default;/);
});

test('J-8: 트렌드 설명 페이지 — 주소 규칙, 번역 없는 언어는 만들지 않음, 300자 미만은 noindex·사이트맵 제외, 담기는 앱으로', async () => {
  const P = await import('../public/lib/trend-page.js');
  const { buildFiles } = await import('../scripts/build-site.mjs');
  const city = { id: 'tokyo' };
  assert.equal(P.trendPath('ko', city, { id: 'tokyo-pokepark-kanto' }), '/ko/trends/tokyo/pokepark-kanto/');
  assert.equal(P.hasTrendLanguage({ id: 'x' }, 'en', { places: {} }), false);
  assert.equal(P.hasTrendLanguage({ id: 'x' }, 'ko', null), true);
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  // 가이드 없이 production으로 빌드 (공개 가이드의 TODO 때문에 멈추지 않게) — 트렌드 페이지 규칙만 본다
  const { output } = buildFiles({ directory: mkdtempSync(join(tmpdir(), 'xt-guides-')), stage: 'production', warn: () => {}, log: () => {} });
  const html = output.get('/ko/trends/tokyo/pokepark-kanto/index.html');
  assert.ok(html, 'page exists');
  assert.match(html, /<meta name="robots" content="noindex">/); // 설명이 300자 미만
  assert.match(html, /href="\/#\/\?trend=tokyo-pokepark-kanto"/);
  assert.match(html, /data-trend-back/);
  assert.doesNotMatch(output.get('/sitemap.xml'), /\/trends\//);
  assert.ok(!output.has('/en/trends/tokyo/landmark-sensoji/index.html'), '번역 없는 언어는 한국어로 대신 만들지 않는다');
  const app = appSource();
  assert.match(app, /const trendId = params\.get\('trend'\);\n\s+if \(trendId\) void importTrend\(trendId, location\.hash\);/);
  assert.match(app, /await trendsReady;/);
});

test('J-5: 가이드 본문 ## → h2, ### → h3 (h2를 건너뛰지 않는다)', async () => {
  const { renderMarkdown } = await import('../scripts/guide-markdown.mjs');
  const html = renderMarkdown('## 언제 가면 좋을까\n\n본문\n\n### 봄\n\n# 실수로 쓴 큰 제목', { imageInfo: () => null, warn: () => {} }).join('\n');
  assert.match(html, /<h2>언제 가면 좋을까<\/h2>/);
  assert.match(html, /<h3>봄<\/h3>/);
  assert.match(html, /<h2>실수로 쓴 큰 제목<\/h2>/);
  assert.doesNotMatch(html, /<h1>/);
});

test('J-6: 코스 불러오기 날짜는 공용 달력(날짜 하나, 지난 날짜 가능)', () => {
  const app = appSource();
  assert.match(app, /id="courseDate" data-dp-single/);
  assert.match(app, /enhanceDates\(body\); \/\/ J-6/);
  const dp = read('lib/datepicker.js');
  assert.match(dp, /root\.querySelectorAll\('input\[type="date"\]\[data-dp-single\]'\)\.forEach\(enhanceSingle\);/);
  assert.doesNotMatch(dp.match(/function enhanceSingle[\s\S]*?\n\}/)[0], /min/);
});

test('K-1: 버튼은 네 종류 × 크기 토큰 (md 40 · sm 32 · 모서리 10 · 칩 999)', () => {
  const tokens = read('tokens.css');
  for (const t of ['--r-btn: 10px', '--r-chip: 999px', '--r-card: 16px', '--r-modal: 20px', '--h-sm: 32px', '--h-md: 40px', '--h-lg: 48px', '--tap: 44px']) assert.ok(tokens.includes(t), t);
  assert.match(css, /:is\(\.btn, \.pill,[^{]*\) \{\n  height: var\(--h-md\); min-height: var\(--h-md\); border-radius: var\(--r-btn\);/);
  assert.match(css, /\.icon \{ width: var\(--h-sm\); height: var\(--h-sm\);/);
  assert.match(css, /:is\(\.daytab, \.city-tabs button, \.dest-chips button, \.leg-rail\) \{ height: var\(--h-sm\); min-height: var\(--h-sm\); border-radius: var\(--r-chip\);/);
});

test('K-2: 모바일 터치 영역 44px — 작은 버튼은 보이지 않는 ::after로, 체크박스는 줄 전체, 글자 칸은 44px 높이', () => {
  const block = css.slice(css.indexOf('/* ───────── K-2: 터치 영역 44×44 ─────────'));
  assert.match(block, /@media \(pointer: coarse\), \(max-width: 767px\)/);
  assert.match(block, /width: max\(100%, var\(--tap\)\); height: max\(100%, var\(--tap\)\); transform: translate\(-50%, -50%\);/);
  for (const sel of ['.icon', '.daytab', '.leg-go', '.lang-switch button', '.item-main', '.chipset button', '.site-foot a']) assert.ok(block.includes(sel), sel);
  assert.match(block, /label:has\(> input:is\(\[type="checkbox"\], \[type="radio"\]\)\) \{ min-height: var\(--tap\);/);
  assert.match(block, /select, \.addrow button \{ min-height: var\(--tap\); \}/);
});

test('K-1: 카드 16 · 창 20 · 칩 999 모서리 토큰', () => {
  assert.match(css, /:is\(\.card, \.box, \.tc-open, \.insp li, \.feats li, \.trend-card, \.item \.tl-box, \.inbox-dock\) \{ border-radius: var\(--r-card\); \}/);
  assert.match(css, /dialog \{ border-radius: var\(--r-modal\); \}/);
  assert.match(css, /:is\(\.chip, \.cat-tag, \.stay-tag, \.tc-badge, \.soon-badge, \.trend-badge, \.count-badge\) \{ border-radius: var\(--r-chip\); \}/);
  assert.doesNotMatch(css, /border-radius: (22|18)px (22|18)px 0 0/);
});
