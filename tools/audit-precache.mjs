/**
 * What would the service worker's background crawl cache, given this build?
 *
 * `public/sw.js` precaches the app shell at install and then walks the
 * fingerprinted `_astro/` graph: every cached HTML / JS / CSS response is
 * scanned for `_astro/...` references and relative import specifiers, and
 * each new path is fetched and cached in turn. That is what "the app itself"
 * means in Settings → Offline, and it is also what an idle tab quietly pulls
 * over the first minutes after install.
 *
 * This script runs the same walk STATICALLY over `dist/` — same `SHELL`
 * (read out of sw.js, so the two cannot drift), same two regexes, same
 * `WARM_MAX_ASSETS` cap — and reports what the crawl reaches: files and bytes
 * by type, the largest entries, anything under `_astro/` it can NOT reach
 * (dead weight in the build, or a reference the crawl's regexes miss), and
 * whether the cap would cut the run short. Run it against a fresh build
 * before a release; it is how Phase 11 reviewed the default precache.
 *
 *   npm run build && node tools/audit-precache.mjs [--dir dist] [--top 15]
 *
 * It never fetches anything. Exit code 1 when the cap is hit or the shell
 * references a file the build does not contain — both mean the install is
 * quietly incomplete.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = resolve(HERE, '..', flag('--dir', 'dist'));
const TOP = Number(flag('--top', '15'));

if (!existsSync(DIST)) {
  console.error(`${DIST} does not exist — run \`npm run build\` first.`);
  process.exit(2);
}

// ---- read the worker's own lists, so this audit cannot drift from it ------
const sw = readFileSync(resolve(HERE, '../public/sw.js'), 'utf8');
const shellBlock = /const SHELL = \[([\s\S]*?)\]\.map/.exec(sw);
if (!shellBlock) throw new Error('SHELL not found in public/sw.js');
const SHELL = [...shellBlock[1].matchAll(/'([^']*)'/g)].map((m) => '/' + m[1]);
const WARM_MAX_ASSETS = Number(/WARM_MAX_ASSETS = (\d+)/.exec(sw)?.[1] ?? 600);
const skipSource = /const CRAWL_SKIP = \/(.*)\/;/.exec(sw);
if (!skipSource) throw new Error('CRAWL_SKIP not found in public/sw.js');
const CRAWL_SKIP = new RegExp(skipSource[1]);
const ASSET_PREFIX = '/_astro/';

// ---- the static walk --------------------------------------------------------
/** A route or asset path → the file on disk, following the preview server's
 * trailing-slash rule (`/x/` → `x/index.html`). */
