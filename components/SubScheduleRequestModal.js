'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';
import { EVENT_TYPE_LABELS, subPortalJobHeading } from '../lib/constants';

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// The Sub Portal calendar's "Request Schedule Event" popup — the same
// fields the GC side's New Event modal collects (project, type,
// description, date/time), minus the staff-only "who's assigned" picker,
// since a sub isn't assigning anyone. Submitting never writes a real
// schedule_events row directly — it goes in as a pending schedule_request
// via RPC, and only becomes a calendar event once staff approves it.
export default function SubScheduleRequestModal({ open, onClose, onCreated, companyId, jobs, defaultDate }) {
  const [jobId, setJobId] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState(defaultDate || todayISO());
  const [eventTime, setEventTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEventDate(defaultDate || todayISO());
    setJobId(jobs.length === 1 ? jobs[0].id : '');
  }, [open, defaultDate, jobs]);

  function reset() {
    setEventType('meeting'); setDescription(''); setEventTime(''); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!jobId) { setError('Pick which project this is for.'); return; }
    if (!eventDate) { setError('Pick a date.'); return; }
    setSaving(true);
    setError('');
    const { error: rpcErr } = await supabase.rpc('request_schedule_event', {
      target_company_id: companyId,
      target_job_id: jobId,
      event_type_in: eventType,
      description_in: description.trim() || null,
      requested_date_in: eventDate,
      requested_time_in: eventTime || null,
    });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    reset();
    onCreated && onCreated();
    onClose();
  }

  return (
    <PopupModal open={open} onClose={() => { reset(); onClose(); }} maxWidth={480}>
      <h3>Request Schedule Event</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        This goes to McLoud Construction as a request — it won't show up as a confirmed event until they approve it.
      </div>
      <form onSubmit={submit}>
        <label htmlFor="reqJob">Project</label>
        <select id="reqJob" value={jobId} onChange={e => setJobId(e.target.value)} required>
          <option value="" disabled>Select a project…</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{subPortalJobHeading(j)}</option>)}
        </select>
        {jobs.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
            You don't have any awarded projects to request an event for yet.
          </div>
        )}

        <label style={{ marginTop: 12 }}>Event Type</label>
        <select value={eventType} onChange={e => setEventType(e.target.value)}>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <label style={{ marginTop: 12 }}>What's this for?</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="e.g. Need a walkthrough before we can start framing" />

        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <label>Date</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required />
          </div>
          <div>
            <label>Time (optional)</label>
            <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} />
          </div>
        </div>

        {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

        <div className="section-actions" style={{ marginTop: 18 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving || jobs.length === 0}>{saving ? 'Sending…' : 'Send Request'}</button>
        </div>
      </form>
    </PopupModal>
  );
}
