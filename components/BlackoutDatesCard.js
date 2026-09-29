'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { applyBlackoutToSchedule } from '../lib/blackoutShift';
import { fmtPunchDate } from '../lib/punch';

const STATUS = {
  auto_applied: { label: 'Schedule moved automatically — review', color: '#a17c3f', bg: '#f7efdc' },
  needs_review: { label: 'Under notice period — needs review', color: '#a13f3f', bg: '#fbeae7' },
  approved: { label: 'Approved — schedule moved', color: '#2f4858', bg: '#e6edf1' },
  sent_to_subs: { label: 'Sent to subs', color: '#3a6b45', bg: '#e7f1e9' },
  declined: { label: 'Declined', color: '#6b6656', bg: '#efece4' },
  withdrawn: { label: 'Cancelled by customer', color: '#6b6656', bg: '#efece4' },
};
const OPEN = ['auto_applied', 'needs_review', 'approved'];

// Staff view of the customer's blackout dates on a job (Schedule tab).
// Requests with 2+ weeks' notice already moved the schedule when they came
// in (see /api/portal/blackout) and just need a look before going to the
// subs; shorter-notice ones wait here, with the schedule untouched, until
// staff approve (which then moves it) or decline.
export default function BlackoutDatesCard({ jobId }) {
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('customer_blackout_dates').select('*').eq('job_id', jobId).order('start_date', { ascending: true });
    setRows(data || []);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`blackout-staff-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_blackout_dates', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function approve(r) {
    if (!window.confirm(`Move the schedule around ${fmtPunchDate(r.start_date)}${r.end_date !== r.start_date ? ' – ' + fmtPunchDate(r.end_date) : ''}? This shifts any phases that fall in that window.`)) return;
    setBusyId(r.id); setError(''); setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await applyBlackoutToSchedule(supabase, { jobId, blackoutId: r.id, startDate: r.start_date, endDate: r.end_date, actorEmail: session?.user?.email });
      const { error: upErr } = await supabase.from('customer_blackout_dates').update({
        status: 'approved', schedule_shift_note: result.note, reviewed_by_email: session?.user?.email || null, reviewed_at: new Date().toISOString(),
      }).eq('id', r.id);
      if (upErr) throw upErr;
      setMessage(result.note);
    } catch (err) { setError(err.message); }
    setBusyId(null);
    load();
  }

  async function decline(r) {
    const reason = window.prompt('Why can\'t this be accommodated? The customer will see this note.');
    if (!reason || !reason.trim()) return;
    setBusyId(r.id); setError(''); setMessage('');
    const { data: { session } } = await supabase.auth.getSession();
    const { error: err } = await supabase.from('customer_blackout_dates').update({
      status: 'declined', staff_note: reason.trim(), reviewed_by_email: session?.user?.email || null, reviewed_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (err) setError(err.message);
    setBusyId(null);
    load();
  }

  async function sendToSubs(r) {
    setBusyId(r.id); setError(''); setMessage('');
    const { data, error: err } = await supabase.rpc('submit_blackout_to_subs', { target_blackout_id: r.id });
    if (err) setError(err.message);
    else setMessage(data > 0 ? `Sent to ${data} subcontractor${data === 1 ? '' : 's'}.` : 'Marked as sent — no subs have an issued work order on this job yet.');
    setBusyId(null);
    load();
  }

  const openCount = rows.filter(r => OPEN.includes(r.status)).length;
  const shown = rows.filter(r => showAll || OPEN.includes(r.status) || r.status === 'sent_to_subs');
  if (rows.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Customer blackout dates{openCount > 0 ? ` (${openCount} to review)` : ''}</h3>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show declined / cancelled
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '6px 0 10px' }}>
        Dates the customer can&apos;t have crews on site. Requests with enough notice have already moved the schedule; shorter-notice ones wait for you. Review, then send to the subs.
      </div>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginBottom: 8 }}>{message}</div>}
      {shown.map(r => {
        const st = STATUS[r.status];
        return (
          <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b>{fmtPunchDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${fmtPunchDate(r.end_date)}` : ''}</b>
                {r.reason && <span style={{ color: 'var(--ink-soft)' }}> · {r.reason}</span>}
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                  requested {fmtPunchDate(r.created_at)}{r.requested_by_email ? ` by ${r.requested_by_email}` : ''}{r.notice_days != null ? ` · ${r.notice_days} day${r.notice_days === 1 ? '' : 's'} notice` : ''}
                </div>
                {r.schedule_shift_note && <div style={{ fontSize: 12, marginTop: 2 }}>{r.schedule_shift_note}</div>}
                {r.staff_note && <div style={{ fontSize: 12, marginTop: 2 }}><b>Note:</b> {r.staff_note}</div>}
              </div>
              <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
            {(r.status === 'needs_review' || r.status === 'auto_applied' || r.status === 'approved') && (
              <div className="section-actions" style={{ marginTop: 8 }}>
                {r.status === 'needs_review' && <button type="button" className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => approve(r)}>Approve &amp; move schedule</button>}
                {r.status !== 'needs_review' && <button type="button" className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => sendToSubs(r)}>Send to subs</button>}
                {r.status !== 'approved' && <button type="button" className="btn btn-sm" disabled={busyId === r.id} onClick={() => decline(r)}>Decline</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
