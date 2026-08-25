import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function b64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

export async function GET(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return Response.json({ error: 'Missing token.' }, { status: 400 });

    const supabase = serviceClient();
    const { data, error } = await supabase
      .from('subcontractor_applications')
      .select('token, invited_email, invited_company_hint, status, company_name, contact_name, contact_phone, contact_email, street, unit, city, state, zip, services_offered, notes')
      .eq('token', token)
      .maybeSingle();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: 'This invite link isn\'t valid.' }, { status: 404 });

    return Response.json({ application: data });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured.' }, { status: 500 });
    }

    const body = await request.json();
    const { token } = body;
    if (!token) return Response.json({ error: 'Missing token.' }, { status: 400 });

    const supabase = serviceClient();
    const { data: existing, error: findError } = await supabase
      .from('subcontractor_applications')
      .select('id, status')
      .eq('token', token)
      .maybeSingle();

    if (findError) return Response.json({ error: findError.message }, { status: 500 });
    if (!existing) return Response.json({ error: 'This invite link isn\'t valid.' }, { status: 404 });

    const companyName = (body.companyName || '').trim();
    const contactName = (body.contactName || '').trim();
    const contactEmail = (body.contactEmail || '').trim();
    if (!companyName || !contactName || !contactEmail) {
      return Response.json({ error: 'Company name, contact name, and contact email are required.' }, { status: 400 });
    }

    let w9StoragePath = null;
    let coiStoragePath = null;

    if (body.w9Base64 && body.w9Filename) {
      const path = `applications/${existing.id}/w9-${Date.now()}-${body.w9Filename}`;
      const { error: upErr } = await supabase.storage.from('subcontractor-docs').upload(path, b64ToBuffer(body.w9Base64), {
        contentType: body.w9ContentType || 'application/octet-stream',
      });
      if (!upErr) w9StoragePath = path;
    }
    if (body.coiBase64 && body.coiFilename) {
      const path = `applications/${existing.id}/coi-${Date.now()}-${body.coiFilename}`;
      const { error: upErr } = await supabase.storage.from('subcontractor-docs').upload(path, b64ToBuffer(body.coiBase64), {
        contentType: body.coiContentType || 'application/octet-stream',
      });
      if (!upErr) coiStoragePath = path;
    }

    const { error: updateError } = await supabase.from('subcontractor_applications').update({
      status: 'submitted',
      company_name: companyName,
      contact_name: contactName,
      contact_phone: (body.contactPhone || '').trim() || null,
      contact_email: contactEmail,
      street: (body.street || '').trim() || null,
      unit: (body.unit || '').trim() || null,
      city: (body.city || '').trim() || null,
      state: (body.state || '').trim() || null,
      zip: (body.zip || '').trim() || null,
      services_offered: Array.isArray(body.servicesOffered) ? body.servicesOffered : null,
      notes: (body.notes || '').trim() || null,
      ...(w9StoragePath ? { w9_storage_path: w9StoragePath } : {}),
      ...(coiStoragePath ? { coi_storage_path: coiStoragePath } : {}),
      coi_expires_at: body.coiExpiresAt || null,
      submitted_at: new Date().toISOString(),
    }).eq('id', existing.id);

    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

    await supabase.from('notifications').insert({
      job_id: null,
      message: `${companyName} submitted their subcontractor application — review it under Subcontractors.`,
    });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Something went wrong.' }, { status: 500 });
  }
}
