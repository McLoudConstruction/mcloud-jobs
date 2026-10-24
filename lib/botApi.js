import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Shared plumbing for the bot API routes under /api/bot/sales.
//
// These routes deliberately do NOT use the service role key. They call the
// database with the public anon key, and the anon role can do exactly one
// thing here: run the bot_sales_* functions from migration 161. Each function
// checks the bot key, its scope, its rate limit and the allowed fields itself.
// So the routes only translate HTTP to a function call and back. A mistake in
// this file cannot widen what a bot can reach, because the database decides.

const MAX_BODY_CHARS = 50000;
const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body, status = 200, headers = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Next.js can cache fetch results between requests. A cached answer would skip the
    // key check, the rate limit and the audit log, and would keep serving after a key
    // is revoked. Every call must reach the database, so caching is switched off here.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

// "Authorization: Bearer mcb_..." and nothing else. The key is never read from
// the URL, so it cannot end up in access logs or browser history.
function keyFrom(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

function missingKey() {
  return json(
    { error: 'Missing bot key. Send it as: Authorization: Bearer mcb_...', code: 'unauthorized' },
    401,
    { 'WWW-Authenticate': 'Bearer' }
  );
}

// The database answers with { ok: true, ... } or { ok: false, status, code, error, ... }.
function respond(data) {
  if (!data || typeof data !== 'object') {
    return json({ error: 'Unexpected answer from the database.', code: 'server_error' }, 500);
  }
  if (data.ok === false) {
    // On a failure, "status" is the HTTP status the database wants used.
    const { ok, status, ...rest } = data;
    const headers = {};
    if (status === 429) headers['Retry-After'] = String(rest.retry_after_seconds || 30);
    if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
    return json(rest, status || 400, headers);
  }
  // On success, "status" (created, duplicate, logged) is part of the answer and stays in it.
  const { ok, ...rest } = data;
  // A new record is 201. A duplicate or a plain read is 200.
  const created = rest.status === 'created' || rest.status === 'logged';
  return json(rest, created ? 201 : 200);
}

async function callFunction(fn, args) {
  const db = dbClient();
  if (!db) return json({ error: 'The server is missing its database settings.', code: 'server_error' }, 500);
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    console.error(`bot api: ${fn} failed:`, error.code, error.message);
    // 42883 / PGRST202: the function does not exist yet, so migration 161 has not been run.
    if (error.code === 'PGRST202' || error.code === '42883') {
      return json({ error: 'The bot API is not set up on this server yet.', code: 'not_configured' }, 503);
    }
    return json({ error: 'Something went wrong on our side. Try again in a moment.', code: 'server_error' }, 500);
  }
  return respond(data);
}

// GET: every query parameter becomes a filter. The database checks the names
// and values and answers with the allowed list when something is wrong, so the
// list of filters lives in one place (the migration), not here.
export async function botGet(request, fn, { filters = true } = {}) {
  const key = keyFrom(request);
  if (!key) return missingKey();
  const args = { p_key: key };
  if (filters) args.p_filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return callFunction(fn, args);
}

// GET one record by the id in the address. The list function does the work with an
// id filter, so a bot can fetch a single record without a second set of rules.
// Answers with the record itself, or 404 when there is no such record (or it is not
// one a bot may see).
export async function botGetOne(request, fn, id) {
  const key = keyFrom(request);
  if (!key) return missingKey();
  const db = dbClient();
  if (!db) return json({ error: 'The server is missing its database settings.', code: 'server_error' }, 500);
  const { data, error } = await db.rpc(fn, { p_key: key, p_filters: { id: String(id || '') } });
  if (error) {
    console.error(`bot api: ${fn} failed:`, error.code, error.message);
    if (error.code === 'PGRST202' || error.code === '42883') {
      return json({ error: 'The bot API is not set up on this server yet.', code: 'not_configured' }, 503);
    }
    return json({ error: 'Something went wrong on our side. Try again in a moment.', code: 'server_error' }, 500);
  }
  if (data && data.ok === true) {
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (!item) return json({ error: 'No record with that id.', code: 'not_found' }, 404);
    return json(item, 200);
  }
  // A bad filter value (such as an id that is not a UUID) is a 404 for a single record.
  if (data && data.ok === false && data.code === 'invalid_filter') {
    return json({ error: 'No record with that id.', code: 'not_found' }, 404);
  }
  return respond(data);
}

