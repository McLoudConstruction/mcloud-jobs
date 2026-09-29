'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fmtPunchDate } from '../lib/punch';

const STATUS_LABEL = {
  auto_applied: 'Added to the schedule — our team is confirming',
  needs_review: 'Received — our team is reviewing',
  approved: 'Approved — our team is confirming',
  sent_to_subs: 'Confirmed and shared with the crews',
  declined: 'We could not work around this one',
  withdrawn: 'Cancelled',
};

// Customer Portal → Schedule: dates the customer can't have crews on site.
// Available once the contract is signed, and any time after. The database
// (add_customer_blackout) enforces the rules; the /api/portal/blackout route
// shifts the schedule when there's enough notice. Requests inside the notice
// window are held for our team rather than moving the schedule on the spot.
export default function CustomerBlackoutCard({ job }) {
  const [rows, setRows] = useState([]);
  const [noticeDays, setNoticeDays] = useState(14);
  const [form, setForm] = useState({ start: '', end: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const signed = Boolean(job?.contract_finalized_at);

  const load = useCallback(async () => {
    const { data } = await supabase.from('customer_blackout_dates').select('*').eq('job_id', job.id).neq('status', 'withdrawn').order('start_date', { ascending: true });
    setRows(data || []);
  }, [job.id]);

  useEffect(() => {
    load();
    supabase.from('app_settings').select('blackout_notice_days').eq('id', 1).maybeSingle().then(({ data }) => {
      if (data?.blackout_notice_days) setNoticeDays(data.blackout_notice_days);
    });
    const channel = supabase.channel(`portal-blackout-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_blackout_dates', filter: `job_id=eq.${job.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job.id, load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/portal/blackout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session?.access_token, jobId: job.id, startDate: form.start, endDate: form.end || form.start, reason: form.reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save those dates.');
      setForm({ start: '', end: '', reason: '' });
      setNotice(data.status === 'auto_applied'
        ? 'Thanks — those dates are blocked off and your schedule has been updated. Our team will confirm the new dates with the crews.'
        : 'Thanks — we received it. Because it is inside the notice period, our team will review it before changing the schedule and follow up with you.');
      load();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function withdraw(id) {
    setError('');
    const { error: err } = await supabase.rpc('withdraw_customer_blackout', { target_blackout_id: id });
    if (err) setError(err.message); else load();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Dates we can&apos;t be at your home</h3>
      {!signed ? (
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          Once your contract is signed you can block off dates here — a trip, an event, anything that means crews shouldn&apos;t be on site.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12, lineHeight: 1.55 }}>
            Tell us the dates crews shouldn&apos;t be on site and we&apos;ll schedule around them. <b>Please give us at least {noticeDays / 7 === 2 ? 'two weeks' : `${noticeDays} days`}&apos; notice</b> —
            dates entered with less than that may not be able to be honored, and our team will review them before anything changes.
          </div>
          <form onSubmit={submit} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
            <div className="two-col">
              <div><label>First day</label><input type="date" min={today} value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value, end: f.end && f.end < e.target.value ? e.target.value : f.end }))} required /></div>
              <div><label>Last day (leave blank for one day)</label><input type="date" min={form.start || today} value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></div>
            </div>
            <label>Reason (optional)</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Out of town" />
            {error && <div className="error-text" style={{ margin: '8px 0' }}>{error}</div>}
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !form.start} style={{ marginTop: 8 }}>{busy ? 'Saving…' : 'Block off these dates'}</button>
          </form>
          {notice && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 10 }}>{notice}</div>}
        </>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {rows.map(r => (
            <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b>{fmtPunchDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${fmtPunchDate(r.end_date)}` : ''}</b>
                {r.reason && <span style={{ color: 'var(--ink-soft)' }}> · {r.reason}</span>}
                <div style={{ fontSize: 11.5, color: r.status === 'declined' ? '#a13f3f' : 'var(--ink-soft)' }}>
                  {STATUS_LABEL[r.status]}{r.status === 'declined' && r.staff_note ? ` — ${r.staff_note}` : ''}
                </div>
              </div>
              {r.status === 'needs_review' && <button type="button" className="btn btn-sm" onClick={() => withdraw(r.id)}>Cancel request</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
