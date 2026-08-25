'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Chrome from '../../components/SubcontractorApplyChrome';

export default function SubcontractorApplyEntryPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const res = await fetch('/api/public/subcontractor-application/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        if (!cancelled) router.replace(`/subcontractor-apply/${data.token}`);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    start();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <Chrome>
      <div className="mcw-status-card">
        <div className="mcw-eyebrow">Work With Us</div>
        {error ? (
          <>
            <h1>Something went wrong</h1>
            <p>We couldn't start your application. Please try again in a moment, or email us directly.</p>
          </>
        ) : (
          <>
            <h1>One moment…</h1>
            <p>Taking you to the subcontractor application.</p>
          </>
        )}
      </div>
    </Chrome>
  );
}
