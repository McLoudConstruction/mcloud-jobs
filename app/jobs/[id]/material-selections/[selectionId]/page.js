'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../../lib/supabaseClient';
import { useDocumentAuth } from '../../../../../lib/useDocumentAuth';
import SendDocModal from '../../../../../components/SendDocModal';
import ImageDropzone from '../../../../../components/ImageDropzone';

const EMPTY_OPTION = { brand: '', item: '', model_number: '', color: '' };

// Maps common material/finish color language to a representative swatch
// color for the hover/pin border — free text ("Spot Resist Stainless",
// "Oil Rubbed Bronze") rather than a fixed palette, so this matches by
// keyword rather than exact value. Falls back to the app's own brass
// accent for anything unrecognized, rather than showing nothing.
function colorForSwatch(colorText) {
  if (!colorText) return null;
  const t = colorText.toLowerCase();
  const table = [
    [['chrome', 'stainless', 'nickel', 'silver', 'platinum', 'pewter'], '#adb5bd'],
    [['bronze', 'oil rubbed', 'copper', 'rust'], '#6b4226'],
    [['brass', 'gold', 'brushed gold'], '#b8860b'],
    [['black', 'matte black', 'onyx', 'graphite'], '#1a1a1a'],
    [['white', 'bisque', 'almond', 'linen', 'ivory'], '#f0ede4'],
    [['gray', 'grey', 'slate', 'charcoal'], '#6b7280'],
    [['espresso', 'walnut', 'dark wood', 'ebony'], '#3e2723'],
    [['oak', 'natural wood', 'honey', 'maple'], '#c19a6b'],
    [['cherry', 'mahogany'], '#5d2e1f'],
    [['red'], '#c0392b'],
    [['blue', 'navy'], '#2c5282'],
    [['green'], '#2f6b3a'],
    [['beige', 'tan'], '#d2b48c'],
  ];
  for (const [keywords, hex] of table) {
    if (keywords.some(k => t.indexOf(k) !== -1)) return hex;
  }
  return '#9B773D'; // brass accent — unrecognized color text still gets a visible cue
}

function OptionCard({ opt, isChosen, photoUrl, onExpandPhoto, isAdmin, isDraft, selectionStatus, onChoose, onDelete, choosing }) {
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
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

  const swatch = colorForSwatch(opt.color);
  const showSwatchBorder = swatch && (hovering || pinned);
  const borderColor = isChosen ? 'var(--accent)' : showSwatchBorder ? swatch : 'var(--line)';
  const borderWidth = isChosen || showSwatchBorder ? 2 : 1;

  return (
    <div
      className="material-option-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => setPinned(p => !p)}
      style={{
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 8,
        padding: 14,
        cursor: swatch ? 'pointer' : 'default',
        transition: 'border-color 150ms ease',
      }}
    >
      {/* Photo + price, front and center */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        {photoUrl && (
          <button type="button" className="selection-photo-btn no-print" onClick={e => { e.stopPropagation(); onExpandPhoto(photoUrl); }} aria-label={`Expand photo of ${opt.item}`}>
            <img src={photoUrl} alt={opt.item} style={{ width: 100, height: 100, objectFit: 'contain' }} />
          </button>
        )}
        {priceDisplay && (
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--heading)', marginTop: 6 }}>{priceDisplay}</div>
        )}
      </div>

      {/* Simple header */}
      <div style={{ fontWeight: 700, fontSize: 14, textAlign: 'center' }}>{opt.item}</div>

      {/* Brand / Model / Color, all on one row */}
      {optionLine.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 14px', fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>
          {optionLine.map(line => <span key={line}>{line}</span>)}
        </div>
      )}

      {/* Everything else, capped with a "+N more" expander */}
      {detailRows.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.7 }}>
          {visibleRows.map(([key, value]) => (
            <div key={key}><b>{key}:</b> {value}</div>
          ))}
          {(hiddenCount > 0 || expanded) && detailRows.length > MAX_VISIBLE_ROWS && (
            <button
              type="button"
              className="no-print"
              onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '4px 0' }}
            >
              {expanded ? 'Show less' : `+ ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}

      {isChosen && (
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: '#3a6b45', textAlign: 'center' }}>✓ Selected</div>
      )}
      {!isAdmin && selectionStatus === 'sent' && (
        <button className="btn btn-primary btn-sm no-print" style={{ marginTop: 12 }} onClick={e => { e.stopPropagation(); onChoose(opt.id); }} disabled={choosing}>
          {choosing ? 'Submitting…' : 'Choose This'}
        </button>
      )}
      {isAdmin && isDraft && (
        <button className="btn btn-sm btn-danger no-print" style={{ marginTop: 12 }} onClick={e => { e.stopPropagation(); onDelete(opt.id); }}>Remove</button>
      )}
    </div>
  );
}
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
  const [lightboxUrl, setLightboxUrl] = useState(null);

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
        <Link href={isAdmin ? `/jobs/${id}?tab=Updates&section=log` : '/customerportal/projects'} className="btn btn-sm">← Back</Link>
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
