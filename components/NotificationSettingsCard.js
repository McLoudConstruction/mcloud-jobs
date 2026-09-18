'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function NotificationSettingsCard({ job, onSave }) {
  const [optedOut, setOptedOut] = useState(null); // null = loading/no contact found
  const [contactId, setContactId] = useState(null);
  const [newDay, setNewDay] = useState('');
  const [days, setDays] = useState(job.schedule_reminder_days || [7, 1]);

  useEffect(() => {
    if (!job.customer_email) { setOptedOut(null); return; }
    // Two separate gaps were hiding a contact that genuinely exists:
    //
    // 1. .eq() is case-sensitive in Postgres, and contact emails get typed
    //    in by hand in several places with no normalization (job creation,
    //    the Customer tab, the Portal Access card) — the same gap migration
    //    093 had to fix for portal-access matching. ilike() matches
    //    case-insensitively (no wildcard characters in an email for it to
    //    misinterpret).
    // 2. This used .maybeSingle(), which errors out (data: null, silently
    //    swallowed here since only `data` was read) the moment MORE than
    //    one contacts row shares that email — e.g. the same person added
    //    as a contact on more than one property/job. That's a real,
    //    unremarkable situation in this CRM, not corrupt data, so it can't
    //    be treated as "no match": order by most recently created and just
    //    take the first row instead of demanding exactly one.
    supabase
      .from('contacts')
      .select('id, automated_emails_opt_out')
      .ilike('contact_email', job.customer_email.trim())
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (error) { console.error('Contact lookup failed:', error); setContactId(null); setOptedOut(null); return; }
        const row = (data || [])[0];
        if (row) { setContactId(row.id); setOptedOut(row.automated_emails_opt_out); }
        else { setContactId(null); setOptedOut(null); }
      });
  }, [job.customer_email]);

  async function toggleOptOut() {
    if (!contactId) return;
    const next = !optedOut;
    setOptedOut(next);
    await supabase.from('contacts').update({ automated_emails_opt_out: next }).eq('id', contactId);
  }

  function addDay() {
    const n = parseInt(newDay, 10);
    if (!n || n < 1 || days.includes(n)) { setNewDay(''); return; }
    const next = [...days, n].sort((a, b) => b - a);
    setDays(next);
    onSave({ schedule_reminder_days: next });
    setNewDay('');
  }

  function removeDay(n) {
    const next = days.filter(d => d !== n);
    setDays(next);
    onSave({ schedule_reminder_days: next });
  }

  return (
    <div className="card">
      <h3>Automated Notifications</h3>

      <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--line)' }}>
        <div className="update-field-label">Follow-up emails</div>
        {contactId ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!optedOut} onChange={toggleOptOut} />
            This customer is opted in to automated schedule reminders
          </label>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>No matching contact record found for {job.customer_email || 'this job'} yet.</div>
        )}
      </div>

      <div>
        <div className="update-field-label">Schedule reminder timing</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '4px 0 10px' }}>
          Days before the Scheduled Start Date to email the customer a reminder. Add as many as you'd like — e.g. someone might want a 2-day notice instead of a 1-day one.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {days.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No reminders configured.</span>}
          {days.map(d => (
            <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '4px 10px', fontSize: 12.5 }}>
              {d} day{d === 1 ? '' : 's'} before
              <button onClick={() => removeDay(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" min="1" placeholder="Days before" value={newDay} onChange={e => setNewDay(e.target.value)} style={{ width: 120 }} />
          <button className="btn btn-sm" onClick={addDay}>Add</button>
        </div>
      </div>
    </div>
  );
}
