import { createClient } from '@supabase/supabase-js';

// Validates an activation token (GET) and completes account setup by
// setting a password (POST). Both run entirely server-side with the
// service-role key — the customer has no session yet when they land on
// this page, so there's nothing else that could authorize this. The
// portal_accounts table itself has no client-readable policy at all (see
// migration 094); this route is the only way to read or act on a token.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function lookupValidToken(service, token) {
  const { data, error } = await service.from('portal_accounts').select('*').eq('invite_token', token).maybeSingle();
  if (error || !data) return { valid: false, reason: 'not_found' };
  if (data.activated_at) return { valid: false, reason: 'already_activated', account: data };
  if (!data.invite_token_expires_at || new Date(data.invite_token_expires_at) < new Date()) {
    return { valid: false, reason: 'expired', account: data };
  }
  return { valid: true, account: data };
}

export async function GET(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return Response.json({ valid: false, reason: 'missing' });

    const service = serviceClient();
    const result = await lookupValidToken(service, token);
    if (!result.valid) return Response.json({ valid: false, reason: result.reason });

    return Response.json({ valid: true, email: result.account.email });
  } catch (err) {
    return Response.json({ valid: false, reason: 'error', error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }
    const { token, password } = await request.json();
    if (!token || !password) {
      return Response.json({ error: 'Missing token or password.' }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json({ error: 'Password needs to be at least 6 characters.' }, { status: 400 });
    }

    const service = serviceClient();
    const result = await lookupValidToken(service, token);
    if (!result.valid) {
      const message = result.reason === 'expired'
        ? 'This activation link has expired — ask us to send a new one.'
        : result.reason === 'already_activated'
          ? 'This account is already set up — sign in instead.'
          : "We couldn't find that activation link.";
      return Response.json({ error: message, reason: result.reason }, { status: 400 });
    }

    const email = result.account.email;
    let userId;

    // Create the auth user if they don't have one yet; if they do (e.g.
    // a returning customer being invited to a new job, or a re-sent
    // invite), fall through to fetching their existing id instead.
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created?.user) {
      userId = created.user.id;
    } else if (createError && /already\s+(?:been\s+)?registered|already exists/i.test(createError.message || '')) {
      // generateLink with type 'recovery' works against an existing,
      // already-confirmed user and hands back their id without sending
      // anything or requiring the returned link — same trick already used
      // for admin-side invites elsewhere in this app.
      const { data: linkData, error: linkError } = await service.auth.admin.generateLink({ type: 'recovery', email });
      if (linkError || !linkData?.user) {
        return Response.json({ error: linkError?.message || 'Could not locate the existing account.' }, { status: 500 });
      }
      userId = linkData.user.id;
      const { error: updateError } = await service.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 });
      }
    } else if (createError) {
      return Response.json({ error: createError.message }, { status: 500 });
    }

    const { error: activateError } = await service.from('portal_accounts').update({
      activated_at: new Date().toISOString(),
      invite_token: null,
      invite_token_expires_at: null,
    }).eq('id', result.account.id);
    if (activateError) {
      // The auth account is already set up at this point — don't block the
      // customer over a bookkeeping write. They'll just show as
      // not-yet-activated in the Portal Access panel, which is cosmetic.
      console.error('Failed to mark portal_accounts activated:', activateError.message);
    }

    return Response.json({ success: true, email });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to set up your account.' }, { status: 500 });
  }
}
