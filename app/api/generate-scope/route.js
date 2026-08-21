import { SERVICES_OFFERED } from '../../../lib/constants';

// Tries increasingly forgiving strategies to pull the model's JSON object
// out of its response, so a stray preamble or trailing note doesn't waste
// the whole (paid-for) API call.
function extractJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }

  return null;
}

// If the full object didn't parse (most often because the response got
// cut off mid-way through the much longer trade_actions array), this
// pulls just the customer_items array out on its own via regex, so a
// truncated trade breakdown doesn't take the whole request down with it
// — customer_items always comes first in the prompt, so it's usually
// intact even when the response got cut short later on.
function extractCustomerItemsOnly(text) {
  const match = text.match(/"customer_items"\s*:\s*(\[[\s\S]*?\])/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const { description, projectType, includeTradeBreakdown } = await request.json();

    if (!description || !description.trim()) {
      return Response.json({ error: 'Describe the job first.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: 'AI scope generation is not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const tradeSection = includeTradeBreakdown ? `

SECOND, also produce an exhaustive, contractor-side action list — every individual task needed to actually deliver this scope, not consolidated like the customer list above. This is an internal checklist, so break things all the way down: each distinct fixture, line, or unit of work gets its own entry.

For each entry, count correctly the first time — if the job involves 2 sinks, that typically means 2 faucets, but could mean 4 supply lines (2 hot, 2 cold) and 2 drain lines; think through the real quantities like an estimator would, don't just copy the customer-facing count.

Critically: only state a specific quantity when the description actually gives you enough information to know it. If the description doesn't specify a count — for example "replace kitchen cabinets" with no number of cabinets given — do NOT invent a number based on what a "typical" kitchen usually has. Instead, set quantity to 1 and write the description to make the uncertainty explicit, e.g. "Base cabinets — count not specified, confirm on-site" rather than presenting a guessed number as if it were real. A confident-looking number the contractor didn't actually provide is worse than an honest placeholder.

Tag every entry with the single best-matching trade from this exact list (use these exact strings, nothing else): ${JSON.stringify(SERVICES_OFFERED)}.

Each entry needs: "description" (the action, concise), "trade" (one of the exact strings above, or "Other" if none fit), "unit_label" (the countable unit, e.g. "faucet", "supply line", "sheet of drywall" — singular), "quantity" (a number).

Respond with a single JSON object shaped exactly like this:
{"customer_items": ["...", "..."], "trade_actions": [{"description": "...", "trade": "...", "unit_label": "...", "quantity": 2}]}` : `

Respond with a single JSON object shaped exactly like this:
{"customer_items": ["...", "..."]}`;

    const prompt = `You are helping an experienced ${projectType === 'commercial' ? 'commercial' : 'residential'} construction contractor write the scope of work section of a CLIENT-FACING proposal — the customer will read this document. It is not an internal crew checklist or a step-by-step work breakdown.

The contractor described the job like this:
"${description.trim()}"

FIRST, write a concise, consolidated customer-facing scope of work. Each line item should represent a meaningful phase or category of work, not a single micro-step — combine related tasks into one item wherever a client would naturally expect them bundled together.

For example:
- Instead of separate lines for disconnecting plumbing, disconnecting electrical, and disconnecting gas, write one line: "Disconnect and cap all plumbing, electrical, and gas lines in the work area."
- Instead of separate lines for removing upper cabinets and removing lower cabinets, write one line: "Remove and haul away existing cabinetry."
- Instead of separate lines for each reconnection step, write one line: "Reconnect and test all plumbing, electrical, and gas connections."

Aim for roughly 8-15 total line items for a job like this — enough to be clear and complete, not exhaustive. Cover the major phases: preparation/protection, demolition/removal, any rough-in adjustments, installation, and finishing/cleanup.${tradeSection}

Do not include any preamble, explanation, or markdown code fences — your entire response must be valid JSON starting with { and ending with }.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // The trade breakdown can legitimately run long on a complex job
        // (30-40 granular actions, each with 4 fields) — this needs real
        // headroom, not just a bit more than the simple customer-only case.
        max_tokens: includeTradeBreakdown ? 8000 : 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    // Find the text block specifically rather than assuming it's always
    // at index 0 — some responses can include other block types first,
    // which would silently produce an empty string here otherwise.
    const fullText = data.content?.find(block => block.type === 'text')?.text || '';
    const wasTruncated = data.stop_reason === 'max_tokens';

    let parsed = extractJson(fullText);
    let items = Array.isArray(parsed?.customer_items) ? parsed.customer_items.filter(x => typeof x === 'string' && x.trim()) : null;

    // Full parse failed (most likely truncation) — try to salvage just
    // the customer-facing list on its own, since that's the part that
    // actually blocks the person from moving forward.
    let recoveredPartial = false;
    if (!items || items.length === 0) {
      const recovered = extractCustomerItemsOnly(fullText);
      if (recovered && recovered.length > 0) {
        items = recovered.filter(x => typeof x === 'string' && x.trim());
        recoveredPartial = true;
      }
    }

    if (!items || items.length === 0) {
      // Surface what the model actually said instead of a generic
      // message — a blind "unexpected format" the second time around
      // means guessing isn't working; seeing the real output will.
      const snippet = fullText.trim() ? fullText.trim().slice(0, 300) : '(empty response — no text block found)';
      throw new Error(
        wasTruncated
          ? 'The AI response ran out of room before finishing — try a shorter job description, or turn off the trade breakdown for this one.'
          : `AI returned an unexpected format. Raw response started with: "${snippet}"`
      );
    }

    const tradeActions = (!recoveredPartial && Array.isArray(parsed?.trade_actions))
      ? parsed.trade_actions.filter(a => a && typeof a.description === 'string' && a.description.trim()).map(a => ({
          description: a.description.trim(),
          trade: SERVICES_OFFERED.includes(a.trade) ? a.trade : 'Other',
          unit_label: typeof a.unit_label === 'string' ? a.unit_label.trim() : null,
          quantity: Number.isFinite(a.quantity) ? a.quantity : 1,
        }))
      : [];

    const warning = recoveredPartial
      ? 'The trade breakdown ran out of room and was skipped this time — the customer scope came through fine. Try again, or shorten the description, to get the trade breakdown too.'
      : (includeTradeBreakdown && tradeActions.length === 0)
        ? `The customer scope came through, but no trade breakdown was returned this time. Raw response started with: "${fullText.trim().slice(0, 300) || '(empty)'}"`
        : null;

    return Response.json({ items, tradeActions, warning });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to generate scope.' }, { status: 500 });
  }
}
