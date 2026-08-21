'use client';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import RouteBuilderCore from '../../../components/RouteBuilderCore';

export default function RouteBuilderPage() {
  const { session, loading } = useRequireAuth();

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <RouteBuilderCore />
      </div>
    </AppShell>
  );
}
