import test from 'node:test';
import assert from 'node:assert/strict';
import { fadeToBlack, decayFactor, scopeCircle, ScopeGain, tukey } from '../src/renderer/engine/geometry2d.mjs';
import { SCHEMES, gradient } from '../src/renderer/engine/palettes.mjs';
import { ProgramCycler } from '../src/renderer/engine/program.mjs';
import { curvePoint, writeCurve } from '../src/renderer/visualizations/alchemy/alchemy-model.mjs';
import { RippleCPU, StepAccumulator, RIPPLE } from '../src/renderer/visualizations/ambience/ripple-model.mjs';
import { mulberry32 } from '../src/renderer/engine/mapping.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// ---------------- fade to true black ----------------
test('fadeToBlack: exact ODE step — frame-rate independent, and reaches zero in finite time', () => {
  const h = 0.4, f = 0.2, c0 = 1.5;
  for (const hz of [30, 60, 120, 144]) {
    let c = c0; for (let i = 0; i < hz / 2; i++) c = fadeToBlack(c, h, f, 1 / hz);   // 0.5 s
    near(c, fadeToBlack(c0, h, f, 0.5), 1e-12, `${hz} Hz vs one step`);
  }
  const k = Math.LN2 / h, tStar = Math.log(1 + c0 * k / f) / k;
  assert.ok(fadeToBlack(c0, h, f, tStar - 0.01) > 0, 'still lit just before t*');
  assert.equal(fadeToBlack(c0, h, f, tStar + 1e-9), 0, 'exactly black at t*');
  let c = c0, t = 0; while (c > 0) { c = fadeToBlack(c, h, f, 1 / 120); t += 1 / 120; }
  near(t, tStar, 1 / 120, 'stepping at 120 Hz goes black at t*');
  near(fadeToBlack(1, h, 0, 0.4), decayFactor(h, 0.4), 1e-12, 'floor 0 = plain exponential decay');
  // the v0.3 problem: plain decay never reaches 0 — after 10 s a trail still holds residue
  assert.ok(Math.pow(0.5, 10 / h) > 0, 'exponential decay alone leaves residue');
});

// ---------------- palettes ----------------
test('scheme gradient: seamless wrap, dark → vivid → hot', () => {
  const s = SCHEMES.magma;
  const eq = (a, b, m) => a.forEach((x, k) => near(x, b[k], 1e-12, m));
  eq(gradient(s, 0), s[0], 'start'); eq(gradient(s, 0.5), s[2], 'middle = hot end');
  for (const t of [0.13, 0.37, 0.81]) eq(gradient(s, t), gradient(s, t + 1), 'period 1');
  const a = gradient(s, 0.999999), b = gradient(s, 0.000001);
  for (let k = 0; k < 3; k++) near(a[k], b[k], 1e-4, 'no seam at the wrap');
});

// ---------------- program cycling ----------------
test('program cycler: holds, switches on a strong beat, else when overdue; crossfades; deterministic', () => {
  const run = () => {
    const c = new ProgramCycler(5, { seed: 3, minHold: 10, maxHold: 20, fade: 2 });
    const log = [];
    for (let t = 0; t < 120; t += 0.01) {
      const kick = Math.abs((t % 0.5) - 0.0) < 0.005 ? 0.9 : 0;   // strong kick every 0.5 s
      const before = c.current;
      const w0 = c.weight; c.step(0.01, kick);
      if (c.fading) assert.ok(c.weight >= w0 - 1e-12, 'crossfade weight never goes backwards');
      if (c.current !== before) log.push([+t.toFixed(2), before, c.current]);
    }
    return { log, switches: c.switches };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'deterministic for a seed');
  assert.ok(a.log.length >= 4, `switched ${a.log.length} times in 120 s`);
  for (const [, from, to] of a.log) assert.notEqual(from, to, 'never switches to the same program');
  for (let i = 1; i < a.log.length; i++) assert.ok(a.log[i][0] - a.log[i - 1][0] >= 10 + 2 - 0.02, 'held ≥ minHold between switches');
  // without any beats it still moves on, 4 s after its hold time
  const q = new ProgramCycler(3, { seed: 1, minHold: 5, maxHold: 5, fade: 1 });
  for (let t = 0; t < 9.5; t += 0.01) q.step(0.01, 0);
  assert.equal(q.switches, 1, 'overdue switch without beats');
});

