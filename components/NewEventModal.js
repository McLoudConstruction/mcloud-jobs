'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';
import SearchableSelect from './SearchableSelect';
import { EVENT_TYPE_LABELS } from '../lib/constants';

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// The Calendar page's "New Event" popup: pick an optional Project (a
// search across leads/opportunities and jobs), an Event Type, a
// description, who on staff needs it on their calendar, and a date/time.
// Saving inserts into schedule_events and hands the new row back via
// onCreated so the calendar page can refresh without a full reload.
export default function NewEventModal({ open, onClose, onCreated, defaultDate }) {
  const [projects, setProjects] = useState([]);
  const [staff, setStaff] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [description, setDescription] = useState('');
  const [assignedStaffIds, setAssignedStaffIds] = useState([]);
  const [eventDate, setEventDate] = useState(defaultDate || todayISO());
  const [eventTime, setEventTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEventDate(defaultDate || todayISO());
    Promise.all([
      supabase.from('opportunities').select('id, project, contact_name, company').order('created_at', { ascending: false }).limit(200),
      supabase.from('jobs').select('id, job_number, estimate_number, customer_name, project_address').order('created_at', { ascending: false }).limit(200),
      supabase.from('staff_users').select('id, full_name, role').eq('status', 'active').order('full_name'),
    ]).then(([oppRes, jobRes, staffRes]) => {
      const oppOptions = (oppRes.data || []).map(o => ({
        id: `opportunity:${o.id}`, label: o.project || o.contact_name || 'Untitled lead',
        sublabel: o.contact_name || o.company || '', group: 'Lead / Opportunity',
      }));
      // A job row carries whichever number it has earned so far — Job #
      // once approved, Estimate # while it's still a lead in the jobs
      // table. Prefer the Job number when both are set (the more current
      // one); fall back to Estimate; show neither rather than "#null".
      const jobOptions = (jobRes.data || []).map(j => ({
        id: `job:${j.id}`, label: j.project_address || j.customer_name || (j.job_number ? `Job ${j.job_number}` : 'Untitled job'),
        sublabel: j.job_number ? `Job ${j.job_number}` : (j.estimate_number ? `Est ${j.estimate_number}` : ''),
        group: 'Project',
      }));
      setProjects([...jobOptions, ...oppOptions]);
      setStaff(staffRes.data || []);
    });
  }, [open, defaultDate]);

  function toggleStaff(id) {
    setAssignedStaffIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  function reset() {
    setProjectId(''); setEventType('meeting'); setDescription('');
    setAssignedStaffIds([]); setEventTime(''); setError('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!eventDate) { setError('Pick a date.'); return; }
    setSaving(true);
    setError('');
    const [projKind, projId] = projectId ? projectId.split(':') : [null, null];
    const payload = {
      event_type: eventType,
      description: description.trim() || null,
      event_date: eventDate,
      event_time: eventTime || null,
      opportunity_id: projKind === 'opportunity' ? projId : null,
      job_id: projKind === 'job' ? projId : null,
      assigned_staff_ids: assignedStaffIds,
    };
    const { data, error: insertError } = await supabase.from('schedule_events').insert(payload).select().single();
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    reset();
    onCreated && onCreated(data);
    onClose();
  }

  return (
    <PopupModal open={open} onClose={() => { reset(); onClose(); }} maxWidth={480}>
      <h3>New Event</h3>
      <form onSubmit={submit}>
        <label>Project (optional)</label>
        <SearchableSelect
          options={projects}
          value={projectId}
          onChange={setProjectId}
          placeholder="Search leads, opportunities, jobs…"
        />

        <label style={{ marginTop: 12 }}>Event Type</label>
        <select value={eventType} onChange={e => setEventType(e.target.value)}>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <label style={{ marginTop: 12 }}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />

        <label style={{ marginTop: 12 }}>People</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {staff.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No active staff on file.</div>}
          {staff.map(s => {
            const active = assignedStaffIds.includes(s.id);
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => toggleStaff(s.id)}
                style={{
                  padding: '6px 12px', borderRadius: 16, fontSize: 12.5, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--panel-line)'}`,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--ink)',
                }}
              >
                {s.full_name}
              </button>
            );
          })}
        </div>

        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <label>Date</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required />
          </div>
          <div>
            <label>Time</label>
            <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} />
          </div>
        </div>

        {error && <div style={{ color: '#a13f3f', fontSize: 12.5, marginTop: 10 }}>{error}</div>}

        <div className="section-actions" style={{ marginTop: 18 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </PopupModal>
  );
}
