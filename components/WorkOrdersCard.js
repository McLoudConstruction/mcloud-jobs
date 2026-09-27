'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../lib/constants';
import { buildNewWorkOrderEmail } from '../lib/emailTemplates';
import WorkOrderPhotosPanel from './WorkOrderPhotosPanel';
import { COMPLIANCE_OVERALL, complianceGapText } from '../lib/compliance';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAction(a) {
  const qty = a.quantity ?? 1;
  const unit = a.unit_label ? ` ${a.unit_label}${qty === 1 ? '' : 's'}` : '';
  return `${qty}${unit} — ${a.description}`;
}

const EMPTY_FORM = { company_id: '', trade: '', description: '', amount: '' };

export default function WorkOrdersCard({ jobId, scopeItems = [], projectAddress }) {
  const [workOrders, setWorkOrders] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [tradeActions, setTradeActions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedScope, setSelectedScope] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [invoicingId, setInvoicingId] = useState(null);
  const [photosOpenId, setPhotosOpenId] = useState(null);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  // company_id -> { overall, summary } from the compliance vault (migration 133),
  // plus the enforcement mode. The database is the real gate (a non-compliant
  // sub can't be issued/paid in 'block' mode without an override reason);
  // this is here so staff get told BEFORE they click, not just an error after.
  const [compliance, setCompliance] = useState({});
  const [enforcement, setEnforcement] = useState('warn');

  const loadWorkOrders = useCallback(async () => {
    const { data } = await supabase.from('work_orders').select('*, companies(company_name)').eq('job_id', jobId).order('created_at', { ascending: false });
    if (data) setWorkOrders(data);
  }, [jobId]);

  const loadCompliance = useCallback(async () => {
    const [{ data: overview }, { data: cfg }] = await Promise.all([
      supabase.rpc('sub_compliance_overview'),
      supabase.from('app_settings').select('compliance_enforcement').eq('id', 1).maybeSingle(),
    ]);
    setCompliance(Object.fromEntries((overview || []).map(r => [r.company_id, r])));
    if (cfg?.compliance_enforcement) setEnforcement(cfg.compliance_enforcement);
  }, []);

  useEffect(() => { loadCompliance(); }, [loadCompliance]);

  // Returns { ok, override }. 'warn' asks for a confirmation; 'block' asks for
  // a reason that's recorded on the work order and sent to the office.
  function complianceGate(wo, actionLabel) {
    const row = compliance[wo.company_id];
    if (!row || row.overall !== 'noncompliant' || enforcement === 'off') return { ok: true, override: {} };
    const name = wo.companies?.company_name || row.company_name || 'This subcontractor';
    const gaps = complianceGapText(row.summary) || 'documents outstanding';
    if (enforcement === 'warn') {
      return { ok: confirm(`${name} isn't fully compliant: ${gaps}.\n\n${actionLabel} anyway?`), override: {} };
    }
    const reason = window.prompt(`${name} isn't compliant (${gaps}).\n\nCompliance enforcement is set to Block. To ${actionLabel.toLowerCase()} anyway, enter a reason — it's recorded on the work order and sent to the office. Cancel to stop.`);
    if (!reason || !reason.trim()) return { ok: false, override: {} };
    return { ok: true, override: { compliance_override_reason: reason.trim(), compliance_override_at: new Date().toISOString() } };
  }

  // Lien waiver check before paying a sub (migration 134). Reads fresh rather
  // than trusting cached state — a sub may have signed a minute ago. Mirrors
  // the database rule: needs a signed/received waiver and none outstanding.
  async function waiverGate(wo) {
    if (!wo.company_id) return { ok: true, override: {} };
    const [{ data: cfg }, { data: jobRow }, { data: ws }] = await Promise.all([
      supabase.from('app_settings').select('waiver_enforcement').eq('id', 1).maybeSingle(),
      supabase.from('jobs').select('lien_waivers_optional').eq('id', jobId).maybeSingle(),
      supabase.from('lien_waivers').select('status, company_id, work_order_id').eq('job_id', jobId).eq('direction', 'from_sub'),
    ]);
    const mode = cfg?.waiver_enforcement || 'warn';
    if (mode === 'off' || jobRow?.lien_waivers_optional) return { ok: true, override: {} };
    const mine = (ws || []).filter(w => w.work_order_id === wo.id || w.company_id === wo.company_id);
    const hasSigned = mine.some(w => ['signed', 'waived'].includes(w.status));
    const hasOpen = mine.some(w => ['requested', 'rejected'].includes(w.status));
    if (hasSigned && !hasOpen) return { ok: true, override: {} };
    const name = wo.companies?.company_name || 'This subcontractor';
    const why = hasOpen ? 'has a lien waiver that is still outstanding' : 'has no signed lien waiver on file';
    if (mode === 'warn') {
      return { ok: confirm(`${name} ${why}.\n\nMark this work order paid anyway?`), override: {} };
    }
    const reason = window.prompt(`${name} ${why}.\n\nLien waiver enforcement is set to Block. To mark paid anyway, enter a reason — it's recorded and sent to the office. Cancel to stop.`);
    if (!reason || !reason.trim()) return { ok: false, override: {} };
    return { ok: true, override: { waiver_override_reason: reason.trim(), waiver_override_at: new Date().toISOString() } };
  }

  useEffect(() => {
    loadWorkOrders();
    supabase.from('companies').select('id, company_name, contact_email, services_offered').eq('company_type', 'Subcontractor').order('company_name').then(({ data }) => { if (data) setSubcontractors(data); });
    supabase.from('job_scope_actions').select('*').eq('job_id', jobId).then(({ data }) => { if (data) setTradeActions(data); });
    const channel = supabase.channel(`work-orders-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `job_id=eq.${jobId}` }, loadWorkOrders).subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadWorkOrders]);

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (field === 'company_id' && tradeActions.length > 0) {
      const company = subcontractors.find(c => c.id === value);
      const services = company?.services_offered || [];
      const matchingIndices = tradeActions
        .map((a, i) => (services.includes(a.trade) ? i : null))
        .filter(i => i !== null);
      setSelectedScope(matchingIndices);
    }
  }

  const usingTradeActions = tradeActions.length > 0;
  const availableItems = usingTradeActions ? tradeActions.map(formatAction) : scopeItems;
  const tradeOptions = [...new Set(tradeActions.map(a => a.trade).filter(Boolean)), 'Other'];

  // Selection is tracked by index, not by the item's text — two rows can
  // easily format to identical-looking text (e.g. two generic "1 faucet
  // — install" entries), and matching by string value would make
  // checking one silently check every row sharing that text.
  function toggleScopeItem(index) {
    setSelectedScope(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
  }

  async function viewSubInvoice(wo) {
    const { data, error } = await supabase.storage.from('subcontractor-docs').createSignedUrl(wo.sub_invoice_storage_path, 300);
    if (!error && data) window.open(data.signedUrl, '_blank');
  }

  async function createWorkOrder(e) {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    setSaving(true);
    setSaveError('');
    const { error } = await supabase.from('work_orders').insert({
      job_id: jobId,
      company_id: form.company_id || null,
      trade: form.trade || null,
      description: form.description,
      amount: Math.round(parseFloat(form.amount) * 100) / 100,
      status: 'draft',
      included_scope_items: selectedScope.map(i => availableItems[i]).filter(Boolean),
    });
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setSelectedScope([]);
    setShowForm(false);
    // Don't rely solely on the realtime subscription above to pick this
    // up — same class of bug as elsewhere in this app where a table
    // wasn't reliably in the Supabase realtime publication. Refresh
    // directly so the new draft shows up immediately.
    await loadWorkOrders();
  }

  async function issueWorkOrder(wo) {
    if (!confirm('Issue this work order? This will log it as a committed cost on the job, and email the subcontractor.')) return;
    const gate = complianceGate(wo, 'Issue this work order');
    if (!gate.ok) return;
    const { error: woError } = await supabase.from('work_orders').update({ status: 'issued', issued_at: new Date().toISOString(), ...gate.override }).eq('id', wo.id);
    if (woError) { setSaveError(woError.message); return; }
    const { error: costError } = await supabase.from('job_costs').insert({
      job_id: jobId,
      category: 'subcontractor',
      description: wo.description || 'Work order',
      amount: wo.amount,
      status: 'committed',
      source_type: 'work_order',
      work_order_id: wo.id,
      company_id: wo.company_id,
    });
    if (costError) { setSaveError(costError.message); return; }

    const company = subcontractors.find(c => c.id === wo.company_id);
    if (company?.contact_email) {
      try {
        const { subject, html, text } = buildNewWorkOrderEmail({
          companyName: company.company_name,
          description: wo.description,
          projectAddress,
        });
        const { data: { session } } = await supabase.auth.getSession();
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: company.contact_email, subject, html, text, category: 'subcontractor_work_order', jobId, sentBy: session?.user?.email || null }),
        });
      } catch {
        // best-effort — the work order is already issued regardless of whether the email went through
      }
    }
    // Same fix as createWorkOrder above — refresh directly rather than
    // depending solely on the realtime subscription.
    await loadWorkOrders();
  }

  function startInvoicing(wo) {
    setInvoicingId(wo.id);
    setInvoiceAmount(String(wo.amount));
  }

  async function confirmInvoiced(wo) {
    const amt = Math.round(parseFloat(invoiceAmount) * 100) / 100;
    if (!amt) return;
    const { error: woError } = await supabase.from('work_orders').update({ status: 'invoiced', invoiced_amount: amt }).eq('id', wo.id);
    if (woError) { setSaveError(woError.message); return; }
    // Move the linked job_cost from committed to actual, using the real invoiced amount.
    const { error: costError } = await supabase.from('job_costs').update({ status: 'actual', amount: amt }).eq('work_order_id', wo.id);
    if (costError) { setSaveError(costError.message); return; }
    setInvoicingId(null);
    setInvoiceAmount('');
    await loadWorkOrders();
  }

  async function markPaid(wo) {
    const gate = complianceGate(wo, 'Mark this work order paid');
    if (!gate.ok) return;
    const wGate = await waiverGate(wo);
    if (!wGate.ok) return;
    const { error } = await supabase.from('work_orders').update({ status: 'paid', paid_at: new Date().toISOString(), ...gate.override, ...wGate.override }).eq('id', wo.id);
    if (error) { setSaveError(error.message); return; }
    await loadWorkOrders();
  }

  async function reopenWorkOrder(wo) {
    const { error } = await supabase.from('work_orders').update({ status: 'draft', declined_at: null, decline_reason: null }).eq('id', wo.id);
    if (error) { setSaveError(error.message); return; }
    await loadWorkOrders();
  }

  async function deleteWorkOrder(wo) {
    if (!confirm('Delete this work order? This also removes its linked job cost entry, if any.')) return;
    const { error: costError } = await supabase.from('job_costs').delete().eq('work_order_id', wo.id);
    if (costError) { setSaveError(costError.message); return; }
    const { error: woError } = await supabase.from('work_orders').delete().eq('id', wo.id);
    if (woError) { setSaveError(woError.message); return; }
    await loadWorkOrders();
  }

  return (
    <div className="card">
      <h3>Work Orders</h3>
      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ New Work Order'}</button>
      </div>

      {showForm && (
        <form onSubmit={createWorkOrder} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div>
              <label>Trade</label>
              <select value={form.trade} onChange={e => update('trade', e.target.value)}>
                <option value="">Select…</option>
                {tradeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Subcontractor</label>
              <select value={form.company_id} onChange={e => update('company_id', e.target.value)}>
                <option value="">Select…</option>
                {subcontractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              {subcontractors.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  No subcontractors yet — add one under the Subcontractors tab.
                </div>
              )}
              {form.company_id && compliance[form.company_id]?.overall === 'noncompliant' && (
                <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 4 }}>
                  Not compliant: {complianceGapText(compliance[form.company_id].summary)}
                  {enforcement === 'block' ? ' — you won\'t be able to issue this work order without an override reason.' : ''}
                </div>
              )}
            </div>
            <div><label>Committed amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} required /></div>
          </div>

          {availableItems.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <label>Include on this work order</label>
              <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, background: 'var(--card-bg)', maxHeight: 180, overflowY: 'auto' }}>
                {availableItems.map((item, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, fontWeight: 400, marginBottom: 6, cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={selectedScope.includes(i)} onChange={() => toggleScopeItem(i)} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label style={{ marginTop: 8 }}>Additional details</label>
          <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={2} required />
          {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save as draft'}</button>
          </div>
        </form>
      )}

      {saveError && <div style={{ fontSize: 12, color: '#a13f3f', margin: '10px 0' }}>{saveError}</div>}
      {workOrders.length === 0 && <div className="empty-state" style={{ marginTop: 12 }}>No work orders yet.</div>}

      {workOrders.map(wo => (
        <div key={wo.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 13 }}>
              <b>{wo.companies?.company_name || 'No subcontractor selected'}</b> — {fmtMoney(wo.amount)}
              {wo.invoiced_amount != null && wo.invoiced_amount !== wo.amount && (
                <span style={{ color: 'var(--ink-soft)' }}> (invoiced {fmtMoney(wo.invoiced_amount)})</span>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{wo.description}</div>
              {wo.status === 'declined' && (
                <div style={{ fontSize: 11.5, color: '#a13f3f', marginTop: 2 }}>Declined{wo.decline_reason ? `: ${wo.decline_reason}` : ' (no reason given)'}</div>
              )}
              {wo.sub_invoice_filename && (
                <div style={{ fontSize: 11.5, color: '#3a6b45', marginTop: 2 }}>📎 Sub uploaded an invoice — {wo.sub_invoice_filename}</div>
              )}
            </div>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
              {wo.company_id && ['noncompliant', 'expiring'].includes(compliance[wo.company_id]?.overall) && wo.status !== 'paid' && (
                <span
                  title={complianceGapText(compliance[wo.company_id].summary)}
                  style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, color: COMPLIANCE_OVERALL[compliance[wo.company_id].overall].color, background: COMPLIANCE_OVERALL[compliance[wo.company_id].overall].bg }}
                >
                  {COMPLIANCE_OVERALL[compliance[wo.company_id].overall].label}
                </span>
              )}
            </span>
          </div>

          <div className="section-actions" style={{ marginTop: 8 }}>
            <Link href={`/jobs/${jobId}/work-orders/${wo.id}`} className="btn btn-sm">View Document</Link>
            {wo.sub_invoice_storage_path && (
              <button className="btn btn-sm" onClick={() => viewSubInvoice(wo)}>View Sub's Invoice</button>
            )}
            {wo.status === 'draft' && <button className="btn btn-sm" onClick={() => issueWorkOrder(wo)}>Issue</button>}
            {wo.status === 'declined' && <button className="btn btn-sm" onClick={() => reopenWorkOrder(wo)}>Reopen as Draft</button>}
            {(wo.status === 'issued' || wo.status === 'accepted' || wo.status === 'completed') && invoicingId !== wo.id && (
              <button className="btn btn-sm" onClick={() => startInvoicing(wo)}>Mark Invoiced</button>
            )}
            {wo.status === 'invoiced' && <button className="btn btn-sm" onClick={() => markPaid(wo)}>Mark Paid</button>}
            {(wo.status === 'accepted' || wo.status === 'completed' || wo.status === 'invoiced' || wo.status === 'paid') && (
              <button className="btn btn-sm" onClick={() => setPhotosOpenId(photosOpenId === wo.id ? null : wo.id)}>
                {photosOpenId === wo.id ? 'Hide Photos' : 'Photos'}
              </button>
            )}
            <button className="btn btn-sm btn-danger" onClick={() => deleteWorkOrder(wo)}>Delete</button>
          </div>

          {invoicingId === wo.id && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input style={{ maxWidth: 140 }} value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="Actual invoiced amount" />
              <button className="btn btn-primary btn-sm" onClick={() => confirmInvoiced(wo)}>Confirm</button>
              <button className="btn btn-sm" onClick={() => setInvoicingId(null)}>Cancel</button>
            </div>
          )}

          {photosOpenId === wo.id && <WorkOrderPhotosPanel workOrderId={wo.id} />}
        </div>
      ))}
    </div>
  );
}

