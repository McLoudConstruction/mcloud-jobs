import { guardAI, logAI, callClaude, parseJsonObject, untrusted, UNTRUSTED_RULE, failure } from '../../../../lib/aiClient';

// Drafts a reply to a customer review — either a short public reply (for a
// review that was published, e.g. to post alongside it or on Google) or a
// private follow-up talking point list (for a low rating that needs a call).
// Staff review and send/use it themselves; nothing is posted automatically.

const SYSTEM = `You draft replies to customer reviews for a residential/commercial contractor (McLoud Construction).
For a "public" reply: 2-4 sentences, warm and specific (reference something real from the review, not generic), thanks the customer, and for a review below 4 stars, acknowledges the issue without being defensive or making excuses. No hype, no emojis.
For "followup" talking points: a short internal list (3-5 short bullet lines, plain text with leading "- ") for whoever calls the customer back after a low rating — what to acknowledge, what to ask, and what NOT to say (don't promise specific compensation, don't argue with their experience).
${UNTRUSTED_RULE}
Reply with ONLY a JSON object: {"public_reply": "...", "followup_points": "..."}. Fill only the field that was asked for; leave the other as "".`;

export async function POST(request) {
  const gate = await guardAI(request, 'draft_review_reply');
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  try {
    const body = await request.json();
    const mode = body.mode === 'followup' ? 'followup' : 'public';
    const rating = Number(body.rating) || null;
    const comment = String(body.comment || '').slice(0, 3000);
    const reviewerName = String(body.reviewerName || '').slice(0, 80);
    if (!comment.trim() && !rating) return Response.json({ error: 'Nothing to draft from — this review has no rating or comment.' }, { status: 400 });

    const text = `Draft a "${mode}" reply.\nRating: ${rating ? `${rating} of 5 stars` : 'not given'}\nReviewer: ${untrusted('reviewer_name', reviewerName || 'not given')}\nComment: ${untrusted('comment', comment || '(no written comment)')}`;
    const result = await callClaude({ system: SYSTEM, content: text, maxTokens: 500, config: gate.config });
    const draft = parseJsonObject(result.text);
    await logAI(gate, { usage: result.usage });
    return Response.json({ public_reply: String(draft.public_reply || ''), followup_points: String(draft.followup_points || '') });
  } catch (err) {
    await logAI(gate, { ok: false });
    return failure(err, 'Could not draft a reply.');
  }
}
