'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '$0';
  const n = Number(v);
  return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtMoneyPlain(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Customer-facing interactive picker for a job's Choose One / Alternate
// groups (the flexible-estimate feature) — rendered on the live estimate
// document below the base scope. Picks are saved immediately (tentative,
// changeable) via RPC; the final Submit locks everything in and flattens
// it into the job's scope/price, same pattern as Material Selections.
// isAdmin gets the same view but read-only (preview, no picking) with a
// note pointing back to the Estimate tab to build/edit groups there.
export default function EstimateGroupsPicker({ jobId, isAdmin, locked, basePrice, onSubmitted }) {
  const [groups, setGroups] = useState([]);
  const [choices, setChoices] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(null); // group id currently being written
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: choiceData }] = await Promise.all([
      supabase.from('estimate_groups').select('*').eq('job_id', jobId).order('sort_order'),
      supabase.from('estimate_group_choices').select('*').order('sort_order'),
    ]);
    setGroups(groupData || []);
    setChoices(choiceData || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`estimate-groups-picker-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_groups', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_group_choices' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function pick(group, choiceId) {
    if (isAdmin || locked) return;
    setPicking(group.id);
    setError('');
    const { error: rpcError } = await supabase.rpc('pick_estimate_group_choice', { target_group_id: group.id, target_choice_id: choiceId });
    setPicking(null);
    if (rpcError) { setError(rpcError.message); return; }
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, selected_choice_id: choiceId } : g));
  }

  async function toggle(group, include) {
    if (isAdmin || locked) return;
    setPicking(group.id);
    setError('');
    const { error: rpcError } = await supabase.rpc('toggle_estimate_alternate', { target_group_id: group.id, include_it: include });
    setPicking(null);
    if (rpcError) { setError(rpcError.message); return; }
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, included: include } : g));
  }

  async function submit() {
    if (!allChooseOnePicked) return;
    if (!window.confirm('Submit your selections? The price and scope will lock in and can no longer be changed here.')) return;
    setSubmitting(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('submit_estimate_groups', { target_job_id: jobId });
    setSubmitting(false);
    if (rpcError) { setError(rpcError.message); return; }
    onSubmitted?.();
  }

  if (!loaded || groups.length === 0) return null;

  const chooseOneGroups = groups.filter(g => g.kind === 'choose_one');
  const alternateGroups = groups.filter(g => g.kind === 'alternate');
  const allChooseOnePicked = chooseOneGroups.every(g => g.selected_choice_id);

  const selectedTotal = chooseOneGroups.reduce((sum, g) => {
    const c = choices.find(x => x.id === g.selected_choice_id);
    return sum + (c ? Number(c.price) || 0 : 0);
  }, 0) + alternateGroups.filter(g => g.included).reduce((sum, g) => sum + (Number(g.price) || 0), 0);

  const runningTotal = (Number(basePrice) || 0) + selectedTotal;

  return (
    <div className="no-print" style={{ marginTop: 24, padding: '18px 24px', background: '#faf6ec', border: '1px solid #ded7c0', borderRadius: 8, maxWidth: 800, marginLeft: 'auto', marginRight: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', color: '#1C1B19' }}>Options for This Project</h3>
      {isAdmin ? (
        <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
          Preview only — the customer picks these when they view this estimate. Build or edit groups from the job's Estimate tab.
        </div>
      ) : locked ? (
        <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 14 }}>
          Your selections have been submitted and are reflected in the price and scope above.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
          Review the options below, then submit your picks — the total updates as you choose.
        </div>
      )}

      {chooseOneGroups.map(g => {
        const groupChoices = choices.filter(c => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div key={g.id} style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19' }}>{g.label}</div>
            {g.description && <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 8 }}>{g.description}</div>}
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {groupChoices.map(c => {
                const isChosen = g.selected_choice_id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={isAdmin || locked || picking === g.id}
                    onClick={() => pick(g, c.id)}
                    style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 6, cursor: isAdmin || locked ? 'default' : 'pointer',
                      border: isChosen ? '2px solid #9B773D' : '1px solid #ded7c0',
                      background: isChosen ? '#fff' : '#fdfcf8',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    }}
                  >
                    <span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#1C1B19' }}>{isChosen ? '● ' : '○ '}{c.label}</span>
                      {c.description && <span style={{ display: 'block', fontSize: 11.5, color: '#6b6350', marginTop: 2 }}>{c.description}</span>}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtMoneyPlain(c.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {alternateGroups.map(g => (
        <div key={g.id} style={{ marginBottom: 14 }}>
          <button
            type="button"
            disabled={isAdmin || locked || picking === g.id}
            onClick={() => toggle(g, !g.included)}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 6, cursor: isAdmin || locked ? 'default' : 'pointer',
              border: g.included ? '2px solid #9B773D' : '1px solid #ded7c0',
              background: g.included ? '#fff' : '#fdfcf8',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}
          >
            <span>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#1C1B19' }}>{g.included ? '☑ ' : '☐ '}{g.label}</span>
              {g.description && <span style={{ display: 'block', fontSize: 11.5, color: '#6b6350', marginTop: 2 }}>{g.description}</span>}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtMoney(g.price)}</span>
          </button>
        </div>
      ))}

      {!isAdmin && !locked && (
        <div style={{ borderTop: '1px solid #ded7c0', marginTop: 14, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 14 }}>
            <span style={{ color: '#6b6350' }}>Estimated total with your picks: </span>
            <b style={{ fontSize: 17, color: '#1C1B19' }}>{fmtMoneyPlain(runningTotal)}</b>
          </div>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={!allChooseOnePicked || submitting}>
            {submitting ? 'Submitting…' : allChooseOnePicked ? 'Submit My Selections' : 'Pick one option in every group above'}
          </button>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
    </div>
  );
}
