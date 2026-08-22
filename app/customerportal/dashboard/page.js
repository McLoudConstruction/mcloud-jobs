'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This route used to be the customer portal's main page — now split into
// Projects/Inbox/Invoices under a real sidebar. Kept as a redirect so any
// already-sent magic-link emails pointing here still land somewhere real.
export default function CustomerPortalDashboardRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/customerportal/projects'); }, [router]);
  return null;
}
