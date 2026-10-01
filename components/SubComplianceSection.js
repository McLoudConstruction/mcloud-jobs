'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  COMPLIANCE_DOC_TYPES, DOC_TYPE_BY_KEY, COMPLIANCE_STATUS,
  docTypeLabel, fmtComplianceDate, fmtDaysLeft, safeFileName, openStorageDoc,
  COMPLIANCE_FILE_ACCEPT, checkComplianceFile,
} from '../lib/compliance';

const BUCKET = 'subcontractor-docs';
const EMPTY = { file: null, expires_at: '', carrier: '', policy_number: '', coverage_amount: '' };

function Chip({ def, children }) {
  const d = def || { color: '#6b6350', bg: '#efece2' };
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: d.color, background: d.bg, whiteSpace: 'nowrap' }}>{children}</span>
  );
}

// Sub Portal view of the compliance vault (migration 133): what McLoud
// requires, where each document stands, and self-serve upload. Uploads go
// to the office's review queue — they don't replace what's on file until
// someone approves them.
export default function SubComplianceSection({ company }) {
  const [summary, setSummary] = useState(null);
  const [docs, setDocs] = useState([]);
  const [openType, setOpenType] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [sumRes, docsRes] = await Promise.all([
      supabase.rpc('sub_compliance_summary', { target_company_id: company.id }),
      supabase.from('sub_compliance_docs').select('*').eq('company_id', company.id).order('created_at', { ascending: false }),
    ]);
    setSummary(sumRes.data || null);
    setDocs(docsRes.data || []);
  }, [company.id]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`sub-compliance-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_compliance_docs', filter: `company_id=eq.${company.id}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company.id, load]);

  const requiredKeys = (summary?.required || []).map(r => r.doc_type);
  const extraTypes = COMPLIANCE_DOC_TYPES.filter(t => !requiredKeys.includes(t.key));

  function start(type) {
    setOpenType(type);
    setForm(EMPTY);
    setError('');
    setNotice('');
  }

  async function submit(e) {
    e.preventDefault();
    const def = DOC_TYPE_BY_KEY[openType];
    const check = checkComplianceFile(form.file);
    if (!check.ok) { setError(check.error); return; }
    if (def.needsExpiry && !form.expires_at) { setError('Enter the expiration date shown on the document.'); return; }
    setBusy(true);
    setError('');
    let path = null;
    try {
      path = `compliance/${company.id}/${openType}-${Date.now()}-${safeFileName(form.file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, form.file, { contentType: check.contentType });
      if (upErr) throw upErr;
      const { error: rpcErr } = await supabase.rpc('submit_sub_compliance_doc_v2', {
        target_company_id: company.id,
        doc_type_in: openType,
        storage_path_in: path,
        file_name_in: form.file.name,
        expires_at_in: form.expires_at || null,
        carrier_in: form.carrier.trim() || null,
        policy_number_in: form.policy_number.trim() || null,
        coverage_amount_in: form.coverage_amount ? Number(form.coverage_amount) : null,
        effective_date_in: null,
      });
      if (rpcErr) {
        // Don't leave an orphaned file behind when the record couldn't be saved.
        await supabase.storage.from(BUCKET).remove([path]);
        throw rpcErr;
      }
      setOpenType(null);
      setForm(EMPTY);
      setNotice('Uploaded — the office will review it shortly.');
      await load();
    } catch (err) {
      setError(err.message || 'Upload failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function view(doc) {
    try { await openStorageDoc(supabase, BUCKET, doc.storage_path); } catch (err) { setError(err.message); }
  }

  function renderForm() {
    const def = DOC_TYPE_BY_KEY[openType];
    return (
      <form onSubmit={submit} style={{ marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)' }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>Upload {docTypeLabel(openType)}</div>
        <input type="file" accept={COMPLIANCE_FILE_ACCEPT} onChange={e => { setError(''); setForm(f => ({ ...f, file: e.target.files[0] || null })); }} />
        {def.needsExpiry && (
          <>
            <label style={{ marginTop: 8 }}>Expiration date (as shown on the document)</label>
            <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
          </>
        )}
        {def.insurance && (
          <>
            <div className="two-col" style={{ marginTop: 8 }}>
              <div><label>Insurance carrier</label><input value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} /></div>
              <div><label>Policy number</label><input value={form.policy_number} onChange={e => setForm(f => ({ ...f, policy_number: e.target.value }))} /></div>
            </div>
            <label style={{ marginTop: 8 }}>Coverage amount ($)</label>
            <input inputMode="decimal" value={form.coverage_amount} onChange={e => setForm(f => ({ ...f, coverage_amount: e.target.value }))} placeholder="e.g. 1000000" />
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Submit for review'}</button>
          <button className="btn btn-sm" type="button" onClick={() => setOpenType(null)}>Cancel</button>
        </div>
      </form>
    );
  }

  const rejectedByType = {};
  docs.filter(d => d.status === 'rejected').forEach(d => { if (!rejectedByType[d.doc_type]) rejectedByType[d.doc_type] = d; });

  return (
    <div className="dash-section">
      <h3>Compliance Documents</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Keep these current so we can keep scheduling and paying you without interruption. New uploads are reviewed by the office before they replace what&apos;s on file.
      </div>

      {summary?.overall === 'exempt' && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No documents are required for your company right now.</div>}

      {(summary?.required || []).map(r => {
        const rejected = rejectedByType[r.doc_type];
        const doc = docs.find(d => d.id === r.doc_id);
        const showRejected = rejected && ['missing', 'rejected'].includes(r.status);
        return (
          <div key={r.doc_type} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{docTypeLabel(r.doc_type)}</div>
              <Chip def={COMPLIANCE_STATUS[r.status]}>{COMPLIANCE_STATUS[r.status]?.label || r.status}</Chip>
            </div>
            {r.expires_at && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                Expires {fmtComplianceDate(r.expires_at)} · {fmtDaysLeft(r.days_left)}
              </div>
            )}
            {r.status === 'insufficient' && (
              <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 2 }}>The coverage amount on file is below our minimum — please upload a certificate with higher limits.</div>
            )}
            {showRejected && (
              <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 2 }}>Last upload wasn&apos;t accepted: {rejected.reject_reason}</div>
            )}
            {r.renewal_pending && <div style={{ fontSize: 11.5, color: '#2f4858', marginTop: 2 }}>Your renewal is waiting for review.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {doc && <button className="btn btn-sm" onClick={() => view(doc)}>View</button>}
              {r.status !== 'pending' && (
                <button className="btn btn-sm" onClick={() => start(r.doc_type)}>
                  {['ok', 'expiring', 'expired', 'insufficient'].includes(r.status) ? 'Upload renewal' : 'Upload'}
                </button>
              )}
            </div>
            {openType === r.doc_type && renderForm()}
          </div>
        );
      })}

      {extraTypes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <label>Add another document</label>
          <select value={openType && !requiredKeys.includes(openType) ? openType : ''} onChange={e => e.target.value && start(e.target.value)}>
            <option value="">Choose a document type…</option>
            {extraTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {openType && !requiredKeys.includes(openType) && renderForm()}
        </div>
      )}

      {notice && <div style={{ fontSize: 12, color: '#3a6b45', marginTop: 10 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
