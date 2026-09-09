'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import Link from 'next/link';
import { contractPathFor } from '../lib/constants';

export default function IssuedDocumentsCard({ jobId, job, updates, changeOrders }) {
  const [draws, setDraws] = useState([]);
  const [selections, setSelections] = useState([]);

  useEffect(() => {
    const load = () => supabase.from('invoices').select('*').eq('job_id', jobId).then(({ data }) => { if (data) setDraws(data); });
    load();
    const loadSelections = () => supabase.from('material_selections').select('*').eq('job_id', jobId).not('sent_at', 'is', null).then(({ data }) => { if (data) setSelections(data); });
    loadSelections();
    const channel = supabase.channel(`issued-docs-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, loadSelections)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId]);

  const entries = [];

  if (job.proposal_sent_at) {
    entries.push({ at: job.proposal_sent_at, label: 'Estimate', href: `/jobs/${jobId}/proposal` });
  }
  if (job.contract_finalized_at) {
    entries.push({ at: job.contract_finalized_at, label: 'Contract — signed', href: contractPathFor(job) });
  }
  draws.filter(d => d.status !== 'not_sent').forEach(d => {
    entries.push({ at: d.sent_at || d.created_at, label: `${d.description} (${d.status === 'paid' ? 'paid' : 'awaiting payment'})`, href: `/jobs/${jobId}/invoices/${d.id}` });
  });
  if (job.invoice_status && job.invoice_status !== 'not_sent' && job.invoiced_at) {
    entries.push({ at: job.invoiced_at, label: `Invoice (${job.invoice_status === 'paid' ? 'paid' : 'awaiting payment'})`, href: `/jobs/${jobId}/invoice` });
  }
  updates.forEach(u => {
    if (u.sent_at) entries.push({ at: u.sent_at, label: `Progress update — ${u.update_date}`, href: `/jobs/${jobId}/updates/${u.id}` });
  });
  changeOrders.forEach(co => {
    if (co.sent_at) entries.push({ at: co.sent_at, label: `Change order — ${co.co_date}`, href: `/jobs/${jobId}/change-orders/${co.id}` });
  });
  selections.forEach(s => {
    entries.push({ at: s.sent_at, label: `Material selection — ${s.title}${s.status === 'approved' ? ' (approved)' : ''}`, href: `/jobs/${jobId}/material-selections/${s.id}` });
  });

  entries.sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="card">
      <h3>Documents</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Only what's actually been issued shows up here — an estimate before it's sent, or an invoice before it's issued, won't appear.
      </div>
      {entries.length === 0 && <div className="empty-state">Nothing issued yet.</div>}
      {entries.map((e, i) => (
        <div className="update-entry" key={i}>
          <div className="update-date">{new Date(e.at).toLocaleString('en-US')}</div>
          <p style={{ margin: 0 }}>{e.label}</p>
          <div className="section-actions">
            <Link href={e.href} className="btn btn-sm">View</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
