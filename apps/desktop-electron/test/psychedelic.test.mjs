import test from 'node:test';
import assert from 'node:assert/strict';
import { threePhase, tunnelCoords, juliaSmooth, HueDrift } from '../src/renderer/visualizations/alchemy/psy-model.mjs';
import { EXPLAIN } from '../src/renderer/explain/specs.mjs';

test('plasma colour, deepened by the power 1.8, still never dark: brightest channel ≥ 0.75^1.8', () => {
  let worst = 1;
  for (let v = -4; v <= 4; v += 0.001) worst = Math.min(worst, Math.max(...threePhase(v, 0.2, 1.8)));
  assert.ok(worst >= 0.75 ** 1.8 - 1e-9 && Math.abs(worst - 0.75 ** 1.8) < 1e-3, `minimum ${worst.toFixed(4)} = 0.75^1.8`);
});

test('three-phase colour is never dark: the brightest channel is always ≥ 0.75', () => {
  let worst = 1;
  for (let v = -4; v <= 4; v += 0.001) for (const h of [0, 0.13, 0.5]) worst = Math.min(worst, Math.max(...threePhase(v, h)));
  assert.ok(worst >= 0.75 - 1e-9, `minimum of the brightest channel ${worst.toFixed(4)}`);
  assert.ok(Math.abs(worst - 0.75) < 1e-3, 'and the bound ½ + ½cos60° is tight');
});

test('hyper tunnel is self-similar: doubling the radius equals travelling ln 2', () => {
  const p = { travel: 0.3, spin: 0.1, twist: 0.7, arms: 5 };
  for (const [x, y] of [[0.2, 0.1], [-0.05, 0.3], [0.4, -0.4]]) {
    const a = tunnelCoords(2 * x, 2 * y, p), b = tunnelCoords(x, y, { ...p, travel: p.travel - Math.LN2 });
    assert.ok(Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12, 'same (u, v)');
  }
});

test('julia set: smooth escape count is continuous and interior points never escape', () => {
  const c = [0.7885 * Math.cos(0.3), 0.7885 * Math.sin(0.3)];
  assert.equal(juliaSmooth(0, 0, 0.2, 0.1), Infinity, 'z=0 with small c stays bounded (interior)');
  const a = juliaSmooth(1.2, 0.3, ...c), b = juliaSmooth(1.2001, 0.3, ...c);
  assert.ok(Number.isFinite(a) && Math.abs(a - b) < 0.05, `smooth: ${a.toFixed(4)} vs ${b.toFixed(4)}`);
});

test('hue jumps glide (80 ms) instead of switching instantly', () => {
  const h = new HueDrift();
  h.step(0, 1 / 120, 0.12);
  assert.ok(h.value < 0.12 * 0.15, 'one frame after a kick the jump has barely started');
  for (let i = 0; i < 60; i++) h.step(0, 1 / 120);
  assert.ok(Math.abs(h.value - 0.12) < 0.002, 'after 0.5 s it has arrived');
});

test('every psychedelic preset has an explanation', () => {
  for (const id of ['acid-warp', 'plasma-prism', 'julia-bloom', 'hyper-tunnel', 'rainbow-mandala']) assert.ok(EXPLAIN[id], id);
});

test('hyper tunnel colour has no hard edges: cos(2πv/N) is continuous across θ = ±π and between arms', () => {
  const p = { travel: 0, spin: 0.37, twist: 0.6, arms: 5 };
  const col = (x, y) => Math.cos(2 * Math.PI * tunnelCoords(x, y, p)[1] / p.arms);
  assert.ok(Math.abs(col(-0.3, 1e-9) - col(-0.3, -1e-9)) < 1e-6, 'continuous across the atan seam');
  // smooth everywhere: tiny steps in angle give tiny changes (v0.6 had jumps of 0.13 at every arm edge)
  let worst = 0;
  for (let a = -Math.PI; a < Math.PI; a += 0.001) worst = Math.max(worst, Math.abs(col(0.3 * Math.cos(a), 0.3 * Math.sin(a)) - col(0.3 * Math.cos(a + 0.001), 0.3 * Math.sin(a + 0.001))));
  assert.ok(worst < 0.01, `largest change per 0.001 rad: ${worst.toFixed(5)}`);
});
