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

export async function queueInternalUpdate({ id, jobId, text, createdByEmail }) {
  const updateId = id || crypto.randomUUID();
  const item = await enqueue({
    id: updateId,
    table: 'job_updates',
    operation: 'insert',
    jobId,
    // Reuses the existing job_updates table's issues_notes field as the
    // free-text field for an internal note. is_internal separates this
    // from formal, customer-facing progress updates in the admin UI —
    // customer visibility was already blocked independently by sent_at
    // (see migration 064's notes), so this flag is purely organizational.
    payload: { id: updateId, job_id: jobId, issues_notes: text || null, created_by_email: createdByEmail, is_internal: true },
  });
  flushQueue();
  return item;
}

export async function queuePhoto({ jobId, file, caption, createdByEmail, updateId }) {
  const id = crypto.randomUUID();
  const item = await enqueue({
    id,
    table: 'job_photos',
    operation: 'insert',
    jobId,
    // The Blob itself is stored directly in IndexedDB (structured clone
    // supports Blob) — the actual upload to Supabase Storage happens at
    // sync time, not here. updateId links this photo to the internal
    // update it was attached to (job_photos.update_id), which is what
    // fixes photos showing up disconnected from the note they belong
    // with — previously a photo and a note were two entirely separate,
    // unrelated queue items with no relationship between them at all.
    payload: { id, file, caption: caption || null, createdByEmail, updateId: updateId || null },
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
      const { file, caption, createdByEmail, updateId } = item.payload;
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
        update_id: updateId || null,
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

// Guards against two overlapping flushQueue() calls racing each other —
// each of the queue* helpers above fires its own flush immediately after
// enqueueing, so posting a note-with-photo can trigger two flush calls
// moments apart. Serializing them keeps the phase ordering below honest.
let flushInFlight = null;

export async function flushQueue() {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlush().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function runFlush() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, failed: 0, remaining: (await getPendingQueue()).length };
  }
  const items = (await getPendingQueue()).filter(i => i.syncStatus === 'pending');
  if (items.length === 0) return { synced: 0, failed: 0, remaining: 0 };

  // A photo's update_id can reference a job_updates row that's ALSO
  // sitting in this same pending batch (posting a note with a photo
  // attached queues both at once). If that row doesn't exist yet, the
  // photo insert fails on the foreign key. Everything else here is
  // genuinely independent and additive (see the offline-architecture
  // design notes), so only photos need to wait — they go in a second
  // wave, after every non-photo item in this batch has finished.
  const photoItems = items.filter(i => i.table === 'job_photos');
  const otherItems = items.filter(i => i.table !== 'job_photos');

  const otherResults = await Promise.all(otherItems.map(syncOne));
  const photoResults = await Promise.all(photoItems.map(syncOne));
  const results = [...otherResults, ...photoResults];

  const remaining = (await getPendingQueue()).length;
  return {
    synced: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    remaining,
  };
}
