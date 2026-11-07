'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, sanitize, DEFAULTS } = require('../src/main/settings');

test('sanitize drops unknown keys and wrong types', () => {
  const s = sanitize({ version: 1, input: { source: 'evil', deviceId: 7 }, ui: { diagnostics: 'yes', limitFlashes: false }, hacker: true });
  assert.equal(s.input.source, DEFAULTS.input.source);
  assert.equal(s.input.deviceId, null);
  assert.equal(s.ui.diagnostics, false);
  assert.equal(s.ui.limitFlashes, false);
  assert.equal(s.hacker, undefined);
});

test('rejects tiny or non-finite window bounds', () => {
  assert.equal(sanitize({ window: { bounds: { x: 0, y: 0, width: 10, height: 10 } } }).window.bounds, null);
  assert.equal(sanitize({ window: { bounds: { x: NaN, y: 0, width: 800, height: 600 } } }).window.bounds, null);
});

test('round-trips through disk, ignores prototype pollution, survives corrupt files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-'));
  const a = new SettingsStore(dir);
  a.load();
  a.update(JSON.parse('{"preset":"scope","__proto__":{"polluted":true},"ui":{"diagnostics":true}}'));
  a.flush();
  assert.equal({}.polluted, undefined);
  const b = new SettingsStore(dir);
  const d = b.load();
  assert.equal(d.preset, 'scope');
  assert.equal(d.ui.diagnostics, true);
  assert.equal(d.version, 5);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{corrupt');
  assert.deepEqual(new SettingsStore(dir).load(), JSON.parse(JSON.stringify(DEFAULTS)));
});

test('v2: auto mode and library are validated; v1 files migrate to defaults', () => {
  const v1 = sanitize({ version: 1, preset: 'scope' });
  assert.equal(v1.version, 5);
  assert.deepEqual(v1.auto, DEFAULTS.auto);
  assert.deepEqual(v1.library, { favourites: [], collections: [] });
  const s = sanitize({ auto: { enabled: true, mode: 'timer', minutes: 999, pool: 'favourites', transition: 'iris', seconds: -3 },
    library: { favourites: ['alchemy/acid-warp', 'alchemy/acid-warp', '../etc/passwd', 42],
      collections: [{ id: 'user-album-night', name: 'Album\u0007 night', items: ['battery/eclipse', 'bad key'] }, { id: 'evil', name: 'x', items: [] }] } });
  assert.equal(s.auto.minutes, 30, 'minutes clamped');
  assert.equal(s.auto.seconds, 0.3, 'seconds clamped');
  assert.equal(s.auto.transition, 'iris');
  assert.deepEqual(s.library.favourites, ['alchemy/acid-warp'], 'deduplicated, invalid keys dropped');
  assert.equal(s.library.collections.length, 1, 'ids must be user-*');
  assert.equal(s.library.collections[0].name, 'Album night', 'control characters stripped');
  assert.deepEqual(s.library.collections[0].items, ['battery/eclipse']);
});

test('v4: menu mode, edge reveal and start-in-full-screen; autoHide migrates', () => {
  assert.equal(sanitize({ ui: { autoHide: false } }).ui.menu, 'always', 'v2/v3 autoHide off → always show');
  assert.equal(sanitize({ ui: { autoHide: true } }).ui.menu, 'auto');
  const s = sanitize({ ui: { menu: 'hidden', edgeReveal: false, startFullscreen: true } });
  assert.deepEqual([s.ui.menu, s.ui.edgeReveal, s.ui.startFullscreen], ['hidden', false, true]);
  assert.equal(sanitize({ ui: { menu: 'sideways' } }).ui.menu, 'auto', 'unknown mode → default');
});

test('v5: appearance style and mode, validated', () => {
  assert.deepEqual([DEFAULTS.ui.style, DEFAULTS.ui.theme], ['classic', 'dark']);
  const s = sanitize({ ui: { style: 'modern', theme: 'light' } });
  assert.deepEqual([s.ui.style, s.ui.theme], ['modern', 'light']);
  const bad = sanitize({ ui: { style: 'vaporwave', theme: 'sepia' } });
  assert.deepEqual([bad.ui.style, bad.ui.theme], ['classic', 'dark']);
});
