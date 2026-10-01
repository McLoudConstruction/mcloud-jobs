'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  COMPLIANCE_DOC_TYPES, DOC_TYPE_BY_KEY, COMPLIANCE_STATUS, COMPLIANCE_OVERALL, ENFORCEMENT_MODES,
  docTypeLabel, fmtComplianceDate, fmtDaysLeft, safeFileName, openStorageDoc,
  COMPLIANCE_FILE_ACCEPT, checkComplianceFile,
} from '../lib/compliance';

const BUCKET = 'subcontractor-docs';
const EMPTY_UPLOAD = { doc_type: 'coi_gl', file: null, expires_at: '', carrier: '', policy_number: '', coverage_amount: '' };

function Chip({ def, children }) {
  const d = def || { color: '#6b6350', bg: '#efece2' };
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', padding: '2px 8px', borderRadius: 10, color: d.color, background: d.bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// Staff view of one subcontractor's compliance: what's required, what's on
// file, what's waiting for review, and the controls to upload on their
// behalf, approve/reject a sub's own upload, and set per-company rules.
// All status logic comes from sub_compliance_summary() in the database.
export default function ComplianceVaultPanel({ companyId, onChanged, onViewDoc }) {
  const [docs, setDocs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [company, setCompany] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [reviewEdits, setReviewEdits] = useState({});
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    const [docsRes, sumRes, compRes, setRes] = await Promise.all([
      supabase.from('sub_compliance_docs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.rpc('sub_compliance_summary', { target_company_id: companyId }),
      supabase.from('companies').select('compliance_exempt, compliance_required_override').eq('id', companyId).maybeSingle(),
      supabase.from('app_settings').select('compliance_required_types, compliance_enforcement, compliance_expiring_days').eq('id', 1).maybeSingle(),
    ]);
    if (docsRes.error) setError(docsRes.error.message);
    setDocs(docsRes.data || []);
    setSummary(sumRes.data || null);
    setCompany(compRes.data || null);
    setSettings(setRes.data || null);
  }, [companyId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`compliance-${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_compliance_docs', filter: `company_id=eq.${companyId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [companyId, load]);

  async function changed() {
    await load();
    if (onChanged) onChanged();
  }

  async function view(doc) {
    // A host page can supply its own in-app viewer (the Subcontractors page
    // has one); otherwise open the file in a new tab.
    if (onViewDoc) { onViewDoc(doc.storage_path); return; }
    try { await openStorageDoc(supabase, BUCKET, doc.storage_path); } catch (err) { setError(err.message); }
  }

  const uploadType = DOC_TYPE_BY_KEY[upload.doc_type];

  async function submitUpload(e) {
    e.preventDefault();
    const check = checkComplianceFile(upload.file);
    if (!check.ok) { setError(check.error); return; }
    if (uploadType.needsExpiry && !upload.expires_at) { setError('An expiration date is required for this document.'); return; }
    setBusy(true);
    setError('');
    try {
      const path = `compliance/${companyId}/${upload.doc_type}-${Date.now()}-${safeFileName(upload.file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, upload.file, { contentType: check.contentType });
      if (upErr) throw upErr;
      const { data: { session } } = await supabase.auth.getSession();
      const { error: insErr } = await supabase.from('sub_compliance_docs').insert({
        company_id: companyId,
        doc_type: upload.doc_type,
        storage_path: path,
        file_name: upload.file.name.slice(0, 300),
        expires_at: upload.expires_at || null,
        carrier: upload.carrier.trim() || null,
        policy_number: upload.policy_number.trim() || null,
        coverage_amount: upload.coverage_amount ? Number(upload.coverage_amount) : null,
        // Staff-uploaded documents are trusted, so they go straight in as approved.
        status: 'approved',
        uploaded_by_kind: 'staff',
        uploaded_by_email: session?.user?.email || null,
        reviewed_by_email: session?.user?.email || null,
        reviewed_at: new Date().toISOString(),
      });
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insErr;
      }
      setUpload(EMPTY_UPLOAD);
      setShowUpload(false);
      await changed();
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function editFor(doc) {
    return reviewEdits[doc.id] || { expires_at: doc.expires_at || '', carrier: doc.carrier || '', policy_number: doc.policy_number || '', coverage_amount: doc.coverage_amount ?? '' };
  }
  function setEdit(doc, field, value) {
    setReviewEdits(prev => ({ ...prev, [doc.id]: { ...editFor(doc), [field]: value } }));
  }

  async function review(doc, approve) {
    setError('');
    let reason = null;
    if (!approve) {
      reason = window.prompt('Why is this being rejected? The subcontractor will see this.');
      if (!reason || !reason.trim()) return;
    }
    const ed = editFor(doc);
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('review_sub_compliance_doc', {
      target_doc_id: doc.id,
      approve,
      reject_reason_in: reason,
      expires_at_in: ed.expires_at || null,
      carrier_in: ed.carrier || null,
      policy_number_in: ed.policy_number || null,
      coverage_amount_in: ed.coverage_amount === '' ? null : Number(ed.coverage_amount),
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    await changed();
  }

  async function saveCompanyRules(patch) {
    setError('');
    const { error: updErr } = await supabase.from('companies').update(patch).eq('id', companyId);
    if (updErr) { setError(updErr.message); return; }
    await changed();
  }

  function toggleCustomType(key) {
    const current = company?.compliance_required_override || [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    saveCompanyRules({ compliance_required_override: next });
  }

  if (!summary && !docs.length && !company) {
    return <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading compliance…</div>;
  }

  const overall = summary?.overall;
  const pending = docs.filter(d => d.status === 'pending_review');
  const usingCustom = Array.isArray(company?.compliance_required_override);
  const enforcement = ENFORCEMENT_MODES.find(m => m.key === settings?.compliance_enforcement);
  const requiredKeys = (summary?.required || []).map(r => r.doc_type);
  const currentApproved = docs.filter(d => d.status === 'approved' && !requiredKeys.includes(d.doc_type));

  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {overall && <Chip def={COMPLIANCE_OVERALL[overall]}>{COMPLIANCE_OVERALL[overall]?.label || overall}</Chip>}
        {enforcement && settings?.compliance_enforcement !== 'warn' && (
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Enforcement: {settings.compliance_enforcement}</span>
        )}
      </div>

      {error && <div style={{ color: '#a13f3f', marginBottom: 8 }}>{error}</div>}

      {(summary?.required || []).length === 0 && overall !== 'exempt' && (
        <div style={{ color: 'var(--ink-soft)', marginBottom: 8 }}>No documents are required for this company.</div>
      )}
      {overall === 'exempt' && <div style={{ color: 'var(--ink-soft)', marginBottom: 8 }}>This company is exempt from compliance tracking.</div>}

      {(summary?.required || []).map(r => {
        const doc = docs.find(d => d.id === r.doc_id);
        return (
          <div key={r.doc_type} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{docTypeLabel(r.doc_type)}</div>
              <Chip def={COMPLIANCE_STATUS[r.status]}>{COMPLIANCE_STATUS[r.status]?.label || r.status}</Chip>
            </div>
            {r.expires_at && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                Expires {fmtComplianceDate(r.expires_at)} · {fmtDaysLeft(r.days_left)}
              </div>
            )}
            {(r.carrier || r.coverage_amount) && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                {r.carrier || ''}{r.carrier && r.coverage_amount ? ' · ' : ''}{r.coverage_amount ? `$${Number(r.coverage_amount).toLocaleString('en-US')} coverage` : ''}
              </div>
            )}
            {r.renewal_pending && <div style={{ fontSize: 11.5, color: '#2f4858' }}>A renewal is waiting for your review below.</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {doc && <button type="button" className="btn btn-sm" onClick={() => view(doc)}>View</button>}
              <button type="button" className="btn btn-sm" onClick={() => { setUpload({ ...EMPTY_UPLOAD, doc_type: r.doc_type }); setShowUpload(true); }}>
                {doc ? 'Upload replacement' : 'Upload'}
              </button>
            </div>
          </div>
        );
      })}

      {pending.length > 0 && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid #c9d6de', background: '#f2f6f8', borderRadius: 6 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Awaiting your review ({pending.length})</div>
          {pending.map(d => {
            const t = DOC_TYPE_BY_KEY[d.doc_type];
            const ed = editFor(d);
            return (
              <div key={d.id} style={{ padding: '8px 0', borderTop: '1px solid #dbe5ea' }}>
                <div style={{ fontWeight: 600 }}>{docTypeLabel(d.doc_type)}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                  Uploaded {fmtComplianceDate(d.created_at)}{d.uploaded_by_email ? ` by ${d.uploaded_by_email}` : ''}
                </div>
                {t?.needsExpiry && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 11 }}>Expiration date (confirm from the document)</label>
                    <input type="date" value={ed.expires_at} onChange={e => setEdit(d, 'expires_at', e.target.value)} />
                  </div>
                )}
                {t?.insurance && (
                  <div className="two-col" style={{ marginTop: 6 }}>
                    <div><label style={{ fontSize: 11 }}>Carrier</label><input value={ed.carrier} onChange={e => setEdit(d, 'carrier', e.target.value)} /></div>
                    <div><label style={{ fontSize: 11 }}>Coverage ($)</label><input inputMode="decimal" value={ed.coverage_amount} onChange={e => setEdit(d, 'coverage_amount', e.target.value)} /></div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => view(d)}>View</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => review(d, true)}>Approve</button>
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => review(d, false)}>Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {currentApproved.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Other documents on file</div>
          {currentApproved.map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <span>{docTypeLabel(d.doc_type)}{d.expires_at ? ` — expires ${fmtComplianceDate(d.expires_at)}` : ''}</span>
              <button type="button" className="btn btn-sm" onClick={() => view(d)}>View</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {!showUpload ? (
          <button type="button" className="btn btn-sm" onClick={() => setShowUpload(true)}>+ Upload a document</button>
        ) : (
          <form onSubmit={submitUpload} style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)' }}>
            <label style={{ fontSize: 11 }}>Document type</label>
            <select value={upload.doc_type} onChange={e => setUpload(u => ({ ...u, doc_type: e.target.value }))}>
              {COMPLIANCE_DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <label style={{ fontSize: 11, marginTop: 6 }}>File</label>
            <input type="file" accept={COMPLIANCE_FILE_ACCEPT} onChange={e => { setError(''); setUpload(u => ({ ...u, file: e.target.files[0] || null })); }} />
            {uploadType?.needsExpiry && (
              <>
                <label style={{ fontSize: 11, marginTop: 6 }}>Expiration date</label>
                <input type="date" value={upload.expires_at} onChange={e => setUpload(u => ({ ...u, expires_at: e.target.value }))} />
              </>
            )}
            {uploadType?.insurance && (
              <>
                <div className="two-col" style={{ marginTop: 6 }}>
                  <div><label style={{ fontSize: 11 }}>Carrier</label><input value={upload.carrier} onChange={e => setUpload(u => ({ ...u, carrier: e.target.value }))} /></div>
                  <div><label style={{ fontSize: 11 }}>Policy #</label><input value={upload.policy_number} onChange={e => setUpload(u => ({ ...u, policy_number: e.target.value }))} /></div>
                </div>
                <label style={{ fontSize: 11, marginTop: 6 }}>Coverage amount ($)</label>
                <input inputMode="decimal" value={upload.coverage_amount} onChange={e => setUpload(u => ({ ...u, coverage_amount: e.target.value }))} />
              </>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload & approve'}</button>
              <button className="btn btn-sm" type="button" onClick={() => { setShowUpload(false); setUpload(EMPTY_UPLOAD); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Requirements for this company</div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(company?.compliance_exempt)} onChange={e => saveCompanyRules({ compliance_exempt: e.target.checked })} />
          Exempt from compliance tracking (e.g. a supplier)
        </label>
        {!company?.compliance_exempt && (
          <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={usingCustom} onChange={e => saveCompanyRules({ compliance_required_override: e.target.checked ? (settings?.compliance_required_types || ['w9', 'coi_gl']) : null })} />
              Use a custom list instead of the company-wide defaults
            </label>
            {usingCustom && (
              <div style={{ marginLeft: 22, marginTop: 4 }}>
                {COMPLIANCE_DOC_TYPES.filter(t => t.key !== 'other').map(t => (
                  <label key={t.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400, cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={(company.compliance_required_override || []).includes(t.key)} onChange={() => toggleCustomType(t.key)} />
                    {t.label}
                  </label>
                ))}
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Tip: a sole proprietor with no employees is usually exempt from Workers&apos; Comp — leave that box unchecked.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => setShowHistory(h => !h)}>{showHistory ? 'Hide history' : `History (${docs.length})`}</button>
        {showHistory && docs.map(d => (
          <div key={d.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 11.5 }}>
            <b>{docTypeLabel(d.doc_type)}</b> — {d.status.replace('_', ' ')}
            <div style={{ color: 'var(--ink-soft)' }}>
              {fmtComplianceDate(d.created_at)}{d.uploaded_by_email ? ` · ${d.uploaded_by_email}` : ''}{d.expires_at ? ` · expires ${fmtComplianceDate(d.expires_at)}` : ''}
              {d.reject_reason ? ` · rejected: ${d.reject_reason}` : ''}
            </div>
            <button type="button" className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => view(d)}>View</button>
          </div>
        ))}
      </div>
    </div>
  );
}
