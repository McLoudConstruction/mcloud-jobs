import { createClient } from '@supabase/supabase-js';

// Service-role client for server routes with no logged-in session (cron
// jobs) or that must bypass RLS by design — the integration tables have
// no client policies at all, so every read/write to a token or API key
// goes through here. Never import this from a client component.
export function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
