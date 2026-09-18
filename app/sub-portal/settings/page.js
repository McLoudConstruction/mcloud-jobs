'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useSubPortalData } from '../../../lib/useSubPortalData';
import SubPortalShell from '../../../components/SubPortalShell';
import SubPortalAuthLayout from '../../../components/SubPortalAuthLayout';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v.length === 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function coiStatusLabel(expiresAt) {
  if (!expiresAt) return { text: 'Not on file', color: 'var(--ink-soft)' };
  const days = Math.floor((new Date(expiresAt) - new Date()) / 86400000);
  if (days < 0) return { text: `Expired ${fmtDate(expiresAt)}`, color: '#a13f3f' };
  if (days <= 30) return { text: `Expires soon — ${fmtDate(expiresAt)}`, color: '#a17c3f' };
  return { text: `Current through ${fmtDate(expiresAt)}`, color: '#3a6b45' };
}

// Self-serve W-9/COI upload — same companies.w9_storage_path/
// coi_storage_path/coi_expires_at fields the office already tracks
// (migration 029), just writable by the sub's own admin login now too
// (migration 114), through submit_sub_compliance_doc rather than a
// direct table grant.
function ComplianceDocsSection({ company }) {
  const [w9Uploading, setW9Uploading] = useState(false);
  const [coiUploading, setCoiUploading] = useState(false);
  const [coiExpiresAt, setCoiExpiresAt] = useState(company.coi_expires_at || '');
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(false);
  // useSubPortalData only re-fetches on work_orders changes, so a
  // companies-table write from here wouldn't otherwise reflect until the
  // next full reload — these local overrides give immediate feedback.
  const [docs, setDocs] = useState({ w9_storage_path: company.w9_storage_path, coi_storage_path: company.coi_storage_path, coi_expires_at: company.coi_expires_at });

  async function uploadDoc(file, kind) {
    if (!file) return;
    if (kind === 'coi' && !coiExpiresAt) {
      setError('Set the COI expiration date before uploading.');
      return;
    }
    const setUploading = kind === 'w9' ? setW9Uploading : setCoiUploading;
    setUploading(true);
    setError('');
    try {
      const path = `compliance/${company.id}/${kind}-${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('subcontractor-docs').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { error: rpcErr } = await supabase.rpc('submit_sub_compliance_doc', {
        target_company_id: company.id,
        kind,
        storage_path_in: path,
        expires_at_in: kind === 'coi' ? coiExpiresAt : null,
      });
      if (rpcErr) throw rpcErr;
      setDocs(prev => kind === 'w9'
        ? { ...prev, w9_storage_path: path }
        : { ...prev, coi_storage_path: path, coi_expires_at: coiExpiresAt });
    } catch (err) {
      setError(err.message || 'Upload failed — try again.');
    } finally {
      setUploading(false);
    }
  }

  async function viewDoc(path) {
    if (!path) return;
    setViewing(true);
    const { data } = await supabase.storage.from('subcontractor-docs').createSignedUrl(path, 300);
    setViewing(false);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  const coi = coiStatusLabel(docs.coi_expires_at);

  return (
    <div className="dash-section">
      <h3>Compliance Documents</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Keep your W-9 and Certificate of Insurance on file current — the office can see these too.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>W-9</div>
          <div style={{ fontSize: 11.5, color: docs.w9_storage_path ? '#3a6b45' : 'var(--ink-soft)' }}>
            {docs.w9_storage_path ? 'On file' : 'Not on file'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {docs.w9_storage_path && (
            <button className="btn btn-sm" onClick={() => viewDoc(docs.w9_storage_path)} disabled={viewing}>View</button>
          )}
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {w9Uploading ? 'Uploading…' : docs.w9_storage_path ? 'Replace' : 'Upload'}
            <input type="file" accept="application/pdf,image/*" onChange={e => uploadDoc(e.target.files[0], 'w9')} disabled={w9Uploading} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      <div style={{ padding: '14px 0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Certificate of Insurance</div>
            <div style={{ fontSize: 11.5, color: coi.color }}>{coi.text}</div>
          </div>
          {docs.coi_storage_path && (
            <button className="btn btn-sm" onClick={() => viewDoc(docs.coi_storage_path)} disabled={viewing}>View</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={coiExpiresAt}
            onChange={e => setCoiExpiresAt(e.target.value)}
            style={{ flex: '1 1 160px' }}
            aria-label="COI expiration date"
          />
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {coiUploading ? 'Uploading…' : docs.coi_storage_path ? 'Replace' : 'Upload'}
            <input type="file" accept="application/pdf,image/*" onChange={e => uploadDoc(e.target.files[0], 'coi')} disabled={coiUploading} style={{ display: 'none' }} />
          </label>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>Set the expiration date shown on the certificate, then attach the file.</div>
      </div>

      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

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
  const [newPassword, setNewPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwResult, setPwResult] = useState('');
  const [settingPwFor, setSettingPwFor] = useState(null); // roster row id
  const [teammatePassword, setTeammatePassword] = useState('');
  const [teammatePwSaving, setTeammatePwSaving] = useState(false);
  const [teammatePwResult, setTeammatePwResult] = useState('');

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

  async function submitTeammatePassword(e, targetEmail) {
    e.preventDefault();
    if (teammatePassword.length < 6) {
      setTeammatePwResult('Password needs to be at least 6 characters.');
      return;
    }
    setTeammatePwSaving(true);
    setTeammatePwResult('');
    try {
      const res = await fetch('/api/sub-portal/set-crew-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, targetEmail, newPassword: teammatePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set password.');
      setTeammatePwResult(`Password set for ${targetEmail}.`);
      setTeammatePassword('');
      setTimeout(() => { setSettingPwFor(null); setTeammatePwResult(''); }, 1600);
    } catch (err) {
      setTeammatePwResult(err.message);
    } finally {
      setTeammatePwSaving(false);
    }
  }

  async function setupPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setPwResult('Password needs to be at least 6 characters.');
      return;
    }
    setPwSaving(true);
    setPwResult('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) {
      setPwResult(error.message);
    } else {
      setPwResult('Password set! You can now sign in with your email and password anytime.');
      setNewPassword('');
    }
  }

  if (loading || !session) return null;

  if (ready && !company) {
    return (
      <SubPortalAuthLayout>
        <div className="login-card" style={{ boxShadow: 'none', border: '1px solid var(--panel-line)' }}>
          <h1>Subcontractor Portal</h1>
          <p className="sub" style={{ color: '#a13f3f' }}>
            This email isn't linked to a subcontractor account yet. Reach out to McLoud Construction to get set up.
          </p>
        </div>
      </SubPortalAuthLayout>
    );
  }
  if (!company) return null;

  return (
    <SubPortalShell company={company} role={role}>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="card" style={{ padding: '4px 24px' }}>
        <div className="dash-section" style={{ paddingTop: 18 }}>
          <h3>Sign-In Password</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Set up a password for {session.user.email} and you can sign in anytime without waiting on an email link.
          </div>
          <form onSubmit={setupPassword}>
            <label htmlFor="newPassword">New password</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} required style={{ flex: '1 1 220px' }} />
              <button className="btn btn-primary btn-sm" type="submit" disabled={pwSaving}>{pwSaving ? 'Saving…' : 'Set Password'}</button>
            </div>
            {pwResult && <div style={{ fontSize: 12.5, marginTop: 8, color: pwResult.startsWith('Password set') ? '#3a6b45' : '#a13f3f' }}>{pwResult}</div>}
          </form>
        </div>

        {role === 'admin' && <ComplianceDocsSection company={company} />}

        {role === 'admin' && (
        <div className="dash-section">
          <h3>Team Logins</h3>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            Add or remove who can sign in to {company.company_name}'s subcontractor portal. <b>Owner/Manager</b> logins can
            accept and sign work orders and manage this list; <b>Crew</b> logins can view projects and work orders only.
          </div>

          {roster.map(u => (
            <div key={u.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <b>{u.email}</b>
                  {u.email === session.user.email && <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginLeft: 6 }}>(you)</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>{u.role === 'admin' ? 'Owner/Manager' : 'Crew'}</span>
                  {u.email !== session.user.email && (
                    <button
                      className="btn btn-sm"
                      onClick={() => { setSettingPwFor(settingPwFor === u.id ? null : u.id); setTeammatePassword(''); setTeammatePwResult(''); }}
                    >
                      {settingPwFor === u.id ? 'Cancel' : 'Set Password'}
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => removeUser(u.id)}>Remove</button>
                </div>
              </div>
              {settingPwFor === u.id && (
                <form onSubmit={e => submitTeammatePassword(e, u.email)} style={{ marginTop: 10, paddingLeft: 2 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <input
                      type="password" value={teammatePassword} onChange={e => setTeammatePassword(e.target.value)}
                      placeholder={`New password for ${u.email}`} minLength={6} required autoFocus
                      style={{ flex: '1 1 220px', margin: 0 }}
                    />
                    <button className="btn btn-primary btn-sm" type="submit" disabled={teammatePwSaving}>
                      {teammatePwSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {teammatePwResult && (
                    <div style={{ fontSize: 12, marginTop: 6, color: teammatePwResult.startsWith('Password set') ? '#3a6b45' : '#a13f3f' }}>
                      {teammatePwResult}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 6 }}>
                    They'll be able to sign in with this password right away.
                  </div>
                </form>
              )}
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
              They'll sign in with a one-time email link at first — they can set up a password anytime from this same Settings page once they're in.
            </div>
          </form>
        </div>
        )}
        </div>
      </div>
    </SubPortalShell>
  );
}
