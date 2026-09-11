import { createClient } from '@supabase/supabase-js';
import { issuePortalInvite } from '../../../../lib/portalInvite';

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

    const { accessToken, email, customerName, jobId } = await request.json();
    if (!accessToken || !email) {
      return Response.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Only staff can trigger an invite — never trusted from an
    // unauthenticated caller.
    const asCaller = callerClient(accessToken);
    const { data: { user: caller }, error: callerError } = await asCaller.auth.getUser();
    if (callerError || !caller) {
      return Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 });
    }
    if (caller.app_metadata?.role !== 'admin') {
      return Response.json({ error: 'Only staff can send portal invites.' }, { status: 403 });
    }

    const result = await issuePortalInvite({ email, customerName, jobId, sentByEmail: caller.email });
    if (!result.success) {
      return Response.json({ error: result.error || 'Failed to send invite.' }, { status: 500 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send invite.' }, { status: 500 });
  }
}
