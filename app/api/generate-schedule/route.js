import { buildPhaseSkeleton } from '../../../lib/scheduleTemplate';
import { recomputeSequentialDates } from '../../../lib/scheduleDates';

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

export async function POST(request) {
  try {
    const { tradeActions, startDate, projectType } = await request.json();

    if (!Array.isArray(tradeActions) || tradeActions.length === 0) {
      return Response.json({ error: 'Add at least one trade-tagged action to the trade breakdown first.' }, { status: 400 });
    }
    if (!startDate) {
      return Response.json({ error: 'A start date is required.' }, { status: 400 });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: 'AI schedule generation is not configured yet — add ANTHROPIC_API_KEY in Vercel environment variables.' },
        { status: 500 }
      );
    }

    const distinctTrades = [...new Set(tradeActions.map(a => a.trade).filter(Boolean))];
    const skeleton = buildPhaseSkeleton(distinctTrades);

    if (skeleton.length === 0) {
      return Response.json({ error: 'No phases matched this trade breakdown — check that actions have trades assigned.' }, { status: 400 });
    }

    // Group actions by trade for a compact prompt rather than dumping
    // every raw row — the AI needs counts/descriptions, not formatting.
    const actionsByTrade = {};
    for (const a of tradeActions) {
      const key = a.trade || 'Other';
      (actionsByTrade[key] = actionsByTrade[key] || []).push(`${a.quantity}${a.unit_label ? ` ${a.unit_label}` : ''} — ${a.description}`);
    }

    const skeletonSection = skeleton.map(s =>
      `- ${s.key} (${s.label})${s.trades.length ? `, trades: ${s.trades.join(', ')}` : ', no single trade — inspection/milestone'}`
    ).join('\n');

    const actionsSection = Object.entries(actionsByTrade)
      .map(([trade, items]) => `${trade}:\n${items.map(i => `  - ${i}`).join('\n')}`)
      .join('\n\n');

    const prompt = `You are helping an experienced ${projectType === 'commercial' ? 'commercial' : 'residential'} construction contractor estimate how many business days each phase of a project will take, based on the actual scope of work.

The project has already been broken into these phases, in a FIXED order that you must not change (this reflects real construction sequencing and inspection requirements):
${skeletonSection}

Here is the full trade-tagged action list for this job:

${actionsSection}

For each phase key listed above, estimate a realistic duration in business days, based on the volume and complexity of the actions that would fall into that phase. A single-fixture bathroom job's demo phase might be 1 day; a full kitchen gut's demo phase might be 3-4 days. Use your judgment as an experienced estimator — don't default to the same number for every phase.

Note: "Electrical" and "Plumbing" actions can belong to either the rough-in phase or the finish phase depending on what the action actually describes (e.g. "run wiring to new outlets" is rough-in; "install outlet covers and switch plates" is finish) — split your duration estimate for each phase accordingly rather than assuming all electrical/plumbing time belongs to just one of them.

Note: "Tile" actions can belong to either the interior_finishes phase or the finish_trades phase — floor tile and shower/tub-surround tile go in interior_finishes (before countertops), but backsplash tile and any tile that sits against or borders a countertop always goes in finish_trades (after countertops, since it has to be cut and fitted to the actual countertop edge). Split your duration estimate accordingly rather than putting all tile time in one phase.

Respond with a single JSON object mapping each phase key to a whole number of business days, shaped exactly like this, with no other text:
{"durations": {"${skeleton[0].key}": 2, "${skeleton[1]?.key || 'phase_key'}": 3}}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const fullText = data.content?.find(block => block.type === 'text')?.text || '';
    const parsed = extractJson(fullText);
    const durations = parsed?.durations && typeof parsed.durations === 'object' ? parsed.durations : {};

    // Compute real dates sequentially down the skeleton. Phases don't
    // currently overlap even when the template marks them parallelWith —
    // that's a known v1 simplification that would shorten total duration
    // but needs a real scheduler to do safely; sequential dates are a
    // conservative (longer, not shorter) estimate in the meantime.
    const undated = skeleton.map((stage, i) => {
      const duration = Number.isFinite(durations[stage.key]) && durations[stage.key] > 0
        ? Math.round(durations[stage.key])
        : 1; // fall back rather than drop a phase the AI missed
      return {
        phase_key: stage.key,
        label: stage.label,
        trade: stage.trades[0] || null,
        duration_days: duration,
        sort_order: i,
        source: 'ai',
        prefer_monday_start: Boolean(stage.preferMondayStart),
      };
    });
    const phases = recomputeSequentialDates(undated, startDate);

    const missingKeys = skeleton.filter(s => !Number.isFinite(durations[s.key])).map(s => s.key);
    const warning = missingKeys.length > 0
      ? `The AI didn't return a duration for: ${missingKeys.join(', ')} — defaulted to 1 day, review before confirming.`
      : null;

    return Response.json({ phases, warning });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to generate schedule.' }, { status: 500 });
  }
}
