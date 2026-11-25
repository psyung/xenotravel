// 2026-11-24 후속 점검 (docs/qa-2026-11-23.md PART I) 회귀 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFiles, dropLeadingTitle, siteStage, withSiteMeta } from '../scripts/build-site.mjs';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('editable place card keeps primary fields visible and puts secondary controls under More', () => {
  const plan = source('public/pages/plan.js');
  const item = plan.match(/function itemHtml\([\s\S]*?\n  \}/)?.[0];
  assert.ok(item);
  assert.match(item, /\$\{overlap \? timeWarnHtml\([\s\S]*?\? detailHtml\(it\)/);
  assert.equal([...item.matchAll(/<details\b/g)].length, 1);
  const layout = item.match(/<div class="editor">([\s\S]*?)<details class="editor-more"([^\n]*)\n([\s\S]*?)<\/details>/);
  assert.ok(layout);
  const [, visible, openAttribute, more] = layout;
  assert.match(openAttribute, /^\$\{editorMore === it\.id \? ' open' : ''\}>$/);
  assert.match(plan, /editorMore = \$\('\.editor-more\[open\]', daysEl\)\?\.closest\('\.item'\)\?\.dataset\.id \?\? null;/);

  function assertInOrder(html, fields) {
    let previous = -1;
    for (const field of fields) {
      const position = html.indexOf(field);
      assert.ok(position > previous, field);
      previous = position;
    }
  }
  const primary = ['data-field="time"', 'data-visited', 'data-field="memo"', 'class="addr"', 'directionsHtml(it)', 'googleMapsUrl(it)'];
  const secondary = [
    "<summary>${esc(t('더보기'))}</summary>", 'data-field="name"', 'class="cat-pick"', 'data-field="url"',
    'hoursEditorHtml(it)', 'costEditorHtml(it)', 'data-pin', 'data-action="item-up"', 'data-action="item-down"',
    'data-action="item-prev-day"', 'data-action="item-next-day"', 'class="move-to" data-ui-select',
    'data-action="place-move"', 'data-action="place-copy"', 'data-action="duplicate"', 'data-action="delete"',
  ];
  assertInOrder(visible, primary);
  assertInOrder(more, secondary);
  for (const field of primary) assert.ok(!more.includes(field), field);
  for (const field of secondary) assert.ok(!visible.includes(field), field);
});

test('type scale defines the mobile and desktop sizes in tokens.css', () => {
  const css = source('public/tokens.css');
  const definitions = (block) => Object.fromEntries(
    [...block.matchAll(/--fs-([\w-]+):\s*(\d+px);/g)].map(([, name, size]) => [name, size]),
  );
  const root = css.match(/^:root\s*\{([^}]+)\}/m)?.[1];
  const desktop = css.match(/@media \(min-width: 768px\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];
  assert.ok(root && desktop);
  assert.deepEqual(definitions(root), { xs: '11px', sm: '12px', base: '13px', md: '14px', lg: '17px', xl: '20px', display: '24px' });
  assert.deepEqual(definitions(desktop), { base: '14px', md: '16px', lg: '18px', xl: '22px', display: '30px' });
});

test('app font sizes use tokens outside the fixed glyph, mobile input, hero, and print rules', () => {
  const exceptions = {
    // Fixed glyph sizes.
    '.icon': '14px',
    '.map-day-switcher button': '22px',
    '.map-locate': '18px',
    '.stay-pin': '11px',
    '.trend-pin': '11px',
    '.rp-drag': '12px',
    '.rp-move button': '15px',
    '.drag': '12px',
    '.dock-toggle .chev': '12px',
    '.tc-plus': '28px',
    '.dp-dismiss': '23px',
    'button.td-num': '11px',
    '.members li .icon': '11px',
    '.trend-arrows .icon': '18px',
    '.ms-chev': '15px',
    '.toast-close': '20px',
    // iOS zoom prevention and fluid hero heading.
    'input, select, textarea': '16px !important',
    '.home-hero h1': 'clamp(26px, 4.4vw, 44px)',
    // Print and print preview.
    '.print-page h1': '22px',
    '.print-day h2': '16px',
    '.print-day table': '12px',
    '.hb-overview h2': '16px',
    '.hb-overview h3': '13px',
    '.hb-facts div': '12.5px',
    '.hb-table': '12px',
  };
  const css = source('public/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const actual = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, value] of body.matchAll(/\bfont(?:-size)?:\s*([^;}]*\dpx\b[^;}]*)/g)) {
      actual.push([selector.trim(), value.trim()]);
    }
  }
  assert.deepEqual(actual.sort(), Object.entries(exceptions).sort());
});

