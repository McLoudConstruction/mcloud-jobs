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
    const contactPhone = (body.contactPhone || '').trim();
    const contactEmail = (body.contactEmail || '').trim();
    const street = (body.street || '').trim();
    const unit = (body.unit || '').trim();
    const city = (body.city || '').trim();
    const state = (body.state || '').trim();
    const zip = (body.zip || '').trim();
    const servicesOffered = Array.isArray(body.servicesOffered) ? body.servicesOffered : [];
    const coiExpiresAt = body.coiExpiresAt || '';

    if (!companyName || !contactName || !contactPhone || !contactEmail || !street || !unit || !city || !state || !zip) {
      return Response.json({ error: 'All fields are required except "Anything else we should know?".' }, { status: 400 });
    }
    if (servicesOffered.length === 0) {
      return Response.json({ error: 'Please select at least one service offered.' }, { status: 400 });
    }
    if (!coiExpiresAt) {
      return Response.json({ error: 'COI expiration date is required.' }, { status: 400 });
    }
    if (!body.w9Base64 || !body.coiBase64) {
      return Response.json({ error: 'Both a W9 and a Certificate of Insurance are required.' }, { status: 400 });
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
      contact_phone: contactPhone,
      contact_email: contactEmail,
      street: street,
      unit: unit,
      city: city,
      state: state,
      zip: zip,
      services_offered: servicesOffered,
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
