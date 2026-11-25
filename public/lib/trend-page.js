// J-8: "요즘 뜨는 곳" 장소 설명 페이지 — /{lang}/trends/{city}/{place}/
// 빌드(scripts/build-site.mjs)가 data/trends.json + data/trends-i18n.json으로 정적 HTML을 만들고,
// 앱은 trendPath()로 같은 주소를 가리킨다. 문구는 앱과 같은 번역 사전(t)을 쓴다.
import { t, formatRange, monthDay } from './i18n.js';
import { localizePlace, statusLabel } from './trends.js';
import { directionsLinks, googleMapsUrl, safeUrl } from './model.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const href = (u) => esc(safeUrl(u));

/** 장소 id("tokyo-pokepark-kanto")에서 도시 접두어를 뺀 주소용 이름("pokepark-kanto") */
export function trendSlug(place, city) {
  const id = String(place.id ?? '');
  const prefix = `${city.id}-`;
  return (id.startsWith(prefix) ? id.slice(prefix.length) : id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
export const trendPath = (lang, city, place) => `/${lang}/trends/${city.id}/${trendSlug(place, city)}/`;

/** 이 언어로 페이지를 만들 수 있는지: 한국어(원문)는 늘, 다른 언어는 번역이 있을 때만 (한국어로 대신하지 않는다) */
export const hasTrendLanguage = (place, lang, i18n) => lang === 'ko' || Boolean(i18n?.places?.[place.id]?.[lang]?.summary);

/** 도시의 모든 장소 (요즘 뜨는 곳 + 많이 가는 곳), 중복 id 없이 */
export function cityPlaces(city) {
  const seen = new Set();
  return [...(city.trending ?? []), ...(city.popular ?? [])].filter((p) => p?.id && !seen.has(p.id) && seen.add(p.id));
}

export const trendEnded = (place, today) => Boolean(place.until && place.until < today);

/** 본문 글자 수 (검색 품질 기준: 300자 미만이면 noindex·사이트맵 제외) */
export function trendTextLength(place, lang, i18n) {
  const loc = localizePlace(place, lang, i18n);
  return [loc.summary, place.tip?.[lang] ?? (lang === 'ko' ? place.tip : '')].filter((x) => typeof x === 'string').join('').length;
}

/**
 * 페이지 본문 HTML. 지금 언어(setLang)로 부른다.
 * { city, place, lang, i18n, researchedAt, today, others: 같은 도시 다른 장소 }
 */
export function trendPageBody({ city, place, lang, i18n, researchedAt, today, others = [] }) {
  const loc = localizePlace(place, lang, i18n);
  const cityName = t(city.name);
  const ended = trendEnded(place, today);
  const period = place.since && place.until ? formatRange(monthDay(place.since), monthDay(place.until))
    : place.since ? t('{date}부터', { date: monthDay(place.since) }) : place.until ? t('{date}까지', { date: monthDay(place.until) }) : '';
  const badge = ended ? `<span class="trend-badge ended">${esc(t('기간이 끝났어요'))}</span>`
    : place.status ? `<span class="trend-badge s-${esc(place.status)}">${esc(statusLabel(place, today))}</span>` : '';
  const local = place.name !== loc.name ? `<p class="trend-local" lang="${esc(city.country === 'cn' ? 'zh' : city.country === 'jp' ? 'ja' : 'und')}">${esc(place.name)}</p>` : '';
  const tip = typeof place.tip === 'object' ? place.tip?.[lang] : lang === 'ko' ? place.tip : '';
  const dirs = directionsLinks(place, null, { china: city.country === 'cn', korea: city.country === 'kr' })
    .map((l) => `<a class="cta ghost" href="${href(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
  const sources = (place.sources ?? []).map((s) => `<li><a href="${href(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('');
  const more = others.slice(0, 3).map((p) => {
    const l = localizePlace(p, lang, i18n);
    return `<li><a href="${esc(trendPath(lang, city, p))}"><b>${esc(l.name)}</b><small>${esc(l.area)} · ${esc(l.category)}</small></a></li>`;
  }).join('');
  const original = loc.original ? ` lang="ko"` : '';
  return `<article class="trend-page">
<p class="trend-crumb"><a href="/" data-trend-back>← ${esc(t('돌아가기'))}</a> · ${esc(t('요즘 뜨는 곳'))} · ${esc(cityName)}</p>
<h1>${esc(loc.name)}</h1>${local}
<p class="trend-meta">${badge}${period ? `<span>${esc(period)}</span>` : ''}<span>${esc(loc.area)}</span><span>${esc(loc.category)}</span></p>
<p class="trend-summary"${original}>${esc(loc.summary)}</p>
${tip ? `<h2>${esc(t('방문 팁'))}</h2><p>${esc(tip)}</p>` : ''}
<h2>${esc(t('위치'))}</h2>
<p>${place.approx ? `${esc(t('대략 위치'))} · ` : ''}<a href="${href(googleMapsUrl(place))}" target="_blank" rel="noopener">${esc(t('지도에서 보기'))}</a></p>
<div class="trend-dirs">${dirs}</div>
<div class="guide-actions"><a class="cta" href="/#/?trend=${encodeURIComponent(place.id)}">${esc(t('이 장소 일정에 담기'))}</a></div>
${sources ? `<h2>${esc(t('출처'))}</h2><ul class="trend-sources">${sources}</ul>` : ''}
<p class="trend-note">${esc(t('{date} 조사', { date: researchedAt }))}</p>
${more ? `<h2>${esc(t('{city}의 다른 곳', { city: cityName }))}</h2><ul class="trend-more">${more}</ul>` : ''}
</article>`;
}
