'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

const StaffAuthContext = createContext({ session: null, role: null, status: null, loading: true });

// Fetched once for the whole app (mounted in the root layout) instead of
// per-page, since nearly every internal page and AppShell itself both
// need the caller's staff role.
export function StaffAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStaffRow = useCallback(async (sess) => {
    if (!sess) {
      setRole(null);
      setStatus(null);
      return;
    }
    const { data, error } = await supabase.from('staff_users').select('role, status').eq('id', sess.user.id).maybeSingle();

    if (error && (error.code === '42P01' || /relation .* does not exist/i.test(error.message || ''))) {
      // staff_users migration hasn't been run yet on this environment —
      // fall back to the old flat admin flag so deploy order (code before
      // migration) doesn't lock everyone out. Run migration 079 to move
      // off of this.
      const legacyAdmin = sess.user.app_metadata?.role === 'admin';
      setRole(legacyAdmin ? 'owner' : null);
      setStatus(legacyAdmin ? 'active' : null);
      return;
    }

    if (!data) {
      // Table exists but this account has no staff_users row yet — no
      // more silent fallback to app_metadata once the table is live;
      // access must be explicitly granted by an Owner.
      setRole(null);
      setStatus(null);
      return;
    }

    setRole(data.role);
    setStatus(data.status);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadStaffRow(data.session);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      await loadStaffRow(newSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadStaffRow]);

  return (
    <StaffAuthContext.Provider value={{ session, role, status, loading }}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth() {
  return useContext(StaffAuthContext);
}
