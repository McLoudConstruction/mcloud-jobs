'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';
import SearchableSelect from './SearchableSelect';
import { EVENT_TYPE_LABELS, JOB_EVENT_TYPE_ORDER, CUSTOMER_VISIBLE_EVENT_TYPES } from '../lib/constants';

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// The Calendar page's "New Event" popup: pick an optional Project (a
// search across leads/opportunities and jobs), an Event Type, a
// description, who on staff needs it on their calendar, and a date/time.
// Saving inserts into schedule_events and hands the new row back via
// onCreated so the calendar page can refresh without a full reload.
//
// Pass lockedJobId to use it as a job's "Add schedule item" form: the project
// picker goes away (it's always that job), the type list leads with Site Visit
// and the walk types, you're pre-selected under People, and a "Show on the
// customer portal" switch appears (on by default for visits and walks).
export default function NewEventModal({ open, onClose, onCreated, defaultDate, defaultEventType = 'meeting', title = 'New Event', lockedJobId = null, lockedJobLabel = '' }) {
  const [projects, setProjects] = useState([]);
  const [staff, setStaff] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [eventType, setEventType] = useState(defaultEventType);
  const [subPick, setSubPick] = useState('');
  const [description, setDescription] = useState('');
  const [assignedStaffIds, setAssignedStaffIds] = useState([]);
  const [invitedCompanyIds, setInvitedCompanyIds] = useState([]);
  const [eventDate, setEventDate] = useState(defaultDate || todayISO());
  const [eventTime, setEventTime] = useState('');
  const [shareWithCustomer, setShareWithCustomer] = useState(CUSTOMER_VISIBLE_EVENT_TYPES.includes(defaultEventType));
  const [shareTouched, setShareTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Locked to one job (the job page's "Add schedule item") or picked below.
  const effectiveProjectId = lockedJobId ? `job:${lockedJobId}` : projectId;
  const jobLinked = effectiveProjectId.startsWith('job:');

  useEffect(() => {
    if (!open) return;
    setEventDate(defaultDate || todayISO());
    setEventType(defaultEventType);
    setShareWithCustomer(CUSTOMER_VISIBLE_EVENT_TYPES.includes(defaultEventType));
    setShareTouched(false);
    Promise.all([
      // Locked to a job: the 400-row project search isn't needed.
      lockedJobId ? Promise.resolve({ data: [] }) : supabase.from('opportunities').select('id, project, contact_name, company').order('created_at', { ascending: false }).limit(200),
      lockedJobId ? Promise.resolve({ data: [] }) : supabase.from('jobs').select('id, project_number, customer_name, project_address').order('created_at', { ascending: false }).limit(200),
      supabase.from('staff_users').select('id, full_name, role').eq('status', 'active').order('full_name'),
      // Subcontractors only: the companies table also holds customers,
      // suppliers, etc., none of whom have a Sub Portal calendar to invite to.
      supabase.from('companies').select('id, company_name').eq('company_type', 'Subcontractor').order('company_name'),
    ]).then(([oppRes, jobRes, staffRes, companyRes]) => {
      const oppOptions = (oppRes.data || []).map(o => ({
        id: `opportunity:${o.id}`, label: o.project || o.contact_name || 'Untitled lead',
        sublabel: o.contact_name || o.company || '', group: 'Lead / Opportunity',
      }));
      // Every job carries one project_number for its whole lifecycle now
      // — no more picking between a Job number and an Estimate number.
      const jobOptions = (jobRes.data || []).map(j => ({
        id: `job:${j.id}`, label: j.project_address || j.customer_name || (j.project_number ? `Project ${j.project_number}` : 'Untitled job'),
        sublabel: j.project_number ? `Project ${j.project_number}` : '',
        group: 'Project',
      }));
      setProjects([...jobOptions, ...oppOptions]);
      setStaff(staffRes.data || []);
      setCompanies(companyRes.data || []);
      // Logging a visit usually means "I'm going" — start with yourself on it.
      if (lockedJobId) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          const me = session?.user?.id;
          if (me && (staffRes.data || []).some(s => s.id === me)) setAssignedStaffIds(prev => (prev.length ? prev : [me]));
        });
      }
    });
  }, [open, defaultDate, defaultEventType, lockedJobId]);

  function changeType(next) {
    setEventType(next);
    // Follow the type's default until the person flips the switch themselves.
    if (!shareTouched) setShareWithCustomer(CUSTOMER_VISIBLE_EVENT_TYPES.includes(next));
  }

  function toggleStaff(id) {
    setAssignedStaffIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }
  function addCompany(id) {
    if (!id) return;
    setInvitedCompanyIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setSubPick('');
  }
  function removeCompany(id) {
    setInvitedCompanyIds(prev => prev.filter(c => c !== id));
  }

  function reset() {
    setProjectId(''); setEventType(defaultEventType); setDescription('');
    setAssignedStaffIds([]); setInvitedCompanyIds([]); setSubPick(''); setEventTime(''); setError('');
    setShareWithCustomer(CUSTOMER_VISIBLE_EVENT_TYPES.includes(defaultEventType)); setShareTouched(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!eventDate) { setError('Pick a date.'); return; }
    setSaving(true);
    setError('');
    const [projKind, projId] = effectiveProjectId ? effectiveProjectId.split(':') : [null, null];
    const payload = {
      event_type: eventType,
      description: description.trim() || null,
      event_date: eventDate,
      event_time: eventTime || null,
      opportunity_id: projKind === 'opportunity' ? projId : null,
      job_id: projKind === 'job' ? projId : null,
      assigned_staff_ids: assignedStaffIds,
      invited_company_ids: invitedCompanyIds,
      // Only sent when on, so the Calendar page's plain "New Event" keeps
      // working even before migration 160 adds the column.
      ...(jobLinked && shareWithCustomer ? { show_to_customer: true } : {}),
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
      <h3>{title}</h3>
      <form onSubmit={submit}>
        {lockedJobId ? (
          lockedJobLabel && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 4 }}>For {lockedJobLabel}</div>
        ) : (
          <>
            <label>Project (optional)</label>
            <SearchableSelect
              options={projects}
              value={projectId}
              onChange={setProjectId}
              placeholder="Search leads, opportunities, jobs…"
            />
          </>
        )}

        <label style={{ marginTop: lockedJobId ? 0 : 12 }}>{lockedJobId ? 'What' : 'Event Type'}</label>
        <select value={eventType} onChange={e => changeType(e.target.value)}>
          {(lockedJobId ? JOB_EVENT_TYPE_ORDER.filter(k => EVENT_TYPE_LABELS[k]) : Object.keys(EVENT_TYPE_LABELS)).map(k => (
            <option key={k} value={k}>{EVENT_TYPE_LABELS[k]}</option>
          ))}
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

        {jobLinked && companies.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>Invite Subcontractors (optional)</label>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>
              Shows this event on the invited company's own Sub Portal calendar.
            </div>
            <select value={subPick} onChange={e => addCompany(e.target.value)}>
              <option value="">Select a subcontractor…</option>
              {companies.filter(c => !invitedCompanyIds.includes(c.id)).map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
            {invitedCompanyIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {invitedCompanyIds.map(id => {
                  const c = companies.find(x => x.id === id);
                  if (!c) return null;
                  return (
                    <button
                      type="button"
                      key={id}
                      onClick={() => removeCompany(id)}
                      aria-label={`Remove ${c.company_name}`}
                      style={{
                        padding: '6px 12px', borderRadius: 16, fontSize: 12.5, cursor: 'pointer',
                        border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff',
                      }}
                    >
                      {c.company_name} ×
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <label>Date</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required />
          </div>
          <div>
            <label>Time</label>
            <input type="time" step={900} value={eventTime} onChange={e => setEventTime(e.target.value)} />
          </div>
        </div>

        {jobLinked && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, fontWeight: 400, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginTop: 3 }}
              checked={shareWithCustomer}
              onChange={e => { setShareWithCustomer(e.target.checked); setShareTouched(true); }}
            />
            <span>
              Show on the customer portal
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-soft)' }}>
                The customer sees the date, the type, and the phase name. Your description stays internal.
              </span>
            </span>
          </label>
        )}

        {error && <div style={{ color: '#a13f3f', fontSize: 12.5, marginTop: 10 }}>{error}</div>}

        <div className="section-actions" style={{ marginTop: 18 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </PopupModal>
  );
}
