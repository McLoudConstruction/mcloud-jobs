'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Alternates: independently toggleable optional items layered on top of
// whichever scope is in play (single scope, or the picked scope option in
// multi-option mode) — the customer can include or leave each one out
// (e.g. defer to next budget year). The customer picks interactively on
// the estimate document; submitting there flattens the picks into
// jobs.scope_items / job_financials.contract_price via
// submit_estimate_groups(), so nothing else in the app needs to know
// alternates (or scope options) exist. This card is the admin side:
// building the alternates, unlocking after a submission to send a
// revised estimate, and triaging whatever the customer didn't end up
// with — declined alternates AND the scope option(s) they didn't pick —
// into the deferred-scope follow-up bucket.
export default function EstimateGroupsCard({ job, jobId }) {
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
    const label = window.prompt('Name this Alternate (e.g. "Defer siding to next year"):');
    if (!label || !label.trim()) return;
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('estimate_groups').insert({
      job_id: jobId,
      kind: 'alternate',
      label: label.trim(),
      sort_order: groups.length,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    await load();
  }

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
    const patch = { estimate_groups_submitted_at: null, selected_scope_option_id: null };
    if (job.estimate_base_scope_items != null) patch.scope_items = job.estimate_base_scope_items;
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

  return (
    <div className="card">
      <h3>Flexible Estimate — Alternates</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        On top of the scope above, add independently includable/deferrable add-ons the customer picks interactively on the estimate document. The price auto-calculates from their picks once submitted.
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

      {groups.length === 0 && <div className="empty-state">No alternates yet — add one below.</div>}

      {groups.map((g, idx) => (
        <div key={g.id} style={{ border: '1px solid var(--panel-line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <input
                value={g.label}
                onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, label: e.target.value } : x))}
                onBlur={e => updateGroup(g.id, { label: e.target.value })}
                style={{ fontWeight: 700, marginBottom: 6 }}
                disabled={isLocked}
              />
              <textarea
                value={g.description || ''}
                placeholder="Description shown to the customer (optional)"
                onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, description: e.target.value } : x))}
                onBlur={e => updateGroup(g.id, { description: e.target.value })}
                disabled={isLocked}
                rows={2}
              />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-sm" onClick={() => moveGroup(g, -1)} disabled={busy || idx === 0}>↑</button>
              <button className="btn btn-sm" onClick={() => moveGroup(g, 1)} disabled={busy || idx === groups.length - 1}>↓</button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteGroup(g)} disabled={busy || isLocked}>Delete</button>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 11 }}>Price</label>
              <input
                type="number" step="0.01" style={{ width: 130 }}
                value={g.price ?? ''}
                onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, price: e.target.value } : x))}
                onBlur={e => updateGroup(g.id, { price: e.target.value ? parseFloat(e.target.value) : null })}
                disabled={isLocked}
              />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={{ fontSize: 11 }}>Scope lines (one per line)</label>
              <textarea
                value={(g.scope_items || []).map(i => i.text).join('\n')}
                onChange={e => setGroups(prev => prev.map(x => x.id === g.id ? { ...x, _scopeText: e.target.value } : x))}
                onBlur={e => updateGroup(g.id, { scope_items: e.target.value.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text })) })}
                rows={2}
                disabled={isLocked}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 400 }}>
              <input
                type="checkbox" style={{ width: 'auto' }}
                checked={!!g.default_included}
                onChange={e => updateGroup(g.id, { default_included: e.target.checked })}
                disabled={isLocked}
              />
              Pre-checked for the customer
            </label>
            {isLocked && (
              <span className={`badge ${g.included ? '' : 'badge-active'}`} style={{ background: g.included ? '#3a6b45' : '#8a5a3f' }}>
                {g.included ? 'Included' : 'Declined'}
              </span>
            )}
          </div>
        </div>
      ))}

      <div className="section-actions">
        <button className="btn btn-sm" onClick={addGroup} disabled={busy || isLocked}>+ Alternate</button>
      </div>

      {isLocked && (declinedAlternates.length > 0 || declinedScopeOptions.length > 0) && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <h4 style={{ margin: '0 0 4px' }}>What the customer didn't pick</h4>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Save anything worth following up on to the <Link href="/deferred-scope">deferred scope bucket</Link>, or discard it.
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
}
