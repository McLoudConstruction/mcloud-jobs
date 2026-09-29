import { NextResponse } from 'next/server';
import { requireStaff } from '../../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';
import { sendOutreachTest } from '../../../../../lib/outreach';

// "Send a test to me" from the sequence editor. Sends the step text exactly
// as typed (no need to save first) to the signed-in staff member's own email,
// from the outreach Gmail account.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const subject = String(body?.subject || '').trim();
  const bodyText = String(body?.body_text || '').trim();
  if (!subject || !bodyText) return NextResponse.json({ error: 'Add a subject and a message before sending a test.' }, { status: 400 });
  if (subject.length > 200 || bodyText.length > 10000) return NextResponse.json({ error: 'That email is too long to send as a test.' }, { status: 400 });

  try {
    const result = await sendOutreachTest(getAdminClient(), { staffId: auth.staffId, subject, bodyText });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
