// Shared constants and small pure helpers for job photos, sketches and updates.
// No imports, so it can be used by tests, pages and server routes alike.

export const PHOTO_BUCKET = 'job-photos';

export const PHOTO_KINDS = {
  before: 'Before',
  during: 'During',
  after: 'After',
  damage: 'Damage',
  general: 'General',
  other: 'Other',
};
export const PHOTO_KIND_KEYS = Object.keys(PHOTO_KINDS);

// Categories for internal notes. Free to extend: the database stores the text.
export const INTERNAL_CATEGORIES = [
  'General',
  'Initial inspection',
  'Moisture / drying',
  'Equipment',
  'Customer contact',
  'Insurance / adjuster',
  'Issue / concern',
  'Safety',
  'Completed Job',
];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// File names in the private bucket. The database insert policy requires exactly these.
export const photoPaths = (jobId, photoId) => ({
  full: `${jobId}/${photoId}.jpg`,
  thumb: `${jobId}/${photoId}_t.jpg`,
  original: `${jobId}/${photoId}_o.jpg`, // the full-size original, when the owner keeps originals
});

// Size that fits inside a max x max box without enlarging.
export function fitWithin(width, height, max) {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export const photoKindLabel = (k) => PHOTO_KINDS[k] || 'Other';

// Counts of photos by kind, for the filter chips. Archived photos are not counted.
export function countByKind(photos) {
  const out = { all: 0 };
  for (const k of PHOTO_KIND_KEYS) out[k] = 0;
  for (const p of photos || []) {
    if (p.archived_at) continue;
    out.all += 1;
    out[p.kind] = (out[p.kind] || 0) + 1;
  }
  return out;
}

export function filterPhotos(photos, { kind = 'all', archived = false, roomKey = null } = {}) {
  return (photos || []).filter((p) => {
    if (!!p.archived_at !== !!archived) return false;
    if (kind !== 'all' && p.kind !== kind) return false;
    if (roomKey && p.room_key !== roomKey) return false;
    return true;
  });
}

// The time a photo was taken, when the browser can say so. Falls back to now for a missing,
// future or implausibly old value (some phones report 1970 for a file with no date).
export function takenAtFor(lastModified, now = Date.now()) {
  const t = Number(lastModified);
  const tenYears = 10 * 365 * 24 * 3600 * 1000;
  if (!Number.isFinite(t) || t > now + 60000 || t < now - tenYears) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

// What a person sees in the History tab for the events these features write. Anything else keeps
// the old look (the event kind with underscores removed).
const centsLabel = (c) => `$${(Math.abs(Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function eventLabel(e) {
  const d = e.details || {};
  switch (e.kind) {
    case 'photos_added':
      return `added ${d.count || 1} photo${(d.count || 1) === 1 ? '' : 's'}${d.kind ? ` (${photoKindLabel(d.kind)})` : ''}`;
    case 'photo_archived': return 'archived a photo';
    case 'photo_restored': return 'restored a photo';
    case 'photo_markup': return 'saved a marked-up photo';
    case 'photos_changed': return `${d.what || 'changed'} ${d.count || 1} photo${(d.count || 1) === 1 ? '' : 's'}`;
    case 'photo_moved': return d.to_job ? `moved a photo to job #${d.to_job}` : d.from_job ? `received a photo from job #${d.from_job}` : 'moved a photo';
    case 'on_the_way_sent': {
      const ok = d.sms?.status === 'sent' || d.email?.status === 'sent';
      return ok ? 'sent the customer the on the way message' : `could not send the on the way message (${d.sms?.detail || d.email?.detail || 'nothing sent'})`;
    }
    case 'photos_added_to_update': return `added ${d.count || 1} photo${(d.count || 1) === 1 ? '' : 's'} to a draft update`;
    case 'photo_link_made': return `made a customer photo link (${d.count || 1} photo${(d.count || 1) === 1 ? '' : 's'})`;
    case 'photo_link_off': return 'switched off a customer photo link';
    case 'photo_voice': return d.action === 'removed' ? 'removed a voice caption' : 'recorded a voice caption on a photo';
    case 'photo_undone': return 'undid a photo just taken';
    case 'sketch_created': return `started sketch "${d.name || ''}"`.replace(' ""', '');
    case 'sketch_comment': {
      const who = Array.isArray(d.tagged) && d.tagged.length ? ` and tagged ${d.tagged.join(', ')}` : '';
      const verb = { reply: 'replied to a comment', resolved: 'resolved a comment', reopened: 'reopened a comment', deleted: 'deleted a comment' }[d.action] || 'commented';
      return `${verb} on sketch "${d.sketch || ''}"${who}`.replace(' ""', '');
    }
    case 'sketch_deleted': return `deleted sketch "${d.name || ''}"`.replace(' ""', '');
    case 'update_posted': return d.category ? `posted an internal update (${d.category})` : 'posted an internal update';
    case 'update_deleted': return d.kind === 'progress' ? 'deleted a progress update draft' : 'deleted an internal update';
    case 'progress_update_saved': return 'saved a progress update draft';
    case 'progress_update_sent': return d.manual ? 'marked a progress update as sent' : 'sent a progress update to the customer';
    case 'aftercare_sent': return d.manual ? 'sent care instructions to the customer' : d.delivered ? 'care instructions were sent to the customer' : 'care instructions could not be sent';
    case 'problem_reported': return 'customer reported a problem';
    case 'problem_handled': return 'marked a customer problem as handled';
    case 'street_offers_sent': return `offered a visit to ${d.count || 'some'} past customer${d.count === 1 ? '' : 's'} on the same street`;
    case 'route_reordered': return 'moved this visit to a shorter drive order for the day';
    case 'customer_requested': return 'customer asked for a visit from their page';
    case 'water_safety_done': return d.source_stopped ? 'recorded the arrival safety check, source stopped' : 'recorded the arrival safety check, source not yet stopped';
    case 'water_authorization_signed': return `work authorization signed${d.signer_name ? ` by ${d.signer_name}` : ''}`;
    case 'water_authorization_absent': return 'work authorization not signed, customer not present';
    case 'water_category_set': return d.from ? `raised the water category from ${d.from} to ${d.category}` : `set the water category to ${d.category}`;
    case 'job_completed': return 'completed the job';
    case 'inspection_signed': return d.absent ? `${d.kind === 'post' ? 'after' : 'before'}-cleaning inspection recorded, customer not present` : `${d.kind === 'post' ? 'after' : 'before'}-cleaning inspection signed by ${d.signer_name || 'the customer'}`;
    case 'invoice_created': return `made invoice #${d.invoice_number || ''}${d.kind === 'difference' ? ' (return visit: difference only)' : ''}`.replace('# ', '');
    case 'invoice_sent': return `sent invoice #${d.invoice_number || ''}${d.via === 'in_person' ? ' (on site)' : d.via === 'manual' ? ' (by hand)' : ''}`;
    case 'invoice_delivery': return d.delivered ? `invoice #${d.invoice_number || ''} was texted or emailed to the customer` : `invoice #${d.invoice_number || ''} could not be sent`;
    case 'invoice_voided': return `voided invoice #${d.invoice_number || ''}${d.reason ? `: ${d.reason}` : ''}`;
    case 'payment_recorded': return `payment of ${centsLabel(d.amount_cents)}${d.tip_cents ? ` (+ ${centsLabel(d.tip_cents)} tip)` : ''} on invoice #${d.invoice_number || ''} (${d.method || ''})`;
    case 'refund_recorded': return `refund of ${centsLabel(-d.amount_cents)} on invoice #${d.invoice_number || ''}`;
    case 'interest_applied': return `added ${centsLabel(d.amount_cents)} late interest to invoice #${d.invoice_number || ''}`;
    case 'interest_waived': return `waived ${centsLabel(d.amount_cents)} late interest on invoice #${d.invoice_number || ''}`;
    case 'labor_pool_added': return `certified time for ${d.count || 1} labor pool ${(d.count || 1) === 1 ? 'person' : 'people'}`;
    case 'labor_pool_removed': return `removed labor pool time for ${d.name || 'someone'}`;
    case 'visit_added': return d.reason_text ? `added a visit: ${d.reason_text}` : 'added a visit';
    case 'visit_goback': return `logged a go-back${d.reason_text ? `: ${d.reason_text}` : ''}`;
    case 'job_reopened': return d.reason ? `reopened the job for a return visit: ${d.reason}` : 'reopened the job for a return visit';
    default: return String(e.kind || '').replace(/_/g, ' ');
  }
}

