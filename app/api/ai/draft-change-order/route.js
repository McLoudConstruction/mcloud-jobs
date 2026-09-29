import { guardAI, logAI, callClaude, parseJsonObject, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';
import { CHANGE_ORDER_REASON_CATEGORIES } from '../../../../lib/constants';

// Drafts a change-order description and reason classification from a
// contractor's rough field notes (typed, or pulled from a recent internal
// update). The estimator/PM still sets the dollar amount and reviews the
// wording before it goes to the customer — nothing here touches
// change_orders directly.

const REASON_LIST = Object.entries(CHANGE_ORDER_REASON_CATEGORIES)
  .map(([cat, reasons]) => `${cat}: ${reasons.join(', ')}`).join('\n');

const SYSTEM = `You draft a change order for a residential/commercial contractor (McLoud Construction) from a field note describing extra or changed work.
Write a clear, customer-facing description of what changed and why (1-3 sentences, plain and factual, no blame, no dollar amounts — those are set separately). Classify it with the closest matching category and specific reason from this exact list (use the labels verbatim, do not invent new ones):
${REASON_LIST}
${UNTRUSTED_RULE}
Reply with ONLY a JSON object: {"description": "...", "reason_category": "<one of the category names above>", "reason": "<one of that category's specific reasons>"}`;

export async function POST(request) {
  const gate = await guardAI(request, 'draft_change_order');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body.jobId || null;
    const notes = String(body.notes || '').slice(0, 4000);
    if (!notes.trim()) return Response.json({ error: 'Add a few notes about what changed first.' }, { status: 400 });

    const text = `Field notes describing the change:\n${untrusted('notes', notes)}`;
    const result = await callClaude({ system: SYSTEM, content: text, maxTokens: 500, config: gate.config });
    const draft = parseJsonObject(result.text);

    const category = Object.keys(CHANGE_ORDER_REASON_CATEGORIES).includes(draft.reason_category) ? draft.reason_category : null;
    const reason = category && (CHANGE_ORDER_REASON_CATEGORIES[category] || []).includes(draft.reason) ? draft.reason : null;

    await logAI(gate, { jobId, usage: result.usage });
    return Response.json({ description: String(draft.description || ''), reason_category: category, reason });
  } catch (err) {
    await logAI(gate, { jobId, ok: false });
    return failure(err, 'Could not draft that change order.');
  }
}
