'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import MaterialSelectionWizard from './MaterialSelectionWizard';

const STATUS_LABELS = { draft: 'Draft', sent: 'Awaiting Customer', approved: 'Approved' };

export default function MaterialSelectionsCard({ jobId }) {
  const [selections, setSelections] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('material_selections').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    if (data) setSelections(data);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`material-selections-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  return (
    <div className="card">
      <h3>Material Selections</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Get approval on a choice between specific products — brand, model, color, photos included — before it's installed.
      </div>

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-sm" onClick={() => setWizardOpen(true)}>+ New Selection</button>
      </div>

      <div style={{ marginTop: 14 }}>
        {selections.length === 0 && <div className="empty-state">No selections yet.</div>}
        {selections.map(s => (
          <Link key={s.id} href={`/jobs/${jobId}/material-selections/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
              <span className={`badge badge-${s.status === 'approved' ? 'paid' : s.status === 'sent' ? 'active' : 'draft'}`}>{STATUS_LABELS[s.status]}</span>
            </div>
          </Link>
        ))}
      </div>

      <MaterialSelectionWizard jobId={jobId} open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
