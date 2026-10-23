'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

// Settings > Bots (owner only). Create, list and revoke the keys that outside
// bots use to reach the sales side of the platform, and see what they did.
//
// Everything here goes through the database functions from migration 161
// (bot_key_create, bot_key_list, bot_key_revoke, bot_activity). Each of them
// re-checks that the caller is an owner, so this screen being hidden from
// other roles is a convenience, not the protection.

const ACTION_LABELS = {
  me: 'Checked its key',
  'leads.list': 'Read leads',
  'prospects.list': 'Read prospects',
  'prospects.create': 'Added a prospect',
  'outreach.log': 'Logged outreach',
};

function when(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hr ago`;
  return d.toLocaleDateString();
}

function keyState(k) {
  if (k.revoked_at) return { label: 'Revoked', bg: 'rgba(161,63,63,0.15)', color: '#a13f3f' };
  if (k.expires_at && new Date(k.expires_at) <= new Date()) return { label: 'Expired', bg: 'rgba(155,119,61,0.15)', color: 'var(--rust, #9b773d)' };
  return { label: 'Live', bg: 'rgba(58,107,69,0.15)', color: '#3a6b45' };
}

export default function BotKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const [name, setName] = useState('');
  const [rate, setRate] = useState('60');
  const [expires, setExpires] = useState('');

  // The secret exists only here, once, right after creation.
  const [secret, setSecret] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error: listError } = await supabase.rpc('bot_key_list');
    if (listError) {
      setError(listError.message);
    } else {
      setKeys(data || []);
    }
    setLoading(false);
  }, []);

  const loadActivity = useCallback(async () => {
    const { data, error: actError } = await supabase.rpc('bot_activity', { p_limit: 40 });
    if (actError) setError(actError.message);
    else setActivity(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (showActivity) loadActivity(); }, [showActivity, loadActivity]);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const rateNumber = parseInt(rate, 10);
      const expiresAt = expires ? new Date(`${expires}T23:59:59`).toISOString() : null;
      const { data, error: createError } = await supabase.rpc('bot_key_create', {
        p_name: name.trim(),
        p_rate_limit: Number.isFinite(rateNumber) ? rateNumber : 60,
        p_expires_at: expiresAt,
      });
      if (createError) throw new Error(createError.message);
      setSecret({ name: data.name, key: data.key });
      setCopied(false);
      setName(''); setRate('60'); setExpires('');
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(k) {
    if (!confirm(`Revoke "${k.name}"? That bot stops working immediately. This cannot be undone, but you can make a new key.`)) return;
    setError('');
    const { error: revokeError } = await supabase.rpc('bot_key_revoke', { p_id: k.id });
    if (revokeError) { setError(revokeError.message); return; }
    setNote(`"${k.name}" is revoked.`);
    setTimeout(() => setNote(''), 4000);
    await load();
    if (showActivity) await loadActivity();
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret.key);
      setCopied(true);
    } catch {
      setError('Could not copy automatically. Select the key and copy it by hand.');
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="card">
      <div className="section-actions" style={{ marginTop: 0, marginBottom: 14, justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Bot Access (Sales only)</h3>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setFormOpen(o => !o)}>
          {formOpen ? 'Cancel' : 'New bot key'}
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14, lineHeight: 1.5 }}>
        A bot key lets an outside tool read leads, read and add prospects, and log outreach, and nothing else. It cannot
        reach jobs, financials, subcontractors or settings. Bots call <code>{origin || 'your site'}/api/bot/sales</code> with the key
        as a bearer token. The full guide is BOT_API.md in the repo.
      </div>

      {note && <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 12 }}>{note}</div>}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {secret && (
        <div style={{ border: '2px solid var(--rust, #9b773d)', borderRadius: 6, padding: 14, marginBottom: 16, background: 'var(--panel)' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Key for "{secret.name}"</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            Copy it now. It is shown once and cannot be looked up again. If it is lost, revoke it and make a new one.
          </div>
          <input
            readOnly
            value={secret.key}
            onFocus={e => e.target.select()}
            style={{ fontFamily: 'monospace', fontSize: 12.5, width: '100%' }}
          />
          <div className="section-actions" style={{ marginTop: 10, marginBottom: 0 }}>
            <button className="btn btn-primary btn-sm" type="button" onClick={copySecret}>{copied ? 'Copied' : 'Copy key'}</button>
            <button className="btn btn-sm" type="button" onClick={() => { setSecret(null); setCopied(false); }}>I saved it</button>
          </div>
        </div>
      )}

      {formOpen && (
        <form onSubmit={handleCreate} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 14, marginBottom: 16, background: 'var(--panel)' }}>
          <div className="two-col">
            <div>
              <label>Bot name</label>
              <input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={40} placeholder="e.g. church-outreach" />
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                Shown on everything this bot creates, so you can tell bots apart.
              </div>
            </div>
            <div>
              <label>Requests per minute</label>
              <input type="number" min={1} max={600} value={rate} onChange={e => setRate(e.target.value)} required />
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                A runaway bot is cut off at this rate.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, maxWidth: 260 }}>
            <label>Expires (optional)</label>
            <input type="date" value={expires} onChange={e => setExpires(e.target.value)} />
          </div>
          <div className="section-actions" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
          </div>
        </form>
      )}

      {loading && <div className="empty-state">Loading…</div>}
      {!loading && keys.length === 0 && <div className="empty-state">No bot keys yet.</div>}

      {!loading && keys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map(k => {
            const state = keyState(k);
            const dead = state.label !== 'Live';
            return (
              <div key={k.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px', opacity: dead ? 0.7 : 1 }}>
                <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{k.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontFamily: 'monospace' }}>{k.prefix}…</div>
                </div>

                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 20, background: state.bg, color: state.color }}>
                  {state.label}
                </span>

                <div style={{ flex: '2 1 240px', fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  Last used: {when(k.last_used_at)}<br />
                  Last 24 hours: {k.calls_24h} calls. All time: {k.prospects_created} prospects added, {k.touches_logged} touches logged.<br />
                  Limit {k.rate_limit_per_min}/min{k.expires_at ? `. Expires ${new Date(k.expires_at).toLocaleDateString()}` : ''}.
                </div>

                {!k.revoked_at && (
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => handleRevoke(k)}>Revoke</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button className="btn btn-sm" type="button" onClick={() => setShowActivity(s => !s)}>
          {showActivity ? 'Hide recent activity' : 'Show recent activity'}
        </button>
        {showActivity && (
          <div style={{ marginTop: 10 }}>
            {activity.length === 0 && <div className="empty-state">No bot activity yet.</div>}
            {activity.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--ink-soft)', minWidth: 90 }}>{when(a.created_at)}</span>
                <span style={{ fontWeight: 600, minWidth: 120 }}>{a.bot_name}</span>
                <span style={{ flex: 1 }}>
                  {ACTION_LABELS[a.action] || a.action}
                  {a.status === 'rejected' && <span style={{ color: '#a13f3f' }}> (rejected: {a.detail?.error || a.detail?.code || 'invalid request'})</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
