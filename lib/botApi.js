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

// POST: JSON object body, optional Idempotency-Key header.
export async function botPost(request, fn) {
  const key = keyFrom(request);
  if (!key) return missingKey();

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_CHARS) return json({ error: 'Request body is too large.', code: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: 'Request body is too large.', code: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Body must be valid JSON.', code: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Send a JSON object.', code: 'invalid_body' }, 422);
  }

  const idem = request.headers.get('idempotency-key');
  return callFunction(fn, { p_key: key, p_body: body, p_idem: idem || null });
}
