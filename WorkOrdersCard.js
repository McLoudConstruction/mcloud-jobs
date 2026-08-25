'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { WORK_ORDER_STATUS_LABELS } from '../lib/constants';
import { buildNewWorkOrderEmail } from '../lib/emailTemplates';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAction(a) {
  const qty = a.quantity ?? 1;
  const unit = a.unit_label ? ` ${a.unit_label}${qty === 1 ? '' : 's'}` : '';
  return `${qty}${unit} — ${a.description}`;
}

const EMPTY_FORM = { company_id: '', description: '', amount: '' };

export default function WorkOrdersCard({ jobId, scopeItems = [], projectAddress }) {
  const [workOrders, setWorkOrders] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [tradeActions, setTradeActions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedScope, setSelectedScope] = useState([]);
  const [saving, setSaving] = useState(false);
  const [invoicingId, setInvoicingId] = useState(null);
  const [invoiceAmount, setInvoiceAmount] = useState('');

  const loadWorkOrders = useCallback(async () => {
    const { data } = await supabase.from('work_orders').select('*, companies(company_name)').eq('job_id', jobId).order('created_at', { ascending: false });
    if (data) setWorkOrders(data);
  }, [jobId]);

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
    await supabase.from('work_orders').insert({
      job_id: jobId,
      company_id: form.company_id || null,
      description: form.description,
      amount: parseFloat(form.amount),
      status: 'draft',
      included_scope_items: selectedScope.map(i => availableItems[i]).filter(Boolean),
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setSelectedScope([]);
    setShowForm(false);
  }

  async function issueWorkOrder(wo) {
    if (!confirm('Issue this work order? This will log it as a committed cost on the job, and email the subcontractor.')) return;
    await supabase.from('work_orders').update({ status: 'issued', issued_at: new Date().toISOString() }).eq('id', wo.id);
    await supabase.from('job_costs').insert({
      job_id: jobId,
      category: 'subcontractor',
      description: wo.description || 'Work order',
      amount: wo.amount,
      status: 'committed',
      source_type: 'work_order',
      work_order_id: wo.id,
      company_id: wo.company_id,
    });

    const company = subcontractors.find(c => c.id === wo.company_id);
    if (company?.contact_email) {
      try {
        const { subject, html, text } = buildNewWorkOrderEmail({
          companyName: company.company_name,
          description: wo.description,
          projectAddress,
        });
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: company.contact_email, subject, html, text }),
        });
      } catch {
        // best-effort — the work order is already issued regardless of whether the email went through
      }
    }
  }

  function startInvoicing(wo) {
    setInvoicingId(wo.id);
    setInvoiceAmount(String(wo.amount));
  }

  async function confirmInvoiced(wo) {
    const amt = parseFloat(invoiceAmount);
    if (!amt) return;
    await supabase.from('work_orders').update({ status: 'invoiced', invoiced_amount: amt }).eq('id', wo.id);
    // Move the linked job_cost from committed to actual, using the real invoiced amount.
    await supabase.from('job_costs').update({ status: 'actual', amount: amt }).eq('work_order_id', wo.id);
    setInvoicingId(null);
    setInvoiceAmount('');
  }

  async function markPaid(wo) {
    await supabase.from('work_orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', wo.id);
  }

  async function reopenWorkOrder(wo) {
    await supabase.from('work_orders').update({ status: 'draft', declined_at: null, decline_reason: null }).eq('id', wo.id);
  }

  async function deleteWorkOrder(wo) {
    if (!confirm('Delete this work order? This also removes its linked job cost entry, if any.')) return;
    await supabase.from('job_costs').delete().eq('work_order_id', wo.id);
    await supabase.from('work_orders').delete().eq('id', wo.id);
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
            </div>
            <div><label>Committed amount ($)</label><input value={form.amount} onChange={e => update('amount', e.target.value)} required /></div>
          </div>

          {availableItems.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <label>Include on this work order</label>
              {usingTradeActions && form.company_id && (
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>
                  Pre-checked based on this subcontractor's trade — add or remove as needed.
                </div>
              )}
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
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save as draft'}</button>
          </div>
        </form>
      )}

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
            <span className={`badge badge-${wo.status}`} style={{ flexShrink: 0 }}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
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
            <button className="btn btn-sm btn-danger" onClick={() => deleteWorkOrder(wo)}>Delete</button>
          </div>

          {invoicingId === wo.id && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input style={{ maxWidth: 140 }} value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="Actual invoiced amount" />
              <button className="btn btn-primary btn-sm" onClick={() => confirmInvoiced(wo)}>Confirm</button>
              <button className="btn btn-sm" onClick={() => setInvoicingId(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

