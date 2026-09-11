import { NextResponse } from 'next/server';
import { verifyState } from '../../../../../lib/integrations/oauthState';
import { encrypt } from '../../../../../lib/integrations/crypto';
import { getMicrosoftAccountEmail } from '../../../../../lib/integrations/microsoftCalendar';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';

function settingsRedirect(params) {
  return NextResponse.redirect(`${siteUrl()}/settings?tab=Integrations&${new URLSearchParams(params)}`);
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');

  if (oauthError) return settingsRedirect({ error: `microsoft: ${oauthError}` });

  const staffId = verifyState(state);
  if (!staffId) return settingsRedirect({ error: 'microsoft: the connect link expired — try again' });
  if (!code) return settingsRedirect({ error: 'microsoft: no authorization code returned' });

  try {
    const redirectUri = `${siteUrl()}/api/integrations/microsoft/callback`;
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) throw new Error('Microsoft did not return a refresh token — try connecting again.');

    const email = await getMicrosoftAccountEmail(tokens.access_token);

    const admin = getAdminClient();
    const { error } = await admin.from('integration_connections').upsert({
      staff_id: staffId,
      provider: 'microsoft',
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

    return settingsRedirect({ connected: 'microsoft' });
  } catch (err) {
    return settingsRedirect({ error: `microsoft: ${err.message}` });
  }
}
