'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import RouteBuilderCore from '../../../components/RouteBuilderCore';
import ManualRouteBuilderCore from '../../../components/ManualRouteBuilderCore';
import { listRouteHistory, repeatRoute, deleteRoute } from '../../../lib/salesRoutes';

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

function RouteHistory({ staffId, onChanged }) {
  const [history, setHistory] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [repeatingId, setRepeatingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!staffId) return;
    listRouteHistory(staffId).then(setHistory);
  }, [staffId]);

  async function handleRepeat(r) {
    setActionError('');
    setRepeatingId(r.id);
    try {
      await repeatRoute(r);
      if (onChanged) onChanged();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setRepeatingId(null);
    }
  }

  async function handleDelete(r) {
    setActionError('');
    setDeletingId(r.id);
    try {
      await deleteRoute(r.id);
      setConfirmDeleteId(null);
      setHistory(prev => (prev || []).filter(x => x.id !== r.id));
      if (onChanged) onChanged();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  if (!history || history.length === 0) return null;

  return (
    <div className="card">
      <h3>Recent Routes</h3>
      {actionError && <div style={{ fontSize: 12, color: '#a13f3f', marginBottom: 8 }}>{actionError}</div>}
      {history.map(r => {
        const stops = r.stops || [];
        const visited = stops.filter(s => s.visited_at).length;
        const isOpen = openId === r.id;
        return (
          <div key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 0' }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(isOpen ? null : r.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpenId(isOpen ? null : r.id); }}
                style={{ flex: 1, cursor: 'pointer', fontSize: 13 }}
              >
                <div style={{ fontWeight: 600 }}>{isOpen ? '▾' : '▸'} {formatWhen(r.created_at)} — {stops.length} stop{stops.length === 1 ? '' : 's'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{visited} visited{r.start_label ? ` · from ${r.start_label}` : ''}{r.end_label ? ` · to ${r.end_label}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className={`badge ${r.status === 'completed' ? 'badge-approved' : ''}`}>{STATUS_LABELS[r.status] || r.status}</span>
                {r.status === 'completed' && (
                  <button type="button" className="btn btn-sm" disabled={repeatingId === r.id} onClick={() => handleRepeat(r)}>
                    {repeatingId === r.id ? 'Starting…' : 'Repeat Route'}
                  </button>
                )}
                {confirmDeleteId === r.id ? (
                  <>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Delete this route?</span>
                    <button type="button" className="btn btn-sm btn-danger" disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                      {deletingId === r.id ? 'Deleting…' : 'Confirm'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteId(r.id)}>Delete</button>
                )}
              </div>
            </div>

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
  // Bumped whenever an action in one component (repeating a route from
  // history, say) needs the other to re-fetch — remounting both via `key`
  // is simpler and safer here than threading shared route state between
  // two otherwise-independent components.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    if (!session) return;
    supabase.auth.getUser().then(({ data }) => setStaffId(data?.user?.id || null));
  }, [session]);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <ManualRouteBuilderCore key={`manual-${refreshKey}`} onRouteChanged={bumpRefresh} />
        <RouteBuilderCore />
        <RouteHistory key={`history-${refreshKey}`} staffId={staffId} onChanged={bumpRefresh} />
      </div>
    </AppShell>
  );
}
