'use client';
import { useState } from 'react';
import AddressFields, { formatAddress } from './AddressFields';

export default function CustomerInfoCard({ job, onSave }) {
  const [form, setForm] = useState({
    customer_name: job.customer_name || '',
    customer_contact: job.customer_contact || '',
    customer_email: job.customer_email || '',
    customer_phone: job.customer_phone || '',
    billing_email: job.billing_email || job.customer_email || '',
    billing_street: job.billing_street || '', billing_unit: job.billing_unit || '', billing_city: job.billing_city || '', billing_state: job.billing_state || '', billing_zip: job.billing_zip || '',
    project_street: job.project_street || '', project_unit: job.project_unit || '', project_city: job.project_city || '', project_state: job.project_state || '', project_zip: job.project_zip || '',
  });
  const [sameAsBilling, setSameAsBilling] = useState(
    Boolean(job.billing_street) && job.billing_street === job.project_street && job.billing_city === job.project_city
  );

  const [billingEmailTouched, setBillingEmailTouched] = useState(Boolean(job.billing_email) && job.billing_email !== job.customer_email);

  function update(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (sameAsBilling && field.startsWith('billing_') && field !== 'billing_email') {
        next[field.replace('billing_', 'project_')] = value;
      }
      if (field === 'billing_email') setBillingEmailTouched(true);
      if (field === 'customer_email' && !billingEmailTouched) {
        next.billing_email = value;
      }
      return next;
    });
  }
  function toggleSameAsBilling(checked) {
    setSameAsBilling(checked);
    if (checked) {
      setForm(prev => ({
        ...prev,
        project_street: prev.billing_street, project_unit: prev.billing_unit,
        project_city: prev.billing_city, project_state: prev.billing_state, project_zip: prev.billing_zip,
      }));
    }
  }
  function save() {
    onSave({
      ...form,
      billing_address: formatAddress(form, 'billing'),
      project_address: formatAddress(form, 'project'),
    });
  }

  return (
    <div className="card">
      <h3>Customer</h3>
      <div className="two-col">
        <div><label>Customer / company name</label><input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} /></div>
        <div><label>Contact person</label><input value={form.customer_contact} onChange={e => update('customer_contact', e.target.value)} /></div>
        <div><label>Contact email</label><input value={form.customer_email} onChange={e => update('customer_email', e.target.value)} /></div>
        <div><label>Contact phone</label><input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} /></div>
        <div><label>Billing email</label><input value={form.billing_email} onChange={e => update('billing_email', e.target.value)} /></div>
      </div>

      <label style={{ marginTop: 16 }}>Project / jobsite address</label>
      <AddressFields prefix="project" values={form} onChange={update} placesEnabled />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={sameAsBilling} onChange={e => toggleSameAsBilling(e.target.checked)} />
        Project address same as billing address
      </label>
      <label>Billing address</label>
      <AddressFields prefix="billing" values={form} onChange={update} placesEnabled />

      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save customer info</button>
      </div>
    </div>
  );
}
