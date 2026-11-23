import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adsText, buildFiles, parseGuide, withSiteMeta } from '../scripts/build-site.mjs';
import { renderMarkdown } from '../scripts/guide-markdown.mjs';
import { adSlot } from '../public/lib/ads.js';
import { destinationById } from '../public/lib/destinations.js';
import { detectLang, setLang, t } from '../public/lib/i18n.js';
import { createItem, createTrip } from '../public/lib/model.js';
import { privacySections, renderPrivacySections } from '../public/lib/privacy.js';
import { SITE_ORIGIN } from '../public/lib/site-config.js';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixtures = ({ slug = 'tokyo', lang = 'ko', draft = false, body = 'Hello' } = {}) =>
  ['---', 'title: Test <guide>', 'slug: ' + slug, 'city: Tokyo', 'country: Japan', 'lang: ' + lang,
    'draft: ' + draft, 'updated: 2026-11-23', 'description: A test guide', 'sources: []', '---', body].join('\n');
const build = (options = {}) => buildFiles({ warn: () => {}, log: () => {}, ...options });

test('H-1: Markdown renders structure and escapes raw HTML, alt text and unsafe links', () => {
  const warnings = [];
  const html = renderMarkdown([
    '# City',
    'A **bold** and *italic* [link](https://example.org/) <script>bad</script> [bad](javascript:alert)',
    '',
    '> A quote',
    '',
    '1. A numbered item',
    '   - Nested',
    '',
    '| A | B |', '| --- | --- |', '| C | D |',
    '',
    '!["photo" & more](/guide-images/photo.jpg)', '*A [source](https://example.org/)*',
    '![](/guide-images/dindin-youtube-capture.jpg)', '*A caption*',
    '<!-- hidden -->',
  ].join('\n'), { imageInfo: () => ({ width: 100, height: 200 }), warn: (...args) => warnings.push(args) }).join('\n');
  assert.match(html, /<h2>City<\/h2>/);
  assert.match(html, /<strong>bold<\/strong> and <em>italic<\/em> <a href="https:\/\/example.org\/">link/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript|<!--|hidden/);
  assert.match(html, /<blockquote><p>A quote<\/p><\/blockquote>/);
  assert.match(html, /<ol><li>A numbered item<ul><li>Nested<\/li><\/ul><\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th>/);
  assert.match(html, /alt="&quot;photo&quot; &amp; more" loading="lazy" width="100" height="200"><figcaption>/);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0][1], /empty alt/);
  assert.match(warnings[1][1], /missing a source link/);
});

test('H-1: invalid slugs fail before paths are generated', () => {
  for (const slug of ['도쿄', '../tokyo', 'Tokyo', 'tokyo_1', '"tokyo\\n"']) {
    assert.throws(() => parseGuide(fixtures({ slug }), 'tokyo.ko.md'), /invalid slug/);
  }
  assert.equal(parseGuide(fixtures({ slug: 'tokyo-1' }), 'tokyo.ko.md').slug, 'tokyo-1');
});