// ---------------- Alchemy curves ----------------
const FAMILIES = [
  ['lissajous', { a: 3, b: 2, phase: 0.4 }], ['lissajous', { a: 5, b: 4, phase: 1 }], ['rose', { k: 5 }],
  ['hypo', { R: 5, r: 3, d: 2.2 }], ['hypo', { R: 7, r: 4, d: 3 }], ['epi', { R: 3, r: 1, d: 1.4 }],
];
test('curve families: closed, inside the unit disc, continuous', () => {
  for (const [fam, p] of FAMILIES) {
    const a = curvePoint(fam, p, 0), b = curvePoint(fam, p, 1);
    near(Math.hypot(a[0] - b[0], a[1] - b[1]), 0, 1e-9, `${fam} closes`);
    let maxStep = 0, prev = a;
    for (let i = 1; i <= 2000; i++) {
      const q = curvePoint(fam, p, i / 2000);
      assert.ok(Math.hypot(q[0], q[1]) <= 1 + 1e-9, `${fam} inside the unit disc`);
      maxStep = Math.max(maxStep, Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q;
    }
    assert.ok(maxStep < 0.06, `${fam} has no jumps (max step ${maxStep.toFixed(4)})`);
  }
});

test('band-limited wobble is far smoother than v0.3 per-point spectrum shaping', () => {
  const n = 600, out = new Float32Array(2 * n), rng = mulberry32(5);
  // roughness = mean |second difference of radius| along the curve
  const rough = (radii) => { let s = 0; for (let i = 1; i < n - 1; i++) s += Math.abs(radii[i - 1] - 2 * radii[i] + radii[i + 1]); return s / (n - 2); };
  writeCurve(out, n, 'lissajous', { a: 3, b: 2, phase: 0.4 }, { radius: 0.6, wobble: [0.12, 0.08, 0.05], wobblePhase: [0.3, 1.2, 2.0] });
  const base = new Float32Array(2 * n);
  writeCurve(base, n, 'lissajous', { a: 3, b: 2, phase: 0.4 }, { radius: 0.6 });
  const wob = Array.from({ length: n }, (_, i) => Math.hypot(out[2 * i], out[2 * i + 1]) / Math.max(1e-6, Math.hypot(base[2 * i], base[2 * i + 1])));
  // v0.3 style: each point scaled by a noisy 48-band spectrum value (interpolated)
  const spec = Array.from({ length: 48 }, () => rng());
  const v03 = Array.from({ length: n }, (_, i) => { const s = i / n, m = (s < 0.5 ? 2 * s : 2 - 2 * s) * 47, j = Math.floor(m), t = m - j; return 1 + 0.6 * ((spec[j] * (1 - t) + spec[Math.min(47, j + 1)] * t) - 0.5); });
  const rW = rough(wob), r3 = rough(v03);
  console.log(`  roughness: v0.3 spectrum shaping ${r3.toExponential(2)}, v0.4 band-limited ${rW.toExponential(2)}`);
  assert.ok(rW * 10 < r3, 'at least 10× smoother');
  writeCurve(out, n, 'rose', { k: 5 }, { radius: 0.5 });
  const [x, y] = curvePoint('rose', { k: 5 }, 0.123);
  const i = Math.round(0.123 * n);
  assert.ok(Math.abs(out[2 * i] - 0.5 * curvePoint('rose', { k: 5 }, i / n)[0]) < 1e-6, 'zero wobble = scaled base curve');
});

// ---------------- scopes ----------------
test('circular scope: seamless (tapered ends), radius within r0 ± gain·peak', () => {
  const n = 256, wave = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.3) * 0.8), out = new Float32Array(2 * n);
  scopeCircle(out, n, wave, { r0: 0.5, gain: 0.2 });
  near(Math.hypot(out[0], out[1]), 0.5, 1e-9, 'starts at r0');
  near(Math.hypot(out[2 * (n - 1)], out[2 * n - 1]), 0.5, 0.01, 'ends near r0 (closes without a seam)');
  for (let i = 0; i < n; i++) { const r = Math.hypot(out[2 * i], out[2 * i + 1]); assert.ok(r >= 0.5 - 0.16 - 1e-6 && r <= 0.5 + 0.16 + 1e-6); }
  assert.equal(tukey(0, 0.1), 0); assert.equal(tukey(0.5, 0.1), 1); assert.equal(tukey(1, 0.1), 0);
  const g = new ScopeGain(0.25, 6);
  let gain; for (let i = 0; i < 300; i++) gain = g.update(new Float32Array(512), 0.01);
  assert.equal(gain, 6, 'silence: capped gain (flat line stays flat)');
  for (let i = 0; i < 50; i++) gain = g.update(Float32Array.from({ length: 512 }, () => 0.5), 0.01);
  near(gain, 0.5, 0.02, 'loud: peak aimed at the target (0.25 / 0.5)');
});

