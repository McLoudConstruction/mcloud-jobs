'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';

const COMPANY_TYPES = ['Management Company', 'Ownership Group', 'REIT', 'Developer', 'Other'];

const EMPTY_FORM = {
  company_name: '', company_type: '',
  street: '', unit: '', city: '', state: '', zip: '',
  contact_name: '', contact_phone: '', contact_email: '', notes: '',
};

const HEADER_MAP = {
  company_name: ['company', 'company name', 'name', 'organization'],
  company_type: ['type', 'company type', 'category'],
  contact_name: ['contact', 'contact name'],
  contact_phone: ['phone', 'contact phone', 'phone number'],
  contact_email: ['email', 'contact email'],
  street: ['street', 'address', 'street address'],
  unit: ['unit', 'suite'],
  city: ['city'],
  state: ['state'],
  zip: ['zip', 'zip code', 'postal code'],
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

export default function CompaniesPage() {
  const { session, loading } = useRequireAuth();
  const [companies, setCompanies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef(null);

  const loadCompanies = useCallback(async () => {
    const { data } = await supabase.from('companies').select('*').order('company_name', { ascending: true });
    if (data) setCompanies(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadCompanies();
    const channel = supabase.channel('companies').on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, loadCompanies).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadCompanies]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) return;
    setSaving(true);
    if (editingId) {
      await supabase.from('companies').update(form).eq('id', editingId);
    } else {
      await supabase.from('companies').insert(form);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(c) {
    setForm({ ...EMPTY_FORM, ...c });
    setEditingId(c.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  async function removeCompany(id) {
    if (!confirm('Delete this company?')) return;
    await supabase.from('companies').delete().eq('id', id);
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
      const mapped = rows.map(mapRow).filter(c => c.company_name && c.company_name.trim());
      if (mapped.length === 0) {
        setImportResult('No rows with a recognizable company name column were found.');
        return;
      }
      const { error } = await supabase.from('companies').insert(mapped);
      if (error) throw error;
      setImportResult(`Imported ${mapped.length} compan${mapped.length === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      setImportResult(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const filtered = companies.filter(c => {
    if (!search.trim()) return true;
    return (c.company_name || '').toLowerCase().includes(search.toLowerCase());
  });

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Companies</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: 'none' }} />
            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '↑ Import from Excel'}
            </button>
            <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
              {showForm ? 'Cancel' : '+ Add company'}
            </button>
          </div>
        </div>

        {importResult && (
          <div className="card" style={{ fontSize: 13, color: importResult.startsWith('Import failed') ? '#a13f3f' : '#3a6b45' }}>
            {importResult}
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              Recognized columns: Company Name, Type, Contact Name/Phone/Email, Street/Unit/City/State/Zip, Notes.
            </div>
          </div>
        )}

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>{editingId ? 'Edit company' : 'New company'}</h3>
            <div className="two-col">
              <div><label>Company name *</label><input value={form.company_name} onChange={e => update('company_name', e.target.value)} required /></div>
              <div>
                <label>Type</label>
                <select value={form.company_type} onChange={e => update('company_type', e.target.value)}>
                  <option value="">Select…</option>
                  {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <label style={{ marginTop: 12 }}>Address</label>
            <AddressFields prefix="" values={form} onChange={update} />
            <div className="two-col" style={{ marginTop: 12 }}>
              <div><label>Contact name</label><input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} /></div>
              <div><label>Contact phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} /></div>
              <div><label>Contact email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
            </div>
            <label style={{ marginTop: 12 }}>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save company')}</button>
            </div>
          </form>
        )}

        <div className="search-bar">
          <input placeholder="Search by company name…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 && <div className="empty-state">No companies yet.</div>}
        {filtered.map(c => (
          <div className="contact-card" key={c.id}>
            <div>
              <div className="contact-name">{c.company_name}</div>
              {c.company_type && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', margin: '2px 0 4px' }}>{c.company_type}</div>}
              <div className="contact-meta">
                {formatAddress(c, '') && <>{formatAddress(c, '')}<br /></>}
                {c.contact_name && <>{c.contact_name}{c.contact_phone ? ' · ' + c.contact_phone : ''}<br /></>}
                {c.contact_email && <>{c.contact_email}</>}
              </div>
            </div>
            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={() => startEdit(c)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => removeCompany(c.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
