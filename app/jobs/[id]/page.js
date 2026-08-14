'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';

const STAGE_ORDER = ['proposal', 'contract', 'active', 'invoice', 'complete'];
const STAGE_LABELS = { proposal: 'Proposal', contract: 'Contract', active: 'Active', invoice: 'Invoice', complete: 'Complete' };

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function JobDetailPage() {
  const { session, loading } = useRequireAuth();
  const { id } = useParams();
  const router = useRouter();

  const [job, setJob] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [flash, setFlash] = useState('');
  const [notFound, setNotFound] = useState(false);

  const loadJob = useCallback(async () => {
    const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (error || !data) { setNotFound(true); return; }
    setJob(data);
  }, [id]);

  const loadUpdates = useCallback(async () => {
    const { data } = await supabase.from('job_updates').select('*').eq('job_id', id).order('update_date', { ascending: false });
    if (data) setUpdates(data);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    loadJob();
    loadUpdates();

    const channel = supabase
      .channel(`job-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${id}` }, loadJob)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${id}` }, loadUpdates)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session, id, loadJob, loadUpdates]);

  function flashSaved() {
    setFlash('Saved');
    setTimeout(() => setFlash(''), 1500);
  }

  async function saveJob(patch) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', id);
    if (!error) flashSaved();
  }

  async function advanceStage() {
    const idx = STAGE_ORDER.indexOf(job.stage);
    if (idx >= STAGE_ORDER.length - 1) return;
    const next = STAGE_ORDER[idx + 1];
    if (!confirm(`Move this job from ${STAGE_LABELS[job.stage]} to ${STAGE_LABELS[next]}?`)) return;
    await saveJob({ stage: next });
  }

  async function deleteJob() {
    if (!confirm('Permanently delete this job? This cannot be undone.')) return;
    await supabase.from('jobs').delete().eq('id', id);
    router.push('/dashboard');
  }

  if (loading || !session) return null;
  if (notFound) return <div className="container">Job not found. <Link href="/dashboard">Back to dashboard</Link></div>;
  if (!job) return null;

  return (
    <div>
      <div className="topbar">
        <div className="brand">McLoud <span>Jobs</span></div>
        <Link href="/dashboard" className="btn btn-sm">← Dashboard</Link>
      </div>

      <div className="container">
        <div className="top-actions">
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>#{job.job_number} — {job.customer_name || 'Unnamed customer'}</h2>
            <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
            {flash && <span className="saved-flash">{flash}</span>}
          </div>
          <div className="section-actions">
            {job.stage !== 'complete' && (
              <button className="btn btn-primary" onClick={advanceStage}>
                Advance to {STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.indexOf(job.stage) + 1]]} →
              </button>
            )}
            <button className="btn btn-danger" onClick={deleteJob}>Delete job</button>
          </div>
        </div>

        <JobInfoCard job={job} onSave={saveJob} />
        <ScopeCard job={job} onSave={saveJob} />
        <PriceCard job={job} onSave={saveJob} />
        <TermsCard job={job} onSave={saveJob} />

        {(job.stage === 'active' || job.stage === 'invoice' || job.stage === 'complete') && (
          <UpdatesCard jobId={id} updates={updates} />
        )}

        {(job.stage === 'invoice' || job.stage === 'complete') && (
          <InvoiceCard job={job} onSave={saveJob} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Job info ---------------- */
function JobInfoCard({ job, onSave }) {
  const [form, setForm] = useState({
    customer_name: job.customer_name || '',
    customer_contact: job.customer_contact || '',
    customer_email: job.customer_email || '',
    customer_phone: job.customer_phone || '',
    billing_address: job.billing_address || '',
    project_address: job.project_address || '',
    description: job.description || '',
    governing_state: job.governing_state || 'Missouri',
  });

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  return (
    <div className="card">
      <h3>Job info</h3>
      <div className="two-col">
        <div><label>Customer / company name</label><input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} /></div>
        <div><label>Contact person</label><input value={form.customer_contact} onChange={e => update('customer_contact', e.target.value)} /></div>
        <div><label>Email</label><input value={form.customer_email} onChange={e => update('customer_email', e.target.value)} /></div>
        <div><label>Phone</label><input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} /></div>
      </div>
      <label>Billing address</label>
      <input value={form.billing_address} onChange={e => update('billing_address', e.target.value)} />
      <label>Project / jobsite address</label>
      <input value={form.project_address} onChange={e => update('project_address', e.target.value)} />
      <label>Description</label>
      <textarea value={form.description} onChange={e => update('description', e.target.value)} />
      <label>Governing state</label>
      <select value={form.governing_state} onChange={e => update('governing_state', e.target.value)}>
        <option value="Missouri">Missouri</option>
        <option value="Kansas">Kansas</option>
      </select>
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={() => onSave(form)}>Save job info</button>
      </div>
    </div>
  );
}

/* ---------------- Scope of work ---------------- */
function ScopeCard({ job, onSave }) {
  const [items, setItems] = useState((job.scope_items || []).map(i => i.text || ''));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ scope_items: items.filter(t => t.trim()).map(text => ({ text })) }); }

  return (
    <div className="card">
      <h3>Scope of work</h3>
      {items.length === 0 && <div className="empty-state">No scope items yet.</div>}
      {items.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => update(i, e.target.value)} />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add item</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save scope</button>
      </div>
    </div>
  );
}

/* ---------------- Contract price + milestones ---------------- */
function PriceCard({ job, onSave }) {
  const [price, setPrice] = useState(job.contract_price ?? '');
  const [milestones, setMilestones] = useState(job.milestones || []);

  function add() { setMilestones(prev => [...prev, { desc: '', amount: '' }]); }
  function update(i, field, v) { setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: v } : m)); }
  function remove(i) { setMilestones(prev => prev.filter((_, idx) => idx !== i)); }
  function save() {
    onSave({
      contract_price: price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) : null,
      milestones,
    });
  }

  return (
    <div className="card">
      <h3>Contract price &amp; payment schedule</h3>
      <label>Total contract price ($)</label>
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 185,000" />
      <label style={{ marginTop: 16 }}>Payment milestones</label>
      {milestones.length === 0 && <div className="empty-state">No milestones yet.</div>}
      {milestones.map((m, i) => (
        <div className="list-row" key={i}>
          <textarea value={m.desc} onChange={e => update(i, 'desc', e.target.value)} placeholder="e.g. Due upon substantial completion" />
          <input className="amount" value={m.amount} onChange={e => update(i, 'amount', e.target.value)} placeholder="$ or %" />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add milestone</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save price &amp; schedule</button>
      </div>
    </div>
  );
}

/* ---------------- Additional terms ---------------- */
function TermsCard({ job, onSave }) {
  const [items, setItems] = useState((job.additional_terms || []).map(i => i.text || ''));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ additional_terms: items.filter(t => t.trim()).map(text => ({ text })) }); }

  return (
    <div className="card">
      <h3>Additional terms</h3>
      {items.length === 0 && <div className="empty-state">None added.</div>}
      {items.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => update(i, e.target.value)} />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add term</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save terms</button>
      </div>
    </div>
  );
}

/* ---------------- Daily updates ---------------- */
function UpdatesCard({ jobId, updates }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    update_date: new Date().toISOString().slice(0, 10),
    work_completed: '', upcoming_work: '', issues_notes: '', next_steps: '', estimated_completion: '',
  });
  const [saving, setSaving] = useState(false);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit() {
    setSaving(true);
    await supabase.from('job_updates').insert({ job_id: jobId, ...form, estimated_completion: form.estimated_completion || null });
    setSaving(false);
    setShowForm(false);
    setForm({ update_date: new Date().toISOString().slice(0, 10), work_completed: '', upcoming_work: '', issues_notes: '', next_steps: '', estimated_completion: '' });
  }

  async function removeUpdate(updateId) {
    if (!confirm('Delete this update entry?')) return;
    await supabase.from('job_updates').delete().eq('id', updateId);
  }

  return (
    <div className="card">
      <h3>Project updates</h3>

      {showForm ? (
        <div>
          <div className="two-col">
            <div><label>Date</label><input type="date" value={form.update_date} onChange={e => update('update_date', e.target.value)} /></div>
            <div><label>Estimated completion</label><input type="date" value={form.estimated_completion} onChange={e => update('estimated_completion', e.target.value)} /></div>
          </div>
          <label>Work completed</label>
          <textarea value={form.work_completed} onChange={e => update('work_completed', e.target.value)} />
          <label>Upcoming work</label>
          <textarea value={form.upcoming_work} onChange={e => update('upcoming_work', e.target.value)} />
          <label>Issues / notes</label>
          <textarea value={form.issues_notes} onChange={e => update('issues_notes', e.target.value)} />
          <label>Next steps</label>
          <textarea value={form.next_steps} onChange={e => update('next_steps', e.target.value)} />
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Post update'}</button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Post new update</button>
        </div>
      )}

      {updates.length === 0 && <div className="empty-state">No updates posted yet.</div>}
      {updates.map(u => (
        <div className="update-entry" key={u.id}>
          <div className="update-date">{fmtDate(u.update_date)}</div>
          {u.work_completed && <><div className="update-field-label">Work completed</div><p>{u.work_completed}</p></>}
          {u.upcoming_work && <><div className="update-field-label">Upcoming work</div><p>{u.upcoming_work}</p></>}
          {u.issues_notes && <><div className="update-field-label">Issues / notes</div><p>{u.issues_notes}</p></>}
          {u.next_steps && <><div className="update-field-label">Next steps</div><p>{u.next_steps}</p></>}
          {u.estimated_completion && <><div className="update-field-label">Estimated completion</div><p>{fmtDate(u.estimated_completion)}</p></>}
          <div className="section-actions">
            <button className="btn btn-sm btn-danger" onClick={() => removeUpdate(u.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Invoice ---------------- */
function InvoiceCard({ job, onSave }) {
  const [amount, setAmount] = useState(job.invoice_amount ?? job.contract_price ?? '');
  const [status, setStatus] = useState(job.invoice_status || 'not_sent');

  function save() {
    onSave({ invoice_amount: amount ? parseFloat(String(amount).replace(/[^0-9.]/g, '')) : null, invoice_status: status });
  }

  return (
    <div className="card">
      <h3>Invoice</h3>
      <div className="two-col">
        <div>
          <label>Invoice amount ($)</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="not_sent">Not sent</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save invoice</button>
      </div>
    </div>
  );
}
