'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

// Shared across the sub-portal's Dashboard/Work Orders/Invoices pages —
// loads company/role/work orders/visible jobs once per page, all keyed
// off the same session.
export function useSubPortalData(session) {
  const [company, setCompany] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'crew'
  const [workOrders, setWorkOrders] = useState([]);
  const [jobsById, setJobsById] = useState({});
  const [ready, setReady] = useState(false);

  const loadAll = useCallback(async (email) => {
    const { data: companyData } = await supabase
      .from('companies')
      .select('*')
      .or(`contact_email.eq.${email},crew_email.eq.${email}`)
      .limit(1)
      .maybeSingle();
    if (!companyData) { setReady(true); return; }
    setCompany(companyData);
    setRole(companyData.contact_email === email ? 'admin' : 'crew');

    const { data: woData } = await supabase.from('work_orders').select('*').eq('company_id', companyData.id).order('created_at', { ascending: false });
    if (woData) setWorkOrders(woData);

    const { data: jobData } = await supabase.from('sub_visible_jobs').select('*');
    if (jobData) setJobsById(Object.fromEntries(jobData.map(j => [j.id, j])));

    supabase.rpc('mark_sub_portal_viewed', { target_company_id: companyData.id }).then(() => {});
    setReady(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    const email = session.user.email;
    loadAll(email);
    const channel = supabase.channel('sub-portal-data').on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => loadAll(email)).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadAll]);

  return { company, role, workOrders, jobsById, ready };
}
