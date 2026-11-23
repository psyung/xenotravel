import { distanceKm, INBOX } from './model.js';

function mapsUrl(place) {
  try {
    const url = new URL(place.url);
    if (!/^https?:$/.test(url.protocol)) return '';
    if (/^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/i.test(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname)
      || ['maps.app.goo.gl', 'goo.gl'].includes(url.hostname)
        && (url.hostname !== 'goo.gl' || url.pathname.startsWith('/maps/'))
      || /^maps\.google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/i.test(url.hostname)) {
      url.hash = '';
      return url.href;
    }
  } catch {
    // Place entries need not have a URL.
  }
  return '';
}

const placeName = (place) => place.name.trim().normalize('NFC');

export function samePlace(a, b) {
  const url = mapsUrl(a);
  return Boolean(url && url === mapsUrl(b)) || (placeName(a) === placeName(b) && distanceKm(a, b) <= 0.05);
}

const lists = (trip) => [...trip.days, { id: INBOX, items: trip.inbox }];

export function groupPlaces(trip, sort = 'visit', locale) {
  const entries = lists(trip).flatMap((list, day) => list.items.map((item) => ({ item, listId: list.id, day })));
  const parents = entries.map((_, i) => i);
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  const names = new Map();
  const urls = new Map();
  function join(i, j) {
    const a = root(i);
    const b = root(j);
    parents[Math.max(a, b)] = Math.min(a, b);
  }
  entries.forEach(({ item }, i) => {
    const name = placeName(item);
    const nearby = names.get(name) ?? [];
    for (const j of nearby) if (distanceKm(item, entries[j].item) <= 0.05) join(i, j);
    nearby.push(i);
    names.set(name, nearby);
    const url = mapsUrl(item);
    if (url && urls.has(url)) join(i, urls.get(url));
    if (url) urls.set(url, i);
  });
  const groups = new Map();
  entries.forEach((entry, i) => {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, { place: entry.item, entries: [] });
    groups.get(key).entries.push(entry);
  });
  const rows = [...groups.values()];
  if (sort === 'name') rows.sort((a, b) => a.place.name.localeCompare(b.place.name, locale));
  if (sort === 'count') rows.sort((a, b) => b.entries.length - a.entries.length);
  return rows;
}

export function removePlaceGroup(trip, ids) {
  const removed = [];
  for (const list of lists(trip)) {
    for (let i = list.items.length - 1; i >= 0; i--) {
      if (ids.has(list.items[i].id)) removed.push({ listId: list.id, index: i, item: list.items.splice(i, 1)[0] });
    }
  }
  return (current) => {
    const byId = new Map(lists(current).map((list) => [list.id, list.items]));
    const existing = new Set([...byId.values()].flatMap((items) => items.map((item) => item.id)));
    for (const { listId, index, item } of [...removed].reverse()) {
      if (existing.has(item.id)) continue;
      const items = byId.get(listId) ?? current.inbox;
      items.splice(Math.min(index, items.length), 0, item);
    }
  };
}
