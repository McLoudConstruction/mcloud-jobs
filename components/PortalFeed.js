'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { contractPathFor } from '../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date((v || '').length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PortalFeed({ job }) {
  const [updates, setUpdates] = useState([]);
  const [selections, setSelections] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);

  // Freezes "what counts as new" the moment this job is first opened this
  // session. This can't just read job.portal_last_viewed_at live — the
  // Home page calls mark_portal_viewed() moments after loading, which
  // would update that timestamp to "now" and erase everything's "new"
  // status before the customer ever actually saw it highlighted.
  const asOfRef = useRef({ jobId: null, viewedAt: null });
  if (job && asOfRef.current.jobId !== job.id) {
    asOfRef.current = { jobId: job.id, viewedAt: job.portal_last_viewed_at };
  }
  const asOf = asOfRef.current.viewedAt;
  const isNew = dateStr => !!dateStr && (!asOf || new Date(dateStr) > new Date(asOf));

  useEffect(() => {
    if (!job?.id) return;
    const loadUpdates = () =>
      supabase.from('job_updates').select('*').eq('job_id', job.id).eq('is_internal', false).not('sent_at', 'is', null)
        .order('sent_at', { ascending: false }).then(({ data }) => { if (data) setUpdates(data); });
    const loadSelections = () =>
      supabase.from('material_selections').select('*').eq('job_id', job.id).not('sent_at', 'is', null)
        .order('sent_at', { ascending: false }).then(({ data }) => { if (data) setSelections(data); });
    const loadChangeOrders = () =>
      supabase.from('change_orders').select('*').eq('job_id', job.id).not('sent_at', 'is', null)
        .order('sent_at', { ascending: false }).then(({ data }) => { if (data) setChangeOrders(data); });

    loadUpdates(); loadSelections(); loadChangeOrders();
    const channel = supabase.channel(`portal-feed-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${job.id}` }, loadUpdates)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${job.id}` }, loadSelections)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${job.id}` }, loadChangeOrders)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job?.id]);

  if (!job) return null;

  const entries = [];

  if (job.proposal_sent_at) {
    entries.push({ id: 'estimate', at: job.proposal_sent_at, label: 'Estimate', href: `/jobs/${job.id}/proposal` });
  }
  if (job.contract_sent_at) {
    entries.push({
      id: 'contract',
      at: job.contract_sent_at,
      label: job.contract_finalized_at ? 'Contract — signed' : 'Contract — ready to sign',
      href: contractPathFor(job),
    });
  }
  changeOrders.forEach(co => {
    entries.push({ id: `co-${co.id}`, at: co.sent_at, label: `Change order — ${fmtDate(co.co_date)}`, sub: co.description, href: `/jobs/${job.id}/change-orders/${co.id}` });
  });
  updates.forEach(u => {
    entries.push({ id: `update-${u.id}`, at: u.sent_at, label: `Progress update — ${fmtDate(u.update_date)}`, href: `/jobs/${job.id}/updates/${u.id}` });
  });
  selections.forEach(s => {
    entries.push({
      id: `selection-${s.id}`,
      at: s.sent_at,
      label: `Material selection — ${s.title}${s.status === 'approved' ? ' (chosen)' : ''}`,
      href: `/jobs/${job.id}/material-selections/${s.id}`,
      needsAction: s.status !== 'approved',
    });
  });

  entries.forEach(e => { e.isNew = isNew(e.at); });
  entries.sort((a, b) => new Date(b.at) - new Date(a.at));

  const highlighted = entries.filter(e => e.isNew || e.needsAction);
  const rest = entries.filter(e => !e.isNew && !e.needsAction);

  return (
    <div className="card portal-feed">
      <h3>Updates &amp; Documents</h3>

      {entries.length === 0 && (
        <div className="empty-state">Nothing here yet — check back once we post an update or send a document.</div>
      )}

      {highlighted.map(e => (
        <a key={e.id} href={e.href} target="_blank" rel="noopener noreferrer" className={`portal-feed-item portal-feed-item-new ${e.needsAction ? 'portal-feed-item-action' : ''}`}>
          <div className="portal-feed-item-top">
            <span className="portal-feed-badge">{e.needsAction ? 'Action needed' : 'New'}</span>
            <span className="portal-feed-date">{fmtDate(e.at)}</span>
          </div>
          <span className="portal-feed-label">{e.label}</span>
          {e.sub && <span className="portal-feed-sub">{e.sub}</span>}
        </a>
      ))}

      {rest.length > 0 && (
        <>
          {highlighted.length > 0 && <div className="portal-feed-divider">Earlier</div>}
          {rest.map(e => (
            <a key={e.id} href={e.href} target="_blank" rel="noopener noreferrer" className="portal-feed-item">
              <span className="portal-feed-label">{e.label}</span>
              {e.sub && <span className="portal-feed-sub">{e.sub}</span>}
              <span className="portal-feed-date">{fmtDate(e.at)}</span>
            </a>
          ))}
        </>
      )}
    </div>
  );
}
