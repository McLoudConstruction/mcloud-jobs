import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { syncConnectionEmail } from '../../../../lib/integrations/emailSync';

// Same auth pattern as the other cron routes — Vercel Cron sends its own
// header automatically; a manual Bearer token is also accepted for testing.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set.' }, { status: 500 });
  }

  const admin = getAdminClient();
  const { data: connections } = await admin
    .from('integration_connections')
    .select('*')
    .in('provider', ['google', 'microsoft']);

  const results = [];
  for (const connection of connections || []) {
    try {
      const result = await syncConnectionEmail(connection);
      results.push({ provider: connection.provider, staff_id: connection.staff_id, ...result });
    } catch (err) {
      results.push({ provider: connection.provider, staff_id: connection.staff_id, error: err.message });
    }
  }

  return Response.json({ synced: results.length, results });
}
