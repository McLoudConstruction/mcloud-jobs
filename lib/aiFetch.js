import { supabase } from './supabaseClient';

// fetch() that attaches the signed-in user's token. The staff-only AI routes
// reject any request without an active staff session. Returns the raw Response so
// callers keep their own error handling.
export async function authedFetch(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  return fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${session.access_token}` } });
}

// Client helper for the /api/ai/* routes: POSTs JSON, returns the parsed reply or throws its error message.
export async function aiFetch(path, body) {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI request failed.');
  return data;
}
