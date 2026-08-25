'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabaseClient';

// Used by the printable/emailable document pages (proposal, contract, invoice,
// update, change order). Unlike useRequireAuth, this does NOT require the
// admin role — it just requires *some* signed-in session, so an invited
// customer can open their own job's documents too. Row-level security on
// the `jobs` table is what actually restricts a customer to their own job;
// if they try to view someone else's, the fetch simply comes back empty.
export function useDocumentAuth() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace('/customerportal');
      } else {
        setSession(data.session);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
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
