'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { WORK_ORDER_STATUS_LABELS } from '../../../lib/constants';

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

export default function PayablePage() {
  const { session, loading } = useRequireAuth();
  const [workOrders, setWorkOrders] = useState([]);
  const [businessExpenses, setBusinessExpenses] = useState([]);
  const [receipts, setReceipts] = useState([]);

  const loadAll = useCallback(async () => {
    const [{ data: wo }, { data: be }, { data: r }] = await Promise.all([
      supabase.from('work_orders').select('*, jobs(job_number, customer_name), companies(company_name)').neq('status', 'paid'),
      supabase.from('business_expenses').select('*').eq('payment_status', 'unpaid'),
      supabase.from('receipts').select('*, jobs(job_number)').eq('payment_status', 'unpaid'),
    ]);
    if (wo) setWorkOrders(wo);
    if (be) setBusinessExpenses(be);
    if (r) setReceipts(r);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
    const channel = supabase
      .channel('ap-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_expenses' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  if (loading || !session) return null;

  const totalWO = workOrders.reduce((s, wo) => s + Number(wo.invoiced_amount ?? wo.amount ?? 0), 0);
  const totalBE = businessExpenses.reduce((s, be) => s + Number(be.amount || 0), 0);
  const totalReceipts = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Accounts Payable</h2>

        <div className="card">
          <div className="portal-info-label">Total Open Payables</div>
          <div className="portal-info-value" style={{ fontSize: 22 }}>{fmtMoney(totalWO + totalBE + totalReceipts)}</div>
        </div>

        <div className="card">
          <h3>Subcontractor &amp; Vendor Work Orders</h3>
          {workOrders.length === 0 && <div className="empty-state">Nothing outstanding.</div>}
          {workOrders.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Company</th>
                    <th style={{ width: 110 }}>Job</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 120 }}>Amount</th>
                    <th style={{ width: 100 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map(wo => (
                    <tr key={wo.id} onClick={() => window.location.href = wo.job_id ? `/jobs/${wo.job_id}?tab=Financials` : '#'}>
                      <td>{wo.companies?.company_name || 'Unknown'}</td>
                      <td>{wo.jobs ? `#${wo.jobs.job_number}` : '—'}</td>
                      <td>{WORK_ORDER_STATUS_LABELS[wo.status]}</td>
                      <td>{fmtMoney(wo.invoiced_amount ?? wo.amount)}</td>
                      <td>{agingLabel(daysAgo(wo.issued_at || wo.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Business Expenses (Overhead)</h3>
          {businessExpenses.length === 0 && <div className="empty-state">None logged yet.</div>}
          {businessExpenses.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>Vendor</th>
                    <th style={{ width: 130 }}>Category</th>
                    <th style={{ width: 120 }}>Amount</th>
                    <th style={{ width: 100 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {businessExpenses.map(be => (
                    <tr key={be.id}>
                      <td>{be.vendor_name || '—'}</td>
                      <td>{be.category || '—'}</td>
                      <td>{fmtMoney(be.amount)}</td>
                      <td>{agingLabel(daysAgo(be.expense_date))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Unpaid Receipts</h3>
          {receipts.length === 0 && <div className="empty-state">None outstanding.</div>}
          {receipts.length > 0 && (
            <div className="data-table-wrap">
              <table className="data-table" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>Vendor</th>
                    <th style={{ width: 100 }}>Job</th>
                    <th style={{ width: 120 }}>Amount</th>
                    <th style={{ width: 100 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map(r => (
                    <tr key={r.id} onClick={() => window.location.href = r.job_id ? `/jobs/${r.job_id}?tab=Financials` : '#'}>
                      <td>{r.vendor_name || '—'}</td>
                      <td>{r.jobs ? `#${r.jobs.job_number}` : '—'}</td>
                      <td>{fmtMoney(r.amount)}</td>
                      <td>{agingLabel(daysAgo(r.receipt_date))}</td>
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
