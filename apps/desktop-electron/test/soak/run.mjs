// Long-session soak (v0.20) for the renderer-side pipeline, accelerated: N simulated hours of
// analysis frames through the feature store, mappings, music detector, automatic mode, and the
// Morph, swarm, VU and terrain models. Checks: heap flat after GC, every output finite.
// Run: npm run soak            (2 simulated hours)     node --expose-gc test/soak/run.mjs 8   (8 hours)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MappingSet } from '../../src/renderer/engine/mapping.mjs';
import { COMMON_MAPPINGS } from '../helpers/common-mappings.mjs';
import { MorphModel, DEFAULT_PARAMS, MORPH_MAPPINGS } from '../../src/renderer/visualizations/experimental/morph-model.mjs';
import { magnetState, SWARM_MAPPINGS } from '../../src/renderer/visualizations/experimental/swarm-model.mjs';
import { heightRow, RowHistory } from '../../src/renderer/visualizations/terrain/terrain-model.mjs';
const require = createRequire(import.meta.url);
const { FeatureStore } = require('../../src/renderer/lib/feature-store.js');
const U = require('../../src/renderer/lib/dsp-utils.js');
const AS = require('../../src/renderer/lib/auto-shuffle.js');

if (typeof global.gc !== 'function') { console.error('run with --expose-gc (npm run soak does)'); process.exit(2); }
const hours = Number(process.argv[2] ?? 2), FPS = 93.75, HOP = 1 / FPS, RENDER = 60;
const fixture = fs.readFileSync(new URL('../fixtures/densemix-frames.ndjson', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const store = new FeatureStore();
store.setAnalysis({ sr: 48000, hop: 512, fftSize: 2048, lowFftSize: 4096, bands: 48, logEdges: Array.from({ length: 49 }, (_, i) => 20 * 1000 ** (i / 48)) });
const maps = [new MappingSet(COMMON_MAPPINGS), new MappingSet(MORPH_MAPPINGS), new MappingSet(SWARM_MAPPINGS)];
const n = 600, dirs = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y); dirs.set([r * Math.cos(g * i), y, r * Math.sin(g * i)], 3 * i); }
const morph = new MorphModel(dirs, DEFAULT_PARAMS);
const detector = new AS.MusicalChangeDetector(), director = new AS.AutoDirector({ mode: 'music', minutes: 3 });
const needle = { x: 0, v: 0 }, mags = new Float32Array(40), terrain = new RowHistory(), row = new Float32Array(96);
let bad = 0, switches = 0, frames = 0, seq = 0;
const check = (v) => { if (!Number.isFinite(v)) bad++; };
const heap = [];
const t0 = Date.now();
console.log(`Soak: ${hours} simulated hours of analysis frames (${FPS}/s), rendered at ${RENDER} fps`);
console.log(' hour  heap MB  frames      auto switches  ×realtime');
for (let h = 1; h <= hours; h++) {
  const end = Math.round(h * 3600 * FPS); let acc = 0;
  while (frames < end) {
    const base = fixture[frames % fixture.length];
    // vary the music slowly (a level drift and a gap every ~4 minutes, like the end of a track)
    const gap = frames % 22500 < 90, drift = 6 * Math.sin(frames / 30000);
    const f = { ...base, seq: seq++, t: frames * HOP * 1000, silent: gap || base.silent, dbfs: base.dbfs.map((d) => (gap ? -120 : d + drift)),
      spec: Array.from({ length: 48 }, (_, i) => (gap ? -120 : -30 - i * 0.6 + drift + 4 * Math.sin(frames / 47 + i))),
      waveL: new Float32Array(512).fill(gap ? 0 : 0.1), waveR: new Float32Array(512).fill(gap ? 0 : 0.1) };
    store.push(f, frames * HOP * 1000);
    frames++; acc += HOP;
    if (acc >= 1 / RENDER) {           // a "render frame": consume and run every model, as the app does
      const tick = store.consume(Date.now());
      for (const fr of tick.frames) {
        for (const m of maps) { const v = m.apply(fr, HOP); for (const k in v) check(v[k]); }
        morph.stepFrame(maps[1].values, HOP);
        const e = detector.push(fr, HOP); const go = director.step(HOP, e, fr.onset);
        if (go) switches++;
        U.needleStep(needle, fr.silent ? 0 : Math.min(1.2, 0.708 * 10 ** ((fr.dbfs[0] + 12) / 20)), HOP); check(needle.x);
      }
      magnetState(frames * HOP, maps[2].values, mags); mags.forEach(check);
      terrain.step(heightRow(store.spectrum.values, row), acc);
      for (const k of ['bass', 'mid', 'high']) check(morph.termRms()[k] ?? 0);
      acc = 0;
    }
  }
  global.gc(); global.gc();
  const mb = process.memoryUsage().heapUsed / 1048576; heap.push(mb);
  console.log(` ${String(h).padStart(4)}  ${mb.toFixed(2).padStart(7)}  ${String(frames).padStart(9)}  ${String(switches).padStart(13)}  ${(h * 3600 / ((Date.now() - t0) / 1000)).toFixed(0).padStart(9)}`);
}
const growth = heap[heap.length - 1] - heap[0];
console.log(`Non-finite values: ${bad}; heap change after hour 1: ${growth >= 0 ? '+' : ''}${growth.toFixed(2)} MB; automatic switches: ${switches}`);
const ok = bad === 0 && Math.abs(growth) < 2;
console.log(ok ? 'SOAK PASSED' : 'SOAK FAILED');
process.exit(ok ? 0 : 1);
