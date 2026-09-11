import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { encrypt } from '../../../../lib/integrations/crypto';

export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { provider, apiKey, config } = await request.json();
  if (!['resend', 'weather'].includes(provider)) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  if (!apiKey || !apiKey.trim()) return NextResponse.json({ error: 'An API key is required.' }, { status: 400 });

  try {
    const admin = getAdminClient();
    const { error } = await admin.from('integration_credentials').upsert({
      provider,
      api_key_enc: encrypt(apiKey.trim()),
      config: config || {},
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { provider } = await request.json();
  const admin = getAdminClient();
  const { error } = await admin.from('integration_credentials').delete().eq('provider', provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
