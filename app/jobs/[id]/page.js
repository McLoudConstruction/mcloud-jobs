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
import TradeBreakdownCard from '../../../components/TradeBreakdownCard';
import PortalAccessCard from '../../../components/PortalAccessCard';
import EstimateTab from '../../../components/EstimateTab';
import { assignNextJobNumber } from '../../../lib/assignJobNumber';
import MaterialSelectionsCard from '../../../components/MaterialSelectionsCard';
import ProjectMilestonesCard from '../../../components/ProjectMilestonesCard';
import AddressFields, { formatAddress } from '../../../components/AddressFields';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL, STAGE_ORDER, STAGE_LABELS, phaseForStage, contractPathFor, formattedProjectNumber, isOpportunity } from '../../../lib/constants';

const TABS = [
  { key: 'Overview', label: 'Overview' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Estimate', label: 'Estimate' },
  { key: 'Financials', label: 'Financials' },
  { key: 'Photos', label: 'Photos' },
  { key: 'Documents', label: 'Documents' },
  { key: 'Portal', label: 'Portal Access' },
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
  const [tab, setTab] = useState('Overview');

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

  // Recovery path for a job that's already past Approved but somehow
  // never got a job number — shown as a fix-it banner rather than
  // something that has to be chased down through the database directly.
  async function fixMissingJobNumber() {
    try {
      const jobNumber = await assignNextJobNumber();
      await saveJob({ job_number: jobNumber });
    } catch (err) {
      setFlash(`Could not assign a job number: ${err.message}`);
      setTimeout(() => setFlash(''), 8000);
    }
  }

  async function saveJob(patch) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', id);
    if (!error) {
      flashSaved();
    } else {
      setFlash(`Save failed: ${error.message}`);
      setTimeout(() => setFlash(''), 6000);
    }
  }

  async function advanceStage() {
    const idx = STAGE_ORDER.indexOf(job.stage);
    if (idx >= STAGE_ORDER.length - 1) return;
    const next = STAGE_ORDER[idx + 1];
    if (!confirm(`Move this job from ${STAGE_LABELS[job.stage]} to ${STAGE_LABELS[next]}?`)) return;

    const patch = { stage: next, ...(next === 'approved' && !job.approved_at ? { approved_at: new Date().toISOString() } : {}) };

    if (next === 'approved' && !job.job_number) {
      try {
        patch.job_number = await assignNextJobNumber();
      } catch (err) {
        setFlash(`Could not assign a job number: ${err.message}. Stage was not changed — try again.`);
        setTimeout(() => setFlash(''), 8000);
        return; // don't advance the stage without a job number — that's the exact stuck state we're trying to prevent
      }
    }
    await saveJob(patch);

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

        {!isOpportunity(job) && !job.job_number && (
          <div className="card" style={{ borderColor: '#c0524f', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13 }}>
                <b style={{ color: '#c0524f' }}>This job is past Approved but never got a real Job Number.</b>
                <div style={{ color: 'var(--ink-soft)', fontSize: 12, marginTop: 2 }}>That shouldn't happen — click to assign one now.</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={fixMissingJobNumber}>Assign Job Number Now</button>
            </div>
          </div>
        )}

        <div className="top-actions">
          <div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{formattedProjectNumber(job)} — {job.customer_name || 'Unnamed customer'}</h2>
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


        <div className="stage-tabs">
          {TABS.map(t => (
            <button key={t.key} className={`stage-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === 'Overview' && (
          <div className="overview-thirds">
            <CustomerInfoCard job={job} onSave={saveJob} />
            <ProjectInfoCard job={job} onSave={saveJob} />
            <ProjectMilestonesCard job={job} jobId={id} onTabChange={setTab} />
          </div>
        )}

        {tab === 'Portal' && (
          <>
            <PortalAccessCard job={job} jobId={id} onLinkProperty={(propertyId) => saveJob({ property_id: propertyId })} />
            <NotificationSettingsCard job={job} onSave={saveJob} />
          </>
        )}

        {tab === 'Scope' && (
          <div className="estimate-grid">
            <div className="estimate-main">
              <ScopeCard job={job} jobId={id} onSave={saveJob} />
              <MaterialSelectionsCard jobId={id} />
              <TermsCard job={job} onSave={saveJob} />
            </div>
            <div className="estimate-sidebar">
              <TradeBreakdownCard jobId={id} />
            </div>
          </div>
        )}

        {tab === 'Estimate' && (
          <EstimateTab job={job} jobId={id}>
            <PriceCard job={job} onSave={saveJob} />
          </EstimateTab>
        )}

        {tab === 'Financials' && (
          <div className="estimate-grid">
            <div className="estimate-main">
              <JobCostSummary jobId={id} contractPrice={job.contract_price} projectedCost={job.projected_cost} />
              <WorkOrdersCard jobId={id} scopeItems={(job.scope_items || []).map(s => s.text || '').filter(Boolean)} projectAddress={job.project_address} />
              {phaseForStage(job.stage) !== 'opportunity' && (
                <ChangeOrdersCard jobId={id} changeOrders={changeOrders} />
              )}
            </div>
            <div className="estimate-sidebar">
              <ReceiptsCard jobId={id} />
              <DrawsCard jobId={id} />
              {(job.stage === 'completed' || job.stage === 'invoiced' || job.stage === 'paid') && (
                <InvoiceCard job={job} onSave={saveJob} jobId={id} />
              )}
            </div>
          </div>
        )}

        {tab === 'Photos' && (
          <PhotoGallery jobId={id} title="Job Photos" />
        )}

        {tab === 'Documents' && (
          <>
            <IssuedDocumentsCard jobId={id} job={job} updates={updates} changeOrders={changeOrders} />
            {phaseForStage(job.stage) !== 'opportunity' && (
              <UpdatesCard jobId={id} updates={updates} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ---------------- Documents tab: real history, only what's issued ---------------- */
function IssuedDocumentsCard({ jobId, job, updates, changeOrders }) {
  const [draws, setDraws] = useState([]);
  const [selections, setSelections] = useState([]);

  useEffect(() => {
    const load = () => supabase.from('invoices').select('*').eq('job_id', jobId).then(({ data }) => { if (data) setDraws(data); });
    load();
    const loadSelections = () => supabase.from('material_selections').select('*').eq('job_id', jobId).not('sent_at', 'is', null).then(({ data }) => { if (data) setSelections(data); });
    loadSelections();
    const channel = supabase.channel(`issued-docs-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, loadSelections)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId]);

  const entries = [];

  if (job.proposal_sent_at) {
    entries.push({ at: job.proposal_sent_at, label: 'Estimate', href: `/jobs/${jobId}/proposal` });
  }
  if (job.contract_finalized_at) {
    entries.push({ at: job.contract_finalized_at, label: 'Contract — signed', href: contractPathFor(job) });
  }
  draws.filter(d => d.status !== 'not_sent').forEach(d => {
    entries.push({ at: d.sent_at || d.created_at, label: `${d.description} (${d.status === 'paid' ? 'paid' : 'awaiting payment'})`, href: `/jobs/${jobId}/invoices/${d.id}` });
  });
  if (job.invoice_status && job.invoice_status !== 'not_sent' && job.invoiced_at) {
    entries.push({ at: job.invoiced_at, label: `Invoice (${job.invoice_status === 'paid' ? 'paid' : 'awaiting payment'})`, href: `/jobs/${jobId}/invoice` });
  }
  updates.forEach(u => {
    if (u.sent_at) entries.push({ at: u.sent_at, label: `Progress update — ${u.update_date}`, href: `/jobs/${jobId}/updates/${u.id}` });
  });
  changeOrders.forEach(co => {
    if (co.sent_at) entries.push({ at: co.sent_at, label: `Change order — ${co.co_date}`, href: `/jobs/${jobId}/change-orders/${co.id}` });
  });
  selections.forEach(s => {
    entries.push({ at: s.sent_at, label: `Material selection — ${s.title}${s.status === 'approved' ? ' (approved)' : ''}`, href: `/jobs/${jobId}/material-selections/${s.id}` });
  });

  entries.sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="card">
      <h3>Documents</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Only what's actually been issued shows up here — an estimate before it's sent, or an invoice before it's issued, won't appear.
      </div>
      {entries.length === 0 && <div className="empty-state">Nothing issued yet.</div>}
      {entries.map((e, i) => (
        <div className="update-entry" key={i}>
          <div className="update-date">{new Date(e.at).toLocaleString('en-US')}</div>
          <p style={{ margin: 0 }}>{e.label}</p>
          <div className="section-actions">
            <Link href={e.href} className="btn btn-sm">View</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Customer portal invite + questions ---------------- */
function NotificationSettingsCard({ job, onSave }) {
  const [optedOut, setOptedOut] = useState(null); // null = loading/no contact found
  const [contactId, setContactId] = useState(null);
  const [newDay, setNewDay] = useState('');
  const [days, setDays] = useState(job.schedule_reminder_days || [7, 1]);

  useEffect(() => {
    if (!job.customer_email) { setOptedOut(null); return; }
    supabase.from('contacts').select('id, automated_emails_opt_out').eq('contact_email', job.customer_email).maybeSingle().then(({ data }) => {
      if (data) { setContactId(data.id); setOptedOut(data.automated_emails_opt_out); }
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
      <AddressFields prefix="billing" values={form} onChange={update} placesEnabled />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
        Project address same as billing address
      </label>
      <label>Project / jobsite address</label>
      <AddressFields prefix="project" values={form} onChange={update} placesEnabled />

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
    scheduled_start_date: job.scheduled_start_date || '',
    scheduled_end_date: job.scheduled_end_date || '',
    description: job.description || '',
    governing_state: job.governing_state || 'Missouri',
    project_type: job.project_type || 'residential',
  });
  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function save() {
    const patch = { ...form };
    // Setting a scheduled start date while a job is Approved moves it to Scheduled automatically.
    if (job.stage === 'approved' && !job.scheduled_start_date && form.scheduled_start_date) {
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
          <label>Expected close date</label>
          <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
        </div>
        <div>
          <label>Scheduled start date</label>
          <input type="date" value={form.scheduled_start_date} onChange={e => update('scheduled_start_date', e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            Triggers automatic reminder emails to the customer 1 week and 1 day before this date.
          </div>
        </div>
        <div>
          <label>Scheduled end date</label>
          <input type="date" value={form.scheduled_end_date} onChange={e => update('scheduled_end_date', e.target.value)} min={form.scheduled_start_date || undefined} />
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            Used to draw this job's bar on the Calendar.
          </div>
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
function ScopeCard({ job, jobId, onSave }) {
  const [items, setItems] = useState((job.scope_items || []).map(i => i.text || ''));

  function add() { setItems(prev => [...prev, '']); }
  function update(i, v) { setItems(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function remove(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }
  function save() { onSave({ scope_items: items.filter(t => t.trim()).map(text => ({ text })) }); }

  async function saveTradeActions(tradeActions) {
    await supabase.from('job_scope_actions').insert(tradeActions.map(a => ({ ...a, job_id: jobId })));
  }

  return (
    <>
      <div className="card">
        <h3>Scope of work</h3>
        <AIScopeGenerator
          projectType={job.project_type}
          jobId={jobId}
          onGenerate={(newItems) => setItems(prev => [...prev.filter(t => t.trim()), ...newItems])}
          onTradeActions={saveTradeActions}
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
    </>
  );
}

/* ---------------- Contract price + milestones ---------------- */
function PriceCard({ job, onSave }) {
  const [price, setPrice] = useState(job.contract_price ?? '');
  const [projectedCost, setProjectedCost] = useState(job.projected_cost ?? '');
  const [approvedDate, setApprovedDate] = useState(job.approved_at ? job.approved_at.slice(0, 10) : '');
  const [milestones, setMilestones] = useState(job.milestones || []);

  function add() { setMilestones(prev => [...prev, { desc: '', amount: '' }]); }
  function update(i, field, v) { setMilestones(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: v } : m)); }
  function remove(i) { setMilestones(prev => prev.filter((_, idx) => idx !== i)); }
  function save() {
    onSave({
      contract_price: price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) : null,
      projected_cost: projectedCost ? parseFloat(String(projectedCost).replace(/[^0-9.]/g, '')) : null,
      approved_at: approvedDate ? new Date(approvedDate + 'T12:00:00').toISOString() : null,
      milestones,
    });
  }

  return (
    <div className="card">
      <h3>Contract price &amp; payment schedule</h3>
      <label>Total contract price ($)</label>
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 185,000" />
      <label style={{ marginTop: 12 }}>Projected cost ($)</label>
      <input value={projectedCost} onChange={e => setProjectedCost(e.target.value)} placeholder="What you expect this job to cost, all-in" />
      <label style={{ marginTop: 12 }}>Approved date</label>
      <input type="date" value={approvedDate} onChange={e => setApprovedDate(e.target.value)} />
      <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
        Drives which month this job's contract price counts as Revenue on the Financial Dashboard. Set automatically when the job first moves to Approved — edit here if it's wrong.
      </div>
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
        <button className="btn btn-sm" onClick={saveOnly}>Save</button>
      </div>
    </div>
  );
}
