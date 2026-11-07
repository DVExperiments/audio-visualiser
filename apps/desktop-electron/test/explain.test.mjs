import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { EXPLAIN } from '../src/renderer/explain/specs.mjs';
import { WARP_PRESETS, computeWarp, explainWarp, symmetryMatrices, foldPoint, ageColour, describeDecay } from '../src/renderer/engine/warp-model.mjs';
import { MappingSet, mappingTex, mulberry32 } from '../src/renderer/engine/mapping.mjs';
import { MORPH_MAPPINGS } from '../src/renderer/visualizations/experimental/morph-model.mjs';
import { COMMON_MAPPINGS } from './helpers/common-mappings.mjs';
import { SCHEMES } from '../src/renderer/engine/palettes.mjs';

const typeset = (tex, where) => {
  try { katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'html' }); }
  catch (e) { assert.fail(`${where}: TeX does not typeset — ${e.message}\n${tex}`); }
};
const frame = { sr: 48000, bands: [-20, -15, -25, -30, -35, -40, -45], dbfs: [-12, -13, -12.5], centroid: 2000, correlation: 0.9, balance: 0.1, width: 0.2 };
const drives = { bass: 0.4, mid: 0.3, high: 0.2, level: 0.5, kick: 0, body: 0.6 };
const fakeRenderer = {
  ctx: { uniforms: new Proxy({}, { get: () => ({ value: 0.5 }) }) },
  model: { springs: { bass: { x: 0.3 }, mid: { x: 0.2 }, high: { x: 0.1 } }, stats: { rms: 0.05, maxAbs: 0.2 } },
};

test('every built-in preset has a "How it works" explanation', () => {
  const ids = ['instruments', 'spectrum', 'scope', 'stereo', 'morph', 'liquid-ribbons', 'spiral-elixir', 'polygon-pulse', 'star-tunnel', 'water', 'swirl', 'nebula', 'aurora'];
  for (const id of ids) assert.ok(EXPLAIN[id], `explanation for ${id}`);
  assert.equal(WARP_PRESETS.length, 17, 'one warp preset per reference look (the spirograph look is Alchemy)');
});

test('hand-written explanations: every formula typesets, every live value evaluates', () => {
  for (const [id, build] of Object.entries(EXPLAIN)) {
    const spec = build(() => ({ frame, drives, r: fakeRenderer }));
    assert.ok(spec.title && spec.summary && spec.steps.length, `${id} has title, summary, steps`);
    for (const s of spec.steps) {
      assert.ok(s.title && s.why, `${id}: step has title and plain-language reason`);
      for (const t of s.tex) typeset(t, `${id} / ${s.title}`);
      for (const [sym, meaning, value] of s.vars) {
        typeset(sym, `${id} / ${s.title} / symbol`);
        assert.ok(meaning.length > 0);
        assert.equal(typeof value(), 'string', `${id}: live value renders as text`);
      }
    }
  }
});

test('warp explanations are generated from the same numbers the shader receives', () => {
  const rng = mulberry32(3);
  for (const def of WARP_PRESETS) {
    assert.ok(SCHEMES[def.scheme], `${def.id}: scheme exists`);
    for (let i = 0; i < 20; i++) {
      const d = { bass: rng(), mid: rng(), high: rng(), level: rng(), kick: rng() < 0.2 ? 1 : 0, body: rng() };
      const live = computeWarp(def, d);
      for (const k of ['zoom', 'rot', 'sx', 'sy', 'dx', 'dy', 'swirl', 'noise', 'floor', 'sparkle']) assert.ok(Number.isFinite(live[k]), `${def.id}: ${k} finite`);
      assert.ok(live.half.every((h) => h > 0), `${def.id}: half-lives positive`);
      assert.ok(live.waves.every((w) => Number.isFinite(w.amp) && w.width > 0), `${def.id}: waves valid`);
    }
    const live = { ...computeWarp(def, drives), gain: 2, dt: 1 / 120 };
    const spec = explainWarp(def, () => live);
    for (const s of spec.steps) {
      for (const t of s.tex) typeset(t, `${def.id} / ${s.title}`);
      for (const [sym, , value] of s.vars) { typeset(sym, `${def.id} symbol`); assert.notEqual(value(), undefined); }
    }
    // the numbers quoted in the panel are exactly the shader's
    const zoomVar = spec.steps.flatMap((s) => s.vars).find(([sym]) => sym === 'z');
    if (zoomVar) assert.equal(zoomVar[2](), live.zoom.toFixed(2), `${def.id}: panel zoom = shader zoom`);
  }
});

