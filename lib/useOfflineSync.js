'use client';
import { useState, useEffect, useCallback } from 'react';
import { flushQueue } from './syncQueue';
import { getPendingQueue } from './offlineDb';

// Retries periodically even while nominally "online" — a flaky job-site
// connection can report navigator.onLine === true while requests are
// actually still timing out, so this isn't purely event-driven.
const RETRY_INTERVAL_MS = 30_000;

export function useOfflineSync(jobId) {
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState([]);

  const refreshPending = useCallback(async () => {
    const all = await getPendingQueue();
    setPending(jobId ? all.filter(i => i.jobId === jobId) : all);
  }, [jobId]);

  const sync = useCallback(async () => {
    const result = await flushQueue();
    await refreshPending();
    return result;
  }, [refreshPending]);

  useEffect(() => {
    refreshPending();
    function goOnline() { setIsOnline(true); sync(); }
    function goOffline() { setIsOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = setInterval(sync, RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
  }, [sync, refreshPending]);

  return {
    isOnline,
    pendingCount: pending.filter(i => i.syncStatus !== 'failed').length,
    failedCount: pending.filter(i => i.syncStatus === 'failed').length,
    pending,
    sync,
  };
}
