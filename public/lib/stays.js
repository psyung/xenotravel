import { indexOfDate, uid } from './model.js';

export function stayRangeWithin(trip, checkIn, checkOut) {
  if (!checkIn || !checkOut || checkIn >= checkOut) return null;
  const from = indexOfDate(trip, checkIn);
  const to = indexOfDate(trip, checkOut);
  if (from == null || to == null) return null;
  const startIndex = Math.max(0, from);
  const endIndex = Math.min(trip.days.length, to);
  return endIndex > startIndex ? { startIndex, nights: endIndex - startIndex } : null;
}

export function overlappingStays(stays, { startIndex, nights }, editId) {
  return stays.filter((stay) => stay.id !== editId
    && stay.startIndex < startIndex + nights && stay.startIndex + stay.nights > startIndex);
}

/** The incoming booking takes its nights. Keep only unaffected nights of existing stays. */
export function splitStayAround(stay, { startIndex, nights }) {
  const end = startIndex + nights;
  const oldEnd = stay.startIndex + stay.nights;
  const segments = [];
  if (stay.startIndex < startIndex) {
    segments.push({ ...stay, nights: startIndex - stay.startIndex, checkOutTime: '' });
  }
  if (oldEnd > end) {
    const tail = { ...stay, startIndex: end, nights: oldEnd - end, checkInTime: '' };
    if (segments.length) {
      tail.id = uid();
      tail.price = null;
    }
    segments.push(tail);
  }
  return segments;
}
