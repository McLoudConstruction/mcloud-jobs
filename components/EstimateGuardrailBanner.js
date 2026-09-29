'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Two independent checks, shown while a job is still being priced:
//   • Margin — this job type's proposed margin vs. your own historical
//     average for that job type (not a market price list — see migration
//     141 for why sub pricing makes a granular price book unreliable).
//   • Staleness — how long since the price was last touched.
// Informational only; nothing here blocks saving or sending.
export default function EstimateGuardrailBanner({ job }) {
  const [benchmark, setBenchmark] = useState(null);
  const [staleDays, setStaleDays] = useState(null);
  const [thresholdDays, setThresholdDays] = useState(14);

  const [subCost, setSubCost] = useState(null);

  useEffect(() => {
    let active = true;
    if (!job.job_type || !job.contract_price) { setBenchmark(null); return; }
    supabase.rpc('estimate_margin_benchmark', { p_job_type: job.job_type }).then(({ data }) => { if (active) setBenchmark(data || null); });
    return () => { active = false; };
  }, [job.job_type, job.contract_price]);

  useEffect(() => {
    let active = true;
    if (!job.id || !job.contract_price) { setSubCost(null); return; }
    supabase.from('work_orders').select('amount').eq('job_id', job.id).in('status', ['accepted', 'issued']).then(({ data }) => {
      if (active) setSubCost((data || []).reduce((sum, w) => sum + (Number(w.amount) || 0), 0));
    });
    return () => { active = false; };
  }, [job.id, job.contract_price]);

  useEffect(() => {
    supabase.from('app_settings').select('estimate_staleness_days').eq('id', 1).maybeSingle().then(({ data }) => {
      if (data?.estimate_staleness_days) setThresholdDays(data.estimate_staleness_days);
    });
  }, []);

  useEffect(() => {
    if (!job.priced_at) { setStaleDays(null); return; }
    setStaleDays(Math.floor((Date.now() - new Date(job.priced_at).getTime()) / 86400000));
  }, [job.priced_at]);

  const cost = (job.contract_price && subCost !== null) ? Math.round((job.contract_price - subCost) / job.contract_price * 1000) / 10 : null;
  const showMargin = benchmark?.avg_margin_pct != null && cost != null && cost < benchmark.avg_margin_pct - 8;
  const showStale = staleDays != null && staleDays >= thresholdDays;

  if (!showMargin && !showStale) return null;

  return (
    <div style={{ background: '#f7efdc', border: '1px solid #e3cf9e', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#6b5323', lineHeight: 1.5 }}>
      {showMargin && (
        <div>Heads up: this estimate's implied margin looks thinner than usual — your last {benchmark.sample_size} {job.job_type} job(s) averaged about {benchmark.avg_margin_pct}% margin.</div>
      )}
      {showStale && (
        <div style={showMargin ? { marginTop: 4 } : undefined}>This price hasn't been revisited in {staleDays} days — worth a quick check before sending.</div>
      )}
    </div>
  );
}
