import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { syncCrmEmail, backfillStart } from '../../../../lib/integrations/crmEmailSync';

// Manual sync can take a while on the first run (it backfills history), so
// give it the longest time Vercel's Hobby plan allows. The sync itself stops
// at 45 seconds and resumes from its checkpoint on the next call.
export const maxDuration = 60;

const MAIL_PROVIDERS = ['google', 'microsoft'];

async function ownConnection(admin, staffId, provider) {
  const { data } = await admin
    .from('integration_connections')
    .select('*')
    .eq('staff_id', staffId)
    .eq('provider', provider)
    .maybeSingle();
  return data;
}

// Status for the Settings card: one entry per connected mail account.
export async function GET(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('integration_connections')
    .select('provider, scope, external_account_email, crm_email_enabled, crm_email_synced_at, crm_email_last_run_at, crm_email_last_error')
    .eq('staff_id', auth.staffId)
    .in('provider', MAIL_PROVIDERS);

  if (error) {
    const hint = /crm_email/.test(error.message) ? ' Run migration 154 in the Supabase SQL Editor first.' : '';
    return NextResponse.json({ error: error.message + hint }, { status: 500 });
  }

  const accounts = (data || []).map(c => ({
    provider: c.provider,
    email: c.external_account_email,
    hasMailScope: c.provider === 'google' ? (c.scope || '').includes('gmail.readonly') : (c.scope || '').includes('Mail.Read'),
    enabled: c.crm_email_enabled,
    syncedUpTo: c.crm_email_synced_at,
    lastRunAt: c.crm_email_last_run_at,
    lastError: c.crm_email_last_error,
  }));
  return NextResponse.json({ accounts });
}

// Body: { action: 'enable' | 'disable' | 'sync_now', provider, backfillDays? }
export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const { action, provider } = body || {};
  if (!MAIL_PROVIDERS.includes(provider)) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });

  const admin = getAdminClient();
  const connection = await ownConnection(admin, auth.staffId, provider);
  if (!connection) return NextResponse.json({ error: 'That account is not connected.' }, { status: 400 });

  if (action === 'enable') {
    const { error } = await admin
      .from('integration_connections')
      .update({
        crm_email_enabled: true,
        crm_email_synced_at: backfillStart(body.backfillDays).toISOString(),
        crm_email_last_error: null,
      })
      .eq('id', connection.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'disable') {
    // Mail already logged stays on the records. This only stops new syncing.
    const { error } = await admin.from('integration_connections').update({ crm_email_enabled: false }).eq('id', connection.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'sync_now') {
    try {
      const result = await syncCrmEmail(connection);
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
