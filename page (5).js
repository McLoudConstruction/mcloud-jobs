'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import { formatPhone, nextSequentialNumber } from '../../../lib/constants';

const EMPTY_FORM = {
  estimate_number: '',
  expected_close_date: '',
  project_type: '', // 'residential' | 'commercial'
  company: '',
  first_name: '',
  last_name: '',
  customer_email: '',
  customer_phone: '',
  description: '',
};

function NewOpportunityPageInner() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oppId = searchParams.get('opp');
  const [sourceOpp, setSourceOpp] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  // Carried along in the background from a matched contact so it's ready
  // on the job's own tabs later — not shown on this quick-capture form.
  const [carriedAddress, setCarriedAddress] = useState({});

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autofillNote, setAutofillNote] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(null);
  const searchTimer = useRef(null);

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

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
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

  function applySuggestion(contact) {
    setSelectedContactId(contact.id);
    setForm(prev => ({
      ...prev,
      first_name: contact.first_name || prev.first_name,
      last_name: contact.last_name || prev.last_name,
      company: contact.management_company || prev.company,
      customer_email: contact.contact_email || prev.customer_email,
      customer_phone: contact.contact_phone || prev.customer_phone,
    }));
    // Not shown on this form, but carried into the job record so it's
    // already there once you're on the job's own Project/Customer tab.
    setCarriedAddress({
      billing_email: contact.billing_email || null,
      billing_street: contact.billing_street || contact.address_street || null,
      billing_unit: contact.billing_unit || contact.address_unit || null,
      billing_city: contact.billing_city || contact.address_city || null,
      billing_state: contact.billing_state || contact.address_state || null,
      billing_zip: contact.billing_zip || contact.address_zip || null,
      project_street: contact.address_street || contact.billing_street || null,
      project_unit: contact.address_unit || contact.billing_unit || null,
      project_city: contact.address_city || contact.billing_city || null,
      project_state: contact.address_state || contact.billing_state || null,
      project_zip: contact.address_zip || contact.billing_zip || null,
    });
    setShowSuggestions(false);

    const filled = [];
    if (contact.contact_email) filled.push('email');
    if (contact.contact_phone) filled.push('phone');
    if (contact.billing_street || contact.address_street) filled.push('address (carried to the job record)');
    setAutofillNote(`Filled from ${contact.name}: ${filled.join(', ') || 'name only'}.`);
    setTimeout(() => setAutofillNote(''), 6000);
  }

  function validate() {
    if (!form.project_type) return 'Please select Residential or Commercial.';
    if (!form.first_name.trim() || !form.last_name.trim()) return 'First and last name are required.';
    if (!form.customer_email.trim()) return 'Contact email is required.';
    if (!form.customer_phone.trim()) return 'Contact phone is required.';
    if (form.project_type === 'commercial' && !form.company.trim()) return 'Company name is required for commercial opportunities.';
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
      project_type: form.project_type,
      customer_email: form.customer_email,
      customer_phone: form.customer_phone,
      expected_close_date: form.expected_close_date || null,
      description: form.description || null,
      estimate_number: form.estimate_number,
      job_number: null,
      stage: 'new',
      // customer_name is the single "who this is" field used everywhere
      // downstream (documents, portal, messages) — company for
      // commercial, the person's name for residential. customer_contact
      // is always the actual person, useful even when a company is billed.
      customer_name: isCommercial ? form.company.trim() : fullName,
      customer_contact: fullName,
      ...carriedAddress,
    };

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

    if (data && form.customer_email.trim()) {
      // Best-effort — a failed invite here shouldn't block getting to the
      // job page. Portal Access still shows the real invited/not-invited
      // state, and it can always be sent again manually from there.
      try {
        await supabase.from('job_portal_access').insert({
          job_id: data.id,
          email: form.customer_email.trim(),
          name: fullName,
          portal_access: true,
          notify: true,
        });
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: form.customer_email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/customerportal/projects` },
        });
        if (!otpError) {
          await supabase.from('job_portal_access').update({ invited_at: new Date().toISOString() }).eq('job_id', data.id).eq('email', form.customer_email.trim());
        }
      } catch {
        // silently skip — Portal Access on the job page shows the real state either way
      }
    }

    router.push(`/jobs/${data.id}`);
  }

  if (loading || !session) return null;

  const isCommercial = form.project_type === 'commercial';

  return (
    <AppShell>
      <div className="container">
        <h2 style={{ color: 'var(--heading)' }}>New Opportunity</h2>
        {sourceOpp && (
          <div className="card" style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '12px 16px' }}>
            Starting from lead: <b>{sourceOpp.company || sourceOpp.contact_name || 'Unnamed'}</b> — its details are prefilled below. Creating this will mark that lead Converted.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="card">
            <label>Project type *</label>
            <select value={form.project_type} onChange={e => update('project_type', e.target.value)} required>
              <option value="">Select…</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>

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
                        {[s.contact_email, s.contact_phone ? formatPhone(s.contact_phone) : null].filter(Boolean).join(' · ') || 'Click to autofill'}
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
              <div>
                <label>Expected close date</label>
                <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
              </div>
              <div>
                <label>Date entered</label>
                <input value={new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} disabled style={{ opacity: 0.7 }} />
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Project description</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="Short summary of the job…" rows={3} />

            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 10 }}>
              Estimate number: <b>{form.estimate_number || '…'}</b> — assigned automatically. This becomes a real Job number once the opportunity is Approved. Address, pricing, and scope of work are filled in on the job's own tabs after it's created.
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

export default function NewOpportunityPage() {
  return (
    <Suspense fallback={null}>
      <NewOpportunityPageInner />
    </Suspense>
  );
}
