import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../../lib/integrations/authHelper';
import { signState } from '../../../../../lib/integrations/oauthState';

export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.QBO_CLIENT_ID) {
    return NextResponse.json({ error: 'QuickBooks integration is not configured yet — QBO_CLIENT_ID / QBO_CLIENT_SECRET are missing in Vercel.' }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
  const redirectUri = `${siteUrl}/api/integrations/quickbooks/callback`;
  const state = signState(auth.staffId);

  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state,
  });

  return NextResponse.json({ url: `https://appcenter.intuit.com/connect/oauth2?${params}` });
}
