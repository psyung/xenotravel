import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from '../public/lib/i18n.js';
import { destinationById } from '../public/lib/destinations.js';
import { escapeHtml as esc, privacySections, renderPrivacySections } from '../public/lib/privacy.js';
import { SITE_ORIGIN, ADSENSE_PUBLISHER, CONTACT_EMAIL, validPublisher } from '../public/lib/site-config.js';
import { adSlot } from '../public/lib/ads.js';
import { jpegSize, renderMarkdown, safeHref, stripComments } from './guide-markdown.mjs';
import { chrome, usage } from './site-copy.mjs';

const languages = Object.keys(LANGS);
const info = ['about', 'contact', 'privacy', 'terms'];
const guideDir = fileURLToPath(new URL('../content/guides/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const slugPattern = /^[a-z0-9-]+$/;
const byLatest = (a, b) => b.updated.localeCompare(a.updated) || Number(b.experience) - Number(a.experience) || a.slug.localeCompare(b.slug);
const guidePath = (lang, slug = '') => `/${lang}/guides/${slug ? slug + '/' : ''}`;
const absolute = (path) => new URL(path, SITE_ORIGIN).href;
const LANG_MARK = { ko: 'KO', en: 'EN', zh: '中', ja: '日' };
const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" integrity="sha384-/uC/GIvKJ/9RN6i1izHoBY9ubYo60OAsQRNQ3NRFiNsN+N/MVQJHD5OYcZz6wvwn" crossorigin="anonymous">';
const STYLES = FONT + '<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/site.css"><script src="/site.js"></script>';
/** 배포 단계 (I-0): preview = 정식 오픈 전(전체 noindex, robots Disallow, 빈 sitemap), production = 정식 도메인 */
export const siteStage = (env = process.env) => (env.SITE_STAGE === 'production' ? 'production' : 'preview');
/** 본문 첫 H1은 frontmatter title과 겹치므로 지운다 (I-0b). 줄 번호를 유지하려고 빈 줄로 바꾼다. */
export function dropLeadingTitle(body) {
  const lines = body.split('\n');
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (inComment) { if (line.includes('-->')) inComment = false; continue; }
    if (line.startsWith('<!--')) { if (!line.includes('-->')) inComment = true; continue; }
    if (!line) continue;
    if (/^#\s+/.test(line)) lines[i] = '';
    break;
  }
  return lines.join('\n');
}

export function parseGuide(raw, file) {
  const lines = raw.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) throw new Error(file + ': missing frontmatter');
  const guide = { file, sources: [] };
  const scalar = (value) => {
    const v = value.trim();
    if (v.startsWith('"')) return JSON.parse(v);
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  };
  const fields = new Set(['title', 'slug', 'city', 'country', 'lang', 'draft', 'updated', 'description', 'experience', 'visited']);
  let inSources = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const field = /^(\w+):\s*(.*)$/.exec(line);
    if (field) {
      const [, key, value] = field;
      inSources = key === 'sources';
      if (inSources && (value === '' || value === '[]')) continue;
      if (!fields.has(key)) throw new Error(file + ': unsupported frontmatter field ' + key);
      guide[key] = scalar(value);
    } else {
      const source = inSources && /^\s+(- )?(name|url|checked):\s*(.*)$/.exec(line);
      if (!source) throw new Error(file + ': invalid frontmatter line ' + line);
      const [, start, key, value] = source;
      if (start) guide.sources.push({});
      const item = guide.sources.at(-1);
      if (!item) throw new Error(file + ': invalid sources list');
      item[key] = scalar(value);
    }
  }
  if (typeof guide.slug !== 'string' || guide.slug.trim() !== guide.slug || !slugPattern.test(guide.slug)) {
    throw new Error(file + ': invalid slug ' + guide.slug);
  }
  if (!languages.includes(guide.lang) || !file.endsWith('.' + guide.lang + '.md')) throw new Error(file + ': invalid language');
  for (const field of ['title', 'city', 'country', 'updated', 'description']) {
    if (!guide[field]) throw new Error(file + ': missing ' + field);
  }
  if (!['true', 'false'].includes(guide.draft)) throw new Error(file + ': draft must be true or false');
  guide.draft = guide.draft === 'true';
  guide.experience = guide.experience === 'true';
  if (guide.experience && !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(guide.visited ?? '')) {
    throw new Error(file + ': experience requires a visited date (YYYY-MM-DD)');
  }
  guide.body = lines.slice(end + 1).join('\n');
  guide.bodyStart = end + 2;
  return guide;
}

