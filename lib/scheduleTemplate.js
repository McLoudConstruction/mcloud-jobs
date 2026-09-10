// The fixed sequencing skeleton for AI-generated project schedules.
//
// This is deliberately NOT something the AI decides — construction phase
// order (demo before rough-in, rough-in before drywall, etc.) is a real
// physical/inspection constraint, not a judgment call. The AI's job is
// narrower: given a job's actual trade breakdown, estimate how long each
// applicable stage takes and split ambiguous trades (electrical/plumbing
// show up twice — once at rough-in, once at finish) across the right
// stage based on what each action actually describes.
//
// v1 covers the common residential remodel flow McLoud does most often
// (kitchen/bath gut-and-rebuild). Commercial buildouts or unusual scopes
// may need stages added here over time — treat this as a living file,
// refined against real jobs, not a one-time deliverable.

// Each stage:
//   key         - stable identifier, referenced by job_phases.phase_key
//   label       - shown to the user
//   trades      - SERVICES_OFFERED values whose actions can land in this
//                 stage. Two stages can share a trade (electrical/plumbing
//                 show up at both rough_in and finish_trades; tile shows up
//                 at both interior_finishes and finish_trades, since
//                 backsplash tile has to follow countertops but floor/
//                 shower tile doesn't) — the AI disambiguates using each
//                 action's description, not just its trade tag.
//   dependsOn   - stage keys that must be scheduled first
//   parallelWith- stage keys this one commonly overlaps with (informational
//                 for the AI's duration reasoning, not a hard constraint)
//   synthetic   - true for milestone stages with no trade of their own
//                 (inspections, punch list) — always included once any of
//                 their dependency stages are present
//   preferMondayStart - default for whether this stage type should snap
//                 to the next Monday rather than starting mid-week (e.g.
//                 punch list walks). Just the starting default — a
//                 person can flip this per-job on any individual phase,
//                 including ones without this default set.
export const PHASE_STAGES = [
  { key: 'demo', label: 'Demolition & site prep', trades: ['Demo/Site Prep'], dependsOn: [] },
  { key: 'structural', label: 'Framing & structural', trades: ['Framing', 'Concrete/Foundation', 'Masonry'], dependsOn: ['demo'] },
  { key: 'exterior', label: 'Exterior work', trades: ['Roofing', 'Siding', 'Windows & Doors'], dependsOn: ['structural'], parallelWith: ['rough_in'] },
  { key: 'rough_in', label: 'Rough-in (electrical, plumbing, HVAC)', trades: ['Electrical', 'Plumbing', 'HVAC'], dependsOn: ['structural'] },
  { key: 'rough_in_inspection', label: 'Rough-in inspection', trades: [], dependsOn: ['rough_in'], synthetic: true },
  { key: 'insulation', label: 'Insulation', trades: ['Insulation'], dependsOn: ['rough_in_inspection'] },
  { key: 'drywall', label: 'Drywall', trades: ['Drywall'], dependsOn: ['insulation'] },
  { key: 'painting', label: 'Painting', trades: ['Painting'], dependsOn: ['drywall'], parallelWith: ['interior_finishes'] },
  { key: 'interior_finishes', label: 'Flooring, tile & cabinetry', trades: ['Flooring', 'Tile', 'Cabinetry'], dependsOn: ['drywall'] },
  { key: 'countertops', label: 'Countertops', trades: ['Countertops'], dependsOn: ['interior_finishes'] },
  { key: 'finish_trades', label: 'Finish electrical, plumbing & tile', trades: ['Electrical', 'Plumbing', 'Tile'], dependsOn: ['countertops'] },
  { key: 'landscaping', label: 'Landscaping', trades: ['Landscaping'], dependsOn: ['exterior'] },
  { key: 'punch_list', label: 'Punch list & walkthrough', trades: ['General Labor', 'Other'], dependsOn: ['finish_trades', 'painting'], synthetic: true, preferMondayStart: true },
];

// Given the distinct trade values present in a job's trade breakdown
// (job_scope_actions), returns the ordered subset of PHASE_STAGES that
// actually apply — topologically sorted so every stage appears after
// everything in its dependsOn. Synthetic stages are pulled in whenever
// any of their dependency stages made the cut, since inspections and
// punch lists apply to virtually every job regardless of trade mix.
export function buildPhaseSkeleton(tradesPresent) {
  const present = new Set(tradesPresent);
  const included = new Set();

  // First pass: stages with a real trade match.
  for (const stage of PHASE_STAGES) {
    if (!stage.synthetic && stage.trades.some(t => present.has(t))) {
      included.add(stage.key);
    }
  }

  // Second pass: pull in synthetic stages whose dependencies are present.
  // Repeated until stable, since punch_list depends on finish_trades which
  // itself only got included in the first pass.
  let changed = true;
  while (changed) {
    changed = false;
    for (const stage of PHASE_STAGES) {
      if (included.has(stage.key)) continue;
      if (stage.synthetic && stage.dependsOn.some(dep => included.has(dep))) {
        included.add(stage.key);
        changed = true;
      }
    }
  }

  const stageByKey = new Map(PHASE_STAGES.map(s => [s.key, s]));

  // A stage's listed dependency might not be in this job at all (e.g. a
  // bathroom refresh with Painting but no Drywall trade tagged). In that
  // case, don't just drop the constraint — fall back to whatever THAT
  // dependency itself depends on, walking up until we hit a stage that's
  // actually present (or run out of chain). Otherwise the dependent stage
  // silently becomes "unblocked" and lands wherever it happens to sit in
  // this file, which is a coincidence, not a real ordering.
  const resolvedCache = new Map();
  function resolveDeps(stage) {
    if (resolvedCache.has(stage.key)) return resolvedCache.get(stage.key);
    const result = new Set();
    for (const depKey of stage.dependsOn) {
      if (included.has(depKey)) {
        result.add(depKey);
      } else {
        const depStage = stageByKey.get(depKey);
        if (depStage) resolveDeps(depStage).forEach(k => result.add(k));
      }
    }
    resolvedCache.set(stage.key, result);
    return result;
  }

  // Topological sort using the resolved (fallback-aware) dependencies.
  const ordered = [];
  const visited = new Set();
  function visit(key) {
    if (visited.has(key) || !included.has(key)) return;
    visited.add(key);
    const stage = stageByKey.get(key);
    for (const dep of resolveDeps(stage)) visit(dep);
    ordered.push({ ...stage, effectiveDependsOn: [...resolveDeps(stage)] });
  }
  for (const stage of PHASE_STAGES) visit(stage.key);

  return ordered;
}
