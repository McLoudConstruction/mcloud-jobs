'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';
import { SUB_EVENT_TYPE_LABELS, SUB_UNRESTRICTED_EVENT_TYPES, subPortalJobHeading } from '../lib/constants';

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
//
// Two job lists come in: `awardedJobs` (work actually won — required for
// most event types) and `allJobs` (everything the sub can see, including
// RFP-stage jobs they're only bidding on). A Meeting or Site Visit can be
// requested against either list; anything else is awarded-only.
export default function SubScheduleRequestModal({ open, onClose, onCreated, companyId, awardedJobs, allJobs, defaultDate }) {
  const [jobId, setJobId] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState(defaultDate || todayISO());
  const [eventTime, setEventTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const jobs = SUB_UNRESTRICTED_EVENT_TYPES.includes(eventType) ? allJobs : awardedJobs;

  useEffect(() => {
    if (!open) return;
    setEventDate(defaultDate || todayISO());
    setEventType('meeting');
  }, [open, defaultDate]);

  // Re-pick the default selection whenever the eligible list changes
  // (either on open, or because switching event type swapped in a
  // different job list) — clears a selection that's no longer eligible
  // and auto-picks the one option when there's only one.
  useEffect(() => {
    setJobId(prev => (jobs.some(j => j.id === prev) ? prev : (jobs.length === 1 ? jobs[0].id : '')));
  }, [jobs]);

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
        <label htmlFor="reqType">Event Type</label>
        <select id="reqType" value={eventType} onChange={e => setEventType(e.target.value)}>
          {Object.entries(SUB_EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <label htmlFor="reqJob" style={{ marginTop: 12 }}>Project</label>
        <select id="reqJob" value={jobId} onChange={e => setJobId(e.target.value)} required>
          <option value="" disabled>Select a project…</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{subPortalJobHeading(j)}</option>)}
        </select>
        {jobs.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
            {SUB_UNRESTRICTED_EVENT_TYPES.includes(eventType)
              ? "You don't have any projects on file yet."
              : "You don't have any awarded projects to request an event for yet — try Meeting or Site Visit if this is about a project you're bidding on."}
          </div>
        )}

        <label style={{ marginTop: 12 }}>What's this for?</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="e.g. Need a walkthrough before we can start framing" />

        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <label>Date</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required />
          </div>
          <div>
            <label>Time (optional)</label>
            <input type="time" step={900} value={eventTime} onChange={e => setEventTime(e.target.value)} />
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
