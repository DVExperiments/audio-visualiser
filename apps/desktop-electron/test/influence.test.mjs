import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Mapping, MappingSet, influenceScales } from '../src/renderer/engine/mapping.mjs';
import { MorphModel, DEFAULT_PARAMS, MORPH_MAPPINGS } from '../src/renderer/visualizations/experimental/morph-model.mjs';
const require = createRequire(import.meta.url);
const { Recorder, recommend } = require('../src/renderer/lib/calibration.js');
const { validateTuneRequest, parseServiceLine } = require('../src/main/protocol.js');
const { sanitize } = require('../src/main/settings.js');

const HOP = 512 / 48000;
const fr = (o = {}) => ({ level: o.level ?? 0.5, bandsNorm: o.bands ?? [0.6, 0.6, 0.5, 0.5, 0.4, 0.4, 0.3], bandsPulse: o.pulses ?? [0.8, 0.8, 0.5, 0.5, 0.4, 0.4, 0.3], levelPulse: 0.5, silent: false,
  onset: { on: !!o.onset, confidence: 0.8 }, centroid: 2000, flatness: o.flatness ?? 0.1, balance: o.balance ?? 0, correlation: 1, width: 0, dbfs: [o.db ?? -20, o.db ?? -20, o.db ?? -20], peak: [o.peak ?? 0.3, o.peak ?? 0.3] });

// ---------------- influence
test('influence scales a drive around its rest value; 1 is unchanged; the smoother is unaffected', () => {
  const set = new MappingSet({ bass: { sources: [['lowPulse', 1]], offset: 0.04, min: 0, max: 1 }, hue: { sources: [['centroid', 1]] } });
  const plain = { ...set.apply(fr(), HOP) };
  const sc = new MappingSet({ bass: { sources: [['lowPulse', 1]], offset: 0.04, min: 0, max: 1 }, hue: { sources: [['centroid', 1]] } });
  const half = sc.apply(fr(), HOP, { scales: { bass: 0.5 } });
  assert.ok(Math.abs(half.bass - (0.04 + 0.5 * (plain.bass - 0.04))) < 1e-12, 'v′ = rest + g·(v − rest)');
  assert.equal(half.hue, plain.hue, 'unscaled drives untouched');
  const dbl = sc.apply(fr(), HOP, { scales: { bass: 2 } });
  assert.ok(dbl.bass > 1 && dbl.bass <= 2, `g = 2 may exceed max (to ${dbl.bass.toFixed(2)})`);
  assert.equal(sc.apply(fr(), HOP, { scales: { bass: 1 } }).bass, plain.bass, 'g = 1 identical; scaling never fed back into the smoother');
  const zero = sc.apply(fr(), HOP, { scales: { bass: 0 } });
  assert.ok(Math.abs(zero.bass - 0.04) < 1e-12, 'g = 0 holds the rest value (no audio influence)');
});

test('smoothing factor scales attack/release time constants', () => {
  const a = new Mapping({ sources: [['level', 1]], attack: 0.1 }), b = new Mapping({ sources: [['level', 1]], attack: 0.1 });
  a.apply(fr({ level: 1 }), 0.1); b.apply(fr({ level: 1 }), 0.1, 2);
  assert.ok(Math.abs(a.value - (1 - Math.exp(-1))) < 1e-12 && Math.abs(b.value - (1 - Math.exp(-0.5))) < 1e-12, 'τ doubled');
});

test('Morph: Sound → shape changes the geometry, and only shape drives (colour drives scale separately)', () => {
  const n = 1500, d = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y); d.set([r * Math.cos(g * i), y, r * Math.sqrt(1) * Math.sin(g * i)], 3 * i); }
  const roles = { shape: ['bass', 'mid', 'high', 'asym', 'kick'], colour: ['glow', 'hue'] };
  const run = (inf) => {
    const m = new MorphModel(d, DEFAULT_PARAMS), maps = new MappingSet(MORPH_MAPPINGS); let v;
    for (let i = 0; i < 300; i++) { v = maps.apply(fr({ pulses: i % 45 < 5 ? [1, 1, 0.6, 0.6, 0.5, 0.5, 0.4] : [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] }), HOP, { scales: influenceScales(inf, roles) }); m.stepFrame(v, HOP); }
    return { rms: m.termRms().bass, glow: v.glow };
  };
  const base = run({ shape: 1, motion: 1, colour: 1 }), strong = run({ shape: 2, motion: 1, colour: 0.4 }), gentle = run({ shape: 0.3, motion: 1, colour: 2 });
  console.log(`  bass deformation rms: shape 0.3 → ${gentle.rms.toFixed(4)}, 1 → ${base.rms.toFixed(4)}, 2 → ${strong.rms.toFixed(4)}; glow drive: colour 0.4 → ${strong.glow.toFixed(2)}, 2 → ${gentle.glow.toFixed(2)}`);
  assert.ok(gentle.rms < base.rms && base.rms < strong.rms, 'deformation follows Sound → shape');
  assert.ok(strong.glow < gentle.glow, 'glow follows Colour intensity, independently');
});

