// Free, local first pass over a plan set. Nothing here calls the AI.
//
// Plan PDFs exported from CAD carry real text (sheet titles, schedules, notes).
// We read that text per page, label each sheet, drop pages that cannot help a
// quantity takeoff (cover, index, code, legends), and rank the rest so the
// most useful sheets are analyzed first. That ranking matters when a job hits
// its token cap: the pages left unanalyzed are the least valuable ones.
//
// Scanned sheets have no text. They cannot be labelled, so they are kept at a
// middle priority instead of being guessed at.

// Lower number = analyzed sooner.
export const PRIORITY = { schedule: 1, plan: 1, roof: 1, section: 2, mep: 2, structural: 2, image: 2, other: 3, detail: 3, notes: 3, site: 4 };

const RULES = [
  // Pages that never help a takeoff.
  { kind: 'skip', reason: 'cover or sheet index', re: /\b(COVER SHEET|TITLE SHEET|SHEET INDEX|DRAWING INDEX|INDEX OF DRAWINGS|DRAWING LIST|SHEET LIST)\b/ },
  { kind: 'skip', reason: 'code or life safety sheet', re: /\b(LIFE SAFETY PLAN|CODE ANALYSIS|CODE SUMMARY|ACCESSIBILITY STANDARDS|ADA REQUIREMENTS)\b/ },
  { kind: 'skip', reason: 'legend or abbreviations', re: /\b(ABBREVIATIONS|SYMBOL LEGEND|SYMBOLS AND ABBREVIATIONS|GENERAL LEGEND)\b/ },

  { kind: 'schedule', re: /\b(DOOR|WINDOW|ROOM FINISH|FINISH|FIXTURE|PLUMBING FIXTURE|EQUIPMENT|LIGHTING FIXTURE|LUMINAIRE|PANEL|HARDWARE|MATERIAL|WALL TYPE|PARTITION)S?\s+(SCHEDULE|TYPES)\b|\bSCHEDULES\b/ },
  { kind: 'roof', re: /\b(ROOF PLAN|ROOF FRAMING|ROOFING PLAN|ROOF DETAILS?)\b/ },
  { kind: 'plan', re: /\b(FLOOR PLAN|DEMOLITION PLAN|DEMO PLAN|REFLECTED CEILING|CEILING PLAN|ENLARGED PLAN|OVERALL PLAN|PARTITION PLAN|FURNITURE PLAN|FINISH PLAN|LEVEL \d+ PLAN|FIRST FLOOR|SECOND FLOOR|GROUND FLOOR)\b/ },
  // Only title style phrases. The bare words "section" and "detail" appear as cross references on almost every sheet.
  { kind: 'detail', re: /\b(TYPICAL DETAILS|ENLARGED DETAILS|CONSTRUCTION DETAILS|WALL DETAILS|MISC(ELLANEOUS)? DETAILS|DETAILS)\b/ },
  { kind: 'section', re: /\b(BUILDING SECTIONS?|WALL SECTIONS?|EXTERIOR ELEVATIONS?|INTERIOR ELEVATIONS?|BUILDING ELEVATIONS?|SECTIONS AND ELEVATIONS)\b/ },
  { kind: 'mep', re: /\b(MECHANICAL|ELECTRICAL|PLUMBING|POWER PLAN|LIGHTING PLAN|HVAC|PIPING|DUCTWORK|FIRE PROTECTION|SPRINKLER|FIRE ALARM)\b/ },
  { kind: 'structural', re: /\b(FOUNDATION PLAN|STRUCTURAL|FRAMING PLAN|SLAB PLAN|FOOTING)\b/ },
  { kind: 'site', re: /\b(SITE PLAN|CIVIL|GRADING|LANDSCAPE|UTILITY PLAN|EROSION|PAVING|STORM|SITE DETAILS?)\b/ },
  { kind: 'notes', re: /\b(GENERAL NOTES|SPECIFICATIONS?|PROJECT NOTES|CONSTRUCTION NOTES)\b/ },
];

// Reads the title area first. Title blocks and sheet titles are usually short
// strings, so matching the whole page text works, but we upper-case once and
// cap the length so a dense notes sheet does not cost much to scan.
export function classifyPage(rawText, { workType = '', notes = '' } = {}) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 15) {
    return { kind: 'image', priority: PRIORITY.image, skip: false, label: 'No readable text (scanned sheet)', imageOnly: true };
  }
  const upper = text.slice(0, 6000).toUpperCase();
  const label = sheetLabel(text);

  for (const rule of RULES) {
    if (!rule.re.test(upper)) continue;
    if (rule.kind === 'skip') {
      // A schedule or plan page that merely mentions "legend" must not be dropped.
      // Only skip when the page is short, which is what a cover or index looks like.
      if (text.length < 2500) return { kind: 'skip', priority: 9, skip: true, reason: rule.reason, label };
      continue;
    }
    if (rule.kind === 'site' && wantsNoSite(workType, notes, upper)) {
      return { kind: 'site', priority: 9, skip: true, reason: 'site or civil sheet (not part of this work)', label };
    }
    // For roofing work the roof plan is the main sheet. For other work it is still useful but not first.
    let priority = PRIORITY[rule.kind];
    if (rule.kind === 'roof' && !/roof/i.test(`${notes}`)) priority = 2;
    if (rule.kind === 'roof' && /roof/i.test(`${notes}`)) priority = 1;
    return { kind: rule.kind, priority, skip: false, label };
  }
  return { kind: 'other', priority: PRIORITY.other, skip: false, label };
}

// Renovation, repair and replacement jobs rarely need civil and landscape sheets,
// unless the person asked for site work in their notes.
function wantsNoSite(workType, notes, upperText) {
  if (workType === 'new') return false;
  if (/\b(site|parking|paving|asphalt|landscap|drainage|sidewalk|curb|exterior concrete)\b/i.test(notes || '')) return false;
  return true;
}

// Best effort sheet number such as A-101, A1.01, M-201, S101. Title blocks put it
// near the end of the page text, so take the last match.
export function sheetLabel(text) {
  const re = /\b([A-Z]{1,2}[-. ]?\d{1,3}(?:\.\d{1,2})?)\b/g;
  const upper = String(text || '').toUpperCase();
  let last = null; let m;
  while ((m = re.exec(upper)) !== null) {
    if (/^(AND|OF|THE)$/.test(m[1])) continue;
    last = m[1].replace(/\s+/g, '');
  }
  return last;
}

// Groups ranked pages into chunks of at most `maxPages`. Pages are ranked by
// priority, then page order, so each chunk holds similar value sheets and early
// chunks hold the most useful ones.
export function planChunks(pages, maxPages = 8) {
  const ranked = [...pages].sort((a, b) => a.priority - b.priority || a.page - b.page);
  const chunks = [];
  for (let i = 0; i < ranked.length; i += maxPages) {
    const group = ranked.slice(i, i + maxPages);
    chunks.push({ pages: group.map(p => p.page).sort((a, b) => a - b), priority: Math.min(...group.map(p => p.priority)) });
  }
  return chunks;
}

export function summarizeSkips(skipped) {
  const counts = {};
  for (const s of skipped) counts[s.reason] = (counts[s.reason] || 0) + 1;
  return Object.entries(counts).map(([reason, n]) => `${n} ${reason}`).join(', ');
}
