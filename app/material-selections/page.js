'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import DataTable from '../../components/DataTable';

const STATUS_LABELS = { draft: 'Draft', sent: 'Awaiting Customer', approved: 'Approved' };
const STATUS_URGENCY = { sent: 2, draft: 1, approved: 0 }; // awaiting-customer sheets surface first

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MaterialSelectionsDashboardPage() {
  const { session, loading } = useRequireAuth();
  const [selections, setSelections] = useState([]);
  const [optionCounts, setOptionCounts] = useState({});

  const loadAll = useCallback(async () => {
    const { data } = await supabase
      .from('material_selections')
      .select('*, jobs(job_number, customer_name)')
      .order('created_at', { ascending: false });
    if (data) setSelections(data);

    const { data: opts } = await supabase.from('material_selection_options').select('selection_id');
    if (opts) {
      const counts = {};
      opts.forEach(o => { counts[o.selection_id] = (counts[o.selection_id] || 0) + 1; });
      setOptionCounts(counts);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    loadAll();
    const channel = supabase.channel('material-selections-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selection_options' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  if (loading || !session) return null;

  const rows = selections
    .map(s => ({
      ...s,
      job_number: s.jobs?.job_number,
      customer_name: s.jobs?.customer_name || 'Unnamed',
      option_count: optionCounts[s.id] || 0,
      urgency: STATUS_URGENCY[s.status] ?? 1,
    }))
    .sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  return (
    <AppShell>
      <div className="container container-wide">
        <h2 style={{ margin: '0 0 6px', color: 'var(--heading)' }}>Material Selections</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
          Every material selection sheet across every job, in one place. Click a row to open it.
        </div>

        {rows.length === 0 && <div className="empty-state">No material selections yet.</div>}
        {rows.length > 0 && (
          <DataTable
            getRowKey={r => r.id}
            onRowClick={r => window.location.href = `/jobs/${r.job_id}/material-selections/${r.id}`}
            rows={rows}
            rowClassName={r => r.status === 'approved' ? 'row-settled' : ''}
            columns={[
              { key: 'job_number', label: 'Job #', defaultWidth: 90, render: r => r.job_number ? `#${r.job_number}` : '—' },
              { key: 'customer_name', label: 'Customer', defaultWidth: 180, render: r => r.customer_name },
              { key: 'title', label: 'Selection', defaultWidth: 220, render: r => r.title },
              { key: 'status', label: 'Status', defaultWidth: 150, render: r => STATUS_LABELS[r.status] || r.status },
              { key: 'option_count', label: 'Options', defaultWidth: 90, filterable: false, render: r => r.option_count },
              { key: 'created_at', label: 'Created', defaultWidth: 130, filterable: false, render: r => fmtDate(r.created_at) },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
