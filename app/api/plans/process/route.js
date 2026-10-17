import { guardAI, logAI } from '../../../../lib/aiClient';
import {
  BUCKET, MAX_CHUNK_ATTEMPTS, EST_TOKENS_PER_PAGE, EST_OUTPUT_PER_CHUNK,
  resolveAnthropic, getJobBudget, buildChunkText, analyzeChunk, draftScopeSentences, cleanItem, itemKey, weightedTokens,
} from '../../../../lib/planTakeoff';

// Step 2 of a plan takeoff. The browser calls this over and over; each call
// does ONE unit of work (analyze one chunk, or write the final scope) and
// returns progress. That keeps every request short, lets a person stop and
// resume, and means a failure only ever loses one small chunk.
export const maxDuration = 300;

const LOCK_MINUTES = 6;

function progressOf(t, budget, extra = {}) {
  const chunks = t.chunks || [];
  const done = chunks.filter(c => c.status === 'done').length;
  const failed = chunks.filter(c => c.status === 'failed').length;
  return {
    status: t.status, doneChunks: done, failedChunks: failed, totalChunks: chunks.length,
    tokensUsed: budget.used, cap: budget.cap, itemsAdded: t.items_added, itemsFlagged: t.items_flagged,
    message: t.message || null, ...extra,
  };
}

export async function POST(request) {
  // A plan set can need dozens of chunk calls, so this feature gets a higher hourly allowance than drafts.
  const gate = await guardAI(request, 'plan_takeoff', { hourlyLimit: 150 });
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const admin = gate.admin;

  let takeoffId;
  try { ({ takeoffId } = await request.json()); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }

  // Take the run lock so two open tabs never process the same run at once.
  const nowIso = new Date().toISOString();
  const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
  const { data: locked } = await admin.from('job_plan_takeoffs')
    .update({ lock_until: lockUntil, status: 'processing', updated_at: nowIso })
    .eq('id', takeoffId).in('status', ['ready', 'processing', 'stopped'])
    .or(`lock_until.is.null,lock_until.lt.${nowIso}`)
    .select('*').maybeSingle();

  if (!locked) {
    const { data: t } = await admin.from('job_plan_takeoffs').select('*').eq('id', takeoffId).maybeSingle();
    if (!t) return Response.json({ error: 'That plan run was not found.' }, { status: 404 });
    const budget = await getJobBudget(admin, t.job_id);
    if (t.status === 'done') return Response.json({ state: 'done', ...progressOf(t, budget) });
    if (t.status === 'draft') return Response.json({ error: 'Prepare the plans before analyzing them.' }, { status: 409 });
    return Response.json({ state: 'busy', ...progressOf(t, budget), message: 'This run is already being processed in another window.' });
  }

  let t = locked;
  const release = async (patch = {}) => {
    const { data } = await admin.from('job_plan_takeoffs')
      .update({ lock_until: null, updated_at: new Date().toISOString(), ...patch }).eq('id', takeoffId).select('*').single();
    return data || t;
  };

  try {
    const ai = resolveAnthropic(gate.config);
    const budget = await getJobBudget(admin, t.job_id);
    const chunks = Array.isArray(t.chunks) ? [...t.chunks] : [];

    const pending = chunks
      .map((c, index) => ({ c, index }))
      .filter(x => x.c.status === 'pending')
      .sort((a, b) => a.c.priority - b.c.priority || a.index - b.index);

    // Decide whether to analyze another chunk or wrap up.
    let stopReason = null;
    const next = pending[0];
    if (next) {
      const est = next.c.pages.length * EST_TOKENS_PER_PAGE + EST_OUTPUT_PER_CHUNK;
      if (budget.used + est > budget.cap) {
        stopReason = 'budget';
      }
    }

    if (next && !stopReason) {
      const result = await runChunk({ admin, gate, ai, t, chunks, next });
      t = await release({ ...result.patch, finalized_at: null });
      const fresh = await getJobBudget(admin, t.job_id);
      return Response.json({ state: 'working', ...progressOf(t, fresh), note: result.note || null });
    }

    // Nothing left to analyze (or the cap is reached): write the scope sentences, then close out.
    const unanalyzed = chunks.filter(c => c.status !== 'done').reduce((n, c) => n + c.pages.length, 0);
    let scopeAdded = 0;
    if (!t.finalized_at) scopeAdded = await finalizeScope({ admin, gate, ai, t });

    const allDone = unanalyzed === 0;
    let message;
    if (allDone) message = 'All selected sheets were analyzed.';
    else if (stopReason === 'budget') message = `Stopped at this job's token cap with ${unanalyzed} sheets not yet analyzed. Raise the cap to continue.`;
    else message = `${unanalyzed} sheets could not be analyzed. You can retry them.`;

    t = await release({ status: allDone ? 'done' : 'stopped', message, finalized_at: new Date().toISOString() });
    await cleanupChunkFiles(admin, t, allDone);
    const fresh = await getJobBudget(admin, t.job_id);
    return Response.json({ state: allDone ? 'done' : 'stopped', ...progressOf(t, fresh), scopeAdded });
  } catch (err) {
    const msg = err?.message || 'Something went wrong while analyzing the plans.';
    t = await release({ message: msg });
    const fresh = await getJobBudget(admin, t.job_id);
    // A configuration problem will not fix itself by retrying.
    const fatal = /API key|not configured|Not signed in/i.test(msg);
    return Response.json({ state: fatal ? 'failed' : 'retry', ...progressOf(t, fresh), message: msg }, { status: 200 });
  }
}

