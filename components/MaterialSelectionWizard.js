'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';

const EMPTY_OPTION = { brand: '', item: '', model_number: '', color: '' };

export default function MaterialSelectionWizard({ jobId, open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState('title'); // 'title' | 'options'
  const [selectionId, setSelectionId] = useState(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [savedOptions, setSavedOptions] = useState([]);
  const [form, setForm] = useState(EMPTY_OPTION);
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useState(() => { setMounted(true); });

  if (!open || !mounted) return null;

  function resetAll() {
    setStep('title');
    setSelectionId(null);
    setTitle('');
    setNotes('');
    setSavedOptions([]);
    setForm(EMPTY_OPTION);
    setPhotoFile(null);
  }

  async function startSelection(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const { data } = await supabase.from('material_selections').insert({
      job_id: jobId,
      title: title.trim(),
      notes: notes.trim() || null,
    }).select().single();
    setSaving(false);
    if (data) {
      setSelectionId(data.id);
      setStep('options');
    }
  }

  async function saveOption(e) {
    e.preventDefault();
    if (!form.item.trim()) return;
    setSaving(true);
    let photo_storage_path = null;
    if (photoFile) {
      const path = `selections/${selectionId}/${Date.now()}-${photoFile.name}`;
      const { error: uploadErr } = await supabase.storage.from('job-photos').upload(path, photoFile);
      if (!uploadErr) photo_storage_path = path;
    }
    const { data } = await supabase.from('material_selection_options').insert({
      selection_id: selectionId,
      brand: form.brand.trim() || null,
      item: form.item.trim(),
      model_number: form.model_number.trim() || null,
      color: form.color.trim() || null,
      photo_storage_path,
      display_order: savedOptions.length,
    }).select().single();
    setSaving(false);
    if (data) {
      setSavedOptions(prev => [...prev, data]);
      setForm(EMPTY_OPTION);
      setPhotoFile(null);
    }
  }

  function finishAndClose() {
    resetAll();
    onClose();
  }

  function finishAndStartAnother() {
    resetAll();
  }

  return createPortal(
    <div style={overlayStyle} onClick={finishAndClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {step === 'title' && (
          <form onSubmit={startSelection}>
            <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>New Material Selection</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
              What's the decision point? e.g. "Kitchen Dishwasher" — you'll add each option (brand, model, etc.) to compare next.
            </p>
            <label>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Kitchen Dishwasher" required autoFocus />
            <label style={{ marginTop: 10 }}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Next: Add Options →'}</button>
              <button className="btn btn-sm" type="button" onClick={finishAndClose}>Cancel</button>
            </div>
          </form>
        )}

        {step === 'options' && (
          <div>
            <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{title}</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
              Add each option the customer will choose between.
            </p>

            {savedOptions.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {savedOptions.map(opt => (
                  <div key={opt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, marginBottom: 6, fontSize: 12.5 }}>
                    <span><b>{opt.item}</b>{opt.brand ? ` — ${opt.brand}` : ''}{opt.model_number ? ` (${opt.model_number})` : ''}</span>
                    <span style={{ color: '#3a6b45', fontWeight: 700 }}>✓ Added</span>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={saveOption} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 8 }}>
                {savedOptions.length === 0 ? 'First option' : `Option ${savedOptions.length + 1}`}
              </div>
              <div className="two-col">
                <div><label>Brand</label><input value={form.brand} onChange={e => setForm(prev => ({ ...prev, brand: e.target.value }))} /></div>
                <div><label>Item *</label><input value={form.item} onChange={e => setForm(prev => ({ ...prev, item: e.target.value }))} placeholder="e.g. Dishwasher" required /></div>
                <div><label>Model Number</label><input value={form.model_number} onChange={e => setForm(prev => ({ ...prev, model_number: e.target.value }))} /></div>
                <div><label>Color</label><input value={form.color} onChange={e => setForm(prev => ({ ...prev, color: e.target.value }))} /></div>
              </div>
              <label style={{ marginTop: 8 }}>Photo</label>
              <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files[0])} />
              <div className="section-actions">
                <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : '+ Add This Option'}</button>
              </div>
            </form>

            <div className="section-actions" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <button className="btn btn-primary btn-sm" onClick={finishAndStartAnother} disabled={savedOptions.length === 0}>
                Save Selection &amp; Start Another →
              </button>
              <button className="btn btn-sm" onClick={finishAndClose} disabled={savedOptions.length === 0}>
                Save Selection &amp; Close
              </button>
            </div>
            {savedOptions.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>Add at least one option before finishing.</div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, width: '100dvw', height: '100dvh',
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  overflowY: 'auto',
};
const modalStyle = {
  background: 'var(--card-bg)', borderRadius: 8, padding: 26, width: '100%', maxWidth: 520,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  margin: 'auto', maxHeight: '90vh', overflowY: 'auto',
};
