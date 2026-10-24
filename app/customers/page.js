'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';
import PopupModal from '../../components/PopupModal';
import TouchTimeline from '../../components/TouchTimeline';
import AdminDeleteButton from '../../components/AdminDeleteButton';
import SendEmailButton from '../../components/SendEmailButton';
import DataTable from '../../components/DataTable';
import AddColumnButton from '../../components/AddColumnButton';
import CustomFieldCell from '../../components/CustomFieldCell';
import MobileFab from '../../components/MobileFab';
import MobileOverflowMenu from '../../components/MobileOverflowMenu';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import { CONTACT_TYPES, REAL_ESTATE_AGENT_TYPE, formatPhone } from '../../lib/constants';
import { parseVCard } from '../../lib/vcard';
import { exportToSheet, customColumnsToExport } from '../../lib/exportToSheet';
import { useCustomColumns, updateCustomFieldValue } from '../../lib/customColumns';
import { linkOrCreateCompanyByName, findPropertyIdByName } from '../../lib/contactSync';

const HOMEOWNER_TYPE = 'Residential - Homeowner';

const ADDRESS_FIELDS = ['street', 'unit', 'city', 'state', 'zip'];

// True when a saved contact has its own billing address that is not just a
// copy of the street address.
function billingDiffers(c) {
  const norm = v => (v || '').toString().trim().toLowerCase();
  const hasBilling = ADDRESS_FIELDS.some(f => norm(c[`billing_${f}`]));
  if (!hasBilling) return false;
  return ADDRESS_FIELDS.some(f => norm(c[`billing_${f}`]) !== norm(c[`address_${f}`]));
}

