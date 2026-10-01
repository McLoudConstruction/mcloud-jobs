'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { listOpenRoutes } from '../../lib/salesRoutes';
import { dwellFor, isPending, formatMinutes } from '../../lib/routeTiming';

function milesText(meters) {
  if (meters == null) return null;
  const miles = Number(meters) / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

// Saved and in-progress sales routes on the main Dashboard. Each row opens
// the route overview (map with the route highlighted, stops alongside).
export default function SavedRoutesCard() {
  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (staffId) => {
    try {
      setRoutes(await listOpenRoutes(staffId));
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your routes.');
      setRoutes(prev => prev || []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let staffId = null;
    supabase.auth.getUser().then(({ data }) => {
      staffId = data?.user?.id || null;
      if (cancelled || !staffId) return;
      load(staffId);
      channel = supabase.channel('dashboard-routes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_routes' }, () => load(staffId))
        .subscribe();
    });
    const onVisible = () => { if (document.visibilityState === 'visible' && staffId) load(staffId); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Sales Routes{routes && routes.length > 0 ? ` (${routes.length})` : ''}</h3>
        <Link href="/sales/routes" className="btn btn-sm">Build a route</Link>
      </div>

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
      {routes === null && <div className="dash-empty-state" style={{ marginTop: 10 }}>Loading…</div>}
      {routes !== null && routes.length === 0 && (
        <div className="dash-empty-state" style={{ marginTop: 10 }}>
          No saved routes. Build one and choose Save Route to keep it here.
        </div>
      )}

      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {(routes || []).map(r => {
          const stops = r.stops || [];
          const live = stops.filter(s => !s.skipped_at);
          const visited = live.filter(s => s.visited_at).length;
          const ahead = stops.filter(isPending);
          const onSite = ahead.reduce((sum, s) => sum + dwellFor(s, r.default_dwell_minutes), 0);
          const driveMin = r.est_drive_seconds != null ? Math.round(Number(r.est_drive_seconds) / 60) : null;
          const miles = milesText(r.est_meters);
          const first = live[0]?.property_name;
          const last = live[live.length - 1]?.property_name;
          const saved = new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const bits = [
            miles,
            driveMin != null ? `${formatMinutes(driveMin + onSite)} total` : (onSite ? `${formatMinutes(onSite)} at stops` : null),
            r.status === 'active' ? `${visited} of ${live.length} visited` : null,
          ].filter(Boolean);
          return (
            <Link key={r.id} href={`/sales/routes/${r.id}`} style={rowLinkStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {live.length} stop{live.length === 1 ? '' : 's'}
                  {first && last && live.length > 1 ? `, ${first} to ${last}` : first ? `, ${first}` : ''}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {bits.length > 0 ? `${bits.join(' · ')} · ` : ''}{r.status === 'active' ? 'started' : 'saved'} {saved}
                </div>
              </div>
              <span className={`badge ${r.status === 'saved' ? 'badge-scheduled' : 'badge-approved'}`} style={{ flexShrink: 0 }}>
                {r.status === 'active' ? 'In progress' : 'Saved'}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const rowLinkStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)',
  textDecoration: 'none', color: 'inherit',
};