export function adsText(publisher, warn = console.warn) {
  const valid = validPublisher(publisher);
  if (!valid) warn('ads.txt: replace ADSENSE_PUBLISHER in public/lib/site-config.js with pub- followed by 16 digits.');
  const id = valid ? publisher : 'pub-' + publisher.replace(/[^a-z0-9-]/gi, '');
  return (valid ? '' : '# Replace this placeholder with your AdSense publisher ID (pub- followed by 16 digits).\n# ')
    + `google.com, ${id}, DIRECT, f08c47fec0942fa0\n`;
}

function alternates(variants) {
  const ordered = languages.filter((lang) => variants[lang]);
  const fallback = variants.en ?? variants.ko ?? variants[ordered[0]];
  return [...ordered.map((lang) => [LANGS[lang].html, variants[lang]]), ['x-default', fallback]];
}

function page({ lang, path, title, description, variants, body, draft, ads, article, current, wide, noindex }, indexVariants) {
  const c = chrome[lang];
  const guides = indexVariants[lang] ?? indexVariants.ko ?? indexVariants.en ?? Object.values(indexVariants)[0];
  const here = (key) => (key === current ? ' aria-current="page"' : '');
  const links = [['guides', guides], ['about', `/${lang}/about/`], ['contact', `/${lang}/contact/`]]
    .filter(([, href]) => href).map(([key, href]) => `<a href="${href}"${here(key)}>${c[key]}</a>`).join('');
  const langs = languages.filter((l) => variants[l]).map((l) =>
    `<a href="${esc(variants[l])}" lang="${LANGS[l].html}" hreflang="${LANGS[l].html}" data-set-lang="${l}" aria-label="${LANGS[l].label}"${l === lang ? ' aria-current="true"' : ''}>${LANG_MARK[l]}</a>`).join('');
  const footLinks = ['privacy', 'terms'].map((key) => `<a href="/${lang}/${key}/"${here(key)}>${c[key]}</a>`).join('');
  const mail = CONTACT_EMAIL ? ` · <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>` : '';
  return `<!doctype html>
<html lang="${LANGS[lang].html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(absolute(path))}">
${alternates(variants).map(([code, href]) => `<link rel="alternate" hreflang="${code}" href="${esc(absolute(href))}">`).join('\n')}
<meta property="og:type" content="${article ? 'article' : 'website'}">
<meta property="og:site_name" content="XenoTravel">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(absolute(path))}">
<meta property="og:image" content="${esc(absolute('/og.png'))}">
${draft || noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/icons/logo-xeno-route.svg">
${STYLES}
${ads ? '<script type="module" src="/guide-ads.js"></script>' : ''}
</head>
<body class="static-site">
<header class="site-head"><div class="site-shell">
<a class="site-brand" href="/"><img src="/icons/logo-xeno-route.svg" width="32" height="32" alt=""> XenoTravel</a>
<nav id="site-menu" class="site-nav" aria-label="${c.nav}">${links}</nav>
<div class="site-tools"><div class="site-langs" role="group" aria-label="${c.lang}">${langs}</div>
<button type="button" class="site-menu-btn" aria-expanded="false" aria-controls="site-menu" aria-label="${c.menu}">☰</button></div>
<a class="cta site-open" href="/">${c.openApp}</a>
</div></header>
<main${wide ? ' class="wide"' : ''}>${body}</main>
<footer class="site-foot"><div class="site-shell"><span>© 2026 XenoTravel${mail}</span><nav aria-label="${c.nav}">${footLinks}</nav></div></footer>
</body>
</html>\n`;
}

