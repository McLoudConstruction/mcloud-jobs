'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from './supabaseClient';
import { useStaffAuth } from './staffAuthContext';
import { canAccessPath } from './permissions';

// Redirects to /login if there's no session, to /customerportal if the
// session exists but isn't staff (e.g. a customer's magic-link session),
// or back to /dashboard if the signed-in staff member's role doesn't
// have access to the current page. Returns { session, loading, role }.
export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, role, status, loading } = useStaffAuth();

  useEffect(() => {
    if (loading) return;

    if (!session) {
      router.replace('/login');
      return;
    }

    if (status === 'disabled') {
      supabase.auth.signOut().then(() => router.replace('/login'));
      return;
    }

    if (!role) {
      // Signed in, but not a recognized staff account (e.g. a customer
      // portal session, or a staff login with no staff_users row yet).
      router.replace('/customerportal');
      return;
    }

    if (!canAccessPath(role, pathname)) {
      router.replace('/dashboard');
    }
  }, [loading, session, role, status, pathname, router]);

  return { session, loading, role };
}
