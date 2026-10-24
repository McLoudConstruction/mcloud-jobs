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
import ActionsMenu from '../../components/ActionsMenu';
import CustomFieldCell from '../../components/CustomFieldCell';
import MobileFab from '../../components/MobileFab';
import MobileOverflowMenu from '../../components/MobileOverflowMenu';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import { CONTACT_TYPES, REAL_ESTATE_AGENT_TYPE, PHONE_TYPES, EMAIL_CONFIDENCE, EMAIL_BLOCKED_REASONS, EMAIL_BLOCK_LABELS, formatPhone } from '../../lib/constants';
import { useStaffAuth } from '../../lib/staffAuthContext';
import { parseVCard } from '../../lib/vcard';
import { exportToSheet, customColumnsToExport } from '../../lib/exportToSheet';
import { useCustomColumns, updateCustomFieldValue } from '../../lib/customColumns';
import { linkOrCreateCompanyByName } from '../../lib/contactSync';
import { resolveMainPropertyId } from '../../lib/contactProperties';
import ContactPropertiesCard from '../../components/ContactPropertiesCard';

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
  contact_phone: '', phone_type: '', contact_phone2: '', phone2_type: '',
  contact_email: '', email_confidence: '', email_blocked_reason: '', shared_email: false, is_test: false,
  property: '', notes: '', automated_emails_opt_out: false,
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
  phone_type: ['phone type'],
  contact_phone2: ['phone 2', 'second phone', 'secondary phone', 'phone2', 'alt phone', 'other phone'],
  phone2_type: ['phone 2 type', 'second phone type', 'secondary phone type', 'phone2 type'],
  contact_email: ['email', 'contact email', 'e-mail'],
  email_confidence: ['email confidence', 'email status'],
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
  if (contact.contact_phone2) contact.contact_phone2 = formatPhone(contact.contact_phone2);
  // Only keep values the database accepts. Anything else is dropped rather than failing the row.
  const ok = (list, v) => { const m = list.find(o => o.value === (v || '').toLowerCase().replace(/\s+/g, '_') || o.label.toLowerCase() === (v || '').toLowerCase()); return m ? m.value : ''; };
  contact.phone_type = ok(PHONE_TYPES, contact.phone_type);
  contact.phone2_type = ok(PHONE_TYPES, contact.phone2_type);
  contact.email_confidence = ok(EMAIL_CONFIDENCE, contact.email_confidence);
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
    { label: 'Phone Type', value: c => c.phone_type },
    { label: 'Phone 2', value: c => (c.contact_phone2 ? formatPhone(c.contact_phone2) : '') },
    { label: 'Phone 2 Type', value: c => c.phone2_type },
    { label: 'Email', value: c => c.contact_email },
    { label: 'Email Confidence', value: c => c.email_confidence },
    { label: 'Email Blocked Reason', value: c => c.email_blocked_reason },
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
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [dupMatches, setDupMatches] = useState(null); // people who already have the email being saved
  const [emailStatus, setEmailStatus] = useState(null); // why this saved person cannot be emailed right now
  const [dupGroups, setDupGroups] = useState(null); // duplicate email groups, when that view is open
  const { role } = useStaffAuth() || {};
  const isOwner = role === 'owner';
  const visibleRowsRef = useRef(null); // rows the table currently shows, so export matches column filters and sort

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

  // Ask the database why this person cannot be emailed (covers the do not email list and
  // do not contact companies, which the form fields alone do not show).
  useEffect(() => {
    setEmailStatus(null);
    if (!showForm || !editingId) return;
    let cancelled = false;
    supabase.rpc('crm_contact_email_status', { p_contact_id: editingId }).then(({ data }) => {
      if (!cancelled) setEmailStatus(data || null);
    });
    return () => { cancelled = true; };
  }, [showForm, editingId, contacts]);

  async function liftSuppression() {
    if (!form.contact_email) return;
    if (!confirm('Take ' + form.contact_email + ' off the do not email list? Only do this if they asked to hear from us again.')) return;
    const { error } = await supabase.rpc('crm_lift_suppression', { p_email: form.contact_email });
    if (error) { setSaveError(error.message); return; }
    await loadContacts();
  }

  async function openDuplicates() {
    const { data, error } = await supabase.rpc('crm_duplicate_emails');
    if (error) { setImportResult('Could not load duplicates: ' + error.message); return; }
    setDupGroups(data || []);
  }

  const isHomeowner = form.contact_type === HOMEOWNER_TYPE;
  const isRealEstateAgent = form.contact_type === REAL_ESTATE_AGENT_TYPE;
  // A saved contact always shows its details, even with no type on file
  // (imported or bot-added contacts often have none). Only a brand new
  // contact waits for a type to be picked first.
  const showDetails = Boolean(editingId) || Boolean(form.contact_type);

  function update(field, value) {
    if (field === 'contact_phone' || field === 'contact_phone2') value = formatPhone(value);
    if (field === 'contact_email' || field === 'shared_email') setDupMatches(null);
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // After a property is linked or removed in the Properties card, the main property can change
  // (the first link becomes the main one, and removing the main one promotes the next). Pull the
  // saved value back into the form so Save does not undo it.
  async function handlePropertiesChanged() {
    if (editingId) {
      const { data } = await supabase.from('contacts').select('property').eq('id', editingId).maybeSingle();
      if (data) setForm(prev => ({ ...prev, property: data.property || '' }));
    }
    loadContacts();
  }

  async function submit(e, { allowDuplicate = false } = {}) {
    e?.preventDefault?.();
    if (!form.first_name.trim() && !form.last_name.trim()) return;
    setSaving(true);

    // Duplicate check on the email before saving. The database enforces it too, this just
    // lets us show who already has it and offer a way forward.
    const email = (form.contact_email || '').trim();
    const emailChanged = !editingId || email.toLowerCase() !== (contacts.find(c => c.id === editingId)?.contact_email || '').trim().toLowerCase();
    if (email && emailChanged && !form.shared_email && !form.is_test && !allowDuplicate) {
      const { data: found } = await supabase.rpc('crm_find_people_by_email', { p_email: email, p_exclude: editingId || null });
      const clash = (found || []).filter(m => !m.shared_email);
      if (clash.length > 0) {
        setDupMatches(clash);
        setSaveError('');
        setSaving(false);
        return;
      }
    }
    setDupMatches(null);

    const payload = {
      ...form,
      name: [form.first_name, form.last_name].filter(Boolean).join(' '),
    };
    if (allowDuplicate) payload.shared_email = true;
    // These are set by the database, so never send them back.
    delete payload.email_blocked_at;
    delete payload.email_verified_at;
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
    // This sets the person's MAIN property. Other linked properties are
    // added and removed in the Properties card below the form.
    payload.property_id = await resolveMainPropertyId(form.property, editingId);

    let mutationError;
    if (editingId) {
      ({ error: mutationError } = await supabase.from('contacts').update(payload).eq('id', editingId));
    } else {
      ({ error: mutationError } = await supabase.from('contacts').insert(payload));
    }
    setSaving(false);
    if (mutationError) {
      setSaveError(String(mutationError.message || '').startsWith('duplicate_email')
        ? 'Someone in People already has that email. Open that person, or tick "Shares this email with someone else".'
        : mutationError.message);
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

  // People already in the database, or earlier in the same file, with the same email are left
  // out and reported, so an import cannot add a second copy of someone.
  async function dropDuplicateEmails(rows) {
    const { data: existing } = await supabase.from('contacts').select('contact_email, is_test, shared_email');
    const seen = new Set((existing || []).filter(c => c.contact_email && !c.is_test && !c.shared_email).map(c => c.contact_email.trim().toLowerCase()));
    const toInsert = [];
    const skipped = [];
    for (const r of rows) {
      const e = (r.contact_email || '').trim().toLowerCase();
      if (e && seen.has(e)) { skipped.push(r.name + ' (' + r.contact_email + ')'); continue; }
      if (e) seen.add(e);
      toInsert.push(r);
    }
    return { toInsert, skipped };
  }

  function importSummary(added, skipped, suffix) {
    let msg = `Imported ${added} contact${added === 1 ? '' : 's'}${suffix}.`;
    if (skipped.length > 0) {
      const shown = skipped.slice(0, 8).join(', ');
      msg += ` Skipped ${skipped.length} already in People by email: ${shown}${skipped.length > 8 ? ', and more' : ''}.`;
    }
    return msg;
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

      const { toInsert, skipped } = await dropDuplicateEmails(mapped);
      if (toInsert.length > 0) {
        const { error } = await supabase.from('contacts').insert(toInsert);
        if (error) throw error;
      }
      setImportResult(importSummary(toInsert.length, skipped, ''));
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
      const parsedClean = parsed.map(c => ({ ...c, phone_type: PHONE_TYPES.some(o => o.value === c.phone_type) ? c.phone_type : '', phone2_type: PHONE_TYPES.some(o => o.value === c.phone2_type) ? c.phone2_type : '', contact_phone2: c.contact_phone2 ? formatPhone(c.contact_phone2) : c.contact_phone2 }));
      const { toInsert, skipped } = await dropDuplicateEmails(parsedClean);
      if (toInsert.length > 0) {
        const { error } = await supabase.from('contacts').insert(toInsert);
        if (error) throw error;
      }
      setImportResult(importSummary(toInsert.length, skipped, ' from vCard'));
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImportingVcard(false);
      if (vcardInputRef.current) vcardInputRef.current.value = '';
    }
  }

  const testCount = contacts.filter(c => c.is_test).length;
  const filtered = contacts.filter(c => {
    if (c.is_test && !showTest) return false;
    if (typeFilter !== 'all' && c.contact_type !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.name || '').toLowerCase().includes(q) || (c.management_company || '').toLowerCase().includes(q) || (c.team_office || '').toLowerCase().includes(q);
  });

  function exportContacts() {
    exportToSheet({ fileName: 'contacts', sheetName: 'Contacts', columns: contactExportColumns(customColumns), rows: visibleRowsRef.current || filtered });
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Contact Database</h2>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={openNew}>+ Add new contact</button>
              <ActionsMenu
                items={[
                  { label: importing ? 'Importing…' : 'Import from Excel', disabled: importing, onClick: () => fileInputRef.current?.click() },
                  { label: importingVcard ? 'Importing…' : 'Import Contact (.vcf)', disabled: importingVcard, onClick: () => vcardInputRef.current?.click() },
                  { label: 'Add column', onClick: () => setAddColumnOpen(true) },
                  { label: 'Find duplicate emails', onClick: openDuplicates },
                  { label: () => `Export to Excel (${(visibleRowsRef.current || filtered).length})`, disabled: filtered.length === 0, onClick: exportContacts },
                ]}
              />
            </div>
          )}
          {isMobile && (
            <MobileOverflowMenu>
              <button className="btn btn-sm" onClick={exportContacts}>↓ Export to Excel</button>
              <button className="btn btn-sm" onClick={openDuplicates}>Find duplicate emails</button>
              <AddColumnButton addColumn={addColumn} />
            </MobileOverflowMenu>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
        <input ref={vcardInputRef} type="file" accept=".vcf" onChange={handleVCardImport} style={{ display: 'none' }} />
        {!isMobile && <AddColumnButton addColumn={addColumn} open={addColumnOpen} onOpenChange={setAddColumnOpen} />}

        {isMobile && (
          <>
            <MobileFab
              label="Add contact"
              items={[
                { label: '+ Add new contact', primary: true, onClick: openNew },
                { label: importingVcard ? 'Importing…' : '+ Import Contact (.vcf)', onClick: () => vcardInputRef.current?.click() },
              ]}
            />
          </>
        )}

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Type, First Name, Last Name, Company, Position, Team/Office, Phone, Phone Type, Phone 2, Phone 2 Type, Email, Email Confidence, Billing Email, Street/Unit/City/State/Zip, Billing Street/Unit/City/State/Zip, Property, Notes.
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
            <div className={editingId ? 'contact-popup-grid' : undefined}>
            <div>
            <form onSubmit={submit}>
            <fieldset className="contact-fieldset" disabled={!editMode}>

            <label>Contact type{editingId && !editMode ? '' : ' *'}</label>
            <select value={form.contact_type} onChange={e => update('contact_type', e.target.value)} required={!editingId || editMode} style={{ maxWidth: 320 }}>
              <option value="">Select…</option>
              {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {showDetails && (
              <div>
                <div>
                  <div className="two-col-3" style={{ marginTop: 12 }}>
                    <div><label>First name *</label><input value={form.first_name} onChange={e => update('first_name', e.target.value)} required /></div>
                    <div><label>Last name</label><input value={form.last_name} onChange={e => update('last_name', e.target.value)} /></div>
                    <div><label>Position</label><input value={form.position} onChange={e => update('position', e.target.value)} placeholder={editMode ? 'e.g. Property Manager' : undefined} /></div>
                    <div><label>Phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder={editMode ? '(555) 555-5555' : undefined} /></div>
                    <div>
                      <label>Phone type</label>
                      <select value={form.phone_type || ''} onChange={e => update('phone_type', e.target.value)}>
                        <option value="">Not set</option>
                        {PHONE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label>Second phone</label><input value={form.contact_phone2 || ''} onChange={e => update('contact_phone2', e.target.value)} placeholder={editMode ? '(555) 555-5555' : undefined} /></div>
                    <div>
                      <label>Second phone type</label>
                      <select value={form.phone2_type || ''} onChange={e => update('phone2_type', e.target.value)} disabled={!form.contact_phone2}>
                        <option value="">Not set</option>
                        {PHONE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label>Email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
                    <div>
                      <label>Email confidence</label>
                      <select value={form.email_confidence || ''} onChange={e => update('email_confidence', e.target.value)} disabled={!form.contact_email}>
                        <option value="">Not set</option>
                        {EMAIL_CONFIDENCE.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Email status</label>
                      <select value={form.email_blocked_reason || ''} onChange={e => update('email_blocked_reason', e.target.value)} disabled={!form.contact_email}>
                        <option value="">Good, OK to email</option>
                        {EMAIL_BLOCKED_REASONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div><label>{editingId ? 'Main property' : 'Property'}</label><input value={form.property} onChange={e => update('property', e.target.value)} /></div>
                  </div>

                  {editingId && emailStatus && emailStatus !== form.email_blocked_reason && emailStatus !== 'no_email' && (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: '#a13f3f' }}>
                      Automated email is blocked: {EMAIL_BLOCK_LABELS[emailStatus] || emailStatus}.
                      {emailStatus === 'suppressed' && isOwner && (
                        <> <button type="button" className="btn btn-sm" style={{ marginLeft: 6 }} onClick={liftSuppression}>Take off the do not email list</button></>
                      )}
                    </div>
                  )}
                  {editingId && emailStatus && emailStatus === form.email_blocked_reason && (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: '#a13f3f' }}>
                      Automated email is blocked: {EMAIL_BLOCK_LABELS[emailStatus] || emailStatus}. Change Email status to Good to allow it again.
                    </div>
                  )}
                  {dupMatches && dupMatches.length > 0 && (
                    <div className="card" style={{ marginTop: 10, borderColor: '#d9a441', fontSize: 13 }}>
                      <b>{dupMatches.length === 1 ? 'Someone in People already has this email:' : 'These people already have this email:'}</b>
                      <ul style={{ margin: '6px 0 8px 18px' }}>
                        {dupMatches.map(m => (
                          <li key={m.id}>
                            {m.name}{[m.company, m.property].filter(Boolean).length ? ' (' + [m.company, m.property].filter(Boolean).join(', ') + ')' : ''}
                            {' '}<button type="button" className="btn btn-sm" onClick={() => { const found = contacts.find(c => c.id === m.id); if (found) { cancelForm(); startEdit(found); } }}>Open</button>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="btn btn-sm" disabled={saving} onClick={() => submit(null, { allowDuplicate: true })}>Save anyway, they share this email</button>
                    </div>
                  )}

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

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontWeight: 400, fontSize: 13 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(form.shared_email)} onChange={e => update('shared_email', e.target.checked)} />
                    Shares this email with someone else (skips the duplicate check)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontWeight: 400, fontSize: 13 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(form.is_test)} onChange={e => update('is_test', e.target.checked)} />
                    Test record (hidden from lists, routes and the bot)
                  </label>

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

            {editMode && showDetails && (
              <>
                {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save contact')}</button>
                  {editingId && <button className="btn btn-sm" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>}
                </div>
              </>
            )}
            </form>
            {editingId && (
              <ContactPropertiesCard contactId={editingId} canEdit={editMode} onChanged={handlePropertiesChanged} />
            )}
            {editingId && (
              <div style={{ margin: '12px 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {form.contact_email && (
                  <SendEmailButton
                    to={form.contact_email}
                    name={[form.first_name, form.last_name].filter(Boolean).join(' ')}
                    company={form.management_company}
                    property={form.property}
                    label="Email this contact"
                  />
                )}
                <AdminDeleteButton
                  kind="contact"
                  recordId={editingId}
                  name={[form.first_name, form.last_name].filter(Boolean).join(' ')}
                  onDeleted={() => { cancelForm(); loadContacts(); }}
                />
              </div>
            )}
            </div>

            {editingId && (
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
        {testCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 400, margin: '0 0 8px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={showTest} onChange={e => setShowTest(e.target.checked)} />
            Show test records ({testCount})
          </label>
        )}

        <PopupModal open={dupGroups !== null} onClose={() => setDupGroups(null)} maxWidth={760}>
          <h3 style={{ marginTop: 0 }}>Duplicate emails</h3>
          {dupGroups && dupGroups.length === 0 && <div className="empty-state">No two people share an email.</div>}
          {dupGroups && dupGroups.map(g => (
            <div key={g.email} className="card" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{g.email} ({g.n})</div>
              <ul style={{ margin: '6px 0 0 18px', fontSize: 13 }}>
                {g.people.map(m => (
                  <li key={m.id}>
                    {m.name}{[m.company, m.property].filter(Boolean).length ? ' (' + [m.company, m.property].filter(Boolean).join(', ') + ')' : ''}
                    {' '}<button type="button" className="btn btn-sm" onClick={() => { const found = contacts.find(c => c.id === m.id); if (found) { setDupGroups(null); startEdit(found); } }}>Open</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Open each person to delete the extra one, or tick Shares this email if two people really use one address. Nothing is merged for you.</div>
        </PopupModal>

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
            stickyHeader
            onVisibleRowsChange={rows => { visibleRowsRef.current = rows; }}
            columns={[
              { key: 'name', label: 'Name', defaultWidth: 180, render: c => c.name },
              { key: 'contact_type', label: 'Type', defaultWidth: 190, render: c => c.contact_type || '—' },
              { key: 'management_company', label: 'Company', defaultWidth: 170, render: c => c.management_company || '—' },
              { key: 'position', label: 'Position', defaultWidth: 150, render: c => c.position || '—' },
              { key: 'team_office', label: 'Team/Office', defaultWidth: 170, render: c => c.team_office || '—' },
              { key: 'contact_phone', label: 'Phone', defaultWidth: 140, filterValue: c => formatPhone(c.contact_phone), render: c => c.contact_phone ? formatPhone(c.contact_phone) : '—' },
              { key: 'contact_email', label: 'Email', defaultWidth: 220, render: c => c.contact_email ? (
                <span>{c.contact_email}{c.email_blocked_reason ? <span style={{ marginLeft: 6, fontSize: 11, color: '#a13f3f' }}>{EMAIL_BLOCK_LABELS[c.email_blocked_reason]}</span> : (c.email_confidence === 'pattern_guess' ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-soft)' }}>guess</span> : null)}</span>
              ) : '—' },
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
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
