'use client';
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatPhone } from '../lib/constants';
import AddressFields, { formatAddress } from './AddressFields';

// Billing is assumed to be the same as the project/jobsite address unless
// the saved record actually shows otherwise — a job only counts as
// "different" if it has a billing address on file that doesn't match the
// project address field-for-field. An empty billing address (nothing ever
// entered) is treated as "same", not "different".
function computeBillingDifferent(job) {
  const hasBilling = Boolean(job.billing_street || job.billing_city || job.billing_state || job.billing_zip);
  if (!hasBilling) return false;
  return (
    (job.billing_street || '') !== (job.project_street || '') ||
    (job.billing_unit || '') !== (job.project_unit || '') ||
    (job.billing_city || '') !== (job.project_city || '') ||
    (job.billing_state || '') !== (job.project_state || '') ||
    (job.billing_zip || '') !== (job.project_zip || '')
  );
}

function buildForm(job) {
  return {
    customer_name: job.customer_name || '',
    customer_contact: job.customer_contact || '',
    customer_email: job.customer_email || '',
    customer_phone: job.customer_phone || '',
    billing_email: job.billing_email || job.customer_email || '',
    billing_street: job.billing_street || '', billing_unit: job.billing_unit || '', billing_city: job.billing_city || '', billing_state: job.billing_state || '', billing_zip: job.billing_zip || '',
    project_street: job.project_street || '', project_unit: job.project_unit || '', project_city: job.project_city || '', project_state: job.project_state || '', project_zip: job.project_zip || '',
  };
}

