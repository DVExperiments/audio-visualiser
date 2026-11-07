// Reactivity on realistic music, using frames recorded from the real C# service playing the
// "denseMix" test signal (sustained bass line, chords, hi-hat bed, kicks at 124 BPM, soft-clipped).
// Regenerate: start the service with {"cmd":"start","source":"synthetic","signal":"denseMix"}, keep
// frames from t > 1.5 s, drop waveL/waveR/spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MappingSet } from '../src/renderer/engine/mapping.mjs';
import { MorphModel, DEFAULT_PARAMS, MORPH_MAPPINGS } from '../src/renderer/visualizations/experimental/morph-model.mjs';

const frames = fs.readFileSync(new URL('./fixtures/densemix-frames.ndjson', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const HOP = 512 / 48000, BEAT = 60 / 124;

// Morph's v0.2 mappings, kept here as the baseline the fix is measured against
const V02 = {
  ...MORPH_MAPPINGS,
  bass: { sources: [['subBass', 0.45], ['bass', 0.55]], curve: 'smoothstep', offset: 0.06, min: 0, max: 1 },
  mid: { sources: [['lowMid', 0.4], ['mid', 0.6]], curve: 'linear', offset: 0.06, min: 0, max: 1 },
  high: { sources: [['upperMid', 0.3], ['presence', 0.4], ['brilliance', 0.3]], curve: 'sqrt', threshold: 0.05, offset: 0.04, min: 0, max: 1 },
  glow: { sources: [['level', 1]], curve: 'smoothstep', attack: 0.03, release: 0.45 },
};
const V02_SPRINGS = { ...DEFAULT_PARAMS.springs, bass: { freqHz: 2.0, zeta: 0.30, min: -0.5, max: 1.15 }, mid: { freqHz: 3.5, zeta: 0.40, min: -0.5, max: 1.2 }, high: { freqHz: 7.0, zeta: 0.60, min: -0.5, max: 1.2 } };

function sphere(n) {
  const d = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y); d.set([r * Math.cos(g * i), y, r * Math.sin(g * i)], 3 * i); }
  return d;
}

function run(mappings, params) {
  const model = new MorphModel(sphere(1500), params), maps = new MappingSet(mappings);
  const series = [];
  for (const f of frames) {
    const v = maps.apply(f, HOP);
    model.stepFrame(v, HOP);
    const tSig = ((f.seq + 1) * 512) / 48000;                // synthetic source time of the frame's last sample
    series.push({ phase: (tSig % BEAT) / BEAT, drive: { ...v }, bass: model.termRms().bass, glow: v.glow });
  }
  return series.slice(150);                                    // let springs and smoothers settle
}

const stats = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return { mean: m, std: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }; };
/** Beat contrast: mean in the 0–25 % of each beat after the kick minus mean in 50–90 %. */
function contrast(series, get) {
  const on = series.filter((s) => s.phase < 0.25).map(get), off = series.filter((s) => s.phase > 0.5 && s.phase < 0.9).map(get);
  return stats(on).mean - stats(off).mean;
}

test('reactivity on dense music: drives are no longer pinned, and motion follows the beat', () => {
  const old = run(V02, { ...DEFAULT_PARAMS, springs: V02_SPRINGS, kick: { bass: 3.0, mid: 4.0, particles: 220 } });
  const now = run(MORPH_MAPPINGS, DEFAULT_PARAMS);
  const r = (s) => ({
    bassDrive: stats(s.map((x) => x.drive.bass)), highDrive: stats(s.map((x) => x.drive.high)),
    deform: stats(s.map((x) => x.bass)), contrast: contrast(s, (x) => x.bass), glowContrast: contrast(s, (x) => x.glow),
  });
  const a = r(old), b = r(now);
  const f = (o) => `bass drive ${o.bassDrive.mean.toFixed(2)}±${o.bassDrive.std.toFixed(2)}, high drive ${o.highDrive.mean.toFixed(2)}±${o.highDrive.std.toFixed(2)}, bass deformation ${o.deform.mean.toFixed(3)}±${o.deform.std.toFixed(3)}, beat contrast ${o.contrast.toFixed(3)}, glow contrast ${o.glowContrast.toFixed(2)}`;
  console.log(`  v0.2: ${f(a)}\n  v0.3: ${f(b)}`);
  assert.ok(a.bassDrive.mean > 0.8, 'baseline reproduces the pinned v0.2 behaviour');
  assert.ok(b.bassDrive.std > 3 * a.bassDrive.std, 'bass drive swings at least 3× more');
  assert.ok(b.deform.std > 2 * a.deform.std, 'deformation varies at least 2× more over time');
  assert.ok(b.contrast > 3 * Math.max(a.contrast, 1e-3), 'deformation is much larger just after kicks than between them');
  assert.ok(b.glowContrast > 0.15, 'brightness pulses with the beat');
});
