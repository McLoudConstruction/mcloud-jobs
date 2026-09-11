import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { provider } = await request.json();
  if (!['google', 'microsoft', 'quickbooks'].includes(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from('integration_connections').delete().eq('staff_id', auth.staffId).eq('provider', provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
