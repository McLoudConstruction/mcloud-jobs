'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';

const CATEGORY_LABELS = {
  message: 'New Message',
  rfp_awarded: 'Awarded',
  general: 'Update',
};

function fmtDateTime(v) {
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SubPortalNotificationsPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/sub-portal/login'); return; }
      setSession(data.session);
      setLoading(false);
    });
  }, [router]);

  const { company, role, ready } = useSubPortalData(session);
  const [items, setItems] = useState(null);

  const load = useCallback(async (companyId) => {
    const { data } = await supabase.from('portal_notifications').select('*')
      .eq('recipient_kind', 'subcontractor').eq('company_id', companyId).eq('dismissed', false)
      .order('created_at', { ascending: false });
    setItems(data || []);
  }, []);

  useEffect(() => {
    if (!company?.id) return;
    load(company.id);
    const channel = supabase.channel(`sub-portal-notifications-page-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_notifications', filter: `company_id=eq.${company.id}` }, () => load(company.id))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company?.id, load]);

  async function markAllRead() {
    const unreadIds = (items || []).filter(i => !i.read_at).map(i => i.id);
    if (unreadIds.length === 0) return;
    await supabase.from('portal_notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
  }

  async function openItem(item) {
    if (!item.read_at) {
      await supabase.from('portal_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
    }
    if (item.link_path) router.push(item.link_path);
  }

  if (loading || !session || !ready) return null;

  const unreadCount = (items || []).filter(i => !i.read_at).length;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>Notifications</h3>
            {unreadCount > 0 && <button className="btn btn-sm" onClick={markAllRead}>Mark all read</button>}
          </div>

          {items === null && <div className="empty-state">Loading…</div>}
          {items && items.length === 0 && <div className="empty-state">Nothing yet — you'll see updates here as they happen.</div>}

          {items && items.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => openItem(item)}
              className="update-entry"
              style={{
                display: 'block', width: '100%', textAlign: 'left', borderTop: 0, borderLeft: 0, borderRight: 0, borderRadius: 0, font: 'inherit', cursor: item.link_path ? 'pointer' : 'default',
                background: item.read_at ? 'transparent' : 'var(--panel-highlight, rgba(155,119,61,0.06))',
              }}
            >
              <div className="update-date" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!item.read_at && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent, #9b773d)', display: 'inline-block' }} />}
                {CATEGORY_LABELS[item.category] || 'Update'} · {fmtDateTime(item.created_at)}
              </div>
              <p style={{ margin: '4px 0 0' }}>{item.message}</p>
            </button>
          ))}
        </div>
      </div>
    </SubPortalShell>
  );
}
