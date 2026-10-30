import { createClient } from '@supabase/supabase-js';

// Lets any active staff member change their own display name. Everything else
// about a staff account (role, status, signature, someone else's name) stays
// Owner-managed through /api/staff/update. The staff_users table only allows
// updates from an Owner, so this goes through the service client, but only
// ever touches the caller's own row, found from their verified session.

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

    const auth = request.headers.get('authorization') || '';
    const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!accessToken) {
      return Response.json({ error: 'Not signed in.' }, { status: 401 });
    }

    const { fullName } = await request.json();
    const name = (fullName || '').trim().replace(/\s+/g, ' ');
    if (!name) {
      return Response.json({ error: 'Name is required.' }, { status: 400 });
    }
    if (name.length > 100) {
      return Response.json({ error: 'Name is too long.' }, { status: 400 });
    }

    const { data: { user }, error: userError } = await callerClient(accessToken).auth.getUser();
    if (userError || !user) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }

    const service = serviceClient();
    const { data: row } = await service.from('staff_users').select('status').eq('id', user.id).maybeSingle();
    if (!row || row.status === 'disabled') {
      return Response.json({ error: 'No active staff account for this login.' }, { status: 403 });
    }

    const { error } = await service.from('staff_users').update({ full_name: name }).eq('id', user.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ success: true, fullName: name });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to update your name.' }, { status: 500 });
  }
}
