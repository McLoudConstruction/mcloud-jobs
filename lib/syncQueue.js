import { supabase } from './supabaseClient';
import { enqueue, getPendingQueue, updateQueueItem, removeQueueItem } from './offlineDb';

const MAX_RETRIES = 5;

// ─── Convenience enqueue helpers ─────────────────────────────────────────
// Each of these builds a queue item with a client-generated id baked into
// the payload as the row's own id — so the record it produces is the same
// whether it syncs the instant it's created or six hours later. No ID
// collision risk (see migration 062/061 notes on gen_random_uuid()).

export async function queueTimeEntry({ jobId, entryDate, hours, notes, createdByEmail }) {
  const id = crypto.randomUUID();
  const item = await enqueue({
    id,
    table: 'time_entries',
    operation: 'insert',
    jobId,
    payload: { id, job_id: jobId, entry_date: entryDate, hours, notes: notes || null, created_by_email: createdByEmail },
  });
  flushQueue();
  return item;
}

export async function queueNote({ jobId, text, createdByEmail }) {
  const id = crypto.randomUUID();
  const item = await enqueue({
    id,
    table: 'job_updates',
    operation: 'insert',
    jobId,
    // Reuses the existing job_updates table's issues_notes field as the
    // general free-text field for a quick field note — no new table
    // needed for something job_updates already models.
    payload: { id, job_id: jobId, issues_notes: text, created_by_email: createdByEmail },
  });
  flushQueue();
  return item;
}

export async function queuePhoto({ jobId, file, caption, createdByEmail }) {
  const id = crypto.randomUUID();
  const item = await enqueue({
    id,
    table: 'job_photos',
    operation: 'insert',
    jobId,
    // The Blob itself is stored directly in IndexedDB (structured clone
    // supports Blob) — the actual upload to Supabase Storage happens at
    // sync time, not here.
    payload: { id, file, caption: caption || null, createdByEmail },
  });
  flushQueue();
  return item;
}

export async function queueChecklistToggle({ jobId, itemId, isComplete, completedByEmail }) {
  const id = crypto.randomUUID();
  const item = await enqueue({
    id,
    table: 'checklist_items',
    operation: 'update',
    jobId,
    payload: {
      id: itemId,
      is_complete: isComplete,
      completed_by_email: isComplete ? completedByEmail : null,
      completed_at: isComplete ? new Date().toISOString() : null,
    },
  });
  flushQueue();
  return item;
}

// ─── Sync ────────────────────────────────────────────────────────────────

async function syncOne(item) {
  await updateQueueItem(item.id, { syncStatus: 'syncing' });
  try {
    if (item.table === 'job_photos') {
      const { file, caption, createdByEmail } = item.payload;
      const path = `${item.jobId}/${Date.now()}-field-photo.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from('job_photos').insert({
        id: item.id,
        job_id: item.jobId,
        storage_path: path,
        caption,
        created_by_email: createdByEmail,
      });
      if (insertErr) throw insertErr;
    } else if (item.table === 'checklist_items') {
      const { id, ...patch } = item.payload;
      const { error } = await supabase.from('checklist_items').update(patch).eq('id', id);
      if (error) throw error;
    } else {
      // time_entries, job_updates — plain inserts with the id already
      // baked into the payload.
      const { error } = await supabase.from(item.table).insert(item.payload);
      if (error) throw error;
    }
    await removeQueueItem(item.id);
    return { id: item.id, ok: true };
  } catch (err) {
    const retryCount = (item.retryCount || 0) + 1;
    await updateQueueItem(item.id, {
      syncStatus: retryCount >= MAX_RETRIES ? 'failed' : 'pending',
      retryCount,
      lastError: err.message || String(err),
    });
    return { id: item.id, ok: false, error: err.message || String(err) };
  }
}

// Syncs are deliberately run in parallel (Promise.all) rather than one at
// a time — every queued write is additive (see the offline-architecture
// design notes), so there's no ordering dependency between them and no
// reason to make someone with 20 queued photos wait for them sequentially.
export async function flushQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, failed: 0, remaining: (await getPendingQueue()).length };
  }
  const items = (await getPendingQueue()).filter(i => i.syncStatus === 'pending');
  if (items.length === 0) return { synced: 0, failed: 0, remaining: 0 };

  const results = await Promise.all(items.map(syncOne));
  const remaining = (await getPendingQueue()).length;
  return {
    synced: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    remaining,
  };
}
