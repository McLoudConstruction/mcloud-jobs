'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import AddressFields, { formatAddress } from '../../components/AddressFields';
import { PROPERTY_TYPES } from '../../lib/constants';

const EMPTY_FORM = {
  property_name: '', property_type: '',
  property_street: '', property_unit: '', property_city: '', property_state: '', property_zip: '',
  management_company: '', contact_name: '', contact_phone: '', contact_email: '',
  year_built: '', sq_ft: '', target_value: '', active: true, notes: '',
};

function fmtMoney(v) {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US');
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

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  async function submit(e) {
    e.preventDefault();
    if (!form.property_name.trim()) return;
    setSaving(true);
    const payload = { ...form, target_value: form.target_value ? parseFloat(String(form.target_value).replace(/[^0-9.]/g, '')) : null };
    if (editingId) {
      await supabase.from('properties').update(payload).eq('id', editingId);
    } else {
      await supabase.from('properties').insert(payload);
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(p) {
    setForm({ ...EMPTY_FORM, ...p, target_value: p.target_value ?? '' });
    setEditingId(p.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  async function removeProperty(id) {
    if (!confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', id);
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
          <button className="btn btn-primary" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
            {showForm ? 'Cancel' : '+ Add property'}
          </button>
        </div>

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>{editingId ? 'Edit property' : 'New property'}</h3>
            <div className="two-col">
              <div><label>Property name *</label><input value={form.property_name} onChange={e => update('property_name', e.target.value)} required /></div>
              <div>
                <label>Property type</label>
                <select value={form.property_type} onChange={e => update('property_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Address</label>
            <AddressFields prefix="property" values={form} onChange={update} />

            <div className="two-col" style={{ marginTop: 12 }}>
              <div><label>Management company</label><input value={form.management_company} onChange={e => update('management_company', e.target.value)} /></div>
              <div><label>Contact name</label><input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} /></div>
              <div><label>Contact phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} /></div>
              <div><label>Contact email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
              <div><label>Year built</label><input value={form.year_built} onChange={e => update('year_built', e.target.value)} /></div>
              <div><label>Square footage</label><input value={form.sq_ft} onChange={e => update('sq_ft', e.target.value)} /></div>
              <div><label>Target project value ($)</label><input value={form.target_value} onChange={e => update('target_value', e.target.value)} /></div>
              <div>
                <label>Active prospect</label>
                <select value={form.active ? 'yes' : 'no'} onChange={e => update('active', e.target.value === 'yes')}>
                  <option value="yes">Active</option>
                  <option value="no">Inactive</option>
                </select>
              </div>
            </div>
            <label style={{ marginTop: 12 }}>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />

            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save property')}</button>
            </div>
          </form>
        )}

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
        {filtered.map(p => (
          <div className="contact-card" key={p.id}>
            <div>
              <div className="contact-name">{p.property_name} {!p.active && <span style={{ fontSize: 10, color: 'var(--ink-soft)', fontWeight: 400 }}>(inactive)</span>}</div>
              {p.property_type && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--gold)', margin: '2px 0 4px' }}>{p.property_type}</div>}
              <div className="contact-meta">
                {formatAddress(p, 'property') && <>{formatAddress(p, 'property')}<br /></>}
                {p.management_company && <>{p.management_company}<br /></>}
                {p.contact_name && <>{p.contact_name}{p.contact_phone ? ' · ' + p.contact_phone : ''}<br /></>}
                {p.target_value && <>Target value: {fmtMoney(p.target_value)}</>}
              </div>
            </div>
            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => removeProperty(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
