import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from '../supabaseAdmin';

// Verifies the bearer token on an integrations API route and confirms
// the caller is an active owner. Settings is already owner-only in the
// UI (lib/permissions.js), but these routes touch OAuth tokens and API
// keys directly, so they re-check server-side rather than trusting the
// client. Returns { staffId } on success or { error, status } on failure.
export async function requireOwner(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Not signed in.', status: 401 };

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: { user }, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !user) return { error: 'Not signed in.', status: 401 };

  const admin = getAdminClient();
  const { data: staff } = await admin.from('staff_users').select('id, role, status').eq('id', user.id).single();
  if (!staff || staff.status !== 'active' || staff.role !== 'owner') {
    return { error: 'Only an owner can manage integrations.', status: 403 };
  }
  return { staffId: user.id };
}
