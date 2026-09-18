'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '../../../lib/useAuth';
import { supabase } from '../../../lib/supabaseClient';
import AppShell from '../../../components/AppShell';
import { RFP_STATUS_LABELS, projectNumber, projectNumberLabel } from '../../../lib/constants';

// RFPs are meant to go out before a project is approved, while it's
// still an Estimate/Opportunity (job_number is null at that stage —
// only estimate_number is set). projectLabel() uses the same
// isOpportunity()/projectNumber()/projectNumberLabel() convention as
// the rest of the app so this never drifts from how job numbers are
// shown everywhere else.
function projectLabel(job) {
  if (!job) return '';
  const num = projectNumber(job);
  return num && num !== '—' ? `${projectNumberLabel(job)} #${num} — ` : '';
}
import { buildRfpEmail } from '../../../lib/emailTemplates';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function RfpsPage() {
  const { session, loading } = useRequireAuth();
  const [rfps, setRfps] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [{ data: rfpData }, { data: jobData }, { data: companyData }] = await Promise.all([
      supabase.from('rfps').select('*, jobs(job_number, estimate_number, stage, project_address), rfp_recipients(id, status)').order('created_at', { ascending: false }),
      supabase.from('jobs').select('id, job_number, estimate_number, stage, project_address').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, company_name, contact_email').eq('company_type', 'Subcontractor').order('company_name', { ascending: true }),
    ]);
    if (rfpData) setRfps(rfpData);
    if (jobData) setJobs(jobData);
    if (companyData) setCompanies(companyData);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const channel = supabase.channel('rfps-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfps' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between', display: 'flex' }}>
          <h2 style={{ margin: 0 }}>RFPs</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>New RFP</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Requests for proposal sent to subcontractors — kept separate from Work Orders so a sub never confuses an open bid with assigned work.
        </div>

        <div className="card">
          {rfps.length === 0 && <div className="empty-state">No RFPs yet.</div>}
          {rfps.map(r => {
            const recipients = r.rfp_recipients || [];
            const responded = recipients.filter(rr => rr.status === 'responded' || rr.status === 'awarded' || rr.status === 'not_awarded').length;
            return (
              <Link key={r.id} href={`/subcontractors/rfps/${r.id}`} className="list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                    {projectLabel(r.jobs)}{r.jobs?.project_address || 'No project linked'} · Sent {fmtDate(r.created_at)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                    {recipients.length} sub{recipients.length === 1 ? '' : 's'} · {responded} responded
                  </div>
                </div>
                <span className={`badge badge-${r.status}`}>{RFP_STATUS_LABELS[r.status]}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {creating && (
        <NewRfpModal
          jobs={jobs}
          companies={companies}
          session={session}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
    </AppShell>
  );
}

function NewRfpModal({ jobs, companies, session, onClose, onCreated }) {
  const [jobId, setJobId] = useState('');
  const [photos, setPhotos] = useState([]);
  const [signedUrls, setSignedUrls] = useState({});
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const folders = useMemo(() => {
    const set = new Set(photos.map(p => p.folder).filter(Boolean));
    return [...set].sort();
  }, [photos]);

  const loadPhotos = useCallback(async (id) => {
    setPhotos([]);
    setSelectedFolder('');
    setSelectedPhotoIds([]);
    if (!id) return;
    const { data } = await supabase.from('job_photos').select('*').eq('job_id', id).not('folder', 'is', null).order('created_at', { ascending: false });
    if (data) {
      setPhotos(data);
      const entries = await Promise.all(
        data.map(async p => {
          const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
          return [p.id, signed?.signedUrl];
        })
      );
      setSignedUrls(Object.fromEntries(entries));
    }
  }, []);

  function handleJobChange(id) {
    setJobId(id);
    loadPhotos(id);
  }

  function handleFolderSelect(folder) {
    setSelectedFolder(folder);
    setSelectedPhotoIds(photos.filter(p => p.folder === folder).map(p => p.id));
  }

  function togglePhoto(id) {
    setSelectedPhotoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleCompany(id) {
    setSelectedCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    setError('');
    if (!jobId) { setError('Pick a project.'); return; }
    if (!title.trim()) { setError('Give the RFP a title.'); return; }
    if (selectedCompanyIds.length === 0) { setError('Select at least one subcontractor to send this to.'); return; }
    setSaving(true);
    const { data: rfp, error: insertErr } = await supabase.from('rfps').insert({
      job_id: jobId,
      title: title.trim(),
      description: description.trim() || null,
      source_folder: selectedFolder || null,
      photo_ids: selectedPhotoIds,
      created_by: session.user.id,
    }).select().single();
    if (insertErr || !rfp) { setError(insertErr?.message || 'Failed to create RFP.'); setSaving(false); return; }

    const { error: recipientErr } = await supabase.from('rfp_recipients').insert(
      selectedCompanyIds.map(company_id => ({ rfp_id: rfp.id, company_id }))
    );
    if (recipientErr) { setSaving(false); setError(recipientErr.message); return; }

    // Best-effort, same pattern as issuing a work order — the RFP is
    // already created and visible in the Sub Portal regardless of
    // whether the notification email goes through.
    const projectAddress = jobs.find(j => j.id === jobId)?.project_address;
    for (const companyId of selectedCompanyIds) {
      const company = companies.find(c => c.id === companyId);
      if (!company?.contact_email) continue;
      try {
        const { subject, html, text } = buildRfpEmail({
          companyName: company.company_name,
          title: title.trim(),
          description: description.trim() || null,
          projectAddress,
        });
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: company.contact_email, subject, html, text, category: 'rfp_sent', jobId, sentBy: session?.user?.email || null }),
        });
      } catch {
        // best-effort — see above
      }
    }

    setSaving(false);
    onCreated();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" style={closeButtonStyle}>×</button>
        <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>New RFP</h3>

        <label>Project</label>
        <select value={jobId} onChange={e => handleJobChange(e.target.value)}>
          <option value="">Select a project…</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{projectLabel(j)}{j.project_address}</option>)}
        </select>

        <label style={{ marginTop: 12 }}>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Framing — 123 Main St" />

        <label style={{ marginTop: 12 }}>Description (optional)</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Scope, timeline, anything a sub needs to bid this." />

        {jobId && folders.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>Source folder (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {folders.map(f => (
                <button
                  key={f}
                  type="button"
                  className={`btn btn-sm ${selectedFolder === f ? 'btn-primary' : ''}`}
                  onClick={() => handleFolderSelect(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </>
        )}

        {jobId && photos.length > 0 && (
          <>
            <label>Photos to include ({selectedPhotoIds.length} selected)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
              {photos.map(p => (
                <div
                  key={p.id}
                  onClick={() => togglePhoto(p.id)}
                  style={{ position: 'relative', cursor: 'pointer', border: selectedPhotoIds.includes(p.id) ? '2px solid var(--rust)' : '2px solid transparent', borderRadius: 4, overflow: 'hidden' }}
                >
                  {signedUrls[p.id] && <img src={signedUrls[p.id]} alt="" style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }} />}
                </div>
              ))}
            </div>
          </>
        )}
        {jobId && photos.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 8 }}>No categorized photos on this project yet.</div>
        )}

        <label style={{ marginTop: 12 }}>Send to</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {companies.map(c => (
            <button
              key={c.id}
              type="button"
              className={`btn btn-sm ${selectedCompanyIds.includes(c.id) ? 'btn-primary' : ''}`}
              onClick={() => toggleCompany(c.id)}
            >
              {c.company_name}
            </button>
          ))}
          {companies.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No subcontractors on file yet.</div>}
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="section-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>{saving ? 'Sending…' : 'Send RFP'}</button>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const closeButtonStyle = {
  position: 'absolute', top: 10, right: 14,
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 26, lineHeight: 1, color: 'var(--ink-soft)', padding: 4,
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  position: 'relative',
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 640,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto',
};
