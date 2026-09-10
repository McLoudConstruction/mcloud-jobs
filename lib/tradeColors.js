import { PHASE_STAGES } from './scheduleTemplate';

// Matches the --trade-* variables defined in globals.css.
function slug(trade) {
  return trade.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Returns a CSS var() reference, never a raw color — so dark mode keeps
// working the same way it does everywhere else in the app (the
// [data-theme="dark"] block in globals.css, not a JS-side check).
export function tradeColorVar(trade) {
  if (!trade) return 'var(--trade-neutral)';
  return `var(--trade-${slug(trade)}, var(--trade-neutral))`;
}

// Which trades a phase actually represents. Stages that bundle more than
// one trade (rough-in = electrical + plumbing + HVAC) return all of
// them, keyed off the stage definition rather than the single `trade`
// column stored on the row — that column only ever held the first trade,
// which undersold what a bundled phase covers. Falls back to the row's
// own stored trade for manual/custom phases with no matching stage.
export function tradesForPhase(phase) {
  const stage = PHASE_STAGES.find(s => s.key === phase.phase_key);
  if (stage && stage.trades.length > 0) return stage.trades;
  return phase.trade ? [phase.trade] : [];
}

// A CSS background for a phase — solid for a single trade, a hard-stop
// gradient banding each trade equally for a bundled phase, or a flat
// neutral for synthetic milestones (inspections, punch list) with no
// trade of their own. needs_review always overrides this entirely at the
// call site with var(--gold) — that flag color is reserved and never
// blended with a trade color, so it stays unambiguous at a glance.
export function phaseBackground(phase) {
  const trades = tradesForPhase(phase);
  if (trades.length === 0) return 'var(--trade-neutral)';
  if (trades.length === 1) return tradeColorVar(trades[0]);
  const step = 100 / trades.length;
  const stops = trades.map((t, i) => {
    const color = tradeColorVar(t);
    return `${color} ${(i * step).toFixed(1)}%, ${color} ${((i + 1) * step).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
