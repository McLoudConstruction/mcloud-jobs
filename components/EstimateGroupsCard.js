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

// Lets an admin build "Choose One" (mutually exclusive alternates) and
// "Alternate" (independently toggleable, includable/deferrable) groups
// on top of the job's base scope/price — the flexible-estimate feature.
// The customer picks interactively on the estimate document; submitting
// there flattens the picks into jobs.scope_items / job_financials.
// contract_price via submit_estimate_groups(), so nothing else in the
// app needs to know groups exist. This card is the admin side: building
// the groups, unlocking after a submission to send a revised estimate,
// and triaging whatever the customer didn't pick into the deferred-scope
// follow-up bucket.
export default function EstimateGroupsCard({ job, jobId }) {
  const [groups, setGroups] = useState([]);
  const [choices, setChoices] = useState([]); // all choices across all choose_one groups
  const [deferred, setDeferred] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: choiceData }, { data: deferredData }] = await Promise.all([
      supabase.from('estimate_groups').select('*').eq('job_id', jobId).order('sort_order'),
      supabase.from('estimate_group_choices').select('*').order('sort_order'),
      supabase.from('deferred_scope_items').select('source_group_id, source_choice_id').eq('job_id', jobId),
    ]);
    setGroups(groupData || []);
    setChoices(choiceData || []);
    setDeferred(deferredData || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`estimate-groups-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_groups', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_group_choices' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  const isLocked = !!job.estimate_groups_submitted_at;

  async function addGroup(kind) {
    const label = window.prompt(kind === 'choose_one' ? 'Name this Choose One group (e.g. "Roof Repair Approach"):' : 'Name this Alternate (e.g. "Defer siding to next year"):');
    if (!label || !label.trim()) return;
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('estimate_groups').insert({
      job_id: jobId,
      kind,
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
    if (!window.confirm(`Delete "${g.label}"? This removes it and any choices under it.`)) return;
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

  async function addChoice(group) {
    const label = window.prompt('Name this option (e.g. "Full tear-off and replacement"):');
    if (!label || !label.trim()) return;
    const groupChoices = choices.filter(c => c.group_id === group.id);
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('estimate_group_choices').insert({
      group_id: group.id,
      label: label.trim(),
      sort_order: groupChoices.length,
    });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }
    await load();
  }

  async function updateChoice(id, patch) {
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('estimate_group_choices').update(patch).eq('id', id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    await load();
  }

  async function deleteChoice(c) {
    if (!window.confirm(`Delete "${c.label}"?`)) return;
    setBusy(true);
    setError('');
    const { error: deleteError } = await supabase.from('estimate_group_choices').delete().eq('id', c.id);
    setBusy(false);
    if (deleteError) { setError(deleteError.message); return; }
    await load();
  }

  async function unlock() {
    if (!window.confirm('Unlock this estimate? The scope and price revert to what they were before the customer submitted, and the customer can pick again.')) return;
    setBusy(true);
    setError('');
    const patch = { estimate_groups_submitted_at: null };
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
    const label = kind === 'choose_one'
      ? `[${item.groupLabel}] ${item.label}`
      : `[${item.label}]`;
    const { error: insertError } = await supabase.from('deferred_scope_items').insert({
      job_id: jobId,
      source_group_id: kind === 'choose_one' ? item.group_id : item.id,
      source_choice_id: kind === 'choose_one' ? item.id : null,
      label,
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

  const declinedKey = (groupId, choiceId) => `${groupId}:${choiceId || ''}`;
  const reviewedKeys = new Set(deferred.map(d => declinedKey(d.source_group_id, d.source_choice_id)));

  const declinedChooseOne = groups
    .filter(g => g.kind === 'choose_one' && g.selected_choice_id)
    .flatMap(g => choices.filter(c => c.group_id === g.id && c.id !== g.selected_choice_id).map(c => ({ ...c, groupLabel: g.label })))
    .filter(c => !reviewedKeys.has(declinedKey(c.group_id, c.id)));

  const declinedAlternates = groups
    .filter(g => g.kind === 'alternate' && !g.included && isLocked)
    .filter(g => !reviewedKeys.has(declinedKey(g.id, null)));

  return (
    <div className="card">
      <h3>Flexible Estimate — Choose One &amp; Alternates</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        On top of the base scope above, add groups the customer picks interactively on the estimate document. <b>Choose One</b> groups are mutually exclusive alternate approaches (customer must pick one); <b>Alternates</b> are independently includable/deferrable add-ons. The price auto-calculates from their picks once submitted.
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

      {groups.length === 0 && <div className="empty-state">No groups yet — add one below.</div>}

      {groups.map((g, idx) => {
        const groupChoices = choices.filter(c => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div key={g.id} style={{ border: '1px solid var(--panel-line)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <span className="badge" style={{ background: g.kind === 'choose_one' ? '#2F4858' : '#9B773D', marginBottom: 6, display: 'inline-block' }}>
                  {g.kind === 'choose_one' ? 'Choose One' : 'Alternate'}
                </span>
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

            {g.kind === 'alternate' ? (
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
            ) : (
              <div style={{ marginTop: 10 }}>
                {groupChoices.length === 0 && <div className="empty-state" style={{ padding: '8px 0' }}>No options yet.</div>}
                {groupChoices.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <input
                        value={c.label}
                        onChange={e => setChoices(prev => prev.map(x => x.id === c.id ? { ...x, label: e.target.value } : x))}
                        onBlur={e => updateChoice(c.id, { label: e.target.value })}
                        style={{ fontWeight: 600 }}
                        disabled={isLocked}
                      />
                      <textarea
                        value={(c.scope_items || []).map(i => i.text).join('\n')}
                        placeholder="Scope lines (one per line)"
                        onChange={e => setChoices(prev => prev.map(x => x.id === c.id ? { ...x, _scopeText: e.target.value } : x))}
                        onBlur={e => updateChoice(c.id, { scope_items: e.target.value.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text })) })}
                        rows={2}
                        disabled={isLocked}
                        style={{ marginTop: 6 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Price</label>
                      <input
                        type="number" step="0.01" style={{ width: 120 }}
                        value={c.price ?? ''}
                        onChange={e => setChoices(prev => prev.map(x => x.id === c.id ? { ...x, price: e.target.value } : x))}
                        onBlur={e => updateChoice(c.id, { price: e.target.value ? parseFloat(e.target.value) : null })}
                        disabled={isLocked}
                      />
                    </div>
                    {isLocked && g.selected_choice_id === c.id && <span className="badge" style={{ background: '#3a6b45' }}>Picked</span>}
                    <button className="btn btn-sm btn-danger" onClick={() => deleteChoice(c)} disabled={busy || isLocked}>×</button>
                  </div>
                ))}
                <div className="section-actions">
                  <button className="btn btn-sm" onClick={() => addChoice(g)} disabled={busy || isLocked}>+ Add option</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="section-actions">
        <button className="btn btn-sm" onClick={() => addGroup('choose_one')} disabled={busy || isLocked}>+ Choose One group</button>
        <button className="btn btn-sm" onClick={() => addGroup('alternate')} disabled={busy || isLocked}>+ Alternate</button>
      </div>

      {isLocked && (declinedChooseOne.length > 0 || declinedAlternates.length > 0) && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <h4 style={{ margin: '0 0 4px' }}>What the customer didn't pick</h4>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Save anything worth following up on to the <Link href="/deferred-scope">deferred scope bucket</Link>, or discard it.
          </div>
          {declinedChooseOne.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div><b>[{c.groupLabel}]</b> {c.label} — {fmtMoney(c.price)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => reviewDecline('choose_one', c, 'save')} disabled={busy}>Save to follow-ups</button>
                <button className="btn btn-sm" onClick={() => reviewDecline('choose_one', c, 'discard')} disabled={busy}>Discard</button>
              </div>
            </div>
          ))}
          {declinedAlternates.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div><b>[{g.label}]</b> — {fmtMoney(g.price)}</div>
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
