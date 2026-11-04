'use client';
import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { appHref, jobHref } from '../lib/links';
import ScopeBuilder from './ScopeBuilder';
import TradeBreakdownCard from './TradeBreakdownCard';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Alternates: separate, optional estimates layered on top of whichever scope
// is in play (single scope, or the picked scope option in multi-option mode).
// Each one is built like the main estimate: its own scope (Generate scope
// with AI, From assembly), its own trade breakdown, and its own price from
// the Cost and Pricing tabs. The customer can include any one, several or
// none of them (e.g. defer to next budget year). The customer picks interactively on
// the estimate document; submitting there flattens the picks into
// jobs.scope_items / job_financials.contract_price via
// submit_estimate_groups(), so nothing else in the app needs to know
// alternates (or scope options) exist. This card is the admin side:
// building the alternates, unlocking after a submission to send a
// revised estimate, and triaging whatever the customer didn't end up
// with — declined alternates AND the scope option(s) they didn't pick —
// into the deferred-scope follow-up bucket.
//
// This no longer has a card of its own. It renders inside the Scope card,
// below the scope, and only shows up once there is something to show (an
// alternate exists, or the customer has submitted). The Scope card's
// "Add Alternates" button calls addGroup() through the ref.
const EstimateGroupsCard = forwardRef(function EstimateGroupsCard({ job, jobId }, ref) {
  const [groups, setGroups] = useState([]);
  const [scopeOptions, setScopeOptions] = useState([]);
  const [deferred, setDeferred] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: optionData }, { data: deferredData }] = await Promise.all([
      supabase.from('estimate_groups').select('*').eq('job_id', jobId).order('sort_order'),
      supabase.from('estimate_scope_options').select('id, label, price').eq('job_id', jobId),
      supabase.from('deferred_scope_items').select('source_group_id, source_scope_option_id').eq('job_id', jobId),
    ]);
    setGroups(groupData || []);
    setScopeOptions(optionData || []);
    setDeferred(deferredData || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`estimate-groups-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_groups', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_scope_options', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  const isLocked = !!job.estimate_groups_submitted_at;

  async function addGroup() {
    if (isLocked) return;
    const label = window.prompt('Name this Alternate (e.g. "Defer siding to next year"):');
    if (!label || !label.trim()) return;
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('estimate_groups').insert({
      job_id: jobId,
      kind: 'alternate',
      label: label.trim(),
      scope_items: [],
      sort_order: groups.length,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    await load();
  }

  useImperativeHandle(ref, () => ({ addGroup }));

  async function updateGroup(id, patch) {
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('estimate_groups').update(patch).eq('id', id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    await load();
  }

  async function deleteGroup(g) {
    if (!window.confirm(`Delete "${g.label}"?`)) return;
    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase.from('estimate_groups').delete().eq('id', g.id);
    setBusy(false);
    if (deleteError) { setError(deleteError.message); return; }
    await load();
  }

  async function moveGroup(g, dir) {
    const ordered = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const idx = ordered.findIndex(x => x.id === g.id);
    const swapWith = ordered[idx + dir];
    if (!swapWith) return;
    setBusy(true);
    await Promise.all([
      supabase.from('estimate_groups').update({ sort_order: swapWith.sort_order }).eq('id', g.id),
      supabase.from('estimate_groups').update({ sort_order: g.sort_order }).eq('id', swapWith.id),
    ]);
    setBusy(false);
    await load();
  }

  async function unlock() {
    if (!window.confirm('Unlock this estimate? The scope and price revert to what they were before the customer submitted, and the customer can pick again.')) return;
    setBusy(true);
    setError('');
    // Take out the alternate work that submit copied into the job (work
    // orders, schedule and budget read the job). Best effort: before
    // migration 178 there is nothing to remove.
    await supabase.from('job_scope_actions').delete().eq('job_id', jobId).not('merged_from_group_id', 'is', null);
    await supabase.from('job_estimate_items').delete().eq('job_id', jobId).not('merged_from_group_id', 'is', null);
    const patch = { estimate_groups_submitted_at: null, selected_scope_option_id: null };
    if (job.estimate_base_scope_items != null) patch.scope_items = job.estimate_base_scope_items;
    if (job.estimate_base_projected_cost != null) patch.projected_cost = job.estimate_base_projected_cost;
    // The saved base is cleared once restored, so the next submit takes a
    // fresh copy of whatever the base is by then, edits included.
    patch.estimate_base_scope_items = null;
    patch.estimate_base_price = null;
    if ('estimate_base_projected_cost' in job) patch.estimate_base_projected_cost = null;
    const { error: jobError } = await supabase.from('jobs').update(patch).eq('id', jobId);
    if (jobError) { setBusy(false); setError(jobError.message); return; }
    if (job.estimate_base_price != null) {
      const { error: finError } = await supabase.from('job_financials').update({ contract_price: job.estimate_base_price }).eq('job_id', jobId);
      if (finError) { setBusy(false); setError(finError.message); return; }
    }
    setBusy(false);
    window.location.reload();
  }

  async function reviewDecline(kind, item, action) {
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('deferred_scope_items').insert({
      job_id: jobId,
      source_group_id: kind === 'alternate' ? item.id : null,
      source_scope_option_id: kind === 'scope_option' ? item.id : null,
      label: `[${item.label}]`,
      description: item.description || null,
      price: item.price,
      customer_name: job.customer_name || null,
      customer_contact: job.customer_contact || null,
      customer_email: job.customer_email || job.billing_email || null,
      customer_phone: job.customer_phone || null,
      project_address: job.project_address || null,
      status: action === 'save' ? 'open' : 'dead',
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    await load();
  }

  if (!loaded) return null;

  const reviewedGroupIds = new Set(deferred.filter(d => d.source_group_id).map(d => d.source_group_id));
  const reviewedOptionIds = new Set(deferred.filter(d => d.source_scope_option_id).map(d => d.source_scope_option_id));

  const declinedAlternates = groups.filter(g => !g.included && isLocked && !reviewedGroupIds.has(g.id));

  const declinedScopeOptions = (job.estimate_mode === 'multi' && isLocked && job.selected_scope_option_id)
    ? scopeOptions.filter(o => o.id !== job.selected_scope_option_id && !reviewedOptionIds.has(o.id))
    : [];

  // Nothing to show yet: the section appears when the first alternate is added.
  if (groups.length === 0 && !isLocked && declinedAlternates.length === 0 && declinedScopeOptions.length === 0) return null;

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
      <h4 style={{ margin: '0 0 4px' }}>Alternates</h4>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Each alternate is its own estimate with its own scope and price. The customer can include any one, several or none of them on the estimate document, and the total updates from their picks.
      </div>

      {isLocked && (
        <div style={{ background: '#faf6ec', border: '1px solid #ded7c0', borderRadius: 6, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12.5 }}>
            <b>Submitted</b> by the customer on {fmtDate(job.estimate_groups_submitted_at)}. The scope and price now reflect their picks.
          </div>
          <button className="btn btn-sm" onClick={unlock} disabled={busy}>Unlock to revise &amp; resend</button>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}

      {groups.map((g, idx) => (
        <AlternateEditor
          key={g.id}
          group={g}
          job={job}
          jobId={jobId}
          isLocked={isLocked}
          isFirst={idx === 0}
          isLast={idx === groups.length - 1}
          busy={busy}
          onUpdate={updateGroup}
          onDelete={() => deleteGroup(g)}
          onMove={dir => moveGroup(g, dir)}
        />
      ))}

      {isLocked && (declinedAlternates.length > 0 || declinedScopeOptions.length > 0) && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <h4 style={{ margin: '0 0 4px' }}>What the customer didn't pick</h4>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Save anything worth following up on to the <Link href={appHref('deferredScope')}>deferred scope bucket</Link>, or discard it.
          </div>
          {declinedScopeOptions.map(o => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div><b>{o.label}</b> (scope option not chosen) — {fmtMoney(o.price)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => reviewDecline('scope_option', o, 'save')} disabled={busy}>Save to follow-ups</button>
                <button className="btn btn-sm" onClick={() => reviewDecline('scope_option', o, 'discard')} disabled={busy}>Discard</button>
              </div>
            </div>
          ))}
          {declinedAlternates.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div><b>{g.label}</b> — {fmtMoney(g.price)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => reviewDecline('alternate', g, 'save')} disabled={busy}>Save to follow-ups</button>
                <button className="btn btn-sm" onClick={() => reviewDecline('alternate', g, 'discard')} disabled={busy}>Discard</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default EstimateGroupsCard;

// One alternate, built like the main estimate. Keeps its own copy of the
// name and description (same pattern as the scope option editor) so a
// refresh never overwrites what is being typed.
function AlternateEditor({ group, job, jobId, isLocked, isFirst, isLast, busy, onUpdate, onDelete, onMove }) {
  const [label, setLabel] = useState(group.label);
  const [description, setDescription] = useState(group.description || '');
  const [showActions, setShowActions] = useState(false);

  async function saveScope(scopeItems) {
    const { error: updateError } = await supabase.from('estimate_groups').update({ scope_items: scopeItems }).eq('id', group.id);
    if (updateError) throw updateError;
  }

  const priced = group.price !== null && group.price !== undefined && group.price !== '';

  return (
    <div style={{ border: '1px solid var(--panel-line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={e => { if (e.target.value.trim() && e.target.value !== group.label) onUpdate(group.id, { label: e.target.value.trim() }); }}
            style={{ fontWeight: 700, marginBottom: 6 }}
            disabled={isLocked}
          />
          <textarea
            value={description}
            placeholder="Description shown to the customer (optional)"
            onChange={e => setDescription(e.target.value)}
            onBlur={e => { if (e.target.value !== (group.description || '')) onUpdate(group.id, { description: e.target.value }); }}
            disabled={isLocked}
            rows={2}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isLocked && (
            <span className="badge" style={{ background: group.included ? '#3a6b45' : '#8a5a3f' }}>
              {group.included ? 'Included' : 'Declined'}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => onMove(-1)} disabled={busy || isFirst}>↑</button>
          <button className="btn btn-sm" onClick={() => onMove(1)} disabled={busy || isLast}>↓</button>
          <button className="btn btn-sm btn-danger" onClick={onDelete} disabled={busy || isLocked}>Delete</button>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px' }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: 'var(--ink-soft)' }}>Price: </span>
          <b>{priced ? fmtMoney(group.price) : 'Not priced yet'}</b>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 400, margin: 0 }}>
            <input
              type="checkbox" style={{ width: 'auto' }}
              checked={!!group.default_included}
              onChange={e => onUpdate(group.id, { default_included: e.target.checked })}
              disabled={isLocked}
            />
            Pre-checked for the customer
          </label>
          <Link href={jobHref(jobId, 'cost', { costAlternate: group.id })} className="btn btn-sm">
            {priced ? 'Update cost & price' : 'Price on Cost tab'} →
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <ScopeBuilder
          jobId={jobId}
          groupId={group.id}
          projectType={job.project_type}
          initialItems={group.scope_items}
          disabled={isLocked}
          onSave={saveScope}
          onActionsAdded={() => setShowActions(true)}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-sm" onClick={() => setShowActions(o => !o)}>
          {showActions ? 'Hide trade breakdown' : 'Show trade breakdown'}
        </button>
        {showActions && (
          <div style={{ marginTop: 10 }}>
            <TradeBreakdownCard jobId={jobId} groupId={group.id} title="Trade breakdown for this alternate" readOnly={isLocked} />
          </div>
        )}
      </div>
    </div>
  );
}
