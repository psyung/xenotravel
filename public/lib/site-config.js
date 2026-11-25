export const SITE_NAME = 'XenoTravel'; // 앱·사이트 이름 (A-1b에서 XenoDay로 바꿀 때 여기 한 곳)
export const SITE_ORIGIN = 'https://xenotravel.vercel.app';
export const CONTACT_EMAIL = 'xenobase.official@gmail.com'; // 문의·개인정보 보호책임자 연락처 (I-2)
export const ADSENSE_PUBLISHER = 'xenoday'; // Replace with pub- followed by 16 digits.
export const ADS_ENABLED = false;

// Before enabling, publish Google's European regulations message for this site
// in Privacy & messaging, disable Auto ads, and configure these display units.
export const AD_UNITS = { home: '', guideMiddle: '', guideBottom: '', budget: '' };
export const validPublisher = (id) => /^pub-\d{16}$/.test(id);
