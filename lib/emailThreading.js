// Shared by every outbound send path (lib/sendMail.js for client-driven
// sends, and the daily-automations cron's own local sender for
// scheduled/automated sends) and by the inbound sync that will read this
// tag back out of a reply to file it against the right job. One tag
// format, defined in exactly one place, so outbound and inbound always
// agree on what to look for.
export function jobSubjectTag(jobNumber) {
  return `[Project #${jobNumber}]`;
}

// Idempotent — safe to call even if the subject was already tagged
// (e.g. a caller building a "Re: ..." subject from an already-tagged one).
export function tagSubjectWithJob(subject, jobNumber) {
  const base = subject || '';
  if (!jobNumber) return base;
  const tag = jobSubjectTag(jobNumber);
  if (base.includes(tag)) return base;
  return `${tag} ${base}`.trim();
}

// Matches both the current "[Project #...]" tag and the old "[Job #...]"
// tag it replaced, so replies to threads tagged before this rename still
// get filed against the right job.
const JOB_TAG_RE = /\[(?:Project|Job) #([A-Za-z0-9-]+)\]/;

// Pulls the project number back out of a subject line — including a
// "Re: [Project #MC26014C] ..." reply, since the tag survives
// reply/forward prefixing in every mail client that matters here.
export function extractJobNumberFromSubject(subject) {
  const match = (subject || '').match(JOB_TAG_RE);
  return match ? match[1] : null;
}

// Conversation grouping key for the Inbox — one per job + subject, with
// any "Re:"/"Fwd:" prefixes stripped so a reply lands in the same thread
// as the message it answers. Kept in sync with the backfill in migration
// 141 (same rules, in SQL).
export function normalizeSubjectForThread(subject) {
  let s = (subject || '').trim();
  const prefix = /^\s*(re|fwd?|fw)\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, '');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function threadKeyFor(jobId, subject) {
  if (!jobId) return null;
  return `${jobId}:${normalizeSubjectForThread(subject)}`;
}
