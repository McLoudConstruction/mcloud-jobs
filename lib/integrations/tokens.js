import { encrypt, decrypt } from './crypto';
import { getAdminClient } from '../supabaseAdmin';

const REFRESH_SKEW_MS = 2 * 60 * 1000; // refresh 2 min before actual expiry

async function refreshGoogle(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json();
  // Google generally doesn't return a new refresh_token on refresh —
  // keep the existing one unless a new one is actually sent.
  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in };
}

async function refreshMicrosoft(refreshToken) {
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access Calendars.ReadWrite User.Read',
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in };
}

async function refreshQuickBooks(refreshToken) {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`QuickBooks token refresh failed: ${await res.text()}`);
  const data = await res.json();
  // QBO rotates the refresh token on every use — the old one stops working.
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

const REFRESHERS = { google: refreshGoogle, microsoft: refreshMicrosoft, quickbooks: refreshQuickBooks };

// Given an integration_connections row, returns a valid plaintext access
// token — refreshing and persisting it first if it's expired or close to
// expiring. Throws if the provider requires reconnection (refresh failed).
export async function getValidAccessToken(connection) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return decrypt(connection.access_token_enc);
  }
  const refreshToken = decrypt(connection.refresh_token_enc);
  if (!refreshToken) throw new Error(`No refresh token stored for ${connection.provider} — reconnect required.`);

  const refresher = REFRESHERS[connection.provider];
  const { accessToken, refreshToken: newRefreshToken, expiresIn } = await refresher(refreshToken);

  const admin = getAdminClient();
  await admin.from('integration_connections').update({
    access_token_enc: encrypt(accessToken),
    refresh_token_enc: encrypt(newRefreshToken),
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);

  return accessToken;
}