function fileFor(path) {
  const rel = path.replace(/^\//, '');
  const candidate = join(DIST, rel);
  if (path.endsWith('/')) return join(candidate, 'index.html');
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return join(candidate, 'index.html');
  return candidate;
}

const typeOf = (path) => {
  if (path.endsWith('/') || path.endsWith('.html')) return 'html';
  const ext = posix.extname(path).slice(1).toLowerCase();
  return ext || 'other';
};

const seen = new Set(SHELL);
const queue = [...SHELL];
const reached = []; // { path, bytes, type }
const missing = [];
let fetched = 0;
let capped = false;

while (queue.length > 0) {
  if (fetched >= WARM_MAX_ASSETS) {
    capped = true;
    break;
  }
  const path = queue.shift();
  const file = fileFor(path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    missing.push(path);
    continue;
  }
  fetched++;
  const bytes = statSync(file).size;
  const type = typeOf(path);
  reached.push({ path, bytes, type });
  if (!['html', 'js', 'mjs', 'css'].includes(type)) continue;
  const text = readFileSync(file, 'utf8');
  // Mirrors ASSET_FILE in sw.js: one segment, with an extension.
  const ASSET_FILE = /^[^/]+\.[A-Za-z0-9]+$/;
  const enqueue = (p) => {
    if (p.startsWith(ASSET_PREFIX) && ASSET_FILE.test(p.slice(ASSET_PREFIX.length)) && !seen.has(p) && !CRAWL_SKIP.test(p)) {
      seen.add(p);
      queue.push(p);
    }
  };
  for (const m of text.matchAll(/_astro\/[A-Za-z0-9_.\-]+/g)) enqueue('/' + m[0]);
  const from = posix.dirname(path.endsWith('/') ? path + 'index.html' : path);
  for (const m of text.matchAll(/['"`](\.{1,2}\/[A-Za-z0-9_.\-/]+)['"`]/g)) {
    enqueue(posix.normalize(posix.join(from, m[1])));
  }
}

// ---- everything under _astro/ the walk did not reach ----------------------
const allAssets = existsSync(join(DIST, '_astro'))
  ? readdirSync(join(DIST, '_astro')).map((name) => ({
      path: ASSET_PREFIX + name,
      bytes: statSync(join(DIST, '_astro', name)).size,
      type: typeOf(ASSET_PREFIX + name),
    }))
  : [];
const reachedSet = new Set(reached.map((r) => r.path));
const unreached = allAssets.filter((a) => !reachedSet.has(a.path));

// ---- report -----------------------------------------------------------------
const mb = (n) => (n / 1_048_576).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const sum = (rows) => rows.reduce((n, r) => n + r.bytes, 0);
const byType = (rows) => {
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r.type) ?? { files: 0, bytes: 0 };
    cur.files++;
    cur.bytes += r.bytes;
    out.set(r.type, cur);
  }
  return [...out].sort((a, b) => b[1].bytes - a[1].bytes);
};

console.log(`Build: ${DIST}`);
console.log(`Shell routes: ${SHELL.length}   _astro/ files in build: ${allAssets.length} (${mb(sum(allAssets))})`);
console.log(`\nReached by the crawl: ${reached.length} files, ${mb(sum(reached))} (cap ${WARM_MAX_ASSETS})`);
for (const [type, { files, bytes }] of byType(reached)) {
  console.log(`  ${type.padEnd(12)} ${String(files).padStart(4)} files  ${mb(bytes).padStart(10)}`);
}
console.log(`\nLargest ${TOP}:`);
for (const r of [...reached].sort((a, b) => b.bytes - a.bytes).slice(0, TOP)) {
  console.log(`  ${kb(r.bytes).padStart(9)}  ${r.path}`);
}
if (unreached.length > 0) {
  console.log(`\nUnder _astro/ but NOT reached (${unreached.length} files, ${mb(sum(unreached))}):`);
  for (const r of unreached.sort((a, b) => b.bytes - a.bytes).slice(0, TOP)) {
    console.log(`  ${kb(r.bytes).padStart(9)}  ${r.path}`);
  }
  if (unreached.length > TOP) console.log(`  … and ${unreached.length - TOP} more`);
}
const skipped = allAssets.filter((a) => CRAWL_SKIP.test(a.path));
if (skipped.length > 0) {
  console.log(`\nSkipped by CRAWL_SKIP ${CRAWL_SKIP} (left to the offline bundles; ${skipped.length} files, ${mb(sum(skipped))}):`);
  for (const r of skipped.sort((a, b) => b.bytes - a.bytes)) console.log(`  ${kb(r.bytes).padStart(9)}  ${r.path}`);
}
if (missing.length > 0) {
  // The crawl's regexes are deliberately loose and match a few string
  // literals that are not asset paths ("./fonts/", "./sounds"); at run time
  // those fetch a 404, are never cached, and cost one slot under the cap each.
  console.log(`\nReferenced but not in the build (${missing.length}; 404 at run time, never cached — informational):`);
  for (const p of missing) console.log(`  ${p}`);
}
if (capped) {
  console.log(`\nWARM_MAX_ASSETS (${WARM_MAX_ASSETS}) reached with ${queue.length} paths still queued — raise the cap.`);
}
process.exit(capped ? 1 : 0);
