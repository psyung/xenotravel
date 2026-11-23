import { loadLang } from './lib/i18n.js';

const links = [...document.querySelectorAll('main a[hreflang]')];
const lang = loadLang();
const target = links.find((a) => a.dataset.lang === lang)
  ?? links.find((a) => a.dataset.lang === 'ko')
  ?? links[0];
if (target) location.replace(target.href);
