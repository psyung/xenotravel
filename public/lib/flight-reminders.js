import { LANGS, allVersions, k, t } from './i18n.js';

export function flightReminders(flight) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(flight.departAt)) return [];
  // UTC arithmetic preserves the wall-clock times entered for the departure airport.
  const departure = new Date(flight.departAt + 'Z');
  if (!Number.isFinite(departure.getTime()) || departure.toISOString().slice(0, 16) !== flight.departAt) return [];
  return [
    { hours: 24, key: k('온라인 체크인 열림 (출발 24시간 전)') },
    { hours: 3, key: k('공항 도착 권장 (국제선 출발 3시간 전)') },
  ].map(({ hours, key }) => ({
    hours, key, label: t(key), id: `${flight.id}:${hours}`,
    at: new Date(departure - hours * 3600000).toISOString().slice(0, 16),
  }));
}

export function reminderTodos(flight, checks = []) {
  return flightReminders(flight).flatMap(({ id, at, key }) => {
    const versions = allVersions(key);
    const textI18n = Object.fromEntries(Object.keys(LANGS).map((lang, index) => [
      lang, [versions[index] ?? key, at.replace('T', ' '), flight.flightNo || flight.from].filter(Boolean).join(' · '),
    ]));
    const check = checks.find((c) => c.flightReminder === id);
    // Offer a revised time on edit, preserving any text the user customized.
    if (check && (!Object.values(check.textI18n ?? {}).includes(check.text) || check.textI18n.ko === textI18n.ko)) return [];
    return [{ id, textI18n }];
  });
}
