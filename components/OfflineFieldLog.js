'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { compressImage } from '../lib/imageCompress';
import { queueNote, queueTimeEntry, queuePhoto, queueChecklistToggle } from '../lib/syncQueue';
import { useOfflineSync } from '../lib/useOfflineSync';
import { cacheJobPatch, getCachedJob } from '../lib/offlineDb';

function SyncBadge({ jobId }) {
  const { isOnline, pendingCount, failedCount, sync } = useOfflineSync(jobId);
  if (isOnline && pendingCount === 0 && failedCount === 0) return null;
  return (
    <div className={`sync-badge ${isOnline ? '' : 'sync-badge-offline'}`}>
      {!isOnline && <span>Offline — changes will sync when reconnected</span>}
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

export default function OfflineFieldLog({ jobId, session }) {
  const createdByEmail = session?.user?.email || null;

  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);

  const [checklist, setChecklist] = useState([]);

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

  useEffect(() => {
    loadChecklist();
    const channel = supabase
      .channel(`checklist-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `job_id=eq.${jobId}` }, loadChecklist)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadChecklist]);

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSavingNote(true);
    await queueNote({ jobId, text: noteText.trim(), createdByEmail });
    setNoteText('');
    setSavingNote(false);
  }

  async function handleAddTimeEntry(e) {
    e.preventDefault();
    const parsedHours = parseFloat(hours);
    if (!parsedHours || parsedHours <= 0) return;
    setSavingEntry(true);
    await queueTimeEntry({ jobId, entryDate, hours: parsedHours, notes: entryNotes.trim() || null, createdByEmail });
    setHours('');
    setEntryNotes('');
    setSavingEntry(false);
  }

  async function handlePhotoCapture(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const compressed = await compressImage(file);
    await queuePhoto({ jobId, file: compressed, createdByEmail });
  }

  async function handleToggleChecklistItem(item) {
    const nextComplete = !item.is_complete;
    // Optimistic UI — the actual write goes through the queue, which
    // syncs immediately if online or waits if not, but the checkbox
    // shouldn't feel like it's waiting on a network round-trip. Also
    // written to the offline cache, not just React state, so the toggle
    // survives the app being closed and reopened while still offline.
    const updated = checklist.map(i => (i.id === item.id ? { ...i, is_complete: nextComplete } : i));
    setChecklist(updated);
    cacheJobPatch(jobId, { checklist: updated });
    await queueChecklistToggle({ jobId, itemId: item.id, isComplete: nextComplete, completedByEmail: createdByEmail });
  }

  return (
    <div className="offline-field-log">
      <SyncBadge jobId={jobId} />

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
        <h3>Add a photo</h3>
        <label className="field-photo-button">
          Take or choose a photo
          <input type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} style={{ display: 'none' }} />
        </label>
      </section>

      <section className="field-log-section">
        <h3>Log time</h3>
        <form onSubmit={handleAddTimeEntry} className="field-log-form">
          <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} required />
          <input type="number" step="0.25" min="0" placeholder="Hours" value={hours} onChange={e => setHours(e.target.value)} required />
          <input type="text" placeholder="Notes (optional)" value={entryNotes} onChange={e => setEntryNotes(e.target.value)} />
          <button type="submit" disabled={savingEntry}>{savingEntry ? 'Saving…' : 'Log time'}</button>
        </form>
      </section>

      <section className="field-log-section">
        <h3>Add a note</h3>
        <form onSubmit={handleAddNote} className="field-log-form">
          <textarea placeholder="What's happening on site?" value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} />
          <button type="submit" disabled={savingNote || !noteText.trim()}>{savingNote ? 'Saving…' : 'Add note'}</button>
        </form>
      </section>
    </div>
  );
}
