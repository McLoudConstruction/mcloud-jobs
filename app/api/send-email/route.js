import { sendMail } from '../../../lib/sendMail';
import { logCommunication } from '../../../lib/logCommunication';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
    const { to, subject, category, jobId, sentBy } = body;
    const logMeta = { category: category || 'general', toEmail: to, subject: subject || null, jobId: jobId || null, sentBy: sentBy || null };

    if (!to || !to.trim()) {
      await logCommunication({ ...logMeta, toEmail: to || '(none)', status: 'failed', errorMessage: 'No recipient email is on file.' });
      return Response.json({ error: 'No recipient email is on file for this job yet.' }, { status: 400 });
    }

    const { provider } = await sendMail(body);

    await logCommunication({ ...logMeta, status: 'sent', provider });
    return Response.json({ success: true });
  } catch (err) {
    const { to, subject, category, jobId, sentBy } = body || {};
    await logCommunication({ category: category || 'general', toEmail: to || '(none)', subject: subject || null, jobId: jobId || null, sentBy: sentBy || null, status: 'failed', errorMessage: err.message });
    return Response.json({ error: err.message || 'Failed to send email.' }, { status: 500 });
  }
}
