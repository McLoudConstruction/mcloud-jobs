'use client';
import { useState } from 'react';

export default function InvoiceCard({ job, onSave, jobId }) {
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
