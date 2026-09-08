'use client';
import { useEffect, useState } from 'react';
import { useRequireAuth } from '../../lib/useAuth';
import { supabase } from '../../lib/supabaseClient';

// Origins allowed to post scraped product data into this window. Add a
// retailer here (and to the bookmarklet's own scraper) before trusting
// captures from it.
const ALLOWED_ORIGINS = [
  'https://www.homedepot.com',
  'https://www.lowes.com',
  'https://lowes.com',
];

function formatPrice(cents) {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

function parsePriceToCents(value) {
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export default function CapturePage() {
  const { session, loading: authLoading } = useRequireAuth();
  const [captured, setCaptured] = useState(null); // raw payload from bookmarklet
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [selections, setSelections] = useState([]);
  const [selectionId, setSelectionId] = useState(''); // '' = choose, '__new__' = create
  const [newSheetTitle, setNewSheetTitle] = useState('');
  const [form, setForm] = useState({ item: '', brand: '', price: '', color: '', model_number: '' });
  const [status, setStatus] = useState('waiting'); // waiting | ready | saving | saved | error
  const [errorMsg, setErrorMsg] = useState('');

  // Tell any opener that we're ready to receive the scraped payload, and
  // listen for it. The bookmarklet runs in the retailer page's origin, so
  // we validate origin before trusting anything it sends us.
  useEffect(() => {
    function handleMessage(e) {
      if (!ALLOWED_ORIGINS.includes(e.origin)) return;
      if (!e.data || e.data.type !== 'MCLOUD_CAPTURE') return;
      const payload = e.data.payload || {};
      setCaptured(payload);
      setForm({
        item: payload.name || '',
        brand: payload.brand || '',
        price: payload.priceCents != null ? formatPrice(payload.priceCents) : '',
        color: '',
        model_number: payload.sku || '',
      });
      setStatus('ready');
    }
    window.addEventListener('message', handleMessage);
    if (window.opener) {
      window.opener.postMessage({ type: 'MCLOUD_CAPTURE_READY' }, '*');
    }
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from('jobs').select('id, customer_name, project_address, job_number').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setJobs(data);
    });
  }, [session]);

  useEffect(() => {
    if (!jobId) { setSelections([]); setSelectionId(''); return; }
    supabase.from('material_selections').select('id, title').eq('job_id', jobId).order('created_at', { ascending: false }).then(({ data }) => {
      setSelections(data || []);
      setSelectionId('');
    });
  }, [jobId]);

  async function handleSave(e) {
    e.preventDefault();
    if (!jobId || !selectionId || !form.item.trim()) return;
    setStatus('saving');
    setErrorMsg('');

    let targetSelectionId = selectionId;
    if (selectionId === '__new__') {
      if (!newSheetTitle.trim()) {
        setStatus('ready');
        setErrorMsg('Give the new selection sheet a title.');
        return;
      }
      const { data: newSheet, error: sheetErr } = await supabase
        .from('material_selections')
        .insert({ job_id: jobId, title: newSheetTitle.trim() })
        .select()
        .single();
      if (sheetErr || !newSheet) {
        setStatus('ready');
        setErrorMsg(sheetErr?.message || 'Could not create the selection sheet.');
        return;
      }
      targetSelectionId = newSheet.id;
    }

    const { count } = await supabase
      .from('material_selection_options')
      .select('id', { count: 'exact', head: true })
      .eq('selection_id', targetSelectionId);

    const { error: optionErr } = await supabase.from('material_selection_options').insert({
      selection_id: targetSelectionId,
      item: form.item.trim(),
      brand: form.brand.trim() || null,
      model_number: form.model_number.trim() || null,
      color: form.color.trim() || null,
      price_cents: form.price ? parsePriceToCents(form.price) : null,
      photo_external_url: captured?.imageUrl || null,
      source_url: captured?.sourceUrl || null,
      captured_via: 'bookmarklet',
      display_order: count || 0,
    });

    if (optionErr) {
      setStatus('ready');
      setErrorMsg(optionErr.message);
      return;
    }

    setStatus('saved');
    setTimeout(() => window.close(), 1200);
  }

  if (authLoading) return <Centered>Loading…</Centered>;
  if (!session) return null; // useRequireAuth redirects to /login

  if (status === 'waiting') {
    return (
      <Centered>
        <p>Waiting for the product page to send its data…</p>
        <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
          If nothing happens in a few seconds, close this window and try the bookmarklet again from the product page.
        </p>
      </Centered>
    );
  }

  if (status === 'saved') {
    return <Centered>Added to the selection sheet. Closing…</Centered>;
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Add captured item</h2>
      {captured?.sourceUrl && (
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16, wordBreak: 'break-all' }}>{captured.sourceUrl}</p>
      )}

      {captured?.imageUrl && (
        <img src={captured.imageUrl} alt="" style={{ width: 120, height: 120, objectFit: 'contain', border: '1px solid #eee', marginBottom: 16 }} />
      )}

      <form onSubmit={handleSave}>
        <Field label="Item">
          <input value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))} required style={inputStyle} />
        </Field>
        <Field label="Brand">
          <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Model / SKU">
          <input value={form.model_number} onChange={e => setForm(f => ({ ...f, model_number: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Color">
          <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Price">
          <input value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" style={inputStyle} />
        </Field>

        <Field label="Job">
          <select value={jobId} onChange={e => setJobId(e.target.value)} required style={inputStyle}>
            <option value="">Select a job…</option>
            {jobs.map(j => (
              <option key={j.id} value={j.id}>
                {j.job_number ? `#${j.job_number} — ` : ''}{j.customer_name}{j.project_address ? ` (${j.project_address})` : ''}
              </option>
            ))}
          </select>
        </Field>

        {jobId && (
          <Field label="Selection sheet">
            <select value={selectionId} onChange={e => setSelectionId(e.target.value)} required style={inputStyle}>
              <option value="">Select a sheet…</option>
              {selections.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
              <option value="__new__">+ New selection sheet…</option>
            </select>
          </Field>
        )}

        {selectionId === '__new__' && (
          <Field label="New sheet title">
            <input value={newSheetTitle} onChange={e => setNewSheetTitle(e.target.value)} required style={inputStyle} />
          </Field>
        )}

        {errorMsg && <p style={{ color: '#a8471f', fontSize: 13, marginBottom: 12 }}>{errorMsg}</p>}

        <button type="submit" disabled={status === 'saving'} style={buttonStyle}>
          {status === 'saving' ? 'Saving…' : 'Add to selection sheet'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Centered({ children }) {
  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', textAlign: 'center', color: '#333' }}>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
  boxSizing: 'border-box',
};

const buttonStyle = {
  width: '100%',
  padding: '10px',
  background: '#1c1b19',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  fontSize: 14,
  cursor: 'pointer',
};
