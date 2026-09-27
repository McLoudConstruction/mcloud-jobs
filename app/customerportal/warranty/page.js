'use client';
import { useState, useEffect, useCallback } from 'react';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import { supabase } from '../../../lib/supabaseClient';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import PortalJobSwitcher from '../../../components/PortalJobSwitcher';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';
import PunchPhotos from '../../../components/PunchPhotos';
import { PUNCH_STATUS, PUNCH_OPEN_STATUSES, fmtPunchDate } from '../../../lib/punch';

const CUSTOMER_STATUS_LABEL = {
  open: 'Received', in_progress: 'Being worked on', resolved: 'Marked complete — please confirm', verified: 'Confirmed complete', declined: 'Not covered',
};

function WarrantyView({ job }) {
  const [warranty, setWarranty] = useState(undefined);
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', location: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replyFor, setReplyFor] = useState(null);
  const [replyNote, setReplyNote] = useState('');
  const [newItemId, setNewItemId] = useState(null);

  const load = useCallback(async () => {
    const [{ data: w }, { data: list }] = await Promise.all([
      supabase.from('warranties').select('*').eq('job_id', job.id).maybeSingle(),
      supabase.from('punch_items').select('*').eq('job_id', job.id).eq('customer_visible', true).order('created_at', { ascending: false }),
    ]);
    setWarranty(w || null);
    setItems(list || []);
  }, [job.id]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`portal-warranty-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_items', filter: `job_id=eq.${job.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job.id, load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('submit_warranty_claim', {
      target_job_id: job.id, title_in: form.title, description_in: form.description, location_in: form.location || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNewItemId(data);
    setForm({ title: '', description: '', location: '' });
    setShowForm(false);
    setNotice('Thanks — we received your claim and will be in touch. You can add photos below.');
    load();
  }

  async function respond(item, accepted) {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('respond_punch_resolution', { target_item_id: item.id, accepted, note_in: accepted ? null : replyNote });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setReplyFor(null);
    setReplyNote('');
    load();
  }

  if (warranty === undefined) return null;
  const today = new Date().toISOString().slice(0, 10);
  const active = warranty && warranty.status === 'active' && warranty.end_date >= today;

  return (
    <div>
      <div className="card">
        <h3>Your warranty</h3>
        {!warranty ? (
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Warranty coverage begins when your project is completed. If something needs attention before then, send us a message.</div>
        ) : (
          <div style={{ fontSize: 13.5 }}>
            <b>{active ? 'Covered' : 'Warranty period ended'}</b> · {fmtPunchDate(warranty.start_date)} to {fmtPunchDate(warranty.end_date)}
            {active && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>See something that isn&apos;t right? Tell us below and add a photo if you can.</div>}
          </div>
        )}
        {notice && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 10 }}>{notice}</div>}
        {active && (
          <div style={{ marginTop: 12 }}>
            {!showForm ? <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(true); setNotice(''); }}>Report a problem</button> : (
              <form onSubmit={submit} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
                <label>What&apos;s wrong?</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Cabinet door is sagging" />
                <label>Where?</label>
                <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Kitchen, left of the sink" />
                <label>Anything else we should know</label>
                <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                {error && <div className="error-text" style={{ margin: '8px 0' }}>{error}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Sending…' : 'Send to McLoud'}</button>
                  <button className="btn btn-sm" type="button" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        )}
        {!active && warranty && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>Need help with something? Send us a message from your Inbox and we&apos;ll see what we can do.</div>}
      </div>

      {items.length > 0 && (
        <div className="card">
          <h3>Requests &amp; follow-ups</h3>
          {error && !showForm && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          {items.map(i => {
            const st = PUNCH_STATUS[i.status];
            const canAddPhotos = PUNCH_OPEN_STATUSES.includes(i.status);
            return (
              <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{[i.kind === 'warranty' ? 'Warranty claim' : 'Punch list', i.location, `received ${fmtPunchDate(i.created_at)}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{CUSTOMER_STATUS_LABEL[i.status]}</span>
                </div>
                {i.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, marginTop: 6 }}>{i.description}</div>}
                {i.resolution_note && i.status !== 'open' && <div style={{ fontSize: 12.5, marginTop: 6 }}><b>What we did:</b> {i.resolution_note}</div>}
                {i.status === 'declined' && i.declined_reason && <div style={{ fontSize: 12.5, marginTop: 6, color: '#a13f3f' }}>{i.declined_reason}</div>}
                <PunchPhotos item={i} canAdd={canAddPhotos} key={i.id + (newItemId === i.id ? '-new' : '')} />
                {i.status === 'resolved' && (
                  <div style={{ marginTop: 10 }}>
                    {replyFor === i.id ? (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>What&apos;s still not right?</label>
                        <textarea rows={2} value={replyNote} onChange={e => setReplyNote(e.target.value)} />
                        <div className="section-actions">
                          <button className="btn btn-sm btn-primary" disabled={busy || !replyNote.trim()} onClick={() => respond(i, false)}>Send</button>
                          <button className="btn btn-sm" onClick={() => setReplyFor(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => respond(i, true)}>Looks good</button>
                        <button className="btn btn-sm" onClick={() => { setReplyFor(i.id); setReplyNote(''); }}>Still needs work</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CustomerWarrantyPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, jobsLoaded, selectedJobId, setSelectedJobId, job } = useCustomerPortalJobs(session);

  if (loading || !session) return null;
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <PortalJobSwitcher jobs={jobs} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} />
        {job && <WarrantyView key={job.id} job={job} />}
      </div>
    </CustomerPortalShell>
  );
}
