'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const ROLE_LABELS = { contractor: 'Contractor', owner: 'Customer / Owner', sub: 'Subcontractor', claimant: 'Claimant' };
const EVENT_LABELS = { signed: 'Signed', replaced: 'Re-signed (replaced earlier signature)', voided: 'Signature removed' };

function fmtWhen(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// Staff-only evidence panel for a signed document — who signed, when, from
// where, and whether office staff captured it on the signer's behalf. Reads
// signature_events (migration 132), which only staff can select. Renders
// nothing for anyone else, so it's safe to drop onto a page customers also
// open. Hidden from print/PDF.
export default function SignatureAuditTrail({ documentType, documentId, isStaff = true }) {
  const [events, setEvents] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!documentId || !isStaff) return;
    const { data, error } = await supabase
      .from('signature_events')
      .select('*')
      .eq('document_type', documentType)
      .eq('document_id', documentId)
      .order('signed_at', { ascending: true });
    if (!error) setEvents(data || []);
  }, [documentType, documentId, isStaff]);

  useEffect(() => { load(); }, [load]);

  if (!isStaff || !events || events.length === 0) return null;

  function downloadEvidence() {
    const blob = new Blob([JSON.stringify({ documentType, documentId, exportedAt: new Date().toISOString(), events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signature-evidence-${documentType}-${documentId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="no-print" style={{ marginTop: 18, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>Signature audit trail ({events.length})</span>
        <span style={{ color: 'var(--ink-soft)' }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {events.map(ev => (
            <div key={ev.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 11.5, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>
                {ROLE_LABELS[ev.signer_role] || ev.signer_role} — {EVENT_LABELS[ev.event_type] || ev.event_type}
              </div>
              <div>{ev.signer_name || '—'}{ev.signer_title ? `, ${ev.signer_title}` : ''} · {fmtWhen(ev.signed_at)}</div>
              <div style={{ color: 'var(--ink-soft)' }}>
                {ev.signer_email ? `Logged in as ${ev.signer_email}` : 'Login not recorded'}
                {ev.ip_address ? ` · IP ${ev.ip_address}` : ''}
              </div>
              {ev.on_behalf_of_signer && (
                <div style={{ color: '#9b773d', fontWeight: 600 }}>Captured by a staff login on the signer's behalf (e.g. in person on an office device).</div>
              )}
              {ev.event_type !== 'voided' && (
                <div style={{ color: 'var(--ink-soft)' }}>
                  E-sign consent {ev.consent_captured ? 'recorded' : 'not recorded'}
                  {ev.document_sha256 ? ` · document fingerprint ${ev.document_sha256.slice(0, 12)}…` : ''}
                </div>
              )}
              {ev.note && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic' }}>{ev.note}</div>}
            </div>
          ))}
          <button className="btn btn-sm" onClick={downloadEvidence} style={{ marginTop: 6 }}>Download evidence (JSON)</button>
        </div>
      )}
    </div>
  );
}
