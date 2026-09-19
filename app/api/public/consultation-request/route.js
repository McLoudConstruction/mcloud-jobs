import { createClient } from '@supabase/supabase-js';

// The marketing site lives on a different domain than jobs.mcloudconstruction.com,
// so this needs real CORS handling — browsers block cross-origin responses
// without it. Restricted to the actual marketing site domains, not '*'.
const ALLOWED_ORIGINS = [
  'https://www.mcloudconstruction.com',
  'https://mcloudconstruction.com',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // The site's Consultation form now sends multipart/form-data (so it can
    // attach photo files) instead of JSON. Support both — form-data because
    // that's what the current form sends, JSON kept for any other caller
    // still posting plain fields.
    const contentType = request.headers.get('content-type') || '';
    let body = {};
    let files = [];
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (key === 'photos') {
          if (value instanceof File && value.size > 0) files.push(value);
        } else {
          body[key] = value;
        }
      }
    } else {
      body = await request.json();
    }

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
    if (!EMAIL_PATTERN.test(email)) {
      return Response.json({ error: 'Enter a valid email address.' }, { status: 400, headers });
    }
    // Same 10-digit requirement as the form's own client-side check —
    // enforced again here since this endpoint is public and callable
    // directly, not just from the form.
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length !== 10) {
      return Response.json({ error: 'Enter a valid 10-digit phone number.' }, { status: 400, headers });
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

    // Upload any attached photos to their own private bucket, keyed by
    // this lead's id (there's no job yet for this to live under
    // job_photos). Best-effort — a photo upload failure shouldn't lose
    // the lead itself, which is the important part.
    let uploadedCount = 0;
    for (const file of files) {
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${lead.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const arrayBuffer = await file.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from('consultation-photos')
          .upload(path, arrayBuffer, { contentType: file.type || 'image/jpeg' });
        if (!uploadError) {
          await supabase.from('opportunity_photos').insert({ opportunity_id: lead.id, storage_path: path });
          uploadedCount += 1;
        }
      } catch {
        // Skip this file, keep going — one bad file shouldn't fail the rest.
      }
    }

    await supabase.from('notifications').insert({
      job_id: null,
      message: `New website consultation request from ${name}${company ? ` (${company})` : ''} — ${projectType} project. Reply to ${email}${phone ? ` or call ${phone}` : ''}.${uploadedCount ? ` (${uploadedCount} photo${uploadedCount === 1 ? '' : 's'} attached)` : ''}`,
    });

    return Response.json({ ok: true, leadId: lead.id }, { headers });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500, headers });
  }
}
