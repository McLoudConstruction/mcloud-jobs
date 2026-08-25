import { createClient } from '@supabase/supabase-js';

// The marketing site lives on a different domain than jobs.mcloudconstruction.com,
// so this needs real CORS handling — browsers block cross-origin responses
// without it. Restricted to the actual marketing site domains, not '*'.
const ALLOWED_ORIGINS = [
  'https://www.mcloudconstruction.com',
  'https://mcloudconstruction.com',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request) {
  const headers = corsHeaders(request.headers.get('origin'));

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500, headers });
    }

    const body = await request.json();

    // Honeypot — a field real visitors never see or fill, but bots
    // filling every input often do. Silently accept and do nothing real,
    // rather than telling a bot its submission was rejected.
    if (body.website) {
      return Response.json({ ok: true }, { headers });
    }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const phone = (body.phone || '').trim();
    const projectType = body.projectType === 'Commercial' ? 'commercial' : 'residential';
    const company = (body.company || '').trim();
    const project = (body.project || '').trim();
    const message = (body.message || '').trim();

    if (!name || !email) {
      return Response.json({ error: 'Name and email are required.' }, { status: 400, headers });
    }

    const supabase = serviceClient();

    const { data: lead, error: leadError } = await supabase.from('opportunities').insert({
      contact_name: name,
      contact_email: email,
      contact_phone: phone || null,
      project_type: projectType,
      company: company || null,
      project: project || null,
      notes: message || null,
      stage: 'prospecting',
    }).select().single();

    if (leadError) {
      return Response.json({ error: leadError.message }, { status: 500, headers });
    }

    await supabase.from('notifications').insert({
      job_id: null,
      message: `New website consultation request from ${name}${company ? ` (${company})` : ''} — ${projectType} project. Reply to ${email}${phone ? ` or call ${phone}` : ''}.`,
    });

    return Response.json({ ok: true, leadId: lead.id }, { headers });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500, headers });
  }
}
