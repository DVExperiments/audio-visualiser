import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { COVERAGE } from '../src/renderer/visualizations/bars-waves-coverage.mjs';
import { EXPLAIN } from '../src/renderer/explain/specs.mjs';

test('every field the service sends is shown somewhere (Bars & Waves view, Diagnostics, or status)', () => {
  const frame = JSON.parse(fs.readFileSync(new URL('./fixtures/densemix-frames.ndjson', import.meta.url), 'utf8').split('\n')[0]);
  const fields = new Set([...Object.keys(frame), 'spec', 'waveL', 'waveR']);   // the fixture drops the three large arrays
  for (const k of fields) assert.ok(COVERAGE[k], `"${k}" is not listed in bars-waves-coverage.mjs`);
  for (const [k, where] of Object.entries(COVERAGE)) {
    assert.ok(where.visual || where.panel || where.status || where.meta, `"${k}" has no place`);
  }
  const visual = Object.entries(COVERAGE).filter(([, w]) => w.visual).map(([k]) => k);
  for (const k of ['bandsPulse', 'levelPulse', 'fluxLog', 'onset', 'centroid', 'rolloff', 'flatness', 'zcr'])
    assert.ok(visual.includes(k), `${k} is drawn (it was missing before the v0.8 audit)`);
});