// ---------------- calibration
function summary(kind) {
  const r = new Recorder(); let i = 0;
  const gen = { quietMic: () => fr({ db: -68 + Math.sin(i) * 1.5, peak: 0.0008 }), mic: () => fr({ db: -52 + 6 * Math.sin(i / 40), peak: 0.01, flatness: 0.45, onset: i % 400 === 0 }),
    compressed: () => fr({ db: -9 + 1.5 * Math.sin(i / 10), peak: 0.9, onset: i % 45 === 0 }), dynamic: () => fr({ db: -30 + 10 * Math.sin(i / 60), peak: 0.3, onset: i % 90 === 0 }) }[kind];
  for (i = 0; i < 940; i++) r.push(gen(), HOP);
  return r.summary();
}

test('calibration: a quiet microphone gets gain and a noise floor above the room', () => {
  const rec = recommend({ kind: 'mic', typical: summary('mic'), quiet: summary('quietMic') });
  console.log(`  quiet mic → gain ${rec.gainDb} dB, noise floor ${rec.noiseFloorDb} dBFS, range ${rec.pulseRangeDb} dB, smoothing ${rec.smoothing}×`);
  assert.ok(rec.gainDb >= 25, 'large gain for a −52 dBFS microphone');
  const roomAfter = summary('quietMic').p95 + rec.gainDb, softAfter = summary('mic').p10 + rec.gainDb;
  // low signal-to-noise here (≈ 9 dB): the threshold must sit clearly between room noise and the softest sound
  assert.ok(rec.noiseFloorDb > roomAfter + 3 && rec.noiseFloorDb < softAfter - 3, `between room (${roomAfter.toFixed(1)}) and softest sound (${softAfter.toFixed(1)}): ${rec.noiseFloorDb}`);
  assert.match(rec.reasons[1], /halfway/, 'the compromise is explained');
  assert.equal(rec.smoothing, 1.6, 'noise-like ambience with few onsets → softer smoothing');
  assert.ok(rec.reasons.length === 4 && rec.reasons.every((s) => s.length > 20), 'every recommendation explained');
});

test('calibration: compressed music → attenuation, narrow (sensitive) pulse range, snappier response', () => {
  const rec = recommend({ kind: 'music', typical: summary('compressed') });
  console.log(`  compressed music → gain ${rec.gainDb} dB, range ${rec.pulseRangeDb} dB, smoothing ${rec.smoothing}×`);
  assert.ok(rec.gainDb <= -9, 'loud master turned down toward −20 dBFS');
  assert.equal(rec.noiseFloorDb, -70);
  assert.ok(rec.pulseRangeDb <= 6, 'compressed → narrow range');
  assert.equal(rec.smoothing, 0.85);
});

test('calibration: wide dynamics → broad pulse range; existing gain is accounted for', () => {
  const s = summary('dynamic'), rec = recommend({ kind: 'music', typical: s });
  assert.ok(rec.pulseRangeDb >= 12 - 1e-9, `wide dynamics (${s.dynamicRange.toFixed(1)} dB) → broad range`);
  const withGain = recommend({ kind: 'music', typical: { ...s, p50: s.p50 + 10 }, currentGainDb: 10 });
  assert.equal(withGain.gainDb, rec.gainDb, 'measurement taken through +10 dB of gain gives the same recommendation');
});

// ---------------- plumbing
test('tune requests are validated; tuning acknowledgements accepted; profiles sanitised (settings v3)', () => {
  assert.deepEqual(validateTuneRequest({ gainDb: 12, silenceDb: -55, pulseRangeDb: 6 }), { cmd: 'tune', gainDb: 12, silenceDb: -55, pulseRangeDb: 6 });
  assert.equal(validateTuneRequest({ gainDb: 99, silenceDb: -55, pulseRangeDb: 6 }), null);
  assert.equal(validateTuneRequest({ gainDb: '1', silenceDb: -55, pulseRangeDb: 6 }), null);
  assert.ok(parseServiceLine('{"type":"tuning","gainDb":12,"silenceDb":-55,"pulseRangeDb":6}'));
  const s = sanitize({ influence: { shape: 9, motion: -1, colour: 0.5 }, audio: { profiles: { 'input:{0.0.1.00000000}.{abc-123}': { gainDb: 28, noiseFloorDb: -40, pulseRangeDb: 7, smoothing: 1.6 }, 'evil:x': {}, 'loopback:default': { gainDb: 'x' } } } });
  assert.deepEqual(s.influence, { shape: 2, motion: 0, colour: 0.5 });
  assert.deepEqual(s.audio.profiles['input:{0.0.1.00000000}.{abc-123}'], { gainDb: 28, noiseFloorDb: -40, pulseRangeDb: 7, smoothing: 1.6 });
  assert.equal(s.audio.profiles['evil:x'], undefined);
  assert.deepEqual(s.audio.profiles['loopback:default'], { gainDb: 0, noiseFloorDb: -70, pulseRangeDb: 8, smoothing: 1 });
});
