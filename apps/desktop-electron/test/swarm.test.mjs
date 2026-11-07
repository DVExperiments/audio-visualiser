import test from 'node:test';
import assert from 'node:assert/strict';
import { SWARM, MAGNETS, magnetState, stepParticle, initialState, breathStep } from '../src/renderer/visualizations/experimental/swarm-model.mjs';
import { mulberry32 } from '../src/renderer/engine/mapping.mjs';

const H = SWARM.step;
function simulate({ n = 2048, seconds = 20, drives = () => ({}), turb = () => 0, seed = 1 }) {
  const { pos, vel } = initialState(n, mulberry32(seed));
  const mags = new Float32Array(40), p = [0, 0, 0], v = [0, 0, 0];
  let t = 0, maxR = 0, nan = false;
  for (let s = 0; s < Math.round(seconds / H); s++, t += H) {
    magnetState(t, drives(t), mags);
    const tb = turb(t);
    for (let i = 0; i < n; i++) {
      p[0] = pos[4 * i]; p[1] = pos[4 * i + 1]; p[2] = pos[4 * i + 2]; v[0] = vel[4 * i]; v[1] = vel[4 * i + 1]; v[2] = vel[4 * i + 2];
      stepParticle(p, v, mags, H, { turb: tb, time: t });
      pos[4 * i] = p[0]; pos[4 * i + 1] = p[1]; pos[4 * i + 2] = p[2]; vel[4 * i] = v[0]; vel[4 * i + 1] = v[1]; vel[4 * i + 2] = v[2];
      const r = Math.hypot(p[0], p[1], p[2]); if (!Number.isFinite(r)) nan = true; if (r > maxR) maxR = r;
    }
  }
  return { pos, mags, maxR, nan, n };
}

test('swarm stays bounded and finite under random and extreme audio (Sound → shape 200 %)', () => {
  const r = mulberry32(7);
  const extreme = simulate({ seconds: 20, drives: () => ({ bass: 2 * r(), lowmid: 2 * r(), mid: 2 * r(), upper: 2 * r(), high: 2 * r() }), turb: () => 2 * r() });
  console.log(`  20 s of random drives up to 2 and shimmer: max radius ${extreme.maxR.toFixed(2)} (drawn ×1.3 at most on a beat)`);
  assert.equal(extreme.nan, false, 'no NaN or Infinity');
  assert.ok(extreme.maxR * (1 + SWARM.breathGain) < 7.5, 'stays in view even at full breath (camera at distance 6.5)');
});

test('an active band pulls the swarm towards its magnet', () => {
  const meanDist = (res, k) => { let d = 0; for (let i = 0; i < res.n; i++) d += Math.hypot(res.pos[4 * i] - res.mags[8 * k], res.pos[4 * i + 1] - res.mags[8 * k + 1], res.pos[4 * i + 2] - res.mags[8 * k + 2]); return d / res.n; };
  const quiet = simulate({ seconds: 6 }), bassy = simulate({ seconds: 6, drives: () => ({ bass: 1 }) }), highs = simulate({ seconds: 6, drives: () => ({ high: 1 }) });
  console.log(`  mean distance to the bass magnet: quiet ${meanDist(quiet, 0).toFixed(3)}, bass playing ${meanDist(bassy, 0).toFixed(3)}; to the treble magnet: quiet ${meanDist(quiet, 4).toFixed(3)}, treble playing ${meanDist(highs, 4).toFixed(3)}`);
  assert.ok(meanDist(bassy, 0) < 0.9 * meanDist(quiet, 0), 'bass gathers particles round the bass magnet');
  assert.ok(meanDist(highs, 4) < 0.9 * meanDist(quiet, 4), 'treble gathers them round the treble magnet');
});

test('a steady beat does not inflate the swarm (the reason beats are a breath, not an impulse)', () => {
  const radius = (res) => { let s = 0; for (let i = 0; i < res.n; i++) s += Math.hypot(res.pos[4 * i], res.pos[4 * i + 1], res.pos[4 * i + 2]); return s / res.n; };
  // 124 BPM: the bass pulse jumps on every beat and decays over 0.25 s; mids and highs moderate
  const music = (t) => { const ph = t % 0.4839; return { bass: Math.exp(-ph / 0.25), lowmid: 0.3, mid: 0.4, upper: 0.3, high: 0.25 }; };
  const quiet = () => ({ bass: 0.05, mid: 0.05 });
  const withBeat = [4, 6, 8].map((T) => radius(simulate({ n: 1024, seconds: T, drives: music })));
  const without = [4, 6, 8].map((T) => radius(simulate({ n: 1024, seconds: T, drives: quiet })));
  console.log(`  mean radius at 4/6/8 s: beat ${withBeat.map((x) => x.toFixed(2)).join(' ')}, quiet ${without.map((x) => x.toFixed(2)).join(' ')}`);
  for (let i = 0; i < 3; i++) assert.ok(withBeat[i] < 1.25 * without[i], 'no inflation under a steady beat');
});

