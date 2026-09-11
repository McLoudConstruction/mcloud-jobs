import { NextResponse } from 'next/server';
import { verifyState } from '../../../../../lib/integrations/oauthState';
import { encrypt } from '../../../../../lib/integrations/crypto';
import { getGoogleAccountEmail } from '../../../../../lib/integrations/googleCalendar';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';

function settingsRedirect(params) {
  return NextResponse.redirect(`${siteUrl()}/settings?tab=Integrations&${new URLSearchParams(params)}`);
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return settingsRedirect({ error: `google: ${oauthError}` });

  const staffId = verifyState(state);
  if (!staffId) return settingsRedirect({ error: 'google: the connect link expired — try again' });
  if (!code) return settingsRedirect({ error: 'google: no authorization code returned' });

  try {
    const redirectUri = `${siteUrl()}/api/integrations/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      // Happens if the staff member already granted consent before and
      // Google skipped the consent screen despite prompt=consent — rare,
      // but without a refresh token the connection can't be kept alive.
      throw new Error('Google did not return a refresh token — disconnect any prior access at https://myaccount.google.com/permissions and try again.');
    }

    const email = await getGoogleAccountEmail(tokens.access_token);

    const admin = getAdminClient();
    const { error } = await admin.from('integration_connections').upsert({
      staff_id: staffId,
      provider: 'google',
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope,
      external_account_email: email,
      external_account_label: email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'staff_id,provider' });
    if (error) throw new Error(error.message);

    return settingsRedirect({ connected: 'google' });
  } catch (err) {
    return settingsRedirect({ error: `google: ${err.message}` });
  }
}
