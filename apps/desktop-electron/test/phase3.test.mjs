import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeStrip, stripIndex, decayFactor, zoomFactor, specTo01, sampleArray } from '../src/renderer/engine/geometry2d.mjs';
import { MappingSet } from '../src/renderer/engine/mapping.mjs';
import { lissajousRibbon, spiralArm, SpectrumFollower } from '../src/renderer/visualizations/alchemy/alchemy-model.mjs';
import { RhythmSwitch, PolygonRings, StarGate } from '../src/renderer/visualizations/battery/battery-model.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const HOP = 512 / 48000, BEAT = 60 / 124;

// ---------------- feedback maths: identical trails at any refresh rate ----------------
test('feedback decay and zoom are exactly frame-rate independent', () => {
  for (const hz of [30, 60, 120, 144, 240]) {
    const dt = 1 / hz, n = hz;                         // one second of frames
    near(decayFactor(0.4, dt) ** n, decayFactor(0.4, 1), 1e-12, `${hz} Hz decay over 1 s`);
    near(zoomFactor(0.7, dt) ** n, zoomFactor(0.7, 1), 1e-12, `${hz} Hz zoom over 1 s`);
  }
  near(decayFactor(0.4, 0.4), 0.5, 1e-15, 'half-life means half');
});

// ---------------- strip geometry ----------------
test('strip: width is exact, normals perpendicular, closed strips join', () => {
  const n = 64, pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; pts[2 * i] = 0.5 * Math.cos(a); pts[2 * i + 1] = 0.5 * Math.sin(a); }
  const out = { position: new Float32Array(n * 6), along: new Float32Array(n * 2), edge: new Float32Array(n * 2) };
  writeStrip(pts, n, 0.01, true, out);
  for (let i = 0; i < n; i++) {
    const ox = out.position[6 * i], oy = out.position[6 * i + 1], ix = out.position[6 * i + 3], iy = out.position[6 * i + 4];
    near(Math.hypot(ox - ix, oy - iy), 0.02, 1e-6, 'full width = 2·halfWidth');
    near(Math.abs(Math.hypot(ox, oy) - Math.hypot(ix, iy)), 0.02, 2e-4, 'edges offset along the radial normal of a circle');
  }
  const idx = stripIndex(n, true);
  assert.equal(idx.length, n * 6);
  assert.equal(Math.max(...idx), 2 * n - 1);
  assert.ok(idx.slice(-6).includes(0), 'last segment joins back to the first');
});

test('spectrum helpers: dB → 0..1 clamp, interpolation', () => {
  const o = specTo01([-120, -75, -42.5, -10, 5], new Float32Array(5));
  assert.deepEqual(Array.from(o), [0, 0, 0.5, 1, 1]);
  near(sampleArray([0, 1, 2], 0.25), 0.5, 1e-12, 'linear interpolation');
  const f = new SpectrumFollower(2, 0.1);
  f.update([1, 1], HOP); assert.equal(f.v[0], 1, 'instant attack');
  f.update([0, 0], 0.1); near(f.v[0], Math.exp(-1), 1e-6, 'release time constant');
});

// ---------------- Alchemy ----------------
test('alchemy ribbon: closed, bounded, and bulges where the spectrum is loud', () => {
  const n = 400, pts = new Float32Array(n * 2), args = { a: 3, b: 2, phase1: 0.3, phase2: 1.1, radius: 0.5, xScale: 1.5, specGain: 0.6 };
  const quiet = lissajousRibbon(pts, n, { ...args, spec: new Float32Array(48).fill(0.1) });
  const loud = lissajousRibbon(pts, n, { ...args, spec: new Float32Array(48).fill(0.9) });
  assert.ok(loud > quiet * 1.3, `mean radius loud ${loud.toFixed(3)} > quiet ${quiet.toFixed(3)}`);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(pts[2 * i + 1]) <= 1 && Math.abs(pts[2 * i]) <= 1.6 * 1.5, 'on screen');
  // closure: the point after the last equals the first (period 1 in s)
  const bassOnly = new Float32Array(48); bassOnly.fill(0.9, 0, 8);
  lissajousRibbon(pts, n, { ...args, spec: bassOnly });
  const r = (i) => Math.hypot(pts[2 * i] / 1.5, pts[2 * i + 1]);
  // walking s: start (bass) bulges relative to the middle (treble)
  const startR = args.radius * (1 + 0.6 * (0.9 - 0.5)), midR = args.radius * (1 + 0.6 * (0 - 0.5));
  assert.ok(startR > midR, 'bass end of the walk bulges');
});

test('alchemy spiral: logarithmic radius from r0 to rMax; spectrum widens the arm', () => {
  const n = 100, pts = new Float32Array(n * 2), w = new Float32Array(n);
  const base = { arm: 0, arms: 5, turns: 1.3, r0: 0.03, rMax: 0.9, rotation: 0, baseWidth: 0.005, specWidth: 0.03 };
  spiralArm(pts, w, n, { ...base, spec: new Float32Array(48).fill(0) });
  near(Math.hypot(pts[0], pts[1]), 0.03, 1e-7, 'starts at r0 (float32)');
  near(Math.hypot(pts[2 * (n - 1)], pts[2 * n - 1]), 0.9, 1e-6, 'ends at rMax (float32)');
  // constant ratio between successive radii ⇒ logarithmic spiral
  const r = (i) => Math.hypot(pts[2 * i], pts[2 * i + 1]);
  near(r(50) / r(49), r(20) / r(19), 1e-5, 'r_{i+1}/r_i constant (float32)');
  const quietW = Array.from(w);
  spiralArm(pts, w, n, { ...base, spec: new Float32Array(48).fill(1) });
  assert.ok(w[50] > quietW[50] + 0.02, 'loud spectrum widens the arm');
});

