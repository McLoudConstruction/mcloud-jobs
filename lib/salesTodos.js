'use client';
import { supabase } from './supabaseClient';

// Quick to-dos captured on a route (Drive Mode), each with a day and an
// optional time, shown on the Dashboard and the Calendar. Every write checks
// for an error and the caller refreshes its list afterward; nothing here
// relies on a realtime subscription.

export const TODO_PRESETS = [
  'Send COI',
  'Send Intro Email',
  'Send Proposal',
  'Send Photos',
  'Call Back',
  'Follow-up Email',
  'Inspection',
  'Site Walk',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local calendar date as YYYY-MM-DD. toISOString would shift to UTC and
// land on the wrong day in the evening.
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dateKey(new Date());
}

export function addDaysKey(days, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return dateKey(d);
}

export function nextMondayKey(from = new Date()) {
  const day = from.getDay();
  const add = ((8 - day) % 7) || 7;
  return addDaysKey(add, from);
}

// 'YYYY-MM-DD' to a local Date at midnight.
export function keyToDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDueDate(key) {
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDaysKey(1)) return 'Tomorrow';
  if (key === addDaysKey(-1)) return 'Yesterday';
  return keyToDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDueTime(value) {
  if (!value) return '';
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const d = new Date();
  d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export async function createTodo({ staffId, kind = 'todo', title, note, dueDate, dueTime, property, routeId }) {
  const cleanTitle = String(title || '').trim();
  if (!staffId) throw new Error('Could not tell who is signed in. Reload and try again.');
  if (!cleanTitle) throw new Error('Add a title.');
  if (!dueDate) throw new Error('Pick a day.');
  const { data, error } = await supabase.from('sales_todos').insert({
    staff_id: staffId,
    kind,
    title: cleanTitle,
    note: note ? String(note).trim() || null : null,
    due_date: dueDate,
    due_time: dueTime || null,
    property_id: property?.property_id || null,
    property_name: property?.property_name || null,
    route_id: routeId || null,
  }).select().single();
  if (error) throw error;
  return data;
}

// Everything still open, plus items finished today so a checked item does
// not vanish the instant it is tapped. Oldest day first.
export async function listOpenTodos(staffId) {
  if (!staffId) return [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [{ data: open, error: openErr }, { data: done, error: doneErr }] = await Promise.all([
    supabase.from('sales_todos').select('*')
      .eq('staff_id', staffId).is('completed_at', null)
      .order('due_date', { ascending: true }).order('due_time', { ascending: true, nullsFirst: false }),
    supabase.from('sales_todos').select('*')
      .eq('staff_id', staffId).gte('completed_at', startOfToday.toISOString())
      .order('completed_at', { ascending: false }),
  ]);
  if (openErr) throw openErr;
  if (doneErr) throw doneErr;
  return [...(open || []), ...(done || [])];
}

export async function setTodoDone(id, done) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('sales_todos')
    .update({ completed_at: done ? now : null, updated_at: now })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function moveTodo(id, dueDate) {
  const { data, error } = await supabase.from('sales_todos')
    .update({ due_date: dueDate, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTodo(id) {
  const { error } = await supabase.from('sales_todos').delete().eq('id', id);
  if (error) throw error;
}
