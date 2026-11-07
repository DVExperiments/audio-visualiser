'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Smoother, ArraySmoother, PeakHold, FlashLimiter, dbTo01, percentile } = require('../src/renderer/lib/dsp-utils');
const { FeatureStore } = require('../src/renderer/lib/feature-store');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('smoother matches the C# formula and is frame-rate independent', () => {
  for (const dt of [1 / 1000, 1 / 60, 1 / 93.75]) {
    const s = new Smoother(0.1, 0.5);
    const steps = Math.round(0.1 / dt);
    for (let i = 0; i < steps; i++) s.update(1, dt);
    near(s.value, 1 - Math.exp(-(steps * dt) / 0.1), 1e-12, `dt=${dt}`);
  }
  const a = new ArraySmoother(2, 0.1, 0.5);
  a.update([1, 1], 0.1);
  near(a.values[0], 1 - Math.exp(-1), 1e-12, 'array smoother');
});

test('peak hold holds, then falls at the configured rate', () => {
  const p = new PeakHold(1, 1.0, 20, -120);
  p.update([-6], 0.01);
  for (let i = 0; i < 99; i++) p.update([-60], 0.01);
  near(p.values[0], -6, 1e-9, 'held during hold time');
  for (let i = 0; i < 50; i++) p.update([-60], 0.01);
  assert.ok(p.values[0] < -6 && p.values[0] > -20, `falling: ${p.values[0]}`);
});

test('flash limiter allows at most 3 flashes per second and caps intensity', () => {
  const f = new FlashLimiter();
  let n = 0;
  for (let t = 0; t < 1; t += 0.01) if (f.request(t, 1) > 0) n++;
  assert.ok(n <= 3, `flashes ${n}`);
  assert.ok(f.request(10, 1) <= f.maxIntensity + 1e-12);
  f.limited = false;
  assert.equal(f.request(10.001, 1), 1);
});

test('dbTo01 and percentile', () => {
  assert.equal(dbTo01(-90, -90, 0), 0); assert.equal(dbTo01(0, -90, 0), 1); assert.equal(dbTo01(-45, -90, 0), 0.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});

test('feature store keeps every onset and a continuous waveform', () => {
  const st = new FeatureStore();
  st.setAnalysis({ sr: 48000, hop: 512, logEdges: new Array(49).fill(0).map((_, i) => 20 * 1000 ** (i / 48)), bands: [] });
  for (let s = 0; s < 4; s++) {
    st.push({
      seq: s, sr: 48000, wall: 0, spec: new Array(48).fill(-40), bands: new Array(7).fill(-40), bandsNorm: new Array(7).fill(0.5),
      dbfs: [-20, -20, -20], peak: [0.1, 0.1], level: 0.5, onset: { on: s % 2 === 0, confidence: 0.5 },
      waveL: Array.from({ length: 512 }, (_, i) => s * 512 + i), waveR: new Array(512).fill(0),
    }, s);
  }
  const tick = st.consume(100);
  assert.equal(tick.onsets, 2, 'both onsets in one batch counted');
  const L = new Float32Array(2048), R = new Float32Array(2048);
  st.recentWave(2048, L, R);
  for (let i = 0; i < 2048; i++) assert.equal(L[i], i, 'waveform continuity');
  assert.equal(st.seqGaps, 0);
});
