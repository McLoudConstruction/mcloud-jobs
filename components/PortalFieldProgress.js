'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { FIELD_PROGRESS_LABELS } from '../lib/constants';

// Friendly field-progress status line for Home — reads the
// customer_visible_work_order_progress view (migration 122), which
// exposes only trade/status/field_progress for the customer's own job,
// never the amount McLoud pays each sub. Renders nothing at all until
// there's at least one work order past negotiation (accepted or later),
// so an early-stage project doesn't show an empty section.
function progressColor(fp) {
  if (fp === 'completed') return 'var(--money)';
  if (fp === 'in_progress') return 'var(--accent)';
  return 'var(--ink-soft)';
}

export default function PortalFieldProgress({ jobId }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!jobId) return;
    const { data } = await supabase.from('customer_visible_work_order_progress').select('*').eq('job_id', jobId);
    setRows(data || []);
    setLoaded(true);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    load();
    const channel = supabase.channel(`portal-field-progress-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  if (!jobId || !loaded || rows.length === 0) return null;

  return (
    <div className="dash-section">
      <h3>Field Progress</h3>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--line)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.trade || 'Work'}</div>
            {r.description && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{r.description}</div>}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: progressColor(r.field_progress) }}>
            {FIELD_PROGRESS_LABELS[r.field_progress] || 'Not Started'}
          </span>
        </div>
      ))}
    </div>
  );
}
