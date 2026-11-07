'use strict';
// The import map is an inline script; CSP allows it only by exact hash. Catch any drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('CSP hash matches the inline import map, and no other inline scripts exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'exactly one inline script (the import map)');
  const hash = crypto.createHash('sha256').update(inline[0]).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), `CSP must contain 'sha256-${hash}'`);
  const map = JSON.parse(inline[0]);
  for (const target of Object.values(map.imports)) {
    const p = path.join(__dirname, '..', 'src', 'renderer', target);
    assert.ok(fs.existsSync(p), `import map target exists: ${target}`);
  }
});
