// Minimal IndexedDB wrapper — no external dependency, just enough to
// support two things: a queue of writes made while offline, and a cache
// of job data for viewing while offline. Kept deliberately small; this
// is not a general-purpose ORM.

const DB_NAME = 'mcloud-offline';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const JOB_CACHE_STORE = 'jobCache';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('syncStatus', 'syncStatus');
        store.createIndex('jobId', 'jobId');
      }
      if (!db.objectStoreNames.contains(JOB_CACHE_STORE)) {
        db.createObjectStore(JOB_CACHE_STORE, { keyPath: 'jobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Sync queue ──────────────────────────────────────────────────────────
// A queue item shape:
// { id, table, operation, payload, jobId, createdAt, syncStatus, retryCount, lastError }
// - table: 'time_entries' | 'job_updates' | 'job_photos' | 'checklist_items'
// - operation: 'insert' | 'update'
// - syncStatus: 'pending' | 'syncing' | 'failed'  (synced items are deleted, not kept)

export async function enqueue(item) {
  const record = {
    id: item.id || crypto.randomUUID(),
    table: item.table,
    operation: item.operation || 'insert',
    payload: item.payload,
    jobId: item.jobId,
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
    retryCount: 0,
    lastError: null,
  };
  await withStore(QUEUE_STORE, 'readwrite', store => store.put(record));
  return record;
}

export async function getPendingQueue() {
  return withStore(QUEUE_STORE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result.filter(r => r.syncStatus !== 'syncing'));
      req.onerror = () => reject(req.error);
    });
  }).then(p => p);
}

export async function getQueueForJob(jobId) {
  const all = await getPendingQueue();
  return all.filter(r => r.jobId === jobId);
}

export async function updateQueueItem(id, patch) {
  await withStore(QUEUE_STORE, 'readwrite', store => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) store.put({ ...existing, ...patch });
    };
    return getReq;
  });
}

export async function removeQueueItem(id) {
  await withStore(QUEUE_STORE, 'readwrite', store => store.delete(id));
}

// ─── Job read cache (for viewing job details while offline) ─────────────

export async function cacheJob(jobId, data) {
  await withStore(JOB_CACHE_STORE, 'readwrite', store =>
    store.put({ jobId, data, cachedAt: new Date().toISOString() })
  );
}

// Merges a partial update into whatever's already cached for this job,
// rather than overwriting — job details, the checklist, and job_updates
// each load independently and shouldn't stomp on each other's cache.
export async function cacheJobPatch(jobId, patch) {
  const existing = await getCachedJob(jobId);
  const merged = { ...(existing?.data || {}), ...patch };
  await cacheJob(jobId, merged);
  return merged;
}

export async function getCachedJob(jobId) {
  return withStore(JOB_CACHE_STORE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const req = store.get(jobId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }).then(p => p);
}
