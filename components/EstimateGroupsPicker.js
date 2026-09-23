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

// Customer-facing interactive picker for a job's flexible estimate,
// rendered on the live estimate document below the base scope. Two
// independent pieces:
//   - Scope options (multi-option mode only) — two or more entirely
//     separate scopes of work; the customer picks exactly one, and its
//     own full scope + price becomes the base of the estimate.
//   - Alternates — independently includable/deferrable add-ons layered
//     on top, regardless of mode.
// Picks are saved immediately (tentative, changeable) via RPC; the final
// Submit locks everything in and flattens it into the job's scope/price,
// same pattern as Material Selections. isAdmin gets the same view but
// read-only (preview, no picking) with a note pointing back to the
// Estimate tab to build/edit options and alternates there.
export default function EstimateGroupsPicker({ jobId, isAdmin, locked, estimateMode, selectedOptionId, basePrice, onSubmitted }) {
  const [groups, setGroups] = useState([]);
  const [options, setOptions] = useState([]);
  const [localSelectedOptionId, setLocalSelectedOptionId] = useState(selectedOptionId || null);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(null); // group/option id currently being written
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setLocalSelectedOptionId(selectedOptionId || null); }, [selectedOptionId]);

  const load = useCallback(async () => {
    const [{ data: groupData }, { data: optionData }] = await Promise.all([
      supabase.from('estimate_groups').select('*').eq('job_id', jobId).order('sort_order'),
      supabase.from('estimate_scope_options').select('*').eq('job_id', jobId).order('sort_order'),
    ]);
    setGroups(groupData || []);
    setOptions(optionData || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`estimate-groups-picker-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_groups', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_scope_options', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function pickOption(optionId) {
    if (isAdmin || locked) return;
    setPicking(optionId);
    setError('');
    const { error: rpcError } = await supabase.rpc('pick_scope_option', { target_job_id: jobId, target_option_id: optionId });
    setPicking(null);
    if (rpcError) { setError(rpcError.message); return; }
    setLocalSelectedOptionId(optionId);
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
    if (!optionRequirementMet) return;
    if (!window.confirm('Submit your selections? The price and scope will lock in and can no longer be changed here.')) return;
    setSubmitting(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('submit_estimate_groups', { target_job_id: jobId });
    setSubmitting(false);
    if (rpcError) { setError(rpcError.message); return; }
    onSubmitted?.();
  }

  const isMulti = estimateMode === 'multi';

  if (!loaded || (groups.length === 0 && (!isMulti || options.length === 0))) return null;

  const optionRequirementMet = !isMulti || !!localSelectedOptionId;

  const selectedOption = options.find(o => o.id === localSelectedOptionId);
  const alternatesTotal = groups.filter(g => g.included).reduce((sum, g) => sum + (Number(g.price) || 0), 0);
  const runningTotal = isMulti
    ? (Number(selectedOption?.price) || 0) + alternatesTotal
    : (Number(basePrice) || 0) + alternatesTotal;

  return (
    <div className="no-print" style={{ marginTop: 24, padding: '18px 24px', background: '#faf6ec', border: '1px solid #ded7c0', borderRadius: 8, maxWidth: 800, marginLeft: 'auto', marginRight: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', color: '#1C1B19' }}>Options for This Project</h3>
      {isAdmin ? (
        <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
          Preview only — the customer picks these when they view this estimate. Build or edit options/alternates from the job's Estimate tab.
        </div>
      ) : locked ? (
        <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 14 }}>
          Your selections have been submitted and are reflected in the price and scope above.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
          {isMulti ? 'This project has more than one way it could go — review the scopes below and choose one, then submit.' : 'Review the options below, then submit your picks — the total updates as you choose.'}
        </div>
      )}

      {isMulti && options.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19' }}>Choose your scope of work</div>
          <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 8 }}>Only one of these moves forward.</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {options.map(o => {
              const isChosen = localSelectedOptionId === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={isAdmin || locked || picking === o.id}
                  onClick={() => pickOption(o.id)}
                  style={{
                    textAlign: 'left', padding: '14px 16px', borderRadius: 6, cursor: isAdmin || locked ? 'default' : 'pointer',
                    border: isChosen ? '2px solid #9B773D' : '1px solid #ded7c0',
                    background: isChosen ? '#fff' : '#fdfcf8',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1C1B19' }}>{isChosen ? '● ' : '○ '}{o.label}</span>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtMoneyPlain(o.price)}</span>
                  </div>
                  {o.description && <div style={{ fontSize: 11.5, color: '#6b6350', marginTop: 4 }}>{o.description}</div>}
                  {(o.scope_items || []).length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#3a3730' }}>
                      {o.scope_items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it.text}</li>)}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {groups.map(g => (
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
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={!optionRequirementMet || submitting}>
            {submitting ? 'Submitting…' : optionRequirementMet ? 'Submit My Selections' : 'Choose a scope of work above'}
          </button>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
    </div>
  );
}