test('the coverage map only names presets that exist', () => {
  // Bars & Waves presets live in bars-waves.js and in modules that register into it (v0.18: the phosphor scope)
  const src = ['../src/renderer/visualizations/bars-waves.js', '../src/renderer/visualizations/scope/phosphor.mjs', '../src/renderer/visualizations/terrain/terrain.mjs'].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const ids = [...src.matchAll(/\{ id: '([a-z-]+)', name: '[^']+', create: /g)].map((m) => m[1]);
  for (const [k, w] of Object.entries(COVERAGE)) for (const id of w.visual ?? []) assert.ok(ids.includes(id), `${k} → unknown preset ${id}`);
  for (const id of ids) assert.ok(EXPLAIN[id], `${id} has an explanation`);
});

test('bars-waves.js parses', () => {
  const src = fs.readFileSync(new URL('../src/renderer/visualizations/bars-waves.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src));
});

test('mashup cover scale: a W×H frame turned by θ and scaled by cos|θ| + max(W/H,H/W)·sin|θ| covers the screen', () => {
  for (const [W, H] of [[1920, 1080], [1080, 1920], [800, 800]]) for (const th of [0.001, 0.02, 0.05, 0.2]) {
    const s = Math.cos(th) + Math.max(W / H, H / W) * Math.sin(th);
    // every screen corner, mapped back into the previous frame, must land inside it
    for (const [x, y] of [[W / 2, H / 2], [-W / 2, H / 2], [W / 2, -H / 2], [-W / 2, -H / 2]]) {
      const u = (x * Math.cos(th) + y * Math.sin(th)) / s, v = (-x * Math.sin(th) + y * Math.cos(th)) / s;
      assert.ok(Math.abs(u) <= W / 2 + 1e-6 && Math.abs(v) <= H / 2 + 1e-6, `${W}×${H}, θ=${th}: corner covered`);
    }
  }
});

// ---------------- v0.15 circular spectrum helpers
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const U = requireCjs('../src/renderer/lib/dsp-utils.js');

test('Catmull-Rom passes exactly through every band and stays smooth between them', () => {
  const bands = [-60, -40, -35, -50, -20, -45, -70];
  for (let i = 0; i < bands.length; i++) assert.ok(Math.abs(U.catmullRom(bands, i) - bands[i]) < 1e-12, `exact at band ${i}`);
  assert.equal(U.catmullRom(bands, -3), bands[0], 'clamped below');
  assert.equal(U.catmullRom(bands, 99), bands[6], 'clamped above');
  // continuous: tiny steps give tiny changes, including across band centres
  let worst = 0; for (let x = 0; x < 6; x += 0.001) worst = Math.max(worst, Math.abs(U.catmullRom(bands, x + 0.001) - U.catmullRom(bands, x)));
  assert.ok(worst < 0.1, `largest change per 0.001 band: ${worst.toFixed(4)} dB`);
  const lin = [0, 1, 2, 3, 4];
  assert.ok(Math.abs(U.catmullRom(lin, 2.37) - 2.37) < 1e-12, 'reproduces straight lines exactly');
});

test('peak caps: jump, hold 0.35 s, fall 0.8/s, frame-rate independent', () => {
  const run = (dt) => {
    const v = new Float32Array([1]), p = new Float32Array(1), h = new Float32Array(1);
    U.peakCapStep(v, p, h, dt); v[0] = 0;
    const out = []; for (let t = 0; t < 1.2 - 1e-9; t += dt) { U.peakCapStep(v, p, h, dt); out.push([t + dt, p[0]]); }
    return (T) => out.find(([t]) => t >= T - 1e-9)[1];
  };
  const a = run(1 / 60), b = run(1 / 240);
  assert.equal(a(0.3), 1, 'held');
  assert.ok(Math.abs(a(0.85) - (1 - 0.8 * 0.5)) < 0.02, `then falling at 0.8/s (${a(0.85).toFixed(3)})`);
  assert.ok(Math.abs(a(0.85) - b(0.85)) < 0.02, 'same at 60 and 240 Hz');
  assert.ok(Math.abs(a(1.2) - 0.32) < 0.03, 'and never overshoots');
});

test('ridgeline history: one snapshot per 1/14 s of elapsed time, the same at 60 and 144 Hz', () => {
  const run = (hz) => {
    const h = new U.SnapshotHistory(44, 3, 1 / 14), v = new Float32Array(3);
    let t = 0; for (let i = 0; i < Math.round(2.5 * hz); i++) { t += 1 / hz; v[0] = t; h.step(v, 1 / hz); }
    return h;
  };
  const a = run(60), b = run(144);
  assert.equal(a.filled, 35, '2.5 s → 35 snapshots'); assert.equal(b.filled, 35);
  assert.ok(Math.abs(a.phase - b.phase) < 0.1, `scroll phase matches (${a.phase.toFixed(2)} vs ${b.phase.toFixed(2)})`);
  assert.ok(Math.abs(a.line(0)[0] - b.line(0)[0]) < 1 / 60, 'newest snapshot taken at the same moment (within a frame)');
  assert.ok(a.line(0)[0] > a.line(1)[0], 'line(0) is the newest');
  assert.equal(a.line(40), null, 'older than the history → none');
});

test('VU needle: IEC 60268-17 ballistics — 99 % in 300 ms, 1–1.5 % overshoot, independent of the step size', () => {
  const step = (h, T) => { const s = { x: 0, v: 0 }, out = []; for (let t = 0; t < T - 1e-12; t += h) { U.needleStep(s, 1, h); out.push([t + h, s.x]); } return out; };
  const fine = step(1e-4, 1.5);
  const t99 = fine.find(([, x]) => x >= 0.99)[0], peak = Math.max(...fine.map(([, x]) => x));
  assert.ok(Math.abs(t99 - 0.3) < 0.002, `99 % at ${(t99 * 1000).toFixed(1)} ms`);
  assert.ok(peak - 1 >= 0.01 && peak - 1 <= 0.015, `overshoot ${((peak - 1) * 100).toFixed(2)} % (spec 1–1.5 %)`);
  // 512-sample hops at 44.1 kHz and 48 kHz land on different times; compare at a common time via a fine run
  const h441 = 512 / 44100, h48 = 512 / 48000, a = step(h441, 0.5), b = step(h48, 0.5);
  const near = (arr, T) => arr.reduce((best, p) => (Math.abs(p[0] - T) < Math.abs(best[0] - T) ? p : best));
  const ref = (T) => near(fine, T)[1];
  assert.ok(Math.abs(near(a, 0.3)[1] - ref(near(a, 0.3)[0])) < 1e-3, 'exact at 44.1 kHz hops');
  assert.ok(Math.abs(near(b, 0.3)[1] - ref(near(b, 0.3)[0])) < 1e-3, 'exact at 48 kHz hops');
});
