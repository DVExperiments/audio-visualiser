'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createLog } = require('../src/main/log.js');

test('log file: lines are timestamped; it rotates at the size cap, keeping at most two files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avlog-'));
  const quiet = { log() {}, info() {}, warn() {}, error() {} };
  const log = createLog(dir, { maxBytes: 2000, mirror: quiet });
  log.info('hello'); log.error(new Error('boom'));
  const first = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
  assert.match(first, /^\d{4}-\d\d-\d\dT[\d:.]+Z INFO  hello$/m);
  assert.match(first, /ERROR boom/);
  for (let i = 0; i < 200; i++) log.warn(`line ${i} ${'x'.repeat(40)}`);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['app.1.log', 'app.log'], 'two files only');
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 2000, `${f} within the cap`);
  assert.match(fs.readFileSync(path.join(dir, 'app.log'), 'utf8'), /line 199/, 'newest lines in app.log');
});
