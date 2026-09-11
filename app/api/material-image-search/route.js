import { NextResponse } from 'next/server';
import { getAdminClient } from '../../../lib/supabaseAdmin';
import { decrypt } from '../../../lib/integrations/crypto';

// Any signed-in staff member can search — this only returns public stock
// photo results, nothing sensitive. Requires an owner to have saved an
// Unsplash API key in Settings → Integrations first.
export async function GET(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  if (!q || !q.trim()) return NextResponse.json({ error: 'Search term is required.' }, { status: 400 });

  const admin = getAdminClient();
  const { data: cred } = await admin.from('integration_credentials').select('api_key_enc').eq('provider', 'unsplash').single();
  if (!cred) return NextResponse.json({ error: 'Image search is not configured yet — add an Unsplash API key in Settings → Integrations.' }, { status: 400 });

  const apiKey = decrypt(cred.api_key_enc);
  const params = new URLSearchParams({ query: q.trim(), per_page: '15', orientation: 'squarish' });
  const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${apiKey}` },
  });
  if (!res.ok) return NextResponse.json({ error: `Image search failed: ${await res.text()}` }, { status: 502 });
  const data = await res.json();

  const results = (data.results || []).map(p => ({
    id: p.id,
    thumbUrl: p.urls?.small,
    fullUrl: p.urls?.regular,
    altDescription: p.alt_description || q,
    photographer: p.user?.name,
    photographerUrl: p.user?.links?.html,
  }));

  return NextResponse.json({ results });
}
