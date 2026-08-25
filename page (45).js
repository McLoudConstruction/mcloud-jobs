'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';
import PlacesAutocompleteInput from '../../components/PlacesAutocompleteInput';
import DataTable from '../../components/DataTable';
import PopupModal from '../../components/PopupModal';
import { PROPERTY_TYPES, PROSPECT_STAGES, PROSPECT_STAGE_LABELS, formatPhone } from '../../lib/constants';

const EMPTY_FORM = {
  property_name: '', property_type: '', prospect_stage: 'prospecting',
  property_street: '', property_unit: '', property_city: '', property_state: '', property_zip: '',
  management_company: '', contact_name: '', contact_phone: '', contact_email: '',
  year_built: '', sq_ft: '', target_value: '', active: true, notes: '',
};
const EMPTY_CONTACT_FORM = { name: '', role: 'Property Contact', contact_phone: '', contact_email: '' };

const HEADER_MAP = {
  property_name: ['property', 'property name', 'name', 'building'],
  property_type: ['type', 'property type', 'category'],
  prospect_stage: ['prospect stage', 'stage'],
  management_company: ['company', 'management company', 'management', 'organization'],
  contact_name: ['contact', 'contact name'],
  contact_phone: ['phone', 'contact phone', 'phone number'],
  contact_email: ['email', 'contact email'],
  property_street: ['street', 'address', 'street address'],
  property_unit: ['unit', 'suite'],
  property_city: ['city'],
  property_state: ['state'],
  property_zip: ['zip', 'zip code', 'postal code'],
  year_built: ['year built', 'built'],
  sq_ft: ['sq ft', 'square feet', 'square footage', 'sqft'],
  target_value: ['target value', 'value'],
  notes: ['notes', 'note', 'comments'],
};
function normalizeHeader(h) { return (h || '').toString().trim().toLowerCase(); }
function mapRow(row) {
  const out = {};
  const keys = Object.keys(row);
  for (const [field, variants] of Object.entries(HEADER_MAP)) {
    const match = keys.find(k => variants.includes(normalizeHeader(k)));
    if (match && row[match] !== undefined && row[match] !== null) out[field] = String(row[match]).trim();
  }
  return out;
}

