'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import TradeBreakdownCard from './TradeBreakdownCard';
import { SERVICES_OFFERED } from '../lib/constants';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '$0.00';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function lineTotal(it) { return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0); }

export default function EstimateTab({ job, jobId }) {
  const [actions, setActions] = useState([]);
  const [items, setItems] = useState([]);
  const [margin, setMargin] = useState(job.estimate_margin_percent != null ? String(job.estimate_margin_percent) : '');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [priceBook, setPriceBook] = useState([]);
  const [newItem, setNewItem] = useState({ description: '', quantity: '1', unit_label: '', unit_price: '' });
  const [priceMatches, setPriceMatches] = useState([]);
  const [newLabor, setNewLabor] = useState({ trade: SERVICES_OFFERED[0], description: '', quantity: '1', unit_price: '' });
  const marginSaveTimer = useRef(null);

  const loadActions = useCallback(async () => {
    const { data } = await supabase.from('job_scope_actions').select('*').eq('job_id', jobId).order('trade');
    if (data) setActions(data);
  }, [jobId]);

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from('job_estimate_items').select('*').eq('job_id', jobId).order('created_at');
    if (data) setItems(data);
  }, [jobId]);

  useEffect(() => {
    loadActions();
    loadItems();
    supabase.from('material_prices').select('*').then(({ data }) => { if (data) setPriceBook(data); });
    const channel = supabase.channel(`estimate-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_estimate_items', filter: `job_id=eq.${jobId}` }, loadItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_scope_actions', filter: `job_id=eq.${jobId}` }, loadActions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadActions, loadItems]);

  async function suggestMaterials() {
    setSuggesting(true);
    setSuggestError('');
    try {
      const res = await fetch('/api/suggest-materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to suggest materials.');
      await supabase.from('job_estimate_items').insert(data.materials.map(m => ({
        job_id: jobId,
        category: 'material',
        description: m.description,
        quantity: m.quantity,
        unit_label: m.unit_label,
        unit_price: 0,
        source: 'suggested',
        buffer_note: m.buffer_note,
      })));
    } catch (err) {
      setSuggestError(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  const [suggestingTrades, setSuggestingTrades] = useState(false);

  // Not an AI dollar guess — just a structured starting point, one draft
  // row per distinct trade already in the action list, cost left at $0
  // for you to fill in. Subcontractor pricing depends on your actual
  // relationships, not something a model should ever invent.
  async function suggestTradesFromActions() {
    setSuggestingTrades(true);
    try {
      const trades = [...new Set(actions.map(a => a.trade).filter(Boolean))];
      // Re-read what's already there directly from the database right
      // before inserting, rather than trusting React state — closes the
      // race where a second click (or a slow realtime update) sees a
      // stale list and re-adds a trade that was just added a moment ago.
      const { data: currentLabor } = await supabase.from('job_estimate_items').select('unit_label').eq('job_id', jobId).eq('category', 'labor');
      const existingTrades = new Set((currentLabor || []).map(it => it.unit_label));
      const toAdd = trades.filter(t => !existingTrades.has(t));
      if (toAdd.length === 0) return;
      await supabase.from('job_estimate_items').insert(toAdd.map(trade => ({
        job_id: jobId,
        category: 'labor',
        description: `${trade} — labor/subcontractor cost`,
        quantity: 1,
        unit_label: trade,
        unit_price: 0,
        source: 'suggested',
      })));
    } finally {
      setSuggestingTrades(false);
    }
  }

  function updateLocalItem(itemId, field, value) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, [field]: value } : it));
  }

  async function persistItem(itemId, field, value) {
    await supabase.from('job_estimate_items').update({ [field]: value }).eq('id', itemId);
  }

  async function deleteItem(itemId) {
    setItems(prev => prev.filter(it => it.id !== itemId));
    await supabase.from('job_estimate_items').delete().eq('id', itemId);
  }

  async function savePriceBook(item) {
    if (!item.description.trim() || !item.unit_price) return;
    await supabase.from('material_prices').upsert({
      item_name: item.description.trim(),
      unit_label: item.unit_label,
      unit_price: item.unit_price,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'item_name' });
    const { data } = await supabase.from('material_prices').select('*');
    if (data) setPriceBook(data);
  }

  function searchPriceBook(term) {
    setNewItem(prev => ({ ...prev, description: term }));
    if (!term.trim()) { setPriceMatches([]); return; }
    setPriceMatches(priceBook.filter(p => p.item_name.toLowerCase().includes(term.toLowerCase())).slice(0, 5));
  }

  function applyPriceMatch(p) {
    setNewItem(prev => ({ ...prev, description: p.item_name, unit_label: p.unit_label || '', unit_price: String(p.unit_price) }));
    setPriceMatches([]);
  }

  async function addManualItem(e) {
    e.preventDefault();
    if (!newItem.description.trim()) return;
    await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      category: 'material',
      description: newItem.description.trim(),
      quantity: parseFloat(newItem.quantity) || 1,
      unit_label: newItem.unit_label || null,
      unit_price: parseFloat(newItem.unit_price) || 0,
      source: 'manual',
    });
    setNewItem({ description: '', quantity: '1', unit_label: '', unit_price: '' });
  }

  async function addLaborItem(e) {
    e.preventDefault();
    await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      category: 'labor',
      description: newLabor.description.trim() || `${newLabor.trade} — labor/subcontractor cost`,
      quantity: parseFloat(newLabor.quantity) || 1,
      unit_label: newLabor.trade,
      unit_price: parseFloat(newLabor.unit_price) || 0,
      source: 'manual',
    });
    setNewLabor({ trade: SERVICES_OFFERED[0], description: '', quantity: '1', unit_price: '' });
  }

  function saveMargin(value) {
    setMargin(value);
    clearTimeout(marginSaveTimer.current);
    marginSaveTimer.current = setTimeout(() => {
      supabase.from('jobs').update({ estimate_margin_percent: value ? parseFloat(value) : null }).eq('id', jobId);
    }, 500);
  }

  const materialItems = items.filter(it => it.category !== 'labor');
  const laborItems = items.filter(it => it.category === 'labor');
  const materialSubtotal = materialItems.reduce((s, it) => s + lineTotal(it), 0);
  const laborSubtotal = laborItems.reduce((s, it) => s + lineTotal(it), 0);
  const subtotal = materialSubtotal + laborSubtotal;
  const marginNum = parseFloat(margin) || 0;
  const salePrice = marginNum > 0 && marginNum < 100 ? subtotal / (1 - marginNum / 100) : subtotal;
  const marginDollars = salePrice - subtotal;

  return (
    <>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 16, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 14px' }}>
        Nothing here affects this job's real Contract Price or Financials until you decide to use it. Every quantity and price is yours to set; nothing is calculated or padded for you — including subcontractor cost, which only you actually know.
      </div>

      <div className="estimate-grid">
        <div className="estimate-main">
          <div className="card">
            <h3>Materials</h3>

            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={suggestMaterials} disabled={suggesting || actions.length === 0}>
                {suggesting ? 'Suggesting…' : 'Suggest materials from action list'}
              </button>
            </div>
            {actions.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
                No exhaustive action list yet — build one on the Scope tab first, or just add line items manually below.
              </div>
            )}
            {suggestError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{suggestError}</div>}

            <div className="estimate-table" style={{ marginTop: 16 }}>
              <div className="estimate-row estimate-header-row">
                <div>Description</div>
                <div>Qty</div>
                <div>Unit</div>
                <div>Unit Price</div>
                <div>Total</div>
                <div></div>
              </div>
              {materialItems.map(it => (
                <div key={it.id} className="estimate-row">
                  <div>
                    <input
                      value={it.description}
                      onChange={e => updateLocalItem(it.id, 'description', e.target.value)}
                      onBlur={e => persistItem(it.id, 'description', e.target.value)}
                    />
                    {it.source === 'suggested' && <span className="estimate-tag">Suggested</span>}
                    {it.buffer_note && <div className="estimate-buffer-note">{it.buffer_note}</div>}
                  </div>
                  <div>
                    <input
                      type="number" step="any"
                      value={it.quantity}
                      onChange={e => updateLocalItem(it.id, 'quantity', e.target.value)}
                      onBlur={e => persistItem(it.id, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <input
                      value={it.unit_label || ''}
                      onChange={e => updateLocalItem(it.id, 'unit_label', e.target.value)}
                      onBlur={e => persistItem(it.id, 'unit_label', e.target.value)}
                    />
                  </div>
                  <div>
                    <input
                      type="number" step="0.01"
                      value={it.unit_price}
                      onChange={e => updateLocalItem(it.id, 'unit_price', e.target.value)}
                      onBlur={e => persistItem(it.id, 'unit_price', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="estimate-line-total">{fmtMoney(lineTotal(it))}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" title="Save price to your price book" onClick={() => savePriceBook(it)}>Save</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteItem(it.id)}>×</button>
                  </div>
                </div>
              ))}
              {materialItems.length === 0 && <div className="empty-state" style={{ padding: '14px 0' }}>No materials yet.</div>}
            </div>

            <form onSubmit={addManualItem} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 16, position: 'relative' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 8 }}>+ Add material</div>
              <div className="estimate-add-grid">
                <input placeholder="Description (e.g. 2x4x8 stud)" value={newItem.description} onChange={e => searchPriceBook(e.target.value)} required />
                <input type="number" step="any" placeholder="Qty" value={newItem.quantity} onChange={e => setNewItem(prev => ({ ...prev, quantity: e.target.value }))} />
                <input placeholder="Unit" value={newItem.unit_label} onChange={e => setNewItem(prev => ({ ...prev, unit_label: e.target.value }))} />
                <input type="number" step="0.01" placeholder="Unit price" value={newItem.unit_price} onChange={e => setNewItem(prev => ({ ...prev, unit_price: e.target.value }))} />
                <button className="btn btn-primary btn-sm" type="submit">Add</button>
              </div>
              {priceMatches.length > 0 && (
                <div style={{ position: 'absolute', background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 6, marginTop: 2, zIndex: 5, width: 280 }}>
                  {priceMatches.map(p => (
                    <div key={p.id} style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => applyPriceMatch(p)}>
                      {p.item_name} — {fmtMoney(p.unit_price)}
                    </div>
                  ))}
                </div>
              )}
            </form>
          </div>

          <div className="card">
            <h3>Subcontractor Cost</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 12 }}>
              What the trade itself costs you — separate from the materials they install. Never AI-suggested — nobody but you knows what your subs actually charge.
            </div>

            <div className="section-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={suggestTradesFromActions} disabled={suggestingTrades || actions.length === 0}>
                {suggestingTrades ? 'Adding…' : 'Add a row per trade from action list'}
              </button>
            </div>

            <div className="estimate-table" style={{ marginTop: 16 }}>
              <div className="estimate-row estimate-header-row">
                <div>Description</div>
                <div>Qty</div>
                <div>Trade</div>
                <div>Cost</div>
                <div>Total</div>
                <div></div>
              </div>
              {laborItems.map(it => (
                <div key={it.id} className="estimate-row">
                  <div>
                    <input
                      value={it.description}
                      onChange={e => updateLocalItem(it.id, 'description', e.target.value)}
                      onBlur={e => persistItem(it.id, 'description', e.target.value)}
                    />
                    {it.source === 'suggested' && <span className="estimate-tag">Suggested</span>}
                  </div>
                  <div>
                    <input
                      type="number" step="any"
                      value={it.quantity}
                      onChange={e => updateLocalItem(it.id, 'quantity', e.target.value)}
                      onBlur={e => persistItem(it.id, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <select
                      value={it.unit_label || ''}
                      onChange={e => { updateLocalItem(it.id, 'unit_label', e.target.value); persistItem(it.id, 'unit_label', e.target.value); }}
                    >
                      {SERVICES_OFFERED.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <input
                      type="number" step="0.01"
                      value={it.unit_price}
                      onChange={e => updateLocalItem(it.id, 'unit_price', e.target.value)}
                      onBlur={e => persistItem(it.id, 'unit_price', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="estimate-line-total">{fmtMoney(lineTotal(it))}</div>
                  <div>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteItem(it.id)}>×</button>
                  </div>
                </div>
              ))}
              {laborItems.length === 0 && <div className="empty-state" style={{ padding: '14px 0' }}>No subcontractor costs yet.</div>}
            </div>

            <form onSubmit={addLaborItem} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 8 }}>+ Add subcontractor cost</div>
              <div className="estimate-add-grid">
                <input placeholder="Description (optional)" value={newLabor.description} onChange={e => setNewLabor(prev => ({ ...prev, description: e.target.value }))} />
                <input type="number" step="any" placeholder="Qty" value={newLabor.quantity} onChange={e => setNewLabor(prev => ({ ...prev, quantity: e.target.value }))} />
                <select value={newLabor.trade} onChange={e => setNewLabor(prev => ({ ...prev, trade: e.target.value }))}>
                  {SERVICES_OFFERED.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" step="0.01" placeholder="Cost" value={newLabor.unit_price} onChange={e => setNewLabor(prev => ({ ...prev, unit_price: e.target.value }))} />
                <button className="btn btn-primary btn-sm" type="submit">Add</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Margin &amp; Sale Price</h3>
            <div className="portal-info-grid">
              <div>
                <div className="portal-info-label">Materials</div>
                <div className="portal-info-value">{fmtMoney(materialSubtotal)}</div>
              </div>
              <div>
                <div className="portal-info-label">Subcontractor Cost</div>
                <div className="portal-info-value">{fmtMoney(laborSubtotal)}</div>
              </div>
              <div>
                <div className="portal-info-label">Total Cost</div>
                <div className="portal-info-value">{fmtMoney(subtotal)}</div>
              </div>
              <div>
                <label style={{ marginBottom: 4 }}>Margin %</label>
                <input type="number" step="0.1" min="0" max="99" value={margin} onChange={e => saveMargin(e.target.value)} placeholder="e.g. 25" />
              </div>
              <div>
                <div className="portal-info-label">Margin $</div>
                <div className="portal-info-value">{fmtMoney(marginDollars)}</div>
              </div>
              <div>
                <div className="portal-info-label">Final Sale Price</div>
                <div className="portal-info-value" style={{ fontSize: 20 }}>{fmtMoney(salePrice)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="estimate-sidebar">
          <TradeBreakdownCard jobId={jobId} readOnly linkHref={`/jobs/${jobId}?tab=Scope`} />
        </div>
      </div>

      <style jsx global>{`
        .estimate-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; align-items: start; }
        .estimate-sidebar { position: sticky; top: 20px; }
        .estimate-table { display: flex; flex-direction: column; }
        .estimate-row { display: grid; grid-template-columns: 2fr 70px 110px 100px 100px 90px; gap: 8px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .estimate-header-row { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); border-bottom: 1px solid var(--panel-line); }
        .estimate-row input, .estimate-row select { font-size: 12.5px; padding: 6px 8px; }
        .estimate-line-total { font-size: 13px; font-weight: 700; padding-top: 7px; }
        .estimate-tag { display: inline-block; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; background: var(--panel); color: var(--gold); padding: 2px 6px; border-radius: 8px; margin-top: 4px; }
        .estimate-buffer-note { font-size: 10.5px; color: #a17c3f; margin-top: 4px; font-style: italic; }
        .estimate-add-grid { display: grid; grid-template-columns: 2fr 70px 110px 100px auto; gap: 8px; align-items: center; }
        @media (max-width: 900px) {
          .estimate-grid { grid-template-columns: 1fr; }
          .estimate-sidebar { position: static; }
          .estimate-row, .estimate-header-row, .estimate-add-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
