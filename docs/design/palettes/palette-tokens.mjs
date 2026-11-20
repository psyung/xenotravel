// 시안 팔레트: light/dark 토큰 + 일차 색 8개 (지도 핀·동선)
export const PALETTES = {
  current: {
    name: '현재 (차콜 + 테라코타)', ref: '현재 운영 중',
    days: ['#A3432E', '#9C4A28', '#A03754', '#516B53', '#795169', '#576B65', '#82601F', '#626456'],
  },
  ocean: {
    name: 'A. 오션 블루', ref: 'TripIt · 트리플(NOL) · Polarsteps · Tripomatic · 마이리얼트립 — 레퍼런스 최다(5곳)',
    light: { bg: '#F5F8FC', paper: '#FFFFFF', soft: '#EEF3F9', hover: '#EEF3F9', line: '#DFE7F0', ink: '#0F1E2E', sub: '#475569', mute: '#64748B',
      accent: '#0B84E3', 'accent-ink': '#0A65B3', 'accent-soft': '#E8F3FD', 'brand-text': '#0A65B3', cta: '#0A6FC2', 'cta-text': '#FFFFFF', 'cta-hover': '#095CA1', control: '#0F1E2E', 'control-text': '#FFFFFF', fly: '#F59E0B', 'fly-soft': '#FFF6E5',
      aura1: 'rgba(11,132,227,.16)', aura2: 'rgba(56,189,248,.14)', aura3: 'rgba(255,176,32,.10)' },
    dark: { bg: '#0D141C', paper: '#151F2A', soft: '#1B2734', hover: '#1B2734', line: '#263445', ink: '#EEF3F8', sub: '#A9B6C4', mute: '#8E9CAC',
      accent: '#4AA8F5', 'accent-ink': '#7CC0FA', 'accent-soft': '#0F2A42', 'brand-text': '#7CC0FA', cta: '#4AA8F5', 'cta-text': '#0D141C', 'cta-hover': '#7CC0FA', control: '#EEF3F8', 'control-text': '#0D141C', fly: '#FBBF24', 'fly-soft': '#33280F',
      aura1: 'rgba(74,168,245,.22)', aura2: 'rgba(56,189,248,.16)', aura3: 'rgba(251,191,36,.08)' },
    days: ['#0B84E3', '#F08C00', '#0F9F7A', '#7C5CFA', '#E5486A', '#0891B2', '#B45309', '#475569'],
  },
  lagoon: {
    name: 'B. 라군 틸', ref: 'Stippl · Google Maps — 지도 앱과 가장 잘 어울리는 계열(2곳)',
    light: { bg: '#F4F8F7', paper: '#FFFFFF', soft: '#ECF3F1', hover: '#ECF3F1', line: '#DCE7E4', ink: '#0E2A2F', sub: '#45605F', mute: '#5F7775',
      accent: '#0E9F87', 'accent-ink': '#0A7C69', 'accent-soft': '#E4F6F1', 'brand-text': '#0A7C69', cta: '#0E2A2F', 'cta-text': '#FFFFFF', 'cta-hover': '#1A3F45', control: '#0E2A2F', 'control-text': '#FFFFFF', fly: '#FF6B57', 'fly-soft': '#FFF0ED',
      aura1: 'rgba(14,159,135,.16)', aura2: 'rgba(94,234,212,.14)', aura3: 'rgba(255,107,87,.10)' },
    dark: { bg: '#0B1517', paper: '#132124', soft: '#192B2E', hover: '#192B2E', line: '#23383C', ink: '#EAF3F1', sub: '#A8BDBA', mute: '#8AA3A0',
      accent: '#3CCFAF', 'accent-ink': '#6FE0C6', 'accent-soft': '#0F2C27', 'brand-text': '#6FE0C6', cta: '#EAF3F1', 'cta-text': '#0B1517', 'cta-hover': '#C9DDD9', control: '#EAF3F1', 'control-text': '#0B1517', fly: '#FF8A78', 'fly-soft': '#3A211D',
      aura1: 'rgba(60,207,175,.2)', aura2: 'rgba(14,159,135,.16)', aura3: 'rgba(255,138,120,.08)' },
    days: ['#0E9F87', '#FF6B57', '#3B82C4', '#E59E0B', '#8B5CF6', '#E0457B', '#2E7D32', '#64748B'],
  },
  sunset: {
    name: 'C. 선셋 코랄', ref: 'Wanderlog · Airbnb — 지금 색을 더 선명·밝게 다듬은 계열(3곳)',
    light: { bg: '#FFFFFF', paper: '#FFFFFF', soft: '#F6F6F7', hover: '#F6F6F7', line: '#E9E9EC', ink: '#1D1D22', sub: '#55565E', mute: '#6E6F78',
      accent: '#F2554A', 'accent-ink': '#C9352B', 'accent-soft': '#FFF0EE', 'brand-text': '#C9352B', cta: '#D33A30', 'cta-text': '#FFFFFF', 'cta-hover': '#B9322A', control: '#1D1D22', 'control-text': '#FFFFFF', fly: '#2F80ED', 'fly-soft': '#EAF2FE',
      aura1: 'rgba(242,85,74,.16)', aura2: 'rgba(255,149,128,.16)', aura3: 'rgba(255,196,120,.12)' },
    dark: { bg: '#121214', paper: '#1C1C20', soft: '#25252A', hover: '#25252A', line: '#303036', ink: '#F4F4F5', sub: '#B4B4BD', mute: '#9A9AA3',
      accent: '#FF7468', 'accent-ink': '#FF948B', 'accent-soft': '#33201E', 'brand-text': '#FF948B', cta: '#FF7468', 'cta-text': '#121214', 'cta-hover': '#FF948B', control: '#F4F4F5', 'control-text': '#121214', fly: '#60A5FA', 'fly-soft': '#16233A',
      aura1: 'rgba(255,116,104,.22)', aura2: 'rgba(242,85,74,.18)', aura3: 'rgba(255,196,120,.08)' },
    days: ['#F2554A', '#2F80ED', '#14A38B', '#F5A623', '#8E5CF7', '#E8447F', '#0EA5C6', '#6B7280'],
  },
};
const decl = (t) => `--bg:${t.bg};--bg-app:${t.bg};--paper:${t.paper};--bg-surface:${t.paper};--soft:${t.soft};--hover:${t.hover};--line:${t.line};--border-subtle:${t.line};--ink:${t.ink};--text-primary:${t.ink};--sub:${t.sub};--text-secondary:${t.sub};--mute:${t.mute};--lang-off:${t.mute};--accent:${t.accent};--accent-primary:${t.accent};--accent-ink:${t['accent-ink']};--accent-hover:${t['accent-ink']};--accent-soft:${t['accent-soft']};--accent-soft-bg:${t['accent-soft']};--brand-text:${t['brand-text']};--btn-primary-bg:${t.cta};--btn-primary-text:${t['cta-text']};--cta:${t.cta};--cta-text:${t['cta-text']};--cta-hover:${t['cta-hover']};--control:${t.control};--control-text:${t['control-text']};--fly:${t.fly};--fly-soft:${t['fly-soft']};--aura-1:${t.aura1};--aura-2:${t.aura2};--aura-3:${t.aura3};`;
export function overrideCss(p) {
  if (!p.light) return '';
  return `:root,:root[data-theme="light"]{${decl(p.light)}} :root[data-theme="dark"]{${decl(p.dark)}}`;
}
