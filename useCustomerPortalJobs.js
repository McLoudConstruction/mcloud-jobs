'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

// Shared across the customer portal's Projects/Inbox/Invoices pages —
// loads the customer's job list once, keeps the selected job persisted
// across navigation between those pages (a customer switching from
// Projects to Inbox shouldn't lose which project they were looking at).
export function useCustomerPortalJobs(session) {
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobIdState] = useState(null);

  const loadJobs = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (data) {
      setJobs(data);
      setSelectedJobIdState(prev => {
        if (prev && data.some(j => j.id === prev)) return prev;
        const stored = window.localStorage.getItem('mcloud-portal-selected-job');
        if (stored && data.some(j => j.id === stored)) return stored;
        return data[0]?.id || null;
      });
    }
  }, []);

  useEffect(() => { if (session) loadJobs(); }, [session, loadJobs]);

  useEffect(() => {
    if (!session || !selectedJobId) return;
    const channel = supabase
      .channel(`portal-jobs-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadJobs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, selectedJobId, loadJobs]);

  function setSelectedJobId(id) {
    setSelectedJobIdState(id);
    window.localStorage.setItem('mcloud-portal-selected-job', id);
  }

  const job = jobs.find(j => j.id === selectedJobId);
  return { jobs, selectedJobId, setSelectedJobId, job };
}
