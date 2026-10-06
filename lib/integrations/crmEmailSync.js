import { getAdminClient } from '../supabaseAdmin';
import { getValidAccessToken } from './tokens';
import { gmailScanner } from './gmailScan';
import { outlookScanner } from './outlookScan';
import { extractJobNumberFromSubject, threadKeyFor } from '../emailThreading';
import {
  parseAddresses, splitEmails, domainOf, isCompanyDomain, parseInternalDomains, messageMatchesCrm,
} from '../crmEmailAddresses';

// Reads sent and received mail for a connected mailbox and files every
// message that involves a Person, Property or Company already in the CRM.
// Mail with no CRM address on it is never stored. Each record's email log is
// then just a query on email_messages (see components/EmailLogPanel.js).
//
// Work happens in small time windows, oldest first, with a checkpoint saved
// after each one. That makes the first run (which backfills history) resumable
// across many calls, and a run that hits its time budget simply picks up where
// it stopped on the next call.

const SCANNERS = { google: gmailScanner, microsoft: outlookScanner };
const HAS_MAIL_SCOPE = {
  google: scope => (scope || '').includes('gmail.readonly'),
  microsoft: scope => (scope || '').includes('Mail.Read'),
};

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// Mail can be indexed a little after its timestamp, so each caught up run
// re-reads the last hour. Messages already stored are skipped by id.
const OVERLAP_MS = 60 * 60 * 1000;
const DEFAULT_BUDGET_MS = 45 * 1000;
const DEFAULT_BACKFILL_DAYS = 90;
const MAX_BODY_CHARS = 20000;
const PAGE = 1000;

async function fetchAll(admin, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Every email address saved anywhere in the CRM, plus the domains that
// identify a company. Company domains come from the company's own contact
// email and from the emails of the people linked to it.
export async function loadCrmIndex(admin, internalDomains) {
  const [contacts, properties, companies] = await Promise.all([
    fetchAll(admin, 'contacts', 'contact_email, billing_email, company_id'),
    fetchAll(admin, 'properties', 'contact_email'),
    fetchAll(admin, 'companies', 'contact_email'),
  ]);

  const addresses = new Set();
  const companyDomains = new Set();
  const addCompanyDomain = address => {
    const domain = domainOf(address);
    if (isCompanyDomain(domain, internalDomains)) companyDomains.add(domain);
  };

  for (const c of contacts) {
    const emails = [...splitEmails(c.contact_email), ...splitEmails(c.billing_email)];
    emails.forEach(e => addresses.add(e));
    if (c.company_id) emails.forEach(addCompanyDomain);
  }
  for (const p of properties) splitEmails(p.contact_email).forEach(e => addresses.add(e));
  for (const co of companies) {
    const emails = splitEmails(co.contact_email);
    emails.forEach(e => addresses.add(e));
    emails.forEach(addCompanyDomain);
  }
  return { addresses, companyDomains };
}

async function existingIds(admin, connectionId, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data } = await admin
      .from('email_messages')
      .select('provider_message_id')
      .eq('connection_id', connectionId)
      .in('provider_message_id', slice);
    (data || []).forEach(r => found.add(r.provider_message_id));
  }
  return found;
}

async function jobIdForSubject(admin, subject, cache) {
  const number = extractJobNumberFromSubject(subject);
  if (!number) return null;
  if (cache.has(number)) return cache.get(number);
  const { data } = await admin.from('jobs').select('id').eq('project_number', number).maybeSingle();
  cache.set(number, data?.id || null);
  return data?.id || null;
}