// ---------------------------------------------------------------------------
async function runChunk({ admin, gate, ai, t, chunks, next }) {
  const { c, index } = next;
  const jobId = t.job_id;

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(c.path);
  if (dlErr || !blob) {
    chunks[index] = { ...c, status: 'failed', error: 'Working copy of these sheets is missing.' };
    return { patch: { chunks, message: 'Part of the plan set could not be read. Prepare the run again.' } };
  }
  const pdfBase64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

  const { data: existingRows } = await admin.from('job_scope_actions')
    .select('id, description, area, unit_label, quantity, needs_verification, verify_note')
    .eq('job_id', jobId).eq('source', 'plan_ai');
  const existing = existingRows || [];

  const text = buildChunkText({ intake: t, fileName: c.file, chunk: c, existing });

  let reply;
  try {
    reply = await withRetry(() => analyzeChunk({ ai, pdfBase64, text }));
  } catch (err) {
    const tokens = weightedTokens(err.usage);
    await logAI(gate, { jobId, usage: err.usage, ok: false });
    const base = { tokens_used: (t.tokens_used || 0) + tokens };

    // Too long for one reply, or too slow: cut the chunk in half and try again. Cheap and automatic.
    if ((err.kind === 'truncated' || err.kind === 'timeout') && c.pages.length > 1) {
      const half = await splitChunk({ admin, c, jobId, takeoffId: t.id, chunks });
      if (half) {
        chunks.splice(index, 1, ...half);
        return { patch: { ...base, chunks }, note: 'Large section split into smaller parts.' };
      }
    }
    const attempts = (c.attempts || 0) + 1;
    // A single sheet that is too dense to read in one pass will not get better on retry, so do not pay for it again.
    const giveUp = attempts >= MAX_CHUNK_ATTEMPTS
      || (err.kind === 'truncated' && c.pages.length === 1)
      || (err.kind === 'api' && err.status && err.status < 500 && err.status !== 429);
    chunks[index] = { ...c, attempts, status: giveUp ? 'failed' : 'pending', error: err.message };
    return { patch: { ...base, chunks, message: giveUp ? `Skipped some sheets: ${err.message}` : `Retrying: ${err.message}` } };
  }

  await logAI(gate, { jobId, usage: reply.usage });
  const used = weightedTokens(reply.usage);

  // Clean, merge with what is already on the job, and save.
  const byKey = new Map(existing.map(e => [itemKey(e), e]));
  const inserts = [];
  let differs = 0;
  for (const raw of (reply.input.items || [])) {
    const item = cleanItem(raw, { fileName: c.file, chunk: c });
    if (!item) continue;
    const key = itemKey(item);
    const dup = byKey.get(key);
    if (dup) {
      if (dup.id && Number(dup.quantity) !== item.quantity && !(dup.verify_note || '').includes('Plans differ')) {
        const note = `Plans differ: ${dup.quantity} vs ${item.quantity} (${item.sheet_ref}). Confirm the right count.`;
        const { error } = await admin.from('job_scope_actions').update({ needs_verification: true, verify_note: note }).eq('id', dup.id);
        if (error) throw new Error('Could not save a note on an existing item: ' + error.message);
        differs += 1;
      }
      continue;
    }
    byKey.set(key, { ...item, id: null });
    inserts.push({ ...item, job_id: jobId, source: 'plan_ai', plan_takeoff_id: t.id });
  }
  if (inserts.length) {
    const { error } = await admin.from('job_scope_actions').insert(inserts);
    if (error) throw new Error('Could not save the takeoff items: ' + error.message);
  }

  const unreadable = Array.isArray(reply.input.unreadable_pages) ? reply.input.unreadable_pages : [];
  const unreadableNote = unreadable.length
    ? `Could not read: ${unreadable.map(p => `p.${c.pages[(p || 1) - 1] ?? p}`).join(', ')}`
    : null;

  const flagged = inserts.filter(i => i.needs_verification).length + differs;
  chunks[index] = { ...c, status: 'done', tokens: used, items: inserts.length, error: unreadableNote };
  return {
    patch: {
      chunks,
      tokens_used: (t.tokens_used || 0) + used,
      items_added: (t.items_added || 0) + inserts.length,
      items_flagged: (t.items_flagged || 0) + flagged,
      message: unreadableNote || null,
    },
  };
}

