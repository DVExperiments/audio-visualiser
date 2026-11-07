// Verifies a packaged app (v0.20.3): starting from index.html, follows every classic script, module,
// import-map entry, three.js add-on (and its own imports), stylesheet and CSS url() — and checks each
// file is inside the packaged app.asar. The build fails if anything is missing.
// (v0.20.2 shipped without three.js's add-ons: electron-builder drops library folders named "examples".)
// Usage: node tools/verify-package.mjs [path/to/app.asar]   (default: the first dist/*/resources/app.asar)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
let archive = process.argv[2];
if (!archive) {
  const dist = path.join(appDir, 'dist');
  const found = fs.existsSync(dist) ? fs.readdirSync(dist).map((d) => path.join(dist, d, 'resources', 'app.asar')).find((f) => fs.existsSync(f)) : null;
  if (!found) { console.error('No dist/*/resources/app.asar found: build the package first.'); process.exit(2); }
  archive = found;
}
const inArchive = new Set(asar.listPackage(archive).map((f) => f.replace(/\\/g, '/').replace(/^\//, '')));
const rel = (abs) => path.relative(appDir, abs).replace(/\\/g, '/');

const html = path.join(appDir, 'src/renderer/index.html'), htmlText = fs.readFileSync(html, 'utf8');
const importMap = JSON.parse(htmlText.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const missing = [], seen = new Set(), queue = [];
const want = (abs, from) => { const r = rel(abs); if (seen.has(r)) return; seen.add(r); if (!inArchive.has(r)) missing.push(`${r}   (needed by ${from})`); else queue.push(abs); };

// entry points: scripts and stylesheets in index.html
for (const m of htmlText.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) want(path.resolve(path.dirname(html), m[1]), 'index.html');
for (const m of htmlText.matchAll(/<link[^>]*\bhref="([^"]+\.css)"/g)) want(path.resolve(path.dirname(html), m[1]), 'index.html');

const resolveSpec = (spec, fromFile) => {
  if (spec.startsWith('.') || spec.startsWith('/')) return path.resolve(path.dirname(fromFile), spec);
  for (const [k, v] of Object.entries(importMap)) {
    if (k.endsWith('/') ? spec.startsWith(k) : spec === k) return path.resolve(path.dirname(html), v + (k.endsWith('/') ? spec.slice(k.length) : ''));
  }
  return null;   // not resolvable in the browser either: report it
};
while (queue.length) {
  const file = queue.shift(), text = fs.readFileSync(file, 'utf8'), from = rel(file);
  if (file.endsWith('.css')) {
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) if (!/^(data:|https?:|#)/.test(m[1])) want(path.resolve(path.dirname(file), m[1].split(/[?#]/)[0]), from);
    continue;
  }
  if (!file.endsWith('.mjs') && !/\/three\//.test(rel(file))) continue;          // classic scripts have no imports
  const specs = [...text.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g), ...text.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g), ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const spec of specs) { const abs = resolveSpec(spec, file); if (abs) want(abs, from); else missing.push(`unresolvable import "${spec}" in ${from}`); }
}

console.log(`Package check: ${seen.size} files reachable from index.html, ${inArchive.size} in ${path.basename(archive)}.`);
if (missing.length) { console.error(`MISSING from the package (${missing.length}):\n  ` + missing.join('\n  ')); process.exit(1); }
console.log('All reachable files are in the package.');
