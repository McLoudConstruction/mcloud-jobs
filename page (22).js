'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';
import PopupModal from '../../components/PopupModal';
import DataTable from '../../components/DataTable';
import { CONTACT_TYPES, formatPhone } from '../../lib/constants';
import { parseVCard } from '../../lib/vcard';

const HOMEOWNER_TYPE = 'Residential - Homeowner';

const EMPTY_FORM = {
  contact_type: '', first_name: '', last_name: '', management_company: '', position: '',
  contact_phone: '', contact_email: '', property: '', notes: '', automated_emails_opt_out: false,
  address_street: '', address_unit: '', address_city: '', address_state: '', address_zip: '',
  billing_street: '', billing_unit: '', billing_city: '', billing_state: '', billing_zip: '', billing_email: '',
};

// Maps common spreadsheet header variations to our contact fields
const HEADER_MAP = {
  contact_type: ['type', 'contact type', 'property type', 'category'],
  first_name: ['first name', 'firstname', 'first'],
  last_name: ['last name', 'lastname', 'last'],
  management_company: ['company', 'management company', 'organization', 'business'],
  position: ['position', 'title', 'job title'],
  contact_phone: ['phone', 'contact phone', 'phone number', 'mobile'],
  contact_email: ['email', 'contact email', 'e-mail'],
  billing_email: ['billing email', 'invoice email'],
  property: ['property', 'property name'],
  notes: ['notes', 'note', 'comments'],
  address_street: ['street', 'address', 'street address'],
  address_unit: ['unit', 'suite'],
  address_city: ['city'],
  address_state: ['state'],
  address_zip: ['zip', 'zip code', 'postal code'],
  billing_street: ['billing street', 'billing address'],
  billing_unit: ['billing unit'],
  billing_city: ['billing city'],
  billing_state: ['billing state'],
  billing_zip: ['billing zip'],
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
  if (contact.first_name || contact.last_name) {
    contact.name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  }
  if (contact.contact_phone) contact.contact_phone = formatPhone(contact.contact_phone);
  return contact;
}