// One in-request retry for rate limits and overload. Anything longer is left to
// the browser loop, which calls again after a pause.
async function withRetry(fn) {
  try { return await fn(); }
  catch (err) {
    if (err.kind === 'rate') {
      const waitMs = Math.min((err.retryAfter || 6) * 1000, 20000);
      await new Promise(r => setTimeout(r, waitMs));
      return await fn();
    }
    throw err;
  }
}

async function splitChunk({ admin, c, jobId, takeoffId, chunks }) {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const { data: blob } = await admin.storage.from(BUCKET).download(c.path);
    if (!blob) return null;
    const src = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
    const mid = Math.ceil(c.pages.length / 2);
    const parts = [[0, mid], [mid, c.pages.length]];
    const out = [];
    let n = chunks.length;
    for (const [from, to] of parts) {
      const doc = await PDFDocument.create();
      const idx = Array.from({ length: to - from }, (_, i) => from + i);
      (await doc.copyPages(src, idx)).forEach(p => doc.addPage(p));
      n += 1;
      const id = `c${String(n).padStart(3, '0')}s`;
      const path = `${jobId}/${takeoffId}/chunks/${id}.pdf`;
      const { error } = await admin.storage.from(BUCKET).upload(path, await doc.save({ useObjectStreams: true }), { contentType: 'application/pdf', upsert: true });
      if (error) return null;
      out.push({ ...c, id, path, pages: c.pages.slice(from, to), labels: (c.labels || []).slice(from, to), status: 'pending', attempts: 0, tokens: 0, items: 0, error: null });
    }
    return out;
  } catch { return null; }
}

async function finalizeScope({ admin, gate, ai, t }) {
  const { data: actions } = await admin.from('job_scope_actions')
    .select('description, area, needs_verification').eq('job_id', t.job_id).eq('plan_takeoff_id', t.id).limit(400);
  if (!actions || actions.length === 0) return 0;
  const { data: job, error: jobErr } = await admin.from('jobs').select('scope_items').eq('id', t.job_id).single();
  if (jobErr) throw new Error('Could not read the job scope: ' + jobErr.message);
  const existingScope = (job.scope_items || []).map(s => s.text || '').filter(Boolean);

  const reply = await withRetry(() => draftScopeSentences({ ai, actions, existingScope }));
  await logAI(gate, { jobId: t.job_id, usage: reply.usage });
  await admin.from('job_plan_takeoffs').update({ tokens_used: (t.tokens_used || 0) + weightedTokens(reply.usage) }).eq('id', t.id);

  const have = new Set(existingScope.map(s => s.trim().toLowerCase()));
  const add = [...new Set((reply.input.sentences || []).map(s => String(s).trim()).filter(Boolean))]
    .filter(s => !have.has(s.toLowerCase())).slice(0, 20);
  if (!add.length) return 0;
  const { error } = await admin.from('jobs').update({ scope_items: [...(job.scope_items || []), ...add.map(text => ({ text }))] }).eq('id', t.job_id);
  if (error) throw new Error('Could not add the scope sentences: ' + error.message);
  return add.length;
}

// Working copies are only needed while a run can still continue. When every
// chunk is done they are deleted. The original uploads are always kept.
async function cleanupChunkFiles(admin, t, allDone) {
  if (!allDone) return;
  const paths = (t.chunks || []).map(c => c.path).filter(Boolean);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths).catch(() => {});
}