export default function PropertiesPage() {
  const { session, loading } = useRequireAuth();
  const [properties, setProperties] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);

  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [savingContact, setSavingContact] = useState(false);
  const [contactNote, setContactNote] = useState('');
  const [propertyContacts, setPropertyContacts] = useState([]);

  const loadProperties = useCallback(async () => {
    const { data } = await supabase.from('properties').select('*').order('property_name', { ascending: true });
    if (data) setProperties(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadProperties();
    const channel = supabase.channel('properties').on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, loadProperties).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadProperties]);

  const loadPropertyContacts = useCallback(async (propertyId) => {
    if (!propertyId) { setPropertyContacts([]); return; }
    const { data } = await supabase.from('contacts').select('*').eq('property_id', propertyId).order('name', { ascending: true });
    if (data) setPropertyContacts(data);
  }, []);

  function update(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function findOrCreateCompany(companyName) {
    const trimmed = (companyName || '').trim();
    if (!trimmed) return null;
    const { data: existing } = await supabase.from('companies').select('id').ilike('company_name', trimmed).limit(1);
    if (existing && existing.length > 0) return existing[0].id;
    const { data: created } = await supabase.from('companies').insert({ company_name: trimmed, company_type: 'Management Company' }).select().single();
    return created ? created.id : null;
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.property_name.trim()) return;
    setSaving(true);

    const companyId = await findOrCreateCompany(form.management_company);
    const payload = {
      ...form,
      target_value: form.target_value ? parseFloat(String(form.target_value).replace(/[^0-9.]/g, '')) : null,
      company_id: companyId,
    };

    if (editingId) {
      await supabase.from('properties').update(payload).eq('id', editingId);
    } else {
      await supabase.from('properties').insert(payload);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowContactForm(false);
  }

  function startEdit(p) {
    setForm({ ...EMPTY_FORM, ...p, target_value: p.target_value ?? '', contact_phone: formatPhone(p.contact_phone) });
    setEditingId(p.id);
    setShowForm(true);
    loadPropertyContacts(p.id);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowContactForm(false);
    setPropertyContacts([]);
  }

  async function removeProperty(id) {
    if (!confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', id);
  }

  async function markVisited(id) {
    await supabase.from('properties').update({ last_visited_at: new Date().toISOString() }).eq('id', id);
  }

  function updateContactForm(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setContactForm(prev => ({ ...prev, [field]: value }));
  }

  async function submitPropertyContact(e) {
    e.preventDefault();
    if (!contactForm.name.trim() || !editingId) return;
    setSavingContact(true);
    await supabase.from('contacts').insert({
      name: contactForm.name,
      first_name: contactForm.name.split(' ')[0],
      last_name: contactForm.name.split(' ').slice(1).join(' '),
      role: contactForm.role,
      contact_phone: contactForm.contact_phone,
      contact_email: contactForm.contact_email,
      property_id: editingId,
      contact_type: form.property_type || null,
      // Carry the property's own info over so the contact isn't missing
      // context just because it was created from this card.
      property: form.property_name || null,
      management_company: form.management_company || null,
      address_street: form.property_street || null,
      address_unit: form.property_unit || null,
      address_city: form.property_city || null,
      address_state: form.property_state || null,
      address_zip: form.property_zip || null,
    });

    // If this is the primary "Property Contact" role, reflect their name/phone/email
    // on the property record's own contact fields too, so it doesn't need typing twice.
    if (contactForm.role === 'Property Contact') {
      const propertyPatch = {
        contact_name: contactForm.name,
        contact_phone: contactForm.contact_phone || form.contact_phone,
        contact_email: contactForm.contact_email || form.contact_email,
      };
      await supabase.from('properties').update(propertyPatch).eq('id', editingId);
      setForm(prev => ({ ...prev, ...propertyPatch }));
    }

    setSavingContact(false);
    setContactForm(EMPTY_CONTACT_FORM);
    setShowContactForm(false);
    setContactNote(`${contactForm.name} added to Contacts.`);
    setTimeout(() => setContactNote(''), 3000);
    loadPropertyContacts(editingId);
  }

  async function removePropertyContact(contactId, name) {
    if (!confirm(`Remove ${name} from this property? They'll stay in Contacts, just unlinked from here.`)) return;
    await supabase.from('contacts').update({ property_id: null }).eq('id', contactId);
    loadPropertyContacts(editingId);
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
      const mapped = rows.map(mapRow).filter(p => p.property_name && p.property_name.trim());
      if (mapped.length === 0) {
        setImportResult('No rows with a recognizable property name column were found.');
        return;
      }
      const { error } = await supabase.from('properties').insert(mapped);
      if (error) throw error;
      setImportResult(`Imported ${mapped.length} propert${mapped.length === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const filtered = properties.filter(p => {
    if (typeFilter !== 'all' && p.property_type !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (p.property_name || '').toLowerCase().includes(q) || (p.management_company || '').toLowerCase().includes(q);
  });

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Property Database</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import from Excel'}
            </button>
            <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ Add property'}
            </button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
          </div>
        )}

        <PopupModal open={showForm} onClose={cancelForm} maxWidth={960}>
              <form onSubmit={submit}>
            <h3>{editingId ? 'Edit property' : 'New property'}</h3>
            <div className="two-col">
              <div>
                <label>Property name *</label>
                <PlacesAutocompleteInput
                  value={form.property_name}
                  onChange={v => update('property_name', v)}
                  onPlaceSelected={place => {
                    update('property_street', place.street);
                    update('property_city', place.city);
                    update('property_state', place.state);
                    update('property_zip', place.zip);
                  }}
                  required
                />
              </div>
              <div>
                <label>Property type</label>
                <select value={form.property_type} onChange={e => update('property_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Prospect stage</label>
                <select value={form.prospect_stage} onChange={e => update('prospect_stage', e.target.value)}>
                  {PROSPECT_STAGES.map(s => <option key={s} value={s}>{PROSPECT_STAGE_LABELS[s]}</option>)}
                </select>
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Address</label>
            <AddressFields prefix="property" values={form} onChange={update} placesEnabled />

            <div className="two-col" style={{ marginTop: 12 }}>
              <div>
                <label>Management company</label>
                <input value={form.management_company} onChange={e => update('management_company', e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Automatically added to Companies if it doesn't already exist.</div>
              </div>
              <div><label>Contact name</label><input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} /></div>
              <div><label>Contact phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} /></div>
              <div><label>Contact email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
              <div><label>Year built</label><input value={form.year_built} onChange={e => update('year_built', e.target.value)} /></div>
              <div><label>Square footage</label><input value={form.sq_ft} onChange={e => update('sq_ft', e.target.value)} /></div>
              <div><label>Target project value ($)</label><input value={form.target_value} onChange={e => update('target_value', e.target.value)} /></div>
              <div>
                <label>Active</label>
                <select value={form.active ? 'yes' : 'no'} onChange={e => update('active', e.target.value === 'yes')}>
                  <option value="yes">Active</option>
                  <option value="no">Inactive</option>
                </select>
              </div>
            </div>
            <label style={{ marginTop: 12 }}>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />

            {editingId && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div className="top-actions" style={{ marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>Property Contacts &amp; Influencers</h4>
                  <button type="button" className="btn btn-sm" onClick={() => setShowContactForm(s => !s)}>
                    {showContactForm ? 'Cancel' : '+ Add Contact / Influencer'}
                  </button>
                </div>

                {contactNote && <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 10 }}>{contactNote}</div>}

                {showContactForm && (
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 14 }}>
                    <div className="two-col">
                      <div><label>Name *</label><input value={contactForm.name} onChange={e => updateContactForm('name', e.target.value)} required /></div>
                      <div>
                        <label>Role</label>
                        <select value={contactForm.role} onChange={e => updateContactForm('role', e.target.value)}>
                          <option value="Property Contact">Property Contact</option>
                          <option value="Influencer">Influencer</option>
                        </select>
                      </div>
                      <div><label>Phone</label><input value={contactForm.contact_phone} onChange={e => updateContactForm('contact_phone', e.target.value)} /></div>
                      <div><label>Email</label><input type="email" value={contactForm.contact_email} onChange={e => updateContactForm('contact_email', e.target.value)} /></div>
                    </div>
                    <div className="section-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={submitPropertyContact} disabled={savingContact}>
                        {savingContact ? 'Saving…' : 'Save contact'}
                      </button>
                    </div>
                  </div>
                )}

                {propertyContacts.length === 0 && <div className="empty-state">No contacts linked to this property yet.</div>}
                {propertyContacts.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <span><b>{c.name}</b> {c.role ? `— ${c.role}` : ''} {c.contact_phone ? `· ${formatPhone(c.contact_phone)}` : ''} {c.contact_email ? `· ${c.contact_email}` : ''}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removePropertyContact(c.id, c.name)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save property')}</button>
            </div>
              </form>
        </PopupModal>

        <div className="search-bar">
          <input placeholder="Search by property or management company…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="stage-tabs">
          <button className={`stage-tab ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>All ({properties.length})</button>
          {PROPERTY_TYPES.map(t => {
            const count = properties.filter(p => p.property_type === t).length;
            if (!count) return null;
            return <button key={t} className={`stage-tab ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t} ({count})</button>;
          })}
        </div>

        {filtered.length === 0 && <div className="empty-state">No properties yet.</div>}

        {filtered.length > 0 && (
          <DataTable
            getRowKey={p => p.id}
            onRowClick={startEdit}
            rows={filtered}
            columns={[
              { key: 'property_name', label: 'Property Name', defaultWidth: 220, render: p => <>{p.property_name}{!p.active && ' (inactive)'}</> },
              { key: 'property_type', label: 'Property Type', defaultWidth: 170, render: p => p.property_type || '—' },
              { key: 'property_city', label: 'City', defaultWidth: 130, render: p => p.property_city || '—' },
              { key: 'property_zip', label: 'ZIP', defaultWidth: 90, render: p => p.property_zip || '—' },
              { key: 'management_company', label: 'Management Company', defaultWidth: 180, render: p => p.management_company || '—' },
              {
                key: 'prospect_stage', label: 'Prospect Stage', defaultWidth: 140,
                filterValue: p => PROSPECT_STAGE_LABELS[p.prospect_stage] || '',
                render: p => PROSPECT_STAGE_LABELS[p.prospect_stage] || '—',
              },
              {
                key: 'last_visited_at', label: 'Last Visited', defaultWidth: 130, filterable: false,
                render: p => p.last_visited_at ? new Date(p.last_visited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
              },
              {
                key: 'actions', label: '', defaultWidth: 160, filterable: false, stopClickPropagation: true,
                render: p => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => markVisited(p.id)}>Mark Visited</button>
                    <button className="btn btn-sm btn-danger" onClick={() => removeProperty(p.id)}>Delete</button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
