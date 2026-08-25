'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { SERVICES_OFFERED } from '../../../lib/constants';
import Chrome from '../../../components/SubcontractorApplyChrome';

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
  const [workPhotos, setWorkPhotos] = useState([]);
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

  function addWorkPhotos(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    setWorkPhotos(prev => [...prev, ...files].slice(0, 8));
  }
  function removeWorkPhoto(idx) {
    setWorkPhotos(prev => prev.filter((_, i) => i !== idx));
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
      if (workPhotos.length > 0) {
        payload.workPhotos = await Promise.all(workPhotos.map(async f => ({
          base64: await fileToBase64(f), filename: f.name, contentType: f.type,
        })));
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

  if (status === 'loading') return <div className="mcw-page" />;

  if (status === 'invalid') {
    return (
      <Chrome>
        <div className="mcw-status-card">
          <div className="mcw-eyebrow">Link Not Valid</div>
          <h1>This link isn't active</h1>
          <p>This invite link has expired or doesn't exist. Please reach out to McLoud Construction for a new one.</p>
        </div>
      </Chrome>
    );
  }

  if (status === 'already') {
    return (
      <Chrome>
        <div className="mcw-status-card">
          <div className="mcw-eyebrow">Already Submitted</div>
          <h1>We've got it</h1>
          <p>We've already received your information — thanks! We'll be in touch if we need anything else.</p>
        </div>
      </Chrome>
    );
  }

  if (status === 'submitted') {
    return (
      <Chrome>
        <div className="mcw-status-card">
          <div className="mcw-eyebrow">Application Sent</div>
          <h1>Thank you</h1>
          <p>Your information has been submitted to McLoud Construction. We'll review it and reach out with next steps.</p>
        </div>
      </Chrome>
    );
  }

  return (
    <Chrome>
      <section className="mcw-hero">
        <div className="mcw-hero-inner">
          <div className="mcw-eyebrow">Work With Us</div>
          <h1>Subcontractor Application</h1>
          <p>Tell us about your company and share your W9 and Certificate of Insurance. No account needed — this only takes a few minutes.</p>
        </div>
      </section>

      <div className="mcw-form-wrap">
        <form onSubmit={submit}>
          <label>Company name *</label>
          <input value={form.companyName} onChange={e => update('companyName', e.target.value)} required />

          <div className="mcw-two-col">
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

          <div className="mcw-section-label">Company Address</div>
          <label>Street address *</label>
          <input value={form.street} onChange={e => update('street', e.target.value)} required />

          <div className="mcw-two-col">
            <div>
              <label>Unit / suite</label>
              <input value={form.unit} onChange={e => update('unit', e.target.value)} />
            </div>
            <div>
              <label>City *</label>
              <input value={form.city} onChange={e => update('city', e.target.value)} required />
            </div>
          </div>
          <div className="mcw-two-col">
            <div>
              <label>State *</label>
              <input value={form.state} onChange={e => update('state', e.target.value)} required />
            </div>
            <div>
              <label>ZIP *</label>
              <input value={form.zip} onChange={e => update('zip', e.target.value)} required />
            </div>
          </div>

          <div className="mcw-section-label">Services Offered *</div>
          <div className="mcw-checkbox-grid">
            {SERVICES_OFFERED.map(s => (
              <label key={s} className="mcw-checkbox">
                <input type="checkbox" checked={form.servicesOffered.includes(s)} onChange={() => toggleService(s)} />
                {s}
              </label>
            ))}
          </div>

          <div className="mcw-tick-rule" />
          <div className="mcw-section-label">Documentation</div>
          <div className="mcw-two-col">
            <div>
              <label>W9 *</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setW9File(e.target.files[0])} required />
            </div>
            <div>
              <label>Certificate of Insurance *</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setCoiFile(e.target.files[0])} required />
            </div>
          </div>
          <label>COI expiration date *</label>
          <input type="date" value={form.coiExpiresAt} onChange={e => update('coiExpiresAt', e.target.value)} required />

          <div className="mcw-tick-rule" />
          <div className="mcw-section-label">Photos of Previous Work (optional)</div>
          <label style={{ marginTop: 0 }}>Show us a bit of your craftsmanship — up to 8 photos</label>
          <input type="file" accept="image/*" multiple onChange={e => addWorkPhotos(e.target.files)} />
          {workPhotos.length > 0 && (
            <div className="mcw-photo-grid">
              {workPhotos.map((f, i) => (
                <div key={i} className="mcw-photo-thumb">
                  <img src={URL.createObjectURL(f)} alt={`Work sample ${i + 1}`} />
                  <button type="button" onClick={() => removeWorkPhoto(i)} aria-label="Remove photo">×</button>
                </div>
              ))}
            </div>
          )}

          <div className="mcw-tick-rule" />
          <label>Anything else we should know?</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={4} />

          {error && <div className="mcw-error">{error}</div>}

          <button className="mcw-submit" type="submit" disabled={saving}>
            {saving ? 'Submitting…' : 'Submit Application'}
          </button>
        </form>
      </div>
    </Chrome>
  );
}
