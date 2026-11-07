import test from 'node:test';
import assert from 'node:assert/strict';
import { Mapping, MappingSet, mulberry32 } from '../src/renderer/engine/mapping.mjs';
import { MorphModel, Spring, DEFAULT_PARAMS, MORPH_MAPPINGS, SIM_MAX_STEP } from '../src/renderer/visualizations/experimental/morph-model.mjs';

const HOP = 512 / 48000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

/** Fibonacci sphere: n near-uniform unit directions. */
function sphere(n) {
  const d = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y);
    d.set([r * Math.cos(g * i), y, r * Math.sin(g * i)], 3 * i);
  }
  return d;
}

/** A frame shaped like the service's output. */
function frame(o = {}) {
  const bands = o.bands ?? [0, 0, 0, 0, 0, 0, 0];
  return {
    level: o.level ?? 0, bandsNorm: bands, bandsPulse: o.pulses ?? bands, levelPulse: o.levelPulse ?? 0, silent: o.silent ?? false,
    onset: { on: !!o.onset, confidence: o.onset ?? 0 },
    centroid: o.centroid ?? 1000, flatness: 0.1, balance: o.balance ?? 0, correlation: 1, width: 0,
  };
}

function drive(model, maps, f, seconds) {
  const n = Math.round(seconds / HOP);
  for (let i = 0; i < n; i++) model.stepFrame(maps.apply(f, HOP), HOP);
}

function makeModel(n = 3000) {
  const dirs = sphere(n);
  return { model: new MorphModel(dirs, DEFAULT_PARAMS), maps: new MappingSet(MORPH_MAPPINGS), pos: new Float32Array(n * 3), disp: new Float32Array(n), dirs };
}

// ---------------- mapping engine ----------------
test('mapping: threshold, curve, gain, offset, clamp', () => {
  const m = new Mapping({ sources: [['bass', 1]], threshold: 0.2, curve: 'square', gain: 2, offset: 0.1, min: 0, max: 1 });
  near(m.target(frame({ bands: [0, 0.1, 0, 0, 0, 0, 0] })), 0.1, 1e-12, 'below threshold → offset');
  near(m.target(frame({ bands: [0, 0.6, 0, 0, 0, 0, 0] })), 2 * 0.5 ** 2 + 0.1, 1e-12, 'x′ = (0.6−0.2)/0.8 = 0.5 → 2·0.25 + 0.1');
  near(m.target(frame({ bands: [0, 1, 0, 0, 0, 0, 0] })), 1, 1e-12, 'clamped to max');
});

test('mapping: weighted sources, signed values, NaN hold', () => {
  const w = new Mapping({ sources: [['subBass', 0.25], ['bass', 0.75]] });
  near(w.target(frame({ bands: [1, 0.2, 0, 0, 0, 0, 0] })), 0.25 + 0.15, 1e-12, 'weighted sum');
  const s = new Mapping({ sources: [['balance', 1]], signed: true, min: -1, max: 1 });
  near(s.target(frame({ balance: -0.4 })), -0.4, 1e-12, 'sign preserved');
  const c = new Mapping({ sources: [['centroid', 1]] });
  c.apply(frame({ centroid: 2000 }), HOP);
  const before = c.value;
  c.apply(frame({ silent: true }), HOP);
  assert.equal(c.value, before, 'undefined (silent) feature holds the previous value');
  near(before, Math.log(20) / Math.log(200), 1e-12, 'centroid 2 kHz → log position');
});

test('mapping: attack/release time constants', () => {
  const m = new Mapping({ sources: [['level', 1]], attack: 0.1, release: 0.5 });
  let t = 0; while (t < 0.1 - 1e-9) { m.apply(frame({ level: 1 }), 0.001); t += 0.001; }
  near(m.value, 1 - Math.exp(-1), 1e-9, 'attack 63.2% after τ');
});

test('mapping: rejects invalid specs', () => {
  assert.throws(() => new Mapping({ sources: [['nope', 1]] }));
  assert.throws(() => new Mapping({ sources: [['bass', 1]], curve: 'eval' }));
  assert.throws(() => new Mapping({ sources: [['bass', 1]], threshold: 1 }));
  assert.throws(() => new Mapping({ sources: [] }));
});

