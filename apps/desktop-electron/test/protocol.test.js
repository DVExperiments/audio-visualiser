'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseServiceLine, validateStartRequest } = require('../src/main/protocol');

function frame(over = {}) {
  return {
    type: 'frame', seq: 1, t: 10, wall: 1e12, sr: 48000, silent: false, clip: false, gap: false, synthetic: true,
    nonFinite: 0, droppedInput: 0, rms: [0.1, 0.1, 0.1], dbfs: [-20, -20, -20], peak: [0.2, 0.2], level: 0.5,
    bands: [-60, -20, -30, -40, -50, -60, -70], bandsNorm: [0, 1, 0.5, 0.2, 0.1, 0, 0], spec: new Array(48).fill(-50),
    flux: 0.1, fluxLog: 0.01, onset: { on: false, strength: 0.01, threshold: 0.02, confidence: 0 },
    centroid: 440, flatness: 0.01, rolloff: 450, zcr: 0.018, balance: 0, correlation: 1, width: 0,
    waveL: new Array(512).fill(0), waveR: new Array(512).fill(0), ...over,
  };
}

test('accepts a well-formed frame', () => {
  assert.ok(parseServiceLine(JSON.stringify(frame())));
});

test('rejects frames with missing, non-finite or mistyped fields', () => {
  assert.equal(parseServiceLine(JSON.stringify(frame({ bands: [1, 2, 3] }))), null);
  assert.equal(parseServiceLine(JSON.stringify(frame({ centroid: 'x' }))), null);
  assert.equal(parseServiceLine(JSON.stringify(frame({ waveR: [0] }))), null);
  assert.equal(parseServiceLine(JSON.stringify(frame({ onset: null }))), null);
  assert.equal(parseServiceLine('{"type":"frame","seq":1e999}'), null);
});

test('rejects garbage, unknown types and oversized lines', () => {
  assert.equal(parseServiceLine('not json'), null);
  assert.equal(parseServiceLine('[1,2]'), null);
  assert.equal(parseServiceLine('{"type":"exec","cmd":"calc"}'), null);
  assert.equal(parseServiceLine('{"type":"hello"}'), null);
  assert.equal(parseServiceLine('x'.repeat(70000)), null);
});

test('validates device lists', () => {
  const ok = { type: 'devices', render: [{ id: 'a', name: 'Speakers', isDefault: true }], capture: [] };
  assert.ok(parseServiceLine(JSON.stringify(ok)));
  assert.equal(parseServiceLine(JSON.stringify({ ...ok, render: [{ id: 5 }] })), null);
});

test('start requests are whitelisted and sanitised', () => {
  assert.deepEqual(validateStartRequest({ source: 'loopback' }), { cmd: 'start', source: 'loopback' });
  assert.deepEqual(validateStartRequest({ source: 'input', deviceId: 'abc' }), { cmd: 'start', source: 'input', deviceId: 'abc' });
  assert.deepEqual(validateStartRequest({ source: 'synthetic', signal: 'sine440', extra: 1 }), { cmd: 'start', source: 'synthetic', signal: 'sine440' });
  assert.equal(validateStartRequest({ source: 'synthetic', signal: 'rm -rf' }), null);
  assert.equal(validateStartRequest({ source: 'file', deviceId: 'C:\\x' }), null);
  assert.equal(validateStartRequest({ source: 'input', deviceId: 'x'.repeat(600) }), null);
  assert.equal(validateStartRequest(null), null);
});
