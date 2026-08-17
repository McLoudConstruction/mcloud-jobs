'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import AddressFields, { formatAddress } from '../../../components/AddressFields';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL } from '../../../lib/constants';

const EMPTY_FORM = {
  job_number: '',
  contract_price: '',
  job_type: '',
  expected_close_date: '',
  project_type: '', // 'residential' | 'commercial'
  customer_name: '',
  customer_contact: '',
  customer_email: '',
  customer_phone: '',
  billing_email: '',
  billing_street: '', billing_unit: '', billing_city: '', billing_state: '', billing_zip: '',
  project_street: '', project_unit: '', project_city: '', project_state: '', project_zip: '',
  description: '',
};

export default function NewJobPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();

  const [form, setForm] = useState(EMPTY_FORM);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [scopeItems, setScopeItems] = useState([]);
  const [termItems, setTermItems] = useState([]);
  const [termsTouched, setTermsTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimer = useRef(null);

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (sameAsBilling && field.startsWith('billing_') && field !== 'billing_email') {
        const projectField = field.replace('billing_', 'project_');
        next[projectField] = value;
      }
      return next;
    });
  }

  function toggleSameAsBilling(checked) {
    setSameAsBilling(checked);
    if (checked) {
      setForm(prev => ({
        ...prev,
        project_street: prev.billing_street,
        project_unit: prev.billing_unit,
        project_city: prev.billing_city,
        project_state: prev.billing_state,
        project_zip: prev.billing_zip,
      }));
    }
  }

  // ---- Customer name autofill suggestions ----
  function handleNameChange(value) {
    update('customer_name', value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*').ilike('name', `%${value.trim()}%`).limit(5);
      setSuggestions(data || []);
      setShowSuggestions((data || []).length > 0);
    }, 250);
  }

  function applySuggestion(contact) {
    setForm(prev => ({
      ...prev,
      customer_name: contact.name || prev.customer_name,
      customer_contact: prev.customer_contact,
      customer_email: contact.contact_email || prev.customer_email,
      customer_phone: contact.contact_phone || prev.customer_phone,
      billing_email: contact.billing_email || prev.billing_email,
      billing_street: contact.billing_street || prev.billing_street,
      billing_unit: contact.billing_unit || prev.billing_unit,
      billing_city: contact.billing_city || prev.billing_city,
      billing_state: contact.billing_state || prev.billing_state,
      billing_zip: contact.billing_zip || prev.billing_zip,
      // The contact only has one address on file, so use it for the
      // project address too — same-as-billing below reflects this and
      // stays fully editable if the job site is actually somewhere else.
      project_street: contact.billing_street || prev.project_street,
      project_unit: contact.billing_unit || prev.project_unit,
      project_city: contact.billing_city || prev.project_city,
      project_state: contact.billing_state || prev.project_state,
      project_zip: contact.billing_zip || prev.project_zip,
    }));
    if (contact.billing_street) setSameAsBilling(true);
    setShowSuggestions(false);
  }

  function addScopeItem() { setScopeItems(prev => [...prev, '']); }
  function updateScopeItem(i, value) { setScopeItems(prev => prev.map((t, idx) => idx === i ? value : t)); }
  function removeScopeItem(i) { setScopeItems(prev => prev.filter((_, idx) => idx !== i)); }

  function addTerm() { setTermsTouched(true); setTermItems(prev => [...prev, '']); }
  function updateTerm(i, value) { setTermsTouched(true); setTermItems(prev => prev.map((t, idx) => idx === i ? value : t)); }
  function removeTerm(i) { setTermsTouched(true); setTermItems(prev => prev.filter((_, idx) => idx !== i)); }
  function standardListFor(type) { return type === 'commercial' ? STANDARD_ASSUMPTIONS_COMMERCIAL : STANDARD_ASSUMPTIONS_RESIDENTIAL; }
  function restoreStandardTerms() {
    const standard = standardListFor(form.project_type);
    setTermsTouched(true);
    setTermItems(prev => {
      const existingSet = new Set(prev.map(t => t.trim()));
      const toAdd = standard.filter(t => !existingSet.has(t.trim()));
      return [...prev, ...toAdd];
    });
  }

  useEffect(() => {
    if (form.project_type && !termsTouched && termItems.length === 0) {
      setTermItems([...standardListFor(form.project_type)]);
    }
  }, [form.project_type]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    if (!form.job_number.trim()) return 'Job number is required.';
    if (!form.project_type) return 'Please select Residential or Commercial.';
    if (!form.customer_email.trim()) return 'Contact email is required.';
    if (!form.customer_phone.trim()) return 'Contact phone is required.';
    if (!form.project_street.trim() || !form.project_city.trim()) return 'Project/jobsite address is required.';

    if (form.project_type === 'commercial') {
      if (!form.customer_name.trim()) return 'Customer/Company name is required.';
      if (!form.customer_contact.trim()) return 'Contact person is required.';
      if (!form.billing_email.trim()) return 'Billing email is required.';
      if (!form.billing_street.trim() || !form.billing_city.trim()) return 'Billing address is required.';
    } else {
      if (!form.customer_name.trim()) return 'Customer name is required.';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setSaving(true);

    const payload = {
      ...form,
      contract_price: form.contract_price ? parseFloat(form.contract_price.replace(/[^0-9.]/g, '')) : null,
      scope_items: scopeItems.filter(t => t.trim()).map(text => ({ text })),
      additional_terms: termItems.filter(t => t.trim()).map(text => ({ text })),
      expected_close_date: form.expected_close_date || null,
      billing_address: formatAddress(form, 'billing'),
      project_address: formatAddress(form, 'project'),
      stage: 'proposal',
    };

    const { data, error: insertError } = await supabase.from('jobs').insert(payload).select().single();
    setSaving(false);

    if (insertError) {
      setError(insertError.message.includes('duplicate') ? 'That job number is already in use.' : insertError.message);
      return;
    }
    router.push(`/jobs/${data.id}`);
  }

  if (loading || !session) return null;

  const isCommercial = form.project_type === 'commercial';
  const isResidential = form.project_type === 'residential';

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ color: 'var(--heading)' }}>New job — Proposal stage</h2>

        <form onSubmit={handleSubmit}>
          <div className="card">
            <h3>Job info</h3>
            <div className="two-col">
              <div>
                <label>Job number *</label>
                <input value={form.job_number} onChange={e => update('job_number', e.target.value)} placeholder="e.g. 2026-014" required />
              </div>
              <div>
                <label>Estimated contract price ($)</label>
                <input value={form.contract_price} onChange={e => update('contract_price', e.target.value)} placeholder="e.g. 42,500" />
              </div>
              <div>
                <label>Job type</label>
                <input value={form.job_type} onChange={e => update('job_type', e.target.value)} placeholder="e.g. Kitchen remodel" />
              </div>
              <div>
                <label>Expected close date</label>
                <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Customer</h3>

            <label>Project type *</label>
            <select value={form.project_type} onChange={e => update('project_type', e.target.value)} required>
              <option value="">Select…</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>

            {form.project_type && (
              <>
                <div style={{ position: 'relative', marginTop: 12 }}>
                  <label>{isCommercial ? 'Customer / Company name *' : 'Customer name *'}</label>
                  <input
                    value={form.customer_name}
                    onChange={e => handleNameChange(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    autoComplete="off"
                  />
                  {showSuggestions && (
                    <div style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                      {suggestions.map(s => (
                        <div
                          key={s.id}
                          onMouseDown={() => applySuggestion(s)}
                          style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
                        >
                          <b>{s.name}</b>{s.management_company ? ` — ${s.management_company}` : ''}
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                            {[s.contact_email, s.contact_phone].filter(Boolean).join(' · ') || 'Click to autofill contact & billing info'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="two-col" style={{ marginTop: 12 }}>
                  <div>
                    <label>Contact person {isCommercial ? '*' : '(optional)'}</label>
                    <input value={form.customer_contact} onChange={e => update('customer_contact', e.target.value)} required={isCommercial} />
                  </div>
                  <div>
                    <label>Contact email *</label>
                    <input type="email" value={form.customer_email} onChange={e => update('customer_email', e.target.value)} required />
                  </div>
                  <div>
                    <label>Contact phone *</label>
                    <input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} required />
                  </div>
                  {isCommercial && (
                    <div>
                      <label>Billing email *</label>
                      <input type="email" value={form.billing_email} onChange={e => update('billing_email', e.target.value)} required />
                    </div>
                  )}
                </div>

                <label style={{ marginTop: 16 }}>Billing address {isCommercial ? '*' : ''}</label>
                <AddressFields prefix="billing" values={form} onChange={update} required={isCommercial} />

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
                  Project address same as billing address
                </label>
                <label>Project / jobsite address *</label>
                <AddressFields prefix="project" values={form} onChange={update} required={!sameAsBilling} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Project description</h3>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="Short summary of the job…" />
          </div>

          <div className="card">
            <h3>Scope of work</h3>
            {scopeItems.map((text, i) => (
              <div className="list-row" key={i}>
                <textarea value={text} onChange={e => updateScopeItem(i, e.target.value)} placeholder="e.g. Remove and haul away existing cabinetry" />
                <button type="button" className="row-remove" onClick={() => removeScopeItem(i)}>×</button>
              </div>
            ))}
            <div className="section-actions">
              <button type="button" className="btn btn-sm" onClick={addScopeItem}>+ Add scope item</button>
            </div>
          </div>

          <div className="card">
            <h3>Project Assumptions &amp; Exclusions</h3>
            {termItems.map((text, i) => (
              <div className="list-row" key={i}>
                <textarea value={text} onChange={e => updateTerm(i, e.target.value)} />
                <button type="button" className="row-remove" onClick={() => removeTerm(i)}>×</button>
              </div>
            ))}
            <div className="section-actions">
              <button type="button" className="btn btn-sm" onClick={addTerm}>+ Add item</button>
              <button type="button" className="btn btn-sm" onClick={restoreStandardTerms}>↺ Restore standard list</button>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
