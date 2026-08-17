'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';
import { PROPERTY_TYPES } from '../../lib/constants';

const EMPTY_FORM = {
  name: '', contact_type: '', management_company: '', contact_phone: '', contact_email: '', property: '', notes: '',
  billing_street: '', billing_unit: '', billing_city: '', billing_state: '', billing_zip: '', billing_email: '',
};

// Maps common spreadsheet header variations to our contact fields
const HEADER_MAP = {
  name: ['name', 'contact name', 'customer name', 'full name'],
  contact_type: ['type', 'contact type', 'property type', 'category'],
  management_company: ['company', 'management company', 'organization', 'business'],
  contact_phone: ['phone', 'contact phone', 'phone number', 'mobile'],
  contact_email: ['email', 'contact email', 'e-mail'],
  billing_email: ['billing email', 'invoice email'],
  property: ['property', 'property name'],
  notes: ['notes', 'note', 'comments'],
  billing_street: ['street', 'address', 'billing street', 'billing address', 'street address'],
  billing_unit: ['unit', 'suite', 'billing unit'],
  billing_city: ['city', 'billing city'],
  billing_state: ['state', 'billing state'],
  billing_zip: ['zip', 'zip code', 'postal code', 'billing zip'],
};

function normalizeHeader(h) { return (h || '').toString().trim().toLowerCase(); }

function mapRow(row) {
  const contact = {};
  const rowKeys = Object.keys(row);
  for (const [field, variants] of Object.entries(HEADER_MAP)) {
    const match = rowKeys.find(k => variants.includes(normalizeHeader(k)));
    if (match && row[match] !== undefined && row[match] !== null) {
      contact[field] = String(row[match]).trim();
    }
  }
  return contact;
}

export default function CustomersPage() {
  const { session, loading } = useRequireAuth();
  const [contacts, setContacts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);

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

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult('');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const mapped = rows.map(mapRow).filter(c => c.name && c.name.trim());
      if (mapped.length === 0) {
        setImportResult('No rows with a recognizable name column were found. Expected a header like "Name" or "Customer Name".');
        return;
      }

      const { error } = await supabase.from('contacts').insert(mapped);
      if (error) throw error;
      setImportResult(`Imported ${mapped.length} contact${mapped.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    if (editingId) {
      await supabase.from('contacts').update(form).eq('id', editingId);
    } else {
      await supabase.from('contacts').insert(form);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(contact) {
    setForm({ ...EMPTY_FORM, ...contact });
    setEditingId(contact.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
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
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Contacts</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
              style={{ display: 'none' }}
              id="excelImport"
            />
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import from Excel'}
            </button>
            <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ Add new contact'}
            </button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Name, Company, Phone, Email, Billing Email, Street, Unit, City, State, Zip, Property, Notes (header names are flexible — "Customer Name" or "Phone Number" work too).
            </div>
          </div>
        )}

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>{editingId ? 'Edit contact' : 'New contact'}</h3>
            <div className="two-col">
              <div><label>Name *</label><input value={form.name} onChange={e => update('name', e.target.value)} required /></div>
              <div>
                <label>Type</label>
                <select value={form.contact_type} onChange={e => update('contact_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
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
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save contact')}</button>
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
              {c.contact_type && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', margin: '2px 0 4px' }}>{c.contact_type}</div>}
              <div className="contact-meta">
                {c.management_company && <>{c.management_company}<br /></>}
                {c.contact_phone && <>{c.contact_phone}<br /></>}
                {c.contact_email && <>{c.contact_email}<br /></>}
                {c.property && <>{c.property}<br /></>}
                {formatAddress(c, 'billing') && <>{formatAddress(c, 'billing')}</>}
              </div>
            </div>
            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={() => startEdit(c)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => removeContact(c.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
