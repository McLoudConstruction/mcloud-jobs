'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useRequireAuth } from '../../../lib/useAuth';
import AppShell from '../../../components/AppShell';
import Breadcrumb from '../../../components/Breadcrumb';
import { ASSEMBLY_CATEGORIES, ASSEMBLY_TIERS, fmtBand } from '../../../lib/assemblies';

// Reusable Low/Medium/High scope-item kits for Kitchen and Bath remodels.
// Staff manage them here; applying one to an estimate happens from the Scope
// of Work card on the job page, which just copies a template's items in —
// this page only owns the library itself.
export default function AssemblyTemplatesPage() {
  const { session, loading } = useRequireAuth();
  const [templates, setTemplates] = useState([]);
  const [items, setItems] = useState({}); // template_id -> items[]
  const [category, setCategory] = useState('kitchen');
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data: t, error: err } = await supabase.from('assembly_templates').select('*').order('category').order('tier').order('sort_order');
    if (err) { setError(`${err.message} — make sure migration 141 has been run.`); return; }
    setTemplates(t || []);
    const { data: i } = await supabase.from('assembly_template_items').select('*').order('sort_order');
    const byTemplate = {};
    for (const row of i || []) (byTemplate[row.template_id] = byTemplate[row.template_id] || []).push(row);
    setItems(byTemplate);
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  async function ensureTemplate(tier) {
    const existing = templates.find(t => t.category === category && t.tier === tier);
    if (existing) return existing.id;
    const label = `${ASSEMBLY_CATEGORIES.find(c => c.key === category)?.label} — ${ASSEMBLY_TIERS.find(t => t.key === tier)?.label}`;
    const { data, error: err } = await supabase.from('assembly_templates').insert({ category, tier, label }).select().single();
    if (err) { setError(err.message); return null; }
    await load();
    return data.id;
  }

  async function addItem(templateId) {
    const { error: err } = await supabase.from('assembly_template_items').insert({ template_id: templateId, text: '', sort_order: (items[templateId]?.length || 0) });
    if (err) setError(err.message); else load();
  }

  async function saveItem(item, patch) {
    const { error: err } = await supabase.from('assembly_template_items').update(patch).eq('id', item.id);
    if (err) setError(err.message);
  }

  async function removeItem(id) {
    const { error: err } = await supabase.from('assembly_template_items').delete().eq('id', id);
    if (err) setError(err.message); else load();
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container container-wide">
        <Breadcrumb href="/estimating" label="Estimating" />
        <div className="top-actions"><h2 style={{ margin: 0, color: 'var(--heading)' }}>Assemblies</h2></div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 14px', maxWidth: 640 }}>
          Starting-point scope kits for Kitchen and Bath remodels. Apply one to a job from its Scope of Work, then tailor it to that project — the price band here is a rough starting point, not a quote.
        </div>
        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

        <div className="tab-sections-pills" style={{ marginBottom: 16 }}>
          {ASSEMBLY_CATEGORIES.map(c => (
            <button key={c.key} type="button" className={`tab-section-btn${category === c.key ? ' active' : ''}`} onClick={() => setCategory(c.key)}>{c.label}</button>
          ))}
        </div>

        {ASSEMBLY_TIERS.map(tier => {
          const template = templates.find(t => t.category === category && t.tier === tier.key);
          const rows = template ? (items[template.id] || []) : [];
          const isOpen = openId === (template?.id || tier.key);
          return (
            <div key={tier.key} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={async () => {
                const id = template?.id || await ensureTemplate(tier.key);
                setOpenId(isOpen ? null : id);
              }}>
                <h3 style={{ margin: 0 }}>{tier.label}{rows.length ? ` (${rows.length} item${rows.length === 1 ? '' : 's'})` : ''}</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{isOpen ? 'Hide' : template ? 'Edit' : 'Set up'}</span>
              </div>
              {isOpen && template && (
                <div style={{ marginTop: 12 }}>
                  {rows.length === 0 && <div className="empty-state">No items yet.</div>}
                  {rows.map(row => (
                    <div key={row.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                      <textarea defaultValue={row.text} onBlur={e => saveItem(row, { text: e.target.value })} placeholder="Scope item text" style={{ flex: 2 }} />
                      <input defaultValue={row.price_low ?? ''} onBlur={e => saveItem(row, { price_low: e.target.value ? Number(e.target.value) : null })} placeholder="Low $" style={{ width: 100 }} />
                      <input defaultValue={row.price_high ?? ''} onBlur={e => saveItem(row, { price_high: e.target.value ? Number(e.target.value) : null })} placeholder="High $" style={{ width: 100 }} />
                      <button className="row-remove" onClick={() => removeItem(row.id)}>×</button>
                    </div>
                  ))}
                  <div className="section-actions">
                    <button className="btn btn-sm" onClick={() => addItem(template.id)}>+ Add item</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
