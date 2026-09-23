'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useCustomerPortalJobs } from '../../../lib/useCustomerPortalJobs';
import CustomerPortalShell from '../../../components/CustomerPortalShell';
import NoActiveProjectNotice from '../../../components/NoActiveProjectNotice';

const CATEGORY_LABELS = {
  message: 'New Message',
  rfp_awarded: 'Awarded',
  payment_failed: 'Payment Issue',
  general: 'Update',
};

function fmtDateTime(v) {
  return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Spans every job this customer has portal access to, not just the one
// selected in PortalJobSwitcher — RLS (has_job_portal_access) already
// scopes the rows to theirs, so there's nothing extra to filter here.
export default function CustomerNotificationsPage() {
  const { session, loading } = usePortalAuth();
  const { jobs, jobsLoaded, job } = useCustomerPortalJobs(session);
  const [items, setItems] = useState(null);

  const load = useCallback(() => {
    supabase.from('portal_notifications').select('*').eq('recipient_kind', 'customer').eq('dismissed', false)
      .order('created_at', { ascending: false })
      .then(({ data }) => setItems(data || []));
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const channel = supabase.channel('customer-notifications-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_notifications' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  async function markAllRead() {
    const unreadIds = (items || []).filter(i => !i.read_at).map(i => i.id);
    if (unreadIds.length === 0) return;
    const { error } = await supabase.from('portal_notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    if (error) { alert('Failed to mark as read: ' + error.message); return; }
    load();
  }

  async function openItem(item) {
    if (!item.read_at) {
      const { error } = await supabase.from('portal_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
      if (error) console.error('Failed to mark notification as read:', error.message);
    }
    if (item.link_path) window.location.href = item.link_path;
  }

  if (loading || !session) return null;
  if (jobsLoaded && jobs.length === 0) return <CustomerPortalShell><NoActiveProjectNotice /></CustomerPortalShell>;

  const unreadCount = (items || []).filter(i => !i.read_at).length;

  return (
    <CustomerPortalShell customerName={job?.customer_name}>
      <div className="container container-wide" style={{ paddingTop: 24 }}>
        <div className="dash-section" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>Notifications</h3>
            {unreadCount > 0 && (
              <button className="btn btn-sm" onClick={markAllRead}>Mark all read</button>
            )}
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
    </CustomerPortalShell>
  );
}
