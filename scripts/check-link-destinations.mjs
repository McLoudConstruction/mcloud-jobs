// Fails the build if lib/links.js points somewhere the job page does not
// have, or if a job stage would land on a missing tab/section. This is the
// other half of check-links.mjs: that one forbids hand-typed links, this one
// makes sure the named destinations are real.
//
// It reads the TABS array straight out of app/jobs/[id]/page.js, so there is
// no second copy of the tab list to keep in sync.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const linksSrc = readFileSync(join(ROOT, 'lib', 'links.js'), 'utf8');
const links = await import('data:text/javascript;base64,' + Buffer.from(linksSrc).toString('base64'));

const pageSrc = readFileSync(join(ROOT, 'app', 'jobs', '[id]', 'page.js'), 'utf8');
const start = pageSrc.indexOf('const TABS = [');
if (start === -1) { console.error('check-link-destinations: could not find "const TABS = [" in the job page.'); process.exit(1); }
let depth = 0, end = -1;
for (let i = pageSrc.indexOf('[', start); i < pageSrc.length; i++) {
  if (pageSrc[i] === '[') depth++;
  if (pageSrc[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
}
const block = pageSrc.slice(pageSrc.indexOf('[', start), end + 1);
// Icon components etc. are free identifiers in the array; give them all a harmless value.
const anyIdentifier = new Proxy({}, { has: () => true, get: (_, k) => (k === Symbol.unscopables ? undefined : undefined) });
const TABS = new Function('p', `with(p){ return ${block}; }`)(anyIdentifier);

const problems = [];
function check(label, tabKey, sectionKey) {
  const tab = TABS.find(t => t.key === tabKey);
  if (!tab) { problems.push(`${label} -> tab "${tabKey}" does not exist on the job page`); return; }
  if (sectionKey) {
    if (!tab.sections?.some(s => s.key === sectionKey)) problems.push(`${label} -> section "${sectionKey}" does not exist on tab "${tabKey}"`);
  }
}

for (const [name, d] of Object.entries(links.JOB_DESTINATIONS)) check(`destination "${name}"`, d.tab, d.section);
for (const [stage, d] of Object.entries(links.STAGE_LANDING)) check(`stage "${stage}" landing`, d.tab, d.section);
for (const stage of Object.keys(links.STAGE_LANDING)) {
  const dest = links.billingDestination(stage);
  if (!links.JOB_DESTINATIONS[dest]) problems.push(`billingDestination("${stage}") -> "${dest}" is not a destination`);
}

if (problems.length) {
  console.error(`\nLink destination check failed (${problems.length}):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nFix lib/links.js (JOB_DESTINATIONS / STAGE_LANDING) or the TABS array in app/jobs/[id]/page.js.\n');
  process.exit(1);
}
console.log(`Link destination check passed: ${Object.keys(links.JOB_DESTINATIONS).length} destinations, ${Object.keys(links.STAGE_LANDING).length} stage landings.`);
