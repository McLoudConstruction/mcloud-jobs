'use client';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import AccountPanel from '../../../components/AccountPanel';

// Open to every staff role (see lib/permissions.js). The rest of /settings is
// Owner only.
export default function AccountPage() {
  const { session, loading } = useRequireAuth();
  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Account</h2>
        </div>
        <AccountPanel />
      </div>
    </AppShell>
  );
}