test('seeded RNG is reproducible', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

// ---------------- dynamics ----------------
test('spring: settles on its target and rings at the damped natural frequency', () => {
  const s = new Spring({ freqHz: 2, zeta: 0.1 });
  const h = SIM_MAX_STEP, xs = [];
  for (let t = 0; t < 10; t += h) { s.step(1, h); xs.push(s.x); }
  near(xs.at(-1), 1, 1e-3, 'settles at target');
  // measure the period from upward crossings of the target
  const ups = []; for (let i = 1; i < xs.length; i++) if (xs[i - 1] < 1 && xs[i] >= 1) ups.push(i * h);
  const period = (ups.at(-1) - ups[0]) / (ups.length - 1);
  near(1 / period, 2 * Math.sqrt(1 - 0.01), 0.02, 'damped frequency f₀√(1−ζ²)');
});

test('spring: stable and bounded under 60 s of random drive and kicks', () => {
  const { model } = makeModel(500);
  const r = mulberry32(9);
  for (let i = 0; i < 60 / HOP; i++) {
    model.stepFrame({ bass: r(), mid: r(), high: r(), asym: 2 * r() - 1, kick: r() < 0.05 ? 1 : 0 }, HOP);
    for (const s of Object.values(model.springs)) assert.ok(Number.isFinite(s.x) && s.x >= s.min && s.x <= s.max);
  }
});

// ---------------- geometry guarantees ----------------
test('displacement is bounded and the surface can never self-intersect (r ≥ 0.15R)', () => {
  const { model, pos, disp } = makeModel(4000);
  const bound = model.maxDisplacement();
  assert.ok(DEFAULT_PARAMS.radius - bound >= 0.15 * DEFAULT_PARAMS.radius, `design bound leaves r ≥ ${DEFAULT_PARAMS.radius - bound}`);
  const r = mulberry32(3);
  for (let i = 0; i < 3000; i++) {
    model.stepFrame({ bass: r() * 1.5, mid: r() * 1.5, high: r(), asym: 2 * r() - 1, kick: r() < 0.1 ? 1 : 0 }, HOP);
    if (i % 25 === 0) {
      const st = model.writeGeometry(pos, disp);
      assert.ok(st.maxAbs <= bound + 1e-6, `|D| ${st.maxAbs} ≤ bound ${bound}`);
      assert.ok(st.minRadius >= 0.15, `min radius ${st.minRadius}`);
    }
  }
});

test('bass harmonic is smooth at the poles (no cusp from angular coordinates)', () => {
  // the plain angular form sin(2θ) would take every value in [−1, 1] around the pole; ours → 0
  // directions a tiny polar angle from the +y pole, at many azimuths: displacement must agree
  const eps = 1e-3, k = 64, dirs = new Float32Array(k * 3);
  for (let i = 0; i < k; i++) { const a = (2 * Math.PI * i) / k; dirs.set([Math.sin(eps) * Math.cos(a), Math.cos(eps), Math.sin(eps) * Math.sin(a)], 3 * i); }
  const m = new MorphModel(dirs, DEFAULT_PARAMS);
  for (let i = 0; i < k; i++) {
    for (const j of [0, 1]) assert.ok(Math.abs(m.basis[j * k + i]) <= eps ** 2 * 1.01, 'sectoral basis ~ sin²φ → 0 at the pole');
  }
});

test('basis decomposition equals direct evaluation of D', () => {
  const { model, disp, pos, dirs } = makeModel(200);
  drive(model, new MappingSet(MORPH_MAPPINGS), frame({ bands: [0.5, 0.8, 0.4, 0.6, 0.3, 0.5, 0.2], balance: 0.3 }), 1);
  model.writeGeometry(pos, disp);
  const A = model.p.amp, S = model.springs, { midK, highK } = model.p.waves;
  for (let v = 0; v < 200; v += 17) {
    const x = dirs[3 * v], y = dirs[3 * v + 1], z = dirs[3 * v + 2];
    const re = x * x - z * z, im = 2 * x * z;   // (x + iz)^2
    let D = A.bass * S.bass.x * (0.55 * (re * Math.sin(model.psiBass) + im * Math.cos(model.psiBass)) + 0.45 * 0.5 * (3 * y * y - 1) * Math.cos(model.psiZonal));
    let s = 0; model.midDirs.forEach((d, j) => { s += Math.sin(midK * (d[0] * x + d[1] * y + d[2] * z) + model.midPhase[j]); });
    D += A.mid * S.mid.x * s / Math.sqrt(model.midDirs.length);
    s = 0; model.highDirs.forEach((d, j) => { s += Math.sin(highK * (d[0] * x + d[1] * y + d[2] * z) + model.highPhase[j]); });
    D += A.high * S.high.x * s / Math.sqrt(model.highDirs.length);
    D += A.asym * S.asym.x * x + A.breathe * Math.sin(2 * Math.PI * 0.12 * model.time) + A.swell * Math.max(0, S.bass.x);
    near(disp[v], D, 1e-5, `vertex ${v}`);
  }
});

// ---------------- Phase 2 gate: controlled audio → predictable geometry ----------------
test('gate: silence still moves gently (autonomous motion), but only a little', () => {
  const { model, maps, pos, disp } = makeModel();
  drive(model, maps, frame({ silent: true }), 2);
  const a = Float32Array.from((model.writeGeometry(pos, disp), disp));
  const rmsA = model.stats.rms;
  drive(model, maps, frame({ silent: true }), 1);
  model.writeGeometry(pos, disp);
  let diff = 0; for (let i = 0; i < disp.length; i++) diff += (disp[i] - a[i]) ** 2;
  assert.ok(Math.sqrt(diff / disp.length) > 1e-3, 'shape changes over time in silence');
  // full bass drive gives ≈ 0.1 RMS; idle motion should stay under about a third of that
  assert.ok(rmsA < 0.03, `silence deformation small (rms ${rmsA.toFixed(4)})`);
});

test('gate: more bass → monotonically more large-scale deformation', () => {
  const rms = [];
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    const { model, maps, pos, disp } = makeModel();
    drive(model, maps, frame({ bands: [level, level, 0, 0, 0, 0, 0] }), 3);
    model.writeGeometry(pos, disp);
    rms.push(model.termRms().bass);
  }
  for (let i = 1; i < rms.length; i++) assert.ok(rms[i] > rms[i - 1], `bass energy increases: ${rms.map((x) => x.toFixed(5)).join(' < ')}`);
});