const guide = ({ slug = 'tokyo', lang = 'ko', draft = false, body = '# Tokyo\n\nHello' } = {}) =>
  ['---', 'title: Tokyo guide', 'slug: ' + slug, 'city: Tokyo', 'country: Japan', 'lang: ' + lang,
    'draft: ' + draft, 'updated: 2026-11-24', 'description: A test guide', 'sources: []', '---', body].join('\n');
const build = (options) => buildFiles({ warn: () => {}, log: () => {}, ...options });
function withGuides(files, fn) {
  const directory = mkdtempSync(join(tmpdir(), 'xenotravel-i-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
    return fn(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('I-0: SITE_STAGE defaults to preview; preview is noindex everywhere with empty sitemap and robots Disallow', () => {
  assert.equal(siteStage({}), 'preview');
  assert.equal(siteStage({ SITE_STAGE: 'production' }), 'production');
  const { output } = build();
  for (const [path, html] of output) {
    if (typeof html === 'string' && path.endsWith('.html')) assert.match(html, /<meta name="robots" content="noindex">/, path);
  }
  assert.equal(output.get('/robots.txt'), 'User-agent: *\nDisallow: /\n');
  assert.doesNotMatch(output.get('/sitemap.xml'), /<url>/);
  assert.match(withSiteMeta(source('public/index.html'), 'preview'), /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(withSiteMeta(source('public/index.html'), 'production'), /noindex/);
  const vercel = JSON.parse(source('vercel.json'));
  const rule = vercel.headers.find((h) => h.has?.[0]?.type === 'host');
  assert.ok(new RegExp('^' + rule.has[0].value + '$').test('xenotravel.vercel.app'));
  assert.deepEqual(rule.headers, [{ key: 'X-Robots-Tag', value: 'noindex' }]);
});

test('I-0 (H-2): production omits draft guides from pages, lists and sitemap', () => {
  withGuides({ 'tokyo.ko.md': guide(), 'osaka.ko.md': guide({ slug: 'osaka', draft: true }) }, (directory) => {
    const { output } = build({ directory, stage: 'production' });
    assert.ok(output.has('/ko/guides/tokyo/index.html'));
    assert.doesNotMatch(output.get('/ko/guides/tokyo/index.html'), /noindex/);
    assert.ok(![...output.keys()].some((path) => path.includes('osaka')));
    assert.doesNotMatch(output.get('/ko/guides/index.html'), /osaka/);
    assert.doesNotMatch(output.get('/sitemap.xml'), /osaka/);
    assert.match(output.get('/sitemap.xml'), /\/ko\/guides\/tokyo\//);
  });
});

test('I-0 (H-3): production fails when a published guide still has TODO(확인 필요), naming file and line', () => {
  withGuides({ 'tokyo.ko.md': guide({ body: 'ok\nTODO(확인 필요) fare' }), 'osaka.ko.md': guide({ slug: 'osaka', draft: true, body: 'TODO(확인 필요)' }) }, (directory) => {
    assert.throws(() => build({ directory, stage: 'production' }), /tokyo\.ko\.md:13/);
    assert.doesNotThrow(() => build({ directory }), 'preview stage only warns');
  });
  withGuides({ 'osaka.ko.md': guide({ slug: 'osaka', draft: true, body: 'TODO(확인 필요)' }) }, (directory) => {
    assert.doesNotThrow(() => build({ directory, stage: 'production' }), 'drafts may keep TODOs');
  });
});

test('I-0b: the body H1 is not repeated under the frontmatter title', () => {
  assert.equal(dropLeadingTitle('\n# Title\n\nText\n# Later'), '\n\n\nText\n# Later');
  assert.equal(dropLeadingTitle('<!-- note\n-->\n# Title\nText'), '<!-- note\n-->\n\nText');
  assert.equal(dropLeadingTitle('Intro\n# Not first'), 'Intro\n# Not first');
  const { output } = build();
  for (const slug of ['shanghai', 'tokyo', 'osaka', 'kyoto', 'fukuoka']) {
    const html = output.get(`/ko/guides/${slug}/index.html`);
    const first = /<h1>[\s\S]*?<\/h1>[\s\S]*?<(h2|p)[ >]/.exec(html);
    assert.equal(first[1], 'p', slug + ': body starts with text, not a repeated title');
  }
  assert.doesNotMatch(output.get('/ko/guides/shanghai/index.html'), /<h2>상하이 하루 코스 후기<\/h2>/);
});

test('I-2: static pages use tokens.css + site.css (not styles.css), one-line header, footer without menu, sticky footer', () => {
  const { output } = build();
  const html = output.get('/ko/contact/index.html');
  assert.doesNotMatch(html, /styles\.css/);
  assert.match(html, /href="\/tokens\.css"[\s\S]*href="\/site\.css"[\s\S]*src="\/site\.js"/);
  assert.match(html, /<nav id="site-menu" class="site-nav"[^>]*>[\s\S]*?<a href="\/ko\/contact\/" aria-current="page">문의<\/a>/);
  assert.match(html, /class="site-menu-btn" aria-expanded="false" aria-controls="site-menu"/);
  assert.match(html, /<a class="cta site-open" href="\/">앱 열기<\/a>/);
  assert.match(html, /data-set-lang="en"[^>]*>EN<\/a>/);
  const foot = /<footer[\s\S]*<\/footer>/.exec(html)[0];
  assert.match(foot, /© 2026 XenoTravel · <a href="mailto:xenobase\.official@gmail\.com">/);
  assert.match(foot, /\/ko\/privacy\/[\s\S]*\/ko\/terms\//);
  assert.doesNotMatch(foot, /\/ko\/about\/|\/ko\/guides\//, 'footer does not repeat the menu');
  assert.match(html, /class="site-copy" data-copy="xenobase\.official@gmail\.com" data-copied="복사했어요"/);
  assert.match(html, /예약번호나 여권 정보는 보내지 마세요/);
  const css = source('public/site.css');
  assert.match(css, /\.static-site \{\n  margin: 0; min-height: 100dvh; display: flex; flex-direction: column;/);
  assert.match(css, /\.static-site > main \{ flex: 1 0 auto;/);
  assert.match(css, /max-width: 760px;[^}]*padding: [^;]* 20px/, 'text column 720px');
  assert.doesNotMatch(source('public/styles.css'), /^:root \{/m, 'tokens live in tokens.css');
  assert.match(source('public/tokens.css'), /^:root \{/m);
  assert.match(source('public/site.js'), /xenotravel:prefs/);
  assert.match(source('public/index.html'), /href="tokens\.css"[\s\S]*href="styles\.css"/);
  assert.match(source('public/sw.js'), /'tokens\.css',/);
  assert.doesNotMatch(source('public/lib/site-config.js') + source('public/lib/privacy.js') + source('scripts/build-site.mjs'), /issues/i);
});

/* ───────── I-3: 시트 좌우로 밀어 일차 바꾸기 ───────── */
import { gestureAxis, swipeResult, dragOffset, dayIndicator, neighborDay } from '../public/map/sheet-swipe.js';

test('I-3: the first 10px decide between day swipe (horizontal) and sheet/list (vertical or diagonal-vertical)', () => {
  assert.equal(gestureAxis(6, 3), null, 'under 10px: undecided');
  assert.equal(gestureAxis(12, 4), 'x', 'horizontal');
  assert.equal(gestureAxis(3, -14), 'y', 'vertical');
  assert.equal(gestureAxis(8, 12), 'y', 'steep diagonal: vertical wins');
  assert.equal(gestureAxis(10, 12), 'x', 'shallow diagonal (under ~53°): day swipe wins');
  assert.equal(gestureAxis(-11, 10), 'x', 'diagonal, horizontal wins');
});

test('I-3: 50px or a 0.3px/ms flick changes day; left = next, right = previous; no wrap at the ends', () => {
  assert.deepEqual(swipeResult({ dx: -60, dt: 400, index: 1, count: 5 }), { target: 2, bounce: false });
  assert.deepEqual(swipeResult({ dx: 60, dt: 400, index: 1, count: 5 }), { target: 0, bounce: false });
  assert.deepEqual(swipeResult({ dx: -30, dt: 60, index: 1, count: 5 }), { target: 2, bounce: false }, 'flick 0.5px/ms');
  assert.deepEqual(swipeResult({ dx: -30, dt: 400, index: 1, count: 5 }), { target: null, bounce: false }, 'too short and slow');
  assert.deepEqual(swipeResult({ dx: 80, dt: 300, index: 0, count: 5 }), { target: null, bounce: true }, 'first day, right');
  assert.deepEqual(swipeResult({ dx: -80, dt: 300, index: 4, count: 5 }), { target: null, bounce: true }, 'last day, left');
  assert.equal(dragOffset(90, 0, 5), 30, 'rubber band at the edge');
  assert.equal(dragOffset(-90, 0, 5), -90);
});

test('I-3: from "all routes" a left swipe enters Day 1 and a right swipe the last day', () => {
  assert.equal(neighborDay(-70, -1, 5), 0);
  assert.equal(neighborDay(70, -1, 5), 4);
  assert.deepEqual(swipeResult({ dx: 70, dt: 300, index: -1, count: 5 }), { target: 4, bounce: false });
});

test('I-3: position indicator uses dots up to 8 days, then "2 / 20"; sheet head is a labelled carousel', () => {
  assert.deepEqual(dayIndicator(1, 4).dots, [false, true, false, false]);
  assert.deepEqual(dayIndicator(1, 20), { dots: null, text: '2 / 20' });
  assert.equal(dayIndicator(-1, 5).text, '');
  const html = source('public/index.html');
  assert.match(html, /<div class="ms-head" role="group" aria-roledescription="carousel">/);
  assert.match(html, /<i class="ms-chev" data-dir="prev" aria-hidden="true">‹<\/i><b id="msTitle"><\/b><i class="ms-chev" data-dir="next" aria-hidden="true">›<\/i>/);
  const map = source('public/map/map.js');
  assert.match(map, /drag\.axis \?\?= gestureAxis\(dx, dy\)/, 'handle: one gesture is either swipe or resize');
  assert.match(map, /selectDay\(target, \{ scroll: false \}\)/, 'same as the top arrows');
  assert.match(map, /reduceMotion\.matches\) return swipeSettle\(\)/);
  assert.match(map, /\$\('#mapSheet \.ms-head'\)\.setAttribute\('aria-label', focus >= 0 \? `\$\{dayName\(focus\)\} \/ \$\{total\}`/);
  assert.doesNotMatch(map.split('I-3: 시트를 좌우로')[1].split('const handle')[0], /\$\('#map'\)|map\.on\(/, 'the map itself does not change days');
  const css = source('public/styles.css');
  assert.match(css, /\.ms-list \{ touch-action: pan-y; \}/);
  assert.match(css, /transition: transform \.2s/);
  assert.match(source('public/sw.js'), /'map\/sheet-swipe\.js',/);
});

/* ───────── I-4: 모바일 밝기 버튼 ───────── */
test('I-4: the theme button stays in the mobile header (44px), the ⋯ menu item is gone, 360px collapses languages', () => {
  const html = source('public/index.html');
  const css = source('public/styles.css');
  const app = source('public/app.js');
  assert.doesNotMatch(html, /themeMenu|data-menu="theme"/);
  assert.doesNotMatch(css, /#themeBtn,[^{]*\{ display: none/);
  assert.match(css, /#themeBtn \{ width: 44px; height: 44px;/);
  assert.match(html, /id="langSwitch"[\s\S]*<select id="langSelect" data-ui-select[\s\S]*<button id="themeBtn"/, 'order: languages, then theme at the end');
  assert.match(css, /@media \(max-width: 360px\) \{\n  \.lang-switch \{ display: none; \}\n  \.lang-compact \{ display: block;/);
  assert.match(html, /<symbol id="i-sun"/);
  assert.match(app, /t\('밝은 화면으로 바꾸기'\) : t\('어두운 화면으로 바꾸기'\)/);
  assert.match(app, /btn\.setAttribute\('aria-pressed', String\(th === 'dark'\)\)/);
  assert.match(app, /th === 'dark' \? '#i-sun' : '#i-moon'/);
  assert.match(app, /withoutTransitions\(\(\) => \{\n    applyTheme\(\);\n    syncTiles\(\);/, 'map tiles follow the theme');
});

/* ───────── I-5: 상하이 코스로 일정 만들기 ───────── */
import * as Courses from '../public/lib/courses.js';
import { createTrip } from '../public/lib/model.js';
import { setLang } from '../public/lib/i18n.js';

const course = JSON.parse(source('content/guides/shanghai-course.json'));

test('I-5: a new trip gets 8 places on Day 1 in order with times and memos, and an empty inbox', () => {
  const trip = createTrip({ destination: '상하이', startDate: '2026-11-28', endDate: Courses.courseEndDate('2026-11-28', Courses.courseDays(course)) });
  assert.equal(trip.days.length, 1);
  const r = Courses.applyCourse(trip, course, { lang: 'ko' });
  assert.deepEqual(r, { placed: 8, checks: 3, firstDay: 0 });
  const items = trip.days[0].items;
  assert.deepEqual(items.map((p) => p.name), ['신천지', '예상하이', '티엔즈팡', '예원', '인민광장', '난징동루', '와이탄', 'The Fellas Terrace']);
  assert.deepEqual(items.map((p) => p.time), ['11:00', '12:00', '13:30', '15:00', '16:30', '17:00', '18:00', '19:30']);
  assert.equal(items[7].memo, '예약금 100위안(방문 시 환불, 노쇼 시 환불 없음)');
  assert.equal(trip.inbox.length, 0);
  assert.equal(trip.sourceCourse, 'shanghai');
  assert.ok(trip.checks.some((c) => c.group === 'todo' && c.text === 'The Fellas Terrace 예약(예약금 100위안)'));
  assert.equal((trip.expenses ?? []).length, 0, 'the refundable deposit is not an expense');
});

test('I-5: adding to Day 3 of an existing trip appends after that day\'s places; checklist is optional and not duplicated', () => {
  const trip = createTrip({ destination: '상하이', startDate: '2026-12-01', endDate: '2026-12-05' });
  trip.days[2].items.push({ id: 'keep', name: 'Mine', lat: 31, lng: 121 });
  Courses.applyCourse(trip, course, { startDay: 2, lang: 'ko', withChecklist: false });
  assert.equal(trip.days[2].items[0].id, 'keep');
  assert.equal(trip.days[2].items.length, 9);
  assert.ok(!(trip.checks ?? []).some((c) => /Fellas/.test(c.text)));
  Courses.applyCourse(trip, course, { startDay: 2, lang: 'ko' });
  const again = Courses.applyCourse(trip, course, { startDay: 2, lang: 'ko' });
  assert.equal(again.checks, 0, 'same to-dos are not added twice');
});

test('I-5: past dates work, Saturday default, duplicates are detected, Shanghai trips first', () => {
  const past = createTrip({ startDate: '2025-10-04', endDate: Courses.courseEndDate('2025-10-04', 1) });
  assert.equal(Courses.applyCourse(past, course, { lang: 'ko' }).placed, 8);
  assert.equal(Courses.nextSaturday('2026-11-24'), '2026-11-28');
  assert.equal(Courses.nextSaturday('2026-11-28'), '2026-12-05');
  const other = { ...createTrip({ destination: 'Tokyo', startDate: '2026-12-01', endDate: '2026-12-02' }), updatedAt: '2026-11-30' };
  const sh = { ...createTrip({ destination: '상하이', startDate: '2026-12-01', endDate: '2026-12-02' }), updatedAt: '2026-11-01' };
  assert.deepEqual(Courses.courseTrips([other, past], 'shanghai').map((tr) => tr.id), [past.id]);
  assert.equal(Courses.tripChoices([other, sh], ['상하이', 'Shanghai', '上海'])[0].id, sh.id);
});

test('I-5: EN/ZH/JA screens get memos and names in that language', () => {
  for (const [lang, memo, name] of [['en', 'Best for photos in the morning', 'The Bund'], ['zh', '上午去最适合拍照', '外滩'], ['ja', '午前中が写真を撮りやすいです', '外灘']]) {
    setLang(lang);
    const trip = createTrip({ startDate: '2026-12-05', endDate: '2026-12-05' });
    Courses.applyCourse(trip, course, { lang });
    assert.equal(trip.days[0].items[0].memo, memo, lang);
    assert.equal(trip.days[0].items[6].name, name, lang);
    assert.equal(trip.days[0].items[6].nameI18n.ko, '와이탄');
  }
  setLang('ko');
});

test('I-5: the app always asks before saving, offers open/another for duplicates, and the button says "이 코스로 일정 만들기"', () => {
  const app = source('public/app.js');
  const fn = app.slice(app.indexOf('async function importCourse('), app.indexOf('function homeGuides('));
  assert.ok(fn.indexOf("ask({ title, html, actions: [{ value: 'create'") < fn.indexOf('createTripFrom('), 'confirm before create');
  assert.match(fn, /if \(await answer !== 'create'\) return;/);
  assert.match(fn, /t\('그 여행 열기'\)[\s\S]*t\('하나 더 만들기'\)/);
  assert.doesNotMatch(fn, /inbox/);
  const { output } = build();
  assert.match(output.get('/ko/guides/shanghai/index.html'), />이 코스로 일정 만들기</);
});

/* ───────── 2026-11-24 실기기 피드백 ───────── */
import { fitMovedTime } from '../public/lib/model.js';

test('moving a timed place fits its time between the new neighbours (or clears it), with undo', () => {
  const day = (times) => times.map((time, i) => ({ id: 'p' + i, name: 'P' + i, time }));
  // 예원 15:00을 와이탄 18:00 뒤, Fellas 19:30 앞으로 → 18:30
  let items = day(['17:00', '18:00', '15:00', '19:30']);
  assert.deepEqual(fitMovedTime(items, 2), { from: '15:00', to: '18:30' });
  assert.equal(items[2].time, '18:30');
  // 앞 + 30분이 다음과 겹치면 가운데
  items = day(['18:00', '15:00', '18:20']);
  assert.deepEqual(fitMovedTime(items, 1), { from: '15:00', to: '18:10' });
  // 맨 앞으로 옮기면 다음 - 30분
  items = day(['20:00', '11:00']);
  assert.deepEqual(fitMovedTime([items[0], items[1]].reverse().reverse(), 0), { from: '20:00', to: '10:30' });
  // 자리가 없으면 비운다
  items = day(['18:00', '09:00', '18:00']);
  assert.deepEqual(fitMovedTime(items, 1), { from: '09:00', to: '' });
  // 순서가 맞거나 시간이 없으면 그대로
  assert.equal(fitMovedTime(day(['10:00', '12:00', '14:00']), 1), null);
  assert.equal(fitMovedTime(day(['10:00', '', '14:00']), 1), null);
  const plan = source('public/pages/plan.js');
  assert.match(plan, /const fit = index >= 0 \? M\.fitMovedTime\(day\.items, index\) : null;/);
  assert.match(plan, /pushUndo\(fit\.to \?/);
});

test('toast ✕, cover picker without the native file button, timeline spacing, aligned day tools', () => {
  assert.match(source('public/ui/toast.js'), /x\.className = 'toast-close';[\s\S]*x\.addEventListener\('click', hide/);
  const html = source('public/index.html');
  assert.match(html, /<label class="cover-drop" id="coverDrop">\s*<input id="coverFile" class="cover-file" type="file"/);
  const css = source('public/styles.css');
  assert.match(css, /\.cover-file \{ position: absolute; width: 1px; height: 1px; opacity: 0;/);
  assert.match(css, /\.p3-form label:not\(\.p3-check\):not\(\.cover-drop\) \{ display: grid;/);
  assert.match(css, /\.tl-time \{ font-size: var\(--fs-xs\); padding-right: 8px; \}/);
  assert.match(css, /\.day-tools \{ display: flex; gap: 2px; flex-wrap: wrap; align-items: center;/);
  assert.match(css, /\.timeline\.no-times \.tl-row/);
});

test('mobile Select sheet spans the full width (it was capped at 100vw - 16px and hugged the left edge)', () => {
  assert.match(source('public/styles.css'), /\.uis-pop\.sheet \{ left: 0; right: 0; bottom: 0; top: auto; width: 100%; max-width: none; min-width: 0 !important;/);
});

test('large text (Samsung Internet) cannot push the place editor or page sideways; toast text is one block', () => {
  const css = source('public/styles.css');
  assert.match(css, /\.editor \{ padding: 2px 12px 12px 34px; display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.editor input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), \.editor textarea, \.editor select \{ width: 100%; min-width: 0;/);
  assert.doesNotMatch(css, /grid-template-columns: (40px|38px|0) 1fr/);
  assert.match(css, /html, body \{ overflow-x: clip; \}/);
  assert.match(css, /width: max-content; max-width: min\(440px, calc\(100vw - 32px\)\);/);
  assert.match(source('public/ui/toast.js'), /msg\.className = 'toast-text';/);
});

test('design consistency: primary add is blue, two-way switches are segmented, filled inputs, one-line base currency', () => {
  const css = source('public/styles.css');
  assert.match(css, /\.addrow button \{ flex: none; border: 0; background: var\(--cta\); color: var\(--cta-text\);/);
  assert.match(css, /\.trend-tabs \{ display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var\(--soft\); \}/);
  assert.match(css, /\.base-row label > span \{ white-space: nowrap;/);
  assert.match(css, /\.editor input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), \.editor textarea, \.editor select \{ border-color: transparent; background: var\(--soft\);/);
});

test('one selection rule: segmented switches are white on a grey track, toggles and pick-one chips are dark chips', () => {
  const css = source('public/styles.css');
  const rule = css.slice(css.indexOf('선택 표시 규칙'));
  for (const sel of ['.seg button.active', '.mtabs button.active', '.trend-tabs [aria-selected="true"]', '.pnav .pg.on', '.pin-seg button.active[data-pin]', '.check-tabs button[aria-pressed="true"]']) {
    assert.ok(rule.includes(sel), sel);
  }
  assert.match(rule, /background: var\(--paper\); color: var\(--ink\); border-color: transparent;/);
  assert.doesNotMatch(rule, /data-stay-suggestions/); // J-3: 숙소 추천 위치 토글 삭제
  assert.match(rule, /\.pill\.active \{ background: var\(--ink\);/);
});
