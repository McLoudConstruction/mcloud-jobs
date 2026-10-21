'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { EVENT_TYPE_LABELS } from '../lib/constants';
import { localISODate } from '../lib/nextVisit';

function fmtDay(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// The Schedule tab's list of visits, walks and other events logged on this
// job. It sits next to the phase schedule rather than replacing it: events and
// phases coexist, and the customer portal's "Next Scheduled Visit" reads both.
// "Add schedule item" opens the same form as Quick actions (the page owns the
// modal and passes onAdd), and this list refreshes itself in real time.
export default function JobScheduleEventsCard({ jobId, onAdd }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('job_id', jobId)
      .order('event_date', { ascending: true })
      .order('event_time', { ascending: true, nullsFirst: false });
    if (err) { setError(err.message); return; }
    setEvents(data || []);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`job-events-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_events', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function patch(ev, fields) {
    setBusyId(ev.id); setError('');
    const { error: err } = await supabase.from('schedule_events').update(fields).eq('id', ev.id);
    if (err) setError(err.message);
    setBusyId(null);
    load();
  }

  async function remove(ev) {
    const label = EVENT_TYPE_LABELS[ev.event_type] || 'event';
    if (!window.confirm(`Delete this ${label.toLowerCase()} on ${fmtDay(ev.event_date)}?`)) return;
    setBusyId(ev.id); setError('');
    const { error: err } = await supabase.from('schedule_events').delete().eq('id', ev.id);
    if (err) setError(err.message);
    setBusyId(null);
    load();
  }

  const today = localISODate();
  const upcoming = (events || []).filter(e => e.event_date >= today);
  const past = (events || []).filter(e => e.event_date < today).reverse();
  const shown = showPast ? [...upcoming, ...past] : upcoming;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Visits &amp; events</h3>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>Add schedule item</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '6px 0 4px' }}>
        Log a site visit, walk, inspection or meeting. These sit alongside the phase schedule below, and the ones marked for the customer feed their portal&apos;s Next Scheduled Visit.
      </div>
      {error && <div className="error-text" style={{ margin: '8px 0' }}>{error}</div>}

      {events === null ? null : shown.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 8 }}>
          {past.length > 0 ? 'Nothing upcoming.' : 'No visits or events logged on this job yet.'}
        </div>
      ) : (
        shown.map(ev => {
          const isPast = ev.event_date < today;
          return (
            <div key={ev.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 13, opacity: isPast ? 0.65 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <b>{EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}</b>
                  <span style={{ color: 'var(--ink-soft)' }}> · {fmtDay(ev.event_date)}{ev.event_time ? ` at ${fmtTime(ev.event_time)}` : ''}</span>
                  {ev.description && <div style={{ fontSize: 12.5, marginTop: 2 }}>{ev.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    aria-label="Change date"
                    style={{ width: 'auto', fontSize: 12.5 }}
                    value={ev.event_date}
                    disabled={busyId === ev.id}
                    onChange={e => { if (e.target.value) patch(ev, { event_date: e.target.value }); }}
                  />
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400, fontSize: 12, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={!!ev.show_to_customer}
                      disabled={busyId === ev.id}
                      onChange={e => patch(ev, { show_to_customer: e.target.checked })}
                    />
                    Customer sees
                  </label>
                  <button type="button" className="btn btn-sm" disabled={busyId === ev.id} onClick={() => remove(ev)} aria-label="Delete event">Delete</button>
                </div>
              </div>
            </div>
          );
        })
      )}

      {past.length > 0 && (
        <button
          type="button"
          onClick={() => setShowPast(s => !s)}
          style={{ background: 'none', border: 'none', padding: 0, marginTop: 8, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
        >
          {showPast ? 'Hide past events' : `Show ${past.length} past event${past.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
