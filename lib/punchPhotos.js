import { supabase } from './supabaseClient';
import { compressImage } from './imageCompress';

const PUNCH_BUCKET = 'punch-photos';

// Uploads one image file to a punch item (file → {job_id}/{item_id}/… in the
// private bucket, then registers it through add_punch_photo, which does the
// permission check). Shared by the item's own "Add photo" button, the
// add-item form's queued photos, and the Punch List Internal Update.
export async function uploadPunchPhotoFile(item, file, caption = null) {
  const compressed = await compressImage(file);
  const clean = (file.name || 'photo').replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.[^.]+$/, '');
  const path = `${item.job_id}/${item.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${clean}.jpg`;
  const { error: upErr } = await supabase.storage.from(PUNCH_BUCKET).upload(path, compressed, { contentType: 'image/jpeg' });
  if (upErr) throw upErr;
  const { error: rpcErr } = await supabase.rpc('add_punch_photo', { target_item_id: item.id, path_in: path, caption_in: caption });
  if (rpcErr) throw rpcErr;
}

// Pulls a photo already on the job's Photos tab onto a punch item. The
// customer and subs can't read the staff-only job-photos bucket, so the
// picture is copied into the punch-photos bucket rather than linked.
export async function copyJobPhotoToPunchItem(item, jobPhoto) {
  const { data: signed, error: signErr } = await supabase.storage.from('job-photos').createSignedUrl(jobPhoto.storage_path, 300);
  if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || 'Could not read that photo.');
  const res = await fetch(signed.signedUrl);
  if (!res.ok) throw new Error('Could not download that photo.');
  const blob = await res.blob();
  const file = new File([blob], `job-photo-${jobPhoto.id}.jpg`, { type: blob.type || 'image/jpeg' });
  await uploadPunchPhotoFile(item, file, jobPhoto.caption || null);
}
