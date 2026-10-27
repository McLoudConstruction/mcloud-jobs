'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../lib/useSettings';
import {
  enqueuePhoto, makeThumbnail, onPhotoSynced, usePhotoDestination, usePhotoQueue, discardPhoto,
} from '../lib/jobPhotos';
import { cleanFolderName, ensureFolder, fetchFolders, INITIAL_INSPECTION, resolveDestination } from '../lib/photoFolders';
import { DEFAULT_TZ, isDayFolder, photoDownloadName, uniqueNames, zipName } from '../lib/photoNames';
import PhotoMarkupEditor from './PhotoMarkupEditor';
import PhotoViewer from './PhotoViewer';
import CameraCapture from './CameraCapture';
import ShareLinkButton from './ShareLinkButton';
import DestinationPicker, { FolderSheet } from './DestinationPicker';
import {
  CheckIcon, ChevronLeftIcon, DownloadIcon, EditIcon, FolderIcon, ShareIcon, TrashIcon, CameraIcon, MoreIcon,
} from './photoIcons';

const PAGE = 60;

function bucketOf(p) { return p.source_bucket || 'job-photos'; }

function PendingTile({ item, onRetry, onDiscard }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(item.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.blob]);
  const failed = item.status === 'failed';
  return (
    <div className="pg-tile" style={{ cursor: 'default' }}>
      {url && <img src={url} alt="" />}
      <div className="pg-pending">
        {failed ? (
          <>
            <span>Not uploaded</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="pg-bar-btn solid" style={{ height: 28, padding: '0 10px', fontSize: 11 }} onClick={() => onRetry(item.id)}>Retry</button>
              <button type="button" className="pg-bar-btn" style={{ height: 28, padding: '0 10px', fontSize: 11 }} onClick={() => onDiscard(item.id)}>Remove</button>
            </span>
          </>
        ) : <span>Uploading</span>}
      </div>
    </div>
  );
}

