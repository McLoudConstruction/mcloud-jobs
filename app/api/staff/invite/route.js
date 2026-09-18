import { createClient } from '@supabase/supabase-js';
import { buildStaffInviteEmail } from '../../../../lib/emailTemplates';
import { ROLES, ROLE_LABELS } from '../../../../lib/permissions';
import { logCommunication } from '../../../../lib/logCommunication';
import { sendMail } from '../../../../lib/sendMail';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function callerClient(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }

    const { accessToken, email, fullName, role, method, tempPassword } = await request.json();
    if (!accessToken || !email || !fullName || !role || !method) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }
    if (!ROLES.includes(role)) {
      return Response.json({ error: 'Not a valid role.' }, { status: 400 });
    }
    if (!['email_invite', 'temp_password'].includes(method)) {
      return Response.json({ error: 'Not a valid setup method.' }, { status: 400 });
    }
    if (method === 'temp_password' && (!tempPassword || tempPassword.length < 6)) {
      return Response.json({ error: 'Temporary password needs to be at least 6 characters.' }, { status: 400 });
    }

    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }

    const service = serviceClient();

    const { data: callerRow } = await service.from('staff_users').select('role, status').eq('id', caller.id).maybeSingle();
    if (!callerRow || callerRow.role !== 'owner' || callerRow.status !== 'active') {
      return Response.json({ error: 'Only an Owner can add staff accounts.' }, { status: 403 });
    }

    let userId;

    if (method === 'temp_password') {
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        app_metadata: { role: 'admin' },
        user_metadata: { full_name: fullName },
      });
      if (createError) {
        if (/already\s+(?:been\s+)?registered|already exists/i.test(createError.message || '')) {
          return Response.json({ error: 'A user with that email already exists.' }, { status: 409 });
        }
        return Response.json({ error: createError.message }, { status: 500 });
      }
      userId = created.user.id;
    } else {
      const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com'}/login`;
      const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo, data: { full_name: fullName } },
      });
      if (linkError) {
        if (/already\s+(?:been\s+)?registered|already exists/i.test(linkError.message || '')) {
          return Response.json({ error: 'A user with that email already exists.' }, { status: 409 });
        }
        return Response.json({ error: linkError.message }, { status: 500 });
      }
      userId = linkData.user.id;

      // Invite emails go out through sendMail() — Resend when configured,
      // SMTP as a fallback — rather than Supabase's rate-limited built-in
      // mailer or a hand-rolled SMTP-only send. Same reasoning as the
      // customer portal invite route.
      await service.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } });

      const { subject, html, text } = buildStaffInviteEmail({
        fullName,
        roleLabel: ROLE_LABELS[role],
        actionLink: linkData.properties.action_link,
      });
      try {
        const { provider } = await sendMail({ to: email, subject, html, text });
        await logCommunication({ category: 'staff_invite', toEmail: email, subject, sentBy: caller.email, status: 'sent', provider });
      } catch (sendErr) {
        await logCommunication({ category: 'staff_invite', toEmail: email, subject, sentBy: caller.email, status: 'failed', errorMessage: sendErr.message, provider: 'unknown' });
        throw sendErr;
      }
    }

    const { error: insertError } = await service.from('staff_users').insert({
      id: userId,
      email,
      full_name: fullName,
      role,
      status: method === 'temp_password' ? 'active' : 'invited',
      invited_by: caller.id,
    });
    if (insertError) {
      return Response.json({ error: `Account created but failed to save staff record: ${insertError.message}` }, { status: 500 });
    }

    return Response.json({ success: true, userId });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to add staff account.' }, { status: 500 });
  }
}
