'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { watermarkImage } from '../lib/watermark';
import { queueInternalUpdate, queueChecklistToggle } from '../lib/syncQueue';
import { useOfflineSync } from '../lib/useOfflineSync';
import { cacheJobPatch, getCachedJob } from '../lib/offlineDb';
import { INTERNAL_UPDATE_CATEGORIES, categoryPhotoFolder } from '../lib/constants';
import CameraCapture from './CameraCapture';
import PolishTextButton from './PolishTextButton';
import PopupModal from './PopupModal';

// Photos on an Internal Update now go through the exact same path as the
// Photos tab's "Take Photos" / "Upload from library" buttons (see
// uploadOnePhoto in PhotoGallery.js): watermark, upload to Storage, insert
// the job_photos row — immediately, one photo at a time, no offline queue
// in between. That path has never lost a photo. The previous design routed
// internal-update photos through IndexedDB + a promise-chained sync queue
// instead (to support offline capture), and across several rounds of fixes
// that queue kept stranding photos in ways that were genuinely hard to see
// from the client (see the sync queue's own history) — right down to items
// getting stuck in a 'syncing' limbo state invisible to every diagnostic.
// Rather than keep chasing that, this drops the queue for photos entirely
// and copies the mechanism that's actually proven reliable. The one
// difference from the Photos tab: each photo is tagged with a folder named
// after the update's category (see categoryPhotoFolder) instead of landing
// in General, and linked to this update via update_id from the moment it's
// inserted. This does mean taking a photo on an Internal Update now
// requires a connection, same as the Photos tab always has — the note text
// itself still queues offline via queueInternalUpdate below when no photos
// are involved.

function SyncBadge({ isOnline, pendingCount, failedCount, sync }) {
  if (isOnline && pendingCount === 0 && failedCount === 0) return null;
  return (
    <div className={`sync-badge ${isOnline ? '' : 'sync-badge-offline'}`}>
      {!isOnline && <span>Offline — updates will sync when reconnected</span>}
      {isOnline && pendingCount > 0 && <span>Syncing {pendingCount} item{pendingCount === 1 ? '' : 's'}…</span>}
      {failedCount > 0 && (
        <span className="sync-badge-failed">
          {failedCount} item{failedCount === 1 ? '' : 's'} failed to sync.{' '}
          <button type="button" onClick={sync}>Retry</button>
        </span>
      )}
    </div>
  );
}

