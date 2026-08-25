import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }
    const { email } = await request.json();
    const trimmedEmail = (email || '').trim();
    if (!trimmedEmail) return Response.json({ error: 'Email is required.' }, { status: 400 });

    const supabase = serviceClient();
    const { data, error } = await supabase.from('subcontractor_applications').insert({
      invited_email: trimmedEmail,
      invited_by: 'Self-service (subcontractor portal)',
      status: 'invited',
    }).select('token').single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ token: data.token });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}