const EMPTY_FORM = {
  contact_type: '', first_name: '', last_name: '', management_company: '', position: '', team_office: '',
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
  team_office: ['team/office', 'team / office', 'team office', 'team', 'office', 'brokerage office'],
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

// Everything worth having in a spreadsheet, not just the columns the table
// shows. Headers match the Excel import so an export can be edited and
// brought back in.
function contactExportColumns(customColumns) {
  return [
    { label: 'Name', value: c => c.name },
    { label: 'Type', value: c => c.contact_type },
    { label: 'First Name', value: c => c.first_name },
    { label: 'Last Name', value: c => c.last_name },
    { label: 'Company', value: c => c.management_company },
    { label: 'Position', value: c => c.position },
    { label: 'Team/Office', value: c => c.team_office },
    { label: 'Phone', value: c => (c.contact_phone ? formatPhone(c.contact_phone) : '') },
    { label: 'Email', value: c => c.contact_email },
    { label: 'Billing Email', value: c => c.billing_email },
    { label: 'Property', value: c => c.property },
    { label: 'Street', value: c => c.address_street },
    { label: 'Unit', value: c => c.address_unit },
    { label: 'City', value: c => c.address_city },
    { label: 'State', value: c => c.address_state },
    { label: 'Zip', value: c => c.address_zip },
    { label: 'Billing Street', value: c => c.billing_street },
    { label: 'Billing Unit', value: c => c.billing_unit },
    { label: 'Billing City', value: c => c.billing_city },
    { label: 'Billing State', value: c => c.billing_state },
    { label: 'Billing Zip', value: c => c.billing_zip },
    { label: 'Notes', value: c => c.notes },
    ...customColumnsToExport(customColumns),
  ];
}

export default function CustomersPage() {
  const { session, loading } = useRequireAuth();
  const [contacts, setContacts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [billingDifferent, setBillingDifferent] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);
  const vcardInputRef = useRef(null);
  const [importingVcard, setImportingVcard] = useState(false);
  const { customColumns, addColumn } = useCustomColumns('contacts');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

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
  const isRealEstateAgent = form.contact_type === REAL_ESTATE_AGENT_TYPE;

  function update(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.first_name.trim() && !form.last_name.trim()) return;
    setSaving(true);

    const payload = {
      ...form,
      name: [form.first_name, form.last_name].filter(Boolean).join(' '),
    };
    // Team/Office only applies to real estate agents; clear it if the type changed.
    if (!isRealEstateAgent) payload.team_office = '';
    if (isHomeowner) {
      payload.management_company = '';
      payload.billing_street = ''; payload.billing_unit = ''; payload.billing_city = '';
      payload.billing_state = ''; payload.billing_zip = ''; payload.billing_email = '';
      payload.company_id = null;
    } else {
      // Billing address only differs when the checkbox says so. Otherwise it
      // mirrors the street address, so invoices and anything else that reads
      // the billing fields keep working.
      if (!billingDifferent) {
        for (const f of ADDRESS_FIELDS) payload[`billing_${f}`] = form[`address_${f}`] || '';
      }
      // Mirrors what Properties already does for its own management_company
      // field: find the matching company by name, or create it if it
      // doesn't exist yet, so this contact is really linked rather than
      // just carrying a text string that happens to match.
      payload.company_id = await linkOrCreateCompanyByName(form.management_company);
    }

    // Same idea for property, but link-only — a property needs a real
    // address to be worth creating, and a contact's free-text property
    // name alone isn't enough to do that well. If nothing matches, the
    // text is still saved; it just isn't linked to a Properties record.
    payload.property_id = await findPropertyIdByName(form.property);

    let mutationError;
    if (editingId) {
      ({ error: mutationError } = await supabase.from('contacts').update(payload).eq('id', editingId));
    } else {
      ({ error: mutationError } = await supabase.from('contacts').insert(payload));
    }
    setSaving(false);
    if (mutationError) {
      setSaveError(mutationError.message);
      return;
    }
    setSaveError('');
    if (editingId) {
      // Go back to the read-only view of the saved contact.
      setForm(prev => ({ ...prev, ...payload }));
      setEditMode(false);
    } else {
      setForm(EMPTY_FORM);
      setBillingDifferent(false);
      setEditingId(null);
      setEditMode(false);
      setShowForm(false);
    }
    // Don't rely solely on the realtime subscription — refresh directly
    // so the change shows up immediately.
    await loadContacts();
  }

  function startEdit(contact) {
    setForm({ ...EMPTY_FORM, ...contact, contact_phone: formatPhone(contact.contact_phone) });
    setBillingDifferent(billingDiffers(contact));
    setEditingId(contact.id);
    setEditMode(false);
    setTipOpen(false);
    setShowForm(true);
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setBillingDifferent(false);
    setEditingId(null);
    setEditMode(true);
    setTipOpen(false);
    setShowForm(true);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setBillingDifferent(false);
    setEditingId(null);
    setEditMode(false);
    setTipOpen(false);
    setSaveError('');
    setShowForm(false);
  }

  // Cancel while editing an existing contact: drop unsaved changes and go
  // back to the read-only view.
  function cancelEdit() {
    const original = contacts.find(c => c.id === editingId);
    if (original) {
      setForm({ ...EMPTY_FORM, ...original, contact_phone: formatPhone(original.contact_phone) });
      setBillingDifferent(billingDiffers(original));
    }
    setSaveError('');
    setEditMode(false);
  }

  async function saveCustomField(contact, key, value) {
    try {
      const nextFields = await updateCustomFieldValue('contacts', contact.id, contact.custom_fields, key, value);
      setContacts(prev => prev.map(c => (c.id === contact.id ? { ...c, custom_fields: nextFields } : c)));
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
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
    if (typeFilter !== 'all' && c.contact_type !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.management_company || '').toLowerCase().includes(q) || (c.team_office || '').toLowerCase().includes(q);
  });

  function exportContacts() {
    exportToSheet({ fileName: 'contacts', sheetName: 'Contacts', columns: contactExportColumns(customColumns), rows: filtered });
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Contact Database</h2>
          {!isMobile && (
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
                {importingVcard ? 'Importing…' : '↑ Import Contact (.vcf)'}
              </button>
              <AddColumnButton addColumn={addColumn} />
              <button className="btn btn-primary" onClick={openNew}>+ Add new contact</button>
            </div>
          )}
          {isMobile && (
            <MobileOverflowMenu>
              <button className="btn btn-sm" onClick={exportContacts}>↓ Export to Excel</button>
              <AddColumnButton addColumn={addColumn} />
            </MobileOverflowMenu>
          )}
        </div>

        {isMobile && (
          <>
            <input
              ref={vcardInputRef}
              type="file"
              accept=".vcf"
              onChange={handleVCardImport}
              style={{ display: 'none' }}
            />
            <MobileFab
              label="Add contact"
              items={[
                { label: '+ Add new contact', primary: true, onClick: openNew },
                { label: importingVcard ? 'Importing…' : '+ Import Contact (.vcf)', onClick: () => vcardInputRef.current?.click() },
              ]}
            />
          </>
        )}

        {/* This isn't a native contacts picker — iOS/Android browsers don't
            expose one to a plain web file input — so a tap here always
            opens the Files app, which is empty until a .vcf actually
            exists there. This note is the fix: it tells people to export
            the contact into Files first, rather than leaving them to
            wonder why "Import from iPhone" dead-ends on an empty folder. */}
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: -10, marginBottom: 16 }}>
          To import a contact from your phone: open Contacts, select the contact, choose Share Contact → Save to Files, then use "Import Contact (.vcf)" here to pick that file.
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Type, First Name, Last Name, Company, Position, Team/Office, Phone, Email, Billing Email, Street/Unit/City/State/Zip, Billing Street/Unit/City/State/Zip, Property, Notes.
            </div>
          </div>
        )}

        <PopupModal open={showForm} onClose={cancelForm} maxWidth={1200}>
            <div className="contact-popup-head">
              <h3>{!editingId ? 'New contact' : editMode ? 'Edit contact' : 'More information'}</h3>
              {editingId && !editMode && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditMode(true)}>Edit Contact</button>
              )}
            </div>
            <div className={editingId && form.contact_type ? 'contact-popup-grid' : undefined}>
            <div>
            <form onSubmit={submit}>
            <fieldset className="contact-fieldset" disabled={!editMode}>

            <label>Contact type *</label>
            <select value={form.contact_type} onChange={e => update('contact_type', e.target.value)} required style={{ maxWidth: 320 }}>
              <option value="">Select…</option>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {form.contact_type && (
              <div>
                <div>
                  <div className="two-col-3" style={{ marginTop: 12 }}>
                    <div><label>First name *</label><input value={form.first_name} onChange={e => update('first_name', e.target.value)} required /></div>
                    <div><label>Last name</label><input value={form.last_name} onChange={e => update('last_name', e.target.value)} /></div>
                    <div><label>Position</label><input value={form.position} onChange={e => update('position', e.target.value)} placeholder={editMode ? 'e.g. Property Manager' : undefined} /></div>
                    <div><label>Phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder={editMode ? '(555) 555-5555' : undefined} /></div>
                    <div><label>Email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
                    <div><label>Property</label><input value={form.property} onChange={e => update('property', e.target.value)} /></div>
                  </div>

                  {!isHomeowner && (
                    <div className={isRealEstateAgent ? 'two-col' : undefined} style={{ marginTop: 12 }}>
                      <div>
                        <label>{isRealEstateAgent ? 'Brokerage' : 'Company'}</label>
                        <input value={form.management_company} onChange={e => update('management_company', e.target.value)} placeholder={editMode && isRealEstateAgent ? 'e.g. Keller Williams' : undefined} />
                      </div>
                      {isRealEstateAgent && (
                        <div>
                          <label>Team/Office</label>
                          <input value={form.team_office} onChange={e => update('team_office', e.target.value)} placeholder={editMode ? "e.g. The Smith Group, Lee's Summit office" : undefined} />
                        </div>
                      )}
                    </div>
                  )}

                  <label style={{ marginTop: 16 }}>Address</label>
                  <AddressFields prefix="address" values={form} onChange={update} placesEnabled />

                  {!isHomeowner && (
                    <>
                      <div className="two-col" style={{ marginTop: 16 }}>
                        <div><label>Billing email</label><input type="email" value={form.billing_email} onChange={e => update('billing_email', e.target.value)} /></div>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={billingDifferent} onChange={e => setBillingDifferent(e.target.checked)} />
                        Billing Address different from Street Address
                      </label>
                      {billingDifferent && (
                        <>
                          <label>Billing address</label>
                          <AddressFields prefix="billing" values={form} onChange={update} placesEnabled />
                        </>
                      )}
                    </>
                  )}

                  <label style={{ marginTop: 16 }}>Notes</label>
                  <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 400, fontSize: 13, color: 'var(--ink)' }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={!form.automated_emails_opt_out}
                        onChange={e => update('automated_emails_opt_out', !e.target.checked)}
                      />
                      Send this contact automated emails
                    </label>
                    <span
                      className={`info-tip${tipOpen ? ' open' : ''}`}
                      tabIndex={0}
                      role="button"
                      aria-label="What automated emails are sent"
                      onClick={() => setTipOpen(o => !o)}
                      onBlur={() => setTipOpen(false)}
                    >
                      i
                      <span className="info-tip-body" role="tooltip">
                        Uncheck to opt this contact out of every automated email below — manual emails you send yourself are never affected. Here's exactly what's currently automated:
                        <ul>
                          <li><b>Lead follow-ups</b> — sent 2 and 4 days after a lead is entered, if it's still Prospecting or Contacted.</li>
                          <li><b>Schedule reminders</b> — sent before a job's Scheduled Start Date, on whatever days are configured on that job's Portal Access tab.</li>
                          <li><b>Portal invite</b> — sent once, the first time this contact is granted portal access.</li>
                        </ul>
                      </span>
                    </span>
                  </div>
                </div>

              </div>
            )}
            </fieldset>

            {editMode && form.contact_type && (
              <>
                {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save contact')}</button>
                  {editingId && <button className="btn btn-sm" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>}
                  {editingId && (
                    <AdminDeleteButton
                      kind="contact"
                      recordId={editingId}
                      name={[form.first_name, form.last_name].filter(Boolean).join(' ')}
                      onDeleted={() => { cancelForm(); loadContacts(); }}
                    />
                  )}
                </div>
              </>
            )}
            </form>
            {editingId && form.contact_email && (
              <div style={{ margin: '12px 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <SendEmailButton
                  to={form.contact_email}
                  name={[form.first_name, form.last_name].filter(Boolean).join(' ')}
                  company={form.management_company}
                  property={form.property}
                  label="Email this contact"
                />
              </div>
            )}
            </div>

            {editingId && form.contact_type && (
              <div>
                <div className="contact-touches-panel">
                  <TouchTimeline kind="contact" recordId={editingId} bare />
                </div>
              </div>
            )}
            </div>
        </PopupModal>

        <div className="search-bar">
          <input placeholder="Search by name, company or team/office…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <ScrollFadeRow trackClassName="stage-tabs">
          <button className={`stage-tab ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>All ({contacts.length})</button>
          {CONTACT_TYPES.map(t => {
            const count = contacts.filter(c => c.contact_type === t).length;
            if (!count) return null;
            return <button key={t} className={`stage-tab ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t} ({count})</button>;
          })}
        </ScrollFadeRow>

        {filtered.length === 0 && <div className="empty-state">No contacts yet.</div>}

        {filtered.length > 0 && isMobile && (
          <div className="entity-mobile-list">
            {filtered.map(c => (
              <button key={c.id} className="entity-mobile-row" onClick={() => startEdit(c)}>
                <span className="entity-mobile-row-text">
                  <span className="entity-mobile-row-title">{c.name}</span>
                  <span className="entity-mobile-row-sub">
                    {[c.management_company, c.team_office, c.position].filter(Boolean).join(' · ') || c.contact_type || 'No company on file'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && !isMobile && (
          <DataTable
            getRowKey={c => c.id}
            onRowClick={startEdit}
            rows={filtered}
            exportFileName="contacts"
            exportSheetName="Contacts"
            exportColumns={contactExportColumns(customColumns)}
            columns={[
              { key: 'name', label: 'Name', defaultWidth: 180, render: c => c.name },
              { key: 'contact_type', label: 'Type', defaultWidth: 190, render: c => c.contact_type || '—' },
              { key: 'management_company', label: 'Company', defaultWidth: 170, render: c => c.management_company || '—' },
              { key: 'position', label: 'Position', defaultWidth: 150, render: c => c.position || '—' },
              { key: 'team_office', label: 'Team/Office', defaultWidth: 170, render: c => c.team_office || '—' },
              { key: 'contact_phone', label: 'Phone', defaultWidth: 140, filterValue: c => formatPhone(c.contact_phone), render: c => c.contact_phone ? formatPhone(c.contact_phone) : '—' },
              { key: 'contact_email', label: 'Email', defaultWidth: 200, render: c => c.contact_email || '—' },
              ...customColumns.map(col => ({
                key: `custom:${col.column_key}`,
                label: col.label,
                defaultWidth: 150,
                stopClickPropagation: true,
                filterValue: c => c.custom_fields?.[col.column_key] ?? '',
                sortValue: c => c.custom_fields?.[col.column_key] ?? '',
                render: c => (
                  <CustomFieldCell
                    column={col}
                    value={c.custom_fields?.[col.column_key]}
                    onSave={value => saveCustomField(c, col.column_key, value)}
                  />
                ),
              })),
              {
                key: 'actions', label: '', defaultWidth: 90, filterable: false, sortable: false, stopClickPropagation: true, sticky: true,
                render: c => <AdminDeleteButton kind="contact" recordId={c.id} name={c.name} onDeleted={loadContacts} />,
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
