'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields from '../../components/AddressFields';
import PlacesAutocompleteInput from '../../components/PlacesAutocompleteInput';
import DataTable from '../../components/DataTable';
import LogVisitPopover from '../../components/LogVisitPopover';
import PopupModal from '../../components/PopupModal';
import TouchTimeline from '../../components/TouchTimeline';
import AdminDeleteButton from '../../components/AdminDeleteButton';
import SendEmailButton from '../../components/SendEmailButton';
import AddColumnButton from '../../components/AddColumnButton';
import CustomFieldCell from '../../components/CustomFieldCell';
import MobileFab from '../../components/MobileFab';
import MobileOverflowMenu from '../../components/MobileOverflowMenu';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import { PROPERTY_TYPES, PROSPECT_STAGES, PROSPECT_STAGE_LABELS, formatPhone } from '../../lib/constants';
import { useCustomColumns, updateCustomFieldValue } from '../../lib/customColumns';
import { syncPropertyContact, linkOrCreateCompanyByName } from '../../lib/contactSync';
import { contactsAtProperty, searchPeople, linkContactToProperty, unlinkContactFromProperty } from '../../lib/contactProperties';
import { exportToSheet } from '../../lib/exportToSheet';
import { mapRow, splitDuplicates } from '../../lib/propertyImport';

const EMPTY_FORM = {
  property_name: '', property_type: '', prospect_stage: 'prospecting',
  property_street: '', property_unit: '', property_city: '', property_state: '', property_zip: '', property_lat: null, property_lng: null,
  management_company: '', contact_name: '', contact_phone: '', contact_email: '',
  year_built: '', sq_ft: '', target_value: '', active: true, notes: '',
  lost_reason: '', reengage_at: '', next_step_date: '', next_action_note: '',
  won_at: '', won_job_id: '', won_note: '', do_not_contact: false, dnc_source: null, is_test: false,
};

// A date column value or a timestamp, as the YYYY-MM-DD a date input wants (local time).
function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const EMPTY_CONTACT_FORM = { name: '', role: 'Property Contact', contact_phone: '', contact_email: '' };

function propertyExportColumns(customColumns) {
  return [
    { label: 'Property Name', value: p => p.property_name },
    { label: 'Property Type', value: p => p.property_type },
    { label: 'Prospect Stage', value: p => PROSPECT_STAGE_LABELS[p.prospect_stage] || '' },
    { label: 'Active', value: p => p.active !== false },
    { label: 'Street', value: p => p.property_street },
    { label: 'Unit', value: p => p.property_unit },
    { label: 'City', value: p => p.property_city },
    { label: 'State', value: p => p.property_state },
    { label: 'Zip', value: p => p.property_zip },
    { label: 'Management Company', value: p => p.management_company },
    { label: 'Contact Name', value: p => p.contact_name },
    { label: 'Phone', value: p => (p.contact_phone ? formatPhone(p.contact_phone) : '') },
    { label: 'Email', value: p => p.contact_email },
    { label: 'Year Built', value: p => p.year_built },
    { label: 'Sq Ft', value: p => p.sq_ft },
    { label: 'Target Value', value: p => p.target_value },
    { label: 'Last Visited', value: p => (p.last_visited_at ? new Date(p.last_visited_at).toLocaleDateString('en-US') : '') },
    { label: 'Last Contact', value: p => (p.last_contacted_at ? new Date(p.last_contacted_at).toLocaleDateString('en-US') : '') },
    { label: 'Next Step', value: p => (p.next_action_at ? `${new Date(p.next_action_at).toLocaleDateString('en-US')}${p.next_action_note ? `: ${p.next_action_note}` : ''}` : '') },
    { label: 'Lost Reason', value: p => p.lost_reason },
    { label: 'Notes', value: p => p.notes },
    ...customColumnsToExport(customColumns),
  ];
}

