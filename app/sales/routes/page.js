'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import RouteBuilderCore from '../../../components/RouteBuilderCore';
import ManualRouteBuilderCore from '../../../components/ManualRouteBuilderCore';
import { listRouteHistory } from '../../../lib/salesRoutes';

const STATUS_LABELS = { active: 'In progress', completed: 'Completed', canceled: 'Canceled' };

function formatWhen(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RouteHistory({ staffId }) {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (!staffId) return;
    listRouteHistory(staffId).then(setHistory);
  }, [staffId]);

  if (!history || history.length === 0) return null;

  return (
    <div className="card">
      <h3>Recent Routes</h3>
      {history.map(r => {
        const visited = (r.stops || []).filter(s => s.visited_at).length;
        return (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{formatWhen(r.created_at)} — {(r.stops || []).length} stop{(r.stops || []).length === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{visited} visited{r.start_label ? ` · from ${r.start_label}` : ''}{r.end_label ? ` · to ${r.end_label}` : ''}</div>
            </div>
            <span className={`badge ${r.status === 'completed' ? 'badge-approved' : ''}`}>{STATUS_LABELS[r.status] || r.status}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function RouteBuilderPage() {
  const { session, loading } = useRequireAuth();
  const [staffId, setStaffId] = useState(null);

  useEffect(() => {
    if (!session) return;
    supabase.auth.getUser().then(({ data }) => setStaffId(data?.user?.id || null));
  }, [session]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <ManualRouteBuilderCore />
        <RouteBuilderCore />
        <RouteHistory staffId={staffId} />
      </div>
    </AppShell>
  );
}
