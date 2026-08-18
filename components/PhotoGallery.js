'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import { watermarkImage } from '../lib/watermark';

export default function PhotoGallery({ jobId, updateId, title, allowUpload = true, bare = false }) {
  const { settings } = useSettings();
  const [photos, setPhotos] = useState([]);
  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState('');
  const fileInputRef = useRef(null);

  const loadPhotos = useCallback(async () => {
    let query = supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    query = updateId ? query.eq('update_id', updateId) : query.is('update_id', null);
    const { data } = await query;
    if (data) setPhotos(data);
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

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadNote(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);

    for (const file of files) {
      try {
        const watermarked = await watermarkImage(file, settings.logo_url);
        const path = `${jobId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('job-photos').upload(path, watermarked, {
          contentType: 'image/jpeg',
        });
        if (uploadError) throw uploadError;

        await supabase.from('job_photos').insert({
          job_id: jobId,
          update_id: updateId || null,
          storage_path: path,
        });
      } catch (err) {
        setUploadNote(`Upload failed: ${err.message}`);
        setUploading(false);
        return;
      }
    }

    setUploadNote(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded.`);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => setUploadNote(''), 3000);
  }

  async function removePhoto(photo) {
    if (!confirm('Delete this photo?')) return;
    await supabase.storage.from('job-photos').remove([photo.storage_path]);
    await supabase.from('job_photos').delete().eq('id', photo.id);
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
            capture="environment"
            multiple
            onChange={handleFiles}
            style={{ display: 'none' }}
          />
          <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Take / Add Photos'}
            </button>
          </div>
          {uploadNote && (
            <div style={{ fontSize: 12, color: uploadNote.startsWith('Upload failed') ? '#a13f3f' : '#3a6b45', marginBottom: 12 }}>
              {uploadNote}
            </div>
          )}
        </>
      )}

      {photos.length === 0 && !bare && <div className="empty-state">No photos yet.</div>}

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map(p => (
            <div className="photo-tile" key={p.id}>
              {urls[p.id] ? (
                <a href={urls[p.id]} target="_blank" rel="noopener noreferrer">
                  <img src={urls[p.id]} alt="" />
                </a>
              ) : (
                <div className="photo-tile-loading" />
              )}
              <div className="photo-tile-actions">
                {urls[p.id] && <a href={urls[p.id]} download className="btn btn-sm">Download</a>}
                <button className="btn btn-sm btn-danger" onClick={() => removePhoto(p)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (bare) return content;
  return <div className="card">{content}</div>;
}
