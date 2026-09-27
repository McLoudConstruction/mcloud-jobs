import { supabase } from './supabaseClient';

// Client helper for the staff-only /api/ai/* routes: attaches the signed-in
// user's token (the server rejects anything without an active staff session).
export async function aiFetch(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI request failed.');
  return data;
}