function redirect(variants) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>XenoTravel</title>${STYLES}
<script type="module" src="/site-redirect.js"></script><body class="static-site"><main><ul>${Object.entries(variants)
    .map(([lang, href]) => `<li><a data-lang="${lang}" lang="${LANGS[lang].html}" hreflang="${LANGS[lang].html}" href="${esc(href)}">${LANGS[lang].label}</a></li>`).join('')}</ul></main></html>\n`;
}

function imageAssets(directory, slug, output, warn) {
  const dir = join(directory, 'images', slug);
  const files = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((file) => file.isFile()).map((file) => file.name) : [];
  const assets = new Set(files);
  const path = '/guide-images/' + slug + '/';
  for (const file of assets) {
    if (!/^[a-z0-9-]+\.(jpg|jpeg|webp)$/.test(file)) throw new Error('Invalid guide image filename: ' + file);
    output.set(path + file, { copy: join(dir, file) });
  }
  return (url, line) => {
    const file = url.slice(('images/' + slug + '/').length);
    if (!url.startsWith('images/' + slug + '/') || !assets.has(file)) {
      warn(line, 'guide image missing: ' + url);
      return {};
    }
    const dimensions = jpegSize(readFileSync(join(dir, file)));
    if (!dimensions) warn(line, 'could not read JPEG dimensions: ' + file);
    const stem = file.slice(0, file.lastIndexOf('.'));
    const variants = [800, 1600].filter((width) => assets.has(`${stem}-${width}.webp`));
    return { src: path + file, ...dimensions, srcset: variants.map((width) => `${path}${stem}-${width}.webp ${width}w`).join(', ') };
  };
}

function renderGuide(g, variants, directory, output, warn, indexVariants, noindex) {
  const c = chrome[g.lang];
  const note = (line, message) => warn(`${g.file}:${g.bodyStart + line - 1}: ${message}`);
  const blocks = renderMarkdown(dropLeadingTitle(g.body), { imageInfo: imageAssets(directory, g.slug, output, note), warn: note });
  const middle = !g.draft && adSlot('guideMiddle');
  const bottom = !g.draft && adSlot('guideBottom');
  if (middle) blocks.splice(Math.ceil(blocks.length / 2), 0, middle);
  const [year, month] = (g.visited ?? '').split('-');
  const badge = g.experience ? `<p class="badge">${c.visit(Number(year), Number(month))}</p>` : '';
  const sources = g.sources.map(({ url, name, checked }) =>
    `<li>${safeHref(url) ? `<a href="${safeHref(url)}">${esc(name)}</a>` : esc(name)} <time>${esc(checked)}</time></li>`).join('');
  const city = destinationById(g.slug);
  const dest = city ? `/#/?dest=${g.slug}` : '/#/';
  const course = g.slug === 'shanghai' && city ? `<a class="cta" href="${dest}&amp;course=shanghai">${c.course}</a>` : '';
  const body = `<article>${g.draft ? `<p class="draft">${c.draft}</p>` : ''}<h1>${esc(g.title)}</h1>${badge}
<time datetime="${esc(g.updated)}">${esc(g.updated)}</time>
${blocks.join('\n')}
${sources ? `<section><h2>${c.sources}</h2><ul>${sources}</ul></section>` : ''}
<div class="guide-actions"><a class="cta" href="${dest}">${c.plan}</a>${course}</div>${bottom}</article>`;
  return page({ ...g, path: guidePath(g.lang, g.slug), variants, body, ads: middle || bottom, article: true, current: 'guides', noindex }, indexVariants);
}

function setPage(output, path, html) {
  output.set(path + 'index.html', html);
}

