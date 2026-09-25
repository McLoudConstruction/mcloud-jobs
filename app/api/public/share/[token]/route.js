import { getAdminClient } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Public, no-login read for a share link. The token is the only credential:
// it resolves to exactly one link row, and that row decides what (and only
// what) is returned — a proposal, or the photos in one named folder. Job
// fields are picked explicitly, never `select *`, so internal columns
// (costs, notes, other contacts) can't leak through by being added later.

const SIGNED_URL_SECONDS = 6 * 60 * 60;

function gone(message, status = 410) {
  return Response.json({ error: message }, { status });
}

export async function GET(_request, { params }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return gone('Server not configured.', 500);
    const token = params?.token;
    if (!token || token.length < 20) return gone('This link is not valid.', 404);

    const admin = getAdminClient();
    const { data: link } = await admin.from('share_links').select('*').eq('token', token).maybeSingle();
    if (!link) return gone('This link is not valid.', 404);
    if (link.revoked_at) return gone('This link has been turned off. Please contact McLoud Construction for a new one.');
    if (new Date(link.expires_at) < new Date()) return gone('This link has expired. Please contact McLoud Construction for a new one.');

    // Best-effort view tracking — never blocks the page.
    admin.from('share_links').update({
      view_count: (link.view_count || 0) + 1,
      first_viewed_at: link.first_viewed_at || new Date().toISOString(),
      last_viewed_at: new Date().toISOString(),
    }).eq('id', link.id).then(() => {}, () => {});

    const { data: job } = await admin
      .from('jobs')
      .select('id, stage, job_number, estimate_number, customer_name, customer_contact, project_address, description, contract_price, scope_items, additional_terms, estimate_mode, estimate_groups_submitted_at, selected_scope_option_id, selected_proposal_id')
      .eq('id', link.job_id)
      .maybeSingle();
    if (!job) return gone('This link is not valid.', 404);

    const expiresAt = link.expires_at;

    if (link.kind === 'photo_folder') {
      const { data: photos } = await admin
        .from('job_photos')
        .select('id, storage_path, source_bucket, created_at, derived_from_photo_id')
        .eq('job_id', link.job_id)
        .eq('folder', link.folder)
        .order('created_at', { ascending: true });

      const resolved = await Promise.all((photos || []).map(async p => {
        const { data } = await admin.storage.from(p.source_bucket || 'job-photos').createSignedUrl(p.storage_path, SIGNED_URL_SECONDS);
        return data?.signedUrl ? { id: p.id, url: data.signedUrl, createdAt: p.created_at } : null;
      }));

      return Response.json({
        kind: 'photo_folder',
        expiresAt,
        folder: link.folder,
        customerName: job.customer_name,
        projectAddress: job.project_address,
        photos: resolved.filter(Boolean),
      });
    }

    // ── proposal ──
    let proposal = null;
    if (link.proposal_id) {
      const { data } = await admin
        .from('proposals')
        .select('id, name, scope_items, additional_terms, contract_price')
        .eq('id', link.proposal_id)
        .eq('job_id', link.job_id)
        .maybeSingle();
      proposal = data;
      if (!proposal) return gone('This proposal is no longer available.', 404);
      admin.from('proposals').update({ viewed_at: new Date().toISOString() }).eq('id', proposal.id).is('viewed_at', null).then(() => {}, () => {});
    } else {
      admin.rpc('mark_proposal_viewed', { target_job_id: job.id }).then(() => {}, () => {}); // same RPC the portal calls; best-effort
    }

    // Materials shown on the document: description + photo only, no prices.
    const { data: materialRows } = await admin
      .from('job_estimate_items')
      .select('description, image_url, image_storage_path')
      .eq('job_id', link.job_id)
      .eq('category', 'material');
    const materials = (await Promise.all((materialRows || [])
      .filter(m => m.image_url || m.image_storage_path)
      .map(async m => {
        if (m.image_url) return { description: m.description, url: m.image_url };
        const { data } = await admin.storage.from('job-photos').createSignedUrl(m.image_storage_path, SIGNED_URL_SECONDS);
        return data?.signedUrl ? { description: m.description, url: data.signedUrl } : null;
      }))).filter(Boolean);

    // Multi-option estimates that haven't been submitted show their scope
    // options (and alternates) read-only; once submitted, jobs.scope_items
    // already holds the flattened, picked scope.
    const isMulti = !proposal && job.estimate_mode === 'multi' && !job.estimate_groups_submitted_at;
    let options = [];
    let alternates = [];
    if (isMulti) {
      const [{ data: o }, { data: g }] = await Promise.all([
        admin.from('estimate_scope_options').select('id, label, description, scope_items, price').eq('job_id', link.job_id).order('sort_order'),
        admin.from('estimate_groups').select('id, label, description, scope_items, price').eq('job_id', link.job_id).order('sort_order'),
      ]);
      options = o || [];
      alternates = g || [];
    }

    return Response.json({
      kind: 'proposal',
      expiresAt,
      job: {
        stage: job.stage, job_number: job.job_number, estimate_number: job.estimate_number,
        customer_name: job.customer_name, customer_contact: job.customer_contact,
        project_address: job.project_address, description: job.description,
      },
      proposalName: proposal?.name || null,
      price: proposal ? proposal.contract_price : job.contract_price,
      scope: (proposal ? proposal.scope_items : job.scope_items) || [],
      additionalTerms: (proposal ? proposal.additional_terms : job.additional_terms) || [],
      materials,
      isMulti,
      options,
      alternates,
    });
  } catch (err) {
    return Response.json({ error: 'Something went wrong loading this link.' }, { status: 500 });
  }
}
