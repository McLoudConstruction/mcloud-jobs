'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { compressImage } from '../lib/imageCompress';
import { queueInternalUpdate, queuePhoto, queueChecklistToggle } from '../lib/syncQueue';
import { useOfflineSync } from '../lib/useOfflineSync';
import { cacheJobPatch, getCachedJob, getQueueForJob } from '../lib/offlineDb';
import { INTERNAL_UPDATE_CATEGORIES } from '../lib/constants';
import CameraCapture from './CameraCapture';
import PolishTextButton from './PolishTextButton';
import PopupModal from './PopupModal';

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

  const [noteText, setNoteText] = useState('');
  const [workCompleted, setWorkCompleted] = useState('');
  const [upcomingWork, setUpcomingWork] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [category, setCategory] = useState('');
  const [stagedPhotos, setStagedPhotos] = useState([]); // [{ file, previewUrl }]
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

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

  function handleAddPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setStagedPhotos(prev => [...prev, ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  // Same camera component the Photos tab uses — staged locally rather
  // than uploaded immediately, since a photo taken offline still needs
  // to go through the sync queue like everything else on this panel.
  function handleCameraPhoto(file) {
    setStagedPhotos(prev => [...prev, { file, previewUrl: URL.createObjectURL(file) }]);
  }

  function removeStagedPhoto(index) {
    setStagedPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function handlePost(e) {
    e.preventDefault();
    const hasText = noteText.trim() || workCompleted.trim() || upcomingWork.trim() || nextSteps.trim();
    if (!hasText && stagedPhotos.length === 0) return;
    setPosting(true);
    setPostError('');

    const updateId = crypto.randomUUID();
    try {
      await queueInternalUpdate({
        id: updateId, jobId,
        text: noteText.trim() || null,
        workCompleted: workCompleted.trim() || null,
        upcomingWork: upcomingWork.trim() || null,
        nextSteps: nextSteps.trim() || null,
        category: category || null,
        createdByEmail,
      });

      // Each photo queues independently — one photo that fails to
      // compress (corrupt file, unsupported format) no longer aborts the
      // whole batch. Previously an uncaught error here left every photo
      // after it (and the "Posting…" button) stuck, since nothing below
      // this loop ever ran.
      // eslint-disable-next-line no-console
      console.log(`[internal-update] submitting ${stagedPhotos.length} staged photo(s) for update ${updateId}`);
      const failedPhotos = [];
      let queuedCount = 0;
      for (const { file } of stagedPhotos) {
        try {
          const compressed = await compressImage(file);
          const queued = await queuePhoto({ jobId, file: compressed, createdByEmail, updateId, category: category || null });
          queuedCount += 1;
          // eslint-disable-next-line no-console
          console.log(`[internal-update] queued photo ${queuedCount}/${stagedPhotos.length}, queue item id ${queued?.id}`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[internal-update] photo ${queuedCount + 1}/${stagedPhotos.length} failed to queue`, err);
          failedPhotos.push(err.message || String(err));
        }
      }
      // Wait for every write just queued (the note, then each photo) to
      // have its sync attempt, then pull the feed fresh — rather than
      // trusting the job_photos realtime subscription above to notice
      // each photo as it lands. That subscription can miss events (see
      // the note on the effect below), so without this, a five-photo
      // update could show only whichever photo happened to trigger the
      // one realtime event that got through, even though all five made
      // it into the database. sync() awaits the whole flush chain
      // (every queuePhoto() call above chained its own flush onto it),
      // so this doesn't return until all five have actually been tried.
      await sync();

      // failedPhotos above only catches an error thrown while staging a
      // photo (compress/enqueue) — the actual upload+insert happens
      // later, inside the flush chain, and a failure there is recorded
      // on the queue item (syncStatus/lastError), not thrown back here.
      // That gap is exactly how a real sync-time failure (RLS, storage
      // policy, network) could fail silently: the enqueue step succeeds
      // for every photo, so failedPhotos stays empty and nothing told
      // the person anything was wrong beyond the easy-to-miss sync
      // badge. Checking the queue directly after the flush above
      // catches anything still stuck against *this* update and surfaces
      // its real error.
      const wholeQueueForJob = await getQueueForJob(jobId);
      const stillQueued = wholeQueueForJob.filter(
        i => i.table === 'job_photos' && i.payload?.updateId === updateId
      );
      // eslint-disable-next-line no-console
      console.log('[internal-update] full queue for this job after sync():', wholeQueueForJob);

      // Direct read-after-write against job_photos, bypassing every layer
      // above (the offline queue, the sync chain, loadUpdates' grouping)
      // — the most ground-truth check available client-side of exactly
      // how many rows exist in the database for this update right now.
      const { data: verifyPhotos, error: verifyErr } = await supabase
        .from('job_photos')
        .select('id, storage_path')
        .eq('update_id', updateId);
      // eslint-disable-next-line no-console
      console.log(`[internal-update] verify query: ${verifyPhotos?.length ?? 'error'} row(s) in job_photos for update ${updateId}`, { verifyErr, verifyPhotos });

      const messages = [...failedPhotos];
      if (stillQueued.length > 0) {
        messages.push(stillQueued[0].lastError || `${stillQueued.length} photo${stillQueued.length === 1 ? '' : 's'} still syncing or stuck — see the sync banner above.`);
      }
      const dbCount = verifyPhotos?.length ?? null;
      if (dbCount !== null && dbCount < queuedCount) {
        messages.push(`only ${dbCount} of ${queuedCount} queued photo(s) actually landed in the database, with no sync error recorded — see the browser console for the full trace.`);
      }
      if (messages.length > 0) {
        setPostError(`Update posted. Queued ${queuedCount} of ${stagedPhotos.length} photo(s); ${dbCount ?? '?'} confirmed in the database. ${messages[0]}`);
      }
      await loadUpdates();

      setNoteText('');
      setWorkCompleted('');
      setUpcomingWork('');
      setNextSteps('');
      setCategory('');
      setStagedPhotos([]);
      setFormOpen(false);
    } catch (err) {
      setPostError(err.message || 'Failed to post update.');
    } finally {
      setPosting(false);
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
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>Create new Internal Update</button>
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

          {stagedPhotos.length > 0 && (
            <div className="staged-photo-strip">
              {stagedPhotos.map((p, i) => (
                <div key={i} className="staged-photo-thumb">
                  <img src={p.previewUrl} alt="" />
                  <button type="button" onClick={() => removeStagedPhoto(i)}>×</button>
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

          {postError && <div className="error-text">{postError}</div>}

          <button type="submit" disabled={posting || (!noteText.trim() && !workCompleted.trim() && !upcomingWork.trim() && !nextSteps.trim() && stagedPhotos.length === 0)}>
            {posting ? 'Posting…' : 'Post update'}
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
              {isExpanded && (
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
                </>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
