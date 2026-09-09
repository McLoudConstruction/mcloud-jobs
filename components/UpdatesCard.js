'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import Link from 'next/link';
import { compressImage } from '../lib/imageCompress';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpdatesCard({ jobId, updates }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    update_date: new Date().toISOString().slice(0, 10),
    work_completed: '', upcoming_work: '', issues_notes: '', next_steps: '', estimated_completion: '',
  });
  const [saving, setSaving] = useState(false);

  // Photos staged while composing — attached to the update at submit time
  // rather than requiring you to save the text first and then find it in
  // the list below to add photos afterward (which was still possible via
  // that entry's own PhotoGallery, just not a one-step flow).
  const [stagedPhotos, setStagedPhotos] = useState([]); // [{ file, previewUrl }]
  const photoInputRef = useRef(null);

  // Existing, already-uploaded job photos (general library, not yet tied
  // to any update) that get picked to attach to this draft. Kept as local
  // selection only — the actual job_photos.update_id write happens at
  // submit, same moment new uploads get linked — so canceling the draft
  // never leaves a photo pointing at an update that was never created.
  const [existingPickerOpen, setExistingPickerOpen] = useState(false);
  const [unattachedPhotos, setUnattachedPhotos] = useState([]);
  const [unattachedUrls, setUnattachedUrls] = useState({});
  const [selectedExisting, setSelectedExisting] = useState([]); // [{ id, url }]

  async function openExistingPicker() {
    const { data } = await supabase.from('job_photos').select('*').eq('job_id', jobId).is('update_id', null).order('created_at', { ascending: false });
    const list = (data || []).filter(p => !selectedExisting.some(s => s.id === p.id));
    setUnattachedPhotos(list);
    const entries = await Promise.all(
      list.map(async p => {
        const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
        return [p.id, signed?.signedUrl];
      })
    );
    setUnattachedUrls(Object.fromEntries(entries));
    setExistingPickerOpen(true);
  }

  function selectExisting(photo) {
    setSelectedExisting(prev => [...prev, { id: photo.id, url: unattachedUrls[photo.id] }]);
    setUnattachedPhotos(prev => prev.filter(p => p.id !== photo.id));
  }

  function removeSelectedExisting(id) {
    setSelectedExisting(prev => prev.filter(p => p.id !== id));
  }

  // Reference sidebar: the running Internal Updates log, visible while
  // actively writing a formal progress update — not a one-click "promote"
  // action (that turned out to add little value beyond syncing across
  // devices, which any job_updates row already does). This is meant to
  // be referenced while writing, the way you'd glance at field notes.
  const [internalLog, setInternalLog] = useState([]);
  const [internalPhotos, setInternalPhotos] = useState({});

  const loadInternalLog = useCallback(async () => {
    const { data: entries } = await supabase.from('job_updates').select('*').eq('job_id', jobId).eq('is_internal', true).order('created_at', { ascending: false });
    if (!entries) return;
    setInternalLog(entries);
    if (entries.length === 0) { setInternalPhotos({}); return; }
    const { data: photos } = await supabase.from('job_photos').select('*').in('update_id', entries.map(e => e.id));
    const grouped = {};
    for (const p of photos || []) (grouped[p.update_id] = grouped[p.update_id] || []).push(p);
    const withUrls = {};
    for (const [uid, pics] of Object.entries(grouped)) {
      withUrls[uid] = await Promise.all(pics.map(async p => {
        const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
        return { id: p.id, url: signed?.signedUrl };
      }));
    }
    setInternalPhotos(withUrls);
  }, [jobId]);

  useEffect(() => {
    if (!showForm) return;
    loadInternalLog();
    const channel = supabase.channel(`internal-log-ref-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${jobId}` }, loadInternalLog)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos', filter: `job_id=eq.${jobId}` }, loadInternalLog)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [showForm, jobId, loadInternalLog]);

  function insertIntoDraft(text) {
    setForm(prev => ({ ...prev, work_completed: prev.work_completed ? `${prev.work_completed}\n\n${text}` : text }));
  }

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function handleStagePhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setStagedPhotos(prev => [...prev, ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removeStagedPhoto(index) {
    setStagedPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setSaving(true);
    // Client-generated id (same pattern already used for offline-synced
    // internal updates) so the photos below can be linked to this exact
    // update in the same submit action, instead of needing a second
    // round-trip after the insert to learn the new row's id.
    const updateId = crypto.randomUUID();
    await supabase.from('job_updates').insert({ id: updateId, job_id: jobId, ...form, estimated_completion: form.estimated_completion || null });

    for (const { file } of stagedPhotos) {
      try {
        const compressed = await compressImage(file);
        const basePath = `${jobId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        // Uploaded once, then duplicated as two independent storage
        // objects + rows — one general (update_id null, so it shows up
        // in the main Photos tab automatically) and one tied to this
        // update. Independent objects rather than two rows sharing one
        // file on purpose: deleting the photo from either the Photos tab
        // or from this specific update must not silently break the other.
        const generalPath = `${basePath}-general.jpg`;
        const updatePath = `${basePath}-update.jpg`;
        const { error: uploadError } = await supabase.storage.from('job-photos').upload(generalPath, compressed, { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { error: copyError } = await supabase.storage.from('job-photos').copy(generalPath, updatePath);
        if (copyError) throw copyError;
        await supabase.from('job_photos').insert([
          { job_id: jobId, update_id: null, storage_path: generalPath },
          { job_id: jobId, update_id: updateId, storage_path: updatePath },
        ]);
      } catch {
        // Individual photo failures shouldn't block the text update, which
        // already saved successfully — the entry's own PhotoGallery below
        // can always be used to retry adding it.
      }
    }

    for (const { id: sourceId } of selectedExisting) {
      try {
        // These are already in the general Photos-tab bucket — attaching
        // them here must not remove them from there, so this copies the
        // underlying file to a second, independent storage object rather
        // than reassigning the existing row's update_id (which would pull
        // it out of the general bucket's query entirely).
        const { data: source } = await supabase.from('job_photos').select('storage_path').eq('id', sourceId).single();
        if (!source) continue;
        const updatePath = `${jobId}/${Date.now()}-${sourceId}-update.jpg`;
        const { error: copyError } = await supabase.storage.from('job-photos').copy(source.storage_path, updatePath);
        if (copyError) throw copyError;
        await supabase.from('job_photos').insert({ job_id: jobId, update_id: updateId, storage_path: updatePath });
      } catch {
        // Same reasoning as above — don't let one failed copy block the rest.
      }
    }

    setSaving(false);
    setShowForm(false);
    setForm({ update_date: new Date().toISOString().slice(0, 10), work_completed: '', upcoming_work: '', issues_notes: '', next_steps: '', estimated_completion: '' });
    setStagedPhotos([]);
    setSelectedExisting([]);
  }

  function cancelCompose() {
    setShowForm(false);
    setStagedPhotos([]);
    setSelectedExisting([]);
    setExistingPickerOpen(false);
  }

  async function removeUpdate(updateId) {
    if (!confirm('Delete this update entry?')) return;
    await supabase.from('job_updates').delete().eq('id', updateId);
  }

  return (
    <div className="card">
      <h3>Project updates</h3>

      {showForm ? (
        <div className="update-compose-layout">
          <div className="update-compose-form">
            <div className="two-col">
              <div><label>Date</label><input type="date" value={form.update_date} onChange={e => update('update_date', e.target.value)} /></div>
              <div><label>Estimated completion</label><input type="date" value={form.estimated_completion} onChange={e => update('estimated_completion', e.target.value)} /></div>
            </div>
            <label>Work completed</label>
            <textarea value={form.work_completed} onChange={e => update('work_completed', e.target.value)} />
            <label>Upcoming work</label>
            <textarea value={form.upcoming_work} onChange={e => update('upcoming_work', e.target.value)} />
            <label>Issues / notes</label>
            <textarea value={form.issues_notes} onChange={e => update('issues_notes', e.target.value)} />
            <label>Next steps</label>
            <textarea value={form.next_steps} onChange={e => update('next_steps', e.target.value)} />

            <label>Photos</label>
            {(stagedPhotos.length > 0 || selectedExisting.length > 0) && (
              <div className="staged-photo-strip">
                {stagedPhotos.map((p, i) => (
                  <div key={`new-${i}`} className="staged-photo-thumb">
                    <img src={p.previewUrl} alt="" />
                    <button type="button" onClick={() => removeStagedPhoto(i)}>×</button>
                  </div>
                ))}
                {selectedExisting.map(p => (
                  <div key={`existing-${p.id}`} className="staged-photo-thumb">
                    {p.url ? <img src={p.url} alt="" /> : <div className="photo-tile-loading" />}
                    <button type="button" onClick={() => removeSelectedExisting(p.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={handleStagePhotos} style={{ display: 'none' }} />
            <div className="section-actions" style={{ marginTop: 0, marginBottom: 4 }}>
              <button type="button" className="btn btn-sm" onClick={() => photoInputRef.current?.click()}>Add photos</button>
              <button type="button" className="btn btn-sm" onClick={() => (existingPickerOpen ? setExistingPickerOpen(false) : openExistingPicker())}>
                {existingPickerOpen ? 'Close' : 'Attach existing photo'}
              </button>
            </div>

            {existingPickerOpen && (
              <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, background: 'var(--panel)' }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                  Click a photo from this job's general library to attach it to this update.
                </div>
                {unattachedPhotos.length === 0 && <div className="empty-state" style={{ padding: '10px 0' }}>No unattached photos in the job library.</div>}
                <div className="photo-grid">
                  {unattachedPhotos.map(p => (
                    <div className="photo-tile" key={p.id} style={{ cursor: 'pointer' }} onClick={() => selectExisting(p)}>
                      {unattachedUrls[p.id] ? <img src={unattachedUrls[p.id]} alt="" /> : <div className="photo-tile-loading" />}
                      <div className="photo-tile-actions">
                        <span className="btn btn-sm" style={{ flex: 1, textAlign: 'center' }}>Attach</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Post update'}</button>
              <button className="btn btn-sm" onClick={cancelCompose}>Cancel</button>
            </div>
          </div>

          <div className="internal-log-sidebar">
            <h4>Internal Updates</h4>
            <div className="internal-log-scroll">
              {internalLog.length === 0 && <div className="empty-state">No internal updates logged yet.</div>}
              {internalLog.map(entry => (
                <div key={entry.id} className="internal-log-entry">
                  <div className="internal-log-date">{fmtDateTime(entry.created_at)}</div>
                  {entry.issues_notes && <p>{entry.issues_notes}</p>}
                  {internalPhotos[entry.id]?.length > 0 && (
                    <div className="internal-log-photos">
                      {internalPhotos[entry.id].map(p => <img key={p.id} src={p.url} alt="" />)}
                    </div>
                  )}
                  {entry.issues_notes && (
                    <button type="button" className="btn btn-sm" onClick={() => insertIntoDraft(entry.issues_notes)}>Insert into draft</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Post new update</button>
        </div>
      )}

      {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
      {updates.map(u => (
        <div className="update-entry" key={u.id}>
          <div className="update-date">{fmtDate(u.update_date)}</div>
          {u.work_completed && <><div className="update-field-label">Work completed</div><p>{u.work_completed}</p></>}
          {u.upcoming_work && <><div className="update-field-label">Upcoming work</div><p>{u.upcoming_work}</p></>}
          {u.issues_notes && <><div className="update-field-label">Issues / notes</div><p>{u.issues_notes}</p></>}
          {u.next_steps && <><div className="update-field-label">Next steps</div><p>{u.next_steps}</p></>}
          {u.estimated_completion && <><div className="update-field-label">Estimated completion</div><p>{fmtDate(u.estimated_completion)}</p></>}
          <div className="update-field-label" style={{ marginTop: 10 }}>Photos</div>
          <PhotoGallery jobId={jobId} updateId={u.id} bare />
          <div className="section-actions">
            <Link href={`/jobs/${jobId}/updates/${u.id}`} className="btn btn-sm">Generate PDF</Link>
            <button className="btn btn-sm btn-danger" onClick={() => removeUpdate(u.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
