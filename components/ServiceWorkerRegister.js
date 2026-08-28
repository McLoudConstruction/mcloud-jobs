'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal — the app still works fully online without it, it
        // just won't have offline page caching.
      });
    }
  }, []);
  return null;
}
