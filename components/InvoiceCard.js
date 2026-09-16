'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Rounds to the cent and drops trailing zeros in a way that's safe to
// put back into a text input (unlike toLocaleString, which would add
// thousands separators the field can't parse back out). Guards against
// both new floating-point division artifacts and any already-saved
// value from before that was rounded at the source.
function roundMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) ? n : '';
}

export default function InvoiceCard({ job, onSave, jobId }) {
  const router = useRouter();
  const [amount, setAmount] = useState(roundMoney(job.invoice_amount ?? job.contract_price ?? ''));
  const [description, setDescription] = useState(job.invoice_description || '');
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
      invoice_amount: amount ? roundMoney(String(amount).replace(/[^0-9.]/g, '')) : null,
      invoice_description: description || null,
      invoice_status: status,
      invoiced_at: invoicedAt || null,
    });
  }

  function generateInvoice() {
    saveOnly();
    router.push(`/jobs/${jobId}/invoice`);
  }

  const contractTotal = job.contract_price != null ? Number(job.contract_price) : null;
  // The amount field defaults to the contract price before anything's
  // actually been invoiced (see useState above) — so it can't be used
  // directly here, or this reads as fully billed on a brand-new,
  // never-sent invoice. Nothing is actually billed until it's gone out.
  const billedAmount = status === 'not_sent' ? 0 : (amount ? Number(amount) : 0);

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
      <label>Description</label>
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this invoice covers" />
      <label>Invoiced date {status === 'not_sent' ? '' : '(auto-set — edit if needed)'}</label>
      <input type="date" value={invoicedAt} onChange={e => setInvoicedAt(e.target.value)} disabled={status === 'not_sent'} />
      {contractTotal != null && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>
          {'$' + billedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of {'$' + contractTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} billed
        </div>
      )}
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={generateInvoice}>Generate Invoice</button>
        <button className="btn btn-sm" onClick={saveOnly}>Save</button>
      </div>
    </div>
  );
}
