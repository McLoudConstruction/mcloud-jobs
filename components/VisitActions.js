'use client';

import { useState } from 'react';
import { sendVisitAction } from '@/lib/offlineActions';

// Compact Start / Finish buttons on a visit row, for desktop. Phones use the action bar at the bottom of
// the screen instead (VisitDock). "On the way" is the popup on the job header. Start job shows only for the team member the
// visit is assigned to (staffId); the server checks it too.
export default function VisitActions({ visit, token, onDone, onAction, staffId, restoration = false }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function act(action, minutes) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendVisitAction({ visit, action, minutes });
      onDone();
      if (!r?.queued) onAction?.(action);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  if (visit.status === 'finished' || visit.status === 'cancelled') return null;

  return (
    <span className="visit-actions desktop-only">
      {msg && <span className="msg err" style={{ margin: 0, padding: '4px 8px' }}>{msg}</span>}
      {(visit.status === 'scheduled' || visit.status === 'on_the_way') && visit.tech_id === staffId && (
        <button type="button" className="primary small" disabled={busy} onClick={() => act('started')}>Start job</button>
      )}
      {visit.status === 'started' && (
        <button type="button" className="primary small" disabled={busy} onClick={() => { if (window.confirm(restoration ? 'Finish this visit?' : 'Finish this job?')) act('finished'); }}>{restoration ? 'Finish visit' : 'Finish job'}</button>
      )}
    </span>
  );
}