test('gate: bass drives low-order shape, highs drive fine ripples', () => {
  const lo = makeModel(), hi = makeModel();
  drive(lo.model, lo.maps, frame({ bands: [1, 1, 0, 0, 0, 0, 0] }), 3);
  drive(hi.model, hi.maps, frame({ bands: [0, 0, 0, 0, 1, 1, 1] }), 3);
  const eL = lo.model.termRms(), eH = hi.model.termRms();
  console.log(`  bass-only rms: bass ${eL.bass.toFixed(4)}, high ${eL.high.toFixed(4)} | highs-only rms: bass ${eH.bass.toFixed(4)}, high ${eH.high.toFixed(4)}`);
  assert.ok(eL.bass > 10 * eL.high, `bass-only: bass rms ${eL.bass.toFixed(4)} ≫ high rms ${eL.high.toFixed(4)}`);
  assert.ok(eH.high > 2 * eH.bass, `highs-only: high rms ${eH.high.toFixed(4)} > 2× bass rms ${eH.bass.toFixed(4)}`);
});

test('gate: onsets kick the shape and launch particles, which then die away', () => {
  const { model, maps } = makeModel();
  drive(model, maps, frame({ bands: [0.3, 0.3, 0, 0, 0, 0, 0] }), 2);
  const v0 = model.springs.bass.v;
  model.stepFrame(maps.apply(frame({ bands: [0.3, 0.3, 0, 0, 0, 0, 0], onset: 1 }), HOP), HOP);
  assert.ok(model.springs.bass.v - v0 > 1, 'bass spring velocity jumps on an onset');
  assert.ok(model.particles.active >= 200, `particles launched: ${model.particles.active}`);
  drive(model, maps, frame({ bands: [0.3, 0.3, 0, 0, 0, 0, 0] }), 4);
  assert.equal(model.particles.active, 0, 'particles expire');
});

test('gate: stereo balance leans the shape toward that side', () => {
  for (const [bal, sign] of [[-1, -1], [1, 1]]) {
    const { model, maps, pos, disp } = makeModel();
    drive(model, maps, frame({ bands: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], balance: bal }), 4);
    model.writeGeometry(pos, disp);
    let cx = 0; for (let v = 0; v < disp.length; v++) cx += pos[3 * v];
    cx /= disp.length;
    assert.ok(Math.sign(cx) === sign && Math.abs(cx) > 0.01, `balance ${bal} → centroid x ${cx.toFixed(4)}`);
  }
});

test('determinism: same seed and frames → bit-identical geometry, regardless of render batching', () => {
  const frames = []; const r = mulberry32(77);
  for (let i = 0; i < 500; i++) frames.push(frame({ bands: [r(), r(), r(), r(), r(), r(), r()], onset: r() < 0.05 ? r() : 0, balance: r() - 0.5 }));
  const run = (batch) => {
    const { model, maps, pos, disp } = makeModel(800);
    // batch = analysis frames consumed per display frame (≈1.6 at 60 Hz, ≈0.8 at 120 Hz)
    for (let i = 0; i < frames.length; i += batch) {
      for (const f of frames.slice(i, i + batch)) model.stepFrame(maps.apply(f, HOP), HOP);
      model.writeGeometry(pos, disp);
    }
    return Float32Array.from(pos);
  };
  assert.deepEqual(run(1), run(3), '60 Hz-like vs 30 Hz-like batching');
  assert.deepEqual(run(1), run(1), 'repeat run');
});
