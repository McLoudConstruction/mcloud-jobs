'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Ordered to roughly follow how a real job actually unfolds — pre-contract
// decisions first, then everything that happens once work is underway.
const ITEMS = [
  { key: 'portal', label: 'Portal Access Granted', tab: 'Portal' },
  { key: 'scope', label: 'Scope of Work', tab: 'Scope' },
  { key: 'estimate', label: 'Estimate Sent', tab: 'Estimate' },
  { key: 'contract', label: 'Contract Signed', tab: 'Documents' },
  { key: 'selections', label: 'Material Selections', tab: 'Scope' },
  { key: 'workOrders', label: 'Work Orders Issued', tab: 'Financials' },
  { key: 'receipts', label: 'Receipts Logged', tab: 'Financials' },
  { key: 'photos', label: 'Photos', tab: 'Photos' },
  { key: 'updates', label: 'Progress Updates Sent', tab: 'Documents' },
  { key: 'changeOrders', label: 'Change Orders Issued', tab: 'Financials' },
  { key: 'invoicing', label: 'Invoicing', tab: 'Financials' },
];

export default function ProjectMilestonesCard({ job, jobId, onTabChange }) {
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    const [
      { count: portalCount },
      { count: scopeActionCount },
      { count: selectionsCount },
      { count: workOrdersCount },
      { count: receiptsCount },
      { count: photosCount },
      { count: updatesCount },
      { count: changeOrdersCount },
      { count: drawsCount },
    ] = await Promise.all([
      supabase.from('job_portal_access').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('invited_at', 'is', null),
      supabase.from('job_scope_actions').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
      supabase.from('material_selections').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('sent_at', 'is', null),
      supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
      supabase.from('receipts').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
      supabase.from('job_photos').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
      supabase.from('job_updates').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('sent_at', 'is', null),
      supabase.from('change_orders').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('sent_at', 'is', null),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('job_id', jobId).neq('status', 'not_sent'),
    ]);
    setCounts({
      portal: portalCount || 0,
      scope: (job.scope_items?.length || 0) + (scopeActionCount || 0),
      selections: selectionsCount || 0,
      workOrders: workOrdersCount || 0,
      receipts: receiptsCount || 0,
      photos: photosCount || 0,
      updates: updatesCount || 0,
      changeOrders: changeOrdersCount || 0,
      invoicing: (drawsCount || 0) + (job.invoice_status && job.invoice_status !== 'not_sent' ? 1 : 0),
    });
  }, [jobId, job.scope_items, job.invoice_status]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`milestones-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_portal_access', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_scope_actions', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  function isDone(key) {
    if (key === 'estimate') return Boolean(job.proposal_sent_at);
    if (key === 'contract') return Boolean(job.contract_finalized_at);
    return (counts[key] || 0) > 0;
  }

  return (
    <div className="card">
      <h3>Project Milestones</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Everything that can happen over the life of this job, in one place.
      </div>
      <div className="milestone-list">
        {ITEMS.map(item => {
          const done = isDone(item.key);
          const count = counts[item.key];
          const showCount = ['selections', 'workOrders', 'receipts', 'photos', 'updates', 'changeOrders', 'invoicing'].includes(item.key);
          return (
            <button key={item.key} className="milestone-row" onClick={() => onTabChange?.(item.tab)}>
              <span className={`milestone-check ${done ? 'milestone-check-done' : ''}`}>{done ? '✓' : ''}</span>
              <span className="milestone-label">{item.label}</span>
              {showCount && count > 0 && <span className="milestone-count">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