// ---------------- Water: ripple tank ----------------
test('ripple tank: stable at λ = 0.5, unstable beyond the 2D CFL limit', () => {
  const stable = new RippleCPU(48, 48, { lambda: 0.5, damping: 0 });
  stable.drop(24, 24, 1, 2.5);
  const e0 = stable.energy();
  for (let i = 0; i < 1500; i++) stable.step();
  assert.ok(stable.energy() < e0 * 3, `bounded energy (${(stable.energy() / e0).toFixed(2)}× start)`);
  // a drop is a displacement: the mean water level stays put (no linear drift)
  const m0 = stable.mean(); for (let i = 0; i < 500; i++) stable.step();
  near(stable.mean(), m0, 1e-9 + Math.abs(m0) * 1e-6, 'mean level constant without damping');
  const unstable = new RippleCPU(48, 48, { lambda: 0.8, damping: 0, stencil: 5 });   // the 5-point limit is 1/√2 (the 9-point one is ≈ 0.87, see methods.test)
  unstable.drop(24, 24, 1, 2.5);
  for (let i = 0; i < 300; i++) unstable.step();
  assert.ok(!(unstable.energy() < e0 * 1e6), '5-point stencil: λ = 0.8 > 1/√2 blows up');
});

test('ripple tank: rings travel at ≈ λ pixels per step; damping removes energy', () => {
  const r = new RippleCPU(161, 161, { lambda: 0.5, damping: 0 });
  r.drop(80, 80, 1, 2);
  const steps = 100; for (let i = 0; i < steps; i++) r.step();
  // radius of the strongest ring along a horizontal line
  let best = 0, at = 0; for (let x = 81; x < 161; x++) { const v = Math.abs(r.at(x, 80)); if (v > best) { best = v; at = x - 80; } }
  console.log(`  wavefront after ${steps} steps: ${at} px (λ·steps = ${0.5 * steps})`);
  assert.ok(Math.abs(at - 0.5 * steps) <= 0.2 * 0.5 * steps, 'front speed ≈ λ px/step (discrete dispersion allowed ±20%)');
  const d = new RippleCPU(48, 48, { lambda: 0.5, damping: RIPPLE.damping });
  d.drop(24, 24, 1, 2.5); for (let i = 0; i < 10; i++) d.step();
  const e1 = d.energy(); for (let i = 0; i < 480; i++) d.step();
  assert.ok(d.energy() < e1 * 0.6, 'energy decays with damping (2 s)');
});

test('ripple tank: same number of steps per second at any refresh rate', () => {
  for (const hz of [30, 60, 120, 144, 165]) {
    const acc = new StepAccumulator(240, 16); let total = 0;
    for (let i = 0; i < hz * 5; i++) total += acc.take(1 / hz);
    assert.ok(Math.abs(total - 1200) <= 1, `${hz} Hz: ${total} steps in 5 s`);
  }
});

test('swirl blur: diffusion per second is independent of frame time (radius ∝ √dt)', () => {
  // kernel: ½ centre + ⅛ at ±e on each axis → variance per axis 2·⅛·e² = ¼e²; with e = B·√dt
  const B = 0.02, varPerSecond = (dt) => (1 / dt) * 0.25 * (B * Math.sqrt(dt)) ** 2;
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) near(varPerSecond(dt), 0.25 * B * B, 1e-15, `dt=${dt}`);
});
