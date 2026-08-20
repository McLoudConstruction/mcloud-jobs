'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function InvoicesDashboardPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [draws, setDraws] = useState([]);

  const loadAll = useCallback(async () => {
    const [{ data: j }, { data: d }] = await Promise.all([
      supabase.from('jobs').select('*').in('stage', ['active', 'completed', 'invoiced']),
      supabase.from('invoices').select('*'),
    ]);
    if (j) setJobs(j);
    if (d) setDraws(d);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
    const channel = supabase.channel('invoices-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  if (loading || !session) return null;

  const rows = jobs.map(j => {
    const jobDraws = draws.filter(d => d.job_id === j.id);
    const usesDraws = jobDraws.length > 0;

    let status, urgency, outstanding;
    if (usesDraws) {
      const unsent = jobDraws.filter(d => d.status === 'not_sent').length;
      const sent = jobDraws.filter(d => d.status === 'sent').length;
      const paid = jobDraws.filter(d => d.status === 'paid').length;
      outstanding = jobDraws.filter(d => d.status !== 'paid').reduce((s, d) => s + Number(d.amount || 0), 0);
      if (unsent > 0) { status = `${unsent} draw${unsent === 1 ? '' : 's'} not yet sent`; urgency = 2; }
      else if (sent > 0) { status = `${sent} draw${sent === 1 ? '' : 's'} awaiting payment`; urgency = 1; }
      else if (paid === jobDraws.length) { status = 'Fully paid'; urgency = 0; }
      else { status = 'Draws in progress'; urgency = 1; }
    } else {
      outstanding = j.invoice_status === 'paid' ? 0 : Number(j.invoice_amount || 0);
      if (!j.invoice_amount) { status = 'No invoice issued yet'; urgency = j.stage === 'completed' ? 3 : 2; }
      else if (j.invoice_status === 'not_sent') { status = 'Invoice drafted, not sent'; urgency = 3; }
      else if (j.invoice_status === 'sent') { status = 'Invoice sent, awaiting payment'; urgency = 1; }
      else { status = 'Paid'; urgency = 0; }
    }

    return { ...j, usesDraws, status, urgency, outstanding };
  })
    .filter(r => r.urgency > 0) // only show jobs that actually need attention
    .sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return new Date(a.expected_close_date || '9999-12-31') - new Date(b.expected_close_date || '9999-12-31');
    });

  return (
    <AppShell>
      <div className="container container-wide">
        <h2 style={{ margin: '0 0 6px', color: 'var(--heading)' }}>Invoices</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Jobs nearing completion or with invoicing action still needed. Click a row to issue or manage its invoice.
        </div>

        {rows.length === 0 && <div className="empty-state">Nothing needs invoicing attention right now.</div>}
        {rows.length > 0 && (
          <DataTable
            getRowKey={r => r.id}
            onRowClick={r => window.location.href = `/jobs/${r.id}?tab=Financials`}
            rows={rows}
            columns={[
              { key: 'job_number', label: 'Job #', defaultWidth: 100, render: r => `#${r.job_number}` },
              { key: 'customer_name', label: 'Customer', defaultWidth: 190, render: r => r.customer_name || 'Unnamed' },
              { key: 'stage', label: 'Stage', defaultWidth: 110, render: r => r.stage },
              { key: 'expected_close_date', label: 'Expected Close', defaultWidth: 130, filterable: false, render: r => fmtDate(r.expected_close_date) },
              { key: 'billing_type', label: 'Billing Type', defaultWidth: 120, filterable: false, render: r => r.usesDraws ? 'Draws' : 'Single Invoice' },
              { key: 'status', label: 'Status', defaultWidth: 220, render: r => r.status },
              { key: 'outstanding', label: 'Outstanding', defaultWidth: 120, filterable: false, render: r => fmtMoney(r.outstanding) },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
