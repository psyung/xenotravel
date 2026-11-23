import { ADS_ENABLED, ADSENSE_PUBLISHER, AD_UNITS, validPublisher } from './site-config.js';

export function adSlot(position) {
  const id = AD_UNITS[position];
  if (!ADS_ENABLED || !validPublisher(ADSENSE_PUBLISHER) || !/^\d+$/.test(id)) return '';
  return `<div class="display-ad"><ins class="adsbygoogle" data-ad-client="ca-${ADSENSE_PUBLISHER}" data-ad-slot="${id}"></ins></div>`;
}

let loading;
export async function loadAds(root = document, active = () => true) {
  if (!ADS_ENABLED || !active()) return;
  const slots = [...root.querySelectorAll('.display-ad ins:not([data-ad-requested])')];
  if (!slots.length) return;
  // The standard AdSense tag delivers the account's published Google CMP
  // and honors its TCF consent signal for ad serving.
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${ADSENSE_PUBLISHER}`;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  if (!await loading || !active()) return;
  for (const slot of slots) {
    if (!slot.isConnected || slot.dataset.adRequested) continue;
    slot.dataset.adRequested = 'true';
    (window.adsbygoogle ??= []).push({});
  }
}
