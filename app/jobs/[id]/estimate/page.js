'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Estimate is now a real tab on the job page itself, not a separate
// route — this just catches any old bookmarks/links and sends them to
// the right place instead of 404ing.
export default function EstimateRedirect() {
  const { id } = useParams();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/jobs/${id}?tab=Estimate`);
  }, [id, router]);
  return null;
}
