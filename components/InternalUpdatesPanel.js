'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { compressImage } from '../lib/imageCompress';
import { queueInternalUpdate, queuePhoto, queueChecklistToggle } from '../lib/syncQueue';
import { useOfflineSync } from '../lib/useOfflineSync';
import { cacheJobPatch, getCachedJob } from '../lib/offlineDb';

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
  const [stagedPhotos, setStagedPhotos] = useState([]); // [{ file, previewUrl }]
  const [posting, setPosting] = useState(false);

  const [checklist, setChecklist] = useState([]);
  const [syncedUpdates, setSyncedUpdates] = useState([]);
  const [syncedPhotosByUpdate, setSyncedPhotosByUpdate] = useState({});
  const [signedUrls, setSignedUrls] = useState({});
  const [promoting, setPromoting] = useState(null); // update id currently being promoted

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

  function removeStagedPhoto(index) {
    setStagedPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!noteText.trim() && stagedPhotos.length === 0) return;
    setPosting(true);

    const updateId = crypto.randomUUID();
    await queueInternalUpdate({ id: updateId, jobId, text: noteText.trim() || null, createdByEmail });

    for (const { file } of stagedPhotos) {
      const compressed = await compressImage(file);
      await queuePhoto({ jobId, file: compressed, createdByEmail, updateId });
    }

    setNoteText('');
    setStagedPhotos([]);
    setPosting(false);
  }

  async function handleToggleChecklistItem(item) {
    const nextComplete = !item.is_complete;
    const updated = checklist.map(i => (i.id === item.id ? { ...i, is_complete: nextComplete } : i));
    setChecklist(updated);
    cacheJobPatch(jobId, { checklist: updated });
    await queueChecklistToggle({ jobId, itemId: item.id, isComplete: nextComplete, completedByEmail: createdByEmail });
  }

  async function promoteToProgressUpdate(update) {
    if (!isOnline) return;
    setPromoting(update.id);
    const { data, error } = await supabase.from('job_updates').insert({
      job_id: jobId,
      is_internal: false,
      work_completed: update.issues_notes,
    }).select().single();
    if (!error && data) {
      await supabase.from('job_updates').update({ promoted_to_update_id: data.id }).eq('id', update.id);
      loadUpdates();
    }
    setPromoting(null);
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
        <h3>Post an internal update</h3>
        <form onSubmit={handlePost} className="field-log-form">
          <textarea placeholder="What's happening on site?" value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} />

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

          <label className="field-photo-button">
            Add photos
            <input type="file" accept="image/*" capture="environment" multiple onChange={handleAddPhotos} style={{ display: 'none' }} />
          </label>

          <button type="submit" disabled={posting || (!noteText.trim() && stagedPhotos.length === 0)}>
            {posting ? 'Posting…' : 'Post update'}
          </button>
        </form>
      </section>

      <section className="field-log-section">
        <h3>Recent internal updates</h3>
        {feed.length === 0 && <div className="empty-state">No internal updates yet.</div>}
        {feed.map(u => {
          const photos = u._pending ? u._photos : (syncedPhotosByUpdate[u.id] || []);
          return (
            <div className="update-entry" key={u.id}>
              <div className="update-date">
                {fmtTimestamp(u.created_at)}
                {u._pending && <span className="pending-tag"> · syncing…</span>}
              </div>
              {u.issues_notes && <p>{u.issues_notes}</p>}
              {photos.length > 0 && (
                <div className="update-photo-strip">
                  {photos.map(p => (
                    <img key={p.id} src={p._localUrl || signedUrls[p.id]} alt="" />
                  ))}
                </div>
              )}
              {!u._pending && (
                u.promoted_to_update_id ? (
                  <div className="promoted-tag">✓ Added to Progress Update</div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!isOnline || promoting === u.id}
                    onClick={() => promoteToProgressUpdate(u)}
                    title={!isOnline ? 'Reconnect to add this to a Progress Update' : ''}
                  >
                    {promoting === u.id ? 'Adding…' : 'Add to Progress Update'}
                  </button>
                )
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
