'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { SERVICES_OFFERED } from '../../../lib/constants';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const EMPTY_FORM = {
  companyName: '', contactName: '', contactPhone: '', contactEmail: '',
  street: '', unit: '', city: '', state: '', zip: '',
  servicesOffered: [], notes: '', coiExpiresAt: '',
};

export default function SubcontractorApplyPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading'); // loading | ready | invalid | submitted | already
  const [form, setForm] = useState(EMPTY_FORM);
  const [w9File, setW9File] = useState(null);
  const [coiFile, setCoiFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/subcontractor-application?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) { setStatus('invalid'); return; }
      if (data.application.status === 'submitted' || data.application.status === 'approved') {
        setStatus('already');
        return;
      }
      setForm(prev => ({
        ...prev,
        companyName: data.application.company_name || data.application.invited_company_hint || '',
        contactEmail: data.application.contact_email || data.application.invited_email || '',
      }));
      setStatus('ready');
    } catch {
      setStatus('invalid');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }
  function toggleService(service) {
    setForm(prev => ({
      ...prev,
      servicesOffered: prev.servicesOffered.includes(service)
        ? prev.servicesOffered.filter(s => s !== service)
        : [...prev.servicesOffered, service],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    if (form.servicesOffered.length === 0) {
      setError('Please select at least one service offered.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { token, ...form };
      if (w9File) {
        payload.w9Base64 = await fileToBase64(w9File);
        payload.w9Filename = w9File.name;
        payload.w9ContentType = w9File.type;
      }
      if (coiFile) {
        payload.coiBase64 = await fileToBase64(coiFile);
        payload.coiFilename = coiFile.name;
        payload.coiContentType = coiFile.type;
      }
      const res = await fetch('/api/public/subcontractor-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit.');
      setStatus('submitted');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') return null;

  if (status === 'invalid') {
    return (
      <div className="login-wrap portal-textured">
        <div className="login-card">
          <h1>Link not valid</h1>
          <p className="sub">This invite link has expired or doesn't exist. Please reach out to McLoud Construction for a new one.</p>
        </div>
      </div>
    );
  }

  if (status === 'already') {
    return (
      <div className="login-wrap portal-textured">
        <div className="login-card">
          <h1>Already submitted</h1>
          <p className="sub">We've already received your information — thanks! We'll be in touch if we need anything else.</p>
        </div>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="login-wrap portal-textured">
        <div className="login-card">
          <h1>Thank you</h1>
          <p className="sub">Your information has been submitted to McLoud Construction. We'll review it and reach out with next steps.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap portal-textured" style={{ alignItems: 'flex-start', paddingTop: 48, paddingBottom: 48 }}>
      <div className="login-card" style={{ maxWidth: 560 }}>
        <h1>Subcontractor Application</h1>
        <p className="sub">Tell us about your company and share your W9 and Certificate of Insurance — no account needed.</p>

        <form onSubmit={submit}>
          <label>Company name *</label>
          <input value={form.companyName} onChange={e => update('companyName', e.target.value)} required />

          <div className="two-col">
            <div>
              <label>Contact name *</label>
              <input value={form.contactName} onChange={e => update('contactName', e.target.value)} required />
            </div>
            <div>
              <label>Contact phone *</label>
              <input value={form.contactPhone} onChange={e => update('contactPhone', e.target.value)} required />
            </div>
          </div>

          <label>Contact email *</label>
          <input type="email" value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)} required />

          <div className="two-col">
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Street address *</label>
              <input value={form.street} onChange={e => update('street', e.target.value)} required />
            </div>
            <div>
              <label>Unit / suite *</label>
              <input value={form.unit} onChange={e => update('unit', e.target.value)} required />
            </div>
            <div>
              <label>City *</label>
              <input value={form.city} onChange={e => update('city', e.target.value)} required />
            </div>
            <div>
              <label>State *</label>
              <input value={form.state} onChange={e => update('state', e.target.value)} required />
            </div>
            <div>
              <label>ZIP *</label>
              <input value={form.zip} onChange={e => update('zip', e.target.value)} required />
            </div>
          </div>

          <label style={{ marginTop: 10 }}>Services offered *</label>
          <div className="apply-services-grid">
            {SERVICES_OFFERED.map(s => (
              <label key={s} className="apply-service-chip">
                <input type="checkbox" checked={form.servicesOffered.includes(s)} onChange={() => toggleService(s)} style={{ width: 'auto' }} />
                {s}
              </label>
            ))}
          </div>

          <div className="two-col" style={{ marginTop: 10 }}>
            <div>
              <label>W9 *</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setW9File(e.target.files[0])} required />
            </div>
            <div>
              <label>Certificate of Insurance *</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setCoiFile(e.target.files[0])} required />
            </div>
          </div>
          <label style={{ marginTop: 10 }}>COI expiration date *</label>
          <input type="date" value={form.coiExpiresAt} onChange={e => update('coiExpiresAt', e.target.value)} required />

          <label style={{ marginTop: 10 }}>Anything else we should know?</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={3} />

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
            {saving ? 'Submitting…' : 'Submit Application'}
          </button>
        </form>
      </div>

      <style jsx global>{`
        .apply-services-grid{ display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px 12px; margin-top: 4px; }
        .apply-service-chip{ display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 400; margin: 0; cursor: pointer; }
      `}</style>
    </div>
  );
}
