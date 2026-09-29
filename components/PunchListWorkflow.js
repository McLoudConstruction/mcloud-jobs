'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fmtPunchDate } from '../lib/punch';

const STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'customer_review', label: 'Customer review' },
  { key: 'staff_review', label: 'Your review' },
  { key: 'final', label: 'Final' },
  { key: 'sent', label: 'With subs' },
];

// The punch list's path from draft to the subs (migration 142):
//   draft → published to the customer → customer approves or adds items →
//   staff review (accept/decline additions) → final, read-only list published
//   to customer and subs → sent to the subs to schedule.
// All of the state changes go through database functions so the rules
// (nothing pending at publish, notifications) can't be skipped from here.
export default function PunchListWorkflow({ jobId }) {
  const [list, setList] = useState(undefined);
  const [pending, setPending] = useState(0);
  const [total, setTotal] = useState(0);
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [{ data: l }, { data: items }] = await Promise.all([
      supabase.from('punch_lists').select('*').eq('job_id', jobId).maybeSingle(),
      supabase.from('punch_items').select('id, review_state, status').eq('job_id', jobId).eq('kind', 'punch'),
    ]);
    setList(l || null);
    setPending((items || []).filter(i => i.review_state === 'pending').length);
    setTotal((items || []).filter(i => i.status !== 'declined').length);
  }, [jobId]);

  useEffect(() => {
    load();
    supabase.from('app_settings').select('punch_schedule_days').eq('id', 1).maybeSingle().then(({ data }) => { if (data?.punch_schedule_days) setDays(data.punch_schedule_days); });
    const channel = supabase.channel(`punch-workflow-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_lists', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_items', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function run(fn, args, okMessage) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    const { data, error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setMessage(typeof okMessage === 'function' ? okMessage(data) : okMessage);
    load();
  }

  if (list === undefined) return null;
  const status = list?.status || 'draft';
  const stepKey = status === 'final' && list?.sent_to_subs_at ? 'sent' : status === 'customer_review' ? 'customer_review' : status;
  const stepIndex = STEPS.findIndex(s => s.key === stepKey);
  const args = { target_job_id: jobId };

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ margin: 0, fontWeight: 600, fontSize: 12.5 }}>Punch list due</label>
        <input
          key={list?.due_date || 'none'}
          type="date"
          style={{ width: 'auto' }}
          defaultValue={list?.due_date || ''}
          onBlur={e => {
            const v = e.target.value || null;
            if (v !== (list?.due_date || null)) run('punch_list_set_due', { target_job_id: jobId, due_in: v }, v ? 'Due date saved for the whole list.' : 'Due date cleared.');
          }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>One date for the whole list — it applies to every item.</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {STEPS.map((s, i) => (
          <span key={s.key} style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
            background: i === stepIndex ? 'var(--accent)' : i < stepIndex ? '#e7f1e9' : 'transparent',
            color: i === stepIndex ? '#fff' : i < stepIndex ? '#3a6b45' : 'var(--ink-soft)',
            border: i > stepIndex ? '1px solid var(--line)' : '1px solid transparent',
          }}>{i < stepIndex ? '✓ ' : ''}{s.label}</span>
        ))}
      </div>

      {status === 'draft' && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 8 }}>Build the list below (photos help), then publish it so the customer can review it and add anything we missed.</div>
          <div className="section-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || total === 0} onClick={() => run('punch_list_publish_to_customer', args, 'Published — the customer has been notified to review it.')}>Publish for customer review</button>
            <button type="button" className="btn btn-sm" disabled={busy || total === 0} onClick={() => window.confirm('Skip the customer\'s review and publish the final list now?') && run('punch_list_publish_final', args, 'Final list published to the customer and subcontractors.')}>Skip review — publish final</button>
          </div>
        </div>
      )}

      {status === 'customer_review' && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 8 }}>Waiting on the customer — published {fmtPunchDate(list.published_to_customer_at)}. Anything they add appears below marked <b>needs review</b>. Once they submit, it comes back to you.</div>
          <div className="section-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run('punch_list_reopen', args, 'Pulled back to draft.')}>Pull back to draft</button>
            <button type="button" className="btn btn-sm" disabled={busy || pending > 0} onClick={() => window.confirm('Publish the final list without waiting for the customer to submit?') && run('punch_list_publish_final', args, 'Final list published to the customer and subcontractors.')}>Publish final anyway</button>
          </div>
        </div>
      )}

      {status === 'staff_review' && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 8 }}>
            {list.customer_approved
              ? <><b>The customer approved the list</b> as-is{list.customer_submitted_at ? ` on ${fmtPunchDate(list.customer_submitted_at)}` : ''}.</>
              : <><b>The customer added {pending} item{pending === 1 ? '' : 's'}</b>{list.customer_submitted_at ? ` on ${fmtPunchDate(list.customer_submitted_at)}` : ''}. Accept or decline each one below (assign a sub while you&apos;re at it), then publish.</>}
            {list.customer_note && <div style={{ marginTop: 4 }}><b>Their note:</b> {list.customer_note}</div>}
          </div>
          <div className="section-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || pending > 0} onClick={() => run('punch_list_publish_final', args, 'Final list published to the customer and subcontractors.')}>Publish final list</button>
            {pending > 0 && <span style={{ fontSize: 11.5, color: '#a13f3f', alignSelf: 'center' }}>{pending} item{pending === 1 ? '' : 's'} still need your decision</span>}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run('punch_list_reopen', args, 'Pulled back to draft.')}>Pull back to draft</button>
          </div>
        </div>
      )}

      {status === 'final' && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 8 }}>
            <b>Final list published</b> {fmtPunchDate(list.final_published_at)} — read-only for the customer and subs.
            {list.sent_to_subs_at
              ? <> Sent to the subcontractors {fmtPunchDate(list.sent_to_subs_at)}; they were asked to schedule by <b>{fmtPunchDate(list.schedule_by)}</b>.</>
              : <> Send it to the subs when you&apos;re ready — they&apos;ll be asked to schedule within {days} day{days === 1 ? '' : 's'} (Settings → Punch list scheduling).</>}
          </div>
          <div className="section-actions">
            {!list.sent_to_subs_at && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run('punch_list_send_to_subs', args, d => `Sent to the subs — they should schedule by ${fmtPunchDate(d)}.`)}>Send to subs for scheduling</button>}
            {list.sent_to_subs_at && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run('punch_list_send_to_subs', args, d => `Reminder sent — schedule by ${fmtPunchDate(d)}.`)}>Send again</button>}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => window.confirm('Pull the list back to draft? The customer and subs will be able to see it change.') && run('punch_list_reopen', args, 'Pulled back to draft.')}>Reopen list</button>
          </div>
        </div>
      )}

      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      {message && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 8 }}>{message}</div>}
    </div>
  );
}
