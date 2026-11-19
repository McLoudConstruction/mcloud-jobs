'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Contract minimums (Settings > Automation). A job under its minimum can't move to
// Approved until an owner records an override. The database trigger in migration 179
// is the real rule; this is what lets the screens show it up front.

const PRE_APPROVAL_STAGES = ['new', 'inspected', 'proposal_delivered', 'lost'];

export function minimumFor(settings, projectType) {
  const v = projectType === 'commercial' ? settings?.contract_min_commercial : settings?.contract_min_residential;
  return Number(v) || 0;
}

export function contractMinimumStatus(job, settings) {
  const minimum = minimumFor(settings, job?.project_type);
  const price = Number(job?.contract_price) || 0;
  const below = minimum > 0 && price < minimum;
  const overridden = !!job?.min_override_at && price >= Number(job?.min_override_price || 0);
  const beforeApproval = PRE_APPROVAL_STAGES.includes(job?.stage);
  const kind = job?.project_type === 'commercial' ? 'commercial' : 'residential';
  return {
    kind, minimum, price, below, overridden,
    needsOverride: below && !overridden && beforeApproval,
    // Show the flag while it's actionable, or afterwards as a record that it was overridden.
    show: !!job && ((below && beforeApproval && (price > 0 || !!job.below_minimum_flagged_at)) || !!job.min_override_at),
  };
}

export function useContractMinimum(job) {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from('app_settings').select('contract_min_residential, contract_min_commercial').eq('id', 1).maybeSingle()
      .then(({ data, error }) => {
        // Columns missing = migration 179 not run yet: behave as "no minimum".
        if (!cancelled && !error) setSettings(data || null);
      });
    return () => { cancelled = true; };
  }, []);
  return contractMinimumStatus(job, settings);
}
