import { PDFDocument } from 'pdf-lib';
import { getDocumentProxy, extractText } from 'unpdf';
import { getAdminClient } from '../../../../lib/supabaseAdmin';
import { requireStaff } from '../../../../lib/integrations/authHelper';
import { classifyPage, planChunks, summarizeSkips } from '../../../../lib/planTriage';
import { BUCKET, MAX_CHUNK_PAGES, MAX_CHUNK_BYTES, MAX_FILE_BYTES, MAX_PAGES_PER_RUN, estimateTokens, getJobBudget } from '../../../../lib/planTakeoff';

// Step 1 of a plan takeoff, one call per uploaded file. No AI is used here.
// It reads the PDF, labels and ranks every page from its own text, drops pages
// that cannot help a takeoff, and cuts the useful pages into small chunk PDFs
// stored next to the original. Doing this once means each analysis request later
// only downloads a small file, and one huge PDF never has to be reopened.
export const maxDuration = 300;

export async function POST(request) {
  const auth = await requireStaff(request);
  if (auth.error) return Response.json({ error: auth.error }, { status: auth.status });
  const admin = getAdminClient();

  let takeoffId; let fileIndex;
  try { ({ takeoffId, fileIndex } = await request.json()); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }

  const { data: t, error: loadErr } = await admin.from('job_plan_takeoffs').select('*').eq('id', takeoffId).maybeSingle();
  if (loadErr || !t) return Response.json({ error: 'That plan run was not found.' }, { status: 404 });
  if (!['draft', 'ready'].includes(t.status)) return Response.json({ error: 'This run has already started.' }, { status: 409 });
  const files = Array.isArray(t.files) ? [...t.files] : [];
  const file = files[fileIndex];
  if (!file) return Response.json({ error: 'File not found on this run.' }, { status: 404 });
  if (file.prepared) return Response.json({ ok: true, alreadyPrepared: true });

  async function fail(message) {
    files[fileIndex] = { ...file, error: message, prepared: true, pages: file.pages || 0 };
    const ready = files.every(f => f.prepared) && (t.chunks || []).length > 0;
    await admin.from('job_plan_takeoffs').update({ files, status: ready ? 'ready' : 'draft', updated_at: new Date().toISOString() }).eq('id', takeoffId);
    return Response.json({ ok: false, error: message });
  }

  try {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(file.path);
    if (dlErr || !blob) return await fail('Could not read the uploaded file. Try uploading it again.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) return await fail('This file is over 50 MB. Split it into smaller PDFs and upload them separately.');

    let src;
    try { src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
    catch { return await fail('This PDF could not be opened. It may be damaged or password protected.'); }
    const pageCount = src.getPageCount();
    if (pageCount === 0) return await fail('This PDF has no pages.');

    // Page text for free triage. If extraction fails the pages are treated as scans.
    let texts = [];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const out = await extractText(pdf, { mergePages: false });
      texts = Array.isArray(out.text) ? out.text : [String(out.text || '')];
    } catch { texts = []; }

    const classified = [];
    const skipped = [];
    for (let i = 0; i < pageCount; i++) {
      const c = classifyPage(texts[i] || '', { workType: t.work_type, notes: t.notes });
      if (c.skip) skipped.push({ file: file.name, page: i + 1, reason: c.reason });
      else classified.push({ page: i + 1, priority: c.priority, label: c.label || null, kind: c.kind });
    }

    // Respect the page limit across the whole run, keeping the most useful pages.
    const alreadySelected = (t.chunks || []).reduce((n, c) => n + c.pages.length, 0);
    const allowance = Math.max(0, MAX_PAGES_PER_RUN - alreadySelected);
    let selected = classified;
    if (classified.length > allowance) {
      const ranked = [...classified].sort((a, b) => a.priority - b.priority || a.page - b.page);
      selected = ranked.slice(0, allowance);
      ranked.slice(allowance).forEach(p => skipped.push({ file: file.name, page: p.page, reason: 'over the page limit for one run' }));
    }

    // Build chunk PDFs. A chunk that is too large to send is split in half;
    // a single sheet that is too large on its own is skipped and reported.
    const labelByPage = Object.fromEntries(selected.map(p => [p.page, p.label || p.kind]));
    const priorityByPage = Object.fromEntries(selected.map(p => [p.page, p.priority]));
    const newChunks = [];
    let counter = (t.chunks || []).length;
    const queue = planChunks(selected, MAX_CHUNK_PAGES).map(c => c.pages);

    while (queue.length) {
      const pages = queue.shift();
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, pages.map(p => p - 1));
      copied.forEach(pg => out.addPage(pg));
      const chunkBytes = await out.save({ useObjectStreams: true });
      if (chunkBytes.length > MAX_CHUNK_BYTES) {
        if (pages.length === 1) {
          skipped.push({ file: file.name, page: pages[0], reason: 'sheet too large to analyze' });
          continue;
        }
        const mid = Math.ceil(pages.length / 2);
        queue.unshift(pages.slice(0, mid), pages.slice(mid));
        continue;
      }
      counter += 1;
      const id = `c${String(counter).padStart(3, '0')}`;
      const path = `${t.job_id}/${t.id}/chunks/${id}.pdf`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, chunkBytes, { contentType: 'application/pdf', upsert: true });
      if (upErr) return await fail('Could not save a working copy of the sheets: ' + upErr.message);
      newChunks.push({
        id, file: file.name, fileIndex, path, pages,
        labels: pages.map(p => labelByPage[p] || null),
        priority: Math.min(...pages.map(p => priorityByPage[p] || 3)),
        status: 'pending', attempts: 0, tokens: 0, items: 0, error: null,
      });
    }

    files[fileIndex] = { ...file, pages: pageCount, selected: newChunks.reduce((n, c) => n + c.pages.length, 0), prepared: true, error: null };
    const allChunks = [...(t.chunks || []), ...newChunks];
    const allSkipped = [...(t.skipped || []), ...skipped];
    const allPrepared = files.every(f => f.prepared);
    const selectedPages = allChunks.reduce((n, c) => n + c.pages.length, 0);
    const est = estimateTokens(selectedPages, allChunks.length);

    const { error: saveErr } = await admin.from('job_plan_takeoffs').update({
      files, chunks: allChunks, skipped: allSkipped, est_tokens: est,
      status: allPrepared ? 'ready' : 'draft', updated_at: new Date().toISOString(),
    }).eq('id', takeoffId);
    if (saveErr) return await fail('Could not save the prepared sheets: ' + saveErr.message);

    const budget = await getJobBudget(admin, t.job_id);
    return Response.json({
      ok: true, pages: pageCount, selected: files[fileIndex].selected, skippedSummary: summarizeSkips(skipped),
      allPrepared, estTokens: est, cap: budget.cap, used: budget.used,
    });
  } catch (err) {
    return await fail('Could not prepare this file: ' + (err.message || 'unknown error'));
  }
}
