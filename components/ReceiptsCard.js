'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { RECEIPT_CATEGORIES } from '../lib/constants';
import { compressImage } from '../lib/imageCompress';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = { vendor_name: '', amount: '', receipt_date: new Date().toISOString().slice(0, 10), category: 'materials', payment_status: 'paid', notes: '' };

export default function ReceiptsCard({ jobId }) {
  const [receipts, setReceipts] = useState([]);
  const [urls, setUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPath, setPendingPath] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [aiNote, setAiNote] = useState('');
  const [replacingId, setReplacingId] = useState(null);
  const fileInputRef = useRef(null);

  const loadReceipts = useCallback(async () => {
    const { data } = await supabase.from('receipts').select('*').eq('job_id', jobId).order('receipt_date', { ascending: false });
    if (data) {
      setReceipts(data);
      const entries = await Promise.all(data.map(async r => {
        if (!r.storage_path) return [r.id, null];
        const { data: signed } = await supabase.storage.from('receipts').createSignedUrl(r.storage_path, 3600);
        return [r.id, signed?.signedUrl];
      }));
      setUrls(Object.fromEntries(entries));
    }
  }, [jobId]);

  useEffect(() => {
    loadReceipts();
    const channel = supabase.channel(`receipts-${jobId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `job_id=eq.${jobId}` }, loadReceipts).subscribe();
    return () => supabase.removeChannel(channel);
  }, [jobId, loadReceipts]);

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

  async function saveReceipt() {
    if (!pendingPath || !form.amount) return;
    setUploading(true);
    const { data: receipt, error } = await supabase.from('receipts').insert({
      job_id: jobId,
      vendor_name: form.vendor_name || null,
      amount: parseFloat(form.amount),
      receipt_date: form.receipt_date,
      category: form.category,
      payment_status: form.payment_status,
      storage_path: pendingPath,
      notes: form.notes || null,
    }).select().single();

    if (!error && receipt) {
      await supabase.from('job_costs').insert({
        job_id: jobId,
        category: form.category,
        description: form.vendor_name ? `Receipt — ${form.vendor_name}` : 'Receipt',
        amount: parseFloat(form.amount),
        cost_date: form.receipt_date,
        status: 'actual',
        source_type: 'receipt',
        receipt_id: receipt.id,
        vendor_name: form.vendor_name || null,
      });
    }
    setUploading(false);
    cancelPending();
  }

  function cancelPending() {
    setPendingFile(null);
    setPendingPath(null);
    setAiNote('');
    setForm(EMPTY_FORM);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function deleteReceipt(receipt) {
    if (!confirm('Delete this receipt? This also removes its linked job cost entry.')) return;
    if (receipt.storage_path) await supabase.storage.from('receipts').remove([receipt.storage_path]);
    await supabase.from('job_costs').delete().eq('receipt_id', receipt.id);
    await supabase.from('receipts').delete().eq('id', receipt.id);
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
      await supabase.from('receipts').update({ storage_path: newPath }).eq('id', receipt.id);
    } catch (err) {
      alert('Failed to replace photo: ' + err.message);
    } finally {
      setReplacingId(null);
      e.target.value = '';
    }
  }

  const total = receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div className="card">
      <h3>Receipts</h3>

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} style={{ display: 'none' }} />
      {!pendingFile && (
        <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : '+ Add Receipt'}
        </button>
      )}

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
          <div className="section-actions">
            <button className="btn btn-primary btn-sm" onClick={saveReceipt} disabled={uploading || scanning || !form.amount}>
              {uploading ? 'Saving…' : 'Save receipt'}
            </button>
            <button className="btn btn-sm" onClick={cancelPending}>Cancel</button>
          </div>
        </div>
      )}

      {receipts.length === 0 && !pendingFile && <div className="empty-state" style={{ marginTop: 12 }}>No receipts uploaded yet.</div>}

      {receipts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {receipts.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              {urls[r.id] ? (
                <img src={urls[r.id]} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 50, height: 50, background: '#eee', borderRadius: 4, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, fontSize: 13 }}>
                <b>{fmtMoney(r.amount)}</b> — {r.vendor_name || 'Unknown vendor'}
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{r.receipt_date} · {r.category} · {r.payment_status === 'unpaid' ? <span style={{ color: '#a13f3f', fontWeight: 600 }}>Unpaid</span> : 'Paid'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                  {replacingId === r.id ? 'Replacing…' : 'Replace Photo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => replacePhoto(e, r)} disabled={replacingId === r.id} />
                </label>
                <button className="btn btn-sm btn-danger" onClick={() => deleteReceipt(r)}>Delete</button>
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, marginTop: 10 }}>Total: {fmtMoney(total)}</div>
        </div>
      )}
    </div>
  );
}
