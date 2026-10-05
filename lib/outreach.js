import { getValidAccessToken } from './integrations/tokens';
import { sendGmail, getThreadReplyStatus } from './integrations/gmailSend';
import { logCommunication } from './logCommunication';

const SEND_TIME_BUDGET_MS = 40000;
const SEND_PAUSE_MIN_MS = 800;
const SEND_PAUSE_JITTER_MS = 1700;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── Merge tags ─────────────────────────────────────────────────────────
// Sequence step subjects/bodies can use {{first_name}}, {{property_name}}
// and {{sender_name}}. Anything else in double braces is removed rather
// than sent literally to a prospect.
export function renderMergeTags(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
    const v = vars[key.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

const TITLES = /^(pastor|rev\.?|reverend|father|fr\.?|dr\.?|mr\.?|mrs\.?|ms\.?|deacon|elder|bishop|sister|brother)$/i;

// "Jane Smith" -> "Jane"; "Pastor John Smith" -> "Pastor Smith"; an email
// address or empty name -> '' (the caller falls back to "there").
export function greetingName(toName) {
  const name = String(toName || '').trim();
  if (!name || name.includes('@')) return '';
  const tokens = name.split(/\s+/);
  if (TITLES.test(tokens[0]) && tokens.length > 1) {
    const title = tokens[0].replace(/^./, c => c.toUpperCase());
    return `${title} ${tokens[tokens.length - 1]}`;
  }
  return tokens[0].replace(/^./, c => c.toUpperCase());
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function signatureToPlainText(signatureHtml) {
  return signatureHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

// Plain-text body -> the two MIME parts, with the staff signature, the
// business mailing address and an unsubscribe line (CAN-SPAM) appended.
export function composeBody({ body, unsubscribeUrl, postalAddress, signatureHtml }) {
  const paragraphs = body.trim().split(/\n{2,}/).map(p => `<p style="margin: 0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  const sig = signatureHtml
    ? `<div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e0d3; font-size: 13px; color: #4a4436;">${signatureHtml}</div>`
    : '';
  const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #222;">
${paragraphs}
${sig}
<p style="margin: 24px 0 0; font-size: 11.5px; color: #8a8478;">${escapeHtml(postalAddress).replace(/\n/g, '<br>')}<br>Not interested? <a href="${unsubscribeUrl}" style="color: #8a8478;">Unsubscribe</a>.</p>
</div>`;
  const text = [
    body.trim(),
    signatureHtml ? `\n${signatureToPlainText(signatureHtml)}` : '',
    `\n${postalAddress}\nNot interested? Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');
  return { html, text };
}

// ─── Sender ─────────────────────────────────────────────────────────────
// Finds the connected Google account outreach sends from (the address saved
// in Outreach settings), checks it can send, and returns a fresh access
// token plus the staff member's name and signature. Returns { error } with a
// plain-language reason instead of throwing when something needs fixing.
export async function resolveOutreachSender(admin, settings) {
  if (!settings.outreach_from_email?.trim()) return { error: 'Choose the Gmail account outreach sends from in Outreach settings.' };
  const { data: connections, error: connErr } = await admin.from('integration_connections').select('*').eq('provider', 'google');
  if (connErr) throw new Error(`Connection query failed: ${connErr.message}`);
  const mailbox = settings.outreach_from_email.trim().toLowerCase();
  const conn = (connections || []).find(c => (c.external_account_email || '').toLowerCase() === mailbox);
  if (!conn) return { error: `${settings.outreach_from_email} is not connected. Connect it under Settings → Integrations → Google.` };
  if (!(conn.scope || '').includes('gmail.send')) return { error: 'The Google connection needs permission to send mail. Reconnect Google under Settings → Integrations.' };

  const accessToken = await getValidAccessToken(conn);
  const { data: staff } = await admin.from('staff_users').select('full_name, signature_html').eq('id', conn.staff_id).maybeSingle();
  const senderName = staff?.full_name || settings.outreach_from_name || 'McLoud Construction';
  return { conn, accessToken, staff, senderName };
}

// ─── Test send ──────────────────────────────────────────────────────────
// Sends one step's current text (saved or not) to the signed-in staff member
// so they can see exactly what a prospect would get: sample merge values, the
// real signature and footer, a "[TEST]" subject. Works whether or not
// outreach is switched on, and never touches any enrollment.
export async function sendOutreachTest(admin, { staffId, subject, bodyText }) {
  const { data: s, error: settingsErr } = await admin
    .from('app_settings')
    .select('outreach_from_name, outreach_from_email, outreach_postal_address')
    .eq('id', 1)
    .maybeSingle();
  if (settingsErr) throw new Error(`Outreach settings query failed: ${settingsErr.message}`);

  const sender = await resolveOutreachSender(admin, s || {});
  if (sender.error) throw new Error(sender.error);
  const { conn, accessToken, staff, senderName } = sender;

  const { data: me } = await admin.from('staff_users').select('email').eq('id', staffId).maybeSingle();
  if (!me?.email) throw new Error('Your staff account has no email address to send the test to.');

  const vars = { first_name: 'Pastor Smith', property_name: 'First Baptist Church', sender_name: senderName };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
  const { text, html } = composeBody({
    body: renderMergeTags(bodyText, vars),
    // A dummy token: the page loads, but it can't unsubscribe anyone.
    unsubscribeUrl: `${siteUrl}/api/public/outreach-unsubscribe?t=00000000-0000-0000-0000-000000000000`,
    postalAddress: s?.outreach_postal_address?.trim() || '[Your business mailing address will appear here. Add it in Outreach settings.]',
    signatureHtml: staff?.signature_html || null,
  });
  const finalSubject = `[TEST] ${renderMergeTags(subject, vars)}`;
  await sendGmail(accessToken, {
    fromName: s?.outreach_from_name || senderName,
    fromEmail: conn.external_account_email,
    to: me.email,
    subject: finalSubject,
    text,
    html,
  });
  await logCommunication({ category: 'outreach_test', toEmail: me.email, subject: finalSubject, sentBy: conn.external_account_email, status: 'sent', provider: 'gmail' });
  return { sentTo: me.email };
}

// ─── Daily run ──────────────────────────────────────────────────────────
// Called from /api/cron/daily-automations. Everything that decides *whether*
// something is due (daily cap, suppression list, do-not-contact, task steps,
// completing finished sequences) lives in the database functions from
// migration 140; this function only does the parts that need the network:
// checking Gmail for replies, sending, and reporting each result back.
export async function runDailyOutreach(admin) {
  const out = { sent: 0, failed: 0, replied: 0, bounced: 0, deferred: 0, errors: [] };

  const { data: s, error: settingsErr } = await admin
    .from('app_settings')
    .select('outreach_enabled, outreach_from_name, outreach_from_email, outreach_postal_address')
    .eq('id', 1)
    .maybeSingle();
  if (settingsErr) throw new Error(`Outreach settings query failed: ${settingsErr.message}`);
  if (!s?.outreach_enabled) return { ...out, status: 'disabled' };

  const blocked = reason => ({ ...out, status: 'blocked', errors: [reason] });
  if (!s.outreach_postal_address?.trim()) return blocked('Add a business mailing address in Outreach settings. It is required in commercial email.');
  const sender = await resolveOutreachSender(admin, s);
  if (sender.error) return blocked(sender.error);
  const { conn, accessToken, staff, senderName } = sender;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';

  const { data: due, error: claimErr } = await admin.rpc('claim_outreach_sends', {});
  if (claimErr) throw new Error(`claim_outreach_sends failed: ${claimErr.message}`);

  // If a bounce check paused sending (migration 152), say so in the daily
  // report. The claim above already returned no emails in that case.
  const { data: pauseState } = await admin.from('app_settings').select('outreach_paused_at, outreach_paused_reason').eq('id', 1).maybeSingle();
  if (pauseState?.outreach_paused_at) {
    out.status = 'paused';
    out.errors.push(`Outreach is paused. ${pauseState.outreach_paused_reason || ''}`.trim());
  }

  // The daily run has about a minute. Stop starting new sends once the time
  // budget is spent and hand the rest back, so they go out first next run
  // instead of sitting out their 6 hour lease.
  const startedAt = Date.now();
  const rows = due || [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (Date.now() - startedAt > SEND_TIME_BUDGET_MS) {
      for (const rest of rows.slice(i)) {
        await admin.rpc('release_outreach_claim', { p_enrollment_id: rest.enrollment_id });
        out.deferred += 1;
      }
      out.errors.push(`Ran out of time. ${out.deferred} email${out.deferred === 1 ? '' : 's'} will go out first on the next run.`);
      break;
    }
    // 1) Has this person already answered (or bounced) an earlier email?
    //    Checked right before each send, which is the moment it matters.
    let stopReason = null;
    try {
      const { data: prior } = await admin
        .from('outreach_events')
        .select('provider_message_id')
        .eq('enrollment_id', row.enrollment_id)
        .eq('event_type', 'sent');
      for (const ev of prior || []) {
        const threadId = (ev.provider_message_id || '').split(':')[1];
        if (!threadId) continue;
        const status = await getThreadReplyStatus(accessToken, threadId, conn.external_account_email);
        if (status !== 'none') { stopReason = status; break; }
      }
      if (stopReason) {
        const { error } = await admin.rpc('stop_outreach', { p_email: row.to_email, p_reason: stopReason });
        if (error) throw new Error(error.message);
        out[stopReason] += 1;
        continue;
      }
    } catch (err) {
      // Can't tell whether they replied — don't risk a second email. The
      // enrollment stays leased and is picked up again on a later run.
      out.errors.push(`Reply check for ${row.to_email}: ${err.message}`);
      continue;
    }

    // 2) Send.
    let subject = row.subject;
    try {
      const vars = {
        first_name: greetingName(row.to_name) || 'there',
        property_name: row.property_name || 'your organization',
        sender_name: senderName,
      };
      subject = renderMergeTags(row.subject, vars);
      const unsubscribeUrl = `${siteUrl}/api/public/outreach-unsubscribe?t=${row.unsubscribe_token}`;
      const { text, html } = composeBody({
        body: renderMergeTags(row.body_text, vars),
        unsubscribeUrl,
        postalAddress: s.outreach_postal_address.trim(),
        signatureHtml: staff?.signature_html || null,
      });
      const { messageId, threadId } = await sendGmail(accessToken, {
        fromName: s.outreach_from_name || senderName,
        fromEmail: conn.external_account_email,
        to: row.to_email,
        subject,
        text,
        html,
        extraHeaders: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      // Stored as "<message id>:<thread id>" so the next run can look the thread up.
      const { error: finishErr } = await admin.rpc('finish_outreach_send', {
        p_enrollment_id: row.enrollment_id,
        p_ok: true,
        p_provider_message_id: `${messageId}:${threadId}`,
      });
      if (finishErr) out.errors.push(`Sent to ${row.to_email} but could not record it: ${finishErr.message}`);
      await logCommunication({ category: 'outreach', toEmail: row.to_email, subject, sentBy: conn.external_account_email, status: 'sent', provider: 'gmail' });
      out.sent += 1;
      // A short random pause between sends, so a batch does not leave the
      // mailbox in one burst. (One daily run cannot spread sends across the
      // day; that would need a more frequent trigger.)
      if (i < rows.length - 1) await sleep(SEND_PAUSE_MIN_MS + Math.random() * SEND_PAUSE_JITTER_MS);
    } catch (err) {
      out.failed += 1;
      out.errors.push(`Send to ${row.to_email}: ${err.message}`);
      await admin.rpc('finish_outreach_send', { p_enrollment_id: row.enrollment_id, p_ok: false, p_error: err.message });
      await logCommunication({ category: 'outreach', toEmail: row.to_email, subject, sentBy: conn.external_account_email, status: 'failed', errorMessage: err.message, provider: 'gmail' });
    }
  }

  return out;
}