export function buildFiles({ directory = guideDir, preview = false, stage = 'preview', warn = console.warn, log = console.log } = {}) {
  const production = stage === 'production';
  const noindex = !production;
  const output = new Map();
  const blocked = [];
  const summaries = [];
  const guides = readdirSync(directory).filter((file) => /\.[a-z]{2}\.md$/.test(file)).sort().map((file) =>
    parseGuide(readFileSync(join(directory, file), 'utf8'), file));
  const groups = new Map();
  const published = guides.filter((g) => !g.draft).sort(byLatest);
  const catalog = {};
  const indexVariants = {};
  for (const lang of languages) {
    if (published.some((g) => g.lang === lang)) {
      indexVariants[lang] = guidePath(lang);
    }
    catalog[lang] = published.filter((g) => g.lang === lang).slice(0, 3)
      .map((g) => ({ title: g.title, description: g.description, href: guidePath(lang, g.slug) }));
  }
  for (const g of guides) {
    const group = groups.get(g.slug) ?? new Map();
    if (group.has(g.lang)) throw new Error(g.file + ': duplicate guide language for ' + g.slug);
    group.set(g.lang, g);
    groups.set(g.slug, group);
    let total = 0;
    stripComments(g.body).split('\n').forEach((line, i) => {
      for (const _ of line.matchAll(/TODO\(확인 필요\)/g)) {
        warn(`${g.file}:${g.bodyStart + i}: TODO(확인 필요)`);
        if (production && !g.draft) blocked.push(`${g.file}:${g.bodyStart + i}`);
        total++;
      }
    });
    summaries.push(`${g.file}: ${total}`);
  }
  // H-3: 정식 오픈(production)에서는 확인 안 된 정보가 공개되지 않게, 공개 글에 TODO가 남아 있으면 빌드를 멈춘다
  if (blocked.length) throw new Error('Published guides still contain TODO(확인 필요):\n  ' + blocked.join('\n  '));

  const sitemaps = [];
  for (const key of info) {
    const variants = Object.fromEntries(languages.map((lang) => [lang, `/${lang}/${key}/`]));
    sitemaps.push(variants);
    setPage(output, `/${key}/`, redirect(variants));
    for (const [lang, path] of Object.entries(variants)) {
      const c = chrome[lang];
      const descriptions = { about: c.operator, contact: c.contactIntro, privacy: c.privacyIntro, terms: c.termsIntro };
      const description = descriptions[key];
      const contact = `<p>${esc(c.contactHelp)}</p><p class="contact-mail"><a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>`
        + `<button type="button" class="site-copy" data-copy="${esc(CONTACT_EMAIL)}" data-copied="${esc(c.copied)}">${esc(c.copy)}</button></p>`
        + '<div class="site-toast" role="status" aria-live="polite" hidden></div>';
      const body = `<h1>${c[key]}</h1><p>${esc(description)}</p>` + (key === 'privacy'
        ? renderPrivacySections(privacySections(lang)) : key === 'contact' ? contact : '');
      setPage(output, path, page({ lang, path, title: c[key] + ' | XenoTravel', description, variants, body, current: key, noindex }, indexVariants));
    }
  }
  if (Object.keys(indexVariants).length) {
    setPage(output, '/guides/', redirect(indexVariants));
    sitemaps.push(indexVariants);
  }
  for (const [lang, path] of Object.entries(indexVariants)) {
    const c = chrome[lang];
    const cards = published.filter((g) => g.lang === lang).sort((a, b) => Number(b.experience) - Number(a.experience) || byLatest(a, b));
    const howTo = lang === 'ko' ? `<h2>XenoTravel 사용법</h2><ul>${usage.map((item) =>
      `<li><a href="/ko/guides/how-to/${item.slug}/">${item.title}</a></li>`).join('')}</ul>` : '';
    const body = `<h1>${c.guides}</h1><p>${c.index}</p><ul class="guide-list">${cards.map((g) =>
      `<li><h2><a href="${guidePath(lang, g.slug)}">${esc(g.title)}</a></h2><p>${esc(g.description)}</p><time datetime="${esc(g.updated)}">${esc(g.updated)}</time></li>`).join('')}</ul>${howTo}`;
    setPage(output, path, page({ lang, path, title: c.guides + ' | XenoTravel', description: c.index, variants: indexVariants, body, current: 'guides', wide: true, noindex }, indexVariants));
  }
  if (indexVariants.ko) for (const item of usage) {
    const path = '/ko/guides/how-to/' + item.slug + '/';
    const variants = { ko: path };
    sitemaps.push(variants);
    setPage(output, path, page({ ...item, lang: 'ko', path, variants, article: true, current: 'guides', noindex,
      body: `<article><h1>${item.title}</h1><p>${item.description}</p><p>${item.body}</p><a class="cta" href="/">XenoTravel 열기</a></article>` }, indexVariants));
  }
  for (const [slug, group] of groups) {
    const variants = Object.fromEntries([...group].filter(([, g]) => !g.draft).map(([lang]) => [lang, guidePath(lang, slug)]));
    if (Object.keys(variants).length) sitemaps.push(variants);
    const visible = Object.fromEntries([...group].filter(([, g]) => preview || !g.draft).map(([lang]) => [lang, guidePath(lang, slug)]));
    if (Object.keys(visible).length) setPage(output, `/guides/${slug}/`, redirect(visible));
    for (const g of group.values()) {
      if (!preview && g.draft) continue;
      const paths = g.draft ? { ...variants, [g.lang]: visible[g.lang] } : variants;
      setPage(output, visible[g.lang], renderGuide(g, paths, directory, output, warn, indexVariants, noindex));
    }
  }
  const xml = sitemaps.flatMap((variants) => Object.values(variants).map((path) =>
    `  <url><loc>${esc(absolute(path))}</loc>${alternates(variants).map(([lang, href]) =>
      `<xhtml:link rel="alternate" hreflang="${lang}" href="${esc(absolute(href))}"/>`).join('')}</url>`));
  // I-0: 정식 오픈 전(preview)에는 검색 노출을 막는다 — 빈 sitemap, robots Disallow: /
  output.set('/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
    + (production ? `  <url><loc>${esc(absolute('/'))}</loc></url>\n` + xml.join('\n') + '\n' : '') + '</urlset>\n');
  output.set('/robots.txt', production
    ? 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /s/\nSitemap: ' + absolute('/sitemap.xml') + '\n'
    : 'User-agent: *\nDisallow: /\n');
  output.set('/ads.txt', adsText(ADSENSE_PUBLISHER, warn));
  const coursePath = join(directory, 'shanghai-course.json');
  const course = existsSync(coursePath) ? JSON.parse(readFileSync(coursePath, 'utf8')) : null; // I-5: { id, title, days[{ items }], checklist }
  output.set('/guide-catalog.json', JSON.stringify({ guides: catalog, courses: { shanghai: course } }) + '\n');
  log('WebP conversion skipped (no bundled image converter). JPGs are preserved; existing WebP variants are reused.');
  return { output, summaries };
}

