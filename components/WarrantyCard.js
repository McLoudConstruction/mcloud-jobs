'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import PunchItemsPanel from './PunchItemsPanel';
import { fmtPunchDate } from '../lib/punch';

const todayStr = () => new Date().toISOString().slice(0, 10);

// Closeout → Warranty. The warranty period itself (created automatically when
// the job is marked Completed) plus any claims the customer has filed.
export default function WarrantyCard({ jobId, job }) {
  const [warranty, setWarranty] = useState(undefined);
  const [error, setError] = useState('');
  const [months, setMonths] = useState(12);

  const load = useCallback(async () => {
    const [{ data: w }, { data: s }] = await Promise.all([
      supabase.from('warranties').select('*').eq('job_id', jobId).maybeSingle(),
      supabase.from('app_settings').select('warranty_default_months').eq('id', 1).maybeSingle(),
    ]);
    setWarranty(w || null);
    if (s?.warranty_default_months) setMonths(s.warranty_default_months);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`warranty-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warranties', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  async function start() {
    setError('');
    const s = new Date();
    const e = new Date(s);
    e.setMonth(e.getMonth() + months);
    const { error: err } = await supabase.from('warranties').insert({ job_id: jobId, start_date: s.toISOString().slice(0, 10), end_date: e.toISOString().slice(0, 10), months });
    if (err) setError(err.message); else load();
  }

  async function patch(changes) {
    setError('');
    const { error: err } = await supabase.from('warranties').update(changes).eq('id', warranty.id);
    if (err) setError(err.message); else load();
  }

  if (warranty === undefined) return null;
  const daysLeft = warranty ? Math.round((new Date(warranty.end_date + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000) : null;

  return (
    <div className="card">
      <h3>Warranty</h3>
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      {!warranty ? (
        <div>
          <div className="empty-state" style={{ marginBottom: 10 }}>
            No warranty period yet. One is created automatically when a job is marked Completed{job?.stage === 'completed' || job?.stage === 'invoiced' || job?.stage === 'paid' ? ' — this job was completed before that was switched on' : ''}.
          </div>
          <button className="btn btn-sm" onClick={start}>Start a {months}-month warranty today</button>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>
            <b>{warranty.status === 'void' ? 'Void' : daysLeft < 0 ? 'Expired' : 'Active'}</b>
            {' · '}{fmtPunchDate(warranty.start_date)} to {fmtPunchDate(warranty.end_date)} ({warranty.months} months)
            {warranty.status === 'active' && daysLeft >= 0 && <span style={{ color: 'var(--ink-soft)' }}> · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>}
          </div>
          <div className="two-col" style={{ marginTop: 10 }}>
            <div>
              <label>Warranty ends</label>
              <input type="date" defaultValue={warranty.end_date} onBlur={e => e.target.value && e.target.value !== warranty.end_date && patch({ end_date: e.target.value })} />
            </div>
            <div>
              <label>&nbsp;</label>
              <button className="btn btn-sm" onClick={() => patch({ status: warranty.status === 'void' ? 'active' : 'void' })}>{warranty.status === 'void' ? 'Reinstate' : 'Void warranty'}</button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
            The customer can file claims from their portal while the warranty is active. Claims appear below and notify the office.
          </div>
        </div>
      )}
      <h4 style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9b773d', margin: '16px 0 8px' }}>Claims</h4>
      <PunchItemsPanel jobId={jobId} kind="warranty" />
    </div>
  );
}
