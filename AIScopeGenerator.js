'use client';
import { useState } from 'react';

export default function AIScopeGenerator({ projectType, jobId, onGenerate, onTradeActions }) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  async function generate() {
    if (!description.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, projectType, includeTradeBreakdown: Boolean(jobId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate scope.');
      onGenerate(data.items || []);
      if (jobId && onTradeActions && data.tradeActions?.length) {
        onTradeActions(data.tradeActions);
      }
      if (data.warning) {
        setError(data.warning); // shown in the same amber warning slot — it's a heads-up, not a hard failure
      } else {
        setDescription('');
        setOpen(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Generate scope with AI</button>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
          <label>Describe the job in your own words</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Replace kitchen cabinets"
            rows={2}
          />
          {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{error}</div>}
          <div className="section-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={generate} disabled={loading || !description.trim()}>
              {loading ? 'Generating…' : 'Generate scope items'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>
            {jobId
              ? 'Generates the customer-facing scope below and an exhaustive, trade-tagged action list for the estimate tab — review both before relying on them.'
              : 'Items get added below for you to review, edit, or remove before saving — nothing goes to a customer automatically.'}
          </div>
        </div>
      )}
    </div>
  );
}
