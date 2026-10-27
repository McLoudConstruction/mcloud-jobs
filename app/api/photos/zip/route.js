import { createClient } from '@supabase/supabase-js';
import { Zip, ZipPassThrough } from 'fflate';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { photoDownloadName, uniqueNames, zipName, DEFAULT_TZ } from '../../../../lib/photoNames';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PHOTOS = 150;

async function requireStaff(request) {
  const auth = request.headers.get('authorization') || '';
  const accessToken = auth.replace(/^Bearer\s+/i, '');
  if (!accessToken) return { error: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  const asCaller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error } = await asCaller.auth.getUser();
  if (error || !user) return { error: Response.json({ error: 'Could not verify your session. Try signing in again.' }, { status: 401 }) };
  if (user.app_metadata?.role !== 'admin') return { error: Response.json({ error: 'Only staff can download photos.' }, { status: 403 }) };
  return { user };
}

// POST { photoIds: [...], folder?: 'Initial Inspection' }
// Streams back a zip of the photos with on-brand file names. Photos are
// already JPEGs, so the zip stores them without recompressing.
export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY).' }, { status: 500 });
    }
    const { error: authError } = await requireStaff(request);
    if (authError) return authError;

    const { photoIds, folder = null } = await request.json();
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ error: 'No photos selected.' }, { status: 400 });
    }
    if (photoIds.length > MAX_PHOTOS) {
      return Response.json({ error: `Select ${MAX_PHOTOS} photos or fewer at a time.` }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: rows, error: rowsError } = await admin
      .from('job_photos')
      .select('id, job_id, storage_path, source_bucket, folder, created_at')
      .in('id', photoIds)
      .order('created_at', { ascending: true });
    if (rowsError) throw rowsError;
    if (!rows?.length) return Response.json({ error: 'Those photos were not found.' }, { status: 404 });

    const jobIds = [...new Set(rows.map(r => r.job_id))];
    const [{ data: jobs }, { data: settings }] = await Promise.all([
      admin.from('jobs').select('id, project_number').in('id', jobIds),
      admin.from('app_settings').select('timezone, photo_file_prefix').eq('id', 1).maybeSingle(),
    ]);
    const projectByJob = Object.fromEntries((jobs || []).map(j => [j.id, j.project_number]));
    const tz = settings?.timezone || DEFAULT_TZ;
    const prefix = settings?.photo_file_prefix || '';
    const singleJob = jobIds.length === 1 ? projectByJob[jobIds[0]] : '';

    const names = uniqueNames(rows.map(r => photoDownloadName({
      prefix, projectNumber: projectByJob[r.job_id], folder: r.folder, takenAt: r.created_at, tz,
    })));

    const filename = zipName({ prefix, projectNumber: singleJob, folder, tz });

    const stream = new ReadableStream({
      async start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) { controller.error(err); return; }
          controller.enqueue(chunk);
          if (final) controller.close();
        });
        try {
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const { data: blob, error } = await admin.storage.from(r.source_bucket || 'job-photos').download(r.storage_path);
            if (error || !blob) continue; // skip a missing file rather than failing the whole zip
            const file = new ZipPassThrough(names[i]);
            zip.add(file);
            file.push(new Uint8Array(await blob.arrayBuffer()), true);
          }
          zip.end();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Could not build the zip.' }, { status: 500 });
  }
}
