'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { acceptedChangeOrdersTotal } from './jobFinancials';

// Contract minimums (Settings > Automation). A job under its minimum can't move to
// Approved until an owner records an override. The database trigger (migrations 179/180)
// is the real rule; this is what lets the screens show it up front.
//
// The minimum is measured against either the base contract price or the contract value
// (base price + accepted change orders), per the "contract_min_basis" setting.

const PRE_APPROVAL_STAGES = ['new', 'inspected', 'proposal_delivered', 'lost'];

export function minimumFor(settings, projectType) {
  const v = projectType === 'commercial' ? settings?.contract_min_commercial : settings?.contract_min_residential;
  return Number(v) || 0;
}

export function contractMinimumStatus(job, settings, acceptedCOTotal = 0) {
  const minimum = minimumFor(settings, job?.project_type);
  const usesContractValue = settings?.contract_min_basis === 'contract_value';
  const price = (Number(job?.contract_price) || 0) + (usesContractValue ? acceptedCOTotal : 0);
  const below = minimum > 0 && price < minimum;
  const overridden = !!job?.min_override_at && price >= Number(job?.min_override_price || 0);
  const beforeApproval = PRE_APPROVAL_STAGES.includes(job?.stage);
  const kind = job?.project_type === 'commercial' ? 'commercial' : 'residential';
  return {
    kind, minimum, price, below, overridden,
    measure: usesContractValue ? 'contract value' : 'contract price',
    needsOverride: below && !overridden && beforeApproval,
    // Show the flag while it's actionable, or afterwards as a record that it was overridden.
    show: !!job && ((below && beforeApproval && (price > 0 || !!job.below_minimum_flagged_at)) || !!job.min_override_at),
  };
}

export function useContractMinimum(job) {
  const [settings, setSettings] = useState(null);
  const [coTotal, setCoTotal] = useState(0);
  const jobId = job?.id;

  useEffect(() => {
    let cancelled = false;
    supabase.from('app_settings').select('contract_min_residential, contract_min_commercial, contract_min_basis').eq('id', 1).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) { setSettings(data || null); return; }
        // contract_min_basis missing = migration 180 not run yet: fall back to the base price.
        supabase.from('app_settings').select('contract_min_residential, contract_min_commercial').eq('id', 1).maybeSingle()
          .then(({ data: d2, error: e2 }) => { if (!cancelled && !e2) setSettings(d2 || null); });
      });
    return () => { cancelled = true; };
  }, []);

  const needsCOs = settings?.contract_min_basis === 'contract_value';
  useEffect(() => {
    if (!needsCOs || !jobId) { setCoTotal(0); return; }
    let cancelled = false;
    supabase.from('change_orders').select('amount, co_signatures').eq('job_id', jobId)
      .then(({ data, error }) => { if (!cancelled && !error) setCoTotal(acceptedChangeOrdersTotal(data)); });
    return () => { cancelled = true; };
  }, [needsCOs, jobId]);

  return contractMinimumStatus(job, settings, coTotal);
}