// Reads the key and the JSON object body shared by every POST. Returns either
// { response } (hand it straight back) or { key, body }.
async function readJsonBody(request) {
  const key = keyFrom(request);
  if (!key) return { response: missingKey() };

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_CHARS) return { response: json({ error: 'Request body is too large.', code: 'too_large' }, 413) };
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return { response: json({ error: 'Request body is too large.', code: 'too_large' }, 413) };

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { response: json({ error: 'Body must be valid JSON.', code: 'invalid_json' }, 400) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { response: json({ error: 'Send a JSON object.', code: 'invalid_body' }, 422) };
  }
  return { key, body };
}

// POST: JSON object body, optional Idempotency-Key header.
export async function botPost(request, fn) {
  const read = await readJsonBody(request);
  if (read.response) return read.response;
  const idem = request.headers.get('idempotency-key');
  return callFunction(fn, { p_key: read.key, p_body: read.body, p_idem: idem || null });
}

// PATCH: the id comes from the address, the body is the fields to fill in.
// Same Idempotency-Key rules as POST.
export async function botPatch(request, fn, id) {
  const read = await readJsonBody(request);
  if (read.response) return read.response;
  const idem = request.headers.get('idempotency-key');
  return callFunction(fn, { p_key: read.key, p_id: String(id || ''), p_body: read.body, p_idem: idem || null });
}

// POST that also accepts a batch: { "<listKey>": [ {...}, {...} ] }. Anything
// else is handled exactly like botPost, so single calls are unchanged.
//
// Each item is its own call to the database function, so each one is checked,
// rate limited and audited on its own, the same as if the bot had sent them
// one by one. Answers 200 with one result per item (the same fields a single
// call returns, plus "index"), so one bad item never hides the others. If the
// rate limit is hit, the rest are marked skipped and Retry-After is set.
// An Idempotency-Key header covers the batch: item N uses "<key>:N".
export async function botPostMany(request, fn, { listKey, max = 25 }) {
  const read = await readJsonBody(request);
  if (read.response) return read.response;
  const idem = request.headers.get('idempotency-key') || null;
  const list = read.body[listKey];

  if (!Array.isArray(list)) {
    return callFunction(fn, { p_key: read.key, p_body: read.body, p_idem: idem });
  }
  if (Object.keys(read.body).length !== 1) {
    return json({ error: `Send either one object, or only { "${listKey}": [ ... ] }.`, code: 'invalid_body' }, 422);
  }
  if (list.length === 0 || list.length > max) {
    return json({ error: `Send between 1 and ${max} items in "${listKey}".`, code: 'invalid_body' }, 422);
  }
  if (idem && idem.length > 120) {
    return json({ error: 'For a batch, Idempotency-Key can be at most 120 characters.', code: 'invalid_idempotency_key' }, 422);
  }

  const db = dbClient();
  if (!db) return json({ error: 'The server is missing its database settings.', code: 'server_error' }, 500);

  const results = [];
  let limited = null;
  for (let i = 0; i < list.length; i += 1) {
    if (limited) {
      results.push({ index: i, ok: false, status: 'skipped', http_status: 429, code: 'rate_limited', error: 'Not tried, the rate limit was reached. Send this one again after the wait.' });
      continue;
    }
    const item = list[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      results.push({ index: i, ok: false, http_status: 422, code: 'invalid_body', error: 'Each item must be a JSON object.' });
      continue;
    }
    const { data, error } = await db.rpc(fn, { p_key: read.key, p_body: item, p_idem: idem ? `${idem}:${i}` : null });
    if (error) {
      console.error(`bot api: ${fn} failed:`, error.code, error.message);
      if (error.code === 'PGRST202' || error.code === '42883') {
        return json({ error: 'The bot API is not set up on this server yet.', code: 'not_configured' }, 503);
      }
      results.push({ index: i, ok: false, http_status: 500, code: 'server_error', error: 'Something went wrong on our side.' });
      continue;
    }
    if (data && data.ok === false) {
      // A bad, revoked or out of scope key refuses the whole request.
      if (data.status === 401 || data.status === 403) return respond(data);
      if (data.status === 429) limited = data;
      const { ok, status, ...rest } = data;
      results.push({ index: i, ok: false, http_status: status || 400, ...rest });
      continue;
    }
    const { ok, ...rest } = data || {};
    results.push({ index: i, ok: true, ...rest });
  }

  const succeeded = results.filter(r => r.ok).length;
  const headers = limited ? { 'Retry-After': String(limited.retry_after_seconds || 30) } : {};
  return json({ results, summary: { total: list.length, ok: succeeded, failed: list.length - succeeded } }, 200, headers);
}
