'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/renderer/lib/auto-shuffle.js');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const HOP = 512 / 48000;
const frame = (bands, o = {}) => ({ bands, dbfs: [o.db ?? -18, o.db ?? -18, o.db ?? -18], silent: !!o.silent, gap: false, onset: { on: false, confidence: 0 } });

test('shuffle bag: every preset once before any repeat, never the same one twice running', () => {
  const items = ['a/1', 'a/2', 'b/1', 'b/2', 'c/1'], bag = new A.ShuffleBag(items, rng(3));
  let cur = 'a/1'; const seen = [];
  for (let i = 0; i < 50; i++) { const n = bag.next(cur); assert.notEqual(n, cur, 'no immediate repeat'); seen.push(n); cur = n; }
  for (let i = 0; i + 5 <= 50; i += 5) assert.equal(new Set(seen.slice(i, i + 5)).size, 5, `round ${i / 5}: each once`);
  assert.equal(new A.ShuffleBag(['x/y']).next('x/y'), 'x/y', 'a pool of one just repeats');
  assert.equal(new A.ShuffleBag([]).next('x/y'), null);
});

test('music detector: a gap between tracks is a track change; steady music is not', () => {
  const d = new A.MusicalChangeDetector(), A1 = [-20, -18, -25, -30, -35, -40, -45];
  let events = [];
  for (let t = 0; t < 30; t += HOP) { const e = d.push(frame(A1), HOP); if (e) events.push(e); }
  assert.equal(events.length, 0, 'no events in 30 s of steady music');
  for (let t = 0; t < 1.5; t += HOP) d.push(frame(A1, { db: -80, silent: true }), HOP);
  const e = d.push(frame(A1), HOP);
  assert.equal(e?.kind, 'track', 'the first sound after a 1.5 s gap is a new track');
  const d2 = new A.MusicalChangeDetector();
  for (let t = 0; t < 30; t += HOP) d2.push(frame(A1), HOP);
  for (let t = 0; t < 0.3; t += HOP) d2.push(frame(A1, { db: -80, silent: true }), HOP);
  assert.equal(d2.push(frame(A1), HOP), null, 'a 0.3 s pause inside a song is not a new track');
});

test('music detector: a big change of tonal balance in gapless music is a section change, reported once', () => {
  const d = new A.MusicalChangeDetector(), A1 = [-20, -18, -25, -30, -35, -40, -45], B1 = [-50, -45, -30, -18, -16, -20, -24];
  for (let t = 0; t < 40; t += HOP) d.push(frame(A1), HOP);
  const events = []; let t0 = null;
  for (let t = 0; t < 30; t += HOP) { const e = d.push(frame(B1), HOP); if (e) { events.push(e); t0 ??= t; } }
  assert.equal(events.length, 1, `one section event (got ${events.length})`);
  assert.equal(events[0].kind, 'section');
  assert.ok(t0 < 4, `reported within 4 s of the change (${t0.toFixed(2)} s)`);
});

test('auto director, timer mode: switches after N minutes, on the next strong beat (or within 3 s)', () => {
  const dir = new A.AutoDirector({ mode: 'timer', minutes: 1 });
  let t = 0, at = null;
  while (t < 70 && at === null) { const beat = Math.abs((t % 0.5)) < HOP; if (dir.step(HOP, null, { on: beat && t > 60.2, confidence: 0.9 })) at = t; t += HOP; }
  assert.ok(at >= 60 && at <= 61, `switched at ${at?.toFixed(2)} s, on the first strong beat after 60 s`);
  const quiet = new A.AutoDirector({ mode: 'timer', minutes: 1 });
  t = 0; at = null;
  while (t < 70 && at === null) { if (quiet.step(HOP, null, { on: false, confidence: 0 })) at = t; t += HOP; }
  assert.ok(at >= 62.9 && at <= 63.1, `without beats, 3 s after the timer (${at?.toFixed(2)} s)`);
});

test('auto director, music mode: follows track and section changes, but holds at least 45 s', () => {
  const dir = new A.AutoDirector({ mode: 'music', minutes: 5 });
  assert.equal(dir.step(10, { kind: 'track' }, null), null, 'too soon after the last switch');
  assert.deepEqual(dir.step(40, { kind: 'track' }, null), { reason: 'new track' }, 'track change at 50 s: immediate');
  dir.step(50, { kind: 'section' }, null);
  let r = null; for (let i = 0; i < 400 && !r; i++) r = dir.step(HOP, null, { on: i === 100, confidence: 0.8 });
  assert.deepEqual(r, { reason: 'the music changed' }, 'section change waits for a strong beat');
  const idle = new A.AutoDirector({ mode: 'music', minutes: 2 });
  r = null; let t = 0; while (!r && t < 200) { r = idle.step(HOP, null, null); t += HOP; }
  assert.ok(t >= 120 && t <= 123.1, `falls back to the time limit when nothing changes (${t.toFixed(1)} s)`);
});

test('transitions: outgoing fully visible at p = 0 and fully gone at p = 1, for every type', () => {
  for (const type of A.TRANSITIONS) {
    const t = { type, angle: 30 }, s0 = A.transitionStyle(t, 0), s1 = A.transitionStyle(t, 1);
    if (s0.maskImage === 'none') { assert.equal(s0.opacity, '1'); assert.equal(s1.opacity, '0'); continue; }
    // masks: at p = 0 the transparent stop sits before the start (nothing revealed); at p = 1, beyond the end
    const stops = (css) => [...css.matchAll(/transparent (-?[\d.]+)(%|deg), black (-?[\d.]+)/g)][0];
    const a = stops(s0.maskImage), b = stops(s1.maskImage), full = type === 'clock' ? 360 : 100;
    assert.ok(+a[3] <= 0.5, `${type}: nothing revealed at p = 0 (${a[0]})`);
    assert.ok(+b[1] >= full, `${type}: everything revealed at p = 1 (${b[0]})`);
  }
  const picks = []; let last = null; const r = rng(5);
  for (let i = 0; i < 20; i++) { const p = A.pickTransition('mixed', last, r); assert.notEqual(p.type, last); picks.push(p.type); last = p.type; }
  assert.ok(new Set(picks).size >= 4, 'mixed uses the variety');
  assert.equal(A.pickTransition('iris', 'iris').type, 'iris', 'a fixed choice is honoured');
});

test('library: favourites toggle, collection ids are unique, virtual collections resolve real presets', () => {
  let fav = A.toggleKey([], 'alchemy/acid-warp'); fav = A.toggleKey(fav, 'battery/eclipse'); fav = A.toggleKey(fav, 'alchemy/acid-warp');
  assert.deepEqual(fav, ['battery/eclipse']);
  assert.deepEqual(A.toggleKey(fav, '../x'), fav, 'invalid keys ignored');
  const cols = [{ id: 'user-album-night' }];
  assert.equal(A.newCollectionId('Album night!', cols), 'user-album-night-2');
  const registry = [{ id: 'battery', name: 'Battery-inspired', available: true, presets: [{ id: 'eclipse', name: 'Eclipse', create: () => 1 }] }];
  const v = A.virtualCollections({ favourites: ['battery/eclipse', 'gone/missing'], collections: [{ id: 'user-x', name: 'X', items: [] }] }, registry);
  assert.equal(v[0].presets.length, 1, 'missing presets are skipped');
  assert.equal(v[0].presets[0].id, 'eclipse', 'keeps the real id (for explanations)');
  assert.equal(v[0].presets[0].realCollection, 'battery');
  assert.equal(v[1].available, false, 'an empty collection is listed but unavailable');
});
