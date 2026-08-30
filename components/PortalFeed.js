'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { contractPathFor } from '../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date((v || '').length === 10 ? v + 'T00:00:00' : v);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2 });
}
function badgeLabel(e) {
  if (e.kind === 'invoice') return 'Payment due';
  return e.needsAction ? 'Action needed' : 'New';
}
function variantClass(e) {
  if (e.kind === 'invoice') return 'portal-feed-item-invoice';
  return e.needsAction ? 'portal-feed-item-action' : '';
}

export default function PortalFeed({ job }) {
  const [updates, setUpdates] = useState([]);
  const [selections, setSelections] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [draws, setDraws] = useState([]);

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
    const loadDraws = () =>
      supabase.from('invoices').select('*').eq('job_id', job.id).neq('status', 'not_sent')
        .order('created_at', { ascending: false }).then(({ data }) => { if (data) setDraws(data); });

    loadUpdates(); loadSelections(); loadChangeOrders(); loadDraws();
    const channel = supabase.channel(`portal-feed-${job.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_updates', filter: `job_id=eq.${job.id}` }, loadUpdates)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${job.id}` }, loadSelections)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_orders', filter: `job_id=eq.${job.id}` }, loadChangeOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `job_id=eq.${job.id}` }, loadDraws)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [job?.id]);

  if (!job) return null;

  // Each entry's "new" state now comes from whether THAT document has been
  // opened (viewed_at, stamped from the document's own page — see migration
  // 067) or its action already completed — never from the blunt "opened the
  // portal Home page" signal, which used to clear everything at once
  // regardless of what was actually read.
  const entries = [];

  if (job.proposal_sent_at) {
    entries.push({
      id: 'estimate',
      at: job.proposal_sent_at,
      label: 'Estimate',
      href: `/jobs/${job.id}/proposal`,
      isNew: !job.proposal_viewed_at,
    });
  }
  if (job.contract_sent_at) {
    const signed = !!job.contract_finalized_at;
    entries.push({
      id: 'contract',
      at: job.contract_sent_at,
      label: signed ? 'Contract — signed' : 'Contract — ready to sign',
      href: contractPathFor(job),
      isNew: !signed && !job.contract_viewed_at,
    });
  }
  changeOrders.forEach(co => {
    const signed = !!(co.co_signatures && co.co_signatures.owner);
    entries.push({
      id: `co-${co.id}`,
      at: co.sent_at,
      label: `Change order — ${fmtDate(co.co_date)}`,
      sub: co.description,
      href: `/jobs/${job.id}/change-orders/${co.id}`,
      isNew: !signed && !co.viewed_at,
    });
  });
  updates.forEach(u => {
    entries.push({
      id: `update-${u.id}`,
      at: u.sent_at,
      label: `Progress update — ${fmtDate(u.update_date)}`,
      href: `/jobs/${job.id}/updates/${u.id}`,
      isNew: !u.viewed_at,
    });
  });
  selections.forEach(s => {
    const approved = s.status === 'approved';
    entries.push({
      id: `selection-${s.id}`,
      at: s.sent_at,
      label: `Material selection — ${s.title}${approved ? ' (chosen)' : ''}`,
      href: `/jobs/${job.id}/material-selections/${s.id}`,
      needsAction: !approved,
      isNew: false,
    });
  });
  // Invoices get their own money-green treatment (kind: 'invoice') instead
  // of the rust "action needed" styling — paying a bill isn't the same kind
  // of pending action as signing a document, so it shouldn't look identical.
  // Like material selections, "new" doesn't apply here — it's either unpaid
  // (highlighted) or paid (quietly moves to Earlier), independent of viewing.
  draws.forEach(inv => {
    const paid = inv.status === 'paid';
    entries.push({
      id: `invoice-${inv.id}`,
      at: inv.sent_at || inv.created_at,
      label: `${inv.description || 'Draw'} — ${fmtMoney(inv.amount)}${paid ? ' (paid)' : ''}`,
      href: `/jobs/${job.id}/invoices/${inv.id}`,
      needsAction: !paid,
      isNew: false,
      kind: 'invoice',
    });
  });
  if (draws.length === 0 && job.invoice_status && job.invoice_status !== 'not_sent') {
    const paid = job.invoice_status === 'paid';
    entries.push({
      id: 'invoice-main',
      at: job.invoiced_at,
      label: `Invoice — ${fmtMoney(job.invoice_amount)}${paid ? ' (paid)' : ''}`,
      href: `/jobs/${job.id}/invoice`,
      needsAction: !paid,
      isNew: false,
      kind: 'invoice',
    });
  }

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
        <a key={e.id} href={e.href} target="_blank" rel="noopener noreferrer" className={`portal-feed-item portal-feed-item-new ${variantClass(e)}`}>
          <div className="portal-feed-item-top">
            <span className="portal-feed-badge">{badgeLabel(e)}</span>
            <span className="portal-feed-label">{e.label}</span>
            <span className="portal-feed-date">{fmtDate(e.at)}</span>
          </div>
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
