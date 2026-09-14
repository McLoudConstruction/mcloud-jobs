import { NextResponse } from 'next/server';
import { requireStaff } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { decrypt } from '../../../../lib/integrations/crypto';

// Serves the Google Maps API key to the browser for any signed-in staff
// member (not owner-only like /credentials — every staff member using
// Properties or Sales needs this to load address autocomplete). Unlike
// every other integration credential in this app, this key is INTENDED
// to reach the browser: Places Autocomplete only works loaded client-side,
// and Google's own security boundary for it is the HTTP-referrer
// restriction on the key itself (see INTEGRATIONS_SETUP.md section 8),
// not secrecy of the key string. Still gated behind a real staff session
// so it isn't a fully public endpoint.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const admin = getAdminClient();
    const { data: cred } = await admin.from('integration_credentials').select('api_key_enc').eq('provider', 'google_maps').single();
    if (!cred) return NextResponse.json({ apiKey: null });
    return NextResponse.json({ apiKey: decrypt(cred.api_key_enc) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
