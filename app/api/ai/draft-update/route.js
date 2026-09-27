import { guardAI, logAI, callClaude, parseJsonObject, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';

// Drafts a customer-facing progress update from a contractor's rough notes,
// the internal field log, this week's schedule, and (optionally) photos.
// Returns text for the update form's fields — nothing is saved here; the
// person reads and edits it first.

const SYSTEM = `You write short progress updates that a residential/commercial contractor (McLoud Construction) sends to a customer.
Voice: plain, warm, specific, first person plural ("we"). No hype, no filler, no emojis.
Facts: use ONLY what appears in the notes, the field log, the schedule, or is clearly visible in the attached photos. If something is not stated, leave it out — never guess dates, costs, causes, or completion percentages. If the notes mention a problem, describe it honestly and neutrally without blaming anyone.
${UNTRUSTED_RULE}
Reply with ONLY a JSON object with these string fields (use "" when there is nothing true to say):
{"work_completed": "...", "upcoming_work": "...", "issues_notes": "...", "next_steps": "..."}
work_completed: what was done, 1–4 short sentences or a few "- " bullets. upcoming_work: what's planned next per the schedule/notes. issues_notes: only real issues/delays/decisions needed from the customer. next_steps: what happens next / what we need from them.`;

export async function POST(request) {
  const gate = await guardAI(request, 'draft_update');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId;
    const notes = String(body.notes || '').slice(0, 6000);
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds.slice(0, 6) : [];
    if (!jobId) return Response.json({ error: 'Missing job.' }, { status: 400 });
    if (!notes.trim() && photoIds.length === 0) return Response.json({ error: 'Add a few rough notes or pick some photos first.' }, { status: 400 });

    const { admin } = gate;
    const { data: job } = await admin.from('jobs').select('customer_name, project_type, project_address, stage, description').eq('id', jobId).single();
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });

    const [{ data: log }, { data: phases }] = await Promise.all([
      admin.from('job_updates').select('issues_notes, created_at').eq('job_id', jobId).eq('is_internal', true).order('created_at', { ascending: false }).limit(6),
      admin.from('job_phases').select('label, trade, start_date, end_date').eq('job_id', jobId).eq('status', 'published').order('start_date'),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const upcoming = (phases || []).filter(p => p.end_date >= today && p.start_date <= soon)
      .map(p => `${p.start_date} to ${p.end_date}: ${p.label}${p.trade ? ` (${p.trade})` : ''}`).join('\n');

    let text = `Today: ${today}\nJob: ${job.project_type || 'project'} at ${job.project_address || 'the property'} for ${job.customer_name || 'the customer'} (stage: ${job.stage})\n\n`;
    text += `Scheduled in the next 10 days:\n${upcoming || '(nothing on the published schedule)'}\n\n`;
    text += `Rough notes from the contractor:\n${untrusted('notes', notes || '(none — describe from the photos)')}\n\n`;
    if (log?.length) text += `Recent internal field log (newest first):\n${untrusted('field_log', log.map(l => `- ${(l.issues_notes || '').slice(0, 400)}`).join('\n'))}\n`;

    // Photos: signed URLs the model fetches directly. Only photos that belong to this job.
    let imageBlocks = [];
    if (photoIds.length) {
      const { data: photos } = await admin.from('job_photos').select('id, storage_path').eq('job_id', jobId).in('id', photoIds);
      for (const p of photos || []) {
        const { data: signed } = await admin.storage.from('job-photos').createSignedUrl(p.storage_path, 600);
        if (signed?.signedUrl && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(p.storage_path)) imageBlocks.push({ type: 'image', source: { type: 'url', url: signed.signedUrl } });
      }
    }

    let result;
    let photosUsed = imageBlocks.length;
    try {
      result = await callClaude({ system: SYSTEM, content: [...imageBlocks, { type: 'text', text }], maxTokens: 900 });
    } catch (err) {
      // A photo the model can't fetch/decode shouldn't sink the whole draft.
      if (imageBlocks.length && err.status === 400) {
        photosUsed = 0;
        result = await callClaude({ system: SYSTEM, content: text, maxTokens: 900 });
      } else throw err;
    }
    const draft = parseJsonObject(result.text);
    await logAI(gate, { jobId, usage: result.usage });
    return Response.json({
      draft: {
        work_completed: String(draft.work_completed || ''),
        upcoming_work: String(draft.upcoming_work || ''),
        issues_notes: String(draft.issues_notes || ''),
        next_steps: String(draft.next_steps || ''),
      },
      photosUsed,
    });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err);
  }
}
