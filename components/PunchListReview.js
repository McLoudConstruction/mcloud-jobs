'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import PunchPhotos from './PunchPhotos';
import { PUNCH_STATUS, fmtPunchDate } from '../lib/punch';

const CUSTOMER_STATUS_LABEL = {
  open: 'Scheduled to be fixed', in_progress: 'Being worked on', resolved: 'Marked complete — please confirm', verified: 'Confirmed complete', declined: 'Not added',
};

// Customer Portal: the punch list for their project (migration 142).
//   • While it is out for review they can look everything over, add items of
//     their own (with photos), and submit — "Approve" if they have nothing to
//     add, "Submit additions" if they do.
//   • After that it is read-only: they can follow each item's progress and
//     confirm a fix when the crew marks it done.
export default function PunchListReview({ job }) {
  const [list, setList] = useState(undefined);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: '', location: '', description: '' });
  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replyFor, setReplyFor] = useState(null);
  const [replyNote, setReplyNote] = useState('');

  const load = useCallback(async () => {
    const [{ data: l }, { data: rows }] = await Promise.all([
      supabase.from('punch_lists').select('*').eq('job_id', job.id).maybeSingle(),
      supabase.from('punch_items').select('*').eq('job_id', job.id).eq('kind', 'punch').eq('customer_visible', true).order('created_at', { ascending: true }),
    ]);
    setList(l || null);
    setItems(rows || []);
  }, [job.id]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`portal-punchlist-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_lists', filter: `job_id=eq.${job.id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_items', filter: `job_id=eq.${job.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job.id, load]);

  async function rpc(name, args, after) {
    setBusy(true); setError('');
    const { data, error: err } = await supabase.rpc(name, args);
    setBusy(false);
    if (err) { setError(err.message); return null; }
    if (after) after(data);
    load();
    return data;
  }

  async function addItem(e) {
    e.preventDefault();
    await rpc('customer_add_punch_item', { target_job_id: job.id, title_in: form.title, description_in: form.description || null, location_in: form.location || null }, () => {
      setForm({ title: '', location: '', description: '' });
      setShowForm(false);
      setNotice('Added — you can attach photos to it below.');
    });
  }

  if (list === undefined || !list || list.status === 'draft') return null;
  const reviewing = list.status === 'customer_review';
  const visibleItems = items.filter(i => i.status !== 'declined' || i.reported_by_kind === 'customer');
  const mine = items.filter(i => i.reported_by_kind === 'customer' && i.review_state === 'pending');

  return (
    <div className="card">
      <h3>Your punch list</h3>
      {reviewing && (
        <div style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
          We&apos;ve put together the final touch-ups for your project. <b>Please look through the list, add anything we missed</b> (a photo helps a lot),
          and submit it when you&apos;re done. If it looks right as-is, just approve it.
        </div>
      )}
      {list.status === 'staff_review' && (
        <div style={{ fontSize: 13, marginBottom: 12, color: '#3a6b45' }}>
          Thank you — you {list.customer_approved ? 'approved the list' : 'submitted your additions'} on {fmtPunchDate(list.customer_submitted_at)}. Our team is reviewing it and will publish the final list soon.
        </div>
      )}
      {list.status === 'final' && (
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          The final list was published {fmtPunchDate(list.final_published_at)}.
          {list.sent_to_subs_at ? ' It has been sent to the crews to schedule.' : ''} You can follow each item below.
        </div>
      )}
      {list.due_date && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>Target completion for the whole list: <b>{fmtPunchDate(list.due_date)}</b></div>}
      {notice && <div style={{ fontSize: 12.5, color: '#3a6b45', marginBottom: 10 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      {visibleItems.length === 0 && <div className="empty-state">Nothing on the list yet.</div>}
      {visibleItems.map(i => {
        const st = PUNCH_STATUS[i.status];
        const pending = i.review_state === 'pending';
        const canEdit = reviewing && i.reported_by_kind === 'customer' && pending;
        const label = pending ? (list.status === 'staff_review' ? 'Awaiting our review' : 'Your addition') : CUSTOMER_STATUS_LABEL[i.status];
        return (
          <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{[i.location, i.reported_by_kind === 'customer' ? 'added by you' : null].filter(Boolean).join(' · ')}</div>
              </div>
              <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: pending ? '#a17c3f' : st.color, background: pending ? '#f7efdc' : st.bg, whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, marginTop: 6 }}>{i.description}</div>}
            {i.status === 'declined' && i.declined_reason && <div style={{ fontSize: 12.5, marginTop: 6, color: '#a13f3f' }}>{i.declined_reason}</div>}
            {i.resolution_note && i.status !== 'open' && <div style={{ fontSize: 12.5, marginTop: 6 }}><b>What we did:</b> {i.resolution_note}</div>}
            <PunchPhotos item={i} canAdd={canEdit} />
            {canEdit && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => window.confirm('Remove this item?') && rpc('customer_remove_punch_item', { target_item_id: i.id })}>Remove</button>
              </div>
            )}
            {list.status === 'final' && i.status === 'resolved' && (
              <div style={{ marginTop: 10 }}>
                {replyFor === i.id ? (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>What&apos;s still not right?</label>
                    <textarea rows={2} value={replyNote} onChange={e => setReplyNote(e.target.value)} />
                    <div className="section-actions">
                      <button className="btn btn-sm btn-primary" disabled={busy || !replyNote.trim()} onClick={() => rpc('respond_punch_resolution', { target_item_id: i.id, accepted: false, note_in: replyNote }, () => { setReplyFor(null); setReplyNote(''); })}>Send</button>
                      <button className="btn btn-sm" onClick={() => setReplyFor(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => rpc('respond_punch_resolution', { target_item_id: i.id, accepted: true, note_in: null })}>Looks good</button>
                    <button className="btn btn-sm" onClick={() => { setReplyFor(i.id); setReplyNote(''); }}>Still needs work</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {reviewing && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          {!showForm ? (
            <button type="button" className="btn btn-sm" onClick={() => { setShowForm(true); setNotice(''); }}>+ Add something we missed</button>
          ) : (
            <form onSubmit={addItem} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
              <label>What needs attention?</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Scuff on the hallway wall" />
              <label>Where?</label>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Upstairs hall, by the bathroom door" />
              <label>Anything else we should know</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <div className="section-actions">
                <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Adding…' : 'Add to list'}</button>
                <button className="btn btn-sm" type="button" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          <label style={{ marginTop: 10 }}>Note for our team (optional)</label>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
          <div className="section-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => rpc('customer_submit_punch_review', { target_job_id: job.id, note_in: note || null }, approved => setNotice(approved ? 'Approved — thank you! Our team will publish the final list.' : 'Submitted — our team will review your additions and publish the final list.'))}>
              {mine.length === 0 ? 'Approve the list' : `Submit ${mine.length} addition${mine.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