// Reads one window. Returns { scanned, stored, incomplete }.
async function processWindow({ admin, connection, scanner, accessToken, index, ownerEmail, after, before, deadline, jobCache }) {
  const { messages, incomplete } = await scanner.listWindow(accessToken, { after, before, deadline });
  if (incomplete) return { scanned: 0, stored: 0, incomplete: true };

  const candidates = messages.filter(m =>
    messageMatchesCrm(parseAddresses(m.from, m.to, m.cc), ownerEmail, index)
  );
  if (candidates.length === 0) return { scanned: messages.length, stored: 0, incomplete: false };

  const already = await existingIds(admin, connection.id, candidates.map(m => m.id));
  let stored = 0;

  for (const m of candidates) {
    if (already.has(m.id)) continue;
    if (Date.now() > deadline) return { scanned: messages.length, stored, incomplete: true };

    const body = await scanner.fetchBody(accessToken, m.id);
    const jobId = await jobIdForSubject(admin, m.subject, jobCache);
    const bodyText = (body.bodyText || '').slice(0, MAX_BODY_CHARS) || null;

    const { error } = await admin.from('email_messages').upsert(
      {
        job_id: jobId,
        connection_id: connection.id,
        direction: m.outbound ? 'outbound' : 'inbound',
        provider: connection.provider,
        provider_message_id: m.id,
        provider_thread_id: m.threadId,
        from_email: m.from,
        to_email: m.to,
        cc_email: m.cc || null,
        subject: m.subject,
        snippet: (body.snippet || m.snippet || '').slice(0, 300),
        body_text: bodyText,
        thread_key: threadKeyFor(jobId, m.subject),
        received_at: m.receivedAt,
        read: true, // historical mail should not light up unread badges
        source: 'crm_sync',
      },
      { onConflict: 'connection_id,provider_message_id', ignoreDuplicates: true }
    );
    if (error) throw new Error(`Could not save email: ${error.message}`);
    stored++;
  }
  return { scanned: messages.length, stored, incomplete: false };
}

export async function syncCrmEmail(connection, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
  if (!connection.crm_email_enabled) return { skipped: 'Email logging is off for this account.' };

  const scanner = SCANNERS[connection.provider];
  if (!scanner) return { skipped: 'Not a mail provider.' };
  if (!HAS_MAIL_SCOPE[connection.provider]?.(connection.scope)) {
    return { skipped: 'Reconnect this account in Settings to grant mail access.' };
  }

  const admin = getAdminClient();
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const totals = { scanned: 0, stored: 0, windows: 0, caughtUp: false };

  try {
    const accessToken = await getValidAccessToken(connection);
    const internalDomains = parseInternalDomains(process.env.INTERNAL_EMAIL_DOMAINS, connection.external_account_email);
    const index = await loadCrmIndex(admin, internalDomains);
    const jobCache = new Map();

    let cursor = connection.crm_email_synced_at
      ? new Date(connection.crm_email_synced_at)
      : new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);

    while (Date.now() < deadline && !totals.caughtUp) {
      const nowMs = Date.now();
      const end = new Date(Math.min(cursor.getTime() + WINDOW_MS, nowMs));
      const result = await processWindow({
        admin, connection, scanner, accessToken, index,
        ownerEmail: connection.external_account_email,
        after: cursor, before: end, deadline, jobCache,
      });
      totals.scanned += result.scanned;
      totals.stored += result.stored;
      if (result.incomplete) break; // out of time: keep the checkpoint where it is

      totals.windows++;
      totals.caughtUp = end.getTime() >= nowMs;
      cursor = totals.caughtUp ? new Date(end.getTime() - OVERLAP_MS) : end;
      await admin
        .from('integration_connections')
        .update({ crm_email_synced_at: cursor.toISOString() })
        .eq('id', connection.id);
    }

    await admin
      .from('integration_connections')
      .update({ crm_email_last_run_at: new Date().toISOString(), crm_email_last_error: null })
      .eq('id', connection.id);
    return totals;
  } catch (err) {
    await admin
      .from('integration_connections')
      .update({ crm_email_last_run_at: new Date().toISOString(), crm_email_last_error: err.message.slice(0, 500) })
      .eq('id', connection.id);
    throw err;
  }
}

export function backfillStart(days) {
  const clamped = Math.min(Math.max(Number(days) || DEFAULT_BACKFILL_DAYS, 1), 730);
  return new Date(Date.now() - clamped * 24 * 60 * 60 * 1000);
}
