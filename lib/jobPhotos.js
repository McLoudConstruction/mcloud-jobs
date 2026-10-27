'use client';
// Local-first photo pipeline.
//
// A photo is saved to this device the moment it is accepted, then a single
// worker watermarks, thumbnails and uploads it in the background. Nothing is
// lost if the signal drops, the tab closes or iOS reloads the page: the
// queue resumes on the next visit. Every row uses a client generated id and
// a path built from that id, so a retry can never create a duplicate.
//
// Separate from lib/syncQueue.js on purpose (that queue stranded photos
// before; this one has one job and shows its state to the person).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { watermarkImage } from './watermark';
import { useSettings } from './useSettings';
import { DEFAULT_TZ } from './photoNames';
import {
  buildDestinationOptions, cleanFolderName, defaultDestination, ensureFolder,
  fetchFolders, isBrandNewJob, resolveDestination,
} from './photoFolders';

const DB_NAME = 'mcloud-photos';
const STORE = 'queue';
const MAX_AUTO_ATTEMPTS = 4;
const THUMB_MAX = 480;

// ── IndexedDB (with an in-memory fallback if the browser blocks it) ──────
let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function putItem(item) {
  await tx('readwrite', store => (store ? reqP(store.put(item)) : memory.set(item.id, item)));
}
async function deleteItem(id) {
  await tx('readwrite', store => (store ? reqP(store.delete(id)) : memory.delete(id)));
}
async function getAllItems() {
  const rows = await tx('readonly', store => (store ? reqP(store.getAll()) : [...memory.values()]));
  return (rows || []).sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));
}

// ── Change notifications ─────────────────────────────────────────────────
const listeners = new Set();
const syncedListeners = new Set();
function notify() { listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }
export function onPhotoSynced(fn) { syncedListeners.add(fn); return () => syncedListeners.delete(fn); }

// ── Image helpers ────────────────────────────────────────────────────────
function loadBlobImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image.')); };
    img.src = url;
  });
}

export async function makeThumbnail(blob) {
  const img = await loadBlobImage(blob);
  const scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.7));
}

// ── Public: add a photo to the queue ─────────────────────────────────────
// destination = { folder, kind, day } already resolved at capture time.
export async function enqueuePhoto({
  file, jobId, updateId = null, destination = null, takenAt = Date.now(),
  logoUrl = null, brandName = null, extra = null,
}) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const item = {
    id, jobId, updateId, takenAt,
    folder: destination?.folder || null,
    folderKind: destination?.kind || null,
    folderDay: destination?.day || null,
    logoUrl, brandName, extra,
    blob: file, // the original, kept until the upload is confirmed
    status: 'pending', attempts: 0, error: null,
  };
  await putItem(item);
  notify();
  kick();
  return id;
}

// ── Worker ───────────────────────────────────────────────────────────────
let running = false;
let retryTimer = null;

export function kick() {
  if (running) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  run();
}

async function run() {
  running = true;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) return; // signed out: leave everything queued
    const email = session.user?.email || null;

    for (;;) {
      const items = (await getAllItems()).filter(i => i.status === 'pending');
      const next = items[0];
      if (!next) break;
      try {
        await uploadItem(next, email);
        await deleteItem(next.id);
        notify();
        syncedListeners.forEach(fn => { try { fn(next); } catch { /* ignore */ } });
      } catch (err) {
        const attempts = (next.attempts || 0) + 1;
        await putItem({
          ...next,
          attempts,
          status: attempts >= MAX_AUTO_ATTEMPTS ? 'failed' : 'pending',
          error: String(err?.message || err),
        });
        notify();
        if (attempts < MAX_AUTO_ATTEMPTS) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(kick, 8000 * attempts);
        }
        break; // stop the pass; the timer or the next trigger resumes it
      }
    }
  } finally {
    running = false;
  }
}

async function uploadItem(item, email) {
  const path = `${item.jobId}/${item.id}.jpg`;
  const thumbPath = `${item.jobId}/thumbs/${item.id}.jpg`;

  const watermarked = await watermarkImage(item.blob, item.logoUrl, item.brandName);

  const up = await supabase.storage.from('job-photos').upload(path, watermarked, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;

  let thumbOk = false;
  try {
    const thumb = await makeThumbnail(watermarked);
    const t = await supabase.storage.from('job-photos').upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: true });
    thumbOk = !t.error;
  } catch { /* a missing thumbnail is fine, the grid falls back to the photo */ }

  if (item.folder) {
    await ensureFolder(supabase, item.jobId, { folder: item.folder, kind: item.folderKind, day: item.folderDay });
  }

  const row = {
    id: item.id,
    job_id: item.jobId,
    update_id: item.updateId || null,
    storage_path: path,
    folder: item.folder || null,
    created_by_email: email,
    created_at: new Date(item.takenAt || Date.now()).toISOString(),
    ...(item.extra || {}),
  };
  let res = await supabase.from('job_photos')
    .upsert(thumbOk ? { ...row, thumb_path: thumbPath } : row, { onConflict: 'id', ignoreDuplicates: true });
  if (res.error && /thumb_path/.test(res.error.message || '')) {
    res = await supabase.from('job_photos').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  }
  if (res.error) throw res.error;
}

