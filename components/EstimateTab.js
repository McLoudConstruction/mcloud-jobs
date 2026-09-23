'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import TradeBreakdownCard from './TradeBreakdownCard';
import MaterialImageChooser from './MaterialImageChooser';
import { SERVICES_OFFERED } from '../lib/constants';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '$0.00';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function lineTotal(it) { return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0); }

// In multi-option mode, every cost item (material or subcontractor line)
// belongs to one scope option — job_estimate_items.option_id — and each
// option carries its own margin/sales-tax percent and its own computed
// price (estimate_scope_options.price/projected_cost), same fields the
// job itself always has for the single-scope case. The option switcher
// below (Cost and Pricing sections both) picks which option's numbers
// you're looking at/editing; the choice is kept in the URL (?costOption=)
// so it survives navigating between the Cost and Pricing sub-tabs.
export default function EstimateTab({ job, jobId, section, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isMulti = job.estimate_mode === 'multi';

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

  // ─── Scope options (multi-option mode) ───────────────────────────────
  const [scopeOptions, setScopeOptions] = useState([]);
  const urlOptionId = searchParams.get('costOption');
  const [selectedOptionId, setSelectedOptionId] = useState(urlOptionId || null);

  const loadScopeOptions = useCallback(async () => {
    if (!isMulti) { setScopeOptions([]); return; }
    const { data } = await supabase.from('estimate_scope_options').select('*').eq('job_id', jobId).order('sort_order');
    setScopeOptions(data || []);
  }, [jobId, isMulti]);

  useEffect(() => {
    loadScopeOptions();
    if (!isMulti) return;
    const channel = supabase.channel(`estimate-scope-options-costing-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_scope_options', filter: `job_id=eq.${jobId}` }, loadScopeOptions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, isMulti, loadScopeOptions]);

  // Keeps the selected option valid as options load/change; defaults to
  // the first one. Deliberately not re-running on every scopeOptions
  // refresh once a valid selection exists, so an in-progress pick isn't
  // second-guessed by a realtime update from something else.
  useEffect(() => {
    if (!isMulti) { setSelectedOptionId(null); return; }
    if (scopeOptions.length === 0) { setSelectedOptionId(null); return; }
    setSelectedOptionId(prev => {
      if (prev && scopeOptions.some(o => o.id === prev)) return prev;
      if (urlOptionId && scopeOptions.some(o => o.id === urlOptionId)) return urlOptionId;
      return scopeOptions[0].id;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, scopeOptions]);

  const selectedOption = scopeOptions.find(o => o.id === selectedOptionId) || null;

  function selectOption(id) {
    setSelectedOptionId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('costOption', id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Margin/sales-tax fields track whichever target (the job, or the
  // selected option) is currently in view — reset only when the target
  // itself changes, not on every refetch, so typing isn't clobbered.
  useEffect(() => {
    if (isMulti) {
      setMargin(selectedOption?.estimate_margin_percent != null ? String(selectedOption.estimate_margin_percent) : '');
      setSalesTax(selectedOption?.estimate_sales_tax_percent != null ? String(selectedOption.estimate_sales_tax_percent) : '');
    } else {
      setMargin(job.estimate_margin_percent != null ? String(job.estimate_margin_percent) : '');
      setSalesTax(job.estimate_sales_tax_percent != null ? String(job.estimate_sales_tax_percent) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, selectedOptionId]);

  const loadActions = useCallback(async () => {
    const { data } = await supabase.from('job_scope_actions').select('*').eq('job_id', jobId).order('trade');
    if (data) setActions(data);
  }, [jobId]);

  const loadItems = useCallback(async () => {
    if (isMulti && !selectedOptionId) { setItems([]); return; }
    let query = supabase.from('job_estimate_items').select('*').eq('job_id', jobId).order('created_at');
    query = isMulti ? query.eq('option_id', selectedOptionId) : query.is('option_id', null);
    const { data } = await query;
    if (data) setItems(data);
  }, [jobId, isMulti, selectedOptionId]);

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
      if (!data.materials || data.materials.length === 0) throw new Error('The AI returned no materials to add.');
      const { error: insertError } = await supabase.from('job_estimate_items').insert(data.materials.map(m => ({
        job_id: jobId,
        option_id: isMulti ? selectedOptionId : null,
        category: 'material',
        description: m.description,
        quantity: m.quantity,
        unit_label: m.unit_label,
        unit_price: 0,
        source: 'suggested',
        buffer_note: m.buffer_note,
      })));
      if (insertError) throw insertError;
      // Don't rely solely on the realtime subscription to pick this up —
      // same class of bug as elsewhere in this app where a table wasn't
      // reliably in the Supabase realtime publication. Refresh directly
      // so the new rows show up immediately regardless.
      await loadItems();
    } catch (err) {
      setSuggestError(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  const [suggestingTrades, setSuggestingTrades] = useState(false);
  const [tradesError, setTradesError] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushedFlash, setPushedFlash] = useState('');

  // Not an AI dollar guess — just a structured starting point, one draft
  // row per distinct trade already in the action list, cost left at $0
  // for you to fill in. Subcontractor pricing depends on your actual
  // relationships, not something a model should ever invent.
  async function suggestTradesFromActions() {
    setSuggestingTrades(true);
    setTradesError('');
    try {
      const trades = [...new Set(actions.map(a => a.trade).filter(Boolean))];
      // Re-read what's already there directly from the database right
      // before inserting, rather than trusting React state — closes the
      // race where a second click (or a slow realtime update) sees a
      // stale list and re-adds a trade that was just added a moment ago.
      let existingQuery = supabase.from('job_estimate_items').select('unit_label').eq('job_id', jobId).eq('category', 'labor');
      existingQuery = isMulti ? existingQuery.eq('option_id', selectedOptionId) : existingQuery.is('option_id', null);
      const { data: currentLabor } = await existingQuery;
      const existingTrades = new Set((currentLabor || []).map(it => it.unit_label));
      const toAdd = trades.filter(t => !existingTrades.has(t));
      if (toAdd.length === 0) return;
      const { error: insertError } = await supabase.from('job_estimate_items').insert(toAdd.map(trade => ({
        job_id: jobId,
        option_id: isMulti ? selectedOptionId : null,
        category: 'labor',
        description: `${trade} — labor/subcontractor cost`,
        quantity: 1,
        unit_label: trade,
        unit_price: 0,
        source: 'suggested',
      })));
      if (insertError) throw insertError;
      // Same fix as suggestMaterials above — don't wait on the realtime
      // subscription to pick this up, refresh directly so the new rows
      // show immediately instead of needing a manual page reload.
      await loadItems();
    } catch (err) {
      setTradesError(err.message);
    } finally {
      setSuggestingTrades(false);
    }
  }

  const [rowStatus, setRowStatus] = useState({}); // { [itemId]: 'saved' | 'error' }
  const [chooserItemId, setChooserItemId] = useState(null);
  const [signedThumbs, setSignedThumbs] = useState({}); // { [itemId]: signed url for uploaded photos }

  function flashRowStatus(itemId, status, duration) {
    setRowStatus(prev => ({ ...prev, [itemId]: status }));
    setTimeout(() => {
      setRowStatus(prev => {
        if (prev[itemId] !== status) return prev; // a newer save/error already replaced this one
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }, duration);
  }

  function updateLocalItem(itemId, field, value) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, [field]: value } : it));
  }

  async function persistItem(itemId, field, value) {
    const { error } = await supabase.from('job_estimate_items').update({ [field]: value }).eq('id', itemId);
    flashRowStatus(itemId, error ? 'error' : 'saved', error ? 4000 : 1400);
  }

  async function deleteItem(itemId) {
    const removed = items.find(it => it.id === itemId);
    setItems(prev => prev.filter(it => it.id !== itemId));
    const { error } = await supabase.from('job_estimate_items').delete().eq('id', itemId);
    if (error && removed) {
      // The delete didn't actually happen server-side — put it back
      // instead of leaving the person thinking it's gone.
      setItems(prev => [...prev, removed]);
      flashRowStatus(itemId, 'error', 4000);
    }
  }

  // job-photos is a private bucket — uploaded material photos need a
  // signed URL to display, same as MaterialSelectionWizard. Search-picked
  // photos (image_url) are already public, no signing needed.
  useEffect(() => {
    const needsSigning = items.filter(it => it.image_storage_path && !signedThumbs[it.id]);
    if (needsSigning.length === 0) return;
    (async () => {
      const entries = await Promise.all(needsSigning.map(async it => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(it.image_storage_path, 3600);
        return [it.id, data?.signedUrl];
      }));
      const valid = Object.fromEntries(entries.filter(([, url]) => url));
      if (Object.keys(valid).length) setSignedThumbs(prev => ({ ...prev, ...valid }));
    })();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveItemImage(itemId, patch) {
    updateLocalItem(itemId, 'image_url', patch.image_url);
    updateLocalItem(itemId, 'image_storage_path', patch.image_storage_path);
    updateLocalItem(itemId, 'image_source', patch.image_source);
    if (!patch.image_storage_path) setSignedThumbs(prev => { const next = { ...prev }; delete next[itemId]; return next; });
    const { error } = await supabase.from('job_estimate_items').update({
      image_url: patch.image_url,
      image_storage_path: patch.image_storage_path,
      image_source: patch.image_source,
    }).eq('id', itemId);
    flashRowStatus(itemId, error ? 'error' : 'saved', error ? 4000 : 1400);
    setChooserItemId(null);
  }

  function removeItemImage(itemId) {
    saveItemImage(itemId, { image_url: null, image_storage_path: null, image_source: null });
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
    if (isMulti && !selectedOptionId) return;
    const { data, error } = await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      option_id: isMulti ? selectedOptionId : null,
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
    if (isMulti && !selectedOptionId) return;
    const { data, error } = await supabase.from('job_estimate_items').insert({
      job_id: jobId,
      option_id: isMulti ? selectedOptionId : null,
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
      if (isMulti) {
        if (!selectedOptionId) return;
        supabase.from('estimate_scope_options').update({ estimate_margin_percent: value ? parseFloat(value) : null }).eq('id', selectedOptionId);
      } else {
        supabase.from('jobs').update({ estimate_margin_percent: value ? parseFloat(value) : null }).eq('id', jobId);
      }
    }, 500);
  }

  function saveSalesTax(value) {
    setSalesTax(value);
    clearTimeout(taxSaveTimer.current);
    taxSaveTimer.current = setTimeout(() => {
      if (isMulti) {
        if (!selectedOptionId) return;
        supabase.from('estimate_scope_options').update({ estimate_sales_tax_percent: value ? parseFloat(value) : null }).eq('id', selectedOptionId);
      } else {
        supabase.from('jobs').update({ estimate_sales_tax_percent: value ? parseFloat(value) : null }).eq('id', jobId);
      }
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
  // Rounded to the cent — the raw division (subtotal / (1 - margin/100))
  // almost always produces a repeating decimal (e.g. dividing by 0.65
  // for a 35% margin), and that raw value was getting saved straight to
  // contract_price, which is what showed up as things like
  // "36917.25866666667" anywhere contract_price got used as a starting
  // value for an editable dollar field later (e.g. the Invoicing tab).
  const salePrice = Math.round((marginNum > 0 && marginNum < 100 ? subtotal / (1 - marginNum / 100) : subtotal) * 100) / 100;
  const marginDollars = salePrice - subtotal;

  async function pushToContractPrice() {
    setPushing(true);
    if (isMulti) {
      if (selectedOptionId) {
        await supabase.from('estimate_scope_options').update({ price: salePrice, projected_cost: subtotal }).eq('id', selectedOptionId);
      }
    } else {
      await Promise.all([
        supabase.from('job_financials').update({ contract_price: salePrice }).eq('job_id', jobId),
        supabase.from('jobs').update({ projected_cost: subtotal }).eq('id', jobId),
      ]);
    }
    setPushing(false);
    setPushedFlash(isMulti ? `Saved as ${selectedOption?.label || 'this option'}’s price.` : 'Saved as this job’s Contract Price.');
    setTimeout(() => setPushedFlash(''), 6000);
  }

  const optionSwitcher = isMulti && (
    <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Pricing which option:</span>
      {scopeOptions.map(o => (
        <button key={o.id} className={`btn btn-sm ${selectedOptionId === o.id ? 'btn-primary' : ''}`} onClick={() => selectOption(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  if (section === 'cost') {
    if (isMulti && scopeOptions.length === 0) {
      return (
        <div className="estimate-grid-wide">
          <div className="estimate-main">
            <div className="card">
              <h3>Cost Build-Up</h3>
              <div className="empty-state">No scope options yet — add two or more on the Scope page, then come back here to price each one.</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="estimate-grid-wide">
        <div className="estimate-main">
          {optionSwitcher}
          <div className="card">
            <h3>Materials{isMulti && selectedOption ? ` — ${selectedOption.label}` : ''}</h3>

            <div className="section-actions" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={suggestMaterials} disabled={suggesting || actions.length === 0}>
                {suggesting ? 'Suggesting…' : 'Suggest materials from action list'}
              </button>
            </div>
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
                <div key={it.id} className={`estimate-row ${rowStatus[it.id] === 'saved' ? 'row-flash-saved' : rowStatus[it.id] === 'error' ? 'row-flash-error' : ''}`}>
                  <div>
                    <input
                      value={it.description}
                      onChange={e => updateLocalItem(it.id, 'description', e.target.value)}
                      onBlur={e => persistItem(it.id, 'description', e.target.value)}
                    />
                    {it.source === 'suggested' && <span className="estimate-tag">Suggested</span>}
                    {it.buffer_note && <div className="estimate-buffer-note">{it.buffer_note}</div>}
                    {rowStatus[it.id] === 'error' && <div style={{ fontSize: 11, color: '#a13f3f', marginTop: 3 }}>Couldn't save — try again</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      {(it.image_url || signedThumbs[it.id]) ? (
                        <>
                          <img src={it.image_url || signedThumbs[it.id]} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)' }} />
                          <button type="button" className="btn btn-sm" onClick={() => setChooserItemId(it.id)}>Change photo</button>
                          <button type="button" className="btn btn-sm" onClick={() => removeItemImage(it.id)}>Remove</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-sm" onClick={() => setChooserItemId(it.id)}>+ Add photo</button>
                      )}
                    </div>
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

            {chooserItemId && (
              <MaterialImageChooser
                jobId={jobId}
                itemId={chooserItemId}
                onClose={() => setChooserItemId(null)}
                onSelected={patch => saveItemImage(chooserItemId, patch)}
              />
            )}

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
            <h3>Subcontractor Cost{isMulti && selectedOption ? ` — ${selectedOption.label}` : ''}</h3>

            <div className="section-actions" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={suggestTradesFromActions} disabled={suggestingTrades || actions.length === 0}>
                {suggestingTrades ? 'Adding…' : 'Add a row per trade from action list'}
              </button>
            </div>
            {tradesError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{tradesError}</div>}

            <div className="estimate-table" style={{ marginTop: 16 }}>
              <div className="estimate-row estimate-header-row">
                <div>Description</div>
                <div>Trade</div>
                <div>Cost</div>
                <div>Total</div>
                <div></div>
              </div>
              {laborItems.map(it => (
                <div key={it.id} className={`estimate-row ${rowStatus[it.id] === 'saved' ? 'row-flash-saved' : rowStatus[it.id] === 'error' ? 'row-flash-error' : ''}`}>
                  <div>
                    <input
                      value={it.description}
                      onChange={e => updateLocalItem(it.id, 'description', e.target.value)}
                      onBlur={e => persistItem(it.id, 'description', e.target.value)}
                    />
                    {it.source === 'suggested' && <span className="estimate-tag">Suggested</span>}
                    {rowStatus[it.id] === 'error' && <div style={{ fontSize: 11, color: '#a13f3f', marginTop: 3 }}>Couldn't save — try again</div>}
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
        </div>

        <div className="estimate-sidebar">
          <TradeBreakdownCard jobId={jobId} />
        </div>
      </div>
    );
  }

  // section === 'pricing'
  if (isMulti && scopeOptions.length === 0) {
    return (
      <div className="estimate-grid">
        <div className="estimate-main">{children}</div>
        <div className="estimate-sidebar">
          <div className="card">
            <h3>Margin &amp; Sale Price</h3>
            <div className="empty-state">No scope options yet — add two or more on the Scope page first.</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="estimate-grid">
      <div className="estimate-main">
        {optionSwitcher}
        {children}
      </div>

      <div className="estimate-sidebar">
        <div className="card">
          <h3>Margin &amp; Sale Price{isMulti && selectedOption ? ` — ${selectedOption.label}` : ''}</h3>
          <table className="estimate-margin-table">
            <tbody>
              <tr><td>Materials</td><td>{fmtMoney(materialSubtotal)}</td></tr>
              <tr>
                <td>Sales Tax</td>
                <td>
                  <div className="estimate-margin-inline">
                    <span className="estimate-margin-pct">
                      <input type="number" step="0.001" min="0" value={salesTax} onChange={e => saveSalesTax(e.target.value)} placeholder="8.6" />%
                    </span>
                    <span>{fmtMoney(salesTaxDollars)}</span>
                  </div>
                </td>
              </tr>
              <tr><td>Subcontractor Cost</td><td>{fmtMoney(laborSubtotal)}</td></tr>
              <tr className="estimate-margin-total-row"><td>Total Cost</td><td>{fmtMoney(subtotal)}</td></tr>
              <tr>
                <td>Margin</td>
                <td>
                  <div className="estimate-margin-inline">
                    <span className="estimate-margin-pct">
                      <input type="number" step="0.1" min="0" max="99" value={margin} onChange={e => saveMargin(e.target.value)} placeholder="25" />%
                    </span>
                    <span>{fmtMoney(marginDollars)}</span>
                  </div>
                </td>
              </tr>
              <tr className="estimate-margin-total-row"><td>Final Sale Price</td><td style={{ fontSize: 16 }}>{fmtMoney(salePrice)}</td></tr>
            </tbody>
          </table>
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={pushToContractPrice} disabled={pushing || subtotal === 0 || (isMulti && !selectedOptionId)}>
              {pushing ? 'Saving…' : isMulti ? `Save as ${selectedOption?.label || 'option'}'s price` : 'Save'}
            </button>
          </div>
          {pushedFlash && <div style={{ fontSize: 12, color: '#3a6b45', marginTop: 8 }}>{pushedFlash}</div>}
        </div>
      </div>
    </div>
  );
}
