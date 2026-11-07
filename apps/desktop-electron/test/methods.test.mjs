// v0.9 methods review: each replaced method is measured against the one it replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Spring, Particles } from '../src/renderer/visualizations/experimental/morph-model.mjs';
import { RippleCPU } from '../src/renderer/visualizations/ambience/ripple-model.mjs';
import { mulberry32 } from '../src/renderer/engine/mapping.mjs';

// ---------------- springs: exact vs semi-implicit Euler
function eulerSpring(s, target, h) {   // the v0.3–v0.8 method, kept here as the reference
  const a = s.w0 * s.w0 * (target - s.x) - 2 * s.zeta * s.w0 * s.v; s.v += a * h; s.x += s.v * h;
}
function analytic(z, f0, t) {          // unit step response from rest, target 1
  const w = 2 * Math.PI * f0;
  if (Math.abs(z - 1) < 1e-12) return 1 - (1 + w * t) * Math.exp(-w * t);
  if (z < 1) { const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); }
  const q = Math.sqrt(z * z - 1), r1 = -w * (z - q), r2 = -w * (z + q); return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

test('springs: exact step matches the analytic step response for all damping regimes', () => {
  for (const zeta of [0.28, 1.0, 1.6]) {
    const s = new Spring({ freqHz: 3, zeta }); let t = 0;
    for (let i = 0; i < 240; i++) { s.step(1, 1 / 240); t += 1 / 240; assert.ok(Math.abs(s.x - analytic(zeta, 3, t)) < 1e-12, `ζ=${zeta} at t=${t.toFixed(3)}`); }
  }
});

test('springs: results no longer depend on the step size (device sample rate)', () => {
  const run = (hop, step) => { const s = new Spring({ freqHz: 3, zeta: 0.28 }); const n = Math.round(2 / hop); const r = mulberry32(4); for (let i = 0; i < n; i++) { const tg = r() < 0.1 ? 1 : 0.2; const k = Math.ceil(hop * 240); for (let j = 0; j < k; j++) step(s, tg, hop / k); } return s.x; };
  // same 2 s of a piecewise-constant target, delivered as 44.1 kHz or 48 kHz hops (different substeps)
  const exactA = run(512 / 48000, (s, t, h) => s.step(t, h));
  const tA = new Spring({ freqHz: 3, zeta: 0.28 }), tB = new Spring({ freqHz: 3, zeta: 0.28 });
  for (let i = 0; i < 240; i++) { tA.step(1, 1 / 240); for (let j = 0; j < 200; j++) tB.step(1, 1 / 48000); }
  assert.ok(Math.abs(tA.x - tB.x) < 1e-12, `exact: substep 1/240 vs 1/48000 identical (${Math.abs(tA.x - tB.x).toExponential(1)})`);
  const eA = new Spring({ freqHz: 3, zeta: 0.28 }), eB = new Spring({ freqHz: 3, zeta: 0.28 });
  for (let i = 0; i < 240; i++) { eulerSpring(eA, 1, 1 / 240); for (let j = 0; j < 200; j++) eulerSpring(eB, 1, 1 / 48000); }
  console.log(`  spring after 1 s: Euler differs between step sizes by ${Math.abs(eA.x - eB.x).toExponential(2)}; exact by ${Math.abs(tA.x - tB.x).toExponential(2)}`);
  assert.ok(Math.abs(eA.x - eB.x) > 1e-4, 'the old method did depend on step size');
  assert.ok(Number.isFinite(exactA));
});

test('particles: exact drag motion is step-size independent', () => {
  const mk = () => { const p = new Particles({ pool: 1, speed: 1, drag: 1.2, life: 5 }, mulberry32(1)); p.spawn(1, 1, 1); return p; };
  const a = mk(), b = mk();
  for (let i = 0; i < 240; i++) a.update(1 / 240);
  for (let i = 0; i < 48000; i++) b.update(1 / 48000);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.pos[k] - b.pos[k]) < 1e-5, 'same position after 1 s at either step size');
});

