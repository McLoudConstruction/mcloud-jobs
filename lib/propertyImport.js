// Spreadsheet import helpers for the Properties page.
//
// Column headers match what "Export to Excel" produces, so an exported
// sheet can be edited and re-imported. Duplicates are detected against
// both the rows already in the database and earlier rows in the same file.

import { PROPERTY_TYPES, PROSPECT_STAGES, PROSPECT_STAGE_LABELS, formatPhone } from './constants';

export const HEADER_MAP = {
  property_name: ['property', 'property name', 'name', 'building'],
  property_type: ['type', 'property type', 'category'],
  prospect_stage: ['prospect stage', 'stage'],
  active: ['active', 'is active', 'status'],
  management_company: ['company', 'management company', 'management', 'organization'],
  contact_name: ['contact', 'contact name'],
  contact_phone: ['phone', 'contact phone', 'phone number'],
  contact_email: ['email', 'contact email'],
  property_street: ['street', 'address', 'street address'],
  property_unit: ['unit', 'suite'],
  property_city: ['city'],
  property_state: ['state'],
  property_zip: ['zip', 'zip code', 'postal code'],
  year_built: ['year built', 'built'],
  sq_ft: ['sq ft', 'square feet', 'square footage', 'sqft'],
  target_value: ['target value', 'value', 'target project value'],
  last_visited_at: ['last visited', 'last visit', 'last visited at'],
  notes: ['notes', 'note', 'comments'],
};

function normalizeHeader(h) { return (h || '').toString().trim().toLowerCase(); }

function cleanText(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function parseActive(v) {
  const s = cleanText(v).toLowerCase();
  if (!s) return true; // blank means active, same as the database default
  return !['no', 'n', 'false', '0', 'inactive'].includes(s);
}

function parseStage(v) {
  const s = cleanText(v).toLowerCase();
  if (!s) return 'prospecting';
  if (PROSPECT_STAGES.includes(s)) return s;
  const byLabel = PROSPECT_STAGES.find(k => PROSPECT_STAGE_LABELS[k].toLowerCase() === s);
  if (byLabel) return byLabel;
  if (s === 'estimate' || s === 'proposal sent') return 'proposal';
  return 'prospecting';
}

function parseType(v) {
  const s = cleanText(v);
  if (!s) return '';
  const match = PROPERTY_TYPES.find(t => t.toLowerCase() === s.toLowerCase());
  return match || s;
}

function parseMoney(v) {
  const n = parseFloat(cleanText(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Accepts a JS Date (xlsx cellDates), an Excel serial number, or text like 9/14/2026.
function parseDateToIso(v) {
  if (v === undefined || v === null || v === '') return null;
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400 * 1000));
  else {
    const s = cleanText(v);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      // Noon UTC keeps the calendar day stable in any US time zone.
      d = new Date(Date.UTC(yr, Number(m[1]) - 1, Number(m[2]), 12));
    } else {
      const parsed = new Date(s);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  // A Date parsed from a spreadsheet cell is midnight UTC; move to noon UTC for the same reason.
  if (v instanceof Date || typeof v === 'number') d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  return d.toISOString();
}

// Converts one spreadsheet row into a properties table payload.
export function mapRow(row) {
  const keys = Object.keys(row);
  const raw = {};
  for (const [field, variants] of Object.entries(HEADER_MAP)) {
    const match = keys.find(k => variants.includes(normalizeHeader(k)));
    if (match !== undefined) raw[field] = row[match];
  }

  const out = {
    property_name: cleanText(raw.property_name),
    property_type: parseType(raw.property_type),
    prospect_stage: parseStage(raw.prospect_stage),
    active: parseActive(raw.active),
    property_street: cleanText(raw.property_street),
    property_unit: cleanText(raw.property_unit),
    property_city: cleanText(raw.property_city),
    property_state: cleanText(raw.property_state).toUpperCase(),
    property_zip: cleanText(raw.property_zip),
    management_company: cleanText(raw.management_company),
    contact_name: cleanText(raw.contact_name),
    contact_phone: raw.contact_phone ? formatPhone(cleanText(raw.contact_phone)) : '',
    contact_email: cleanText(raw.contact_email),
    year_built: cleanText(raw.year_built),
    sq_ft: cleanText(raw.sq_ft),
    target_value: parseMoney(raw.target_value),
    last_visited_at: parseDateToIso(raw.last_visited_at),
    notes: cleanText(raw.notes),
  };
  // Excel drops leading zeros on zips stored as numbers (e.g. 2134 for 02134).
  if (/^\d{4}$/.test(out.property_zip)) out.property_zip = '0' + out.property_zip;
  return out;
}

// ---- Duplicate detection ----

const STREET_ABBREVIATIONS = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct',
  circle: 'cir', place: 'pl', parkway: 'pkwy', highway: 'hwy', terrace: 'ter', trail: 'trl',
  north: 'n', south: 's', east: 'e', west: 'w',
};

function normalizeStreet(s) {
  return cleanText(s).toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map(w => STREET_ABBREVIATIONS[w] || w)
    .join(' ');
}

function normalizeName(s) {
  return cleanText(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Keys a row is stored under. Every row registers its name key too, so a
// later row with no street can still be recognised by name plus city.
function registerKeys(p) {
  const keys = [];
  const street = normalizeStreet(p.property_street);
  const zip = cleanText(p.property_zip).slice(0, 5);
  const unit = normalizeStreet(p.property_unit);
  if (street) keys.push(`addr|${street}|${unit}|${zip}`);
  if (p.property_name) keys.push(`name|${normalizeName(p.property_name)}|${normalizeName(p.property_city)}`);
  return keys;
}

// Keys a row is checked by. A row with an address is identified by that
// address (same building even if the name differs); a row without one falls
// back to name plus city, so two different buildings that share a name are
// not merged when their addresses are known.
function lookupKeys(p) {
  const street = normalizeStreet(p.property_street);
  if (street) return registerKeys(p).slice(0, 1);
  return registerKeys(p);
}

// existing: rows already in the database. incoming: mapped rows from the file.
// Returns { fresh, duplicates } where duplicates lists rows skipped and why.
export function splitDuplicates(existing, incoming) {
  const seen = new Map();
  for (const p of existing) for (const k of registerKeys(p)) seen.set(k, 'already in Properties');

  const fresh = [];
  const duplicates = [];
  for (const p of incoming) {
    const hit = lookupKeys(p).find(k => seen.has(k));
    if (hit) {
      duplicates.push({ property_name: p.property_name, reason: seen.get(hit) });
      continue;
    }
    for (const k of registerKeys(p)) if (!seen.has(k)) seen.set(k, 'repeated in the file');
    fresh.push(p);
  }
  return { fresh, duplicates };
}
