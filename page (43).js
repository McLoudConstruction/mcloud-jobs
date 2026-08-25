'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function agingLabel(days) {
  if (days === null) return '—';
  if (days <= 30) return `${days}d`;
  if (days <= 60) return `${days}d (30+)`;
  if (days <= 90) return `${days}d (60+)`;
  return `${days}d (90+)`;
}

export default function ReceivablePage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [draws, setDraws] = useState([]);

  const loadAll = useCallback(async () => {
    const [{ data: j }, { data: inv }] = await Promise.all([
      supabase.from('jobs').select('*').eq('invoice_status', 'sent'),
      supabase.from('invoices').select('*, jobs(job_number, customer_name)').eq('status', 'sent'),
    ]);
    if (j) setJobs(j);
    if (inv) setDraws(inv);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
    const channel = supabase
      .channel('ar-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  if (loading || !session) return null;

  // A job with any draws is billed via progress invoicing — its old single
  // invoice_status field is no longer the source of truth, so exclude it
  // from the single-invoice list to avoid double-counting.
  const jobsWithDraws = new Set(draws.map(d => d.job_id));
  const singleInvoiceJobs = jobs.filter(j => !jobsWithDraws.has(j.id));

  const total = singleInvoiceJobs.reduce((s, j) => s + Number(j.invoice_amount || 0), 0) + draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  const sortedJobs = singleInvoiceJobs.slice().sort((a, b) => new Date(a.invoiced_at || 0) - new Date(b.invoiced_at || 0));
  const sortedDraws = draws.slice().sort((a, b) => new Date(a.invoiced_at || 0) - new Date(b.invoiced_at || 0));

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Accounts Receivable</h2>

        <div className="card">
          <div className="portal-info-label">Total Open Receivables</div>
          <div className="portal-info-value" style={{ fontSize: 22 }}>{fmtMoney(total)}</div>
        </div>

        <div className="card">
          <h3>Unpaid Draws (Progress Invoicing)</h3>
          {sortedDraws.length === 0 && <div className="empty-state">Nothing outstanding.</div>}
          {sortedDraws.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Job #</th>
                    <th style={{ width: 160 }}>Customer</th>
                    <th style={{ width: 160 }}>Draw</th>
                    <th style={{ width: 120 }}>Amount</th>
                    <th style={{ width: 100 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDraws.map(d => (
                    <tr key={d.id} onClick={() => window.location.href = `/jobs/${d.job_id}?tab=Financials`}>
                      <td>{d.jobs ? `#${d.jobs.job_number}` : '—'}</td>
                      <td>{d.jobs?.customer_name || 'Unnamed'}</td>
                      <td>{d.description || 'Draw'}</td>
                      <td>{fmtMoney(d.amount)}</td>
                      <td>{agingLabel(daysAgo(d.invoiced_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Unpaid Single Invoices</h3>
          {sortedJobs.length === 0 && <div className="empty-state">Nothing outstanding.</div>}
          {sortedJobs.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Job #</th>
                    <th style={{ width: 200 }}>Customer</th>
                    <th style={{ width: 130 }}>Amount</th>
                    <th style={{ width: 110 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedJobs.map(j => (
                    <tr key={j.id} onClick={() => window.location.href = `/jobs/${j.id}?tab=Financials`}>
                      <td>#{j.job_number}</td>
                      <td>{j.customer_name || 'Unnamed'}</td>
                      <td>{fmtMoney(j.invoice_amount)}</td>
                      <td>{agingLabel(daysAgo(j.invoiced_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
