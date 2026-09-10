'use client';

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Deliberately separate from the job's stage — Completed/Invoiced still
// mean what they meant before. This is just a lightweight signal a PM
// can raise for the office without needing Financials access or having
// to move the job's stage themselves.
//
// Rendered as a slim banner rather than its own card: it's a one-line
// status flag, not a feature with its own section, and a full card here
// just stacked awkwardly on top of the Invoicing and Invoice cards
// right below it.
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
    <div className={`flag-banner ${flagged ? 'flag-banner-active' : ''}`}>
      <span>
        {flagged
          ? `✓ Flagged ready to invoice ${fmtDate(job.ready_to_invoice_at)} — shows on the Invoices dashboard.`
          : 'Not flagged for billing yet — this stays separate from the job stage.'}
      </span>
      <button className={`btn btn-sm ${flagged ? '' : 'btn-primary'}`} onClick={toggle} type="button">
        {flagged ? 'Unflag' : 'Mark Ready to Invoice'}
      </button>
    </div>
  );
}