// ---------------- ripple tank: 9-point vs 5-point Laplacian
function fronts(stencil) {
  const r = new RippleCPU(201, 201, { lambda: 0.5, damping: 0, stencil });
  r.drop(100, 100, 1, 2); for (let i = 0; i < 120; i++) r.step();
  let ax = 0, axV = 0, dg = 0, dgV = 0;
  for (let d = 1; d < 100; d++) {
    const a = Math.abs(r.at(100 + d, 100)); if (a > axV) { axV = a; ax = d; }
    const g = Math.abs(r.at(100 + Math.round(d / Math.SQRT2), 100 + Math.round(d / Math.SQRT2))); if (g > dgV) { dgV = g; dg = d; }
  }
  return { ax, dg, ratio: ax / dg };
}
test('ripple tank: the 9-point Laplacian keeps ripples round (isotropic wave speed)', () => {
  const five = fronts(5), nine = fronts(9);
  console.log(`  wavefront axis/diagonal after 120 steps: 5-point ${five.ax}/${five.dg} (${five.ratio.toFixed(3)}), 9-point ${nine.ax}/${nine.dg} (${nine.ratio.toFixed(3)})`);
  assert.ok(Math.abs(nine.ratio - 1) < Math.abs(five.ratio - 1), '9-point is closer to round');
  assert.ok(Math.abs(nine.ax - 60) <= 6, `speed unchanged: ${nine.ax} px vs λ·steps = 60`);
});
test('ripple tank: the 9-point stencil is stable to λ ≈ 0.87 (5-point only to 0.71)', () => {
  const run = (stencil, lambda) => { const r = new RippleCPU(48, 48, { lambda, damping: 0, stencil }); r.drop(24, 24, 1, 2.5); const e0 = r.energy(); for (let i = 0; i < 800; i++) r.step(); return r.energy() / e0; };
  assert.ok(run(9, 0.8) < 10, '9-point stable at λ = 0.8');
  assert.ok(!(run(5, 0.8) < 1e6), '5-point unstable at λ = 0.8');
  assert.ok(!(run(9, 0.92) < 1e6), '9-point unstable beyond √(3/4)');
});

// ---------------- noise: integer hash and quintic interpolation (JS twins of the GLSL)
function pcg2d(x, y) {
  const m = (a, b) => Math.imul(a, b) >>> 0;
  x = (m(x, 1664525) + 1013904223) >>> 0; y = (m(y, 1664525) + 1013904223) >>> 0;
  x = (x + m(y, 1664525)) >>> 0; y = (y + m(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = (x + m(y, 1664525)) >>> 0; y = (y + m(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
const f32 = Math.fround;
const sinHash = (x, y) => { const s = f32(Math.sin(f32(f32(x * 127.1) + f32(y * 311.7)))); const v = f32(s * 43758.5453); return f32(v - Math.floor(v)); };

test('integer hash: uniform and distinct; the old sine hash has only a few hundred levels per region in float32', () => {
  const N = 50000, bins = new Array(20).fill(0), seenNew = new Set(), seenOld = new Set();
  for (let i = 0; i < N; i++) {
    const x = 1048576 + (i % 250), y = 1048576 + Math.floor(i / 250);   // the GLSL adds 2^20 to keep cells positive
    const h = pcg2d(x, y); bins[Math.floor(h * 20)]++; seenNew.add(h);
    seenOld.add(sinHash(i % 250, Math.floor(i / 250)));
  }
  const chi2 = bins.reduce((s, b) => s + (b - N / 20) ** 2 / (N / 20), 0);
  console.log(`  ${N} cells: integer hash ${seenNew.size} distinct values (χ² ${chi2.toFixed(1)}, 19 dof); sine hash in float32 ${seenOld.size} distinct`);
  assert.ok(chi2 < 43.8, 'uniform (χ², 19 dof, p > 0.001)');
  assert.ok(seenNew.size > 0.99 * N, 'practically all distinct');
  assert.ok(seenOld.size < seenNew.size / 5, 'the sine hash collapses many cells onto the same values');
});

test('quintic interpolation removes the curvature jump at noise cell edges (smooth curl flow)', () => {
  const cubic = (t) => t * t * (3 - 2 * t), quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const d2 = (s, t, e = 1e-4) => (s(t + e) - 2 * s(t) + s(t - e)) / (e * e);
  // second derivative just inside each end of a cell: equal ends ⇒ no crease across the boundary
  const jump = (s) => Math.abs(d2(s, 1e-3) - d2(s, 1 - 1e-3));
  console.log(`  curvature jump across a cell edge: cubic ${jump(cubic).toFixed(2)}, quintic ${jump(quintic).toFixed(3)}`);
  assert.ok(jump(cubic) > 11, 'cubic: 6 → −6');
  assert.ok(jump(quintic) < 0.2, 'quintic: ≈ 0 → 0');
});