export default function CustomerInfoCard({ job, onSave }) {
  const isCommercial = job.project_type === 'commercial';
  // Read-only until "Edit" is clicked — this card used to be click-to-edit
  // everywhere, which made it too easy to accidentally change a customer's
  // info while just scrolling/scanning the page.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(buildForm(job));
  // Billing follows the Project/jobsite address by default; checking this
  // box is what reveals the Billing Address fields for the (uncommon) case
  // where billing actually goes somewhere else, e.g. a property manager
  // billed at a different address than the jobsite.
  const [billingDifferent, setBillingDifferent] = useState(computeBillingDifferent(job));
  const [billingSameAsContact, setBillingSameAsContact] = useState(
    !job.billing_email || job.billing_email === job.customer_email
  );

  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const nameSearchTimer = useRef(null);

  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const contactSearchTimer = useRef(null);

  const [companySuggestions, setCompanySuggestions] = useState([]);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
  const companySearchTimer = useRef(null);

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (!billingDifferent && field.startsWith('project_')) {
        next[field.replace('project_', 'billing_')] = value;
      }
      if (field === 'customer_email' && billingSameAsContact) {
        next.billing_email = value;
      }
      return next;
    });
  }
  function toggleBillingDifferent(checked) {
    setBillingDifferent(checked);
    if (!checked) {
      // Un-checking means "billing is the same as project" again — snap
      // the (now-hidden) billing fields back to match immediately, so a
      // stale, previously-different billing address can't linger unseen
      // in the saved record.
      setForm(prev => ({
        ...prev,
        billing_street: prev.project_street, billing_unit: prev.project_unit,
        billing_city: prev.project_city, billing_state: prev.project_state, billing_zip: prev.project_zip,
      }));
    }
  }
  function toggleBillingSameAsContact(checked) {
    setBillingSameAsContact(checked);
    if (checked) update('billing_email', form.customer_email);
  }

  // ---- Customer Name autofill from People Database (contacts table),
  // residential only — this is the single field that drives job.customer_name,
  // the "who this is" value used everywhere downstream (documents, portal,
  // messages, dashboards). ----
  function handleCustomerNameChange(value) {
    update('customer_name', value);
    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (!value.trim()) { setNameSuggestions([]); setShowNameSuggestions(false); return; }
    nameSearchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*').ilike('name', `%${value.trim()}%`).limit(5);
      setNameSuggestions(data || []);
      setShowNameSuggestions((data || []).length > 0);
    }, 250);
  }
  function applyNameSuggestion(contact) {
    setForm(prev => ({
      ...prev,
      customer_name: contact.name || prev.customer_name,
      customer_email: contact.contact_email || prev.customer_email,
      customer_phone: contact.contact_phone || prev.customer_phone,
    }));
    setShowNameSuggestions(false);
  }

  // ---- Contact Person autofill from People Database (contacts table) ----
  function handleContactNameChange(value) {
    update('customer_contact', value);
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current);
    if (!value.trim()) { setContactSuggestions([]); setShowContactSuggestions(false); return; }
    contactSearchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*').ilike('name', `%${value.trim()}%`).limit(5);
      setContactSuggestions(data || []);
      setShowContactSuggestions((data || []).length > 0);
    }, 250);
  }
  function applyContactSuggestion(contact) {
    setForm(prev => ({
      ...prev,
      customer_contact: contact.name || prev.customer_contact,
      customer_email: contact.contact_email || prev.customer_email,
      customer_phone: contact.contact_phone || prev.customer_phone,
    }));
    setShowContactSuggestions(false);
  }

  // ---- Company autofill from Company Database (companies table), commercial
  // only — writes to customer_name too. For a commercial job, the company
  // IS the "who this is" value used everywhere downstream, same field
  // Residential's Customer Name writes to; there's no separate
  // job.company_name column, so this doesn't silently write to a column
  // nothing else reads. ----
  function handleCompanyChange(value) {
    update('customer_name', value);
    if (companySearchTimer.current) clearTimeout(companySearchTimer.current);
    if (!value.trim()) { setCompanySuggestions([]); setShowCompanySuggestions(false); return; }
    companySearchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('companies').select('*').ilike('company_name', `%${value.trim()}%`).limit(5);
      setCompanySuggestions(data || []);
      setShowCompanySuggestions((data || []).length > 0);
    }, 250);
  }
  function applyCompanySuggestion(company) {
    setForm(prev => ({
      ...prev,
      customer_name: company.company_name || prev.customer_name,
      customer_email: prev.customer_email || company.contact_email || '',
    }));
    setShowCompanySuggestions(false);
  }

  function save() {
    onSave({
      ...form,
      billing_address: formatAddress(form, 'billing'),
      project_address: formatAddress(form, 'project'),
    });
    setEditing(false);
  }

  function cancelEdit() {
    setForm(buildForm(job));
    setBillingDifferent(computeBillingDifferent(job));
    setBillingSameAsContact(!job.billing_email || job.billing_email === job.customer_email);
    setEditing(false);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Customer</h3>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn-sm" onClick={cancelEdit} type="button">Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save} type="button">Save customer info</button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={() => setEditing(true)} type="button">Edit</button>
        )}
      </div>
      <div className="two-col">
        {isCommercial ? (
          <div style={{ position: 'relative' }}>
            <label>Company</label>
            <input
              value={form.customer_name}
              onChange={e => handleCompanyChange(e.target.value)}
              onFocus={() => companySuggestions.length > 0 && setShowCompanySuggestions(true)}
              onBlur={() => setTimeout(() => setShowCompanySuggestions(false), 150)}
              autoComplete="off"
              disabled={!editing}
            />
            {showCompanySuggestions && (
              <div style={{ position: 'absolute', top: '100%', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                {companySuggestions.map(c => (
                  <div key={c.id} onMouseDown={() => applyCompanySuggestion(c)} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}>
                    <b>{c.company_name}</b>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{c.contact_email || 'Click to autofill'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <label>Customer Name</label>
            <input
              value={form.customer_name}
              onChange={e => handleCustomerNameChange(e.target.value)}
              onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
              onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
              autoComplete="off"
              disabled={!editing}
            />
            {showNameSuggestions && (
              <div style={{ position: 'absolute', top: '100%', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                {nameSuggestions.map(s => (
                  <div key={s.id} onMouseDown={() => applyNameSuggestion(s)} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}>
                    <b>{s.name}</b>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      {[s.contact_email, s.contact_phone ? formatPhone(s.contact_phone) : null].filter(Boolean).join(' · ') || 'Click to autofill'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isCommercial && (
          <div style={{ position: 'relative' }}>
            <label>Contact person</label>
            <input
              value={form.customer_contact}
              onChange={e => handleContactNameChange(e.target.value)}
              onFocus={() => contactSuggestions.length > 0 && setShowContactSuggestions(true)}
              onBlur={() => setTimeout(() => setShowContactSuggestions(false), 150)}
              autoComplete="off"
              disabled={!editing}
            />
            {showContactSuggestions && (
              <div style={{ position: 'absolute', top: '100%', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                {contactSuggestions.map(s => (
                  <div key={s.id} onMouseDown={() => applyContactSuggestion(s)} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}>
                    <b>{s.name}</b>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                      {[s.contact_email, s.contact_phone ? formatPhone(s.contact_phone) : null].filter(Boolean).join(' · ') || 'Click to autofill'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div><label>Contact email</label><input value={form.customer_email} onChange={e => update('customer_email', e.target.value)} disabled={!editing} /></div>
        <div><label>Contact phone</label><input value={form.customer_phone} onChange={e => update('customer_phone', formatPhone(e.target.value))} disabled={!editing} /></div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={billingSameAsContact} onChange={e => toggleBillingSameAsContact(e.target.checked)} disabled={!editing} />
            Same as Contact Email
          </label>
          <label>Billing email</label>
          <input value={form.billing_email} onChange={e => update('billing_email', e.target.value)} disabled={!editing || billingSameAsContact} />
        </div>
      </div>

      <label style={{ marginTop: 16 }}>Project / jobsite address</label>
      <AddressFields prefix="project" values={form} onChange={update} placesEnabled disabled={!editing} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={billingDifferent} onChange={e => toggleBillingDifferent(e.target.checked)} disabled={!editing} />
        Billing Address different from Project Address
      </label>
      {/* Assumed to be the same as the project address unless this is
          checked — the fields only appear once someone actually says
          billing goes somewhere else. */}
      {billingDifferent && (
        <>
          <label>Billing address</label>
          <AddressFields prefix="billing" values={form} onChange={update} placesEnabled disabled={!editing} />
        </>
      )}
    </div>
  );
}
