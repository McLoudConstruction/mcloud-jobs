import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { getAdminClient } from '../../../lib/supabaseAdmin';

const LINK_DAYS = 30;

async function requireStaff(request) {
  const auth = request.headers.get('authorization') || '';
  const accessToken = auth.replace(/^Bearer\s+/i, '');
  if (!accessToken) return { error: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  const asCaller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error } = await asCaller.auth.getUser();
  if (error || !user) return { error: Response.json({ error: 'Could not verify your session — try signing in again.' }, { status: 401 }) };
  if (user.app_metadata?.role !== 'admin') return { error: Response.json({ error: 'Only staff can create share links.' }, { status: 403 }) };
  return { user };
}

function siteOrigin(request) {
  return process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
}

function linkUrl(request, link) {
  const path = link.kind === 'proposal' ? 'p' : 'photos';
  return `${siteOrigin(request)}/${path}/${link.token}`;
}

// Applies one target's filter (job + kind + proposal/folder) to a query.
function matchTarget(query, { kind, jobId, proposalId, folder }) {
  query = query.eq('job_id', jobId).eq('kind', kind);
  query = proposalId ? query.eq('proposal_id', proposalId) : query.is('proposal_id', null);
  query = kind === 'photo_folder' ? query.eq('folder', folder) : query.is('folder', null);
  return query;
}

// POST { kind, jobId, proposalId?, folder?, revoke?, renew? }
//   default  → returns the active link for that target, creating one if none
//   renew    → revokes existing links for that target and issues a fresh one
//              (restarts the 30 days)
//   revoke   → revokes existing links for that target and returns nothing
export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }
    const { user, error: authError } = await requireStaff(request);
    if (authError) return authError;

    const { kind, jobId, proposalId = null, folder = null, revoke = false, renew = false } = await request.json();
    if (!['proposal', 'photo_folder'].includes(kind) || !jobId) {
      return Response.json({ error: 'Missing or invalid fields.' }, { status: 400 });
    }
    if (kind === 'photo_folder' && !(folder && folder.trim())) {
      return Response.json({ error: 'A folder name is required to share photos.' }, { status: 400 });
    }
    const target = { kind, jobId, proposalId: kind === 'proposal' ? proposalId : null, folder: kind === 'photo_folder' ? folder.trim() : null };

    const admin = getAdminClient();

    if (revoke || renew) {
      const { error } = await matchTarget(
        admin.from('share_links').update({ revoked_at: new Date().toISOString() }).is('revoked_at', null),
        target
      );
      if (error) throw new Error(error.message);
      if (revoke) return Response.json({ revoked: true });
    } else {
      const { data: existing, error } = await matchTarget(
        admin.from('share_links').select('*').is('revoked_at', null).gt('expires_at', new Date().toISOString()),
        target
      ).order('created_at', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      if (existing?.[0]) {
        return Response.json({ url: linkUrl(request, existing[0]), expiresAt: existing[0].expires_at });
      }
    }

    const expiresAt = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error: insertError } = await admin.from('share_links').insert({
      token: randomBytes(24).toString('base64url'),
      kind,
      job_id: jobId,
      proposal_id: target.proposalId,
      folder: target.folder,
      expires_at: expiresAt,
      created_by: user.email,
    }).select('*').single();
    if (insertError) throw new Error(insertError.message);

    return Response.json({ url: linkUrl(request, created), expiresAt: created.expires_at });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to create share link.' }, { status: 500 });
  }
}
