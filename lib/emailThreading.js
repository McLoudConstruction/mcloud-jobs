// Shared by every outbound send path (lib/sendMail.js for client-driven
// sends, and the daily-automations cron's own local sender for
// scheduled/automated sends) and by the inbound sync that will read this
// tag back out of a reply to file it against the right job. One tag
// format, defined in exactly one place, so outbound and inbound always
// agree on what to look for.
export function jobSubjectTag(jobNumber) {
  return `[Job #${jobNumber}]`;
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

const JOB_TAG_RE = /\[Job #([A-Za-z0-9-]+)\]/;

// Pulls the job number back out of a subject line — including a
// "Re: [Job #2026-003] ..." reply, since the tag survives reply/forward
// prefixing in every mail client that matters here.
export function extractJobNumberFromSubject(subject) {
  const match = (subject || '').match(JOB_TAG_RE);
  return match ? match[1] : null;
}
