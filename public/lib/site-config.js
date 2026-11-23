export const SITE_ORIGIN = 'https://xenotravel.vercel.app';
export const CONTACT_EMAIL = ''; // Set to the operator's confirmed address to enable mailto.
export const ISSUES_URL = 'https://github.com/psyung/xenotravel/issues';
export const ADSENSE_PUBLISHER = 'xenoday'; // Replace with pub- followed by 16 digits.
export const ADS_ENABLED = false;

// Before enabling, publish Google's European regulations message for this site
// in Privacy & messaging, disable Auto ads, and configure these display units.
export const AD_UNITS = { home: '', guideMiddle: '', guideBottom: '', budget: '' };
export const validPublisher = (id) => /^pub-\d{16}$/.test(id);
