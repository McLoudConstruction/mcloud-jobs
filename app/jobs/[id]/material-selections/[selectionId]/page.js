'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';

const EMPTY_OPTION = { brand: '', item: '', model_number: '', color: '' };

export default function MaterialSelectionPage() {
  const { session, loading } = useDocumentAuth();
  const { id, selectionId } = useParams();
  const [selection, setSelection] = useState(null);
  const [options, setOptions] = useState([]);
  const [job, setJob] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_OPTION);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  const load = useCallback(async () => {
    const { data: sel } = await supabase.from('material_selections').select('*').eq('id', selectionId).single();
    const { data: opts } = await supabase.from('material_selection_options').select('*').eq('selection_id', selectionId).order('display_order');
    if (sel) setSelection(sel);
    if (opts) setOptions(opts);
  }, [selectionId]);

  useEffect(() => {
    if (!session) return;
    load();
    supabase.from('jobs').select('job_number, estimate_number, customer_name').eq('id', id).single().then(({ data }) => { if (data) setJob(data); });
    const channel = supabase.channel(`material-selection-${selectionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selection_options', filter: `selection_id=eq.${selectionId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `id=eq.${selectionId}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, selectionId, id, load]);

  // Resolve signed URLs for each option's photo, since job-photos is a private bucket.
  useEffect(() => {
    options.forEach(async opt => {
      if (!opt.photo_storage_path || photoUrls[opt.id]) return;
      const { data } = await supabase.storage.from('job-photos').createSignedUrl(opt.photo_storage_path, 3600);
      if (data) setPhotoUrls(prev => ({ ...prev, [opt.id]: data.signedUrl }));
    });
  }, [options, photoUrls]);

  async function addOption(e) {
    e.preventDefault();
    if (!form.item.trim()) return;
    setSaving(true);
    let photo_storage_path = null;
    if (photoFile) {
      const path = `selections/${selectionId}/${Date.now()}-${photoFile.name}`;
      const { error: uploadErr } = await supabase.storage.from('job-photos').upload(path, photoFile);
      if (!uploadErr) photo_storage_path = path;
    }
    await supabase.from('material_selection_options').insert({
      selection_id: selectionId,
      brand: form.brand.trim() || null,
      item: form.item.trim(),
      model_number: form.model_number.trim() || null,
      color: form.color.trim() || null,
      photo_storage_path,
      display_order: options.length,
    });
    setSaving(false);
    setForm(EMPTY_OPTION);
    setPhotoFile(null);
    setShowForm(false);
  }

  async function deleteOption(optionId) {
    if (!confirm('Remove this option?')) return;
    await supabase.from('material_selection_options').delete().eq('id', optionId);
  }

  async function sendToCustomer() {
    await supabase.from('material_selections').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', selectionId);
  }

  async function chooseOption(optionId) {
    if (!confirm('Choose this option? This selection will be marked approved.')) return;
    setChoosing(true);
    const { error } = await supabase.rpc('approve_material_selection', { target_selection_id: selectionId, chosen_option_id: optionId });
    setChoosing(false);
    if (error) alert('Failed to submit your choice: ' + error.message);
  }

  if (loading || !session || !selection) return null;

  const isDraft = selection.status === 'draft';
  const isApproved = selection.status === 'approved';

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={isAdmin ? `/jobs/${id}?tab=Scope` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className={`badge badge-${isApproved ? 'paid' : selection.status === 'sent' ? 'active' : 'draft'}`}>
            {isApproved ? 'Approved' : selection.status === 'sent' ? 'Awaiting Customer' : 'Draft'}
          </span>
          {isAdmin && isDraft && options.length > 0 && (
            <button className="btn btn-sm" onClick={() => setModalOpen(true)}>Send to Customer</button>
          )}
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, maxWidth: 900 }} id="doc-preview">
        <div className="card">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>{selection.title}</h2>
          {job && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{job.customer_name} — Job/Estimate #{job.job_number || job.estimate_number}</div>}
          {selection.notes && <p style={{ fontSize: 13, marginTop: 10 }}>{selection.notes}</p>}
        </div>

        <div className="material-options-grid">
          {options.map(opt => {
            const isChosen = selection.selected_option_id === opt.id;
            return (
              <div key={opt.id} className="card material-option-card" style={isChosen ? { borderColor: 'var(--accent)', borderWidth: 2 } : undefined}>
                {photoUrls[opt.id] && (
                  <img src={photoUrls[opt.id]} alt={opt.item} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6, marginBottom: 12 }} />
                )}
                <div style={{ fontWeight: 700, fontSize: 14 }}>{opt.item}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.7 }}>
                  {opt.brand && <div><b>Brand:</b> {opt.brand}</div>}
                  {opt.model_number && <div><b>Model #:</b> {opt.model_number}</div>}
                  {opt.color && <div><b>Color:</b> {opt.color}</div>}
                </div>

                {isChosen && (
                  <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: '#3a6b45' }}>✓ Selected</div>
                )}
                {!isAdmin && selection.status === 'sent' && (
                  <button className="btn btn-primary btn-sm no-print" style={{ marginTop: 12 }} onClick={() => chooseOption(opt.id)} disabled={choosing}>
                    {choosing ? 'Submitting…' : 'Choose This'}
                  </button>
                )}
                {isAdmin && isDraft && (
                  <button className="btn btn-sm btn-danger no-print" style={{ marginTop: 12 }} onClick={() => deleteOption(opt.id)}>Remove</button>
                )}
              </div>
            );
          })}
        </div>

        {options.length === 0 && <div className="empty-state">No options added yet.</div>}

        {isAdmin && isDraft && (
          <div className="card no-print">
            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? 'Cancel' : '+ Add Option'}</button>
            </div>
            {showForm && (
              <form onSubmit={addOption} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
                <div className="two-col">
                  <div><label>Brand</label><input value={form.brand} onChange={e => setForm(prev => ({ ...prev, brand: e.target.value }))} /></div>
                  <div><label>Item *</label><input value={form.item} onChange={e => setForm(prev => ({ ...prev, item: e.target.value }))} placeholder="e.g. Dishwasher" required /></div>
                  <div><label>Model Number</label><input value={form.model_number} onChange={e => setForm(prev => ({ ...prev, model_number: e.target.value }))} /></div>
                  <div><label>Color</label><input value={form.color} onChange={e => setForm(prev => ({ ...prev, color: e.target.value }))} /></div>
                </div>
                <label style={{ marginTop: 10 }}>Photo</label>
                <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files[0])} />
                <div className="section-actions">
                  <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add Option'}</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <SendDocModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          docLabel={selection.title}
          docType="material selection"
          customerName={job?.customer_name}
          docElementId="doc-preview"
          pdfFilename={`${selection.title}.pdf`}
          jobId={id}
          onSendSuccess={sendToCustomer}
        />
      )}
    </div>
  );
}