// ---------------- Battery ----------------
test('rhythm switch: changes only on strong onsets, never inside the refractory time, always to a new shape', () => {
  const s = new RhythmSwitch([3, 4, 5, 6, 8], { seed: 1, threshold: 0.75, refractory: 1.0 });
  let prev = s.value;
  s.step(0.5, 0.1); assert.equal(s.changes, 0, 'weak onset ignored');
  s.step(0.9, 0.1); assert.equal(s.changes, 1, 'strong onset switches');
  assert.notEqual(s.value, prev); prev = s.value;
  s.step(1, 0.5); assert.equal(s.changes, 1, 'refractory blocks a second switch');
  s.step(1, 0.6); assert.equal(s.changes, 2, 'after the refractory time it switches again');
  assert.notEqual(s.value, prev);
});

test('polygon rings: ring radii follow their band pulses and stay on screen', () => {
  const m = new PolygonRings(6, 7), pts = new Float32Array(480);
  const frame = (p) => ({ bandsPulse: [p, p, p, p, p, p, p] });
  m.step({ kick: 0, mid: 0 }, frame(0), HOP);
  const r0 = [0, 1, 2, 3, 4, 5].map((j) => m.radius(j));
  m.step({ kick: 0, mid: 0 }, frame(1), HOP);
  for (let j = 0; j < 6; j++) {
    near(m.radius(j) / r0[j], 1.32, 1e-9, `ring ${j} grows by 32% on a full pulse`);
    const n = m.writeRing(pts, j, 240 / m.shape.value);
    assert.equal(n, 240);
    for (let i = 0; i < n; i++) assert.ok(Math.hypot(pts[2 * i], pts[2 * i + 1]) <= 0.99, 'inside the unit circle');
  }
});

test('star gate: inner/outer radii follow bass and treble', () => {
  const g = new StarGate(1), out = new Float32Array(40);
  g.writeStar(out, { bass: 0, high: 0 });
  const ro0 = Math.hypot(out[0], out[1]), ri0 = Math.hypot(out[2], out[3]);
  g.writeStar(out, { bass: 1, high: 1 });
  near(Math.hypot(out[0], out[1]) / ro0, 1.45, 1e-6, 'outer radius +45% with full bass (float32)');
  assert.ok(Math.hypot(out[2], out[3]) / Math.hypot(out[0], out[1]) < ri0 / ro0, 'treble sharpens the star');
});

// ---------------- Phase 3 gate: each collection reacts to the beat on real pipeline frames ----------------
const frames = fs.readFileSync(new URL('./fixtures/densemix-frames.ndjson', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const phaseOf = (f) => ((((f.seq + 1) * 512) / 48000) % BEAT) / BEAT;
function beatContrast(series) {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean(series.filter((s) => s.ph < 0.25).map((s) => s.v)) - mean(series.filter((s) => s.ph > 0.5 && s.ph < 0.9).map((s) => s.v));
}

test('gate: the drive behind each collection follows the beat (recorded dense mix)', async () => {
  const { COMMON_MAPPINGS } = await import('./helpers/common-mappings.mjs');
  const maps = new MappingSet(COMMON_MAPPINGS);
  const rings = new PolygonRings(6, 7), star = new StarGate(11);
  const s = { zoom: [], ring0: [], star: [], level: [] };
  frames.forEach((f, i) => {
    const v = maps.apply(f, HOP);
    rings.step(v, f, HOP); star.step(v, HOP);
    if (i < 150) return;
    const ph = phaseOf(f);
    s.zoom.push({ ph, v: 0.06 + 0.7 * v.bass });             // Liquid Ribbons trail push
    s.ring0.push({ ph, v: Math.max(rings.radius(0), rings.radius(1)) });  // Polygon Pulse low rings
    s.star.push({ ph, v: 0.6 + 2.2 * v.bass });               // Star Tunnel rush
    s.level.push({ ph, v: v.level });                         // brightness everywhere
  });
  const c = Object.fromEntries(Object.entries(s).map(([k, xs]) => [k, beatContrast(xs)]));
  console.log('  beat contrast:', Object.entries(c).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(', '), `| shape changes ${rings.shape.changes}, star changes ${star.points.changes}`);
  assert.ok(c.zoom > 0.15, 'ribbon trails surge on kicks');
  assert.ok(c.ring0 > 0.02, 'low polygon rings pulse on kicks');
  assert.ok(c.star > 0.5, 'tunnel rushes on kicks');
  assert.ok(c.level > 0.15, 'brightness pulses on kicks');
  const seconds = frames.length * HOP;   // changes are counted from the first frame
  assert.ok(rings.shape.changes >= 2 && rings.shape.changes <= seconds / 1.0 + 1, 'polygon shape changes rhythmically, within the refractory limit');
});
