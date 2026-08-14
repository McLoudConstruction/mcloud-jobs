'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';

export default function NewJobPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();

  const [form, setForm] = useState({
    job_number: '',
    customer_name: '',
    customer_contact: '',
    customer_email: '',
    customer_phone: '',
    billing_address: '',
    project_address: '',
    description: '',
    contract_price: '',
  });
  const [scopeItems, setScopeItems] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function addScopeItem() { setScopeItems(prev => [...prev, '']); }
  function updateScopeItem(i, value) { setScopeItems(prev => prev.map((t, idx) => idx === i ? value : t)); }
  function removeScopeItem(i) { setScopeItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.job_number.trim()) { setError('Job number is required.'); return; }
    setSaving(true);

    const payload = {
      ...form,
      contract_price: form.contract_price ? parseFloat(form.contract_price.replace(/[^0-9.]/g, '')) : null,
      scope_items: scopeItems.filter(t => t.trim()).map(text => ({ text })),
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

  return (
    <div>
      <div className="topbar">
        <div className="brand">McLoud <span>Jobs</span></div>
        <Link href="/dashboard" className="btn btn-sm">← Dashboard</Link>
      </div>

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
            </div>
          </div>

          <div className="card">
            <h3>Customer</h3>
            <div className="two-col">
              <div>
                <label>Customer / company name</label>
                <input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} />
              </div>
              <div>
                <label>Contact person</label>
                <input value={form.customer_contact} onChange={e => update('customer_contact', e.target.value)} />
              </div>
              <div>
                <label>Email</label>
                <input type="email" value={form.customer_email} onChange={e => update('customer_email', e.target.value)} />
              </div>
              <div>
                <label>Phone</label>
                <input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} />
              </div>
            </div>
            <label>Billing address</label>
            <input value={form.billing_address} onChange={e => update('billing_address', e.target.value)} />
            <label>Project / jobsite address</label>
            <input value={form.project_address} onChange={e => update('project_address', e.target.value)} />
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

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </form>
      </div>
    </div>
  );
}
