import { NextResponse } from 'next/server';
import { verifyState } from '../../../../../lib/integrations/oauthState';
import { encrypt } from '../../../../../lib/integrations/crypto';
import { getCompanyName } from '../../../../../lib/integrations/quickbooks';
import { getAdminClient } from '../../../../../lib/supabaseAdmin';

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';

function settingsRedirect(params) {
  return NextResponse.redirect(`${siteUrl()}/settings?tab=Integrations&${new URLSearchParams(params)}`);
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const oauthError = url.searchParams.get('error');

  if (oauthError) return settingsRedirect({ error: `quickbooks: ${oauthError}` });

  const staffId = verifyState(state);
  if (!staffId) return settingsRedirect({ error: 'quickbooks: the connect link expired — try again' });
  if (!code || !realmId) return settingsRedirect({ error: 'quickbooks: missing authorization code or company id' });

  try {
    const redirectUri = `${siteUrl()}/api/integrations/quickbooks/callback`;
    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = await tokenRes.json();

    let companyName = null;
    try { companyName = await getCompanyName(tokens.access_token, realmId); } catch { /* non-fatal — connection still saves */ }

    const admin = getAdminClient();
    const { error } = await admin.from('integration_connections').upsert({
      staff_id: staffId,
      provider: 'quickbooks',
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scope: tokens.scope || 'com.intuit.quickbooks.accounting',
      external_account_id: realmId,
      external_account_label: companyName,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'staff_id,provider' });
    if (error) throw new Error(error.message);

    return settingsRedirect({ connected: 'quickbooks' });
  } catch (err) {
    return settingsRedirect({ error: `quickbooks: ${err.message}` });
  }
}
