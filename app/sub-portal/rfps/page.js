'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';
import { RFP_RECIPIENT_STATUS_LABELS, subPortalJobHeading } from '../../../lib/constants';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SubPortalRfpsPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, ready } = useSubPortalData(session);

  // Reads from sub_visible_rfps, not a nested rfps(jobs(...)) embed —
  // jobs has no RLS policy for the sub portal, so that embed always
  // came back null for every job field. The view flattens job fields in
  // already filtered to this company, so there's nothing left to join.
  const load = useCallback(async (companyId) => {
    const { data } = await supabase
      .from('sub_visible_rfps')
      .select('*')
      .eq('company_id', companyId)
      .order('sent_at', { ascending: false });
    if (data) setRecipients(data);
  }, []);

  useEffect(() => {
    if (!company) return;
    load(company.id);
    const channel = supabase.channel('sub-portal-rfps')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfp_recipients', filter: `company_id=eq.${company.id}` }, () => load(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, load]);

  if (loading || !session || (ready && !company)) return null;
  if (!company) return null;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section">
          <h3>Requests for Proposal</h3>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
            These are requests to bid, not assigned jobs — nothing here is a Work Order until it's awarded.
          </div>
          {recipients.length === 0 && <div className="empty-state">Nothing here yet.</div>}
          {recipients.map(rr => {
            // "Smith — Estimate #204 · 123 Main St" — same customer/
            // number heading the rest of the sub portal uses.
            const jobMeta = [subPortalJobHeading(rr), rr.project_address].filter(Boolean).join(' · ');
            return (
              <Link key={rr.id} href={`/sub-portal/rfps/${rr.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none', color: 'inherit' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{rr.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                    {jobMeta && `${jobMeta} · `}Sent {fmtDate(rr.sent_at)}
                  </div>
                </div>
                <span className={`badge badge-${rr.status}`}>{RFP_RECIPIENT_STATUS_LABELS[rr.status]}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </SubPortalShell>
  );
}
