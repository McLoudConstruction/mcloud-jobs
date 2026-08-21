'use client';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import RouteBuilderModal from '../../../components/RouteBuilderModal';

export default function RouteBuilderPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>Route Builder</h2>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Build a driving route through properties worth visiting, avoiding anywhere you've been recently.</div>
      </div>
      <RouteBuilderModal open={true} onClose={() => router.push('/sales')} />
    </AppShell>
  );
}
