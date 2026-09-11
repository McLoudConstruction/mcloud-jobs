import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../../lib/integrations/authHelper';
import { signState } from '../../../../../lib/integrations/oauthState';

// POST (not GET) so the client can send the Authorization header — this
// app's session lives in localStorage, not a cookie, so a plain <a>
// navigation has no way to prove who's asking. The client fetches this,
// then does window.location.href = url itself.
export async function POST(request) {
  try {
    const auth = await requireOwner(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (!process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.json({ error: 'Google integration is not configured yet — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing in Vercel.' }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jobs.mcloudconstruction.com';
    const redirectUri = `${siteUrl}/api/integrations/google/callback`;
    const state = signState(auth.staffId);

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent', // forces a refresh_token on every connect, not just the first
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
      state,
    });

    return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
