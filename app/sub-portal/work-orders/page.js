'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';
import { WorkOrderRow } from '../dashboard/page';

export default function SubPortalWorkOrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, workOrders, jobsById, ready } = useSubPortalData(session);

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="card">
          <h3>All Work Orders</h3>
          {workOrders.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          {workOrders.map(wo => (
            <WorkOrderRow key={wo.id} wo={wo} job={jobsById[wo.job_id]} role={role} />
          ))}
        </div>
      </div>
    </SubPortalShell>
  );
}
