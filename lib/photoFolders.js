import { DEFAULT_TZ, dayKey, isDayFolder } from './photoNames';

export const INITIAL_INSPECTION = 'Initial Inspection';
export const TODAY_VALUE = '__today__';
export const NEW_FOLDER_VALUE = '__new__';
const BRAND_NEW_HOURS = 12;

// A job counts as brand new when it was created today (business timezone) or
// within the last 12 hours. The 12 hour window covers a lead that came in
// just before midnight and a site visit just after.
export function isBrandNewJob(createdAt, tz, now = new Date()) {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  if (now.getTime() - created.getTime() <= BRAND_NEW_HOURS * 3600 * 1000) return true;
  return dayKey(created, tz || DEFAULT_TZ) === dayKey(now, tz || DEFAULT_TZ);
}

export function defaultDestination({ brandNew, preferInitial }) {
  return brandNew || preferInitial ? INITIAL_INSPECTION : TODAY_VALUE;
}

// folders: [{ name, kind }] from fetchFolders. Returns [{ value, label, group }].
export function buildDestinationOptions({ folders, tz, brandNew, preferInitial, now = new Date() }) {
  const todayName = dayKey(now, tz || DEFAULT_TZ);
  const today = { value: TODAY_VALUE, label: `Today, ${todayName}`, group: 'main' };
  const initial = { value: INITIAL_INSPECTION, label: INITIAL_INSPECTION, group: 'main' };
  const first = brandNew || preferInitial ? [initial, today] : [today, initial];

  const named = folders
    .filter(f => f.kind !== 'day' && f.name.toLowerCase() !== INITIAL_INSPECTION.toLowerCase())
    .map(f => f.name)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ value: name, label: name, group: 'named' }));

  const earlier = folders
    .filter(f => f.kind === 'day' && f.name !== todayName)
    .map(f => f.name)
    .sort()
    .reverse()
    .slice(0, 10)
    .map(name => ({ value: name, label: name, group: 'earlier' }));

  return [...first, ...named, ...earlier];
}

// Turns the dropdown value into the folder a photo actually files into, at the
// moment it is taken (so a session that runs past midnight follows the clock).
export function resolveDestination(value, takenAt, tz) {
  if (!value || value === TODAY_VALUE) {
    const day = dayKey(takenAt || new Date(), tz || DEFAULT_TZ);
    return { folder: day, kind: 'day', day };
  }
  if (isDayFolder(value)) return { folder: value, kind: 'day', day: value };
  if (value.toLowerCase() === INITIAL_INSPECTION.toLowerCase()) return { folder: INITIAL_INSPECTION, kind: 'system', day: null };
  return { folder: value, kind: 'named', day: null };
}

export function cleanFolderName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Registry rows plus any folder name found on the job's photos. Works before
// migration 175 is run (the registry query just fails and is skipped).
export async function fetchFolders(supabase, jobId) {
  const byName = new Map();
  const add = (name, kind) => {
    const clean = cleanFolderName(name);
    if (!clean) return;
    const key = clean.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (existing.kind === 'named' && kind !== 'named')) {
      byName.set(key, { name: existing?.name || clean, kind: isDayFolder(clean) ? 'day' : kind });
    }
  };
  try {
    const { data, error } = await supabase.from('job_photo_folders').select('name, kind').eq('job_id', jobId);
    if (!error && data) data.forEach(r => add(r.name, r.kind));
  } catch { /* migration 175 not run yet */ }
  try {
    const { data } = await supabase.from('job_photos').select('folder').eq('job_id', jobId).not('folder', 'is', null);
    (data || []).forEach(r => add(r.folder, 'named'));
  } catch { /* ignore */ }
  return [...byName.values()];
}

// Best effort: makes sure the folder row exists. Photos still file correctly
// without it because the folder name lives on the photo.
export async function ensureFolder(supabase, jobId, { folder, kind, day }) {
  try {
    await supabase.rpc('ensure_job_photo_folder', {
      job_id_in: jobId,
      name_in: folder,
      kind_in: kind || 'named',
      day_in: day || null,
    });
  } catch { /* migration 175 not run yet */ }
}
