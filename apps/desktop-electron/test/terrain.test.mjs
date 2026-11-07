import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN, heightRow, colU, RowHistory } from '../src/renderer/visualizations/terrain/terrain-model.mjs';

const spec = (fn) => Float32Array.from({ length: 48 }, (_, i) => fn(i));

test('terrain rows: mirrored, bass at the edges, treble towards the centre, a flat road in the middle', () => {
  const row = heightRow(spec((i) => (i < 8 ? -15 : -55)), new Float32Array(TERRAIN.cols));   // loud bass only
  for (let c = 0; c < TERRAIN.cols; c++) assert.ok(Math.abs(row[c] - row[TERRAIN.cols - 1 - c]) < 1e-6, 'symmetric');
  assert.ok(row[0] > 0.8, `bass raises the edges (${row[0].toFixed(2)})`);
  const mid = Math.floor(TERRAIN.cols / 2);
  assert.equal(row[mid], 0, 'the road in the centre is flat');
  const treble = heightRow(spec((i) => (i > 40 ? -15 : -55)), new Float32Array(TERRAIN.cols));
  const peak = treble.indexOf(Math.max(...treble));
  assert.ok(colU(peak) < 0.35, `treble rises near the centre (|u| = ${colU(peak).toFixed(2)}), just outside the road`);
  assert.ok(treble[0] < 0.02, 'and barely at the edges (−55 dB there gives (5/48)² ≈ 0.011)');
});

test('terrain heights: monotonic in level, 0 below −60 dB, 1 at −12 dB and above', () => {
  const at = (db) => heightRow(spec(() => db), new Float32Array(TERRAIN.cols))[0];
  assert.equal(at(-80), 0); assert.equal(at(-5), 1);
  let prev = -1; for (let db = -70; db <= 0; db += 2) { const h = at(db); assert.ok(h >= prev, 'louder is never lower'); prev = h; }
});

test('terrain history scrolls at the same speed at 60 and 144 Hz', () => {
  const run = (hz) => { const h = new RowHistory(64, 2, 1 / 24), row = new Float32Array(2); for (let i = 0; i < Math.round(1.5 * hz); i++) { row[0] = i / hz; h.step(row, 1 / hz); } return h; };
  const a = run(60), b = run(144);
  assert.equal(a.filled, b.filled, `same number of rows (${a.filled})`);
  assert.ok(Math.abs(a.phase - b.phase) < 0.4, 'scroll phase matches within a frame');
  assert.equal(a.at(99, 0), 0, 'before the history fills: flat ground');
});
