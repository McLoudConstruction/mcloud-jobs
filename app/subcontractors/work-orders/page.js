'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { WORK_ORDER_STATUS_LABELS } from '../../../lib/constants';

const ACTIVE_JOB_STAGES = ['approved', 'scheduled', 'active'];

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatAction(a) {
  const qty = a.quantity ?? 1;
  const unit = a.unit_label ? ` ${a.unit_label}${qty === 1 ? '' : 's'}` : '';
  return `${qty}${unit} — ${a.description}`;
}

export default function WorkOrdersHubPage() {
  const { session, loading } = useRequireAuth();
  const [mode, setMode] = useState('view'); // 'view' | 'create'
  const [workOrders, setWorkOrders] = useState([]);
  const [subcontractors, setSubcontractors] = useState([]);
  const [filterSub, setFilterSub] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // create mode state
  const [createSubId, setCreateSubId] = useState('');
  const [eligibleJobs, setEligibleJobs] = useState([]); // [{job, actions, selected, amount}]
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState('');

  const loadWorkOrders = useCallback(async () => {
    const { data } = await supabase.from('work_orders').select('*, jobs(job_number, customer_name, project_address), companies(company_name)').order('created_at', { ascending: false });
    if (data) setWorkOrders(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadWorkOrders();
    supabase.from('companies').select('id, company_name, services_offered').eq('company_type', 'Subcontractor').order('company_name').then(({ data }) => { if (data) setSubcontractors(data); });
    const channel = supabase.channel('work-orders-hub').on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, loadWorkOrders).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadWorkOrders]);

  async function loadEligibleJobs(subId) {
    setCreateSubId(subId);
    setCreateResult('');
    setEligibleJobs([]);
    if (!subId) return;
    const company = subcontractors.find(c => c.id === subId);
    const services = company?.services_offered || [];
    if (services.length === 0) { setEligibleJobs([]); return; }

    setLoadingEligible(true);
    const { data: jobs } = await supabase.from('jobs').select('id, job_number, customer_name, project_address, stage').in('stage', ACTIVE_JOB_STAGES);
    const results = [];
    for (const job of jobs || []) {
      const { data: actions } = await supabase.from('job_scope_actions').select('*').eq('job_id', job.id).in('trade', services);
      if (actions && actions.length > 0) {
        results.push({ job, actions, selected: true, amount: '' });
      }
    }
    setEligibleJobs(results);
    setLoadingEligible(false);
  }

  function toggleJobSelected(jobId) {
    setEligibleJobs(prev => prev.map(r => r.job.id === jobId ? { ...r, selected: !r.selected } : r));
  }
  function updateAmount(jobId, value) {
    setEligibleJobs(prev => prev.map(r => r.job.id === jobId ? { ...r, amount: value } : r));
  }

  async function createBulkWorkOrders() {
    const toCreate = eligibleJobs.filter(r => r.selected);
    if (toCreate.length === 0) return;
    setCreating(true);
    const rows = toCreate.map(r => ({
      job_id: r.job.id,
      company_id: createSubId,
      description: `Work for ${r.job.project_address || 'job #' + r.job.job_number}`,
      amount: parseFloat(r.amount) || 0,
      status: 'draft',
      included_scope_items: r.actions.map(formatAction),
    }));
    await supabase.from('work_orders').insert(rows);
    setCreating(false);
    setCreateResult(`Created ${rows.length} work order${rows.length === 1 ? '' : 's'} as drafts — issue each from its job's Financials tab, or the list below.`);
    setEligibleJobs([]);
    setCreateSubId('');
    setMode('view');
  }

  if (loading || !session) return null;

  const filteredWorkOrders = workOrders.filter(wo => {
    if (filterSub && wo.company_id !== filterSub) return false;
    if (filterStatus && wo.status !== filterStatus) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Work Orders</h2>
          <div className="section-actions" style={{ marginTop: 0 }}>
            <button className={`btn btn-sm ${mode === 'view' ? 'btn-primary' : ''}`} onClick={() => setMode('view')}>View All</button>
            <button className={`btn btn-sm ${mode === 'create' ? 'btn-primary' : ''}`} onClick={() => setMode('create')}>+ Create Work Orders</button>
          </div>
        </div>

        {mode === 'view' && (
          <div className="card">
            <div className="two-col" style={{ marginBottom: 14 }}>
              <div>
                <label>Filter by subcontractor</label>
                <select value={filterSub} onChange={e => setFilterSub(e.target.value)}>
                  <option value="">All subcontractors</option>
                  {subcontractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <label>Filter by status</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {Object.entries(WORK_ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            {filteredWorkOrders.length === 0 && <div className="empty-state">No work orders match.</div>}
            {filteredWorkOrders.map(wo => (
              <Link key={wo.id} href={`/jobs/${wo.job_id}/work-orders/${wo.id}`} className="job-row" style={{ display: 'flex' }}>
                <div className="job-main">
                  <span className="job-number">#{wo.jobs?.job_number} — {wo.jobs?.customer_name}</span>
                  <span className="job-customer" style={{ fontSize: 13.5 }}>{wo.companies?.company_name || 'No subcontractor'}</span>
                  <span className="job-address">{wo.description}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 600 }}>{fmtMoney(wo.invoiced_amount ?? wo.amount)}</span>
                  <span className={`badge badge-${wo.status}`}>{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {mode === 'create' && (
          <div className="card">
            <h3>Create Work Orders in Bulk</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
              Pick a subcontractor — every active job with matching-trade work shows up below, ready to turn into a draft work order in one pass.
            </div>
            <label>Subcontractor</label>
            <select value={createSubId} onChange={e => loadEligibleJobs(e.target.value)}>
              <option value="">Select…</option>
              {subcontractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>

            {loadingEligible && <div className="empty-state">Checking jobs…</div>}

            {!loadingEligible && createSubId && eligibleJobs.length === 0 && (
              <div className="empty-state" style={{ marginTop: 14 }}>No active jobs have matching-trade work for this subcontractor right now.</div>
            )}

            {eligibleJobs.length > 0 && (
              <div style={{ marginTop: 16 }}>
                {eligibleJobs.map(r => (
                  <div key={r.job.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                    <input type="checkbox" style={{ width: 'auto', marginTop: 4 }} checked={r.selected} onChange={() => toggleJobSelected(r.job.id)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>#{r.job.job_number} — {r.job.project_address || r.job.customer_name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                        {r.actions.length} matching action{r.actions.length === 1 ? '' : 's'}: {r.actions.map(a => a.description).join(', ')}
                      </div>
                    </div>
                    <input
                      style={{ width: 130 }}
                      placeholder="Amount ($)"
                      value={r.amount}
                      onChange={e => updateAmount(r.job.id, e.target.value)}
                    />
                  </div>
                ))}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" onClick={createBulkWorkOrders} disabled={creating || eligibleJobs.every(r => !r.selected)}>
                    {creating ? 'Creating…' : `Create ${eligibleJobs.filter(r => r.selected).length} Work Order${eligibleJobs.filter(r => r.selected).length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}

            {createResult && <div style={{ fontSize: 12.5, color: '#3a6b45', marginTop: 12 }}>{createResult}</div>}
          </div>
        )}
      </div>
    </AppShell>
  );
}
