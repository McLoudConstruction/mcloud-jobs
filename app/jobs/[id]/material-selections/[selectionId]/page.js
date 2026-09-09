'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';
import ImageDropzone from '../../../../../components/ImageDropzone';

const EMPTY_OPTION = { brand: '', item: '', model_number: '', color: '' };

function OptionCard({ opt, isChosen, photoUrl, onExpandPhoto, isAdmin, isDraft, selectionStatus, onChoose, onDelete, choosing }) {
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);
  const MAX_VISIBLE_ROWS = 4;

  const detailRows = [];
  if (opt.width || opt.height || opt.depth) {
    detailRows.push(['Dimensions', [
      opt.width && `W ${opt.width}`,
      opt.height && `H ${opt.height}`,
      opt.depth && `D ${opt.depth}`,
    ].filter(Boolean).join(' × ')]);
  }
  if (opt.specs) {
    Object.entries(opt.specs).forEach(([key, value]) => detailRows.push([key, value]));
  }
  const visibleRows = expanded ? detailRows : detailRows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = detailRows.length - visibleRows.length;

  const priceDisplay = opt.price_cents != null ? `$${(opt.price_cents / 100).toFixed(2)}` : null;
  const optionLine = [
    opt.brand && `Brand: ${opt.brand}`,
    opt.model_number && `Model #: ${opt.model_number}`,
    opt.color && `Color: ${opt.color}`,
  ].filter(Boolean);

  // This is purely a "which one are you picking" affordance for the
  // customer — not tied to the item's actual material color. Hover
  // previews what clicking would select; a click commits it. Only
  // active when there's actually something to choose (customer view,
  // sheet sent, not admin/draft), so the whole card is the click
  // target rather than needing the separate button below.
  const selectable = !isAdmin && selectionStatus === 'sent';
  const showHoverPreview = selectable && !isChosen && hovering;
  const borderColor = isChosen ? 'var(--accent)' : showHoverPreview ? 'var(--accent)' : 'var(--line)';
  const borderWidth = isChosen ? 3 : showHoverPreview ? 2 : 1;

  return (
    <div
      className="material-option-card"
      onMouseEnter={() => selectable && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => selectable && !choosing && onChoose(opt.id)}
      style={{
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 8,
        padding: 12,
        cursor: selectable ? 'pointer' : 'default',
        transition: 'border-color 150ms ease, background-color 150ms ease',
        height: '100%',
        alignSelf: 'stretch',
        boxSizing: 'border-box',
        backgroundColor: isChosen ? 'rgba(155, 119, 61, 0.08)' : 'transparent',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {isChosen && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>✓</div>
      )}

      {/* Thumbnail top-left, in line with the name; price directly below
          the name. A fixed-size thumbnail slot is always reserved, with
          or without a photo, so every card lines up the same way. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingRight: isChosen ? 26 : 0 }}>
        <div style={{ width: 56, height: 56, flexShrink: 0 }}>
          {photoUrl ? (
            <button
              type="button"
              className="selection-photo-btn no-print"
              onClick={e => { e.stopPropagation(); onExpandPhoto(photoUrl); }}
              aria-label={`Expand photo of ${opt.item}`}
              style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', width: '100%', height: '100%' }}
            >
              <img src={photoUrl} alt={opt.item} style={{ width: 56, height: 56, objectFit: 'contain' }} />
            </button>
          ) : (
            <div style={{ width: '100%', height: '100%', borderRadius: 6, background: 'var(--line)', opacity: 0.25 }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{opt.item}</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--heading)', marginTop: 2, minHeight: '1.2em' }}>
            {priceDisplay || '\u00A0'}
          </div>
        </div>
      </div>

      {/* Brand / Model / Color, all on one row */}
      {optionLine.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8 }}>
          {optionLine.map(line => <span key={line}>{line}</span>)}
        </div>
      )}

      {/* Everything else, capped with a "+N more" expander */}
      {detailRows.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
          {visibleRows.map(([key, value]) => (
            <div key={key}><b>{key}:</b> {value}</div>
          ))}
          {(hiddenCount > 0 || expanded) && detailRows.length > MAX_VISIBLE_ROWS && (
            <button
              type="button"
              className="no-print"
              onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, padding: '4px 0' }}
            >
              {expanded ? 'Show less' : `+ ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}

      {/* Bottom action slot — same position on every card regardless of
          how much detail is above it. */}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>
        {isChosen ? (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textAlign: 'center' }}>✓ This is your selection</div>
        ) : selectable ? (
          <button className="btn btn-primary btn-sm no-print" style={{ width: '100%' }} onClick={e => { e.stopPropagation(); onChoose(opt.id); }} disabled={choosing}>
            {choosing ? 'Submitting…' : 'Choose This'}
          </button>
        ) : isAdmin && isDraft ? (
          <button className="btn btn-sm btn-danger no-print" onClick={e => { e.stopPropagation(); onDelete(opt.id); }}>Remove</button>
        ) : null}
      </div>
    </div>
  );
}
export default function MaterialSelectionPage() {
  const { session, loading } = useDocumentAuth();
  const { id, selectionId } = useParams();
  const [selection, setSelection] = useState(null);
  const [options, setOptions] = useState([]);
  const [job, setJob] = useState(null);
  const [siblingSelections, setSiblingSelections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_OPTION);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  const load = useCallback(async () => {
    const { data: sel } = await supabase.from('material_selections').select('*').eq('id', selectionId).single();
    const { data: opts } = await supabase.from('material_selection_options').select('*').eq('selection_id', selectionId).order('display_order');
    if (sel) setSelection(sel);
    if (opts) setOptions(opts);
  }, [selectionId]);

  const loadSiblings = useCallback(async () => {
    const { data } = await supabase.from('material_selections').select('id, title, status, selected_option_id').eq('job_id', id).not('sent_at', 'is', null);
    if (data) setSiblingSelections(data);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    load();
    loadSiblings();
    supabase.from('jobs').select('job_number, estimate_number, customer_name, customer_email, billing_email').eq('id', id).single().then(({ data }) => { if (data) setJob(data); });
    const channel = supabase.channel(`material-selection-${selectionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selection_options', filter: `selection_id=eq.${selectionId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `id=eq.${selectionId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_selections', filter: `job_id=eq.${id}` }, loadSiblings)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, selectionId, id, load, loadSiblings]);

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

  // Records a tentative pick — doesn't finalize anything. The customer
  // can change their mind or pick on other sheets before the final
  // "Submit All Selections" action below.
  async function chooseOption(optionId) {
    setChoosing(true);
    const { error } = await supabase.rpc('pick_material_selection_option', { target_selection_id: selectionId, chosen_option_id: optionId });
    setChoosing(false);
    if (error) {
      alert('Failed to record your pick: ' + error.message);
      return;
    }
    // Update immediately rather than waiting on the realtime round-trip.
    setSelection(prev => prev && { ...prev, selected_option_id: optionId });
    setSiblingSelections(prev => prev.map(s => s.id === selectionId ? { ...s, selected_option_id: optionId } : s));
  }

  const totalSent = siblingSelections.length;
  const pickedCount = siblingSelections.filter(s => s.selected_option_id).length;
  const allPicked = totalSent > 0 && pickedCount === totalSent;
  const jobFullyApproved = totalSent > 0 && siblingSelections.every(s => s.status === 'approved');

  async function submitAllSelections() {
    if (!allPicked) return;
    setSubmitting(true);
    const { error } = await supabase.rpc('submit_material_selections', { target_job_id: id });
    if (!error) {
      const titles = siblingSelections.map(s => s.title).join(', ');
      await supabase.from('notifications').insert({
        job_id: id,
        message: `${job?.customer_name || 'Customer'} submitted material selections${job?.job_number ? ` for Job #${job.job_number}` : ''}: ${titles}.`,
      });
      setSiblingSelections(prev => prev.map(s => ({ ...s, status: 'approved' })));
      setSelection(prev => prev && { ...prev, status: 'approved', approved_at: new Date().toISOString() });
    } else {
      alert('Failed to submit your selections: ' + error.message);
    }
    setSubmitting(false);
  }

  if (loading || !session || !selection) return null;

  const isDraft = selection.status === 'draft';
  const isApproved = selection.status === 'approved';

  return (
    <div>
      <div className="no-print doc-toolbar">
        <Link href={isAdmin ? `/jobs/${id}?tab=Updates&section=log` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

          {!isAdmin && totalSent > 0 && (
            <div style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 8,
              background: jobFullyApproved ? 'rgba(58, 107, 69, 0.1)' : 'rgba(155, 119, 61, 0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: jobFullyApproved ? '#3a6b45' : 'var(--heading)' }}>
                {jobFullyApproved ? '✓ All materials submitted' : `${pickedCount}/${totalSent} Materials Selected`}
              </div>
              {!jobFullyApproved && (
                <button
                  className="btn btn-primary btn-sm no-print"
                  onClick={submitAllSelections}
                  disabled={!allPicked || submitting}
                  title={!allPicked ? 'Pick an option on every sheet before submitting' : undefined}
                >
                  {submitting ? 'Submitting…' : allPicked ? 'Submit All Selections' : `Pick ${totalSent - pickedCount} more to submit`}
                </button>
              )}
            </div>
          )}

          <div className="material-options-grid" style={{ marginTop: 18 }}>
            {options.map(opt => (
              <OptionCard
                key={opt.id}
                opt={opt}
                isChosen={selection.selected_option_id === opt.id}
                photoUrl={photoUrls[opt.id] || opt.photo_external_url || null}
                onExpandPhoto={setLightboxUrl}
                isAdmin={isAdmin}
                isDraft={isDraft}
                selectionStatus={selection.status}
                onChoose={chooseOption}
                onDelete={deleteOption}
                choosing={choosing}
              />
            ))}
          </div>

          {options.length === 0 && <div className="empty-state">No options added yet.</div>}
        </div>

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
                <div style={{ marginTop: 10 }}>
                  <ImageDropzone file={photoFile} onFileSelected={setPhotoFile} />
                </div>
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
          defaultEmail={job?.billing_email || job?.customer_email || ''}
          docElementId="doc-preview"
          pdfFilename={`${selection.title}.pdf`}
          jobId={id}
          onSendSuccess={sendToCustomer}
        />
      )}

      {lightboxUrl && (
        <div className="photo-lightbox-overlay no-print" onClick={() => setLightboxUrl(null)}>
          <button className="photo-lightbox-close" onClick={() => setLightboxUrl(null)} aria-label="Close">×</button>
          <img src={lightboxUrl} alt="Expanded selection photo" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