test('H-1 through H-3: translations, preview isolation and nonfatal TODO warnings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xenotravel-p6-'));
  try {
    writeFileSync(join(directory, 'tokyo.ko.md'), fixtures({ body: '<!-- TODO(확인 필요) hidden\nmore -->\nTODO(확인 필요)' }));
    writeFileSync(join(directory, 'tokyo.en.md'), fixtures({ lang: 'en' }));
    writeFileSync(join(directory, 'tokyo.ja.md'), fixtures({ lang: 'ja', draft: true }));
    writeFileSync(join(directory, 'osaka.ko.md'), fixtures({ slug: 'osaka', draft: true }));
    const warnings = [];
    const { output, summaries } = build({ directory, warn: (msg) => warnings.push(msg) });
    assert.ok(warnings.includes('tokyo.ko.md:14: TODO(확인 필요)'));
    assert.ok(summaries.includes('tokyo.ko.md: 1'));
    const html = output.get('/ko/guides/tokyo/index.html');
    assert.match(html, /TODO\(확인 필요\)/);
    assert.doesNotMatch(html, /hidden|noindex|hreflang="ja"/);
    assert.ok(html.includes(`hreflang="x-default" href="${SITE_ORIGIN}/en/guides/tokyo/"`));
    assert.ok(!output.has('/ja/guides/tokyo/index.html'));
    assert.ok(!output.has('/ja/guides/index.html'));
    assert.ok(!output.has('/guides/osaka/index.html'));
    const preview = build({ directory, preview: true }).output;
    assert.match(preview.get('/ja/guides/tokyo/index.html'), /noindex/);
    assert.match(preview.get('/ko/guides/osaka/index.html'), /class="draft">초안/);
    assert.ok(!preview.get('/ko/guides/index.html').includes('/ko/guides/osaka/'));
    assert.ok(!preview.get('/sitemap.xml').includes('/ja/guides/tokyo/'));
    assert.ok(!preview.get('/sitemap.xml').includes('/ko/guides/osaka/'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const { output } = build();
const shanghai = output.get('/ko/guides/shanghai/index.html');

test('A-2 and A-5: origin, sitemap alternates, robots, ads.txt and disabled ad slots', () => {
  const xml = output.get('/sitemap.xml');
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    for (const key of ['privacy', 'about', 'contact', 'terms']) {
      assert.ok(xml.includes(`<loc>${SITE_ORIGIN}/${lang}/${key}/</loc>`));
    }
  }
  assert.ok(xml.includes(`hreflang="zh-Hans" href="${SITE_ORIGIN}/zh/privacy/"`));
  assert.ok(xml.includes(`hreflang="x-default" href="${SITE_ORIGIN}/ko/guides/shanghai/"`));
  assert.ok(shanghai.includes(`rel="canonical" href="${SITE_ORIGIN}/ko/guides/shanghai/"`));
  assert.ok(shanghai.includes(`property="og:image" content="${SITE_ORIGIN}/og.png"`));
  assert.equal(output.get('/robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /s/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  assert.match(output.get('/ads.txt'), /\n# google.com, pub-xenoday, DIRECT, f08c47fec0942fa0\n/);
  assert.equal(adsText('pub-1234567890123456'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  for (const position of ['home', 'guideMiddle', 'guideBottom', 'budget']) assert.equal(adSlot(position), '');
  assert.doesNotMatch(shanghai, /<script|display-ad/);
  const html = withSiteMeta(source('public/index.html'));
  assert.equal(withSiteMeta(html), html);
});

test('A-3 and A-4: the popup and privacy pages render a shared source in every language', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    const sections = privacySections(lang);
    const html = output.get(`/${lang}/privacy/index.html`);
    assert.ok(html.includes(renderPrivacySections(sections)));
    assert.match(html, /AdSense[\s\S]*adssettings.google.com/);
    assert.match(html, /180/);
    assert.match(output.get(`/${lang}/contact/index.html`), /href="https:\/\/github.com\/psyung\/xenotravel\/issues"/);
  }
  const app = source('public/app.js');
  assert.match(app, /privacySections\(getLang\(\)\)/);
  assert.match(app, /renderPrivacySections\(doc, \{ modal: true \}\)/);
  assert.equal(detectLang(['fr-FR', 'zh-TW']), 'zh');
  assert.equal(detectLang(['fr-FR']), 'en');
});

test('H-4: Shanghai copies original images and includes intrinsic dimensions and captions', () => {
  assert.match(shanghai, /직접 다녀온 후기 · 2026년 11월 방문/);
  assert.match(shanghai, /출처 \(확인일\)/);
  const images = [...shanghai.matchAll(/<figure><img[^>]*>/g)];
  assert.equal(images.length, 20);
  assert.ok(images.every(([img]) => /loading="lazy" width="\d+" height="\d+"/.test(img)));
  assert.match(shanghai, /<figcaption>/);
  for (const name of ['peoples-square-restroom-line', 'peoples-square-starbucks', 'mms-store']) {
    assert.ok(output.has('/guide-images/shanghai/' + name + '.jpg'));
  }
});

test('H-5: guide destination URLs target the app form and the latest list has three entries', () => {
  for (const city of ['shanghai', 'tokyo', 'osaka', 'kyoto', 'fukuoka']) {
    assert.ok(destinationById(city));
    assert.ok(output.get(`/ko/guides/${city}/index.html`).includes(`href="/#/?dest=${city}"`));
  }
  for (const [lang, name] of Object.entries({ ko: '상하이', en: 'Shanghai', zh: '上海', ja: '上海' })) {
    setLang(lang);
    assert.equal(t(destinationById('shanghai').value), name);
  }
  setLang('ko');
  const catalog = JSON.parse(output.get('/guide-catalog.json'));
  assert.equal(catalog.guides.ko.length, 3);
  const route = source('public/app.js').split('function route()')[1].split('function openTrip')[0];
  assert.match(route, /const id = params.get\('dest'\)/);
  assert.match(route, /\$\('#homeNewDestination'\)\.value = t\(destination.value\)/);
  assert.match(route, /importShanghaiCourse\(location.hash\)/);
});

test('H-5: the built Shanghai course imports eight finite places into a new trip inbox', () => {
  const catalog = JSON.parse(output.get('/guide-catalog.json'));
  const course = catalog.courses.shanghai;
  assert.deepEqual(course.map((p) => p.name), ['신천지', '예상하이', '티엔즈팡', '예원', '인민광장', '난징동루', '와이탄', 'The Fellas Terrace']);
  assert.ok(course.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !/버스/.test(p.name)));
  assert.match(shanghai, /href="\/#\/\?dest=shanghai&amp;course=shanghai"/);
  const trip = createTrip({ startDate: '2026-12-24', endDate: '2026-12-24' });
  trip.inbox.push(...course.map(createItem));
  assert.equal(trip.inbox.length, 8);
  assert.equal(new Set(trip.inbox.map((p) => p.id)).size, 8);
  assert.match(source('public/app.js'), /tr.inbox.push\(\.\.\.places.map\(M.createItem\)\)/);
});