// Wording for the text and email that carry a progress update link. Pure, so it can be tested.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildUpdateMessages({ business, customerName, link, jobNumber }) {
  const biz = (business || '').trim() || 'us';
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first}, ` : 'Hi, ';
  const ref = jobNumber ? ` on job #${jobNumber}` : '';
  const sms = `${hello}here is a progress update${ref} from ${biz}: ${link}`;
  const subject = `Progress update from ${biz}${jobNumber ? ` (job #${jobNumber})` : ''}`;
  const text = `${hello.replace(/, $/, ',')}\n\nWe have posted a progress update${ref}. You can read it, with photos, here:\n${link}\n\nIf you have questions, just reply or give us a call.\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(hello.replace(/, $/, ','))}</p>
<p><strong>${esc(biz)}</strong> has posted a progress update${esc(ref)}. You can read it, with photos, online.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View the update</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p>If you have questions, just reply or give us a call.</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// People who receive a progress update: the job's customer plus the job's extra contacts.
// A person appears once, even if their phone or email is on two records.
export function updateRecipients(customer, contacts) {
  const seenPhone = new Set();
  const seenEmail = new Set();
  const out = [];
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  for (const c of [customer, ...(contacts || [])]) {
    if (!c) continue;
    const phone = digits(c.phone).length === 10 ? c.phone : '';
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email || '').trim()) ? String(c.email).trim() : '';
    const p = phone && !seenPhone.has(digits(phone)) ? phone : '';
    const m = email && !seenEmail.has(email.toLowerCase()) ? email : '';
    if (!p && !m) continue;
    if (p) seenPhone.add(digits(p));
    if (m) seenEmail.add(m.toLowerCase());
    out.push({ name: c.name || c.display_name || '', phone: p, email: m });
  }
  return out;
}
