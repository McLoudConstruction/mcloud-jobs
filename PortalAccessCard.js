'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function PortalAccessCard({ job, jobId, onLinkProperty }) {
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyResults, setPropertyResults] = useState([]);
  const [property, setProperty] = useState(null);
  const [propertyContacts, setPropertyContacts] = useState([]);
  const [access, setAccess] = useState([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  const loadAccess = useCallback(async () => {
    const { data } = await supabase.from('job_portal_access').select('*').eq('job_id', jobId);
    if (data) setAccess(data);
  }, [jobId]);

  useEffect(() => {
    loadAccess();
    const channel = supabase.channel(`portal-access-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'job_portal_access', filter: `job_id=eq.${jobId}` }, loadAccess).subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadAccess]);

  useEffect(() => {
    if (!job.property_id) { setProperty(null); setPropertyContacts([]); return; }
    supabase.from('properties').select('*').eq('id', job.property_id).maybeSingle().then(({ data }) => setProperty(data));
    supabase.from('contacts').select('*').eq('property_id', job.property_id).then(({ data }) => { if (data) setPropertyContacts(data); });
  }, [job.property_id]);

  async function searchProperties(term) {
    setPropertySearch(term);
    if (!term.trim()) { setPropertyResults([]); return; }
    const { data } = await supabase.from('properties').select('id, property_name, property_city').ilike('property_name', `%${term}%`).limit(8);
    setPropertyResults(data || []);
  }

  async function linkProperty(p) {
    await onLinkProperty(p.id);
    setPropertySearch('');
    setPropertyResults([]);
  }

  async function searchContacts(term) {
    setContactSearch(term);
    if (!term.trim()) { setContactResults([]); return; }
    const { data } = await supabase.from('contacts').select('*').ilike('name', `%${term}%`).limit(8);
    setContactResults(data || []);
  }

  function findAccessRow(email) {
    return access.find(a => a.email === email);
  }

  async function toggleField(contact, field, value) {
    const email = contact.contact_email;
    if (!email) { setResult('This contact has no email on file — add one before granting access.'); return; }
    const existing = findAccessRow(email);
    if (existing) {
      await supabase.from('job_portal_access').update({ [field]: value }).eq('id', existing.id);
    } else {
      await supabase.from('job_portal_access').insert({
        job_id: jobId, contact_id: contact.id, email, name: contact.name,
        portal_access: field === 'portal_access' ? value : true,
        notify: field === 'notify' ? value : true,
      });
    }
  }

  async function addAdHoc(contact) {
    if (!contact.contact_email) { setResult('This contact has no email on file.'); return; }
    if (findAccessRow(contact.contact_email)) { setContactSearch(''); setContactResults([]); return; }
    await supabase.from('job_portal_access').insert({
      job_id: jobId, contact_id: contact.id, email: contact.contact_email, name: contact.name,
      portal_access: true, notify: true,
    });
    setContactSearch('');
    setContactResults([]);
  }

  async function removeAccess(id) {
    await supabase.from('job_portal_access').delete().eq('id', id);
  }

  async function sendInvites() {
    setSaving(true);
    setResult('');
    const toInvite = access.filter(a => a.portal_access && !a.invited_at);
    if (toInvite.length === 0) {
      setResult('Everyone with portal access has already been invited.');
      setSaving(false);
      return;
    }
    for (const a of toInvite) {
      const { error } = await supabase.auth.signInWithOtp({
        email: a.email,
        options: { emailRedirectTo: `${window.location.origin}/customerportal/projects` },
      });
      if (!error) {
        await supabase.from('job_portal_access').update({ invited_at: new Date().toISOString() }).eq('id', a.id);
      }
    }
    setResult(`Invited ${toInvite.length} contact${toInvite.length === 1 ? '' : 's'}.`);
    setSaving(false);
  }

  const propertyContactRows = propertyContacts.map(c => ({ contact: c, accessRow: findAccessRow(c.contact_email) }));
  const propertyContactEmails = new Set(propertyContacts.map(c => c.contact_email).filter(Boolean));
  const adHocRows = access.filter(a => !propertyContactEmails.has(a.email));

  return (
    <div className="card">
      <h3>Portal Access &amp; Notifications</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Grant multiple contacts on this job their own portal login, and control who's on the notification email list — independently of each other.
      </div>

      <div style={{ fontSize: 12.5, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        {job.portal_invited_at
          ? `Invited to the portal on ${new Date(job.portal_invited_at).toLocaleDateString('en-US')}.`
          : 'Not invited to the portal yet.'}
        {' '}
        {job.portal_last_viewed_at
          ? `Last viewed the portal on ${new Date(job.portal_last_viewed_at).toLocaleString('en-US')}.`
          : (job.portal_invited_at ? 'Has not viewed the portal yet.' : '')}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label>Linked property</label>
        {property ? (
          <div style={{ fontSize: 13 }}>{property.property_name} <span style={{ color: 'var(--ink-soft)' }}>({property.property_city})</span></div>
        ) : (
          <div>
            <input value={propertySearch} onChange={e => searchProperties(e.target.value)} placeholder="Search properties to link…" />
            {propertyResults.length > 0 && (
              <div style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 4, background: 'var(--card-bg)' }}>
                {propertyResults.map(p => (
                  <div key={p.id} style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => linkProperty(p)}>
                    {p.property_name} <span style={{ color: 'var(--ink-soft)' }}>({p.property_city})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {propertyContactRows.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Contacts tied to this property</div>
          {propertyContactRows.map(({ contact, accessRow }) => (
            <AccessRow key={contact.id} name={contact.name} email={contact.contact_email} accessRow={accessRow} onToggle={(field, value) => toggleField(contact, field, value)} />
          ))}
        </div>
      )}

      {adHocRows.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>Other contacts added to this job</div>
          {adHocRows.map(a => (
            <AccessRow key={a.id} name={a.name} email={a.email} accessRow={a} onToggle={async (field, value) => { await supabase.from('job_portal_access').update({ [field]: value }).eq('id', a.id); }} onRemove={() => removeAccess(a.id)} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label>Add another contact</label>
        <input value={contactSearch} onChange={e => searchContacts(e.target.value)} placeholder="Search contacts by name…" />
        {contactResults.length > 0 && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 6, marginTop: 4, background: 'var(--card-bg)' }}>
            {contactResults.map(c => (
              <div key={c.id} style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => addAdHoc(c)}>
                {c.name} {c.contact_email ? <span style={{ color: 'var(--ink-soft)' }}>({c.contact_email})</span> : <span style={{ color: '#a13f3f' }}>(no email)</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={sendInvites} disabled={saving}>{saving ? 'Sending…' : 'Send Portal Invites'}</button>
      </div>
      {result && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>{result}</div>}
    </div>
  );
}

function AccessRow({ name, email, accessRow, onToggle, onRemove }) {
  const portalAccess = accessRow?.portal_access ?? false;
  const notify = accessRow?.notify ?? false;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
      <div>
        <b>{name}</b> <span style={{ color: 'var(--ink-soft)' }}>{email || 'no email'}</span>
        {accessRow?.invited_at && <span style={{ fontSize: 11, color: '#3a6b45', marginLeft: 8 }}>Invited</span>}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 400, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={portalAccess} onChange={e => onToggle('portal_access', e.target.checked)} />
          Portal access
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 400, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={notify} onChange={e => onToggle('notify', e.target.checked)} />
          Notify
        </label>
        {onRemove && <button className="btn btn-sm btn-danger" onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}
