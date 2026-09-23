'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

// Shared data/logic for the customer-facing flexible-estimate picker —
// lifted out of the picker component so the proposal page can render its
// two halves in two different places: the scope-options chooser inside
// the printable document's own "Scope of work" section, and the
// Alternates + Submit box below it (interactive-only, not printed).
// Both need the same live groups/options and the same pick/toggle/submit
// actions, so they share one instance of this hook rather than each
// fetching independently.
export default function useEstimateGroupsPicker({ jobId, isAdmin, locked, estimateMode, selectedOptionId, basePrice, onSubmitted }) {
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
  const optionRequirementMet = !isMulti || !!localSelectedOptionId;
  const selectedOption = options.find(o => o.id === localSelectedOptionId);
  const alternatesTotal = groups.filter(g => g.included).reduce((sum, g) => sum + (Number(g.price) || 0), 0);
  const runningTotal = isMulti
    ? (Number(selectedOption?.price) || 0) + alternatesTotal
    : (Number(basePrice) || 0) + alternatesTotal;
  const hasAnything = groups.length > 0 || (isMulti && options.length > 0);

  return {
    groups, options, localSelectedOptionId, loaded, picking, submitting, error,
    isMulti, optionRequirementMet, selectedOption, alternatesTotal, runningTotal, hasAnything,
    pickOption, toggle, submit,
  };
}
