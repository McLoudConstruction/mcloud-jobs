'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import Breadcrumb from '../../../components/Breadcrumb';
import PhotoGallery from '../../../components/PhotoGallery';
import AIScopeGenerator from '../../../components/AIScopeGenerator';
import JobCostSummary from '../../../components/JobCostSummary';
import DrawsCard from '../../../components/DrawsCard';
import ReceiptsCard from '../../../components/ReceiptsCard';
import WorkOrdersCard from '../../../components/WorkOrdersCard';
import AddressFields, { formatAddress } from '../../../components/AddressFields';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL, STAGE_ORDER, STAGE_LABELS, STAGE_DOCS, PHASES, phaseForStage, contractPathFor } from '../../../lib/constants';

const TABS = [
  { key: 'Customer', label: 'Customer Details' },
  { key: 'Project', label: 'Project Details' },
  { key: 'Financials', label: 'Financials' },
  { key: 'Photos', label: 'Photos' },
  { key: 'Documents', label: 'Documentation' },
  { key: 'Communications', label: 'Communications' },
];

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
function standardListFor(type) {
  return type === 'commercial' ? STANDARD_ASSUMPTIONS_COMMERCIAL : STANDARD_ASSUMPTIONS_RESIDENTIAL;
}

export default function JobDetailPage() {
  const { session, loading } = useRequireAuth();
  const { id } = useParams();
  const router = useRouter();

  const [job, setJob] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [flash, setFlash] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('Customer');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TABS.some(t => t.key === requested)) setTab(requested);
  }, []);

  const loadJob = useCallback(async () => {
    const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
    if (error || !data) { setNotFound(true); return; }
    setJob(data);
  }, [id]);

  const loadUpdates = useCallback(async () => {
    const { data } = await supabase.from('job_updates').select('*').eq('job_id', id).order('update_date', { ascending: false });
    if (data) setUpdates(data);
  }, [id]);

  const loadChangeOrders = useCallback(async () => {
    const { data } = await supabase.from('change_orders').select('*').eq('job_id', id).order('co_date', { ascending: false });
    if (data) setChangeOrders(data);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    loadJob();
    loadUpdates();
    loadChangeOrders();

    const channel = supabase
      .channel(`job-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${id}` }, loadJob)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${id}` }, loadUpdates)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${id}` }, loadChangeOrders)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session, id, loadJob, loadUpdates, loadChangeOrders]);

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
    if (next === 'approved' && job.contract_price) {
      const { data: existing } = await supabase.from('invoices').select('id').eq('job_id', id).limit(1);
      if (!existing || existing.length === 0) {
        const half = Math.round((parseFloat(job.contract_price) / 2) * 100) / 100;
        await supabase.from('invoices').insert([
          { job_id: id, description: 'Draw 1 — Deposit', amount: half, status: 'not_sent' },
          { job_id: id, description: 'Draw 2 — Final Payment', amount: parseFloat(job.contract_price) - half, status: 'not_sent' },
        ]);
      }
    }
  }

  async function invitePortal() {
    const recipientEmail = job.customer_email || job.billing_email || '';
    if (!recipientEmail) { setInviteResult('Add a contact email before inviting the customer.'); return; }
    setInviting(true);
    setInviteResult('');
    const { error } = await supabase.auth.signInWithOtp({
      email: recipientEmail,
      options: { emailRedirectTo: `${window.location.origin}/portal/dashboard` },
    });
    setInviting(false);
    if (error) {
      setInviteResult(error.message);
    } else {
      setInviteResult(`Invite sent to ${recipientEmail}.`);
      await saveJob({ portal_invited_at: new Date().toISOString() });
    }
  }

  async function deleteJob() {
    if (!confirm('Permanently delete this job? This cannot be undone.')) return;
    await supabase.from('jobs').delete().eq('id', id);
    router.push('/jobs');
  }

  if (loading || !session) return null;
  if (notFound) return <div className="container">Job not found. <Link href="/jobs">Back to Job Tracker</Link></div>;
  if (!job) return null;

  return (
    <AppShell>
      <div className="container">
        <Breadcrumb href="/jobs" label="Back to Job Tracker" />
        <div className="top-actions">
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>#{job.job_number} — {job.customer_name || 'Unnamed customer'}</h2>
            <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
            {flash && <span className="saved-flash">{flash}</span>}
          </div>
          <div className="section-actions">
            <button className="btn btn-sm" onClick={invitePortal} disabled={inviting}>
              {inviting ? 'Sending…' : job.portal_invited_at ? 'Resend portal invite' : 'Invite to Customer Portal'}
            </button>
            {job.stage !== STAGE_ORDER[STAGE_ORDER.length - 1] && (
              <button className="btn btn-primary" onClick={advanceStage}>
                Advance to {STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.indexOf(job.stage) + 1]]} →
              </button>
            )}
            <button className="btn btn-danger" onClick={deleteJob}>Delete job</button>
          </div>
        </div>
        {inviteResult && (
          <div style={{ fontSize: 12.5, marginTop: -10, marginBottom: 14, color: inviteResult.startsWith('Invite sent') ? '#3a6b45' : '#a13f3f' }}>
            {inviteResult}
          </div>
        )}

        <StageStepper currentStage={job.stage} />

        <div className="stage-tabs">
          {TABS.map(t => (
            <button key={t.key} className={`stage-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === 'Customer' && (
          <>
            <CustomerInfoCard job={job} onSave={saveJob} />
            <PortalCard job={job} />
          </>
        )}

        {tab === 'Project' && (
          <>
            <ProjectInfoCard job={job} onSave={saveJob} />
            <ScopeCard job={job} onSave={saveJob} />
            <PriceCard job={job} onSave={saveJob} />
            <TermsCard job={job} onSave={saveJob} />
          </>
        )}

        {tab === 'Financials' && (
          <>
            <DrawsCard jobId={id} />
            <JobCostSummary jobId={id} contractPrice={job.contract_price} />
            <ReceiptsCard jobId={id} />
            <WorkOrdersCard jobId={id} scopeItems={(job.scope_items || []).map(s => s.text || '').filter(Boolean)} />
          </>
        )}

        {tab === 'Photos' && (
          <PhotoGallery jobId={id} title="Job Photos" />
        )}

        {tab === 'Documents' && (
          <>
            {phaseForStage(job.stage) !== 'completed_phase' && <DocumentsCard jobId={id} job={job} />}
            {phaseForStage(job.stage) !== 'opportunity' && (
              <ChangeOrdersCard jobId={id} changeOrders={changeOrders} />
            )}
            {phaseForStage(job.stage) !== 'opportunity' && (
              <UpdatesCard jobId={id} updates={updates} />
            )}
            {(job.stage === 'completed' || job.stage === 'invoiced' || job.stage === 'paid') && (
              <InvoiceCard job={job} onSave={saveJob} jobId={id} />
            )}
          </>
        )}

        {tab === 'Communications' && (
          <CommunicationsCard job={job} jobId={id} updates={updates} changeOrders={changeOrders} />
        )}
      </div>
    </AppShell>
  );
}

function CommunicationsCard({ job, jobId, updates, changeOrders }) {
  const entries = [];

  if (job.portal_invited_at) {
    entries.push({ at: job.portal_invited_at, label: 'Customer portal invite sent', href: null });
  }
  if (job.proposal_sent_at) {
    entries.push({ at: job.proposal_sent_at, label: 'Proposal sent', href: `/jobs/${jobId}/proposal` });
  }
  if (job.contract_sent_at) {
    entries.push({ at: job.contract_sent_at, label: 'Contract sent', href: contractPathFor(job) });
  }
  if (job.invoice_status !== 'not_sent' && job.invoiced_at) {
    entries.push({ at: job.invoiced_at, label: `Invoice sent (${job.invoice_status === 'paid' ? 'now paid' : 'awaiting payment'})`, href: `/jobs/${jobId}/invoice` });
  }
  updates.forEach(u => {
    if (u.sent_at) {
      entries.push({ at: u.sent_at, label: `Progress update sent (${u.update_date})`, href: `/jobs/${jobId}/updates/${u.id}` });
    }
  });
  changeOrders.forEach(co => {
    if (co.sent_at) {
      entries.push({ at: co.sent_at, label: `Change order sent (${co.co_date})`, href: `/jobs/${jobId}/change-orders/${co.id}` });
    }
  });

  entries.sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="card">
      <h3>Communications log</h3>

      <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
        <div className="update-field-label">Customer portal activity</div>
        <p style={{ fontSize: 13, margin: '4px 0 0' }}>
          {job.portal_invited_at
            ? `Invited on ${new Date(job.portal_invited_at).toLocaleDateString('en-US')}.`
            : 'Not invited to the portal yet.'}
          {' '}
          {job.portal_last_viewed_at
            ? `Last viewed the portal on ${new Date(job.portal_last_viewed_at).toLocaleString('en-US')}.`
            : (job.portal_invited_at ? 'Has not viewed the portal yet.' : '')}
        </p>
      </div>

      {entries.length === 0 && <div className="empty-state">Nothing sent yet.</div>}
      {entries.map((e, i) => (
        <div className="update-entry" key={i}>
          <div className="update-date">{new Date(e.at).toLocaleString('en-US')}</div>
          <p style={{ margin: 0 }}>{e.label}</p>
          {e.href && (
            <div className="section-actions">
              <Link href={e.href} className="btn btn-sm">View</Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StageStepper({ currentStage }) {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const currentPhase = PHASES.find(p => p.stages.includes(currentStage)) || PHASES[0];
  return (
    <div className="stepper stepper-flat">
      {currentPhase.stages.map(stage => {
        const stageIndex = STAGE_ORDER.indexOf(stage);
        const isCurrent = stage === currentStage;
        const isPast = stageIndex < currentIndex;
        return (
          <div key={stage} className={`stepper-stage ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}`}>
            {STAGE_LABELS[stage]}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Customer portal invite + questions ---------------- */
function PortalCard({ job }) {
  const [questions, setQuestions] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingId, setReplyingId] = useState(null);

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase.from('job_questions').select('*').eq('job_id', job.id).order('created_at', { ascending: false });
    if (data) setQuestions(data);
  }, [job.id]);

  useEffect(() => {
    loadQuestions();
    const channel = supabase
      .channel(`portal-questions-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_questions', filter: `job_id=eq.${job.id}` }, loadQuestions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job.id, loadQuestions]);

  async function sendReply(questionId) {
    const text = replyDrafts[questionId] || '';
    if (!text.trim()) return;
    await supabase.from('job_questions').update({ response: text, responded_at: new Date().toISOString() }).eq('id', questionId);
    setReplyingId(null);
  }

  if (questions.length === 0) return null;

  return (
    <div className="card">
      <h3>Customer portal</h3>

      {questions.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 10px' }}>Customer questions</h4>
          {questions.map(q => (
            <div className="update-entry" key={q.id}>
              <div className="update-date">{new Date(q.created_at).toLocaleDateString('en-US')}</div>
              <p>{q.message}</p>
              {q.response ? (
                <>
                  <div className="update-field-label">Your reply</div>
                  <p>{q.response}</p>
                </>
              ) : replyingId === q.id ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={replyDrafts[q.id] || ''}
                    onChange={e => setReplyDrafts(prev => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="Type your reply…"
                  />
                  <div className="section-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => sendReply(q.id)}>Send reply</button>
                    <button className="btn btn-sm" onClick={() => setReplyingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="section-actions">
                  <button className="btn btn-sm" onClick={() => setReplyingId(q.id)}>Reply</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function CustomerInfoCard({ job, onSave }) {
  const [form, setForm] = useState({
    customer_name: job.customer_name || '',
    customer_contact: job.customer_contact || '',
    customer_email: job.customer_email || '',
    customer_phone: job.customer_phone || '',
    billing_email: job.billing_email || '',
    billing_street: job.billing_street || '', billing_unit: job.billing_unit || '', billing_city: job.billing_city || '', billing_state: job.billing_state || '', billing_zip: job.billing_zip || '',
    project_street: job.project_street || '', project_unit: job.project_unit || '', project_city: job.project_city || '', project_state: job.project_state || '', project_zip: job.project_zip || '',
  });
  const [sameAsBilling, setSameAsBilling] = useState(
    Boolean(job.billing_street) && job.billing_street === job.project_street && job.billing_city === job.project_city
  );

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (sameAsBilling && field.startsWith('billing_') && field !== 'billing_email') {
        next[field.replace('billing_', 'project_')] = value;
      }
      return next;
    });
  }
  function toggleSameAsBilling(checked) {
    setSameAsBilling(checked);
    if (checked) {
      setForm(prev => ({
        ...prev,
        project_street: prev.billing_street, project_unit: prev.billing_unit,
        project_city: prev.billing_city, project_state: prev.billing_state, project_zip: prev.billing_zip,
      }));
    }
  }
  function save() {
    onSave({
      ...form,
      billing_address: formatAddress(form, 'billing'),
      project_address: formatAddress(form, 'project'),
    });
  }

  return (
    <div className="card">
      <h3>Customer</h3>
      <div className="two-col">
        <div><label>Customer / company name</label><input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} /></div>
        <div><label>Contact person</label><input value={form.customer_contact} onChange={e => update('customer_contact', e.target.value)} /></div>
        <div><label>Contact email</label><input value={form.customer_email} onChange={e => update('customer_email', e.target.value)} /></div>
        <div><label>Contact phone</label><input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} /></div>
        <div><label>Billing email</label><input value={form.billing_email} onChange={e => update('billing_email', e.target.value)} /></div>
      </div>

      <label style={{ marginTop: 16 }}>Billing address</label>
      <AddressFields prefix="billing" values={form} onChange={update} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
        Project address same as billing address
      </label>
      <label>Project / jobsite address</label>
      <AddressFields prefix="project" values={form} onChange={update} />

      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save customer info</button>
      </div>
    </div>
  );
}

/* ---------------- Project tab: overview ---------------- */
function ProjectInfoCard({ job, onSave }) {
  const [form, setForm] = useState({
    job_type: job.job_type || '',
    expected_close_date: job.expected_close_date || '',
    description: job.description || '',
    governing_state: job.governing_state || 'Missouri',
    project_type: job.project_type || 'residential',
  });
  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function save() {
    const patch = { ...form };
    // Filling in the scheduled start date while a job is Approved moves it to Scheduled automatically.
    if (job.stage === 'approved' && !job.expected_close_date && form.expected_close_date) {
      patch.stage = 'scheduled';
    }
    onSave(patch);
  }

  return (
    <div className="card">
      <h3>Project overview</h3>
      <div className="two-col">
        <div>
          <label>Project type</label>
          <select value={form.project_type} onChange={e => update('project_type', e.target.value)}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
        <div><label>Job type</label><input value={form.job_type} onChange={e => update('job_type', e.target.value)} placeholder="e.g. Kitchen remodel" /></div>
        <div>
          <label>{job.stage === 'new' || job.stage === 'inspected' || job.stage === 'proposal_delivered' ? 'Expected close date' : 'Scheduled start date'}</label>
          <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
        </div>
        <div>
          <label>Governing state</label>
          <select value={form.governing_state} onChange={e => update('governing_state', e.target.value)}>
            <option value="Missouri">Missouri</option>
            <option value="Kansas">Kansas</option>
          </select>
        </div>
      </div>
      <label>Description</label>
      <textarea value={form.description} onChange={e => update('description', e.target.value)} />
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save project overview</button>
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
      <AIScopeGenerator
        projectType={job.project_type}
        onGenerate={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])}
      />
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

/* ---------------- Assumptions & exclusions ---------------- */
function TermsCard({ job, onSave }) {
  const existing = (job.additional_terms || []).map(i => i.text || '');
  const [items, setItems] = useState(existing.length ? existing : standardListFor(job.project_type));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ additional_terms: items.filter(t => t.trim()).map(text => ({ text })) }); }
  function restoreStandard() {
    const standard = standardListFor(job.project_type);
    setItems(prev => {
      const existingSet = new Set(prev.map(t => t.trim()));
      const toAdd = standard.filter(t => !existingSet.has(t.trim()));
      return [...prev, ...toAdd];
    });
  }

  return (
    <div className="card">
      <h3>Project Assumptions &amp; Exclusions</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
        Standard list matches this job's project type ({job.project_type === 'commercial' ? 'Commercial' : 'Residential'}) — change project type on the Project tab if needed.
      </div>
      {items.length === 0 && <div className="empty-state">None added.</div>}
      {items.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => update(i, e.target.value)} />
          <button className="row-remove" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={add}>+ Add item</button>
        <button className="btn btn-sm" onClick={restoreStandard}>↺ Restore standard list</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save assumptions &amp; exclusions</button>
      </div>
    </div>
  );
}

/* ---------------- Documents tab ---------------- */
function DocumentsCard({ jobId, job }) {
  const relevantDocs = STAGE_DOCS[job.stage] || [];
  const isActivePhase = phaseForStage(job.stage) === 'active_phase';
  const DOC_META = {
    proposal: { label: 'Proposal', href: `/jobs/${jobId}/proposal` },
    contract: { label: 'Contract', href: contractPathFor(job) },
    invoice: { label: 'Invoice', href: `/jobs/${jobId}/invoice` },
    update: { label: 'Project Update (post one below)', href: null },
  };

  if (isActivePhase) {
    return (
      <div className="card">
        <h3>Documents</h3>
        <Link href={contractPathFor(job)} className="btn btn-sm">View signed contract</Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Documents</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Documents available at this stage:
      </div>
      <div className="section-actions" style={{ marginTop: 0 }}>
        {relevantDocs.map(docType => {
          const meta = DOC_META[docType];
          if (!meta.href) return null;
          return <Link key={docType} href={meta.href} className="btn btn-primary">{meta.label} — Generate PDF</Link>;
        })}
      </div>
      {relevantDocs.includes('update') && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10 }}>
          Project updates are posted and generated individually below.
        </div>
      )}
      {!relevantDocs.includes('contract') && phaseForStage(job.stage) !== 'opportunity' && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <Link href={contractPathFor(job)} className="btn btn-sm">View signed contract</Link>
        </div>
      )}
    </div>
  );
}

/* ---------------- Change orders ---------------- */
function ChangeOrdersCard({ jobId, changeOrders }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', co_date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit() {
    setSaving(true);
    await supabase.from('change_orders').insert({
      job_id: jobId,
      description: form.description,
      amount: form.amount ? parseFloat(String(form.amount).replace(/[^0-9.]/g, '')) : null,
      co_date: form.co_date,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ description: '', amount: '', co_date: new Date().toISOString().slice(0, 10) });
  }

  async function removeCo(coId) {
    if (!confirm('Delete this change order?')) return;
    await supabase.from('change_orders').delete().eq('id', coId);
  }

  return (
    <div className="card">
      <h3>Change orders</h3>

      {showForm ? (
        <div>
          <label>Description of change</label>
          <textarea value={form.description} onChange={e => update('description', e.target.value)} />
          <div className="two-col">
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} placeholder="e.g. 1,200" /></div>
            <div><label>Date</label><input type="date" value={form.co_date} onChange={e => update('co_date', e.target.value)} /></div>
          </div>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create change order'}</button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ New change order</button>
        </div>
      )}

      {changeOrders.length === 0 && <div className="empty-state">No change orders yet.</div>}
      {changeOrders.map(co => (
        <div className="update-entry" key={co.id}>
          <div className="update-date">{co.co_date} — {co.amount ? '$' + Number(co.amount).toLocaleString('en-US') : '—'}</div>
          {co.description && <p>{co.description}</p>}
          <div className="section-actions">
            <Link href={`/jobs/${jobId}/change-orders/${co.id}`} className="btn btn-sm">View / print</Link>
            <button className="btn btn-sm btn-danger" onClick={() => removeCo(co.id)}>Delete</button>
          </div>
        </div>
      ))}
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
          <div className="update-field-label" style={{ marginTop: 10 }}>Photos</div>
          <PhotoGallery jobId={jobId} updateId={u.id} bare />
          <div className="section-actions">
            <Link href={`/jobs/${jobId}/updates/${u.id}`} className="btn btn-sm">Generate PDF</Link>
            <button className="btn btn-sm btn-danger" onClick={() => removeUpdate(u.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Invoice ---------------- */
function InvoiceCard({ job, onSave, jobId }) {
  const router = useRouter();
  const [amount, setAmount] = useState(job.invoice_amount ?? job.contract_price ?? '');
  const [status, setStatus] = useState(job.invoice_status || 'not_sent');
  const [invoicedAt, setInvoicedAt] = useState(job.invoiced_at ? job.invoiced_at.slice(0, 10) : '');

  function onStatusChange(newStatus) {
    setStatus(newStatus);
    if ((newStatus === 'sent' || newStatus === 'paid') && !invoicedAt) {
      setInvoicedAt(new Date().toISOString().slice(0, 10));
    }
    if (newStatus === 'not_sent') {
      setInvoicedAt('');
    }
  }

  function saveOnly() {
    onSave({
      invoice_amount: amount ? parseFloat(String(amount).replace(/[^0-9.]/g, '')) : null,
      invoice_status: status,
      invoiced_at: invoicedAt || null,
    });
  }

  function generateInvoice() {
    saveOnly();
    router.push(`/jobs/${jobId}/invoice`);
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
          <select value={status} onChange={e => onStatusChange(e.target.value)}>
            <option value="not_sent">Not sent</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>
      <label>Invoiced date {status === 'not_sent' ? '' : '(auto-set — edit if needed)'}</label>
      <input type="date" value={invoicedAt} onChange={e => setInvoicedAt(e.target.value)} disabled={status === 'not_sent'} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
        Only counts toward the dashboard's "Invoiced this year" total once status is Sent or Paid.
      </div>
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={generateInvoice}>Generate Invoice</button>
      </div>
    </div>
  );
}
