// Fails the build if a hand-typed job/settings deep link shows up outside
// lib/links.js. Links into a job page must go through jobHref(), top-level
// pages through appHref(), and Settings through settingsHref(). That keeps
// every link updatable from one place when tabs or pages move.
//
// Run directly:  node scripts/check-links.mjs
// Runs automatically before `npm run build` (see "prebuild" in package.json).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);
const ALLOWED_FILES = new Set([join('lib', 'links.js')]);

// ?tab=  &section=  and the old hash-style  /jobs/${id}#Something
const RULES = [
  { re: /[?&](tab|section)=/, why: 'raw ?tab=/&section= in a URL' },
  { re: /\/jobs\/\$\{[^}]+\}#/, why: 'hash link into a job page (nothing reads hashes)' },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const problems = [];
for (const dir of SCAN_DIRS) {
  let files = [];
  try { files = walk(join(ROOT, dir)); } catch { continue; }
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (ALLOWED_FILES.has(rel.split(sep).join(sep))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // prose, not code
      for (const rule of RULES) {
        if (rule.re.test(line)) problems.push(`${rel}:${i + 1}  ${rule.why}\n    ${t.slice(0, 140)}`);
      }
    });
  }
}

if (problems.length) {
  console.error(`\nLink check failed: ${problems.length} hand-typed link(s).\n`);
  console.error(problems.join('\n') + '\n');
  console.error('Use jobHref(jobId, "destination"), appHref("page") or settingsHref("tab") from lib/links.js instead.');
  console.error('New job destinations are added to JOB_DESTINATIONS in lib/links.js.\n');
  process.exit(1);
}
console.log('Link check passed: no hand-typed job/settings links.');
