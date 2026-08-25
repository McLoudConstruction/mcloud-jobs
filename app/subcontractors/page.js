'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields from '../../components/AddressFields';
import PopupModal from '../../components/PopupModal';
import DataTable from '../../components/DataTable';
import { formatPhone, SERVICES_OFFERED } from '../../lib/constants';
import { buildSubInviteEmail } from '../../lib/emailTemplates';

const SUBCONTRACTOR_TYPE = 'Subcontractor';

const EMPTY_FORM = {
  company_name: '', company_type: SUBCONTRACTOR_TYPE,
  street: '', unit: '', city: '', state: '', zip: '',
  contact_name: '', contact_phone: '', contact_email: '', crew_email: '', notes: '',
  w9_storage_path: '', coi_storage_path: '', coi_expires_at: '', services_offered: [],
};

const HEADER_MAP = {
  company_name: ['company', 'company name', 'name', 'subcontractor'],
  contact_name: ['contact', 'contact name'],
  contact_phone: ['phone', 'contact phone', 'phone number'],
  contact_email: ['email', 'contact email'],
  street: ['street', 'address', 'street address'],
  unit: ['unit', 'suite'],
  city: ['city'],
  state: ['state'],
  zip: ['zip', 'zip code', 'postal code'],
  notes: ['notes', 'note', 'comments'],
};
function normalizeHeader(h) { return (h || '').toString().trim().toLowerCase(); }
function mapRow(row) {
  const out = { company_type: SUBCONTRACTOR_TYPE };
  const keys = Object.keys(row);
  for (const [field, variants] of Object.entries(HEADER_MAP)) {
    const match = keys.find(k => variants.includes(normalizeHeader(k)));
    if (match && row[match] !== undefined && row[match] !== null) out[field] = String(row[match]).trim();
  }
  return out;
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function coiStatus(expiresAt) {
  if (!expiresAt) return <span style={{ color: 'var(--ink-soft)' }}>Not on file</span>;
  const days = Math.floor((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0) return <span style={{ color: '#a13f3f', fontWeight: 600 }}>Expired</span>;
  if (days <= 30) return <span style={{ color: '#a17c3f', fontWeight: 600 }}>Expires soon</span>;
  return <span style={{ color: '#3a6b45' }}>Current</span>;
}

function SubcontractorStats({ companyId }) {
  const [workOrders, setWorkOrders] = useState(null);

  useEffect(() => {
    let active = true;
    supabase.from('work_orders').select('*, jobs(job_number, project_address, customer_name)').eq('company_id', companyId).order('created_at', { ascending: false })
      .then(({ data }) => { if (active) setWorkOrders(data || []); });
    return () => { active = false; };
  }, [companyId]);

  if (workOrders === null) return <div className="card"><div className="empty-state">Loading history…</div></div>;

  const completedJobIds = new Set(workOrders.filter(wo => wo.status === 'paid').map(wo => wo.job_id));
  const lastFive = [];
  const seenJobs = new Set();
  for (const wo of workOrders) {
    if (wo.status === 'paid' && !seenJobs.has(wo.job_id)) {
      seenJobs.add(wo.job_id);
      lastFive.push(wo);
      if (lastFive.length >= 5) break;
    }
  }
  const outstanding = workOrders.filter(wo => ['issued', 'accepted', 'completed', 'invoiced'].includes(wo.status));
  const outstandingTotal = outstanding.reduce((s, wo) => s + Number(wo.invoiced_amount ?? wo.amount ?? 0), 0);

  return (
    <div className="card">
      <h3>History with McLoud Construction</h3>
      <div className="portal-info-grid" style={{ marginBottom: 16 }}>
        <div>
          <div className="portal-info-label">Jobs Completed</div>
          <div className="portal-info-value">{completedJobIds.size}</div>
        </div>
        <div>
          <div className="portal-info-label">Outstanding Invoices</div>
          <div className="portal-info-value">{outstanding.length}</div>
        </div>
        <div>
          <div className="portal-info-label">Outstanding Amount</div>
          <div className="portal-info-value">{fmtMoney(outstandingTotal)}</div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 6 }}>Last 5 completed projects</div>
      {lastFive.length === 0 && <div className="empty-state">No completed projects yet.</div>}
      {lastFive.map(wo => (
        <div key={wo.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
          {wo.jobs ? `#${wo.jobs.job_number} — ${wo.jobs.project_address || wo.jobs.customer_name}` : 'Job details unavailable'}
        </div>
      ))}
    </div>
  );
}

export default function SubcontractorsPage() {
  const { session, loading } = useRequireAuth();
  const [subs, setSubs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState('');
  const [uploadingW9, setUploadingW9] = useState(false);
  const [uploadingCoi, setUploadingCoi] = useState(false);
  const fileInputRef = useRef(null);

  const [applications, setApplications] = useState([]);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyEmail, setApplyEmail] = useState('');
  const [applyCompanyHint, setApplyCompanyHint] = useState('');
  const [applySending, setApplySending] = useState(false);
  const [applyResult, setApplyResult] = useState('');
  const [reviewingApp, setReviewingApp] = useState(null);
  const [approving, setApproving] = useState(false);

  function toggleService(service) {
    setForm(prev => ({
      ...prev,
      services_offered: (prev.services_offered || []).includes(service)
        ? prev.services_offered.filter(s => s !== service)
        : [...(prev.services_offered || []), service],
    }));
  }

  async function uploadDoc(file, kind) {
    if (!file || !editingId) return;
    const setUploading = kind === 'w9' ? setUploadingW9 : setUploadingCoi;
    const field = kind === 'w9' ? 'w9_storage_path' : 'coi_storage_path';
    setUploading(true);
    try {
      const path = `${editingId}/${kind}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('subcontractor-docs').upload(path, file);
      if (error) throw error;
      const oldPath = form[field];
      if (oldPath) await supabase.storage.from('subcontractor-docs').remove([oldPath]);
      await supabase.from('companies').update({ [field]: path }).eq('id', editingId);
      setForm(prev => ({ ...prev, [field]: path }));
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function viewDoc(path) {
    const { data } = await supabase.storage.from('subcontractor-docs').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  async function removeDoc(kind) {
    const field = kind === 'w9' ? 'w9_storage_path' : 'coi_storage_path';
    const path = form[field];
    if (!path || !editingId) return;
    if (!confirm(`Remove the ${kind.toUpperCase()} on file?`)) return;
    await supabase.storage.from('subcontractor-docs').remove([path]);
    await supabase.from('companies').update({ [field]: null }).eq('id', editingId);
    setForm(prev => ({ ...prev, [field]: '' }));
  }

  const loadSubs = useCallback(async () => {
    const { data } = await supabase.from('companies').select('*').eq('company_type', SUBCONTRACTOR_TYPE).order('company_name', { ascending: true });
    if (data) setSubs(data);
  }, []);

  const loadApplications = useCallback(async () => {
    const { data } = await supabase.from('subcontractor_applications').select('*').order('created_at', { ascending: false });
    if (data) setApplications(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadApplications();
    const channel = supabase.channel('subcontractor-applications').on('postgres_changes', { event: '*', schema: 'public', table: 'subcontractor_applications' }, loadApplications).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadApplications]);

  async function sendApplicationInvite(e) {
    e.preventDefault();
    if (!applyEmail.trim()) return;
    setApplySending(true);
    setApplyResult('');
    try {
      const { data: app, error } = await supabase.from('subcontractor_applications').insert({
        invited_email: applyEmail.trim(),
        invited_company_hint: applyCompanyHint.trim() || null,
        invited_by: session?.user?.email || null,
      }).select().single();
      if (error) throw error;

      const applyUrl = `${window.location.origin}/subcontractor-apply/${app.token}`;
      const { subject, html, text } = buildSubInviteEmail({ applyUrl, companyHint: applyCompanyHint.trim() });
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: applyEmail.trim(), subject, html, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send invite email.');

      setApplyResult(`Invite sent to ${applyEmail.trim()}.`);
      setApplyEmail('');
      setApplyCompanyHint('');
    } catch (err) {
      setApplyResult(`Failed: ${err.message}`);
    } finally {
      setApplySending(false);
    }
  }

  async function viewApplicationDoc(path) {
    const { data } = await supabase.storage.from('subcontractor-docs').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  async function approveApplication(app) {
    setApproving(true);
    try {
      const { data: company, error } = await supabase.from('companies').insert({
        company_name: app.company_name,
        company_type: SUBCONTRACTOR_TYPE,
        street: app.street, unit: app.unit, city: app.city, state: app.state, zip: app.zip,
        contact_name: app.contact_name, contact_phone: app.contact_phone, contact_email: app.contact_email,
        notes: app.notes,
        w9_storage_path: app.w9_storage_path,
        coi_storage_path: app.coi_storage_path,
        coi_expires_at: app.coi_expires_at,
        services_offered: app.services_offered,
      }).select().single();
      if (error) throw error;
      await supabase.from('subcontractor_applications').update({
        status: 'approved', reviewed_at: new Date().toISOString(), created_company_id: company.id,
      }).eq('id', app.id);
      setReviewingApp(null);
    } catch (err) {
      alert('Failed to approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  }

  async function declineApplication(app) {
    if (!confirm(`Decline ${app.company_name || app.invited_email}'s application?`)) return;
    await supabase.from('subcontractor_applications').update({ status: 'declined', reviewed_at: new Date().toISOString() }).eq('id', app.id);
    setReviewingApp(null);
  }

  useEffect(() => {
    if (!session) return;
    loadSubs();
    const channel = supabase.channel('subcontractors').on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, loadSubs).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadSubs]);

  function update(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) return;
    setSaving(true);
    const { w9_storage_path, coi_storage_path, ...rest } = form;
    const payload = { ...rest, company_type: SUBCONTRACTOR_TYPE, coi_expires_at: form.coi_expires_at || null };
    if (editingId) {
      await supabase.from('companies').update(payload).eq('id', editingId);
    } else {
      await supabase.from('companies').insert(payload);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(c) {
    setForm({ ...EMPTY_FORM, ...c, contact_phone: formatPhone(c.contact_phone), services_offered: c.services_offered || [] });
    setEditingId(c.id);
    setShowForm(true);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setInviteResult('');
  }

  async function removeSub(id) {
    if (!confirm('Delete this subcontractor?')) return;
    await supabase.from('companies').delete().eq('id', id);
  }

  async function invitePortal(c) {
    if (!c.contact_email) { setInviteResult('Add a contact email before inviting.'); return; }
    setInviting(true);
    setInviteResult('');
    const emails = [c.contact_email];
    if (c.crew_email && c.crew_email !== c.contact_email) emails.push(c.crew_email);
    for (const email of emails) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/sub-portal/dashboard` },
      });
      if (error) { setInviting(false); setInviteResult(`Failed to invite ${email}: ${error.message}`); return; }
    }
    await supabase.from('companies').update({ portal_invited_at: new Date().toISOString() }).eq('id', c.id);
    setInviting(false);
    setInviteResult(`Invited ${emails.join(' and ')}. Every future work order for this sub will show up automatically — no need to re-invite.`);
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const mapped = rows.map(mapRow).filter(c => c.company_name && c.company_name.trim());
      if (mapped.length === 0) {
        setImportResult('No rows with a recognizable company name column were found.');
        return;
      }
      const { error } = await supabase.from('companies').insert(mapped);
      if (error) throw error;
      setImportResult(`Imported ${mapped.length} subcontractor${mapped.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const filtered = subs.filter(c => !search.trim() || (c.company_name || '').toLowerCase().includes(search.toLowerCase()));

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Subcontractors</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import from Excel'}
            </button>
            <button className="btn" onClick={() => { setApplyModalOpen(true); setApplyResult(''); }}>+ Invite a Subcontractor</button>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add subcontractor</button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Company Name, Contact Name/Phone/Email, Street/Unit/City/State/Zip, Notes.
            </div>
          </div>
        )}

        <PopupModal open={showForm} onClose={cancelForm} maxWidth={920}>
            <h3>{editingId ? 'Edit subcontractor' : 'New subcontractor'}</h3>
            <form onSubmit={submit}>
            <div className="sub-popup-grid">
              <div className="sub-popup-main">
                <label>Company / subcontractor name *</label>
                <input value={form.company_name} onChange={e => update('company_name', e.target.value)} required />
                <label style={{ marginTop: 12 }}>Address</label>
                <AddressFields prefix="" values={form} onChange={update} placesEnabled />
                <div className="two-col" style={{ marginTop: 12 }}>
                  <div><label>Contact name</label><input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} /></div>
                  <div><label>Contact phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder="(555) 555-5555" /></div>
                  <div><label>Admin email (login)</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
                  <div><label>Crew email (optional, read-only login)</label><input type="email" value={form.crew_email} onChange={e => update('crew_email', e.target.value)} placeholder="shared crew inbox, if any" /></div>
                </div>
                <label style={{ marginTop: 12 }}>Notes</label>
                <textarea className="sub-popup-notes" value={form.notes} onChange={e => update('notes', e.target.value)} />
              </div>

              <div className="sub-popup-sidebar">
                {editingId && (
                  <div className="sub-popup-invite-row">
                    <button type="button" className="btn btn-sm" onClick={() => invitePortal(form)} disabled={inviting}>
                      {inviting ? 'Inviting…' : (form.portal_invited_at ? 'Re-send Portal Invite' : 'Invite to Subcontractor Portal')}
                    </button>
                  </div>
                )}
                <div className="sub-popup-sidebar-block">
                  <div className="sub-popup-sidebar-title">Compliance</div>
                  {editingId ? (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label>W9 on file</label>
                        {form.w9_storage_path ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn btn-sm" onClick={() => viewDoc(form.w9_storage_path)}>View</button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => removeDoc('w9')}>Remove</button>
                          </div>
                        ) : (
                          <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                            {uploadingW9 ? 'Uploading…' : 'Upload W9'}
                            <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} disabled={uploadingW9} onChange={e => uploadDoc(e.target.files[0], 'w9')} />
                          </label>
                        )}
                      </div>
                      <div>
                        <label>Certificate of Insurance</label>
                        {form.coi_storage_path ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn btn-sm" onClick={() => viewDoc(form.coi_storage_path)}>View</button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => removeDoc('coi')}>Remove</button>
                          </div>
                        ) : (
                          <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                            {uploadingCoi ? 'Uploading…' : 'Upload COI'}
                            <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} disabled={uploadingCoi} onChange={e => uploadDoc(e.target.files[0], 'coi')} />
                          </label>
                        )}
                      </div>
                      {form.coi_storage_path && (
                        <div style={{ marginTop: 10 }}>
                          <label>COI expiration date</label>
                          <input type="date" value={form.coi_expires_at || ''} onChange={e => update('coi_expires_at', e.target.value)} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Save this subcontractor first, then W9/COI can be uploaded here.</div>
                  )}
                </div>

                <div className="sub-popup-sidebar-block sub-popup-services-block">
                  <div className="sub-popup-sidebar-title">Services offered</div>
                  <div className="sub-popup-services">
                    {SERVICES_OFFERED.map(service => (
                      <label key={service} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 400, cursor: 'pointer', marginBottom: 5 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={(form.services_offered || []).includes(service)} onChange={() => toggleService(service)} />
                        {service}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save subcontractor')}</button>
            </div>
            {inviteResult && <div style={{ fontSize: 12, color: inviteResult.startsWith('Failed') ? '#a13f3f' : '#3a6b45', marginTop: 8 }}>{inviteResult}</div>}
            </form>
            {editingId && <div style={{ marginTop: 24 }}><SubcontractorStats companyId={editingId} /></div>}
        </PopupModal>

        <PopupModal open={applyModalOpen} onClose={() => setApplyModalOpen(false)} maxWidth={460}>
          <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Invite a Subcontractor</h3>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
            Send a link so a prospective subcontractor can submit their company info, W9, and COI themselves — no account needed.
            You'll review it here before they're added.
          </p>
          <form onSubmit={sendApplicationInvite}>
            <label>Email *</label>
            <input type="email" value={applyEmail} onChange={e => setApplyEmail(e.target.value)} required />
            <label style={{ marginTop: 10 }}>Company name (optional)</label>
            <input value={applyCompanyHint} onChange={e => setApplyCompanyHint(e.target.value)} placeholder="If you already know it" />
            {applyResult && <div style={{ fontSize: 12.5, marginTop: 10, color: applyResult.startsWith('Failed') ? '#a13f3f' : '#3a6b45' }}>{applyResult}</div>}
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={applySending}>{applySending ? 'Sending…' : 'Send Invite'}</button>
            </div>
          </form>
        </PopupModal>

        <PopupModal open={!!reviewingApp} onClose={() => setReviewingApp(null)} maxWidth={520}>
          {reviewingApp && (
            <div>
              <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{reviewingApp.company_name || reviewingApp.invited_email}</h3>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>Submitted application — review before adding as a subcontractor.</p>
              <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                <div><b>Contact:</b> {reviewingApp.contact_name} {reviewingApp.contact_email ? `(${reviewingApp.contact_email})` : ''} {reviewingApp.contact_phone}</div>
                <div><b>Address:</b> {[reviewingApp.street, reviewingApp.unit, reviewingApp.city, reviewingApp.state, reviewingApp.zip].filter(Boolean).join(', ') || '—'}</div>
                <div><b>Services:</b> {(reviewingApp.services_offered || []).join(', ') || '—'}</div>
                {reviewingApp.notes && <div><b>Notes:</b> {reviewingApp.notes}</div>}
                <div><b>COI expires:</b> {reviewingApp.coi_expires_at || '—'}</div>
              </div>
              <div className="section-actions">
                {reviewingApp.w9_storage_path && <button type="button" className="btn btn-sm" onClick={() => viewApplicationDoc(reviewingApp.w9_storage_path)}>View W9</button>}
                {reviewingApp.coi_storage_path && <button type="button" className="btn btn-sm" onClick={() => viewApplicationDoc(reviewingApp.coi_storage_path)}>View COI</button>}
              </div>
              <div className="section-actions" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <button className="btn btn-primary btn-sm" onClick={() => approveApplication(reviewingApp)} disabled={approving}>
                  {approving ? 'Adding…' : 'Approve & Add as Subcontractor'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => declineApplication(reviewingApp)}>Decline</button>
              </div>
            </div>
          )}
        </PopupModal>

        {applications.filter(a => a.status === 'invited' || a.status === 'submitted').length > 0 && (
          <div className="card">
            <h3>Pending Applications</h3>
            {applications.filter(a => a.status === 'invited' || a.status === 'submitted').map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                <div>
                  <b>{a.company_name || a.invited_company_hint || a.invited_email}</b>{' '}
                  <span style={{ color: 'var(--ink-soft)' }}>{a.invited_email}</span>
                  <span className={`badge badge-${a.status === 'submitted' ? 'active' : 'draft'}`} style={{ marginLeft: 10 }}>
                    {a.status === 'submitted' ? 'Submitted — needs review' : 'Invited — awaiting response'}
                  </span>
                </div>
                {a.status === 'submitted' && (
                  <button className="btn btn-sm" onClick={() => setReviewingApp(a)}>Review</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="search-bar">
          <input placeholder="Search subcontractors…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">No subcontractors yet.</div>}
        {filtered.length > 0 && (
          <DataTable
            getRowKey={c => c.id}
            onRowClick={startEdit}
            rows={filtered}
            columns={[
              { key: 'company_name', label: 'Name', defaultWidth: 220, render: c => c.company_name },
              { key: 'city', label: 'City', defaultWidth: 150, render: c => c.city || '—' },
              { key: 'contact_name', label: 'Contact Name', defaultWidth: 160, render: c => c.contact_name || '—' },
              { key: 'contact_phone', label: 'Phone', defaultWidth: 150, filterValue: c => formatPhone(c.contact_phone), render: c => c.contact_phone ? formatPhone(c.contact_phone) : '—' },
              { key: 'contact_email', label: 'Email', defaultWidth: 220, render: c => c.contact_email || '—' },
              { key: 'portal', label: 'Portal', defaultWidth: 110, filterable: false, render: c => c.portal_invited_at ? <span style={{ color: '#3a6b45', fontWeight: 600 }}>Invited</span> : <span style={{ color: 'var(--ink-soft)' }}>Not invited</span> },
              { key: 'coi', label: 'COI', defaultWidth: 130, filterable: false, render: c => coiStatus(c.coi_expires_at) },
              {
                key: 'actions', label: '', defaultWidth: 90, filterable: false, stopClickPropagation: true,
                render: c => <button className="btn btn-sm btn-danger" onClick={() => removeSub(c.id)}>Delete</button>,
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
