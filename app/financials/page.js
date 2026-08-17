'use client';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';

export default function Page() {
  const { session, loading } = useRequireAuth();
  if (loading || !session) return null;
  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 20px', color: 'var(--heading)' }}>Financial Dashboard</h2>
        <div className="card"><div className="empty-state">Financial Dashboard is coming in a future update.</div></div>
      </div>
    </AppShell>
  );
}
