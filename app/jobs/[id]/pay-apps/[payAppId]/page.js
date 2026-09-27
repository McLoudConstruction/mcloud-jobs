'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import { docFilename } from '../../../../../lib/docFilename';
import DocBackLink from '../../../../../components/DocBackLink';
import { generatePdfBase64, downloadPdf } from '../../../../../lib/generatePdf';
import SignaturePad from '../../../../../components/SignaturePad';
import SignatureAuditTrail from '../../../../../components/SignatureAuditTrail';
import { useSettings } from '../../../../../lib/useSettings';
import { useStaffAuth } from '../../../../../lib/staffAuthContext';
import { computePayApp, toCents, fromCents, fmtCents } from '../../../../../lib/payAppMath';

const LOGO_SRC = '/mcloud-logo.png';
const STATUS = {
  draft: { label: 'Draft', color: '#6b6350' },
  submitted: { label: 'Submitted', color: '#2f4858' },
  approved: { label: 'Approved', color: '#a17c3f' },
  paid: { label: 'Paid', color: '#3a6b45' },
  void: { label: 'Void', color: '#a13f3f' },
};

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const numStr = v => (v === null || v === undefined || v === '' ? '' : String(v));

export default function PayApplicationPage() {
  const { settings } = useSettings();
  const logoUrl = settings.logo_url || LOGO_SRC;
  const { session, loading } = useDocumentAuth();
  const { fullName: staffFullName } = useStaffAuth();
  const { id, payAppId } = useParams();
  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  const [job, setJob] = useState(null);
  const [app, setApp] = useState(null);
  const [sov, setSov] = useState([]);
  const [edits, setEdits] = useState({}); // sov_line_id -> { e, f } as typed
  const [priorByLine, setPriorByLine] = useState({});
  const [prevCerts, setPrevCerts] = useState(0);
  const [prevMissingSnapshot, setPrevMissingSnapshot] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [header, setHeader] = useState({});
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    const [{ data: jobData }, { data: appData }, { data: sovData }, { data: allApps }] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', id).single(),
      supabase.from('pay_applications').select('*').eq('id', payAppId).single(),
      supabase.from('pay_app_sov_lines').select('*').eq('job_id', id).order('sort_order').order('created_at'),
      supabase.from('pay_applications').select('id, application_no, status, snapshot').eq('job_id', id),
    ]);
    if (!appData) return;
    setJob(jobData);
    setApp(appData);
    setSov(sovData || []);
    setHeader({
      owner_name: appData.owner_name || '', owner_address: appData.owner_address || '', project_name: appData.project_name || '',
      contract_date: appData.contract_date || '', period_from: appData.period_from || '', period_to: appData.period_to || '',
      retainage_completed_percent: numStr(appData.retainage_completed_percent), retainage_stored_percent: numStr(appData.retainage_stored_percent),
      retainage_release_to_date: numStr(appData.retainage_release_to_date), notes: appData.notes || '',
    });

    const prior = (allApps || []).filter(a => a.application_no < appData.application_no && ['submitted', 'approved', 'paid'].includes(a.status));
    const ids = [appData.id, ...prior.map(p => p.id)];
    const { data: lines } = await supabase.from('pay_app_lines').select('*').in('application_id', ids);
    const byLine = {};
    const mine = {};
    for (const l of lines || []) {
      if (l.application_id === appData.id) mine[l.sov_line_id] = { e: numStr(Number(l.work_completed_this_period) || ''), f: numStr(Number(l.materials_stored) || '') };
      else byLine[l.sov_line_id] = (byLine[l.sov_line_id] || 0) + toCents(l.work_completed_this_period);
    }
    setEdits(mine);
    setPriorByLine(byLine);
    setPrevCerts(prior.reduce((s, p) => s + (p.snapshot?.g702?.current_payment_due || 0), 0));
    setPrevMissingSnapshot(prior.some(p => p.snapshot?.g702?.current_payment_due === undefined));

    if (appData.invoice_id) {
      const { data: inv } = await supabase.from('invoices').select('*').eq('id', appData.invoice_id).maybeSingle();
      setInvoice(inv || null);
    } else setInvoice(null);
  }, [id, payAppId]);

  useEffect(() => { if (session) load(); }, [session, load]);

  const isDraft = app?.status === 'draft';

  const computed = useMemo(() => {
    if (!app) return null;
    if (!isDraft && app.snapshot?.computed) return app.snapshot.computed;
    const thisLines = {};
    for (const l of sov) {
      const ed = edits[l.id] || {};
      thisLines[l.id] = { work_completed_this_period: ed.e || 0, materials_stored: ed.f || 0 };
    }
    return computePayApp({
      sovLines: sov, thisLines, priorByLine, previousCertificatesCents: prevCerts,
      opts: {
        retainageCompletedPercent: header.retainage_completed_percent, retainageStoredPercent: header.retainage_stored_percent,
        releaseToDateCents: toCents(header.retainage_release_to_date),
      },
    });
  }, [app, isDraft, sov, edits, priorByLine, prevCerts, header]);

  async function persistLines() {
    const rows = sov.map(l => {
      const ed = edits[l.id] || {};
      return {
        application_id: payAppId, sov_line_id: l.id,
        work_completed_this_period: fromCents(toCents(ed.e || 0)), materials_stored: fromCents(toCents(ed.f || 0)),
      };
    }).filter(r => r.work_completed_this_period !== 0 || r.materials_stored !== 0 || edits[r.sov_line_id]);
    if (!rows.length) return;
    const { error: err } = await supabase.from('pay_app_lines').upsert(rows, { onConflict: 'application_id,sov_line_id' });
    if (err) throw err;
  }

  async function saveLineNow(sovId, next) {
    const ed = { ...(edits[sovId] || {}), ...next };
    setEdits(prev => ({ ...prev, [sovId]: ed }));
    const { error: err } = await supabase.from('pay_app_lines').upsert({
      application_id: payAppId, sov_line_id: sovId,
      work_completed_this_period: fromCents(toCents(ed.e || 0)), materials_stored: fromCents(toCents(ed.f || 0)),
    }, { onConflict: 'application_id,sov_line_id' });
    if (err) setError(err.message); else setError('');
  }

  async function saveHeader(patch) {
    const clean = { ...patch };
    for (const k of ['retainage_completed_percent', 'retainage_stored_percent']) if (k in clean) clean[k] = Math.min(100, Math.max(0, Number(clean[k]) || 0));
    if ('retainage_release_to_date' in clean) clean.retainage_release_to_date = Math.max(0, fromCents(toCents(clean.retainage_release_to_date || 0)));
    for (const k of ['contract_date', 'period_from']) if (k in clean && !clean[k]) clean[k] = null;
    const { error: err } = await supabase.from('pay_applications').update(clean).eq('id', payAppId);
    if (err) setError(err.message); else setError('');
  }

  async function saveSignature(payload) {
    setSigning(true);
    const sigs = { ...(app.signatures || {}), contractor: payload };
    const { error: err } = await supabase.from('pay_applications').update({ signatures: sigs }).eq('id', payAppId);
    setSigning(false);
    if (err) { setFlash(`Couldn't save signature: ${err.message}`); setTimeout(() => setFlash(''), 8000); return; }
    load();
  }

  async function submitApp() {
    setError('');
    if (!app.signatures?.contractor) { setError('Sign as the contractor first — the G702 is a certification.'); return; }
    if (computed.totals.e === 0 && computed.totals.f === 0) { setError('Nothing is being billed this period. Enter work completed or materials stored.'); return; }
    if (computed.warnings.length && !confirm(`${computed.warnings.join('\n')}\n\nSubmit anyway?`)) return;
    if (!confirm(`Submit Pay Application #${app.application_no} for ${fmtCents(computed.g702.current_payment_due)}? The figures freeze at submission${computed.g702.current_payment_due > 0 ? ' and an invoice is created' : ''}.`)) return;
    setBusy(true);
    let invoiceId = null;
    try {
      await persistLines();
      const due = computed.g702.current_payment_due;
      if (due > 0) {
        const { data: inv, error: invErr } = await supabase.from('invoices').insert({
          job_id: id,
          description: `Pay Application #${app.application_no} — period ending ${header.period_to}`,
          amount: fromCents(due),
          status: 'not_sent',
          retainage_percent: Number(header.retainage_completed_percent) || null,
          retainage_held: fromCents(computed.g702.retainage_held),
        }).select('id').single();
        if (invErr) throw invErr;
        invoiceId = inv.id;
      }
      const snapshot = {
        computed,
        header: { ...header, application_no: app.application_no },
        job: { customer_name: job.customer_name, job_number: job.job_number, project_address: job.project_address },
        submitted_by: session.user.email,
        version: 1,
      };
      const { error: upErr } = await supabase.from('pay_applications').update({ status: 'submitted', snapshot, invoice_id: invoiceId }).eq('id', payAppId);
      if (upErr) throw upErr;
    } catch (e) {
      if (invoiceId) await supabase.from('invoices').delete().eq('id', invoiceId);
      setError(e.message || String(e));
    }
    setBusy(false);
    load();
  }

  async function setStatus(status) {
    setBusy(true);
    setError('');
    let err = null;
    if (status === 'paid' && invoice && invoice.status !== 'paid') {
      // The invoice is the source of truth for payment; a trigger marks this
      // pay application paid when it is.
      ({ error: err } = await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoice.id));
    } else {
      ({ error: err } = await supabase.from('pay_applications').update({ status }).eq('id', payAppId));
    }
    if (!err && status === 'void' && invoice && invoice.status === 'not_sent') {
      await supabase.from('invoices').delete().eq('id', invoice.id);
    }
    if (err) setError(err.message);
    setBusy(false);
    load();
  }

  async function deleteDraft() {
    if (!confirm('Delete this draft pay application?')) return;
    const { error: err } = await supabase.from('pay_applications').delete().eq('id', payAppId);
    if (err) { setError(err.message); return; }
    window.location.href = `/jobs/${id}#Financials`;
  }

  async function downloadDocument() {
    setDownloading(true);
    try {
      const filename = docFilename(`Pay-Application-${app.application_no}`, job.customer_name, app.period_to);
      const base64 = await generatePdfBase64('doc-preview', filename);
      downloadPdf(base64, filename);
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !session || !job || !app || !computed) return null;
  if (!isAdmin) return <div style={{ padding: 40 }}>Pay applications are only visible to staff.</div>;

  const st = STATUS[app.status] || STATUS.draft;
  const h = isDraft ? header : (app.snapshot?.header || header);
  const g = computed.g702;
  const cell = { padding: '5px 6px', borderBottom: '1px solid #e6e0cd', fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' };
  const th = { ...cell, fontSize: 10, fontWeight: 700, color: '#6b6350', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'normal', borderBottom: '2px solid #1C1B19' };
  const inp = { width: 86, textAlign: 'right', padding: '3px 5px', fontSize: 11.5 };

  const G702Row = ({ n, label, value, bold }) => (
    <tr>
      <td style={{ padding: '4px 6px', fontSize: 12, width: 26, color: '#6b6350' }}>{n}</td>
      <td style={{ padding: '4px 6px', fontSize: 12, fontWeight: bold ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '4px 6px', fontSize: 12, textAlign: 'right', fontWeight: bold ? 700 : 400 }}>{fmtCents(value)}</td>
    </tr>
  );

  return (
    <div>
      <div className="no-print doc-toolbar">
        <DocBackLink fallbackHref={`/jobs/${id}`} className="btn btn-sm" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isDraft && <button className="btn btn-sm btn-danger" onClick={deleteDraft}>Delete draft</button>}
          {app.status === 'submitted' && <button className="btn btn-sm" onClick={() => setStatus('approved')} disabled={busy}>Mark approved by owner</button>}
          {['submitted', 'approved'].includes(app.status) && <button className="btn btn-sm" onClick={() => setStatus('paid')} disabled={busy}>Mark paid</button>}
          {['submitted', 'approved'].includes(app.status) && <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('Void this pay application? Any unsent invoice created from it is deleted.')) setStatus('void'); }} disabled={busy}>Void</button>}
          <button className="btn btn-primary btn-sm" onClick={downloadDocument} disabled={downloading}>{downloading ? 'Preparing…' : 'Download PDF'}</button>
        </div>
      </div>

      <div className="doc-outer">
        <div className="doc-page" id="doc-preview">
          <div className="doc-header">
            <img src={logoUrl} alt="McLoud Construction" className="doc-logo" />
            <div className="doc-brand-tag">Application for Payment</div>
          </div>
          <div className="doc-body">
            <h1 className="doc-title">Pay Application #{app.application_no} <span style={{ fontSize: 13, color: st.color, fontWeight: 700 }}>{st.label}</span></h1>

            {isDraft ? (
              <div className="no-print hdr-grid">
                <div><label>Owner</label><input value={header.owner_name} onChange={e => setHeader(p => ({ ...p, owner_name: e.target.value }))} onBlur={e => saveHeader({ owner_name: e.target.value })} /></div>
                <div><label>Project</label><input value={header.project_name} onChange={e => setHeader(p => ({ ...p, project_name: e.target.value }))} onBlur={e => saveHeader({ project_name: e.target.value })} /></div>
                <div><label>Project address</label><input value={header.owner_address} onChange={e => setHeader(p => ({ ...p, owner_address: e.target.value }))} onBlur={e => saveHeader({ owner_address: e.target.value })} /></div>
                <div><label>Contract date</label><input type="date" value={header.contract_date} onChange={e => setHeader(p => ({ ...p, contract_date: e.target.value }))} onBlur={e => saveHeader({ contract_date: e.target.value })} /></div>
                <div><label>Period from</label><input type="date" value={header.period_from} onChange={e => setHeader(p => ({ ...p, period_from: e.target.value }))} onBlur={e => saveHeader({ period_from: e.target.value })} /></div>
                <div><label>Period to</label><input type="date" value={header.period_to} onChange={e => setHeader(p => ({ ...p, period_to: e.target.value }))} onBlur={e => e.target.value && saveHeader({ period_to: e.target.value })} /></div>
                <div><label>Retainage on completed work (%)</label><input inputMode="decimal" value={header.retainage_completed_percent} onChange={e => setHeader(p => ({ ...p, retainage_completed_percent: e.target.value }))} onBlur={e => saveHeader({ retainage_completed_percent: e.target.value })} /></div>
                <div><label>Retainage on stored materials (%)</label><input inputMode="decimal" value={header.retainage_stored_percent} onChange={e => setHeader(p => ({ ...p, retainage_stored_percent: e.target.value }))} onBlur={e => saveHeader({ retainage_stored_percent: e.target.value })} /></div>
                <div><label>Retainage released to date ($) — final billing</label><input inputMode="decimal" value={header.retainage_release_to_date} onChange={e => setHeader(p => ({ ...p, retainage_release_to_date: e.target.value }))} onBlur={e => saveHeader({ retainage_release_to_date: e.target.value })} /></div>
              </div>
            ) : null}

            <div className="doc-meta">
              <span>Owner: <b>{h.owner_name || job.customer_name || '—'}</b></span>
              <span>Project: <b>{h.project_name || h.owner_address || '—'}</b></span>
              <span>Period: <b>{h.period_from ? fmtDate(h.period_from) + ' – ' : 'through '}{fmtDate(h.period_to)}</b></span>
              <span>Contract date: <b>{fmtDate(h.contract_date)}</b></span>
              <span>Job #{job.job_number}</span>
            </div>

            <div className="section">
              <h3>G703 — Continuation sheet</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>A<br />Item</th>
                      <th style={{ ...th, textAlign: 'left' }}>B<br />Description</th>
                      <th style={th}>C<br />Scheduled</th>
                      <th style={th}>D<br />Previous</th>
                      <th style={th}>E<br />This period</th>
                      <th style={th}>F<br />Stored</th>
                      <th style={th}>G<br />Total to date</th>
                      <th style={th}>%</th>
                      <th style={th}>H<br />Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.rows.map(r => (
                      <tr key={r.id} style={r.over ? { background: '#fbeae7' } : undefined}>
                        <td style={{ ...cell, textAlign: 'left' }}>{r.item_no}</td>
                        <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>{r.description}</td>
                        <td style={cell}>{fmtCents(r.c)}</td>
                        <td style={cell}>{fmtCents(r.d)}</td>
                        <td style={cell}>
                          {isDraft ? (
                            <input className="no-print" style={inp} inputMode="decimal" value={edits[r.id]?.e ?? ''} placeholder="0.00"
                              onChange={ev => setEdits(p => ({ ...p, [r.id]: { ...(p[r.id] || {}), e: ev.target.value.replace(/[^0-9.]/g, '') } }))}
                              onBlur={ev => saveLineNow(r.id, { e: ev.target.value })} />
                          ) : fmtCents(r.e)}
                          {isDraft && <span className="print-only">{fmtCents(r.e)}</span>}
                        </td>
                        <td style={cell}>
                          {isDraft ? (
                            <input className="no-print" style={inp} inputMode="decimal" value={edits[r.id]?.f ?? ''} placeholder="0.00"
                              onChange={ev => setEdits(p => ({ ...p, [r.id]: { ...(p[r.id] || {}), f: ev.target.value.replace(/[^0-9.]/g, '') } }))}
                              onBlur={ev => saveLineNow(r.id, { f: ev.target.value })} />
                          ) : fmtCents(r.f)}
                          {isDraft && <span className="print-only">{fmtCents(r.f)}</span>}
                        </td>
                        <td style={cell}>{fmtCents(r.g)}</td>
                        <td style={cell}>{r.percent}%</td>
                        <td style={cell}>{fmtCents(r.h)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td style={{ ...cell, borderTop: '2px solid #1C1B19' }} />
                      <td style={{ ...cell, textAlign: 'left', borderTop: '2px solid #1C1B19' }}>Totals</td>
                      {['c', 'd', 'e', 'f', 'g'].map(k => <td key={k} style={{ ...cell, borderTop: '2px solid #1C1B19' }}>{fmtCents(computed.totals[k])}</td>)}
                      <td style={{ ...cell, borderTop: '2px solid #1C1B19' }}>{computed.totals.c ? Math.round((computed.totals.g / computed.totals.c) * 1000) / 10 : 0}%</td>
                      <td style={{ ...cell, borderTop: '2px solid #1C1B19' }}>{fmtCents(computed.totals.h)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {isDraft && prevMissingSnapshot && (
                <div className="no-print" style={{ fontSize: 11.5, color: '#a17c3f', marginTop: 8 }}>An earlier application has no saved totals, so &ldquo;previous certificates&rdquo; may be understated.</div>
              )}
            </div>

            <div className="section" style={{ maxWidth: 520 }}>
              <h3>G702 — Application summary</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <G702Row n="1" label="Contract sum to date (incl. change orders)" value={g.original_contract_sum} />
                  <G702Row n="2" label="Total completed and stored to date" value={g.total_completed_and_stored} />
                  <G702Row n="3" label={`Retainage (${h.retainage_completed_percent || 0}% of work${Number(h.retainage_stored_percent) !== Number(h.retainage_completed_percent) ? `, ${h.retainage_stored_percent || 0}% of stored` : ''}${g.retainage_released ? `, less ${fmtCents(g.retainage_released)} released` : ''})`} value={g.retainage_held} />
                  <G702Row n="4" label="Total earned less retainage" value={g.earned_less_retainage} />
                  <G702Row n="5" label="Less previous certificates for payment" value={g.previous_certificates} />
                  <G702Row n="6" label="Current payment due" value={g.current_payment_due} bold />
                  <G702Row n="7" label="Balance to finish, including retainage" value={g.balance_to_finish_incl_retainage} />
                </tbody>
              </table>
              {isDraft && computed.warnings.map(w => <div key={w} className="no-print" style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>⚠ {w}</div>)}
            </div>

            {isDraft ? (
              <div className="section no-print">
                <h3>Notes</h3>
                <textarea rows={2} value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))} onBlur={e => saveHeader({ notes: e.target.value })} placeholder="Optional — shown on the application" />
              </div>
            ) : (app.notes ? <div className="section"><h3>Notes</h3><p>{app.notes}</p></div> : null)}

            <div className="section">
              <h3>Contractor certification</h3>
              <p style={{ fontSize: 11.5, color: '#6b6350', marginBottom: 10 }}>
                The undersigned Contractor certifies that, to the best of the Contractor&apos;s knowledge, the work covered by this Application for Payment has been completed in accordance with the Contract Documents, that all amounts have been paid by the Contractor for work for which previous Certificates for Payment were issued and payments received from the Owner, and that the current payment shown herein is now due.
              </p>
              {flash && <div style={{ fontSize: 11.5, color: '#a13f3f', marginBottom: 8 }}>{flash}</div>}
              <div className="sig-block">
                <SignaturePad
                  label="Contractor"
                  saved={app.signatures?.contractor}
                  onSave={saveSignature}
                  saving={signing}
                  defaultName={staffFullName}
                  defaultTitle="Owner, McLoud Contracting, LLC"
                  showTitle
                  locked={!isDraft}
                />
              </div>
              <SignatureAuditTrail documentType="pay_app" documentId={payAppId} isStaff={isAdmin} />
            </div>

            <div className="doc-footer">
              <span>McLoud Construction</span>
              <span>Job #{job.job_number} · Pay App #{app.application_no}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 40px', padding: '0 16px' }}>
        {error && <div style={{ fontSize: 12.5, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}
        {isDraft && (
          <button className="btn btn-primary" onClick={submitApp} disabled={busy}>{busy ? 'Submitting…' : `Submit — ${fmtCents(g.current_payment_due)} due`}</button>
        )}
        {!isDraft && invoice && (
          <div style={{ fontSize: 12.5 }}>
            Invoice: <Link href={`/jobs/${id}/invoices/${invoice.id}`}>{invoice.description}</Link> — {invoice.status === 'not_sent' ? 'not sent yet (send it from Financials → Invoices)' : invoice.status}
          </div>
        )}
        {!isDraft && !invoice && app.status !== 'void' && <div style={{ fontSize: 12.5, color: '#6b6350' }}>No invoice was created because nothing was due on this application.</div>}
        <div style={{ fontSize: 12, color: '#6b6350', marginTop: 10 }}>
          Collecting lien waivers with this payment? Request them under Financials → Lien Waivers and tie them to this application.
        </div>
      </div>

      <style jsx global>{`
        body { background: #EDE7DA; margin: 0; }
        .doc-outer { padding: 40px; display: flex; justify-content: center; }
        .doc-page { background: #fff; width: 100%; max-width: 1000px; min-height: 700px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .doc-header { background: #fff; padding: 28px 40px 22px; display: flex; align-items: center; gap: 16px; border-bottom: 4px solid #1C1B19; }
        .doc-logo { width: 180px; height: auto; display: block; }
        .doc-brand-tag { margin-left: auto; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #9B773D; }
        .doc-body { padding: 34px 40px 56px; }
        .doc-title { font-weight: 700; font-size: 24px; color: #9B773D; margin: 0 0 18px; }
        .doc-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; font-size: 12.5px; color: #6b6350; padding-bottom: 18px; margin-bottom: 26px; border-bottom: 1px solid #ded7c0; }
        .hdr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; margin-bottom: 20px; }
        .section { margin-bottom: 24px; break-inside: avoid; }
        .section h3 { font-weight: 700; font-size: 12.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #9B773D; margin: 0 0 8px; padding-left: 11px; border-left: 3px solid #9B773D; }
        .section p { font-size: 13px; line-height: 1.6; color: #1C1B19; margin: 0; white-space: pre-wrap; }
        .doc-footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #ded7c0; font-size: 12px; color: #6b6350; display: flex; justify-content: space-between; }
        .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 10px; }
        .print-only { display: none; }
        @media (max-width: 800px) {
          .doc-outer { padding: 12px; }
          .doc-header { padding: 18px 20px; }
          .doc-body { padding: 20px 16px 40px; }
          .hdr-grid, .sig-block { grid-template-columns: 1fr; }
          .doc-logo { width: 130px; }
        }
        @media print { .no-print { display: none !important; } .print-only { display: inline !important; } body { background: #fff; } .doc-outer { padding: 0; } .doc-page { box-shadow: none; max-width: none; } .sig-editing { display: none !important; } }
        @page { margin: 0.4in 0.5in; }
      `}</style>
    </div>
  );
}
