'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabaseClient';

function isAdminSession(session) {
  return session?.user?.app_metadata?.role === 'admin';
}

// Redirects to /login if there's no session, or to /portal if the session
// exists but isn't the admin account (e.g. a customer's magic-link session).
// Returns { session, loading }.
export function useRequireAuth() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace('/login');
      } else if (!isAdminSession(data.session)) {
        router.replace('/customerportal');
      } else {
        setSession(data.session);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        router.replace('/login');
        return;
      }
      if (!isAdminSession(newSession)) {
        router.replace('/customerportal');
        return;
      }
      setSession(newSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  return { session, loading };
}
