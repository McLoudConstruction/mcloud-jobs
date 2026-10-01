'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  listOpenTodos, createTodo, setTodoDone, moveTodo, deleteTodo,
  todayKey, addDaysKey, nextMondayKey, formatDueDate, formatDueTime,
} from '../../lib/salesTodos';

const DAY_CHOICES = [
  { key: 'today', label: 'Today', value: () => todayKey() },
  { key: 'tomorrow', label: 'Tomorrow', value: () => addDaysKey(1) },
  { key: 'monday', label: 'Next Monday', value: () => nextMondayKey() },
];

// The To-Do checklist on the main Dashboard: everything captured from Drive
// Mode (Send COI, Send Intro Email, follow-ups, inspections) plus anything
// typed in here. Grouped by day, oldest first, with overdue items on top.
// Every change is written, checked for an error, then the list is reloaded
// from the database; nothing depends on a realtime subscription.
export default function TodoCard() {
  const [staffId, setStaffId] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDay, setNewDay] = useState('today');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (id) => {
    const who = id || staffId;
    if (!who) return;
    try {
      setItems(await listOpenTodos(who));
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your To-Do list.');
      setItems(prev => prev || []);
    }
  }, [staffId]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      const id = data?.user?.id || null;
      if (cancelled || !id) return;
      setStaffId(id);
      load(id);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up items added from Drive Mode on another tab or device.
  useEffect(() => {
    if (!staffId) return undefined;
    const channel = supabase.channel('dashboard-todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_todos' }, () => load(staffId))
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') load(staffId); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [staffId, load]);

  async function run(id, action) {
    setBusyId(id);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.message || 'That did not save. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function addItem(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setError('');
    try {
      const day = DAY_CHOICES.find(d => d.key === newDay) || DAY_CHOICES[0];
      await createTodo({ staffId, kind: 'todo', title, dueDate: day.value() });
      setNewTitle('');
      await load();
    } catch (err) {
      setError(err.message || 'Could not add that item.');
    } finally {
      setAdding(false);
    }
  }

  const groups = useMemo(() => {
    const today = todayKey();
    const open = (items || []).filter(i => !i.completed_at);
    const done = (items || []).filter(i => i.completed_at);
    const overdue = open.filter(i => i.due_date < today);
    const todayItems = open.filter(i => i.due_date === today);
    const later = open.filter(i => i.due_date > today);
    const byDay = [];
    later.forEach(i => {
      const last = byDay[byDay.length - 1];
      if (last && last.date === i.due_date) last.items.push(i);
      else byDay.push({ date: i.due_date, items: [i] });
    });
    return { overdue, todayItems, byDay, done, openCount: open.length };
  }, [items]);

  function renderRow(item, { canPush }) {
    const done = !!item.completed_at;
    const meta = [
      item.kind === 'event' ? 'Event' : null,
      item.due_time ? formatDueTime(item.due_time) : null,
      item.property_name || null,
    ].filter(Boolean).join(' · ');
    return (
      <div key={item.id} style={rowStyle}>
        <input
          type="checkbox"
          aria-label={`Mark ${item.title} ${done ? 'not done' : 'done'}`}
          checked={done}
          disabled={busyId === item.id}
          onChange={e => run(item.id, () => setTodoDone(item.id, e.target.checked))}
          style={{ width: 'auto', marginTop: 3, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}>{item.title}</div>
          {item.note && !done && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1 }}>{item.note}</div>}
          {meta && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1 }}>{meta}</div>}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {canPush && !done && (
            <button type="button" className="btn btn-sm" disabled={busyId === item.id} title="Move to tomorrow" onClick={() => run(item.id, () => moveTodo(item.id, addDaysKey(1)))}>Tomorrow</button>
          )}
          <button type="button" className="btn btn-sm btn-danger" aria-label={`Delete ${item.title}`} disabled={busyId === item.id} onClick={() => run(item.id, () => deleteTodo(item.id))}>×</button>
        </div>
      </div>
    );
  }

  function section(label, list, opts = {}) {
    if (!list || list.length === 0) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ ...sectionLabelStyle, color: opts.warn ? '#a13f3f' : 'var(--ink-soft)' }}>{label}</div>
        {list.map(i => renderRow(i, { canPush: !!opts.canPush }))}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3>To-Do{groups.openCount > 0 ? ` (${groups.openCount})` : ''}</h3>

      <form onSubmit={addItem} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Add a to-do"
          aria-label="New to-do"
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <select value={newDay} onChange={e => setNewDay(e.target.value)} aria-label="Day" style={{ width: 'auto' }}>
          {DAY_CHOICES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <button type="submit" className="btn btn-sm btn-primary" disabled={adding || !newTitle.trim()}>{adding ? 'Adding…' : 'Add'}</button>
      </form>

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}

      {items === null && <div className="dash-empty-state" style={{ marginTop: 10 }}>Loading…</div>}
      {items !== null && groups.openCount === 0 && groups.done.length === 0 && (
        <div className="dash-empty-state" style={{ marginTop: 10 }}>
          Nothing on the list. Add items here, or from Drive Mode while you are on a route.
        </div>
      )}
      {items !== null && groups.openCount === 0 && groups.done.length > 0 && (
        <div className="dash-empty-state" style={{ marginTop: 10 }}>All caught up.</div>
      )}

      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {section('Overdue', groups.overdue, { warn: true, canPush: true })}
        {section('Today', groups.todayItems, { canPush: true })}
        {groups.byDay.map(g => section(formatDueDate(g.date), g.items))}
        {section('Done today', groups.done)}
      </div>
    </div>
  );
}

const rowStyle = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--line)' };
const sectionLabelStyle = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 };