export async function retryPhoto(id) {
  const items = await getAllItems();
  const it = items.find(i => i.id === id);
  if (it) await putItem({ ...it, status: 'pending', attempts: 0, error: null });
  notify();
  kick();
}
export async function retryAllFailed() {
  const items = await getAllItems();
  for (const it of items) {
    if (it.status === 'failed') await putItem({ ...it, status: 'pending', attempts: 0, error: null });
  }
  notify();
  kick();
}
export async function discardPhoto(id) { await deleteItem(id); notify(); }

// Call once from the app shell so a queue left behind resumes on any page.
export function startPhotoQueueWatchers() {
  if (typeof window === 'undefined') return () => {};
  const go = () => kick();
  const vis = () => { if (document.visibilityState === 'visible') kick(); };
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', vis);
  const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (s) kick(); });
  kick();
  return () => {
    window.removeEventListener('online', go);
    document.removeEventListener('visibilitychange', vis);
    sub?.subscription?.unsubscribe();
  };
}

// ── Hook: queue state for one job (or all jobs when jobId is omitted) ────
export function usePhotoQueue(jobId) {
  const [items, setItems] = useState([]);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const all = await getAllItems();
    if (alive.current) setItems(jobId ? all.filter(i => i.jobId === jobId) : all);
  }, [jobId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    listeners.add(refresh);
    return () => { alive.current = false; listeners.delete(refresh); };
  }, [refresh]);

  const pending = items.filter(i => i.status === 'pending');
  const failed = items.filter(i => i.status === 'failed');
  return {
    items, pending, failed,
    pendingCount: pending.length,
    failedCount: failed.length,
    retry: retryPhoto,
    retryAll: retryAllFailed,
    discard: discardPhoto,
  };
}

// ── Hook: where the next photos go ───────────────────────────────────────
// value is a destination option value (TODAY_VALUE, a folder name ...).
export function usePhotoDestination(jobId, { preferInitial = false } = {}) {
  const { settings } = useSettings();
  const tz = settings?.timezone || DEFAULT_TZ;
  const [folders, setFolders] = useState([]);
  const [createdAt, setCreatedAt] = useState(null);
  const [value, setValue] = useState(null);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    const [list, jobRes] = await Promise.all([
      fetchFolders(supabase, jobId),
      supabase.from('jobs').select('created_at').eq('id', jobId).maybeSingle(),
    ]);
    setFolders(list);
    setCreatedAt(jobRes?.data?.created_at || null);
    setReady(true);
  }, [jobId]);

  useEffect(() => { touched.current = false; setValue(null); setReady(false); refresh(); }, [jobId, refresh]);

  const brandNew = useMemo(() => isBrandNewJob(createdAt, tz), [createdAt, tz]);

  // Until the person picks something, follow the default (which can change
  // once the job's age is known).
  const effective = value || defaultDestination({ brandNew, preferInitial });

  const options = useMemo(
    () => buildDestinationOptions({ folders, tz, brandNew, preferInitial }),
    [folders, tz, brandNew, preferInitial]
  );

  const choose = useCallback(v => { touched.current = true; setValue(v); }, []);
  const reset = useCallback(() => { touched.current = false; setValue(null); }, []);

  const resolve = useCallback(takenAt => resolveDestination(effective, takenAt, tz), [effective, tz]);

  const addFolder = useCallback(async rawName => {
    const name = cleanFolderName(rawName);
    if (!name) return null;
    const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
    const finalName = existing ? existing.name : name;
    if (!existing) {
      await ensureFolder(supabase, jobId, { folder: finalName, kind: 'named', day: null });
      setFolders(prev => [...prev, { name: finalName, kind: 'named' }]);
    }
    choose(finalName);
    return finalName;
  }, [folders, jobId, choose]);

  return { options, value: effective, setValue: choose, reset, resolve, addFolder, refresh, ready, brandNew, tz };
}
