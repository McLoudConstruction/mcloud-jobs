'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { buildDocEmail } from '../lib/emailTemplates';
import MaterialOptionCard from './MaterialOptionCard';
import MaterialSelectionWizard from './MaterialSelectionWizard';
import PopupModal from './PopupModal';

const STATUS_LABELS = { draft: 'Draft', sent: 'Awaiting Customer', approved: 'Approved' };

// All the selection sheets for a job, grouped together on one page since
// they're typically issued to the customer all at once — with a
// click-to-preview snapshot of exactly what the customer sees on each
// sheet, without navigating away or risking picking on their behalf.
export default function JobMaterialSelectionsPanel({ jobId, job }) {
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

  const [checkedIds, setCheckedIds] = useState(new Set());
  const [issuing, setIssuing] = useState(false);
  const draftSelections = selections.filter(s => s.status === 'draft');
  const [activeTab, setActiveTab] = useState('approved');

  const approvedItems = selections
    .filter(s => s.status === 'approved' && s.selected_option_id)
    .map(s => {
      const opt = (optionsBySelection[s.id] || []).find(o => o.id === s.selected_option_id);
      return opt ? { ...opt, sheetTitle: s.title } : null;
    })
    .filter(Boolean);

  function toggleChecked(id) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function issueSelected() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setIssuing(true);

    const { error } = await supabase.from('material_selections').update({ status: 'sent', sent_at: new Date().toISOString() }).in('id', ids);
    if (error) {
      alert('Failed to issue the selected sheets: ' + error.message);
      setIssuing(false);
      return;
    }

    const recipient = job?.billing_email || job?.customer_email || '';
    if (recipient) {
      const { subject, html, text } = buildDocEmail({ customerName: job?.customer_name, docType: 'material selection' });
      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, subject, html, text }),
      }).catch(() => {}); // status is already updated regardless of email delivery — don't block on it
    }

    setCheckedIds(new Set());
    setIssuing(false);
  }

  return (
    <div className="card">
      <h3>Material Selections</h3>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
        {activeTab === 'approved'
          ? "What's been approved by the customer and ready to order — the shopping list for this job."
          : "Every selection sheet for this job, grouped together since they're typically issued to the customer all at once. Click a sheet to preview exactly what the customer sees."}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <button className={`tab-section-btn ${activeTab === 'approved' ? 'active' : ''}`} onClick={() => setActiveTab('approved')}>
          Approved Materials{approvedItems.length > 0 ? ` (${approvedItems.length})` : ''}
        </button>
        <button className={`tab-section-btn ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          All Sheets
        </button>
      </div>

      {activeTab === 'approved' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {approvedItems.length === 0 && (
            <div className="empty-state">Nothing approved yet — items will show up here as the customer makes their choices.</div>
          )}
          {approvedItems.map(item => {
            const url = photoUrls[item.id] || item.photo_external_url;
            const priceDisplay = item.price_cents != null ? `$${(item.price_cents / 100).toFixed(2)}` : null;
            const detailLine = [
              item.brand && `Brand: ${item.brand}`,
              item.model_number && `Model #: ${item.model_number}`,
              item.color && `Color: ${item.color}`,
            ].filter(Boolean).join('   ');
            return (
              <div key={item.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: url ? 'transparent' : 'var(--line)', opacity: url ? 1 : 0.25 }}>
                  {url && <img src={url} alt={item.item} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{item.item}</span>
                    {priceDisplay && <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--heading)', flexShrink: 0 }}>{priceDisplay}</span>}
                  </div>
                  {detailLine && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>{detailLine}</div>}
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>From: {item.sheetTitle}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'all' && (
        <>
          <div className="section-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-sm" onClick={() => setWizardOpen(true)}>+ New Selection</button>
            {draftSelections.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                disabled={checkedIds.size === 0 || issuing}
                onClick={issueSelected}
              >
                {issuing ? 'Issuing…' : `Issue Selected${checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}`}
              </button>
            )}
          </div>

          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selections.length === 0 && <div className="empty-state">No selections yet.</div>}
            {selections.map(s => {
              const opts = optionsBySelection[s.id] || [];
              const isDraft = s.status === 'draft';
              return (
                <div
                  key={s.id}
                  onClick={() => setPreviewId(s.id)}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, cursor: 'pointer', transition: 'border-color 150ms ease', display: 'flex', gap: 10, alignItems: 'flex-start' }}
                >
                  {isDraft && (
                    <input
                      type="checkbox"
                      checked={checkedIds.has(s.id)}
                      onChange={() => toggleChecked(s.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16, padding: 0, background: 'none', border: 'none' }}
                      aria-label={`Select ${s.title} to issue`}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                </div>
              );
            })}
          </div>
        </>
      )}

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
