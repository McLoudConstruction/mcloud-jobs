'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import TradeBreakdownCard from './TradeBreakdownCard';
import { SERVICES_OFFERED, contractPathFor } from '../lib/constants';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '$0.00';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function lineTotal(it) { return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0); }

export default function EstimateTab({ job, jobId, children }) {
  const [actions, setActions] = useState([]);
  const [items, setItems] = useState([]);
  const [margin, setMargin] = useState(job.estimate_margin_percent != null ? String(job.estimate_margin_percent) : '');
  const [salesTax, setSalesTax] = useState(job.estimate_sales_tax_percent != null ? String(job.estimate_sales_tax_percent) : '');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [priceBook, setPriceBook] = useState([]);
  const [newItem, setNewItem] = useState({ description: '', quantity: '1', unit_price: '' });
  const [priceMatches, setPriceMatches] = useState([]);
  const [newLabor, setNewLabor] = useState({ trade: SERVICES_OFFERED[0], description: '', unit_price: '' });
  const marginSaveTimer = useRef(null);
  const taxSaveTimer = useRef(null);
  const materialDescRef = useRef(null);
  const laborDescRef = useRef(null);

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
  const [pushing, setPushing] = useState(false);
  const [pushedFlash, setPushedFlash] = useState('');

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
    const { data, error } = await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      category: 'material',
      description: newItem.description.trim(),
      quantity: parseFloat(newItem.quantity) || 1,
      unit_price: parseFloat(newItem.unit_price) || 0,
      source: 'manual',
    }).select().single();
    if (!error && data) setItems(prev => [...prev, data]);
    setNewItem({ description: '', quantity: '1', unit_price: '' });
    materialDescRef.current?.focus();
  }

  async function addLaborItem(e) {
    e.preventDefault();
    const { data, error } = await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      category: 'labor',
      description: newLabor.description.trim() || `${newLabor.trade} — labor/subcontractor cost`,
      quantity: 1,
      unit_label: newLabor.trade,
      unit_price: parseFloat(newLabor.unit_price) || 0,
      source: 'manual',
    }).select().single();
    if (!error && data) setItems(prev => [...prev, data]);
    setNewLabor({ trade: SERVICES_OFFERED[0], description: '', unit_price: '' });
    laborDescRef.current?.focus();
  }

  function saveMargin(value) {
    setMargin(value);
    clearTimeout(marginSaveTimer.current);
    marginSaveTimer.current = setTimeout(() => {
      supabase.from('jobs').update({ estimate_margin_percent: value ? parseFloat(value) : null }).eq('id', jobId);
    }, 500);
  }

  function saveSalesTax(value) {
    setSalesTax(value);
    clearTimeout(taxSaveTimer.current);
    taxSaveTimer.current = setTimeout(() => {
      supabase.from('jobs').update({ estimate_sales_tax_percent: value ? parseFloat(value) : null }).eq('id', jobId);
    }, 500);
  }

  const materialItems = items.filter(it => it.category !== 'labor');
  const laborItems = items.filter(it => it.category === 'labor');
  const materialSubtotal = materialItems.reduce((s, it) => s + lineTotal(it), 0);
  const laborSubtotal = laborItems.reduce((s, it) => s + lineTotal(it), 0);
  const taxNum = parseFloat(salesTax) || 0;
  const salesTaxDollars = materialSubtotal * (taxNum / 100);
  const subtotal = materialSubtotal + salesTaxDollars + laborSubtotal;
  const marginNum = parseFloat(margin) || 0;
  const salePrice = marginNum > 0 && marginNum < 100 ? subtotal / (1 - marginNum / 100) : subtotal;
  const marginDollars = salePrice - subtotal;

  async function pushToContractPrice() {
    setPushing(true);
    await supabase.from('jobs').update({
      contract_price: salePrice,
      projected_cost: subtotal,
    }).eq('id', jobId);
    setPushing(false);
    setPushedFlash('Saved to this job\u2019s Contract Price & Projected Cost — no need to re-enter it on the Project tab.');
    setTimeout(() => setPushedFlash(''), 6000);
  }

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
                <input ref={materialDescRef} placeholder="Description (e.g. 2x4x8 stud)" value={newItem.description} onChange={e => searchPriceBook(e.target.value)} required />
                <input type="number" step="any" placeholder="Qty" value={newItem.quantity} onChange={e => setNewItem(prev => ({ ...prev, quantity: e.target.value }))} />
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
                <input ref={laborDescRef} placeholder="Description (optional)" value={newLabor.description} onChange={e => setNewLabor(prev => ({ ...prev, description: e.target.value }))} />
                <select value={newLabor.trade} onChange={e => setNewLabor(prev => ({ ...prev, trade: e.target.value }))}>
                  {SERVICES_OFFERED.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" step="0.01" placeholder="Cost" value={newLabor.unit_price} onChange={e => setNewLabor(prev => ({ ...prev, unit_price: e.target.value }))} />
                <button className="btn btn-primary btn-sm" type="submit">Add</button>
              </div>
            </form>
          </div>

          {children}
        </div>

        <div className="estimate-sidebar">
          <div className="card">
            <h3>Generate &amp; Send</h3>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Once the pricing below is where you want it, generate the customer-facing estimate document.
            </div>
            <div className="section-actions" style={{ marginTop: 0 }}>
              <Link href={`/jobs/${jobId}/proposal`} className="btn btn-primary">Generate Estimate Document →</Link>
              {job.proposal_sent_at && (
                <Link href={contractPathFor(job)} className="btn">View / Send Contract →</Link>
              )}
            </div>
          </div>

          <div className="card">
            <h3>Margin &amp; Sale Price</h3>
            <table className="estimate-margin-table">
              <tbody>
                <tr><td>Materials</td><td>{fmtMoney(materialSubtotal)}</td></tr>
                <tr>
                  <td>Sales Tax %</td>
                  <td><input type="number" step="0.001" min="0" value={salesTax} onChange={e => saveSalesTax(e.target.value)} placeholder="e.g. 8.6" /></td>
                </tr>
                <tr><td>Sales Tax $</td><td>{fmtMoney(salesTaxDollars)}</td></tr>
                <tr><td>Subcontractor Cost</td><td>{fmtMoney(laborSubtotal)}</td></tr>
                <tr className="estimate-margin-total-row"><td>Total Cost</td><td>{fmtMoney(subtotal)}</td></tr>
                <tr>
                  <td>Margin %</td>
                  <td><input type="number" step="0.1" min="0" max="99" value={margin} onChange={e => saveMargin(e.target.value)} placeholder="e.g. 25" /></td>
                </tr>
                <tr><td>Margin $</td><td>{fmtMoney(marginDollars)}</td></tr>
                <tr className="estimate-margin-total-row"><td>Final Sale Price</td><td style={{ fontSize: 16 }}>{fmtMoney(salePrice)}</td></tr>
              </tbody>
            </table>
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={pushToContractPrice} disabled={pushing || subtotal === 0}>
                {pushing ? 'Saving…' : "Use as this Job's Contract Price"}
              </button>
            </div>
            {pushedFlash && <div style={{ fontSize: 12, color: '#3a6b45', marginTop: 8 }}>{pushedFlash}</div>}
          </div>

          <TradeBreakdownCard jobId={jobId} readOnly linkHref={`/jobs/${jobId}?tab=Scope`} />
        </div>
      </div>
    </>
  );
}
