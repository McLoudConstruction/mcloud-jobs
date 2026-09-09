'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import MaterialOptionCard from './MaterialOptionCard';
import MaterialSelectionWizard from './MaterialSelectionWizard';
import PopupModal from './PopupModal';

const STATUS_LABELS = { draft: 'Draft', sent: 'Awaiting Customer', approved: 'Approved' };

// All the selection sheets for a job, grouped together on one page since
// they're typically issued to the customer all at once — with a
// click-to-preview snapshot of exactly what the customer sees on each
// sheet, without navigating away or risking picking on their behalf.
export default function JobMaterialSelectionsPanel({ jobId }) {
  const [selections, setSelections] = useState([]);
  const [optionsBySelection, setOptionsBySelection] = useState({});
  const [photoUrls, setPhotoUrls] = useState({});
  const [previewId, setPreviewId] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: sels } = await supabase.from('material_selections').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    setSelections(sels || []);

    const ids = (sels || []).map(s => s.id);
    if (ids.length === 0) { setOptionsBySelection({}); return; }
    const { data: opts } = await supabase.from('material_selection_options').select('*').in('selection_id', ids).order('display_order');
    const grouped = {};
    (opts || []).forEach(o => { (grouped[o.selection_id] = grouped[o.selection_id] || []).push(o); });
    setOptionsBySelection(grouped);
  }, [jobId]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`job-material-selections-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${jobId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selection_options' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, load]);

  // Resolve signed URLs for internally-uploaded photos across every
  // option on every sheet, since job-photos is a private bucket.
  useEffect(() => {
    Object.values(optionsBySelection).flat().forEach(async opt => {
      if (!opt.photo_storage_path || photoUrls[opt.id]) return;
      const { data } = await supabase.storage.from('job-photos').createSignedUrl(opt.photo_storage_path, 3600);
      if (data) setPhotoUrls(prev => ({ ...prev, [opt.id]: data.signedUrl }));
    });
  }, [optionsBySelection, photoUrls]);

  const previewSelection = selections.find(s => s.id === previewId);
  const previewOptions = previewId ? (optionsBySelection[previewId] || []) : [];

  return (
    <div className="card">
      <h3>Material Selections</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        Every selection sheet for this job, grouped together since they're typically issued to the customer all at once. Click a sheet to preview exactly what the customer sees.
      </div>

      <div className="section-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-sm" onClick={() => setWizardOpen(true)}>+ New Selection</button>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {selections.length === 0 && <div className="empty-state">No selections yet.</div>}
        {selections.map(s => {
          const opts = optionsBySelection[s.id] || [];
          return (
            <div
              key={s.id}
              onClick={() => setPreviewId(s.id)}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'border-color 150ms ease' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{s.title}</span>
                <span className={`badge badge-${s.status === 'approved' ? 'paid' : s.status === 'sent' ? 'active' : 'draft'}`}>{STATUS_LABELS[s.status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {opts.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>No options added yet</span>}
                {opts.map(o => {
                  const url = photoUrls[o.id] || o.photo_external_url;
                  return (
                    <div key={o.id} style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', background: url ? 'transparent' : 'var(--line)', opacity: url ? 1 : 0.25, flexShrink: 0 }}>
                      {url && <img src={url} alt={o.item} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                    </div>
                  );
                })}
                {opts.length > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                    {opts.length} option{opts.length === 1 ? '' : 's'} · Click to preview
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <PopupModal open={!!previewSelection} onClose={() => setPreviewId(null)} maxWidth={900}>
        {previewSelection && (
          <>
            <h3 style={{ margin: '0 0 4px', color: 'var(--heading)' }}>{previewSelection.title}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
              Snapshot of what the customer sees — read-only, nothing here can be changed from this view.
            </div>

            {previewOptions.length === 0 && <div className="empty-state">No options added to this sheet yet.</div>}
            <div className="material-options-grid">
              {previewOptions.map(o => (
                <MaterialOptionCard
                  key={o.id}
                  opt={o}
                  isChosen={previewSelection.selected_option_id === o.id}
                  photoUrl={photoUrls[o.id] || o.photo_external_url || null}
                  onExpandPhoto={() => {}}
                  preview
                />
              ))}
            </div>

            <div style={{ marginTop: 18, textAlign: 'right' }}>
              <a href={`/jobs/${jobId}/material-selections/${previewSelection.id}`} className="btn btn-sm">Open full page →</a>
            </div>
          </>
        )}
      </PopupModal>

      <MaterialSelectionWizard jobId={jobId} open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
