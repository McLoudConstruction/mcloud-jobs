'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { RECEIPT_CATEGORIES, JOB_COST_CATEGORIES, JOB_COST_CATEGORY_LABELS } from '../lib/constants';
import { compressImage } from '../lib/imageCompress';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_RECEIPT_FORM = { vendor_name: '', amount: '', receipt_date: new Date().toISOString().slice(0, 10), category: 'materials', payment_status: 'paid', notes: '' };
const EMPTY_MANUAL_FORM = { category: 'materials', description: '', amount: '', cost_date: new Date().toISOString().slice(0, 10), status: 'actual' };

export default function ReceiptsCard({ jobId }) {
  const [receipts, setReceipts] = useState([]);
  const [costs, setCosts] = useState([]);
  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPath, setPendingPath] = useState(null);
  const [form, setForm] = useState(EMPTY_RECEIPT_FORM);
  const [aiNote, setAiNote] = useState('');
  const [replacingId, setReplacingId] = useState(null);
  const [saveError, setSaveError] = useState('');
  const fileInputRef = useRef(null);

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [savingManual, setSavingManual] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: r }, { data: c }] = await Promise.all([
      supabase.from('receipts').select('*').eq('job_id', jobId).order('receipt_date', { ascending: false }),
      supabase.from('job_costs').select('*').eq('job_id', jobId).order('cost_date', { ascending: false }),
    ]);
    if (r) {
      setReceipts(r);
      const entries = await Promise.all(r.map(async rec => {
        if (!rec.storage_path) return [rec.id, null];
        const { data: signed } = await supabase.storage.from('receipts').createSignedUrl(rec.storage_path, 3600);
        return [rec.id, signed?.signedUrl];
      }));
      setUrls(Object.fromEntries(entries));
    }
    if (c) setCosts(c);
  }, [jobId]);

  useEffect(() => {
    loadAll();
    const channel = supabase.channel(`job-costs-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `job_id=eq.${jobId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_costs', filter: `job_id=eq.${jobId}` }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadAll]);

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingFile(file);
    setAiNote('');
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const path = `${jobId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('receipts').upload(path, compressed, { contentType: 'image/jpeg' });
      if (error) throw error;
      setPendingPath(path);

      setScanning(true);
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/extract-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' }),
        });
        const data = await res.json();
        if (res.ok && data.extracted) {
          const ex = data.extracted;
          setForm(prev => ({
            vendor_name: ex.vendor || prev.vendor_name,
            amount: ex.amount != null ? String(ex.amount) : prev.amount,
            receipt_date: ex.date || prev.receipt_date,
            category: RECEIPT_CATEGORIES.includes(ex.category) ? ex.category : prev.category,
            notes: prev.notes,
          }));
          setAiNote('Filled in by AI — please double check before saving.');
        } else {
          setAiNote(data.error || 'Could not auto-read this receipt — enter the details manually.');
        }
      } catch {
        setAiNote('Could not auto-read this receipt — enter the details manually.');
      } finally {
        setScanning(false);
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  function updateForm(field, value) { setForm(prev => ({ ...prev, [field]: value })); }
  function updateManualForm(field, value) { setManualForm(prev => ({ ...prev, [field]: value })); }

  async function saveReceipt() {
    if (!pendingPath || !form.amount) return;
    setUploading(true);
    setSaveError('');
    const { data: receipt, error } = await supabase.from('receipts').insert({
      job_id: jobId,
      vendor_name: form.vendor_name || null,
      amount: Math.round(parseFloat(form.amount) * 100) / 100,
      receipt_date: form.receipt_date,
      category: form.category,
      payment_status: form.payment_status,
      storage_path: pendingPath,
      notes: form.notes || null,
    }).select().single();

    if (error || !receipt) {
      setUploading(false);
      setSaveError(error?.message || 'Failed to save receipt.');
      return;
    }

    const { error: costError } = await supabase.from('job_costs').insert({
      job_id: jobId,
      category: form.category,
      description: form.vendor_name ? `Receipt — ${form.vendor_name}` : 'Receipt',
      amount: Math.round(parseFloat(form.amount) * 100) / 100,
      cost_date: form.receipt_date,
      status: 'actual',
      source_type: 'receipt',
      receipt_id: receipt.id,
      vendor_name: form.vendor_name || null,
    });
    if (costError) {
      setUploading(false);
      setSaveError(costError.message);
      return;
    }
    setUploading(false);
    cancelPending();
    // Don't rely solely on the realtime subscription — refresh directly
    // so the new receipt shows up immediately.
    await loadAll();
  }

  async function saveManualCost(e) {
    e.preventDefault();
    if (!manualForm.amount) return;
    setSavingManual(true);
    await supabase.from('job_costs').insert({
      job_id: jobId,
      category: manualForm.category,
      description: manualForm.description || null,
      amount: Math.round(parseFloat(manualForm.amount) * 100) / 100,
      cost_date: manualForm.cost_date,
      status: manualForm.status,
      source_type: 'manual',
    });
    setSavingManual(false);
    setManualForm(EMPTY_MANUAL_FORM);
    setShowManualForm(false);
    await loadAll();
  }

  function cancelPending() {
    setPendingFile(null);
    setPendingPath(null);
    setAiNote('');
    setForm(EMPTY_RECEIPT_FORM);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function deleteReceipt(receipt) {
    if (!confirm('Delete this receipt? This also removes its linked job cost entry.')) return;
    if (receipt.storage_path) await supabase.storage.from('receipts').remove([receipt.storage_path]);
    await supabase.from('job_costs').delete().eq('receipt_id', receipt.id);
    const { error } = await supabase.from('receipts').delete().eq('id', receipt.id);
    if (error) {
      setSaveError(error.message);
      return;
    }
    await loadAll();
  }

  async function deleteManualCost(id) {
    if (!confirm('Delete this cost entry?')) return;
    await supabase.from('job_costs').delete().eq('id', id);
    await loadAll();
  }

  async function replacePhoto(e, receipt) {
    const file = e.target.files[0];
    if (!file) return;
    setReplacingId(receipt.id);
    try {
      const compressed = await compressImage(file);
      const newPath = `${jobId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('receipts').upload(newPath, compressed, { contentType: 'image/jpeg' });
      if (error) throw error;
      if (receipt.storage_path) await supabase.storage.from('receipts').remove([receipt.storage_path]);
      const { error: updateError } = await supabase.from('receipts').update({ storage_path: newPath }).eq('id', receipt.id);
      if (updateError) throw updateError;
      await loadAll();
    } catch (err) {
      alert('Failed to replace photo: ' + err.message);
    } finally {
      setReplacingId(null);
      e.target.value = '';
    }
  }

  const receiptsById = Object.fromEntries(receipts.map(r => [r.id, r]));
  const total = costs.reduce((sum, c) => sum + Number(c.amount || 0), 0);

  return (
    <div className="card">
      <h3>Job Costs</h3>

      <div className="section-actions" style={{ marginTop: 0 }}>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} style={{ display: 'none' }} />
        {!pendingFile && (
          <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '+ Upload Receipt'}
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowManualForm(s => !s)}>{showManualForm ? 'Cancel' : '+ Add Manual Cost Entry'}</button>
      </div>

      {pendingFile && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
            {scanning ? 'Reading receipt with AI…' : 'Confirm receipt details'}
          </div>
          {aiNote && <div style={{ fontSize: 11.5, color: aiNote.startsWith('Filled') ? '#3a6b45' : '#a13f3f', marginBottom: 8 }}>{aiNote}</div>}
          <div className="two-col">
            <div><label>Vendor</label><input value={form.vendor_name} onChange={e => updateForm('vendor_name', e.target.value)} /></div>
            <div><label>Amount ($)</label><input value={form.amount} onChange={e => updateForm('amount', e.target.value)} /></div>
            <div><label>Date</label><input type="date" value={form.receipt_date} onChange={e => updateForm('receipt_date', e.target.value)} /></div>
            <div>
              <label>Category</label>
              <select value={form.category} onChange={e => updateForm('category', e.target.value)}>
                {RECEIPT_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label>Payment status</label>
              <select value={form.payment_status} onChange={e => updateForm('payment_status', e.target.value)}>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}>Notes</label>
          <textarea value={form.notes} onChange={e => updateForm('notes', e.target.value)} rows={2} />
          {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={saveReceipt} disabled={uploading || scanning || !form.amount}>
              {uploading ? 'Saving…' : 'Save receipt'}
            </button>
            <button className="btn btn-sm" onClick={cancelPending}>Cancel</button>
          </div>
        </div>
      )}

      {showManualForm && (
        <form onSubmit={saveManualCost} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginTop: 12 }}>
          <div className="two-col">
            <div>
              <label>Category</label>
              <select value={manualForm.category} onChange={e => updateManualForm('category', e.target.value)}>
                {JOB_COST_CATEGORIES.map(c => <option key={c} value={c}>{JOB_COST_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div><label>Amount ($)</label><input value={manualForm.amount} onChange={e => updateManualForm('amount', e.target.value)} required /></div>
            <div><label>Date</label><input type="date" value={manualForm.cost_date} onChange={e => updateManualForm('cost_date', e.target.value)} /></div>
            <div>
              <label>Status</label>
              <select value={manualForm.status} onChange={e => updateManualForm('status', e.target.value)}>
                <option value="actual">Actual (already spent)</option>
                <option value="committed">Committed (obligated, not yet spent)</option>
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}>Description</label>
          <input value={manualForm.description} onChange={e => updateManualForm('description', e.target.value)} />
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" type="submit" disabled={savingManual}>{savingManual ? 'Saving…' : 'Save cost entry'}</button>
          </div>
        </form>
      )}

      {costs.length === 0 && !pendingFile && !showManualForm && <div className="empty-state" style={{ marginTop: 12 }}>No costs logged yet.</div>}

      {costs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {costs.map(c => {
            const receipt = c.receipt_id ? receiptsById[c.receipt_id] : null;
            return (
              <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                {receipt && (urls[receipt.id] ? (
                  <img src={urls[receipt.id]} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 50, height: 50, background: '#eee', borderRadius: 4, flexShrink: 0 }} />
                ))}
                <div style={{ flex: 1, fontSize: 13 }}>
                  <b>{fmtMoney(c.amount)}</b> — {JOB_COST_CATEGORY_LABELS[c.category] || c.category}
                  {c.description && <span style={{ color: 'var(--ink-soft)' }}> · {c.description}</span>}
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                    {c.cost_date} · {c.status === 'committed' ? 'Committed' : 'Actual'} · {c.source_type === 'receipt' ? 'From receipt' : c.source_type === 'work_order' ? 'From work order' : 'Manual entry'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {receipt && (
                    <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                      {replacingId === receipt.id ? 'Replacing…' : 'Replace Photo'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => replacePhoto(e, receipt)} disabled={replacingId === receipt.id} />
                    </label>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => receipt ? deleteReceipt(receipt) : deleteManualCost(c.id)}>Delete</button>
                </div>
              </div>
            );
          })}
          <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, marginTop: 10 }}>Total: {fmtMoney(total)}</div>
        </div>
      )}
    </div>
  );
}
