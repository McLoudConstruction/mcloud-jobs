import { sendMail } from '../../../lib/sendMail';
import { logCommunication } from '../../../lib/logCommunication';
import { getAdminClient } from '../../../lib/supabaseAdmin';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
    const { to, subject, category, jobId, sentBy, html, text } = body;
    const logMeta = { category: category || 'general', toEmail: to, subject: subject || null, jobId: jobId || null, sentBy: sentBy || null };

    if (!to || !to.trim()) {
      await logCommunication({ ...logMeta, toEmail: to || '(none)', status: 'failed', errorMessage: 'No recipient email is on file.' });
      return Response.json({ error: 'No recipient email is on file for this job yet.' }, { status: 400 });
    }

    const { provider, subject: taggedSubject } = await sendMail(body);

    await logCommunication({ ...logMeta, subject: taggedSubject || logMeta.subject, status: 'sent', provider });

    // File this into the job's email thread too, not just the
    // Communications Log — this is what lets a reply arriving later sit
    // alongside the message it replied to, not just show up on its own.
    if (jobId) {
      const admin = getAdminClient();
      await admin.from('email_messages').insert({
        job_id: jobId,
        direction: 'outbound',
        from_email: process.env.SMTP_FROM || process.env.SMTP_USER || null,
        to_email: to,
        subject: taggedSubject || subject,
        snippet: (text || '').slice(0, 200),
        body_text: text || null,
        body_html: html || null,
        received_at: new Date().toISOString(),
        read: true,
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    const { to, subject, category, jobId, sentBy } = body || {};
    await logCommunication({ category: category || 'general', toEmail: to || '(none)', subject: subject || null, jobId: jobId || null, sentBy: sentBy || null, status: 'failed', errorMessage: err.message });
    return Response.json({ error: err.message || 'Failed to send email.' }, { status: 500 });
  }
}