export default function PhotoGallery({ jobId, updateId, title, allowUpload = true, bare = false }) {
  const { settings } = useSettings();
  const tz = settings?.timezone || DEFAULT_TZ;
  const prefix = settings?.photo_file_prefix || '';
  const logoUrl = settings?.watermark_logo_url || settings?.logo_url || null;

  const [photos, setPhotos] = useState([]);
  const [folderRows, setFolderRows] = useState([]); // [{ name, kind }]
  const [thumbUrls, setThumbUrls] = useState({});
  const [filterFolder, setFilterFolder] = useState(''); // '' = top level
  const [limit, setLimit] = useState(PAGE);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generalPhotos, setGeneralPhotos] = useState([]);
  const [generalUrls, setGeneralUrls] = useState({});
  const [jobInfo, setJobInfo] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [markupQueue, setMarkupQueue] = useState(null); // { ids, pos }
  const [markupUrl, setMarkupUrl] = useState('');

  const fileInputRef = useRef(null);
  const fullUrlCache = useRef(new Map());
  const signing = useRef(new Set());
  const noThumb = useRef(new Set());

  const destination = usePhotoDestination(jobId);
  const queue = usePhotoQueue(jobId);

  // ── Data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('jobs').select('customer_name, customer_contact, project_address, project_number').eq('id', jobId).maybeSingle()
      .then(({ data }) => { if (data) setJobInfo(data); });
  }, [jobId]);

  const loadPhotos = useCallback(async () => {
    let query = supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    // Scoped to one update's photos when embedded on that update; otherwise
    // every photo on the job, including ones taken through an Internal Update.
    if (updateId) query = query.eq('update_id', updateId);
    const { data } = await query;
    if (data) setPhotos(data);
  }, [jobId, updateId]);

  const loadFolders = useCallback(async () => {
    if (updateId) return;
    setFolderRows(await fetchFolders(supabase, jobId));
  }, [jobId, updateId]);

  useEffect(() => {
    loadPhotos();
    loadFolders();
    const channel = supabase
      .channel(`photos-${jobId}-${updateId || 'general'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos', filter: `job_id=eq.${jobId}` }, () => { loadPhotos(); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, updateId, loadPhotos, loadFolders]);

  // job_photos is not reliably in the realtime publication, so a finished
  // upload from the local queue refreshes the list itself.
  useEffect(() => onPhotoSynced(item => {
    if (item.jobId === jobId) { loadPhotos(); loadFolders(); }
  }), [jobId, loadPhotos, loadFolders]);

  // ── Folders for display ─────────────────────────────────────────────────
  const folderList = useMemo(() => {
    const map = new Map();
    const add = (name, kind) => {
      if (!name) return;
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, kind: isDayFolder(name) ? 'day' : kind });
    };
    folderRows.forEach(f => add(f.name, f.kind));
    photos.forEach(p => add(p.folder, 'named'));
    queue.items.forEach(i => add(i.folder, i.folderKind || 'named'));
    const rank = f => (f.name.toLowerCase() === INITIAL_INSPECTION.toLowerCase() ? 0 : f.kind === 'day' ? 2 : 1);
    return [...map.values()].sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 2) return b.name.localeCompare(a.name);
      return a.name.localeCompare(b.name);
    });
  }, [folderRows, photos, queue.items]);

  const currentFolder = folderList.find(f => f.name === filterFolder) || null;

  const visible = useMemo(
    () => photos.filter(p => (filterFolder === '' ? !p.folder : p.folder === filterFolder)),
    [photos, filterFolder]
  );
  const shown = visible.slice(0, limit);
  const pendingHere = queue.items.filter(i => (filterFolder === '' ? !i.folder : i.folder === filterFolder)
    && (!updateId || i.updateId === updateId));

  const covers = useMemo(() => {
    const out = {};
    photos.forEach(p => { if (p.folder && !out[p.folder]) out[p.folder] = p; });
    return out;
  }, [photos]);

  // ── Signing (thumbnails in batches, full size on demand) ─────────────────
  const ensureThumbs = useCallback(async list => {
    const need = list.filter(p => p && !thumbUrls[p.id] && !signing.current.has(p.id));
    if (!need.length) return;
    need.forEach(p => signing.current.add(p.id));
    const groups = {};
    need.forEach(p => {
      const path = p.thumb_path && !noThumb.current.has(p.id) ? p.thumb_path : p.storage_path;
      const b = bucketOf(p);
      (groups[b] = groups[b] || []).push({ id: p.id, path });
    });
    const got = {};
    for (const [bucket, entries] of Object.entries(groups)) {
      try {
        const { data } = await supabase.storage.from(bucket).createSignedUrls(entries.map(e => e.path), 3600);
        (data || []).forEach((row, i) => { if (row?.signedUrl) got[entries[i].id] = row.signedUrl; });
      } catch { /* retried below */ }
      // Anything the batch missed gets one individual retry.
      for (const e of entries) {
        if (got[e.id]) continue;
        try {
          const { data } = await supabase.storage.from(bucket).createSignedUrl(e.path, 3600);
          if (data?.signedUrl) got[e.id] = data.signedUrl;
        } catch { /* leave blank */ }
      }
    }
    need.forEach(p => signing.current.delete(p.id));
    if (Object.keys(got).length) setThumbUrls(prev => ({ ...prev, ...got }));
  }, [thumbUrls]);

  useEffect(() => { ensureThumbs(shown); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shown.map(p => p.id).join(',')]);
  useEffect(() => {
    if (filterFolder === '') ensureThumbs(Object.values(covers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covers, filterFolder]);

  function thumbFailed(p) {
    if (noThumb.current.has(p.id)) return;
    noThumb.current.add(p.id);
    setThumbUrls(prev => { const n = { ...prev }; delete n[p.id]; return n; });
  }

  const signFull = useCallback(async p => {
    const hit = fullUrlCache.current.get(p.id);
    if (hit) return hit;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabase.storage.from(bucketOf(p)).createSignedUrl(p.storage_path, 3600);
        if (!error && data?.signedUrl) { fullUrlCache.current.set(p.id, data.signedUrl); return data.signedUrl; }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    return null;
  }, []);

  // ── Notes ───────────────────────────────────────────────────────────────
  const flash = useCallback((text, ms = 4000) => {
    setNote(text);
    if (ms) setTimeout(() => setNote(n => (n === text ? '' : n)), ms);
  }, []);

  // ── Taking and adding photos ────────────────────────────────────────────
  async function addFile(file, takenAt) {
    const at = takenAt || Date.now();
    await enqueuePhoto({
      file, jobId, updateId: updateId || null,
      destination: destination.resolve(at), takenAt: at,
      logoUrl, brandName: prefix || null,
    });
  }

  async function handleCameraPhoto(file, meta) {
    try { await addFile(file, meta?.takenAt); } catch (err) { flash(`A photo was not saved: ${err.message || err}`, 8000); }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      try { await addFile(f, Date.now()); } catch (err) { flash(`A photo was not saved: ${err.message || err}`, 8000); }
    }
  }

  function openFolder(name) {
    setFilterFolder(name);
    setLimit(PAGE);
    exitSelect();
    destination.setValue(name);
  }
  function closeFolder() { setFilterFolder(''); setLimit(PAGE); exitSelect(); }

  // ── Select mode ─────────────────────────────────────────────────────────
  function exitSelect() { setSelectMode(false); setSelected(new Set()); setMenuOpen(false); }
  function toggleSelected(id) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  const selectedPhotos = visible.filter(p => selected.has(p.id));

  async function shareSelected(share) {
    setMenuOpen(false);
    const list = selectedPhotos;
    if (!list.length) return;
    setBusy(share ? 'Sharing' : 'Updating');
    const ids = list.map(p => p.id);
    const { error } = await supabase.from('job_photos').update({ is_internal: !share }).in('id', ids);
    if (error) { setBusy(''); flash(`Could not update sharing: ${error.message}`, 8000); return; }
    // Mirrored sub photos are gated by work_order_photos.is_internal.
    const mirrored = list.map(p => p.source_work_order_photo_id).filter(Boolean);
    if (mirrored.length) await supabase.from('work_order_photos').update({ is_internal: !share }).in('id', mirrored);
    setPhotos(prev => prev.map(p => (ids.includes(p.id) ? { ...p, is_internal: !share } : p)));
    setBusy('');
    flash(share
      ? `${list.length} ${list.length === 1 ? 'photo' : 'photos'} shared with the customer.`
      : `${list.length} ${list.length === 1 ? 'photo' : 'photos'} hidden from the customer.`);
    exitSelect();
  }

  function fileNameFor(p, list) {
    const names = uniqueNames(list.map(x => photoDownloadName({
      prefix, projectNumber: jobInfo?.project_number, folder: x.folder, takenAt: x.created_at, tz,
    })));
    return names[list.indexOf(p)];
  }

  function triggerDownload(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    if (filename) a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadSelected() {
    setMenuOpen(false);
    const list = selectedPhotos;
    if (!list.length) return;
    setBusy('Preparing download');
    try {
      if (list.length === 1) {
        const p = list[0];
        const name = fileNameFor(p, list);
        const { data, error } = await supabase.storage.from(bucketOf(p)).createSignedUrl(p.storage_path, 120, { download: name });
        if (error || !data?.signedUrl) throw error || new Error('Could not prepare the file.');
        triggerDownload(data.signedUrl, name);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/photos/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ photoIds: list.map(p => p.id), folder: filterFolder || null }),
        });
        if (!res.ok) {
          let msg = 'Could not build the zip.';
          try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
          throw new Error(msg);
        }
        const blob = await res.blob();
        const header = res.headers.get('content-disposition') || '';
        const match = header.match(/filename="?([^";]+)"?/i);
        const name = match ? match[1] : zipName({ prefix, projectNumber: jobInfo?.project_number, folder: filterFolder || null, tz });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, name);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      flash(`${list.length} ${list.length === 1 ? 'photo' : 'photos'} downloaded.`);
      exitSelect();
    } catch (err) {
      flash(`Download failed: ${err.message || err}`, 8000);
    } finally {
      setBusy('');
    }
  }

  async function deleteSelected() {
    setMenuOpen(false);
    const list = selectedPhotos;
    if (!list.length) return;
    if (!confirm(`Delete ${list.length} ${list.length === 1 ? 'photo' : 'photos'} from this job? This cannot be undone.`)) return;
    setBusy('Deleting');
    const ids = list.map(p => p.id);
    // Rows first: if this fails nothing is lost, and a failed storage
    // cleanup afterwards only leaves an unreferenced file.
    const { error } = await supabase.from('job_photos').delete().in('id', ids);
    if (error) { setBusy(''); flash(`Delete failed: ${error.message}`, 8000); return; }
    const byBucket = {};
    list.forEach(p => {
      // A mirrored sub photo does not own its file (it is the sub's upload).
      if (p.source_work_order_photo_id) return;
      const b = bucketOf(p);
      (byBucket[b] = byBucket[b] || []).push(p.storage_path);
      if (p.thumb_path) byBucket[b].push(p.thumb_path);
    });
    for (const [bucket, paths] of Object.entries(byBucket)) {
      try { await supabase.storage.from(bucket).remove(paths); } catch { /* orphaned file only */ }
    }
    setPhotos(prev => prev.filter(p => !ids.includes(p.id)));
    setBusy('');
    flash(`${list.length} ${list.length === 1 ? 'photo' : 'photos'} deleted.`);
    exitSelect();
  }

  async function moveSelected(dest) {
    const list = selectedPhotos;
    if (!list.length) return;
    setBusy('Moving');
    try {
      await ensureFolder(supabase, jobId, dest);
      const ids = list.map(p => p.id);
      const { error } = await supabase.from('job_photos').update({ folder: dest.folder }).in('id', ids);
      if (error) throw error;
      setPhotos(prev => prev.map(p => (ids.includes(p.id) ? { ...p, folder: dest.folder } : p)));
      await loadFolders();
      flash(`${list.length} ${list.length === 1 ? 'photo' : 'photos'} moved to ${dest.folder}.`);
      exitSelect();
    } catch (err) {
      flash(`Move failed: ${err.message || err}`, 8000);
    } finally {
      setBusy('');
    }
  }

  // ── Markup in turn ──────────────────────────────────────────────────────
  function startMarkup() {
    setMenuOpen(false);
    if (!selectedPhotos.length) return;
    setMarkupUrl('');
    setMarkupQueue({ ids: selectedPhotos.map(p => p.id), pos: 0 });
  }
  const markupPhoto = markupQueue ? photos.find(p => p.id === markupQueue.ids[markupQueue.pos]) : null;

  useEffect(() => {
    let live = true;
    setMarkupUrl('');
    if (markupPhoto) signFull(markupPhoto).then(u => { if (live && u) setMarkupUrl(u); });
    return () => { live = false; };
  }, [markupPhoto?.id, signFull]); // eslint-disable-line react-hooks/exhaustive-deps

  function nextMarkup() {
    setMarkupQueue(q => {
      if (!q) return null;
      if (q.pos + 1 >= q.ids.length) { exitSelect(); loadPhotos(); return null; }
      return { ...q, pos: q.pos + 1 };
    });
  }
  function stopMarkup() { setMarkupQueue(null); exitSelect(); loadPhotos(); }

  async function saveMarkup(blob) {
    const src = markupPhoto;
    try {
      const id = crypto.randomUUID();
      const path = `${jobId}/${id}.jpg`;
      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      let thumbPath = null;
      try {
        const thumb = await makeThumbnail(blob);
        const t = `${jobId}/thumbs/${id}.jpg`;
        const r = await supabase.storage.from('job-photos').upload(t, thumb, { contentType: 'image/jpeg', upsert: true });
        if (!r.error) thumbPath = t;
      } catch { /* optional */ }
      const { data: { session } } = await supabase.auth.getSession();
      const row = {
        id, job_id: jobId, update_id: src.update_id || null, storage_path: path,
        folder: src.folder || null, derived_from_photo_id: src.id,
        created_by_email: session?.user?.email || null,
      };
      let res = await supabase.from('job_photos').insert(thumbPath ? { ...row, thumb_path: thumbPath } : row);
      if (res.error && /thumb_path/.test(res.error.message || '')) res = await supabase.from('job_photos').insert(row);
      if (res.error) throw res.error;
      await loadPhotos();
      nextMarkup();
    } catch (err) {
      alert('Failed to save markup: ' + (err.message || err));
    }
  }

  // ── Folder management ───────────────────────────────────────────────────
  async function renameFolder() {
    const old = filterFolder;
    const next = cleanFolderName(window.prompt('Rename folder', old) || '');
    if (!next || next === old) return;
    const { error } = await supabase.rpc('rename_job_photo_folder', { job_id_in: jobId, old_name: old, new_name: next });
    if (error) { flash(`Rename failed: ${error.message}`, 8000); return; }
    setPhotos(prev => prev.map(p => (p.folder === old ? { ...p, folder: next } : p)));
    setFilterFolder(next);
    destination.setValue(next);
    loadFolders();
  }
  async function deleteFolder() {
    if (!confirm(`Delete the empty folder "${filterFolder}"?`)) return;
    const { error } = await supabase.rpc('delete_empty_job_photo_folder', { job_id_in: jobId, name_in: filterFolder });
    if (error) { flash(`Could not delete the folder: ${error.message}`, 8000); return; }
    destination.reset();
    closeFolder();
    loadFolders();
  }

  // ── Attach an existing general photo to this update ─────────────────────
  async function openPicker() {
    const { data } = await supabase.from('job_photos').select('*').eq('job_id', jobId).is('update_id', null).order('created_at', { ascending: false });
    const list = data || [];
    setGeneralPhotos(list);
    const out = {};
    for (const b of [...new Set(list.map(bucketOf))]) {
      const group = list.filter(p => bucketOf(p) === b);
      const { data: signed } = await supabase.storage.from(b).createSignedUrls(group.map(p => p.thumb_path || p.storage_path), 3600);
      (signed || []).forEach((s, i) => { if (s?.signedUrl) out[group[i].id] = s.signedUrl; });
    }
    setGeneralUrls(out);
    setPickerOpen(true);
  }
  async function attachPhoto(photoId) {
    await supabase.from('job_photos').update({ update_id: updateId }).eq('id', photoId);
    setGeneralPhotos(prev => prev.filter(p => p.id !== photoId));
    loadPhotos();
  }

  // ── Viewer ──────────────────────────────────────────────────────────────
  const viewerItems = useMemo(
    () => visible.map(p => ({ key: p.id, thumb: thumbUrls[p.id] || '', resolve: () => signFull(p) })),
    [visible, thumbUrls, signFull]
  );
  const dateFmt = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }), [tz]);
  const viewerFooter = (item, i) => {
    const p = visible[i];
    if (!p) return null;
    return `${dateFmt.format(new Date(p.created_at))}${p.folder ? `  |  ${p.folder}` : ''}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const allShown = shown.length === visible.length;
  const topLevel = filterFolder === '';
  const totalEmpty = photos.length === 0 && queue.items.length === 0;
  const shareable = jobInfo?.customer_contact || jobInfo?.customer_name;
  const anyInternal = selectedPhotos.some(p => p.is_internal);
  const anyShared = selectedPhotos.some(p => !p.is_internal);

  const content = (
    <>
      {!bare && <h3>{title || 'Photos'}</h3>}

      {allowUpload && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: 'none' }} />
          <div className="pg-toolbar">
            <button className="btn btn-primary btn-sm" onClick={() => setCameraOpen(true)} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CameraIcon size={16} /> Take Photos
            </button>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} type="button">Upload from library</button>
            {updateId && <button className="btn btn-sm" onClick={openPicker} type="button">Attach existing photo</button>}
            {!updateId && <DestinationPicker destination={destination} variant="light" />}
          </div>
        </>
      )}

      {(queue.pendingCount > 0 || queue.failedCount > 0 || note || busy) && (
        <div className="pg-status" role="status">
          {busy && <span>{busy}</span>}
          {!busy && note && <span>{note}</span>}
          {queue.pendingCount > 0 && <span>Uploading {queue.pendingCount} {queue.pendingCount === 1 ? 'photo' : 'photos'}</span>}
          {queue.failedCount > 0 && (
            <span className="failed">
              {queue.failedCount} not uploaded{' '}
              <button type="button" className="btn btn-sm" onClick={queue.retryAll}>Retry</button>
            </span>
          )}
        </div>
      )}

      {pickerOpen && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, background: 'var(--panel)' }}>
          <div className="section-actions" style={{ marginTop: 0, marginBottom: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Tap a photo from the job's general library to attach it here.</span>
            <button className="btn btn-sm" onClick={() => setPickerOpen(false)} type="button">Close</button>
          </div>
          {generalPhotos.length === 0 && <div className="empty-state" style={{ padding: '10px 0' }}>No unattached photos in the job library.</div>}
          <div className="pg-grid">
            {generalPhotos.map(p => (
              <button key={p.id} type="button" className="pg-tile" onClick={() => attachPhoto(p.id)} aria-label="Attach this photo">
                {generalUrls[p.id] && <img src={generalUrls[p.id]} alt="" loading="lazy" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {totalEmpty && !bare && <div className="empty-state">No photos yet.</div>}

      {/* Top level: folder tiles, then photos that are not in a folder. */}
      {topLevel && folderList.length > 0 && (
        <div className="pg-grid" style={{ marginBottom: 18 }}>
          {folderList.map(f => {
            const count = photos.filter(p => p.folder === f.name).length + queue.items.filter(i => i.folder === f.name).length;
            const cover = covers[f.name];
            return (
              <button key={f.name} type="button" className="pg-folder-tile" onClick={() => openFolder(f.name)}>
                {cover && thumbUrls[cover.id]
                  ? <img src={thumbUrls[cover.id]} alt="" loading="lazy" />
                  : <div className="pg-folder-empty"><FolderIcon size={34} /></div>}
                <div className="pg-folder-label">
                  <b><FolderIcon size={14} /><span style={{ fontSize: 12.5, opacity: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span></b>
                  <span>{count} {count === 1 ? 'photo' : 'photos'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!topLevel && (
        <div className="pg-toolbar">
          <button className="btn btn-sm" onClick={closeFolder} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ChevronLeftIcon size={16} /> All Photos
          </button>
          <span style={{ fontSize: 13.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FolderIcon size={16} /> {filterFolder}
          </span>
          <ShareLinkButton
            kind="photo_folder" jobId={jobId} folder={filterFolder}
            customerName={shareable} projectAddress={jobInfo?.project_address}
            label="Share Folder"
          />
          {currentFolder?.kind === 'named' && (
            <button className="btn btn-sm" type="button" onClick={renameFolder} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <EditIcon size={14} /> Rename
            </button>
          )}
          {currentFolder?.kind === 'named' && visible.length === 0 && pendingHere.length === 0 && (
            <button className="btn btn-sm btn-danger" type="button" onClick={deleteFolder}>Delete folder</button>
          )}
        </div>
      )}

      {(visible.length > 0) && (
        <div className="pg-toolbar">
          {!selectMode ? (
            <button className="btn btn-sm" type="button" onClick={() => setSelectMode(true)}>Select</button>
          ) : (
            <>
              <button className="btn btn-sm" type="button" onClick={() => setSelected(new Set(visible.map(p => p.id)))}>Select all</button>
              <button className="btn btn-sm" type="button" onClick={exitSelect}>Cancel</button>
            </>
          )}
        </div>
      )}

      {(visible.length > 0 || pendingHere.length > 0) && (
        <div className="pg-grid">
          {pendingHere.map(item => (
            <PendingTile key={item.id} item={item} onRetry={queue.retry} onDiscard={discardPhoto} />
          ))}
          {shown.map((p, idx) => {
            const isSel = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`pg-tile${isSel ? ' is-selected' : ''}`}
                onClick={() => (selectMode ? toggleSelected(p.id) : setViewerIndex(idx))}
                aria-label={selectMode ? (isSel ? 'Deselect photo' : 'Select photo') : 'Open photo'}
                aria-pressed={selectMode ? isSel : undefined}
              >
                {thumbUrls[p.id] && <img src={thumbUrls[p.id]} alt="" loading="lazy" onError={() => thumbFailed(p)} />}
                {selectMode && <span className="pg-check">{isSel && <CheckIcon size={14} strokeWidth={3} />}</span>}
                <span className="pg-badges">
                  {!p.is_internal && <span className="pg-badge">Shared</span>}
                  {p.derived_from_photo_id && <span className="pg-badge">Marked up</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!allShown && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn btn-sm" type="button" onClick={() => setLimit(l => l + PAGE)}>
            Show more ({visible.length - shown.length} left)
          </button>
        </div>
      )}

      {!topLevel && visible.length === 0 && pendingHere.length === 0 && (
        <div className="empty-state">No photos in this folder yet.</div>
      )}

      {selectMode && (
        <div className="pg-selectbar">
          <span className="pg-count">{selected.size} selected</span>
          <div className="pg-menu-wrap">
            <button
              type="button"
              className="pg-bar-btn solid"
              disabled={selected.size === 0 || !!busy}
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <MoreIcon size={16} /> Actions
            </button>
            {menuOpen && (
              <div className="pg-menu" role="menu">
                {anyInternal && <button type="button" role="menuitem" onClick={() => shareSelected(true)}><ShareIcon size={18} /> Share with customer</button>}
                {anyShared && <button type="button" role="menuitem" onClick={() => shareSelected(false)}><ShareIcon size={18} /> Stop sharing</button>}
                <button type="button" role="menuitem" onClick={startMarkup}><EditIcon size={18} /> Markup</button>
                <button type="button" role="menuitem" onClick={downloadSelected}><DownloadIcon size={18} /> Download</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setMoveOpen(true); }}><FolderIcon size={18} /> Move to folder</button>
                <button type="button" role="menuitem" className="danger" onClick={deleteSelected}><TrashIcon size={18} /> Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      <FolderSheet
        open={moveOpen}
        title="Move to"
        onClose={() => setMoveOpen(false)}
        options={destination.options}
        onPick={value => moveSelected(resolveDestination(value, Date.now(), tz))}
        onCreate={async name => {
          const clean = cleanFolderName(name);
          if (clean) await moveSelected({ folder: clean, kind: 'named', day: null });
        }}
      />

      <PhotoViewer
        items={viewerItems}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onNavigate={setViewerIndex}
        footer={viewerFooter}
      />

      {markupQueue && markupPhoto && markupUrl && (
        <PhotoMarkupEditor
          key={markupPhoto.id}
          imageUrl={markupUrl}
          onSave={saveMarkup}
          onClose={markupQueue.ids.length > 1 ? nextMarkup : stopMarkup}
          onStop={markupQueue.ids.length > 1 ? stopMarkup : undefined}
          progress={markupQueue.ids.length > 1 ? { index: markupQueue.pos, total: markupQueue.ids.length } : undefined}
          saveLabel="Done"
          cancelLabel={markupQueue.ids.length > 1 ? 'Skip' : 'Cancel'}
        />
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onPhotoAccepted={handleCameraPhoto}
        destination={updateId ? null : destination}
        uploadStatus={{ pending: queue.pendingCount, failed: queue.failedCount, onRetry: queue.retryAll }}
        title={title || 'Photos'}
      />
    </>
  );

  if (bare) return <>{content}</>;
  return <div className="card">{content}</div>;
}
