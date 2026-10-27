// Pure helpers for photo dates and download file names. No imports, so the
// same code runs in the browser (single download) and in the zip route.

export const DEFAULT_TZ = 'America/Chicago';

function parts(date, tz, opts) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz || DEFAULT_TZ, hourCycle: 'h23', ...opts });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

// 2026-10-27, in the business timezone (never UTC).
export function dayKey(date, tz) {
  const p = parts(date, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// 091422 (24 hour, to the second), in the business timezone.
export function timeKey(date, tz) {
  const p = parts(date, tz, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${p.hour}${p.minute}${p.second}`;
}

export function isDayFolder(name) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(name || '').trim());
}

export function slugPart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// McLoud-MC26012-2026-10-27-091422.jpg
// McLoud-MC26012-Initial-Inspection-2026-10-27-091422.jpg
export function photoDownloadName({ prefix, projectNumber, folder, takenAt, tz }) {
  const when = takenAt ? new Date(takenAt) : new Date();
  const bits = [
    slugPart(prefix),
    slugPart(projectNumber),
    folder && !isDayFolder(folder) ? slugPart(folder) : '',
    dayKey(when, tz),
    timeKey(when, tz),
  ].filter(Boolean);
  return `${bits.join('-')}.jpg`;
}

// Two photos in the same second get -2, -3 ... so nothing overwrites.
export function uniqueNames(names) {
  const seen = new Map();
  return names.map(n => {
    const count = (seen.get(n) || 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : n.replace(/\.jpg$/, `-${count}.jpg`);
  });
}

export function zipName({ prefix, projectNumber, folder, tz, date }) {
  const bits = [
    slugPart(prefix),
    slugPart(projectNumber),
    'Photos',
    folder ? (isDayFolder(folder) ? folder : slugPart(folder)) : dayKey(date || new Date(), tz),
  ].filter(Boolean);
  return `${bits.join('-')}.zip`;
}