export default function PropertiesPage() {
  const { session, loading } = useRequireAuth();
  const [properties, setProperties] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showTest, setShowTest] = useState(false);
  const [propertyJobs, setPropertyJobs] = useState([]); // jobs at this property, for linking a win
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);

  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [savingContact, setSavingContact] = useState(false);
  const [contactNote, setContactNote] = useState('');
  const [propertyContacts, setPropertyContacts] = useState([]);
  const [linkingPerson, setLinkingPerson] = useState(false); // the "link someone already in People" picker
  const [personTerm, setPersonTerm] = useState('');
  const [personResults, setPersonResults] = useState([]);
  const { customColumns, addColumn } = useCustomColumns('properties');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

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
    // Everyone linked to this property, including people whose main property is a different one.
    setPropertyContacts(await contactsAtProperty(propertyId, { activeOnly: false }));
  }, []);

  // Jobs at the property being edited, so a win can point at the job it became.
  useEffect(() => {
    setPropertyJobs([]);
    if (!showForm || !editingId) return;
    let cancelled = false;
    supabase.from('jobs').select('id, project_number, customer_name, stage').eq('property_id', editingId)
      .then(({ data }) => { if (!cancelled && data) setPropertyJobs(data); });
    return () => { cancelled = true; };
  }, [showForm, editingId]);

  function update(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.property_name.trim()) return;
    if (form.prospect_stage === 'lost' && !String(form.lost_reason || '').trim()) {
      setSaveError('Add a short reason this prospect was lost, so it is useful when you try again.');
      return;
    }
    setSaveError('');
    setSaving(true);

    const companyId = await linkOrCreateCompanyByName(form.management_company, { defaultCompanyType: 'Management Company' });
    const payload = {
      ...form,
      target_value: form.target_value ? parseFloat(String(form.target_value).replace(/[^0-9.]/g, '')) : null,
      company_id: companyId,
      // The next step is typed as a date plus a note. The note only means something with a date.
      next_action_at: form.next_step_date ? new Date(`${form.next_step_date}T09:00:00`).toISOString() : null,
      next_action_note: form.next_step_date ? (String(form.next_action_note || '').trim() || null) : null,
      // The reason and the try again date only apply while the prospect is lost.
      lost_reason: form.prospect_stage === 'lost' ? String(form.lost_reason || '').trim() : null,
      reengage_at: form.prospect_stage === 'lost' && form.reengage_at ? form.reengage_at : null,
      // The win details only apply while the prospect is won. Leaving the date blank
      // lets the database use today.
      won_at: form.prospect_stage === 'won' && form.won_at ? form.won_at : null,
      won_job_id: form.prospect_stage === 'won' && form.won_job_id ? form.won_job_id : null,
      won_note: form.prospect_stage === 'won' ? (String(form.won_note || '').trim() || null) : null,
    };
    delete payload.next_step_date;
    // Where a do not contact flag came from is the database's to track. A flag inherited from
    // the company is changed on the company, so it is not sent back from here.
    delete payload.dnc_source;
    if (form.dnc_source === 'company') delete payload.do_not_contact;

    let propertyId = editingId;
    let mutationError;
    if (editingId) {
      ({ error: mutationError } = await supabase.from('properties').update(payload).eq('id', editingId));
    } else {
      const { data, error: insertError } = await supabase.from('properties').insert(payload).select().single();
      propertyId = data ? data.id : null;
      mutationError = insertError;
    }

    if (mutationError) {
      setSaving(false);
      setSaveError(mutationError.message);
      return;
    }

    // Same rule as Companies: a contact name here becomes a real, linked
    // Person in People, but only if it's a genuinely new name for this
    // property — an existing linked Person's own details are never
    // overwritten from this form. See lib/contactSync.js.
    if (propertyId) {
      await syncPropertyContact({
        propertyId,
        propertyName: form.property_name,
        managementCompany: form.management_company,
        name: form.contact_name,
        phone: form.contact_phone,
        email: form.contact_email,
      });
    }

    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowContactForm(false);
    setSaveError('');
    // Don't rely solely on the realtime subscription — refresh directly
    // so the change shows up immediately.
    await loadProperties();
  }

  // The Sales page follow up lists link here with ?open=<id> to open that prospect.
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || properties.length === 0) return;
    const id = new URLSearchParams(window.location.search).get('open');
    openedFromLink.current = true;
    if (!id) return;
    const found = properties.find(p => p.id === id);
    if (found) { startEdit(found); window.scrollTo({ top: 0 }); }
  }, [properties]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(p) {
    setForm({
      ...EMPTY_FORM, ...p,
      target_value: p.target_value ?? '', contact_phone: formatPhone(p.contact_phone),
      lost_reason: p.lost_reason || '', reengage_at: p.reengage_at || '',
      won_at: p.won_at || '', won_job_id: p.won_job_id || '', won_note: p.won_note || '',
      next_step_date: toDateInput(p.next_action_at), next_action_note: p.next_action_note || '',
    });
    setEditingId(p.id);
    setShowForm(true);
    loadPropertyContacts(p.id);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowContactForm(false);
    setLinkingPerson(false); setPersonTerm(''); setPersonResults([]);
    setPropertyContacts([]);
  }

  async function saveCustomField(property, key, value) {
    try {
      const nextFields = await updateCustomFieldValue('properties', property.id, property.custom_fields, key, value);
      setProperties(prev => prev.map(p => (p.id === property.id ? { ...p, custom_fields: nextFields } : p)));
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  async function markVisited(id, visitedAtIso) {
    const { error } = await supabase.from('properties').update({ last_visited_at: visitedAtIso }).eq('id', id);
    if (error) { setSaveError(error.message); return; }
    await loadProperties();
  }

  function updateContactForm(field, value) {
    if (field === 'contact_phone') value = formatPhone(value);
    setContactForm(prev => ({ ...prev, [field]: value }));
  }

  async function submitPropertyContact(e) {
    e.preventDefault();
    if (!contactForm.name.trim() || !editingId) return;
    setSavingContact(true);
    const { error: contactError } = await supabase.from('contacts').insert({
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

    if (contactError) {
      setSavingContact(false);
      setContactNote(String(contactError.message || '').startsWith('duplicate_email')
        ? 'Someone in People already has that email. Open them there instead of adding a second copy.'
        : 'Could not add the contact: ' + contactError.message);
      setTimeout(() => setContactNote(''), 6000);
      return;
    }

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
    if (!confirm(`Remove ${name} from this property? They'll stay in Contacts, just unlinked from here. Any other properties they are linked to are not changed.`)) return;
    const res = await unlinkContactFromProperty(contactId, editingId);
    if (!res.ok) {
      setContactNote(res.error);
      setTimeout(() => setContactNote(''), 6000);
      return;
    }
    loadPropertyContacts(editingId);
  }

  // Look up people as the user types in the "Link existing person" picker.
  useEffect(() => {
    if (!linkingPerson) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchPeople(personTerm, propertyContacts.map(c => c.id));
      if (!cancelled) setPersonResults(found);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [personTerm, linkingPerson, propertyContacts]);

  // Link someone who is already in People, so one person can sit under several properties.
  async function linkExistingPerson(person) {
    if (!editingId) return;
    const res = await linkContactToProperty(person.id, editingId);
    if (!res.ok) {
      setContactNote(res.error);
      setTimeout(() => setContactNote(''), 6000);
      return;
    }
    setLinkingPerson(false); setPersonTerm(''); setPersonResults([]);
    setContactNote(res.already ? `${person.name} is already linked here.` : `${person.name} linked to this property.`);
    setTimeout(() => setContactNote(''), 3000);
    loadPropertyContacts(editingId);
  }

  async function fetchAllPropertiesForDedupe() {
    const all = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('properties')
        .select('property_name, property_street, property_unit, property_city, property_zip')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return all;
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      const mapped = rows.map(mapRow).filter(p => p.property_name);
      if (mapped.length === 0) {
        setImportResult('No rows with a recognizable property name column were found.');
        return;
      }

      // Skip anything already in Properties, and repeats within the file itself.
      const existing = await fetchAllPropertiesForDedupe();
      const { fresh, duplicates } = splitDuplicates(existing, mapped);

      // Link each management company to Companies (created if new), once per name.
      const companyIds = new Map();
      for (const p of fresh) {
        const key = p.management_company.toLowerCase();
        if (!key) continue;
        if (!companyIds.has(key)) {
          companyIds.set(key, await linkOrCreateCompanyByName(p.management_company, { defaultCompanyType: 'Management Company' }));
        }
      }

      const payloads = fresh.map(p => {
        const { last_visited_at, ...rest } = p;
        const payload = { ...rest, company_id: companyIds.get(p.management_company.toLowerCase()) || null };
        if (last_visited_at) payload.last_visited_at = last_visited_at;
        return payload;
      });

      let inserted = [];
      for (let i = 0; i < payloads.length; i += 200) {
        const { data, error } = await supabase.from('properties').insert(payloads.slice(i, i + 200)).select('id, property_name, management_company, contact_name, contact_phone, contact_email');
        if (error) throw new Error(`${error.message} (${inserted.length} of ${payloads.length} were saved before this error; re-importing will skip them)`);
        inserted = inserted.concat(data || []);
      }

      // Contact details become real linked People, same as the Add property form.
      for (const p of inserted) {
        if (!p.contact_name) continue;
        await syncPropertyContact({
          propertyId: p.id,
          propertyName: p.property_name,
          managementCompany: p.management_company,
          name: p.contact_name,
          phone: p.contact_phone,
          email: p.contact_email,
        });
      }

      const skipped = duplicates.length;
      setImportResult(
        `Imported ${inserted.length} propert${inserted.length === 1 ? 'y' : 'ies'}.` +
        (skipped ? ` Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}.` : '')
      );
      await loadProperties();
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const testCount = properties.filter(p => p.is_test).length;
  const filtered = properties.filter(p => {
    if (p.is_test && !showTest) return false;
    if (typeFilter !== 'all' && p.property_type !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (p.property_name || '').toLowerCase().includes(q) || (p.management_company || '').toLowerCase().includes(q);
  });

  function exportProperties() {
    exportToSheet({ fileName: 'properties', sheetName: 'Properties', columns: propertyExportColumns(customColumns), rows: filtered });
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Property Database</h2>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 10 }}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
              <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                {importing ? 'Importing…' : '↑ Import from Excel'}
              </button>
              <AddColumnButton addColumn={addColumn} />
              <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
                {showForm ? 'Cancel' : '+ Add property'}
              </button>
            </div>
          )}
          {isMobile && (
            <MobileOverflowMenu>
              <button className="btn btn-sm" onClick={exportProperties}>↓ Export to Excel</button>
              <AddColumnButton addColumn={addColumn} />
            </MobileOverflowMenu>
          )}
        </div>

        {isMobile && (
          <MobileFab
            label="Add property"
            items={[{ label: '+ Add property', primary: true, onClick: () => setShowForm(true) }]}
          />
        )}

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
                    update('property_lat', place.lat ?? null);
                    update('property_lng', place.lng ?? null);
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

            <div className="two-col" style={{ marginTop: 12 }}>
              <div>
                <label>Next step date</label>
                <input type="date" value={form.next_step_date} onChange={e => update('next_step_date', e.target.value)} />
              </div>
              <div>
                <label>Next step</label>
                <input value={form.next_action_note} onChange={e => update('next_action_note', e.target.value)} maxLength={300} placeholder="Call back about the roof estimate" disabled={!form.next_step_date} />
              </div>
              {form.prospect_stage === 'won' && (
                <>
                  <div>
                    <label>Won on</label>
                    <input type="date" value={form.won_at} onChange={e => update('won_at', e.target.value)} />
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>Leave blank to use today.</div>
                  </div>
                  <div>
                    <label>Job it became (optional)</label>
                    <select value={form.won_job_id} onChange={e => update('won_job_id', e.target.value)} disabled={!editingId}>
                      <option value="">{editingId ? (propertyJobs.length ? 'None linked' : 'No jobs at this property yet') : 'Save first, then link a job'}</option>
                      {propertyJobs.map(j => <option key={j.id} value={j.id}>{[j.project_number, j.customer_name].filter(Boolean).join(' · ') || 'Job'}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label>What was agreed</label>
                    <input value={form.won_note} onChange={e => update('won_note', e.target.value)} maxLength={300} placeholder="Signed the lobby remodel proposal" />
                  </div>
                </>
              )}
              {form.prospect_stage === 'lost' && (
                <>
                  <div>
                    <label>Why was it lost</label>
                    <input value={form.lost_reason} onChange={e => update('lost_reason', e.target.value)} maxLength={300} placeholder="Chose another contractor, no budget this year" />
                  </div>
                  <div>
                    <label>Try again on (optional)</label>
                    <input type="date" value={form.reengage_at} onChange={e => update('reengage_at', e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {editingId && form.last_contacted_at && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
                Last contact {shortDate(form.last_contacted_at)}. This comes from the touches below and updates by itself.
              </div>
            )}

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

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontWeight: 600 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(form.do_not_contact)} disabled={form.dnc_source === 'company'} onChange={e => update('do_not_contact', e.target.checked)} />
              Do not contact this property
            </label>
            {form.dnc_source === 'company' && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>This comes from the company being marked do not contact. Change it on the company.</div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 400, fontSize: 13 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={Boolean(form.is_test)} onChange={e => update('is_test', e.target.checked)} />
              Test record (hidden from lists, routes and the bot)
            </label>

            {editingId && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div className="top-actions" style={{ marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)' }}>Property Contacts &amp; Influencers</h4>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => { setLinkingPerson(l => !l); setPersonTerm(''); setPersonResults([]); }}>
                      {linkingPerson ? 'Cancel' : '+ Link existing person'}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setShowContactForm(s => !s)}>
                      {showContactForm ? 'Cancel' : '+ Add Contact / Influencer'}
                    </button>
                  </div>
                </div>

                {linkingPerson && (
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 14 }}>
                    <label style={{ marginTop: 0 }}>Find someone already in People</label>
                    <input autoFocus value={personTerm} onChange={e => setPersonTerm(e.target.value)} placeholder="Name or email" />
                    {personTerm.trim().length >= 2 && personResults.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>No one else matches.</div>
                    )}
                    {personResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => linkExistingPerson(c)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px 4px', borderBottom: '1px solid var(--line)' }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[c.position, c.management_company, c.contact_email].filter(Boolean).join(' · ')}</div>
                      </button>
                    ))}
                  </div>
                )}

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
                    <span style={c.is_active === false ? { opacity: 0.6 } : undefined}><b>{c.name}</b>{c.is_active === false ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-soft)' }}>Inactive</span> : null} {c.role ? `— ${c.role}` : ''} {c.contact_phone ? `· ${formatPhone(c.contact_phone)}` : ''} {c.contact_email ? `· ${c.contact_email}` : ''}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removePropertyContact(c.id, c.name)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save property')}</button>
              {editingId && (
                <AdminDeleteButton
                  kind="property"
                  recordId={editingId}
                  name={form.property_name}
                  onDeleted={() => { cancelForm(); loadProperties(); }}
                />
              )}
            </div>
              </form>
            {editingId && form.contact_email && (
              <div style={{ margin: '12px 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <SendEmailButton
                  to={form.contact_email}
                  name={form.contact_name}
                  company={form.management_company}
                  property={form.property_name}
                  label="Email property contact"
                />
              </div>
            )}
            {editingId && <TouchTimeline kind="property" recordId={editingId} />}
        </PopupModal>

        <div className="search-bar">
          <input placeholder="Search by property or management company…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {testCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 400, margin: '0 0 8px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={showTest} onChange={e => setShowTest(e.target.checked)} />
            Show test records ({testCount})
          </label>
        )}

        <ScrollFadeRow trackClassName="stage-tabs">
          <button className={`stage-tab ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>All ({properties.length})</button>
          {PROPERTY_TYPES.map(t => {
            const count = properties.filter(p => p.property_type === t).length;
            if (!count) return null;
            return <button key={t} className={`stage-tab ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t} ({count})</button>;
          })}
        </ScrollFadeRow>

        {filtered.length === 0 && <div className="empty-state">No properties yet.</div>}

        {filtered.length > 0 && isMobile && (
          <div className="entity-mobile-list">
            {filtered.map(p => (
              <button key={p.id} className="entity-mobile-row" onClick={() => startEdit(p)}>
                <span className="entity-mobile-row-text">
                  <span className="entity-mobile-row-title">{p.property_name}</span>
                  <span className="entity-mobile-row-sub">
                    {[p.management_company, p.property_city].filter(Boolean).join(' · ') || p.property_type || 'No details on file'}
                  </span>
                </span>
                {!p.active && <span className="entity-mobile-row-tag">Inactive</span>}
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && !isMobile && (
          <DataTable
            getRowKey={p => p.id}
            onRowClick={startEdit}
            rows={filtered}
            exportFileName="properties"
            exportSheetName="Properties"
            exportColumns={propertyExportColumns(customColumns)}
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
                key: 'last_contacted_at', label: 'Last Contact', defaultWidth: 130, filterable: false,
                render: p => p.last_contacted_at ? shortDate(p.last_contacted_at) : 'Never',
              },
              {
                key: 'next_action_at', label: 'Next Step', defaultWidth: 220, filterable: false,
                render: p => {
                  if (!p.next_action_at) return 'None';
                  const overdue = new Date(p.next_action_at).getTime() < Date.now() && !['won', 'lost'].includes(p.prospect_stage);
                  return <span style={overdue ? { color: '#a13f3f', fontWeight: 600 } : undefined}>{shortDate(p.next_action_at)}{p.next_action_note ? `: ${p.next_action_note}` : ''}</span>;
                },
              },
              {
                key: 'last_visited_at', label: 'Last Visited', defaultWidth: 130, filterable: false,
                render: p => p.last_visited_at ? new Date(p.last_visited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
              },
              ...customColumns.map(col => ({
                key: `custom:${col.column_key}`,
                label: col.label,
                defaultWidth: 150,
                stopClickPropagation: true,
                filterValue: p => p.custom_fields?.[col.column_key] ?? '',
                sortValue: p => p.custom_fields?.[col.column_key] ?? '',
                render: p => (
                  <CustomFieldCell
                    column={col}
                    value={p.custom_fields?.[col.column_key]}
                    onSave={value => saveCustomField(p, col.column_key, value)}
                  />
                ),
              })),
              {
                key: 'actions', label: '', defaultWidth: 160, filterable: false, sortable: false, stopClickPropagation: true, sticky: true,
                render: p => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <LogVisitPopover onLog={iso => markVisited(p.id, iso)} />
                    <AdminDeleteButton kind="property" recordId={p.id} name={p.property_name} onDeleted={loadProperties} />
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
