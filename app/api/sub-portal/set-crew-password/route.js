import { createClient } from '@supabase/supabase-js';

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
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }

    const { accessToken, targetEmail, newPassword } = await request.json();
    if (!accessToken || !targetEmail || !newPassword) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return Response.json({ error: 'Password needs to be at least 6 characters.' }, { status: 400 });
    }

    // Confirm the caller is who they say they are.
    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller?.email) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }

    const service = serviceClient();

    // Confirm the caller is an Owner/Manager, and that the target is a
    // teammate at the same company — both checked with the real data,
    // not trusted from the client.
    const { data: callerRow } = await service.from('sub_portal_users').select('company_id, role').ilike('email', caller.email).maybeSingle();
    if (!callerRow || callerRow.role !== 'admin') {
      return Response.json({ error: 'Only an Owner/Manager login can set passwords for teammates.' }, { status: 403 });
    }

    const { data: targetRow } = await service.from('sub_portal_users').select('company_id, email').ilike('email', targetEmail).maybeSingle();
    if (!targetRow || targetRow.company_id !== callerRow.company_id) {
      return Response.json({ error: 'That login is not part of your team.' }, { status: 403 });
    }

    const { data: targetUserId, error: lookupError } = await service.rpc('get_user_id_by_email', { lookup_email: targetRow.email });
    if (lookupError || !targetUserId) {
      return Response.json({ error: "Couldn't find that account — they may not have signed in yet to create it." }, { status: 404 });
    }

    const { error: updateError } = await service.auth.admin.updateUserById(targetUserId, { password: newPassword });
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}
