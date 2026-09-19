'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { ROLES, ROLE_LABELS } from '../lib/permissions';

const STATUS_LABELS = { active: 'Active', invited: 'Invite sent', disabled: 'Disabled' };

export default function StaffUsersPanel({ session }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('project_manager');
  const [method, setMethod] = useState('email_invite');
  const [tempPassword, setTempPassword] = useState('');

  const [passwordTargetId, setPasswordTargetId] = useState(null);
  const [passwordValue, setPasswordValue] = useState('');

  const [nameTargetId, setNameTargetId] = useState(null);
  const [nameValue, setNameValue] = useState('');

  const [signatureTargetId, setSignatureTargetId] = useState(null);
  const [signatureValue, setSignatureValue] = useState('');
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [signatureDragOver, setSignatureDragOver] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('staff_users').select('*').order('created_at', { ascending: true });
    if (data) setStaff(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function callApi(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  async function handleInvite(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await callApi('/api/staff/invite', {
        email: email.trim(),
        fullName: fullName.trim(),
        role,
        method,
        tempPassword: method === 'temp_password' ? tempPassword : undefined,
      });
      setNote(method === 'email_invite' ? `Invite sent to ${email}.` : `Account created for ${email}. Share the password with them directly.`);
      setFullName(''); setEmail(''); setRole('project_manager'); setMethod('email_invite'); setTempPassword('');
      setFormOpen(false);
      await load();
      setTimeout(() => setNote(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRole(member, newRole) {
    if (newRole === member.role) return;
    setError('');
    try {
      await callApi('/api/staff/update', { targetUserId: member.id, action: 'set_role', role: newRole });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleStatus(member) {
    if (member.status === 'invited') return;
    const action = member.status === 'disabled' ? 'enable' : 'disable';
    if (action === 'disable' && !confirm(`Disable ${member.full_name}'s access? They won't be able to sign in.`)) return;
    setError('');
    try {
      await callApi('/api/staff/update', { targetUserId: member.id, action });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResendInvite(member) {
    setError('');
    try {
      await callApi('/api/staff/update', { targetUserId: member.id, action: 'resend_invite' });
      setNote(`Invite resent to ${member.email}.`);
      setTimeout(() => setNote(''), 4000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');
    try {
      await callApi('/api/staff/update', { targetUserId: passwordTargetId, action: 'set_password', newPassword: passwordValue });
      setNote('Password updated. Share it with them directly.');
      setPasswordTargetId(null);
      setPasswordValue('');
      await load();
      setTimeout(() => setNote(''), 4000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSetFullName(e) {
    e.preventDefault();
    setError('');
    try {
      await callApi('/api/staff/update', { targetUserId: nameTargetId, action: 'set_full_name', fullName: nameValue });
      setNameTargetId(null);
      setNameValue('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveSignature(e) {
    e.preventDefault();
    setError('');
    setSignatureSaving(true);
    try {
      await callApi('/api/staff/update', { targetUserId: signatureTargetId, action: 'set_signature', signatureHtml: signatureValue });
      setSignatureTargetId(null);
      setSignatureValue('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSignatureSaving(false);
    }
  }

  // Drops an uploaded image straight into the signature HTML as an <img>
  // tag — same "branding" bucket the logo upload already uses (public
  // bucket, so the image actually loads for a customer reading the
  // email, not just inside the app). Appended rather than replacing
  // anything already pasted in, so a signature copied from Gmail/Outlook
  // plus a dropped-in logo both survive.
  async function handleSignatureImageFile(file) {
    if (!file || !signatureTargetId) return;
    setError('');
    setSignatureUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `signature-${signatureTargetId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('branding').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path);
      setSignatureValue(prev => `${prev}${prev.trim() ? '\n' : ''}<img src="${urlData.publicUrl}" alt="" style="max-width: 320px; display: block; margin-top: 8px;" />`);
    } catch (err) {
      setError(err.message || 'Image upload failed.');
    } finally {
      setSignatureUploading(false);
    }
  }

  return (
    <div className="card">
      <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Staff Accounts</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(o => !o)} type="button">
          {formOpen ? 'Cancel' : 'Add staff account'}
        </button>
      </div>

      {note && <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 12 }}>{note}</div>}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {formOpen && (
        <form onSubmit={handleInvite} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 16, background: 'var(--panel)' }}>
          <div className="two-col">
            <div>
              <label>Full name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} required />
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="two-col" style={{ marginTop: 10 }}>
            <div>
              <label>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div>
              <label>Account setup</label>
              <select value={method} onChange={e => setMethod(e.target.value)}>
                <option value="email_invite">Email them a sign-up link</option>
                <option value="temp_password">Set a temporary password myself</option>
              </select>
            </div>
          </div>
          {method === 'temp_password' && (
            <div style={{ marginTop: 10 }}>
              <label>Temporary password</label>
              <input type="text" value={tempPassword} onChange={e => setTempPassword(e.target.value)} minLength={6} required placeholder="At least 6 characters" />
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>You'll need to share this with them yourself — it won't be emailed.</div>
            </div>
          )}
          <div className="section-actions" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add staff account'}</button>
          </div>
        </form>
      )}

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && staff.length === 0 && <div className="empty-state">No staff accounts yet.</div>}

      {!loading && staff.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {staff.map(member => (
            <div key={member.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{member.full_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{member.email}</div>
              </div>

              <select value={member.role} onChange={e => handleSetRole(member, e.target.value)} style={{ minWidth: 150 }}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>

              <span
                style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 20,
                  background: member.status === 'active' ? 'rgba(58,107,69,0.15)' : member.status === 'disabled' ? 'rgba(161,63,63,0.15)' : 'rgba(155,119,61,0.15)',
                  color: member.status === 'active' ? '#3a6b45' : member.status === 'disabled' ? '#a13f3f' : 'var(--rust, #9b773d)',
                }}
              >
                {STATUS_LABELS[member.status]}
              </span>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm" type="button" onClick={() => { setNameTargetId(member.id); setNameValue(member.full_name || ''); }}>
                  Edit
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => { setSignatureTargetId(member.id); setSignatureValue(member.signature_html || ''); }}
                >
                  {member.signature_html ? 'Edit signature' : 'Add signature'}
                </button>
                {member.status === 'invited' && (
                  <button className="btn btn-sm" type="button" onClick={() => handleResendInvite(member)}>Resend invite</button>
                )}
                <button className="btn btn-sm" type="button" onClick={() => { setPasswordTargetId(member.id); setPasswordValue(''); }}>
                  Set password
                </button>
                {member.status !== 'invited' && (
                  <button className={`btn btn-sm ${member.status === 'active' ? 'btn-danger' : ''}`} type="button" onClick={() => handleToggleStatus(member)}>
                    {member.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                )}
              </div>

              {nameTargetId === member.id && (
                <form onSubmit={handleSetFullName} style={{ display: 'flex', gap: 6, width: '100%', marginTop: 4 }}>
                  <input
                    type="text" placeholder="Full name" value={nameValue}
                    onChange={e => setNameValue(e.target.value)} required style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary btn-sm" type="submit">Save</button>
                  <button className="btn btn-sm" type="button" onClick={() => setNameTargetId(null)}>Cancel</button>
                </form>
              )}

              {passwordTargetId === member.id && (
                <form onSubmit={handleSetPassword} style={{ display: 'flex', gap: 6, width: '100%', marginTop: 4 }}>
                  <input
                    type="text" placeholder="New password (6+ characters)" value={passwordValue}
                    onChange={e => setPasswordValue(e.target.value)} minLength={6} required style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary btn-sm" type="submit">Save</button>
                  <button className="btn btn-sm" type="button" onClick={() => setPasswordTargetId(null)}>Cancel</button>
                </form>
              )}

              {signatureTargetId === member.id && (
                <form onSubmit={handleSaveSignature} style={{ width: '100%', marginTop: 8, border: '1px solid var(--line)', borderRadius: 6, padding: 12, background: 'var(--panel)' }}>
                  <label>Signature for {member.full_name}</label>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
                    Paste the HTML from their existing Gmail/Outlook signature, type plain text, or drop an image below (logo, handwritten signature, etc.) to add it in.
                  </div>
                  <textarea
                    value={signatureValue}
                    onChange={e => setSignatureValue(e.target.value)}
                    rows={5}
                    placeholder="e.g. Stachys McLoud&#10;McLoud Construction&#10;(555) 555-0100"
                  />
                  <div
                    onDragOver={e => { e.preventDefault(); setSignatureDragOver(true); }}
                    onDragLeave={() => setSignatureDragOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setSignatureDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleSignatureImageFile(file);
                    }}
                    style={{
                      marginTop: 8, padding: '14px 10px', textAlign: 'center', borderRadius: 6,
                      border: `2px dashed ${signatureDragOver ? 'var(--rust, #9b773d)' : 'var(--line)'}`,
                      background: signatureDragOver ? 'rgba(155,119,61,0.08)' : 'transparent',
                      fontSize: 12, color: 'var(--ink-soft)',
                    }}
                  >
                    {signatureUploading ? (
                      'Uploading…'
                    ) : (
                      <>
                        Drag an image here, or{' '}
                        <label style={{ textDecoration: 'underline', cursor: 'pointer' }}>
                          browse
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleSignatureImageFile(f); }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {signatureValue.trim() && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 4 }}>PREVIEW</div>
                      <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: signatureValue }} />
                    </div>
                  )}
                  <div className="section-actions" style={{ marginTop: 10, marginBottom: 0 }}>
                    <button className="btn btn-primary btn-sm" type="submit" disabled={signatureSaving || signatureUploading}>
                      {signatureSaving ? 'Saving…' : 'Save signature'}
                    </button>
                    <button className="btn btn-sm" type="button" onClick={() => { setSignatureTargetId(null); setSignatureValue(''); }}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
