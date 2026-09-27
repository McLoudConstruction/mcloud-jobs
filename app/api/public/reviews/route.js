import { createClient } from '@supabase/supabase-js';

// Feed for the marketing site (mcloudconstruction.com). Returns the published,
// customer-approved reviews plus the honest aggregate — the count and average
// cover EVERY review received, not just the published ones. Cross-origin, so it
// needs CORS; restricted to the real site domains, never '*'.
const ALLOWED_ORIGINS = ['https://www.mcloudconstruction.com', 'https://mcloudconstruction.com'];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function GET(request) {
  const headers = corsHeaders(request.headers.get('origin'));
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'Server not configured.' }, { status: 500, headers });
  const limit = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('limit') || '12', 10) || 12, 1), 50);
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await admin.rpc('get_published_reviews', { max_n: limit });
    if (error) throw new Error(error.message);
    return Response.json(data, { headers: { ...headers, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (err) {
    console.error('Public reviews feed failed:', err.message);
    return Response.json({ error: 'Unavailable.' }, { status: 500, headers });
  }
}