export function withSiteMeta(html, stage = 'production') {
  return html.replace(/<!-- site-origin-meta:start -->[\s\S]*?<!-- site-origin-meta:end -->/, () =>
    `<!-- site-origin-meta:start -->\n${stage === 'production' ? '' : '  <meta name="robots" content="noindex">\n'}  <link rel="canonical" href="${esc(absolute('/'))}">\n  <meta property="og:url" content="${esc(absolute('/'))}">\n  <meta property="og:image" content="${esc(absolute('/og.png'))}">\n  <!-- site-origin-meta:end -->`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const stage = siteStage();
  console.log('SITE_STAGE=' + stage + (stage === 'production' ? '' : ' (noindex, robots Disallow: /, empty sitemap)'));
  const { output, summaries } = buildFiles({ preview: process.env.VERCEL_ENV === 'preview', stage });
  // These explicit directories are owned by this build. Clear stale preview
  // pages when switching build modes or removing a translation.
  for (const name of [...languages, ...info, 'guides', 'guide-images']) {
    const path = resolve(publicDir, name);
    if (dirname(path) !== resolve(publicDir)) throw new Error('Invalid generated directory ' + path);
    rmSync(path, { recursive: true, force: true });
  }
  for (const [url, value] of output) {
    const path = resolve(publicDir, '.' + url);
    if (!path.startsWith(resolve(publicDir) + sep)) throw new Error('Invalid output path ' + path);
    mkdirSync(dirname(path), { recursive: true });
    if (typeof value === 'string') writeFileSync(path, value);
    else copyFileSync(value.copy, path);
  }
  const home = join(publicDir, 'index.html');
  writeFileSync(home, withSiteMeta(readFileSync(home, 'utf8'), stage));
  console.log('Visible guide TODO counts:\n' + summaries.map((summary) => '  ' + summary).join('\n'));
}
