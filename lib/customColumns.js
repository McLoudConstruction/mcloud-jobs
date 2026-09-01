'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

export const CUSTOM_COLUMN_FIELD_TYPES = ['text', 'number', 'date', 'dropdown'];
export const CUSTOM_COLUMN_FIELD_TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date', dropdown: 'Dropdown' };

function slugify(label) {
  const slug = (label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'field';
}

// Loads the custom column DEFINITIONS for one underlying table (e.g.
// 'companies') and exposes a function to add a new one. The columns
// themselves are just metadata — actual values live on each record's own
// custom_fields jsonb (see updateCustomFieldValue below).
export function useCustomColumns(tableName) {
  const [customColumns, setCustomColumns] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('custom_columns')
      .select('*')
      .eq('table_name', tableName)
      .order('created_at', { ascending: true });
    if (data) setCustomColumns(data);
  }, [tableName]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`custom-columns-${tableName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_columns', filter: `table_name=eq.${tableName}` }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [tableName, load]);

  // Throws on failure so the form calling this can show the real error
  // (e.g. an empty name) instead of silently doing nothing.
  async function addColumn({ label, fieldType, options }) {
    const trimmedLabel = (label || '').trim();
    if (!trimmedLabel) throw new Error('Give the column a name.');
    if (!CUSTOM_COLUMN_FIELD_TYPES.includes(fieldType)) throw new Error('Pick a column type.');

    // Guard against colliding with an existing column's key by appending
    // _2, _3, etc. — two columns with the same label ("Notes") should
    // both work rather than one silently failing to save.
    const existingKeys = new Set(customColumns.map(c => c.column_key));
    const baseKey = slugify(trimmedLabel);
    let candidateKey = baseKey;
    let suffix = 2;
    while (existingKeys.has(candidateKey)) {
      candidateKey = `${baseKey}_${suffix}`;
      suffix++;
    }

    const cleanOptions = fieldType === 'dropdown'
      ? (options || []).map(o => o.trim()).filter(Boolean)
      : [];
    if (fieldType === 'dropdown' && cleanOptions.length === 0) {
      throw new Error('Add at least one option for a dropdown column.');
    }

    const { error } = await supabase.from('custom_columns').insert({
      table_name: tableName,
      column_key: candidateKey,
      label: trimmedLabel,
      field_type: fieldType,
      options: cleanOptions,
    });
    if (error) throw error;
    await load();
  }

  return { customColumns, addColumn, reloadCustomColumns: load };
}

// Persists one cell's value into a record's custom_fields jsonb. Merges
// against the record's current custom_fields rather than overwriting the
// whole object, so editing one custom field can't clobber another that
// happens to be saved around the same time.
export async function updateCustomFieldValue(tableName, recordId, currentCustomFields, key, value) {
  const nextFields = { ...(currentCustomFields || {}), [key]: value };
  const { error } = await supabase.from(tableName).update({ custom_fields: nextFields }).eq('id', recordId);
  if (error) throw error;
  return nextFields;
}
