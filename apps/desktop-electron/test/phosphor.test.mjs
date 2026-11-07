import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAM, segmentIntensity, buildBeam, gainStep } from '../src/renderer/visualizations/scope/phosphor-model.mjs';

const SR = 48000;
const out = () => ({ position: new Float32Array(BEAM.maxSegments * 12), edge: new Float32Array(BEAM.maxSegments * 4), inten: new Float32Array(BEAM.maxSegments * 4) });
// energy of a segment ∝ intensity × length (the quad's width is fixed)
function energy(x, y, n) {
  const o = out(), m = buildBeam(x, y, n, SR, o); let e = 0;
  for (let s = 0; s < m; s++) { const i = n - m + s; e += o.inten[4 * s] * Math.max(Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]), BEAM.width); }
  return { e, m };
}

test('beam physics: every sample deposits the same energy (fast strokes dim, slow strokes bright)', () => {
  const fast = segmentIntensity(0.1, SR), slow = segmentIntensity(0.01, SR);
  assert.ok(Math.abs(fast / slow - 0.1) < 1e-12, 'ten times longer → ten times dimmer');
  assert.ok(Math.abs(fast * 0.1 - slow * 0.01) < 1e-15, 'equal energy per sample');
  assert.equal(segmentIntensity(0, SR), segmentIntensity(BEAM.width, SR), 'a resting beam is bright but finite');
});

test('the same audio gives the same beam however it is split into frames (no gaps, no repeats)', () => {
  const N = 4800, x = new Float32Array(N + 1), y = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { const t = i / SR; x[i] = 0.8 * Math.sin(2 * Math.PI * 440 * t); y[i] = 0.8 * Math.cos(2 * Math.PI * 660 * t); }
  const whole = energy(x, y, N);
  for (const frame of [512, 800, 333]) {   // e.g. 512-sample hops, 60 Hz frames, odd sizes
    let e = 0, segs = 0;
    for (let a = 0; a < N; a += frame) {
      const n = Math.min(frame, N - a), r = energy(x.subarray(a, a + n + 1), y.subarray(a, a + n + 1), n);
      e += r.e; segs += r.m;
    }
    assert.equal(segs, N, `${frame}-sample frames: every segment once`);
    assert.ok(Math.abs(e - whole.e) < 1e-9 * whole.e, `${frame}-sample frames: identical energy`);
  }
});

test('energy per second is fixed by time, not by the frame rate', () => {
  // a 440 Hz circle: 1 s of samples at 60 fps or 144 fps deposits the same total energy
  const total = (fps) => {
    let e = 0, t0 = 0;
    const perFrame = SR / fps, x = new Float32Array(Math.ceil(perFrame) + 2), y = new Float32Array(x.length);
    for (let f = 0; f < fps; f++) {
      const a = Math.round(f * perFrame), b = Math.round((f + 1) * perFrame), n = b - a;
      for (let i = 0; i <= n; i++) { const t = (a + i) / SR; x[i] = 0.7 * Math.cos(2 * Math.PI * 440 * t); y[i] = 0.7 * Math.sin(2 * Math.PI * 440 * t); }
      e += energy(x, y, n).e; t0 = b;
    }
    return e;
  };
  const a = total(60), b = total(144);
  assert.ok(Math.abs(a - b) < 1e-6 * a, `60 vs 144 fps: ${a.toFixed(4)} vs ${b.toFixed(4)}`);
});

test('quads: a resting beam still draws a dot; segment count is capped', () => {
  const o = out(), x = new Float32Array([0.2, 0.2]), y = new Float32Array([0.1, 0.1]);
  assert.equal(buildBeam(x, y, 1, SR, o), 1);
  const xs = [o.position[0], o.position[3], o.position[6], o.position[9]], ys = [o.position[1], o.position[4], o.position[7], o.position[10]];
  assert.ok(Math.max(...xs) - Math.min(...xs) > 0 && Math.max(...ys) - Math.min(...ys) > 0, 'non-degenerate quad');
  const big = new Float32Array(BEAM.maxSegments + 500);
  assert.equal(buildBeam(big, big, big.length - 1, SR, out()), BEAM.maxSegments, 'capped (keeps the newest)');
});

test('auto-gain shrinks fast for loud figures, grows slowly for quiet ones, within ×1…×8', () => {
  let g = 1; for (let i = 0; i < 120; i++) g = gainStep(g, 0.1, 1 / 60);
  assert.ok(g > 6 && g <= 8, `quiet figure grows (${g.toFixed(2)} after 2 s)`);
  let h = 8; for (let i = 0; i < 18; i++) h = gainStep(h, 0.5, 1 / 60);
  assert.ok(h < 2.2, `loud figure shrinks within 0.3 s (${h.toFixed(2)})`);
  assert.equal(Math.round(gainStep(1, 5, 10) * 1000) / 1000, 1, 'never below ×1 (a full-scale figure is shown at true size)');
});
