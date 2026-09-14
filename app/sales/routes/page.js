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

function formatAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

function formatStopTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function RouteHistory({ staffId }) {
  const [history, setHistory] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (!staffId) return;
    listRouteHistory(staffId).then(setHistory);
  }, [staffId]);

  if (!history || history.length === 0) return null;

  return (
    <div className="card">
      <h3>Recent Routes</h3>
      {history.map(r => {
        const stops = r.stops || [];
        const visited = stops.filter(s => s.visited_at).length;
        const isOpen = openId === r.id;
        return (
          <div key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : r.id)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', padding: '9px 0', fontSize: 13, background: 'none', border: 'none',
                cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{isOpen ? '▾' : '▸'} {formatWhen(r.created_at)} — {stops.length} stop{stops.length === 1 ? '' : 's'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{visited} visited{r.start_label ? ` · from ${r.start_label}` : ''}{r.end_label ? ` · to ${r.end_label}` : ''}</div>
              </div>
              <span className={`badge ${r.status === 'completed' ? 'badge-approved' : ''}`}>{STATUS_LABELS[r.status] || r.status}</span>
            </button>

            {isOpen && (
              <div style={{ padding: '2px 0 12px 16px' }}>
                {stops.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No stops recorded on this route.</div>
                ) : stops.map((s, i) => (
                  <div key={s.property_id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: i === stops.length - 1 ? 'none' : '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{i + 1}. {s.property_name}</div>
                      {(s.property_type || s.management_company) && (
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{[s.property_type, s.management_company].filter(Boolean).join(' · ')}</div>
                      )}
                      {formatAddress(s) && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{formatAddress(s)}</div>}
                    </div>
                    <span className={`badge ${s.visited_at ? 'badge-approved' : ''}`} style={{ flexShrink: 0, fontSize: 10.5 }}>
                      {s.visited_at ? `Visited ${formatStopTime(s.visited_at)}` : 'Not visited'}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
