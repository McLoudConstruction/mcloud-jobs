'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { PROSPECT_STAGE_LABELS } from '../lib/constants';
import LogTouchButton from './LogTouchButton';

// Prospect follow up for the Sales page (migration 164).
//
// Four short lists that say who needs attention today, plus a small scorecard.
// The database builds all of it in one call (crm_follow_up), so this screen
// stays light even with thousands of prospects. Prospects marked do not
// contact or inactive never appear in the lists.
//
//   Overdue       a next step whose date has passed
//   No next step  contacted or estimate sent, but nothing planned
//   Gone quiet    contacted with no activity for 14 days, or an estimate that
//                 has sat for 14 days with nothing since
//   Try again     lost prospects whose try again date has arrived

const TABS = [
  { key: 'overdue', label: 'Overdue', empty: 'No next steps are overdue.' },
  { key: 'no_next_step', label: 'No next step', empty: 'Every active prospect has a next step.' },
  { key: 'stalled', label: 'Gone quiet', empty: 'Nothing has gone quiet.' },
  { key: 'try_again', label: 'Try again', empty: 'No lost prospects are due for another try.' },
  { key: 'scorecard', label: 'Scorecard' },
];

function day(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(value) {
  const n = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (n <= 0) return 'today';
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

function detailFor(tab, item) {
  const stage = PROSPECT_STAGE_LABELS[item.stage] || '';
  const parts = [];
  if (tab === 'overdue') {
    if (stage) parts.push(stage);
    parts.push(`Next step was ${day(item.next_action_at)} (${daysAgo(item.next_action_at)})${item.next_action_note ? `: ${item.next_action_note}` : ''}`);
  } else if (tab === 'no_next_step') {
    if (stage) parts.push(stage);
    parts.push(item.last_contact_at ? `Last contact ${day(item.last_contact_at)}` : 'No contact logged yet');
  } else if (tab === 'stalled') {
    if (stage) parts.push(stage);
    parts.push(`Quiet for ${item.quiet_days} day${item.quiet_days === 1 ? '' : 's'}`);
    if (item.next_action_at) parts.push(`Next step ${day(item.next_action_at)}${item.next_action_note ? `: ${item.next_action_note}` : ''}`);
  } else if (tab === 'try_again') {
    parts.push(`Try again from ${day(item.reengage_at)}`);
    parts.push(item.lost_reason ? `Lost because: ${item.lost_reason}` : 'No reason was recorded');
  }
  return parts.join('  ·  ');
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function ScoreTable({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  const cell = { padding: '6px 10px', textAlign: 'right', fontSize: 12.5 };
  const head = { ...cell, fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' };
  return (
    <div style={{ marginTop: 16, overflowX: 'auto' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)' }}>
            <th style={{ ...head, textAlign: 'left' }}>Group</th>
            <th style={head}>Prospects</th>
            <th style={head}>Reached</th>
            <th style={head}>Replied</th>
            <th style={head}>Reply rate</th>
            <th style={head}>Estimates</th>
            <th style={head}>Won</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{String(r.label).replace(/_/g, ' ')}</td>
              <td style={cell}>{r.prospects}</td>
              <td style={cell}>{r.reached}</td>
              <td style={cell}>{r.replied}</td>
              <td style={cell}>{pct(r.replied, r.reached)}</td>
              <td style={cell}>{r.estimates}</td>
              <td style={cell}>{r.won}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FollowUpPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overdue');

  const load = useCallback(async () => {
    const { data: result, error: rpcError } = await supabase.rpc('crm_follow_up', { p_limit: 25, p_stalled_days: 14 });
    if (rpcError) {
      setError(/crm_follow_up/.test(rpcError.message) && /not.*find|does not exist/i.test(rpcError.message)
        ? 'Follow up lists are not set up yet. Run migration 164 in the Supabase SQL Editor.'
        : rpcError.message);
      return;
    }
    setError('');
    setData(result);
  }, []);

  useEffect(() => { load(); }, [load]);

  const list = data && tab !== 'scorecard' ? data[tab] : null;
  const current = TABS.find(t => t.key === tab);
  const score = data?.scorecard;

  return (
    <div>
      <h3 style={{ fontSize: 12.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '0 0 4px', fontWeight: 700 }}>Prospect follow up</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
        Who needs a call or an email today. These are the organizations in Properties, not the leads below.
      </div>

      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
      {!error && !data && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Loading…</div>}

      {data && (
        <>
          <div className="tab-sections-pills">
            {TABS.map(t => {
              const count = t.key === 'scorecard' ? null : data[t.key]?.count;
              return (
                <button key={t.key} type="button" className={`tab-section-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}{count ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>

          {list && list.items.length === 0 && <div className="empty-state" style={{ marginTop: 10 }}>{current.empty}</div>}

          {list && list.items.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <Link href={`/properties?open=${item.id}`} style={{ fontSize: 13.5, fontWeight: 600 }}>{item.name || 'Unnamed property'}</Link>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{detailFor(tab, item)}</div>
              </div>
              <LogTouchButton kind="property" recordId={item.id} onLogged={load} />
            </div>
          ))}
          {list && list.count > list.items.length && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
              Showing the first {list.items.length} of {list.count}.
            </div>
          )}

          {tab === 'scorecard' && score && (
            <>
              <div style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }}>
                <strong>{score.overall?.prospects || 0}</strong> prospects, <strong>{score.overall?.reached || 0}</strong> reached,{' '}
                <strong>{score.overall?.replied || 0}</strong> replied ({pct(score.overall?.replied, score.overall?.reached)}),{' '}
                <strong>{score.overall?.estimates || 0}</strong> at estimate or won, <strong>{score.overall?.won || 0}</strong> won.
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                Reached means the stage moved past Prospecting or something was logged. Replied means they answered at least once.
              </div>
              <ScoreTable title="By vertical" rows={score.by_vertical} />
              <ScoreTable title="By source" rows={score.by_source} />
            </>
          )}
        </>
      )}
    </div>
  );
}