function fmtTimestamp(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function InternalUpdatesPanel({ jobId, session }) {
  const createdByEmail = session?.user?.email || null;
  const { isOnline, pendingCount, failedCount, pending, sync } = useOfflineSync(jobId);
  const { settings } = useSettings();

  const [noteText, setNoteText] = useState('');
  const [workCompleted, setWorkCompleted] = useState('');
  const [upcomingWork, setUpcomingWork] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [category, setCategory] = useState('');
  // Photos taken/picked for the update currently being drafted. Each entry
  // is already a real job_photos row by the time it's in this array — see
  // uploadDraftPhoto below — not a File waiting to be queued.
  // { id, url, uploading: bool }
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Editing an already-posted update. Kept separate from the draft state
  // above (which is only for composing a brand-new update) so opening an
  // edit can't clobber an in-progress "Create new Internal Update" draft.
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({ issues_notes: '', work_completed: '', upcoming_work: '', next_steps: '', category: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // The id this draft's job_updates row will have. draftRowExistsRef tracks
  // whether that row has actually been inserted yet — it's created lazily,
  // the moment the first photo is taken (photos need a real update_id to
  // insert against, same FK relationship the rest of the app already
  // relies on), or at Post time if the update turned out to be text-only.
  const draftIdRef = useRef(crypto.randomUUID());
  const draftRowExistsRef = useRef(false);

  const [checklist, setChecklist] = useState([]);
  const [syncedUpdates, setSyncedUpdates] = useState([]);
  const [syncedPhotosByUpdate, setSyncedPhotosByUpdate] = useState({});
  const [signedUrls, setSignedUrls] = useState({});

  const loadChecklist = useCallback(async () => {
    const { data, error } = await supabase.from('checklist_items').select('*').eq('job_id', jobId).order('sort_order', { ascending: true });
    if (data && !error) {
      setChecklist(data);
      cacheJobPatch(jobId, { checklist: data });
    } else {
      const cached = await getCachedJob(jobId);
      if (cached?.data?.checklist) setChecklist(cached.data.checklist);
    }
  }, [jobId]);

  const loadUpdates = useCallback(async () => {
    const { data: updates, error } = await supabase
      .from('job_updates')
      .select('*')
      .eq('job_id', jobId)
      .eq('is_internal', true)
      .order('created_at', { ascending: false });
    if (error || !updates) {
      const cached = await getCachedJob(jobId);
      if (cached?.data?.internalUpdates) setSyncedUpdates(cached.data.internalUpdates);
      return;
    }
    setSyncedUpdates(updates);
    cacheJobPatch(jobId, { internalUpdates: updates });

    if (updates.length > 0) {
      const { data: photos } = await supabase.from('job_photos').select('*').in('update_id', updates.map(u => u.id));
      const grouped = {};
      for (const p of photos || []) {
        (grouped[p.update_id] = grouped[p.update_id] || []).push(p);
      }
      setSyncedPhotosByUpdate(grouped);

      const entries = await Promise.all(
        (photos || []).map(async p => {
          const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
          return [p.id, signed?.signedUrl];
        })
      );
      setSignedUrls(Object.fromEntries(entries));
    }
  }, [jobId]);

  useEffect(() => {
    loadChecklist();
    loadUpdates();
    const channel = supabase
      .channel(`internal-updates-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `job_id=eq.${jobId}` }, loadChecklist)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${jobId}` }, loadUpdates)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos', filter: `job_id=eq.${jobId}` }, loadUpdates)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadChecklist, loadUpdates]);

  // Don't rely solely on the realtime subscription above to pick up
  // photos as they finish syncing — job_photos' postgres_changes events
  // aren't reliably delivered (same known gap PhotoGallery.js works
  // around for its own delete button). Posting an update with several
  // photos queues them individually; each syncs on its own network
  // round trip, so the note (and maybe the first photo) can land, fire
  // one realtime event, and the feed never gets nudged to re-fetch again
  // as the remaining photos finish afterward — they're in the database,
  // just never pulled into this feed. Re-fetching directly whenever the
  // offline queue for this job drains to zero doesn't depend on
  // realtime at all, so every photo that actually synced ends up
  // visible once its work is done.
  const prevPendingRef = useRef(0);
  useEffect(() => {
    if (prevPendingRef.current > 0 && pendingCount === 0) {
      loadUpdates();
    }
    prevPendingRef.current = pendingCount;
  }, [pendingCount, loadUpdates]);

  // Pending (not-yet-synced) entries, built from the same offline queue
  // the sync badge already reads — so an internal update posted while
  // offline shows up in this feed immediately, note and photo together,
  // instead of only appearing once a connection comes back.
  const pendingEntries = useMemo(() => {
    const pendingUpdates = pending.filter(p => p.table === 'job_updates');
    const pendingPhotos = pending.filter(p => p.table === 'job_photos');
    return pendingUpdates.map(u => ({
      id: u.id,
      issues_notes: u.payload.issues_notes,
      work_completed: u.payload.work_completed,
      upcoming_work: u.payload.upcoming_work,
      next_steps: u.payload.next_steps,
      category: u.payload.category,
      created_at: u.createdAt,
      _pending: true,
      _photos: pendingPhotos
        .filter(p => p.payload.updateId === u.id)
        .map(p => ({ id: p.id, _localUrl: URL.createObjectURL(p.payload.file) })),
    }));
  }, [pending]);

  const feed = [...pendingEntries, ...syncedUpdates];

  // Creates this draft's job_updates row the first time it's actually
  // needed (the first photo), using whatever text fields are filled in at
  // that moment — Post later fills in the rest with an UPDATE rather than
  // a second insert. If the update turns out to be text-only, this never
  // runs; handlePost does a normal queued insert instead, same as before.
  async function ensureDraftRow() {
    if (draftRowExistsRef.current) return;
    const { error } = await supabase.from('job_updates').insert({
      id: draftIdRef.current,
      job_id: jobId,
      issues_notes: noteText.trim() || null,
      work_completed: workCompleted.trim() || null,
      upcoming_work: upcomingWork.trim() || null,
      next_steps: nextSteps.trim() || null,
      category: category || null,
      created_by_email: createdByEmail,
      is_internal: true,
    });
    if (error) throw error;
    draftRowExistsRef.current = true;
  }

  // The direct mechanism the Photos tab already uses successfully (see
  // uploadOnePhoto in PhotoGallery.js) — watermark, upload to Storage,
  // insert the row, all in one immediate round trip per photo. No staging,
  // no offline queue: this is called the instant a photo is taken or
  // picked, exactly like "Take Photos" on the Photos tab, just tagged with
  // this update's id and a category-named folder instead of landing in
  // General.
  async function uploadDraftPhoto(file) {
    const localId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    setDraftPhotos(prev => [...prev, { id: localId, url: previewUrl, uploading: true }]);
    try {
      await ensureDraftRow();
      const watermarked = await watermarkImage(file, settings.watermark_logo_url || settings.logo_url);
      const folder = category ? categoryPhotoFolder(category, new Date().toISOString().slice(0, 10)) : null;
      const path = `${jobId}/${crypto.randomUUID()}-field-photo.jpg`;
      const { error: uploadErr } = await supabase.storage.from('job-photos').upload(path, watermarked, { contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: inserted, error: insertErr } = await supabase
        .from('job_photos')
        .insert({
          job_id: jobId,
          update_id: draftIdRef.current,
          storage_path: path,
          folder: folder || null,
          created_by_email: createdByEmail,
        })
        .select('id')
        .single();
      if (insertErr) throw insertErr;
      setDraftPhotos(prev => prev.map(p => (p.id === localId ? { ...p, dbId: inserted.id, uploading: false } : p)));
    } catch (err) {
      setPhotoError(`A photo didn't upload: ${err.message || err}`);
      setDraftPhotos(prev => prev.filter(p => p.id !== localId));
      URL.revokeObjectURL(previewUrl);
    }
  }

  function handleAddPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach(uploadDraftPhoto);
  }

  // Same camera component the Photos tab uses. Each shot uploads as soon
  // as it's accepted (retake/use flow) while the camera stays open for the
  // next one — matching "Take Photos" on the Photos tab exactly.
  function handleCameraPhoto(file) {
    uploadDraftPhoto(file);
  }

  // The photo is already a real row by the time it's in draftPhotos, so
  // removing it here deletes it for real (storage + row), same as the
  // Delete button on the Photos tab.
  async function removeDraftPhoto(photo) {
    setDraftPhotos(prev => prev.filter(p => p.id !== photo.id));
    if (!photo.dbId) return; // still uploading or never made it in — nothing to delete
    const { data: row } = await supabase.from('job_photos').select('storage_path').eq('id', photo.dbId).maybeSingle();
    if (row?.storage_path) await supabase.storage.from('job-photos').remove([row.storage_path]);
    await supabase.from('job_photos').delete().eq('id', photo.dbId);
  }

  function resetDraft() {
    setNoteText('');
    setWorkCompleted('');
    setUpcomingWork('');
    setNextSteps('');
    setCategory('');
    setDraftPhotos([]);
    setPhotoError('');
    draftIdRef.current = crypto.randomUUID();
    draftRowExistsRef.current = false;
    setFormOpen(false);
  }

  async function handlePost(e) {
    e.preventDefault();
    const hasText = noteText.trim() || workCompleted.trim() || upcomingWork.trim() || nextSteps.trim();
    if (!hasText && draftPhotos.length === 0) return;
    setPosting(true);
    setPostError('');
    try {
      if (draftRowExistsRef.current) {
        // A photo was taken first, so the row already exists (with
        // whatever text was filled in at that moment) — bring it up to
        // date with the final field values instead of inserting again.
        const { error } = await supabase
          .from('job_updates')
          .update({
            issues_notes: noteText.trim() || null,
            work_completed: workCompleted.trim() || null,
            upcoming_work: upcomingWork.trim() || null,
            next_steps: nextSteps.trim() || null,
            category: category || null,
          })
          .eq('id', draftIdRef.current);
        if (error) throw error;
        await loadUpdates();
      } else {
        // No photos this time — a plain text note, still safe to queue
        // offline since there's no photo upload depending on it.
        await queueInternalUpdate({
          id: draftIdRef.current, jobId,
          text: noteText.trim() || null,
          workCompleted: workCompleted.trim() || null,
          upcomingWork: upcomingWork.trim() || null,
          nextSteps: nextSteps.trim() || null,
          category: category || null,
          createdByEmail,
        });
        await sync();
        await loadUpdates();
      }
      resetDraft();
    } catch (err) {
      setPostError(err.message || 'Failed to post update.');
    } finally {
      setPosting(false);
    }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditError('');
    setEditFields({
      issues_notes: u.issues_notes || '',
      work_completed: u.work_completed || '',
      upcoming_work: u.upcoming_work || '',
      next_steps: u.next_steps || '',
      category: u.category || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError('');
  }

  async function saveEdit(updateId) {
    setEditSaving(true);
    setEditError('');
    try {
      const { error } = await supabase
        .from('job_updates')
        .update({
          issues_notes: editFields.issues_notes.trim() || null,
          work_completed: editFields.work_completed.trim() || null,
          upcoming_work: editFields.upcoming_work.trim() || null,
          next_steps: editFields.next_steps.trim() || null,
          category: editFields.category || null,
        })
        .eq('id', updateId);
      if (error) throw error;
      await loadUpdates();
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || 'Failed to save changes.');
    } finally {
      setEditSaving(false);
    }
  }

  // Deletes the update itself along with any photos attached to it — same
  // storage-then-row order removeDraftPhoto and the Photos tab's delete
  // button already use, so nothing gets orphaned in Storage.
  async function deleteUpdate(u) {
    if (!confirm('Delete this internal update? This cannot be undone.')) return;
    setDeletingId(u.id);
    try {
      const photos = syncedPhotosByUpdate[u.id] || [];
      if (photos.length > 0) {
        const paths = photos.map(p => p.storage_path).filter(Boolean);
        if (paths.length > 0) await supabase.storage.from('job-photos').remove(paths);
        await supabase.from('job_photos').delete().eq('update_id', u.id);
      }
      const { error } = await supabase.from('job_updates').delete().eq('id', u.id);
      if (error) throw error;
      if (editingId === u.id) setEditingId(null);
      await loadUpdates();
    } catch (err) {
      alert(`Failed to delete update: ${err.message || err}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleChecklistItem(item) {
    const nextComplete = !item.is_complete;
    const updated = checklist.map(i => (i.id === item.id ? { ...i, is_complete: nextComplete } : i));
    setChecklist(updated);
    cacheJobPatch(jobId, { checklist: updated });
    await queueChecklistToggle({ jobId, itemId: item.id, isComplete: nextComplete, completedByEmail: createdByEmail });
  }

  return (
    <div className="offline-field-log">
      <SyncBadge isOnline={isOnline} pendingCount={pendingCount} failedCount={failedCount} sync={sync} />

      {checklist.length > 0 && (
        <section className="field-log-section">
          <h3>Checklist</h3>
          <ul className="field-checklist">
            {checklist.map(item => (
              <li key={item.id}>
                <label>
                  <input type="checkbox" checked={item.is_complete} onChange={() => handleToggleChecklistItem(item)} />
                  <span className={item.is_complete ? 'checklist-done' : ''}>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="field-log-section">
        <div className="section-actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              // Only hand out a fresh draft id if nothing's been captured
              // yet under the current one — if the modal was closed with
              // photos or text already in progress, reopening should
              // continue that same draft, not orphan the photos already
              // uploaded under its id.
              const hasDraftInProgress = draftPhotos.length > 0 || noteText.trim() || workCompleted.trim() || upcomingWork.trim() || nextSteps.trim();
              if (!hasDraftInProgress) {
                draftIdRef.current = crypto.randomUUID();
                draftRowExistsRef.current = false;
              }
              setFormOpen(true);
            }}
          >
            Create new Internal Update
          </button>
        </div>
      </section>

      <PopupModal open={formOpen} onClose={() => setFormOpen(false)} maxWidth={560}>
        <h3 style={{ margin: '0 0 12px', color: 'var(--heading)' }}>Post an internal update</h3>
        <form onSubmit={handlePost} className="field-log-form">
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="">Category (optional)</option>
            {INTERNAL_UPDATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <textarea placeholder="What's happening on site?" value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} />
          <div style={{ marginBottom: 8 }}><PolishTextButton value={noteText} onPolished={setNoteText} /></div>
          <label>Work completed</label>
          <textarea value={workCompleted} onChange={e => setWorkCompleted(e.target.value)} rows={2} />
          <div style={{ marginBottom: 8 }}><PolishTextButton value={workCompleted} onPolished={setWorkCompleted} /></div>
          <label>Upcoming work</label>
          <textarea value={upcomingWork} onChange={e => setUpcomingWork(e.target.value)} rows={2} />
          <div style={{ marginBottom: 8 }}><PolishTextButton value={upcomingWork} onPolished={setUpcomingWork} /></div>
          <label>Next steps</label>
          <textarea value={nextSteps} onChange={e => setNextSteps(e.target.value)} rows={2} />
          <div style={{ marginBottom: 8 }}><PolishTextButton value={nextSteps} onPolished={setNextSteps} /></div>

          {draftPhotos.length > 0 && (
            <div className="staged-photo-strip">
              {draftPhotos.map(p => (
                <div key={p.id} className="staged-photo-thumb">
                  <img src={p.url} alt="" style={p.uploading ? { opacity: 0.5 } : undefined} />
                  {p.uploading && <span className="photo-tile-loading" style={{ position: 'absolute', inset: 0 }} />}
                  <button type="button" onClick={() => removeDraftPhoto(p)}>×</button>
                </div>
              ))}
            </div>
          )}

          <div className="section-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCameraOpen(true)}>Take Photos</button>
            <label className="btn btn-sm field-photo-button" style={{ margin: 0 }}>
              Upload from library
              <input type="file" accept="image/*" multiple onChange={handleAddPhotos} style={{ display: 'none' }} />
            </label>
          </div>

          {photoError && <div className="error-text">{photoError}</div>}
          {postError && <div className="error-text">{postError}</div>}

          <button
            type="submit"
            disabled={
              posting ||
              draftPhotos.some(p => p.uploading) ||
              (!noteText.trim() && !workCompleted.trim() && !upcomingWork.trim() && !nextSteps.trim() && draftPhotos.length === 0)
            }
          >
            {posting ? 'Posting…' : draftPhotos.some(p => p.uploading) ? 'Photo uploading…' : 'Post update'}
          </button>
        </form>
        <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onPhotoAccepted={handleCameraPhoto} title="Internal Update Photos" />
      </PopupModal>

      <section className="field-log-section">
        <h3>Recent internal updates</h3>
        {feed.length === 0 && <div className="empty-state">No internal updates yet.</div>}
        {feed.map(u => {
          const photos = u._pending ? u._photos : (syncedPhotosByUpdate[u.id] || []);
          const isExpanded = expandedId === u.id;
          return (
            <div className="update-entry" key={u.id}>
              <div
                className="update-date"
                role="button"
                tabIndex={0}
                onClick={() => setExpandedId(isExpanded ? null : u.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : u.id); } }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span>
                  {fmtTimestamp(u.created_at)}
                  {u.category && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--gold)' }}>{u.category}</span>}
                  {u._pending && <span className="pending-tag"> · syncing…</span>}
                  {photos.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-soft)' }}>· {photos.length} photo{photos.length === 1 ? '' : 's'}</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{isExpanded ? '▲ collapse' : '▼ expand'}</span>
              </div>
              {!isExpanded && u.issues_notes && (
                <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.issues_notes}</p>
              )}
              {isExpanded && editingId !== u.id && (
                <>
                  {u.issues_notes && <p>{u.issues_notes}</p>}
                  {u.work_completed && <><div className="update-field-label">Work completed</div><p>{u.work_completed}</p></>}
                  {u.upcoming_work && <><div className="update-field-label">Upcoming work</div><p>{u.upcoming_work}</p></>}
                  {u.next_steps && <><div className="update-field-label">Next steps</div><p>{u.next_steps}</p></>}
                  {photos.length > 0 && (
                    <div className="update-photo-strip">
                      {photos.map(p => (
                        <img key={p.id} src={p._localUrl || signedUrls[p.id]} alt="" />
                      ))}
                    </div>
                  )}
                  {!u._pending && (
                    <div className="section-actions" style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => startEdit(u)}>Edit</button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => deleteUpdate(u)}
                        disabled={deletingId === u.id}
                      >
                        {deletingId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {isExpanded && editingId === u.id && (
                <div className="field-log-form" style={{ marginTop: 8 }}>
                  <select value={editFields.category} onChange={e => setEditFields(f => ({ ...f, category: e.target.value }))} style={{ marginBottom: 8 }}>
                    <option value="">Category (optional)</option>
                    {INTERNAL_UPDATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <textarea placeholder="What's happening on site?" value={editFields.issues_notes} onChange={e => setEditFields(f => ({ ...f, issues_notes: e.target.value }))} rows={3} />
                  <label>Work completed</label>
                  <textarea value={editFields.work_completed} onChange={e => setEditFields(f => ({ ...f, work_completed: e.target.value }))} rows={2} />
                  <label>Upcoming work</label>
                  <textarea value={editFields.upcoming_work} onChange={e => setEditFields(f => ({ ...f, upcoming_work: e.target.value }))} rows={2} />
                  <label>Next steps</label>
                  <textarea value={editFields.next_steps} onChange={e => setEditFields(f => ({ ...f, next_steps: e.target.value }))} rows={2} />
                  {editError && <div className="error-text">{editError}</div>}
                  <div className="section-actions" style={{ marginTop: 0 }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={editSaving} onClick={() => saveEdit(u.id)}>
                      {editSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
