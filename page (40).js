'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function FinancialDashboardPage() {
  const { session, loading } = useRequireAuth();
  const [jobs, setJobs] = useState([]);
  const [jobCosts, setJobCosts] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [businessExpenses, setBusinessExpenses] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [draws, setDraws] = useState([]);
  const [drillDown, setDrillDown] = useState(null); // 'revenue' | 'costs' | 'ap' | 'ar' | null

  const loadAll = useCallback(async () => {
    const [{ data: j }, { data: jc }, { data: wo }, { data: be }, { data: r }, { data: inv }] = await Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('job_costs').select('*'),
      supabase.from('work_orders').select('*, jobs(job_number, customer_name), companies(company_name)'),
      supabase.from('business_expenses').select('*'),
      supabase.from('receipts').select('*, jobs(job_number)'),
      supabase.from('invoices').select('*, jobs(job_number, customer_name)'),
    ]);
    if (j) setJobs(j);
    if (jc) setJobCosts(jc);
    if (wo) setWorkOrders(wo);
    if (be) setBusinessExpenses(be);
    if (r) setReceipts(r);
    if (inv) setDraws(inv);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
    const channel = supabase
      .channel('financial-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_expenses' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  if (loading || !session) return null;

  const now = new Date();
  const jobsWithDraws = new Set(draws.map(d => d.job_id));

  const incomeFromSingleInvoice = jobs.filter(j => !jobsWithDraws.has(j.id) && j.invoice_status === 'paid' && j.invoiced_at && new Date(j.invoiced_at).getFullYear() === now.getFullYear())
    .reduce((s, j) => s + Number(j.invoice_amount || 0), 0);
  const incomeFromDraws = draws.filter(d => d.status === 'paid' && d.paid_at && new Date(d.paid_at).getFullYear() === now.getFullYear())
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const incomeYtd = incomeFromSingleInvoice + incomeFromDraws;

  const incomeMtdSingle = jobs.filter(j => !jobsWithDraws.has(j.id) && j.invoice_status === 'paid' && j.invoiced_at && new Date(j.invoiced_at).getFullYear() === now.getFullYear() && new Date(j.invoiced_at).getMonth() === now.getMonth())
    .reduce((s, j) => s + Number(j.invoice_amount || 0), 0);
  const incomeMtdDraws = draws.filter(d => d.status === 'paid' && d.paid_at && new Date(d.paid_at).getFullYear() === now.getFullYear() && new Date(d.paid_at).getMonth() === now.getMonth())
    .reduce((s, d) => s + Number(d.amount || 0), 0);
  const incomeMtd = incomeMtdSingle + incomeMtdDraws;

  const totalActualCosts = jobCosts.filter(c => c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
  const totalCommittedCosts = jobCosts.filter(c => c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);

  const openAP = workOrders.filter(wo => wo.status !== 'paid').reduce((s, wo) => s + Number(wo.invoiced_amount ?? wo.amount ?? 0), 0)
    + businessExpenses.filter(be => be.payment_status === 'unpaid').reduce((s, be) => s + Number(be.amount || 0), 0)
    + receipts.filter(r => r.payment_status === 'unpaid').reduce((s, r) => s + Number(r.amount || 0), 0);
  const openAR = jobs.filter(j => !jobsWithDraws.has(j.id) && j.invoice_status === 'sent').reduce((s, j) => s + Number(j.invoice_amount || 0), 0)
    + draws.filter(d => d.status === 'sent').reduce((s, d) => s + Number(d.amount || 0), 0);

  const grossProfit = incomeYtd - totalActualCosts;

  const revenueYtd = jobs.filter(j => j.approved_at && new Date(j.approved_at).getFullYear() === now.getFullYear())
    .reduce((s, j) => s + Number(j.contract_price || 0), 0);
  const revenueMtd = jobs.filter(j => j.approved_at && new Date(j.approved_at).getFullYear() === now.getFullYear() && new Date(j.approved_at).getMonth() === now.getMonth())
    .reduce((s, j) => s + Number(j.contract_price || 0), 0);

  const jobRows = jobs.map(j => {
    const costs = jobCosts.filter(c => c.job_id === j.id);
    const actual = costs.filter(c => c.status === 'actual').reduce((s, c) => s + Number(c.amount || 0), 0);
    const committed = costs.filter(c => c.status === 'committed').reduce((s, c) => s + Number(c.amount || 0), 0);
    const total = actual + committed;
    const margin = j.contract_price != null ? Number(j.contract_price) - total : null;
    const marginPercent = margin != null && j.contract_price ? (margin / Number(j.contract_price)) * 100 : null;
    return { ...j, actual, committed, total, margin, marginPercent };
  }).filter(j => j.total > 0 || j.contract_price); // only show jobs with any financial activity

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Financials</h2>

        <div className="portal-info-grid" style={{ marginBottom: 4 }}>
          <button className="kpi-card" onClick={() => setDrillDown(drillDown === 'revenue' ? null : 'revenue')}>
            <div className="portal-info-label">Revenue YTD</div>
            <div className="portal-info-value">{fmtMoney(revenueYtd)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtMoney(revenueMtd)} this month</div>
          </button>
          <button className="kpi-card" onClick={() => setDrillDown(drillDown === 'income' ? null : 'income')}>
            <div className="portal-info-label">Income YTD</div>
            <div className="portal-info-value">{fmtMoney(incomeYtd)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtMoney(incomeMtd)} this month</div>
          </button>
          <button className="kpi-card" onClick={() => setDrillDown(drillDown === 'costs' ? null : 'costs')}>
            <div className="portal-info-label">Total Job Costs</div>
            <div className="portal-info-value">{fmtMoney(totalActualCosts + totalCommittedCosts)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{fmtMoney(totalCommittedCosts)} committed</div>
          </button>
          <button className="kpi-card" onClick={() => setDrillDown(drillDown === 'ap' ? null : 'ap')}>
            <div className="portal-info-label">Open AP</div>
            <div className="portal-info-value">{fmtMoney(openAP)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Owed to subs &amp; vendors</div>
          </button>
          <button className="kpi-card" onClick={() => setDrillDown(drillDown === 'ar' ? null : 'ar')}>
            <div className="portal-info-label">Open AR</div>
            <div className="portal-info-value">{fmtMoney(openAR)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Owed by customers</div>
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>
          Revenue = contract price the month a job is Approved (sold). Income = cash actually collected.
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="portal-info-label">Gross Profit YTD (Income − Actual Costs)</div>
          <div className="portal-info-value" style={{ fontSize: 22, color: grossProfit < 0 ? '#a13f3f' : undefined }}>{fmtMoney(grossProfit)}</div>
        </div>

        {drillDown === 'income' && (
          <div className="card">
            <h3>Cash Collected This Year</h3>
            {jobs.filter(j => !jobsWithDraws.has(j.id) && j.invoice_status === 'paid' && j.invoiced_at && new Date(j.invoiced_at).getFullYear() === now.getFullYear()).map(j => (
              <DrillRow key={j.id} href={`/jobs/${j.id}?tab=Financials`} label={`#${j.job_number} — ${j.customer_name || 'Unnamed'}`} value={fmtMoney(j.invoice_amount)} />
            ))}
            {draws.filter(d => d.status === 'paid' && d.paid_at && new Date(d.paid_at).getFullYear() === now.getFullYear()).map(d => (
              <DrillRow key={d.id} href={d.job_id ? `/jobs/${d.job_id}?tab=Financials` : undefined} label={`${d.jobs ? `#${d.jobs.job_number}` : ''} — ${d.description || 'Draw'}`} value={fmtMoney(d.amount)} />
            ))}
          </div>
        )}

        {drillDown === 'revenue' && (
          <div className="card">
            <h3>Jobs Approved This Year</h3>
            {jobs.filter(j => j.approved_at && new Date(j.approved_at).getFullYear() === now.getFullYear()).map(j => (
              <DrillRow key={j.id} href={`/jobs/${j.id}?tab=Financials`} label={`#${j.job_number} — ${j.customer_name || 'Unnamed'}`} value={fmtMoney(j.contract_price)} />
            ))}
          </div>
        )}

        {drillDown === 'costs' && (
          <div className="card">
            <h3>All Job Costs</h3>
            {jobCosts.slice().sort((a, b) => new Date(b.cost_date) - new Date(a.cost_date)).map(c => {
              const job = jobs.find(j => j.id === c.job_id);
              return (
                <DrillRow
                  key={c.id}
                  href={job ? `/jobs/${job.id}?tab=Financials` : undefined}
                  label={`${job ? `#${job.job_number}` : 'Unknown job'} — ${c.description || c.category} (${c.status})`}
                  value={fmtMoney(c.amount)}
                />
              );
            })}
          </div>
        )}

        {drillDown === 'ap' && (
          <div className="card">
            <h3>Open Payables</h3>
            {workOrders.filter(wo => wo.status !== 'paid').map(wo => (
              <DrillRow
                key={wo.id}
                href={wo.job_id ? `/jobs/${wo.job_id}?tab=Financials` : undefined}
                label={`${wo.companies?.company_name || 'Unknown company'} — ${wo.jobs ? `#${wo.jobs.job_number}` : ''} (${wo.status})`}
                value={fmtMoney(wo.invoiced_amount ?? wo.amount)}
              />
            ))}
            {businessExpenses.filter(be => be.payment_status === 'unpaid').map(be => (
              <DrillRow key={be.id} label={`${be.vendor_name || 'Business expense'} (overhead)`} value={fmtMoney(be.amount)} />
            ))}
            {receipts.filter(r => r.payment_status === 'unpaid').map(r => (
              <DrillRow
                key={r.id}
                href={r.job_id ? `/jobs/${r.job_id}?tab=Financials` : undefined}
                label={`${r.vendor_name || 'Receipt'} — ${r.jobs ? `#${r.jobs.job_number}` : 'unlinked'} (unpaid)`}
                value={fmtMoney(r.amount)}
              />
            ))}
          </div>
        )}

        {drillDown === 'ar' && (
          <div className="card">
            <h3>Open Receivables</h3>
            {jobs.filter(j => !jobsWithDraws.has(j.id) && j.invoice_status === 'sent').map(j => (
              <DrillRow key={j.id} href={`/jobs/${j.id}?tab=Financials`} label={`#${j.job_number} — ${j.customer_name || 'Unnamed'}`} value={fmtMoney(j.invoice_amount)} />
            ))}
            {draws.filter(d => d.status === 'sent').map(d => (
              <DrillRow key={d.id} href={d.job_id ? `/jobs/${d.job_id}?tab=Financials` : undefined} label={`${d.jobs ? `#${d.jobs.job_number}` : ''} — ${d.description || 'Draw'} (${d.jobs?.customer_name || ''})`} value={fmtMoney(d.amount)} />
            ))}
          </div>
        )}

        <div className="card">
          <h3>Jobs — Cost &amp; Margin</h3>
          {jobRows.length === 0 && <div className="empty-state">No job financial activity yet.</div>}
          {jobRows.length > 0 && (
            <DataTable
              getRowKey={j => j.id}
              onRowClick={j => window.location.href = `/jobs/${j.id}?tab=Financials`}
              rows={jobRows}
              columns={[
                { key: 'job_number', label: 'Job #', defaultWidth: 100, render: j => `#${j.job_number}` },
                { key: 'customer_name', label: 'Customer', defaultWidth: 170, render: j => j.customer_name || 'Unnamed' },
                { key: 'contract_price', label: 'Contract Price', defaultWidth: 130, filterable: false, render: j => fmtMoney(j.contract_price) },
                { key: 'projected_cost', label: 'Projected Cost', defaultWidth: 130, filterable: false, render: j => fmtMoney(j.projected_cost) },
                { key: 'committed', label: 'Committed Cost', defaultWidth: 130, filterable: false, render: j => fmtMoney(j.committed) },
                { key: 'actual', label: 'Actual Cost', defaultWidth: 120, filterable: false, render: j => fmtMoney(j.actual) },
                { key: 'margin', label: 'Actual Margin', defaultWidth: 130, filterable: false, render: j => <span style={{ color: j.margin != null && j.margin < 0 ? '#a13f3f' : undefined }}>{fmtMoney(j.margin)}</span> },
                { key: 'marginPercent', label: 'Margin %', defaultWidth: 100, filterable: false, render: j => <span style={{ color: j.marginPercent != null && j.marginPercent < 0 ? '#a13f3f' : undefined }}>{j.marginPercent != null ? `${j.marginPercent.toFixed(1)}%` : '—'}</span> },
              ]}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DrillRow({ href, label, value }) {
  const content = (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
  return href ? <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{content}</Link> : content;
}