export default function CustomersPage() {
  const { session, loading } = useRequireAuth();
  const [contacts, setContacts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);
  const vcardInputRef = useRef(null);
  const [importingVcard, setImportingVcard] = useState(false);

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

  const isHomeowner = form.contact_type === HOMEOWNER_TYPE;

  function update(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (sameAsBilling && field.startsWith('billing_') && field !== 'billing_email') {
        const addrField = field.replace('billing_', 'address_');
        next[addrField] = value;
      }
      return next;
    });
  }

  function toggleSameAsBilling(checked) {
    setSameAsBilling(checked);
    if (checked) {
      setForm(prev => ({
        ...prev,
        address_street: prev.billing_street,
        address_unit: prev.billing_unit,
        address_city: prev.billing_city,
        address_state: prev.billing_state,
        address_zip: prev.billing_zip,
      }));
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.first_name.trim() && !form.last_name.trim()) return;
    setSaving(true);

    const payload = {
      ...form,
      name: [form.first_name, form.last_name].filter(Boolean).join(' '),
    };
    if (isHomeowner) {
      payload.management_company = '';
      payload.billing_street = ''; payload.billing_unit = ''; payload.billing_city = '';
      payload.billing_state = ''; payload.billing_zip = ''; payload.billing_email = '';
    }

    if (editingId) {
      await supabase.from('contacts').update(payload).eq('id', editingId);
    } else {
      await supabase.from('contacts').insert(payload);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setSameAsBilling(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(contact) {
    setForm({ ...EMPTY_FORM, ...contact, contact_phone: formatPhone(contact.contact_phone) });
    setSameAsBilling(Boolean(contact.billing_street) && contact.billing_street === contact.address_street);
    setEditingId(contact.id);
    setShowForm(true);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setSameAsBilling(false);
    setEditingId(null);
    setShowForm(false);
  }

  async function removeContact(id) {
    if (!confirm('Delete this contact?')) return;
    await supabase.from('contacts').delete().eq('id', id);
  }

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
        setImportResult('No rows with a recognizable name column were found. Expected headers like "First Name" and "Last Name".');
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

  async function handleVCardImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImportingVcard(true);
    setImportResult('');
    try {
      const text = await file.text();
      const parsed = parseVCard(text).map(c => ({ ...c, contact_phone: c.contact_phone ? formatPhone(c.contact_phone) : c.contact_phone }));
      if (parsed.length === 0) {
        setImportResult('No contacts with a name were found in that file.');
        return;
      }
      const { error } = await supabase.from('contacts').insert(parsed);
      if (error) throw error;
      setImportResult(`Imported ${parsed.length} contact${parsed.length === 1 ? '' : 's'} from vCard.`);
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImportingVcard(false);
      if (vcardInputRef.current) vcardInputRef.current.value = '';
    }
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
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Contact Database</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import from Excel'}
            </button>
            <input
              ref={vcardInputRef}
              type="file"
              accept=".vcf"
              onChange={handleVCardImport}
              style={{ display: 'none' }}
            />
            <button className="btn" onClick={() => vcardInputRef.current?.click()} disabled={importingVcard}>
              {importingVcard ? 'Importing…' : '↑ Import from iPhone (.vcf)'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Add new contact</button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Type, First Name, Last Name, Company, Position, Phone, Email, Billing Email, Street/Unit/City/State/Zip, Billing Street/Unit/City/State/Zip, Property, Notes.
            </div>
          </div>
        )}

        <PopupModal open={showForm} onClose={cancelForm} maxWidth={1200}>
            <h3>{editingId ? 'Edit contact' : 'New contact'}</h3>
            <form onSubmit={submit}>

            <label>Contact type *</label>
            <select value={form.contact_type} onChange={e => update('contact_type', e.target.value)} required style={{ maxWidth: 320 }}>
              <option value="">Select…</option>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {form.contact_type && (
              <div className="contact-popup-grid">
                <div>
                  <div className="two-col-3" style={{ marginTop: 12 }}>
                    <div><label>First name *</label><input value={form.first_name} onChange={e => update('first_name', e.target.value)} required /></div>
                    <div><label>Last name</label><input value={form.last_name} onChange={e => update('last_name', e.target.value)} /></div>
                    <div><label>Position</label><input value={form.position} onChange={e => update('position', e.target.value)} placeholder="e.g. Property Manager" /></div>
                    <div><label>Phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder="(555) 555-5555" /></div>
                    <div><label>Email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
                    <div><label>Property</label><input value={form.property} onChange={e => update('property', e.target.value)} /></div>
                  </div>

                  {!isHomeowner && (
                    <div style={{ marginTop: 12 }}>
                      <label>Company</label>
                      <input value={form.management_company} onChange={e => update('management_company', e.target.value)} />
                    </div>
                  )}

                  {isHomeowner ? (
                    <>
                      <label style={{ marginTop: 16 }}>Address</label>
                      <AddressFields prefix="address" values={form} onChange={update} placesEnabled />
                    </>
                  ) : (
                    <>
                      <div className="two-col" style={{ marginTop: 16 }}>
                        <div><label>Billing email</label><input type="email" value={form.billing_email} onChange={e => update('billing_email', e.target.value)} /></div>
                      </div>
                      <label style={{ marginTop: 4 }}>Billing address</label>
                      <AddressFields prefix="billing" values={form} onChange={update} placesEnabled />

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
                        Address same as billing address
                      </label>
                      <label>Address</label>
                      <AddressFields prefix="address" values={form} onChange={update} placesEnabled />
                    </>
                  )}

                  <label style={{ marginTop: 16 }}>Notes</label>
                  <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />
                  <div className="section-actions">
                    <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save contact')}</button>
                  </div>
                </div>

                <div>
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8 }}>
                      Automated Notifications
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={!form.automated_emails_opt_out}
                        onChange={e => update('automated_emails_opt_out', !e.target.checked)}
                      />
                      Send this contact automated emails
                    </label>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 10 }}>
                      Uncheck to opt this contact out of every automated email below — manual emails you send yourself are never affected. Here's exactly what's currently automated:
                    </div>
                    <ul style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 10, paddingLeft: 16, lineHeight: 1.7 }}>
                      <li><b>Lead follow-ups</b> — sent 2 and 4 days after a lead is entered, if it's still Prospecting or Contacted.</li>
                      <li><b>Schedule reminders</b> — sent before a job's Scheduled Start Date, on whatever days are configured on that job's Portal Access tab.</li>
                      <li><b>Portal invite</b> — sent once, the first time this contact is granted portal access.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
            </form>
        </PopupModal>

        <div className="search-bar">
          <input placeholder="Search by name or company…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">No contacts yet.</div>}
        {filtered.length > 0 && (
          <DataTable
            getRowKey={c => c.id}
            onRowClick={startEdit}
            rows={filtered}
            columns={[
              { key: 'name', label: 'Name', defaultWidth: 180, render: c => c.name },
              { key: 'contact_type', label: 'Type', defaultWidth: 190, render: c => c.contact_type || '—' },
              { key: 'management_company', label: 'Company', defaultWidth: 170, render: c => c.management_company || '—' },
              { key: 'position', label: 'Position', defaultWidth: 150, render: c => c.position || '—' },
              { key: 'contact_phone', label: 'Phone', defaultWidth: 140, filterValue: c => formatPhone(c.contact_phone), render: c => c.contact_phone ? formatPhone(c.contact_phone) : '—' },
              { key: 'contact_email', label: 'Email', defaultWidth: 200, render: c => c.contact_email || '—' },
              {
                key: 'actions', label: '', defaultWidth: 90, filterable: false, stopClickPropagation: true,
                render: c => <button className="btn btn-sm btn-danger" onClick={() => removeContact(c.id)}>Delete</button>,
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
