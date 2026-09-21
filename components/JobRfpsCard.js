'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { RFP_STATUS_LABELS } from '../lib/constants';
import { buildRfpEmail } from '../lib/emailTemplates';
import PopupModal from './PopupModal';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Same RFP feature as Subcontractors → RFPs, scoped to one job — this is
// where RFPs actually get created most of the time, since they're sent
// job by job. Lives behind its own header button (not a Financials
// section — RFPs aren't really financials yet) as a single popup that
// swaps between a list view and a create-new view, rather than a modal
// opening a second modal on top of it.
export default function JobRfpsPanel({ open, onClose, jobId, session, projectAddress }) {
  const [view, setView] = useState('list'); // 'list' | 'new'
  const [rfps, setRfps] = useState([]);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('rfps')
      .select('*, rfp_recipients(id, status)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    if (data) setRfps(data);
  }, [jobId]);

  useEffect(() => {
    if (!open) return;
    setView('list');
    load();
    const channel = supabase.channel(`job-rfps-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfps', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [open, jobId, load]);

  // Cascades to rfp_recipients (and any sub_messages tied to those
  // recipients) at the database level — see migration 113/115 — so a
  // plain delete on the RFP row is enough to clean up everything under it.
  async function handleRemove(e, rfpId) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Remove this RFP? Subs who were sent it will lose access, and this cannot be undone.')) return;
    setRemovingId(rfpId);
    const { error } = await supabase.from('rfps').delete().eq('id', rfpId);
    setRemovingId(null);
    if (error) {
      alert(`Failed to remove RFP: ${error.message}`);
      return;
    }
    load();
  }

  return (
    <PopupModal open={open} onClose={onClose} maxWidth={680}>
      {view === 'list' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ margin: 0, color: 'var(--heading)' }}>RFPs</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setView('new')} style={{ marginRight: 28 }}>New RFP</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '4px 0 14px' }}>
            Requests for proposal sent to subcontractors on this project — kept separate from Work Orders so a sub never confuses an open bid with assigned work.
          </div>

          {rfps.length === 0 && <div className="empty-state">No RFPs on this project yet.</div>}
          {rfps.map(r => {
            const recipients = r.rfp_recipients || [];
            const responded = recipients.filter(rr => rr.status === 'responded' || rr.status === 'awarded' || rr.status === 'not_awarded').length;
            return (
              <a key={r.id} href={`/subcontractors/rfps/${r.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                    Sent {fmtDate(r.created_at)}{r.expected_by ? ` · Expected by ${fmtDate(r.expected_by)}` : ''} · {recipients.length} sub{recipients.length === 1 ? '' : 's'} · {responded} responded
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge badge-${r.status}`}>{RFP_STATUS_LABELS[r.status]}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={e => handleRemove(e, r.id)}
                    disabled={removingId === r.id}
                  >
                    {removingId === r.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </a>
            );
          })}
        </>
      ) : (
        <NewRfpForm
          jobId={jobId}
          session={session}
          projectAddress={projectAddress}
          onBack={() => setView('list')}
          onCreated={() => { setView('list'); load(); }}
        />
      )}
    </PopupModal>
  );
}

function NewRfpForm({ jobId, session, projectAddress, onBack, onCreated }) {
  const [photos, setPhotos] = useState([]);
  const [signedUrls, setSignedUrls] = useState({});
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedBy, setExpectedBy] = useState('');
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const folders = useMemo(() => {
    const set = new Set(photos.map(p => p.folder).filter(Boolean));
    return [...set].sort();
  }, [photos]);

  useEffect(() => {
    (async () => {
      const [{ data: photoData }, { data: companyData }] = await Promise.all([
        supabase.from('job_photos').select('*').eq('job_id', jobId).not('folder', 'is', null).order('created_at', { ascending: false }),
        supabase.from('companies').select('id, company_name, contact_email').eq('company_type', 'Subcontractor').order('company_name', { ascending: true }),
      ]);
      if (photoData) {
        setPhotos(photoData);
        const entries = await Promise.all(
          photoData.map(async p => {
            const { data: signed } = await supabase.storage.from('job-photos').createSignedUrl(p.storage_path, 3600);
            return [p.id, signed?.signedUrl];
          })
        );
        setSignedUrls(Object.fromEntries(entries));
      }
      if (companyData) setCompanies(companyData);
    })();
  }, [jobId]);

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
    if (!title.trim()) { setError('Give the RFP a title.'); return; }
    if (selectedCompanyIds.length === 0) { setError('Select at least one subcontractor to send this to.'); return; }
    setSaving(true);
    const { data: rfp, error: insertErr } = await supabase.from('rfps').insert({
      job_id: jobId,
      title: title.trim(),
      description: description.trim() || null,
      expected_by: expectedBy || null,
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
    <>
      <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>New RFP</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>For this project.</div>

      <label>Title</label>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Framing" />

      <label style={{ marginTop: 12 }}>Description (optional)</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Scope, timeline, anything a sub needs to bid this." />

      <label style={{ marginTop: 12 }}>Expected By (optional)</label>
      <input type="date" value={expectedBy} onChange={e => setExpectedBy(e.target.value)} />
      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 3 }}>
        The sub gets an automatic "please submit your proposal" reminder the next workday after this date. Left blank, that reminder fires 2 weeks after this RFP is sent.
      </div>

      {folders.length > 0 && (
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

      {photos.length > 0 ? (
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
      ) : (
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
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
      </div>
    </>
  );
}
