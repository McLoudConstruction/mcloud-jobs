import { NextResponse } from 'next/server';
import { requireOwner } from '../../../../lib/integrations/authHelper';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { syncConnection } from '../../../../lib/integrations/calendarSync';

export async function POST(request) {
  const auth = await requireOwner(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = getAdminClient();
  const { data: connections } = await admin
    .from('integration_connections')
    .select('*')
    .eq('staff_id', auth.staffId)
    .in('provider', ['google', 'microsoft']);

  if (!connections || connections.length === 0) {
    return NextResponse.json({ error: 'No calendar is connected yet.' }, { status: 400 });
  }

  const results = [];
  for (const connection of connections) {
    try {
      results.push({ provider: connection.provider, ...(await syncConnection(connection)) });
    } catch (err) {
      results.push({ provider: connection.provider, error: err.message });
    }
  }

  return NextResponse.json({ results });
}
