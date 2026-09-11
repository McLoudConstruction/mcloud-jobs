import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../../lib/integrations/authHelper';
import { signState } from '../../../../../lib/integrations/oauthState';

export async function POST(request) {
  try {
    const auth = await requireOwner(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (!process.env.MICROSOFT_CLIENT_ID) {
      return NextResponse.json({ error: 'Microsoft integration is not configured yet — MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are missing in Vercel.' }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
    const redirectUri = `${siteUrl}/api/integrations/microsoft/callback`;
    const state = signState(auth.staffId);

    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: 'offline_access Calendars.ReadWrite User.Read',
      state,
    });

    // /common lets both personal Microsoft accounts and work/school
    // (Azure AD) accounts sign in through the same app registration.
    return NextResponse.json({ url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
