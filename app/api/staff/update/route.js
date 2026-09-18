import { createClient } from '@supabase/supabase-js';
import { buildStaffInviteEmail } from '../../../../lib/emailTemplates';
import { ROLES, ROLE_LABELS } from '../../../../lib/permissions';
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

    const { accessToken, targetUserId, action, role, newPassword, fullName } = await request.json();
    if (!accessToken || !targetUserId || !action) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }

    const service = serviceClient();

    const { data: callerRow } = await service.from('staff_users').select('role, status').eq('id', caller.id).maybeSingle();
    if (!callerRow || callerRow.role !== 'owner' || callerRow.status !== 'active') {
      return Response.json({ error: 'Only an Owner can manage staff accounts.' }, { status: 403 });
    }

    const { data: targetRow } = await service.from('staff_users').select('*').eq('id', targetUserId).maybeSingle();
    if (!targetRow) {
      return Response.json({ error: 'Staff account not found.' }, { status: 404 });
    }

    // Guard against locking everyone out: don't allow demoting/disabling
    // the last active Owner.
    if (targetRow.role === 'owner' && (action === 'disable' || (action === 'set_role' && role !== 'owner'))) {
      const { count } = await service.from('staff_users').select('id', { count: 'exact', head: true }).eq('role', 'owner').eq('status', 'active');
      if ((count || 0) <= 1) {
        return Response.json({ error: 'This is the last active Owner — add another Owner before removing this one.' }, { status: 400 });
      }
    }

    if (action === 'set_role') {
      if (!ROLES.includes(role)) {
        return Response.json({ error: 'Not a valid role.' }, { status: 400 });
      }
      const { error } = await service.from('staff_users').update({ role }).eq('id', targetUserId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    } else if (action === 'disable') {
      const { error } = await service.from('staff_users').update({ status: 'disabled' }).eq('id', targetUserId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    } else if (action === 'enable') {
      const { error } = await service.from('staff_users').update({ status: 'active' }).eq('id', targetUserId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    } else if (action === 'set_password') {
      if (!newPassword || newPassword.length < 6) {
        return Response.json({ error: 'Password needs to be at least 6 characters.' }, { status: 400 });
      }
      const { error } = await service.auth.admin.updateUserById(targetUserId, { password: newPassword });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (targetRow.status === 'invited') {
        await service.from('staff_users').update({ status: 'active' }).eq('id', targetUserId);
      }
    } else if (action === 'set_full_name') {
      if (!fullName || !fullName.trim()) {
        return Response.json({ error: 'Full name is required.' }, { status: 400 });
      }
      const { error } = await service.from('staff_users').update({ full_name: fullName.trim() }).eq('id', targetUserId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    } else if (action === 'resend_invite') {
      const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com'}/login`;
      const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
        type: 'invite',
        email: targetRow.email,
        options: { redirectTo, data: { full_name: targetRow.full_name } },
      });
      if (linkError) return Response.json({ error: linkError.message }, { status: 500 });

      const { subject, html, text } = buildStaffInviteEmail({
        fullName: targetRow.full_name,
        roleLabel: ROLE_LABELS[targetRow.role],
        actionLink: linkData.properties.action_link,
      });
      await sendMail({ to: targetRow.email, subject, html, text });
    } else {
      return Response.json({ error: 'Not a valid action.' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to update staff account.' }, { status: 500 });
  }
}