test('mapping formulas are generated from the running specs and typeset', () => {
  for (const specs of [COMMON_MAPPINGS, MORPH_MAPPINGS]) {
    const set = new MappingSet(specs);
    for (const [name, m] of Object.entries(set.mappings)) typeset(mappingTex(name, m.spec), `mapping ${name}`);
  }
  const t = mappingTex('bass', { sources: [['lowPulse', 1], ['bass', 0.2]], release: 0.08 });
  assert.ok(t.includes('\\text{lowPulse}') && t.includes('0.20') && t.includes('80'), 'formula shows sources, weights and timing');
});

test('symmetry: the mirrored copies drawn on the CPU fold to the same point as the GPU fold', () => {
  const rng = mulberry32(9);
  for (const [sym, fold] of [['mirrorX', 4], ['mirrorY', 4], ['quad', 4], ['kaleido', 4], ['kaleido', 6]]) {
    const Ms = symmetryMatrices(sym, fold);
    assert.equal(Ms.length, { mirrorX: 2, mirrorY: 2, quad: 4, kaleido: 2 * fold }[sym], `${sym}: group size`);
    for (let i = 0; i < 200; i++) {
      const x = 2 * rng() - 1, y = 2 * rng() - 1, ref = foldPoint(x, y, sym, fold);
      for (const M of Ms) {
        const f = foldPoint(M[0] * x + M[1] * y, M[2] * x + M[3] * y, sym, fold);
        assert.ok(Math.hypot(f[0] - ref[0], f[1] - ref[1]) < 1e-9, `${sym}/${fold}: copy folds onto the same point`);
      }
    }
  }
});

test('per-channel decay explains the colours: fire, ice, uniform', () => {
  const copper = WARP_PRESETS.find((p) => p.id === 'copper-flame').warp;
  const [r1, g1, b1] = ageColour(copper.half, copper.floor, 0.25), [r2, g2, b2] = ageColour(copper.half, copper.floor, 1.8);
  assert.ok(r1 > g1 && g1 > b1, `after 0.25 s a white pixel is orange-yellow (${[r1, g1, b1].map((x) => x.toFixed(2))})`);
  assert.ok(r2 > 2.5 * g2 && b2 === 0, `after 1.8 s it is deep red, blue gone (${[r2, g2, b2].map((x) => x.toFixed(2))})`);
  assert.match(describeDecay([0.9, 0.38, 0.12]), /fire/);
  assert.match(describeDecay([0.25, 0.45, 0.9]), /ice/);
  assert.match(describeDecay([0.5, 0.5, 0.5]), /keep their colour/);
});

test('warp directions: what each sign does to the picture (the panel text depends on this)', async () => {
  const { warpSample } = await import('../src/renderer/engine/warp-model.mjs');
  const base = { rot: 0, sx: 0, sy: 0, zoom: 0, zoomExp: 0, dx: 0, dy: 0, swirl: 0 }, dt = 0.1;
  const [ax] = warpSample(0.5, 0, { ...base, sx: 1 }, dt);
  assert.ok(Math.abs(ax) < 0.5, 'sx > 0 samples nearer the axis ⇒ the picture spreads OUTWARD');
  const [zx, zy] = warpSample(0.3, 0.4, { ...base, zoom: 1 }, dt);
  assert.ok(Math.hypot(zx, zy) < 0.5, 'zoom > 0 ⇒ flies outward');
  const [, dyq] = warpSample(0, 0, { ...base, dy: 1 }, dt);
  assert.ok(dyq < 0, 'dy > 0 samples from below ⇒ the picture moves UP');
  const { explainWarp, WARP_PRESETS: P } = await import('../src/renderer/engine/warp-model.mjs');
  const text = JSON.stringify(explainWarp(P.find((p) => p.id === 'neon-waveline'), () => ({})).steps.map((s) => s.vars.map((v) => v[1])));
  assert.match(text, /> 0 spreads outward/, 'panel states the verified direction');
});

test('panel prose and tables contain no raw TeX', () => {
  for (const def of WARP_PRESETS) {
    const spec = explainWarp(def, () => ({ ...computeWarp(def, drives), gain: 1, dt: 1 / 60 }));
    for (const s of spec.steps) {
      assert.ok(!/\\[a-z]/.test(s.why), `${def.id}: prose has no TeX`);
      for (const [, meaning] of s.vars) assert.ok(!/\\[a-z]/.test(meaning), `${def.id}: "${meaning}" has no TeX`);
    }
  }
});
