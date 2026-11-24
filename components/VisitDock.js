'use client';

import { useState } from 'react';
import { sendVisitAction } from '@/lib/offlineActions';
import { fmtTime } from '@/lib/format';

// The phone's action bar: one big button for the next step of the visit, pinned above the bottom
// navigation where a thumb reaches it (inline: sits in the page, under the tab bar). On the way opens the minutes popup (onOtw); Start and Finish
// go straight to the server. Shown on phones only; desktops use the buttons in the page.
export default function VisitDock({ visit, token, onOtw, onDone, onAction, staffId, inline = false, restoration = false }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function act(action) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendVisitAction({ visit, action });
      onDone();
      if (!r?.queued) onAction?.(action); // lets the job page open the before / after documentation
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  const canStart = visit.tech_id === staffId; // Start job is for the team member the visit is assigned to

  const status = {
    scheduled: `Scheduled for ${fmtTime(visit.starts_at)}`,
    on_the_way: `On the way, ${visit.minutes_out} min out`,
    started: restoration ? 'Visit in progress' : 'Job in progress',
  }[visit.status];
  if (!status) return null;

  return (
    <div className={`visit-dock mobile-only${inline ? ' inline' : ''}`}>
      <div className="dock-status">{status}</div>
      {msg && <div className="msg err" style={{ margin: '0 0 6px' }}>{msg}</div>}
      <div className="dock-buttons">
        {visit.status === 'scheduled' && (
          <>
            <button type="button" className="primary big" disabled={busy} onClick={onOtw}>On the way</button>
            {canStart && <button type="button" className="secondary big" disabled={busy} onClick={() => act('started')}>Start job</button>}
          </>
        )}
        {visit.status === 'on_the_way' && (
          <>
            {canStart && <button type="button" className="primary big" disabled={busy} onClick={() => act('started')}>Start job</button>}
            <button type="button" className={`${canStart ? 'secondary' : 'primary'} big`} disabled={busy} onClick={onOtw}>Update ETA</button>
          </>
        )}
        {visit.status === 'started' && (
          <button type="button" className="primary big" disabled={busy} onClick={() => { if (window.confirm(restoration ? 'Finish this visit?' : 'Finish this job?')) act('finished'); }}>{restoration ? 'Finish visit' : 'Finish job'}</button>
        )}
      </div>
    </div>
  );
}
