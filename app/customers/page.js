'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';

const EMPTY_FORM = {
  name: '', management_company: '', contact_phone: '', contact_email: '', property: '', notes: '',
  billing_street: '', billing_unit: '', billing_city: '', billing_state: '', billing_zip: '', billing_email: '',
};

export default function CustomersPage() {
  const { session, loading } = useRequireAuth();
  const [contacts, setContacts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const loadContacts = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*').order('name', { ascending: true });
    if (data) setContacts(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadContacts();
    const channel = supabase.channel('contacts').on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, loadContacts).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadContacts]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await supabase.from('contacts').insert(form);
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  async function removeContact(id) {
    if (!confirm('Delete this contact?')) return;
    await supabase.from('contacts').delete().eq('id', id);
  }

  const filtered = contacts.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.management_company || '').toLowerCase().includes(q);
  });

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Customer Information</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
            {showForm ? 'Cancel' : '+ Add new contact'}
          </button>
        </div>

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>New contact</h3>
            <div className="two-col">
              <div><label>Name *</label><input value={form.name} onChange={e => update('name', e.target.value)} required /></div>
              <div><label>Management company</label><input value={form.management_company} onChange={e => update('management_company', e.target.value)} /></div>
              <div><label>Phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} /></div>
              <div><label>Email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
            </div>
            <label>Property</label>
            <input value={form.property} onChange={e => update('property', e.target.value)} />

            <label style={{ marginTop: 16 }}>Billing email</label>
            <input type="email" value={form.billing_email} onChange={e => update('billing_email', e.target.value)} />
            <label style={{ marginTop: 4 }}>Billing address</label>
            <AddressFields prefix="billing" values={form} onChange={update} />

            <label style={{ marginTop: 16 }}>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save contact'}</button>
            </div>
          </form>
        )}

        <div className="search-bar">
          <input placeholder="Search by name or company…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">No contacts yet.</div>}
        {filtered.map(c => (
          <div className="contact-card" key={c.id}>
            <div>
              <div className="contact-name">{c.name}</div>
              <div className="contact-meta">
                {c.management_company && <>{c.management_company}<br /></>}
                {c.contact_phone && <>{c.contact_phone}<br /></>}
                {c.contact_email && <>{c.contact_email}<br /></>}
                {c.property && <>{c.property}<br /></>}
                {formatAddress(c, 'billing') && <>{formatAddress(c, 'billing')}</>}
              </div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={() => removeContact(c.id)}>Delete</button>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
