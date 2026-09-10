'use client';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Deliberately separate from the job's stage — Completed/Invoiced still
// mean what they meant before. This is just a lightweight signal a PM
// can raise for the office without needing Financials access or having
// to move the job's stage themselves.
export default function ReadyToInvoiceCard({ job, session, onSave }) {
  const flagged = !!job.ready_to_invoice;

  async function toggle() {
    if (flagged) {
      await onSave({ ready_to_invoice: false, ready_to_invoice_at: null, ready_to_invoice_by: null });
    } else {
      await onSave({ ready_to_invoice: true, ready_to_invoice_at: new Date().toISOString(), ready_to_invoice_by: session?.user?.id || null });
    }
  }

  return (
    <div className="card">
      <div className="section-actions" style={{ marginTop: 0, marginBottom: flagged ? 6 : 0 }}>
        <h3 style={{ margin: 0 }}>Ready to Invoice</h3>
        <button className={`btn btn-sm ${flagged ? '' : 'btn-primary'}`} onClick={toggle} type="button">
          {flagged ? 'Unflag' : 'Mark Ready to Invoice'}
        </button>
      </div>
      {flagged ? (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          Flagged {fmtDate(job.ready_to_invoice_at)} — this shows up on the Invoices dashboard.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
          Flags this job for billing on the Invoices dashboard without changing its stage.
        </div>
      )}
    </div>
  );
}
