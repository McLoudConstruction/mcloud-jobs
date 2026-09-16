'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { watermarkImage } from '../lib/watermark';
import PhotoMarkupEditor from './PhotoMarkupEditor';
import CameraCapture from './CameraCapture';

export default function PhotoGallery({ jobId, updateId, title, allowUpload = true, bare = false }) {
  const { settings } = useSettings();
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [generalPhotos, setGeneralPhotos] = useState([]);
  const [generalUrls, setGeneralUrls] = useState({});
  const [markupPhoto, setMarkupPhoto] = useState(null); // { id, url } of photo currently being marked up
  const [markupSaving, setMarkupSaving] = useState(false);
  const [folders, setFolders] = useState([]); // distinct folder names already used on this job
  const [selectedFolder, setSelectedFolder] = useState(''); // folder new uploads go into; '' = General
  const [newFolderName, setNewFolderName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [filterFolder, setFilterFolder] = useState('__all__'); // which folder's photos to display
  const fileInputRef = useRef(null);

  const loadPhotos = useCallback(async () => {
    let query = supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    query = updateId ? query.eq('update_id', updateId) : query.is('update_id', null);
    const { data } = await query;
    if (data) {
      setPhotos(data);
      setFolders([...new Set(data.map(p => p.folder).filter(Boolean))].sort());
    }
  }, [jobId, updateId]);

  useEffect(() => {
    loadPhotos();
    const channel = supabase
      .channel(`photos-${jobId}-${updateId || 'general'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos', filter: `job_id=eq.${jobId}` }, loadPhotos)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, updateId, loadPhotos]);

  useEffect(() => {
    async function loadUrls() {
      const entries = await Promise.all(
        photos.map(async p => {
          const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
          return [p.id, data?.signedUrl];
        })
      );
      setUrls(Object.fromEntries(entries));
    }
    if (photos.length) loadUrls();
  }, [photos]);

  async function uploadOnePhoto(file) {
    const watermarked = await watermarkImage(file, settings.watermark_logo_url || settings.logo_url);
    const path = `${jobId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, watermarked, {
      contentType: 'image/jpeg',
    });
    if (uploadError) throw uploadError;

    await supabase.from('job_photos').insert({
      job_id: jobId,
      update_id: updateId || null,
      storage_path: path,
      folder: selectedFolder || null,
    });
  }

  function confirmNewFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setSelectedFolder(name);
    setFolders(prev => prev.includes(name) ? prev : [...prev, name].sort());
    setNewFolderName('');
    setAddingFolder(false);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadNote(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);

    // Uploaded in parallel rather than one-at-a-time — a batch of photos
    // used to wait on each file's watermark+upload+insert before starting
    // the next; now every file's round trip happens at once.
    const results = await Promise.allSettled(files.map(uploadOnePhoto));
    const failedCount = results.filter(r => r.status === 'rejected').length;

    setUploadNote(
      failedCount === 0
        ? `${files.length} photo${files.length === 1 ? '' : 's'} uploaded.`
        : `${files.length - failedCount} of ${files.length} uploaded — ${failedCount} failed.`
    );
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setUploadNote(''), failedCount ? 6000 : 3000);
  }

  // Called once per photo as the camera accepts it (retake/use flow), so
  // each shot uploads in the background while the camera stays open for
  // the next one, instead of batching until the whole session ends.
  async function handleCameraPhoto(file) {
    setUploading(true);
    setUploadNote('Uploading photo…');
    try {
      await uploadOnePhoto(file);
      setUploadNote('Photo uploaded.');
    } catch (err) {
      setUploadNote(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadNote(''), 2000);
    }
  }

  async function removePhoto(photo) {
    if (!confirm('Delete this photo?')) return;
    await supabase.storage.from('job-photos').remove([photo.storage_path]);
    const { error } = await supabase.from('job_photos').delete().eq('id', photo.id);
    if (error) {
      alert('Failed to delete photo: ' + error.message);
      return;
    }
    // Update local state directly instead of waiting on the realtime
    // subscription above — job_photos isn't reliably in the Supabase
    // realtime publication (same root cause as past "needs a page
    // refresh" bugs elsewhere), so don't depend on it for feedback the
    // person doing the deleting needs immediately.
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
    setUrls(prev => {
      const next = { ...prev };
      delete next[photo.id];
      return next;
    });
  }

  async function openPicker() {
    const { data } = await supabase.from('job_photos').select('*').eq('job_id', jobId).is('update_id', null).order('created_at', { ascending: false });
    const list = data || [];
    setGeneralPhotos(list);
    const entries = await Promise.all(
      list.map(async p => {
        const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
        return [p.id, signed?.signedUrl];
      })
    );
    setGeneralUrls(Object.fromEntries(entries));
    setPickerOpen(true);
  }

  async function attachPhoto(photoId) {
    await supabase.from('job_photos').update({ update_id: updateId }).eq('id', photoId);
    setGeneralPhotos(prev => prev.filter(p => p.id !== photoId));
  }

  function openMarkup(photo) {
    if (!urls[photo.id]) return;
    setMarkupPhoto({ id: photo.id, url: urls[photo.id] });
  }

  async function saveMarkup(blob) {
    setMarkupSaving(true);
    try {
      const path = `${jobId}/${Date.now()}-markup.jpg`;
      const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      await supabase.from('job_photos').insert({
        job_id: jobId,
        update_id: updateId || null,
        storage_path: path,
        derived_from_photo_id: markupPhoto.id,
      });
      setMarkupPhoto(null);
    } catch (err) {
      alert('Failed to save markup: ' + err.message);
    } finally {
      setMarkupSaving(false);
    }
  }

  const content = (
    <>
      {!bare && <h3>{title || 'Photos'}</h3>}

      {allowUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: 0 }}>Select a Folder for Upload</label>
            <select
              value={addingFolder ? '__new__' : selectedFolder}
              onChange={e => {
                if (e.target.value === '__new__') { setAddingFolder(true); return; }
                setAddingFolder(false);
                setSelectedFolder(e.target.value);
              }}
              style={{ width: 'auto', minWidth: 140 }}
            >
              <option value="">General (no folder)</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
              <option value="__new__">+ New folder…</option>
            </select>
            {addingFolder && (
              <>
                <input
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  style={{ width: 160 }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmNewFolder(); } }}
                />
                <button className="btn btn-sm" type="button" onClick={confirmNewFolder}>Add</button>
              </>
            )}
          </div>
          <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setCameraOpen(true)} disabled={uploading} type="button">
              {uploading ? 'Uploading…' : 'Take Photos'}
            </button>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} type="button">
              Upload from library
            </button>
            {updateId && (
              <button className="btn btn-sm" onClick={openPicker} type="button">Attach existing photo</button>
            )}
          </div>
          {uploadNote && (
            <div style={{ fontSize: 12, color: uploadNote.startsWith('Upload failed') ? '#a13f3f' : '#3a6b45', marginBottom: 12 }}>
              {uploadNote}
            </div>
          )}
          {pickerOpen && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, background: 'var(--panel)' }}>
              <div className="section-actions" style={{ marginTop: 0, marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Click a photo from the job's general library to attach it here.</span>
                <button className="btn btn-sm" onClick={() => setPickerOpen(false)} type="button">Close</button>
              </div>
              {generalPhotos.length === 0 && <div className="empty-state" style={{ padding: '10px 0' }}>No unattached photos in the job library.</div>}
              <div className="photo-grid">
                {generalPhotos.map(p => (
                  <div className="photo-tile" key={p.id} style={{ cursor: 'pointer' }} onClick={() => attachPhoto(p.id)}>
                    {generalUrls[p.id] ? <img src={generalUrls[p.id]} alt="" /> : <div className="photo-tile-loading" />}
                    <div className="photo-tile-actions">
                      <span className="btn btn-sm" style={{ flex: 1, textAlign: 'center' }}>Attach</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {photos.length === 0 && !bare && <div className="empty-state">No photos yet.</div>}

      {folders.length > 0 && photos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className={`btn btn-sm ${filterFolder === '__all__' ? 'btn-primary' : ''}`} onClick={() => setFilterFolder('__all__')} type="button">All</button>
          <button className={`btn btn-sm ${filterFolder === '__general__' ? 'btn-primary' : ''}`} onClick={() => setFilterFolder('__general__')} type="button">General</button>
          {folders.map(f => (
            <button key={f} className={`btn btn-sm ${filterFolder === f ? 'btn-primary' : ''}`} onClick={() => setFilterFolder(f)} type="button">{f}</button>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos
            .filter(p => filterFolder === '__all__' || (filterFolder === '__general__' ? !p.folder : p.folder === filterFolder))
            .map(p => (
            <div className="photo-tile" key={p.id}>
              {urls[p.id] ? (
                <a href={urls[p.id]} target="_blank" rel="noopener noreferrer">
                  <img src={urls[p.id]} alt="" />
                </a>
              ) : (
                <div className="photo-tile-loading" />
              )}
              {p.folder && <span className="photo-markup-badge" style={{ left: 6, right: 'auto' }}>{p.folder}</span>}
              {p.derived_from_photo_id && <span className="photo-markup-badge">Marked up</span>}
              <div className="photo-tile-actions">
                {urls[p.id] && <button className="btn btn-sm" onClick={() => openMarkup(p)} type="button">Markup</button>}
                {urls[p.id] && <a href={urls[p.id]} download className="btn btn-sm">Download</a>}
                <button className="btn btn-sm btn-danger" onClick={() => removePhoto(p)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const cameraOverlay = (
    <CameraCapture
      open={cameraOpen}
      onClose={() => setCameraOpen(false)}
      onPhotoAccepted={handleCameraPhoto}
      title={title || 'Photos'}
    />
  );

  if (bare) return <>{content}{markupPhoto && <PhotoMarkupEditor imageUrl={markupPhoto.url} onSave={saveMarkup} onClose={() => setMarkupPhoto(null)} />}{cameraOverlay}</>;
  return (
    <div className="card">
      {content}
      {markupPhoto && <PhotoMarkupEditor imageUrl={markupPhoto.url} onSave={saveMarkup} onClose={() => setMarkupPhoto(null)} />}
      {cameraOverlay}
    </div>
  );
}
