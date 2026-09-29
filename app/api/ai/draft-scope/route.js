import { guardAI, logAI, callClaude, parseJsonObject, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';

// Step 2 of voice-to-scope (and also usable from typed notes directly):
// turns a site-walk transcript into a draft list of scope-of-work line
// items, in the same shape the Scope of Work editor already uses. Nothing
// is saved here — the estimator reviews, edits, and adds them like any
// manually-typed item.

const SYSTEM = `You draft scope-of-work line items for a residential/commercial contractor (McLoud Construction) from a transcript of a site walkthrough.
Write each item as a short, specific, customer-facing sentence describing work to be done (e.g. "Remove and replace existing kitchen cabinetry with new custom cabinets" not "cabinets"). Split distinct pieces of work into separate items rather than one long run-on sentence. Use ONLY what is stated or clearly implied in the transcript — never invent quantities, brands, or measurements that weren't mentioned. If the transcript is too short or unclear to produce real scope items, return an empty list rather than guessing.
${UNTRUSTED_RULE}
Reply with ONLY a JSON object: {"items": ["...", "..."]}`;

export async function POST(request) {
  const gate = await guardAI(request, 'draft_scope');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId || null;
    const transcript = String(body.transcript || '').slice(0, 12000);
    const projectType = String(body.projectType || '').slice(0, 200);
    const existingItems = Array.isArray(body.existingItems) ? body.existingItems.slice(0, 60) : [];
    if (!transcript.trim()) return Response.json({ error: 'No transcript to work from.' }, { status: 400 });

    let text = projectType ? `Project type: ${projectType}\n\n` : '';
    if (existingItems.length) text += `Scope items already on this estimate (do not repeat these — only add what's new in the walkthrough):\n${existingItems.map(i => `- ${i}`).join('\n')}\n\n`;
    text += `Walkthrough transcript:\n${untrusted('transcript', transcript)}`;

    const result = await callClaude({ system: SYSTEM, content: text, maxTokens: 1500, config: gate.config });
    const draft = parseJsonObject(result.text);
    const items = Array.isArray(draft.items) ? draft.items.map(String).filter(t => t.trim()).slice(0, 40) : [];
    await logAI(gate, { jobId, usage: result.usage });
    return Response.json({ items });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err, 'Could not draft scope items from that recording.');
  }
}
