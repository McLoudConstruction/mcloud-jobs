'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import AddressFields, { formatAddress } from '../../../components/AddressFields';
import AIScopeGenerator from '../../../components/AIScopeGenerator';
import { STANDARD_ASSUMPTIONS_RESIDENTIAL, STANDARD_ASSUMPTIONS_COMMERCIAL, formatPhone, nextSequentialNumber } from '../../../lib/constants';

const EMPTY_FORM = {
  estimate_number: '',
  contract_price: '',
  job_type: '',
  expected_close_date: '',
  project_type: '', // 'residential' | 'commercial'
  company: '',
  first_name: '',
  last_name: '',
  customer_name: '',
  customer_contact: '',
  customer_email: '',
  customer_phone: '',
  billing_email: '',
  billing_street: '', billing_unit: '', billing_city: '', billing_state: '', billing_zip: '',
  project_street: '', project_unit: '', project_city: '', project_state: '', project_zip: '',
  description: '',
};

function NewJobPageInner() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oppId = searchParams.get('opp');
  const [sourceOpp, setSourceOpp] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    async function loadNextEstimateNumber() {
      const { data } = await supabase.from('jobs').select('estimate_number').not('estimate_number', 'is', null).order('created_at', { ascending: false }).limit(1);
      const last = data && data[0] && data[0].estimate_number;
      setForm(prev => (prev.estimate_number ? prev : { ...prev, estimate_number: nextSequentialNumber(last, `EST-${new Date().getFullYear()}-001`) }));
    }
    loadNextEstimateNumber();
  }, []);

  useEffect(() => {
    if (!oppId) return;
    supabase.from('opportunities').select('*').eq('id', oppId).single().then(({ data }) => {
      if (!data) return;
      setSourceOpp(data);
      const [first, ...rest] = (data.contact_name || '').trim().split(' ');
      setForm(prev => ({
        ...prev,
        first_name: first || prev.first_name,
        last_name: rest.join(' ') || prev.last_name,
        company: data.company || prev.company,
        customer_email: data.contact_email || prev.customer_email,
        customer_phone: data.contact_phone || prev.customer_phone,
        description: [data.project, data.notes].filter(Boolean).join(' — ') || prev.description,
      }));
    });
  }, [oppId]);
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
  function handleNameChange(field, value) {
    update(field, value);
    setSelectedContactId(null);
    const term = field === 'first_name' ? value : form.first_name;
    const termLast = field === 'last_name' ? value : form.last_name;
    const combined = `${term} ${termLast}`.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!combined.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*').ilike('name', `%${combined.trim()}%`).limit(5);
      setSuggestions(data || []);
      setShowSuggestions((data || []).length > 0);
    }, 250);
  }

  const [autofillNote, setAutofillNote] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(null);

  function applySuggestion(contact) {
    setSelectedContactId(contact.id);
    setForm(prev => ({
      ...prev,
      first_name: contact.first_name || prev.first_name,
      last_name: contact.last_name || prev.last_name,
      company: contact.management_company || prev.company,
      customer_name: contact.name || prev.customer_name,
      customer_contact: prev.customer_contact,
      customer_email: contact.contact_email || prev.customer_email,
      customer_phone: contact.contact_phone || prev.customer_phone,
      billing_email: contact.billing_email || prev.billing_email,
      billing_street: contact.billing_street || contact.address_street || prev.billing_street,
      billing_unit: contact.billing_unit || contact.address_unit || prev.billing_unit,
      billing_city: contact.billing_city || contact.address_city || prev.billing_city,
      billing_state: contact.billing_state || contact.address_state || prev.billing_state,
      billing_zip: contact.billing_zip || contact.address_zip || prev.billing_zip,
      // Prefer the contact's actual property/mailing address for the
      // project address; fall back to their billing address if that's
      // all that's on file (e.g. a homeowner contact only has one address).
      project_street: contact.address_street || contact.billing_street || prev.project_street,
      project_unit: contact.address_unit || contact.billing_unit || prev.project_unit,
      project_city: contact.address_city || contact.billing_city || prev.project_city,
      project_state: contact.address_state || contact.billing_state || prev.project_state,
      project_zip: contact.address_zip || contact.billing_zip || prev.project_zip,
    }));
    if (contact.billing_street || contact.address_street) setSameAsBilling(true);
    setShowSuggestions(false);

    const filled = [];
    if (contact.contact_email) filled.push('email');
    if (contact.contact_phone) filled.push('phone');
    if (contact.billing_street || contact.address_street) filled.push('address'); else filled.push('no address on file for this contact');
    setAutofillNote(`Filled from ${contact.name}: ${filled.join(', ')}.`);
    setTimeout(() => setAutofillNote(''), 6000);
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
    if (!form.project_type) return 'Please select Residential or Commercial.';
    if (!form.first_name.trim() || !form.last_name.trim()) return 'First and last name are required.';
    if (!form.customer_email.trim()) return 'Contact email is required.';
    if (!form.customer_phone.trim()) return 'Contact phone is required.';

    if (form.project_type === 'commercial') {
      if (!form.company.trim()) return 'Company name is required for commercial opportunities.';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setSaving(true);

    const fullName = `${form.first_name.trim()} ${form.last_name.trim()}`.trim();
    const payload = {
      ...form,
      // customer_name stays the single "who this is" field used everywhere
      // downstream (documents, portal, messages) — company for commercial,
      // the person's name for residential. customer_contact is always the
      // actual person, useful even when a company is billed.
      customer_name: isCommercial ? form.company.trim() : fullName,
      customer_contact: fullName,
      job_number: null,
      contract_price: form.contract_price ? parseFloat(form.contract_price.replace(/[^0-9.]/g, '')) : null,
      scope_items: scopeItems.filter(t => t.trim()).map(text => ({ text })),
      additional_terms: termItems.filter(t => t.trim()).map(text => ({ text })),
      expected_close_date: form.expected_close_date || null,
      billing_address: formatAddress(form, 'billing'),
      project_address: formatAddress(form, 'project'),
      stage: 'new',
    };
    delete payload.company;
    delete payload.first_name;
    delete payload.last_name;

    const { data, error: insertError } = await supabase.from('jobs').insert(payload).select().single();

    if (!insertError && !selectedContactId) {
      // No existing contact was picked from suggestions, so this is a brand
      // new customer — log them as a contact now rather than letting their
      // info live only on this one job with no record in the CRM.
      await supabase.from('contacts').insert({
        name: payload.customer_name || fullName,
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        management_company: isCommercial ? form.company.trim() || null : null,
        contact_email: form.customer_email || null,
        contact_phone: form.customer_phone || null,
        billing_email: form.billing_email || null,
        billing_street: form.billing_street || null,
        billing_unit: form.billing_unit || null,
        billing_city: form.billing_city || null,
        billing_state: form.billing_state || null,
        billing_zip: form.billing_zip || null,
        address_street: form.project_street || null,
        address_unit: form.project_unit || null,
        address_city: form.project_city || null,
        address_state: form.project_state || null,
        address_zip: form.project_zip || null,
        contact_type: isCommercial ? 'Commercial' : 'Residential',
      });
    }

    setSaving(false);

    if (insertError) {
      setError(insertError.message.includes('duplicate') ? 'That estimate number is already in use — refresh and try again.' : insertError.message);
      return;
    }

    if (oppId && data) {
      await supabase.from('opportunities').update({ stage: 'converted', job_id: data.id }).eq('id', oppId);
    }
    router.push(`/jobs/${data.id}`);
  }

  if (loading || !session) return null;

  const isCommercial = form.project_type === 'commercial';
  const isResidential = form.project_type === 'residential';

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ color: 'var(--heading)' }}>New Opportunity</h2>
        {sourceOpp && (
          <div className="card" style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '12px 16px' }}>
            Starting from opportunity: <b>{sourceOpp.company || sourceOpp.contact_name || 'Unnamed'}</b> — its details are prefilled below. Marking this job created will mark that opportunity Converted.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="card">
            <h3>Estimate info</h3>
            <div className="two-col">
              <div>
                <label>Estimate number</label>
                <input value={form.estimate_number} disabled style={{ opacity: 0.7 }} />
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Assigned automatically. This becomes a real Job number once the opportunity is Approved.
                </div>
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
              <div>
                <label>Date entered</label>
                <input value={new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} disabled style={{ opacity: 0.7 }} />
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
                {isCommercial && (
                  <div style={{ marginTop: 12 }}>
                    <label>Company *</label>
                    <input value={form.company} onChange={e => update('company', e.target.value)} required />
                  </div>
                )}

                <div className="two-col" style={{ marginTop: 12, position: 'relative' }}>
                  <div>
                    <label>First name *</label>
                    <input
                      value={form.first_name}
                      onChange={e => handleNameChange('first_name', e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      autoComplete="off"
                      required
                    />
                  </div>
                  <div>
                    <label>Last name *</label>
                    <input
                      value={form.last_name}
                      onChange={e => handleNameChange('last_name', e.target.value)}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      autoComplete="off"
                      required
                    />
                  </div>
                  {showSuggestions && (
                    <div style={{ position: 'absolute', top: '100%', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                      {suggestions.map(s => (
                        <div
                          key={s.id}
                          onMouseDown={() => applySuggestion(s)}
                          style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
                        >
                          <b>{s.name}</b>{s.management_company ? ` — ${s.management_company}` : ''}
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                            {[s.contact_email, s.contact_phone ? formatPhone(s.contact_phone) : null].filter(Boolean).join(' · ') || 'Click to autofill contact & billing info'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {autofillNote && <div style={{ fontSize: 11.5, color: '#3a6b45', marginTop: 6 }}>{autofillNote}</div>}

                <div className="two-col" style={{ marginTop: 12 }}>
                  <div>
                    <label>Contact phone *</label>
                    <input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} required />
                  </div>
                  <div>
                    <label>Contact email *</label>
                    <input type="email" value={form.customer_email} onChange={e => update('customer_email', e.target.value)} required />
                  </div>
                  {isCommercial && (
                    <div>
                      <label>Billing email</label>
                      <input type="email" value={form.billing_email} onChange={e => update('billing_email', e.target.value)} />
                    </div>
                  )}
                </div>

                <label style={{ marginTop: 16 }}>Billing address</label>
                <AddressFields prefix="billing" values={form} onChange={update} placesEnabled />

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
                  Project address same as billing address
                </label>
                <label>Project / jobsite address</label>
                <AddressFields prefix="project" values={form} onChange={update} placesEnabled />
              </>
            )}
          </div>

          <div className="card">
            <h3>Project description</h3>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="Short summary of the job…" />
          </div>

          <div className="card">
            <h3>Scope of work</h3>
            <AIScopeGenerator
              projectType={form.project_type}
              onGenerate={(items) => setScopeItems(prev => [...prev.filter(t => t.trim()), ...items])}
            />
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
            {saving ? 'Creating…' : 'Create Opportunity'}
          </button>
        </form>
      </div>
    </AppShell>
  );
}

export default function NewJobPage() {
  return (
    <Suspense fallback={null}>
      <NewJobPageInner />
    </Suspense>
  );
}
