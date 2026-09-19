import { supabase } from './supabaseClient';
import { enqueue, getPendingQueue, updateQueueItem, removeQueueItem } from './offlineDb';
import { categoryPhotoFolder } from './constants';

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

export async function queueInternalUpdate({ id, jobId, text, workCompleted, upcomingWork, nextSteps, category, createdByEmail }) {
  const updateId = id || crypto.randomUUID();
  const item = await enqueue({
    id: updateId,
    table: 'job_updates',
    operation: 'insert',
    jobId,
    // Reuses the existing job_updates table's issues_notes/work_completed/
    // upcoming_work/next_steps fields — the same columns Project Updates
    // writes to — so an internal update can carry the same structured
    // fields, not just one freeform note. is_internal separates this
    // from formal, customer-facing progress updates in the admin UI —
    // customer visibility was already blocked independently by sent_at
    // (see migration 064's notes), so this flag is purely organizational.
    payload: {
      id: updateId, job_id: jobId, issues_notes: text || null,
      work_completed: workCompleted || null, upcoming_work: upcomingWork || null, next_steps: nextSteps || null,
      category: category || null, created_by_email: createdByEmail, is_internal: true,
    },
  });
  flushQueue();
  return item;
}

export async function queuePhoto({ jobId, file, caption, createdByEmail, updateId, category }) {
  const id = crypto.randomUUID();
  // Category-coded folder, computed once here (not at sync time) so a
  // photo taken offline shows the right folder immediately rather than
  // waiting on reconnect, and so every photo from the same "batch" of an
  // update shares one dated subfolder even if they sync at slightly
  // different times. No category (e.g. photo isn't attached to an
  // update, or the update has none) means no folder — this only ever
  // creates a folder when there's an actual photo to put in it.
  const folder = category ? categoryPhotoFolder(category, new Date().toISOString().slice(0, 10)) : null;
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
    payload: { id, file, caption: caption || null, createdByEmail, updateId: updateId || null, folder },
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
      const { file, caption, createdByEmail, updateId, folder } = item.payload;
      // item.id (a crypto.randomUUID() baked in at enqueue time — see
      // queuePhoto above) rather than Date.now(): photos from the same
      // Internal Update sync concurrently (runFlush's Promise.all over
      // photoItems), so a millisecond-resolution timestamp alone let
      // several of them land on the exact same path in one batch.
      // Supabase Storage rejects the second write to an existing path,
      // so only one photo in the batch would actually make it in — the
      // rest failed here and sat pending for a retry, which is why
      // taking several photos on one update could leave all but one of
      // them missing. The id is already unique per photo, so this can't
      // collide.
      const path = `${item.jobId}/${item.id}-field-photo.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from('job_photos').insert({
        id: item.id,
        job_id: item.jobId,
        storage_path: path,
        caption,
        folder: folder || null,
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

      // A "Completed" internal update is significant enough to surface on
      // the dashboard notifications feed, not just sit in the job's own
      // update log — and it's exactly the same signal as a PM manually
      // hitting "Mark Ready to Invoice" on the job, so it sets that flag
      // too rather than leaving the office to notice the notification and
      // flag it themselves. This fires at sync time (same as the insert
      // above), so it fires exactly once whether the update was posted
      // online or queued offline and synced later.
      if (item.table === 'job_updates' && item.payload.is_internal && item.payload.category === 'Completed') {
        const { data: job } = await supabase.from('jobs').select('job_number, customer_name, ready_to_invoice').eq('id', item.jobId).maybeSingle();
        const jobLabel = job?.job_number ? `Job #${job.job_number}` : 'A job';
        const who = job?.customer_name ? ` (${job.customer_name})` : '';
        const note = item.payload.issues_notes ? ` — ${item.payload.issues_notes}` : '';
        await supabase.from('notifications').insert({
          message: `${jobLabel}${who} marked Completed on an internal update and was flagged Ready to Invoice${note}.`,
          job_id: item.jobId,
        });
        if (job && !job.ready_to_invoice) {
          const { data: { session } } = await supabase.auth.getSession();
          await supabase.from('jobs').update({
            ready_to_invoice: true,
            ready_to_invoice_at: new Date().toISOString(),
            ready_to_invoice_by: session?.user?.id || null,
          }).eq('id', item.jobId);
        }
      }
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

// Serializes overlapping flushQueue() calls by chaining each one onto the
// tail of the last, rather than letting them race — each of the queue*
// helpers above fires its own flush immediately after enqueueing, so
// posting a note with several photos can trigger half a dozen flush
// calls a few hundred milliseconds apart as each photo finishes
// compressing.
//
// This used to be a flushInFlight/flushRequestedAgain flag pair: if a
// call came in while a flush was already running, it just set a flag
// and returned the *current* run's promise. That fixed the original bug
// (a late arrival being dropped entirely — see the old comment this
// replaced), but a caller awaiting that returned promise only ever saw
// the *first* wave finish, not any wave chained after it. That mattered
// once callers started awaiting a flush to know the queue had actually
// drained (InternalUpdatesPanel does this after posting, to refresh the
// feed once every photo has had its sync attempt) — with N photos
// spread across several waves, awaiting only settled after wave one,
// while photos in later waves were still mid-upload.
//
// Chaining fixes both: every flushQueue() call appends its own runFlush()
// onto the shared tail and returns *that specific link's* promise, so
// nothing is ever dropped (every call gets its own turn) and a caller
// that awaits its own call's promise is only told "done" once every
// flush requested up to and including theirs has actually finished.
let flushChain = Promise.resolve();

export function flushQueue() {
  const run = flushChain.then(() => runFlush());
  // Keep the shared tail alive even if this link fails — runFlush()
  // already catches per-item failures inside syncOne, so a rejection
  // here would be unexpected (e.g. IndexedDB itself erroring), but it
  // shouldn't be able to wedge every flush requested afterward.
  flushChain = run.catch(() => {});
  return run;
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
