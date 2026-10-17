import { requireStaff } from '../../../lib/integrations/authHelper';

export const dynamic = 'force-dynamic';

// Looks up the combined sales tax rate for a ZIP code (API Ninjas).
// Staff only. Needs API_NINJAS_KEY in the environment.
// Returns { percent, zip } or { error }. Never returns the key.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });

  const key = process.env.API_NINJAS_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 200 });

  const zip = String(new URL(request.url).searchParams.get('zip') || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) return Response.json({ error: 'Enter a 5 digit ZIP code.' }, { status: 400 });

  try {
    const res = await fetch(`https://api.api-ninjas.com/v1/salestax?zip_code=${zip}`, { headers: { 'X-Api-Key': key } });
    if (!res.ok) return Response.json({ error: 'Rate lookup failed.' }, { status: 502 });
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const rate = row ? parseFloat(row.total_rate) : NaN;
    if (!isFinite(rate)) return Response.json({ error: 'No rate found for that ZIP.' }, { status: 404 });
    return Response.json({ zip, percent: Math.round(rate * 100000) / 1000 });
  } catch {
    return Response.json({ error: 'Rate lookup failed.' }, { status: 502 });
  }
}
