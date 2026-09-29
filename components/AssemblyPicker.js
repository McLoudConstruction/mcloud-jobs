'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { ASSEMBLY_CATEGORIES, ASSEMBLY_TIERS, fmtBand } from '../lib/assemblies';

// Lets an estimator pull a Low/Medium/High assembly's items straight into the
// scope they're building. Purely additive — it hands items back to the
// parent's onApply, the same shape AIScopeGenerator/VoiceScopeRecorder use,
// so nothing is saved until the normal "Save scope" button is pressed.
export default function AssemblyPicker({ onApply }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [items, setItems] = useState({});

  useEffect(() => {
    if (!open || templates.length) return;
    supabase.from('assembly_templates').select('*').eq('active', true).then(({ data }) => setTemplates(data || []));
  }, [open, templates.length]);

  async function pick(t) {
    let rows = items[t.id];
    if (!rows) {
      const { data } = await supabase.from('assembly_template_items').select('*').eq('template_id', t.id).order('sort_order');
      rows = data || [];
      setItems(prev => ({ ...prev, [t.id]: rows }));
    }
    if (!rows.length) { alert('This assembly has no items yet — add some under Estimating → Assemblies first.'); return; }
    onApply(rows.map(r => r.text).filter(Boolean));
    setOpen(false);
  }

  return (
    <div style={{ display: 'inline-block', marginRight: 8 }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(o => !o)}>+ From assembly</button>
      {open && (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', zIndex: 5, top: 4, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, minWidth: 260, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
            {ASSEMBLY_CATEGORIES.map(cat => (
              <div key={cat.key} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9b773d' }}>{cat.label}</div>
                {ASSEMBLY_TIERS.map(tier => {
                  const t = templates.find(x => x.category === cat.key && x.tier === tier.key);
                  if (!t) return null;
                  return (
                    <button key={tier.key} type="button" className="btn btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }} onClick={() => pick(t)}>
                      {tier.label}
                    </button>
                  );
                })}
              </div>
            ))}
            {!templates.length && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>No assemblies set up yet.</div>}
            <Link href="/estimating/assemblies" style={{ fontSize: 11 }} onClick={() => setOpen(false)}>Manage assemblies →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
