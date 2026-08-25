'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';

export default function SubPortalSettingsPage() {
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

  const [roster, setRoster] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('crew');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadRoster = useCallback(async () => {
    if (!company) return;
    const { data } = await supabase.from('sub_portal_users').select('*').eq('company_id', company.id).order('created_at', { ascending: true });
    if (data) setRoster(data);
  }, [company]);

  useEffect(() => {
    if (!company) return;
    loadRoster();
    const channel = supabase.channel(`sub-portal-roster-${company.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_portal_users', filter: `company_id=eq.${company.id}` }, loadRoster)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [company, loadRoster]);

  async function addUser(e) {
    e.preventDefault();
    if (!newEmail.trim() || !company) return;
    setSaving(true);
    setError('');
    const { error } = await supabase.rpc('add_sub_portal_user', {
      target_company_id: company.id,
      new_email: newEmail.trim(),
      new_role: newRole,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setNewEmail('');
    setNewRole('crew');
  }

  async function removeUser(id) {
    if (!confirm('Remove this login? They will no longer be able to sign in to the subcontractor portal.')) return;
    const { error } = await supabase.rpc('remove_sub_portal_user', { target_id: id });
    if (error) alert(error.message);
  }

  if (loading || !session) return null;

  if (ready && !company) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Subcontractor Portal</h1>
          <p className="sub" style={{ color: '#a13f3f' }}>
            This email isn't linked to a subcontractor account yet. Reach out to McLoud Construction to get set up.
          </p>
        </div>
      </div>
    );
  }
  if (!company) return null;

  if (role !== 'admin') {
    return (
      <SubPortalShell company={company} role={role}>
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <h3>Settings</h3>
            <div className="empty-state">Only an Owner/Manager login can manage the team roster.</div>
          </div>
        </div>
      </SubPortalShell>
    );
  }

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="card">
          <h3>Team Logins</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Add or remove who can sign in to {company.company_name}'s subcontractor portal. <b>Owner/Manager</b> logins can
            accept and sign work orders and manage this list; <b>Crew</b> logins can view projects and work orders only.
          </div>

          {roster.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div>
                <b>{u.email}</b>
                {u.email === session.user.email && <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginLeft: 6 }}>(you)</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>{u.role === 'admin' ? 'Owner/Manager' : 'Crew'}</span>
                <button className="btn btn-sm btn-danger" onClick={() => removeUser(u.id)}>Remove</button>
              </div>
            </div>
          ))}

          <form onSubmit={addUser} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <label>Add a login</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" required style={{ flex: '1 1 220px' }} />
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: 160 }}>
                <option value="crew">Crew</option>
                <option value="admin">Owner/Manager</option>
              </select>
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
            </div>
            {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>
              No password to set — they'll sign in with a one-time email link, the same way you did.
            </div>
          </form>
        </div>
      </div>
    </SubPortalShell>
  );
}