test('breath: jumps to the onset strength, decays with τ = 0.25 s, never accumulates, frame-rate independent', () => {
  const run = (hz, seconds, beatEvery) => { let b = 0, max = 0; const out = []; for (let i = 0; i < Math.round(seconds * hz); i++) { const t = i / hz; const on = beatEvery && (t % beatEvery) < 1 / hz ? 0.9 : 0; b = breathStep(b, on, 1 / hz); max = Math.max(max, b); out.push([t, b]); } return { at: (T) => out.find(([t]) => t >= T - 1e-9)[1], max }; };
  let b = breathStep(0, 0.8, 1 / 60); assert.equal(b, 0.8, 'jumps to the strength');
  for (let i = 0; i < 15; i++) b = breathStep(b, 0, 1 / 60);
  assert.ok(Math.abs(b - 0.8 * Math.exp(-1)) < 1e-9, 'e⁻¹ after 0.25 s');
  const a = run(60, 0.5, 10), c = run(144, 0.5, 10);
  assert.ok(Math.abs(a.at(0.3) - c.at(0.3)) < 0.03, 'same at 60 and 144 Hz');
  assert.ok(run(60, 10, 0.4839).max <= 0.9 + 1e-9, 'a steady beat never builds it up');
});

test('shimmer field is divergence-free (stirs without bunching)', () => {
  const f = SWARM.turbFreq, F = (x, y, z, t) => [Math.sin(f * y + t), Math.sin(f * z + t), Math.sin(f * x + t)];
  const r = mulberry32(3), e = 1e-5;
  for (let i = 0; i < 100; i++) {
    const [x, y, z, t] = [r() * 4 - 2, r() * 4 - 2, r() * 4 - 2, r() * 10];
    const div = (F(x + e, y, z, t)[0] - F(x - e, y, z, t)[0] + F(x, y + e, z, t)[1] - F(x, y - e, z, t)[1] + F(x, y, z + e, t)[2] - F(x, y, z - e, t)[2]) / (2 * e);
    assert.ok(Math.abs(div) < 1e-6, `∇·F = 0 (${div.toExponential(1)})`);
  }
});

test('magnets: strength follows the drive, positions stay on their paths', () => {
  const m = magnetState(12.3, { bass: 1, high: 0.5 });
  assert.ok(Math.abs(m[3] - (MAGNETS[0].base + MAGNETS[0].gain)) < 1e-6, 'bass magnet at full drive');
  assert.ok(Math.abs(m[8 * 4 + 3] - (MAGNETS[4].base + 0.5 * MAGNETS[4].gain)) < 1e-6, 'treble magnet at half drive');
  // x and z swing ±R, y ±0.7R: |M| ≤ √(1 + 0.49 + 1)·R
  for (let k = 0; k < 5; k++) assert.ok(Math.hypot(m[8 * k], m[8 * k + 1], m[8 * k + 2]) <= MAGNETS[k].radius * Math.sqrt(2.49) + 1e-6, `magnet ${k} within its path`);
});

test('Experimental is available after Morph and Swarm merge into a pre-registered placeholder (as the app loads them)', async () => {
  // Bars & Waves registers an unavailable placeholder for Experimental before the modules run
  globalThis.self = globalThis;
  globalThis.Visualizations = { collections: [{ id: 'experimental', name: 'Experimental (failed to load)', available: false, presets: [] }] };
  await import('../src/renderer/visualizations/experimental/morph.mjs');
  await import('../src/renderer/visualizations/experimental/swarm.mjs');
  const e = globalThis.Visualizations.collections.find((c) => c.id === 'experimental');
  assert.equal(e.available, true, 'available (the merge first kept the placeholder\'s false: caught in the real app)');
  assert.equal(e.name, 'Experimental', 'and named properly, not "failed to load"');
  assert.deepEqual(e.presets.map((p) => p.id), ['morph', 'swarm'], 'Morph first, then Particle Swarm');
});
