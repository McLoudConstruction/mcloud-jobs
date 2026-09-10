'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import PopupModal from './PopupModal';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL } from '../lib/constants';

function standardTermsFor(type) {
  return (type === 'commercial' ? STANDARD_ASSUMPTIONS_COMMERCIAL : STANDARD_ASSUMPTIONS_RESIDENTIAL)
    .map(text => ({ text }));
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US');
}
function statusFor(p) {
  if (p.viewed_at) return { label: 'Viewed', color: '#3a6b45' };
  if (p.sent_at) return { label: 'Sent', color: '#8a5a3f' };
  return { label: 'Draft', color: '#8a8a8a' };
}

// Multiple independently-saved proposals per job — each is its own named
// snapshot of scope/terms/price with its own send/view tracking and its
// own shareable link. Exactly one can be marked Selected; that's the one
// whose content gets mirrored onto the job itself, which is what the
// Contract page and every other existing surface reads from — so nothing
// downstream needs to know proposals plural even exist.
export default function ProposalsCard({ job, jobId, onSave }) {
  const [proposals, setProposals] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null); // proposal being edited, or null
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('proposals').select('*').eq('job_id', jobId).order('created_at', { ascending: true });
    setProposals(data || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function createProposal(seedFrom) {
    const name = window.prompt('Name this proposal (e.g. "Option A — Full Remodel"):', seedFrom ? `${seedFrom.name} (Copy)` : `Proposal ${proposals.length + 1}`);
    if (!name || !name.trim()) return;
    const { data, error } = await supabase.from('proposals').insert({
      job_id: jobId,
      name: name.trim(),
      scope_items: seedFrom ? seedFrom.scope_items : [],
      additional_terms: seedFrom ? seedFrom.additional_terms : standardTermsFor(job.project_type),
      contract_price: seedFrom ? seedFrom.contract_price : null,
    }).select().single();
    if (error) { alert('Failed to create proposal: ' + error.message); return; }
    setProposals(prev => [...prev, data]);
    setEditing(data);
  }

  async function selectProposal(p) {
    setBusyId(p.id);
    const ok = await onSave({
      selected_proposal_id: p.id,
      scope_items: p.scope_items || [],
      additional_terms: p.additional_terms || [],
      contract_price: p.contract_price,
    });
    setBusyId(null);
    if (ok) load();
  }

  async function deleteProposal(p) {
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    setBusyId(p.id);
    const { error } = await supabase.from('proposals').delete().eq('id', p.id);
    if (error) { alert('Failed to delete: ' + error.message); setBusyId(null); return; }
    if (job.selected_proposal_id === p.id) await onSave({ selected_proposal_id: null });
    setBusyId(null);
    load();
  }

  async function copyLink(p) {
    const url = `${window.location.origin}/jobs/${jobId}/proposal/${p.id}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied: ' + url);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  async function saveEdit(patch) {
    const { data, error } = await supabase.from('proposals').update(patch).eq('id', editing.id).select().single();
    if (error) { alert('Failed to save: ' + error.message); return; }
    setProposals(prev => prev.map(p => p.id === data.id ? data : p));
    // Keep the job in sync automatically if this is the Selected proposal,
    // so editing it after selecting doesn't leave the two out of step.
    if (job.selected_proposal_id === data.id) {
      await onSave({ scope_items: data.scope_items, additional_terms: data.additional_terms, contract_price: data.contract_price });
    }
    setEditing(null);
  }

  return (
    <div className="card">
      <h3>Proposals</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Save as many versions as you want — different scopes, different price points — and mark one <b>Selected</b> when the customer picks it. The Selected proposal is what flows into the Contract.
      </div>

      {!loaded ? null : proposals.length === 0 ? (
        <div className="empty-state">No proposals yet. Create one to get started.</div>
      ) : (
        proposals.map(p => {
          const isSelected = job.selected_proposal_id === p.id;
          const status = statusFor(p);
          const busy = busyId === p.id;
          return (
            <div key={p.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: '12px 14px', border: '1px solid var(--panel-line)', borderRadius: 6, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14 }}>{p.name}</b>
                  {isSelected && <span className="badge" style={{ background: '#3a6b45' }}>Selected</span>}
                  <span className="badge" style={{ background: status.color }}>{status.label}</span>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--heading)' }}>{fmtMoney(p.contract_price)}</div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => setEditing(p)} disabled={busy}>Edit</button>
                {!isSelected && (
                  <button className="btn btn-primary btn-sm" onClick={() => selectProposal(p)} disabled={busy}>
                    {busy ? 'Working…' : 'Select'}
                  </button>
                )}
                <Link href={`/jobs/${jobId}/proposal/${p.id}`} className="btn btn-sm">View / Send</Link>
                <button className="btn btn-sm" onClick={() => copyLink(p)} disabled={busy}>Copy Link</button>
                <button className="btn btn-sm" onClick={() => createProposal(p)} disabled={busy}>Duplicate</button>
                <button className="btn btn-danger btn-sm" onClick={() => deleteProposal(p)} disabled={busy}>
                  {busy ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })
      )}

      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={() => createProposal(null)}>+ New Proposal</button>
      </div>

      {editing && (
        <ProposalEditorModal
          proposal={editing}
          projectType={job.project_type}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}

function ProposalEditorModal({ proposal, projectType, onClose, onSave }) {
  const [name, setName] = useState(proposal.name);
  const [price, setPrice] = useState(proposal.contract_price ?? '');
  const [scope, setScope] = useState((proposal.scope_items || []).map(i => i.text || ''));
  const [terms, setTerms] = useState((proposal.additional_terms || []).map(i => i.text || ''));
  const [saving, setSaving] = useState(false);

  function addScope() { setScope(prev => [...prev, '']); }
  function updateScope(i, v) { setScope(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function removeScope(i) { setScope(prev => prev.filter((_, idx) => idx !== i)); }

  function addTerm() { setTerms(prev => [...prev, '']); }
  function updateTerm(i, v) { setTerms(prev => prev.map((t, idx) => idx === i ? v : t)); }
  function removeTerm(i) { setTerms(prev => prev.filter((_, idx) => idx !== i)); }
  function restoreStandardTerms() {
    const standard = standardTermsFor(projectType).map(t => t.text);
    setTerms(prev => {
      const existingSet = new Set(prev.map(t => t.trim()));
      return [...prev, ...standard.filter(t => !existingSet.has(t.trim()))];
    });
  }

  async function save() {
    setSaving(true);
    await onSave({
      name: name.trim() || proposal.name,
      contract_price: price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) : null,
      scope_items: scope.filter(t => t.trim()).map(text => ({ text })),
      additional_terms: terms.filter(t => t.trim()).map(text => ({ text })),
    });
    setSaving(false);
  }

  return (
    <PopupModal open onClose={onClose} maxWidth={720}>
      <h3 style={{ marginTop: 0 }}>Edit proposal</h3>
      <label>Proposal name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Option A — Full Remodel" />

      <label style={{ marginTop: 14 }}>Total contract price ($)</label>
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 185,000" />

      <label style={{ marginTop: 18 }}>Scope of work</label>
      {scope.length === 0 && <div className="empty-state">No scope items yet.</div>}
      {scope.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => updateScope(i, e.target.value)} />
          <button className="row-remove" onClick={() => removeScope(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={addScope}>+ Add item</button>
      </div>

      <label style={{ marginTop: 18 }}>Assumptions &amp; exclusions</label>
      {terms.length === 0 && <div className="empty-state">None added.</div>}
      {terms.map((text, i) => (
        <div className="list-row" key={i}>
          <textarea value={text} onChange={e => updateTerm(i, e.target.value)} />
          <button className="row-remove" onClick={() => removeTerm(i)}>×</button>
        </div>
      ))}
      <div className="section-actions">
        <button className="btn btn-sm" onClick={addTerm}>+ Add item</button>
        <button className="btn btn-sm" onClick={restoreStandardTerms}>↺ Restore standard list</button>
      </div>

      <div className="section-actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save proposal'}</button>
      </div>
    </PopupModal>
  );
}
