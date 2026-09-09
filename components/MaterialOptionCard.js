'use client';
import { useState } from 'react';

// Renders one material-selection option, in one of two modes:
// - Interactive (the real customer-facing page): hover/click to pick,
//   "Choose This" button, admin "Remove" button.
// - Preview (preview=true): pure read-only snapshot of what a customer
//   would see — no click-to-select, no admin actions. Used by the
//   admin-side grouped Material Selections view so staff can see the
//   real customer-facing layout without duplicating it or accidentally
//   picking on the customer's behalf.
export default function MaterialOptionCard({ opt, isChosen, photoUrl, onExpandPhoto, isAdmin, isDraft, selectionStatus, onChoose, onDelete, choosing, preview = false }) {
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
  // sheet sent, not admin/draft, not a read-only preview), so the whole
  // card is the click target rather than needing the separate button.
  const selectable = !preview && !isAdmin && selectionStatus === 'sent';
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
          how much detail is above it. Hidden entirely in preview mode,
          since there's nothing to choose or remove there. */}
      {!preview && (
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
      )}
    </div>
  );
}
