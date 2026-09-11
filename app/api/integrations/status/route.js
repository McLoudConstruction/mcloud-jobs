import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';

export async function GET(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = getAdminClient();
  const [{ data: connections }, { data: credentials }] = await Promise.all([
    admin.from('integration_connections').select('provider, external_account_email, external_account_label, connected_at').eq('staff_id', auth.staffId),
    admin.from('integration_credentials').select('provider, updated_at'),
  ]);

  const byProvider = {};
  for (const c of connections || []) {
    byProvider[c.provider] = { connected: true, label: c.external_account_label || c.external_account_email, connectedAt: c.connected_at };
  }
  for (const p of ['google', 'microsoft', 'quickbooks']) {
    if (!byProvider[p]) byProvider[p] = { connected: false };
  }
  for (const c of credentials || []) {
    byProvider[c.provider] = { connected: true, updatedAt: c.updated_at };
  }
  for (const p of ['resend', 'weather']) {
    if (!byProvider[p]) byProvider[p] = { connected: false };
  }

  return NextResponse.json(byProvider);
}
