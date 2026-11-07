/* Audio responsiveness calibration (v0.12): measure, then recommend input tuning.
 * Pure logic, loaded as a classic script (window.Calibration) and by node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calibration = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ gainDb: 0, noiseFloorDb: -70, pulseRangeDb: 8, smoothing: 1 });

  const pct = (sorted, p) => { if (!sorted.length) return NaN; const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

  /** Collects analysis frames during one calibration step. */
  class Recorder {
    constructor() { this.levels = []; this.peaks = []; this.flat = []; this.onsets = 0; this.seconds = 0; }
    push(f, hop) {
      this.seconds += hop;
      this.levels.push(f.dbfs[2]);
      this.peaks.push(20 * Math.log10(Math.max(1e-6, Math.max(f.peak[0], f.peak[1]))));
      if (!f.silent) this.flat.push(f.flatness);
      if (f.onset.on) this.onsets++;
    }
    /** Level percentiles (dBFS, as measured: includes the current input gain), dynamic range, crest, onset rate. */
    summary() {
      const L = [...this.levels].sort((a, b) => a - b), P = [...this.peaks].sort((a, b) => a - b), F = [...this.flat].sort((a, b) => a - b);
      const p10 = pct(L, 0.1), p50 = pct(L, 0.5), p95 = pct(L, 0.95);
      return { seconds: this.seconds, p10, p50, p95, dynamicRange: p95 - p10, crest: pct(P, 0.95) - p50, onsetRate: this.onsets / Math.max(this.seconds, 1e-9), flatness: F.length ? pct(F, 0.5) : 0 };
    }
  }

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const half = (x) => Math.round(x * 2) / 2;

  /**
   * Recommend tuning. kind: 'music' | 'mic'. typical: summary of normal sound; quiet: summary of a
   * quiet room (mic only). currentGainDb: the gain active while measuring (summaries include it).
   *   gain       = −20 dBFS − (typical median without gain), clamped to [−12, +30] dB
   *   noise floor = mic: quiet 95th percentile + 4 dB, at least 8 dB below the typical 10th percentile;
 *                 when the two cannot both hold (signal only ≲ 12 dB above the room), halfway between
   *                 music: −70 dBFS (gaps between tracks are digital silence)
   *   sensitivity = pulse range 3.5 + 0.5·(dynamic range) dB, in [5, 12]: compressed music → narrow
   *                 (more sensitive), wide-dynamics sound → broad
   *   smoothing   = 1.4× when onsets are very frequent (> 5/s), 1.6× for noise-like ambience with few
   *                 onsets, 0.85× for compressed music, else 1×
   */
  function recommend({ kind, typical, quiet = null, currentGainDb = 0 }) {
    const reasons = [];
    const rawP50 = typical.p50 - currentGainDb;
    const gainDb = clamp(Math.round(-20 - rawP50), -12, 30);
    reasons.push(`Typical level ${rawP50.toFixed(1)} dBFS before gain, so ${gainDb >= 0 ? '+' : ''}${gainDb} dB brings it to about −20 dBFS.`);
    const shift = gainDb - currentGainDb;                  // measured values move by this much under the new gain
    let noiseFloorDb = DEFAULTS.noiseFloorDb;
    if (kind === 'mic' && quiet) {
      const room = quiet.p95 + shift, softest = typical.p10 + shift, gap = softest - room;
      if (gap >= 12) {
        noiseFloorDb = clamp(Math.round(Math.min(room + 4, softest - 8)), -90, -30);
        reasons.push(`The quiet room measured ${room.toFixed(1)} dBFS after gain, so anything below ${noiseFloorDb} dBFS counts as silence (4 dB above the room, and at least 8 dB under the softest typical sound).`);
      } else {
        noiseFloorDb = clamp(Math.round((room + softest) / 2), -90, -30);
        reasons.push(`The softest typical sound is only ${gap.toFixed(1)} dB above the quiet room (${room.toFixed(1)} dBFS after gain), so the silence threshold sits halfway, at ${noiseFloorDb} dBFS. Moving the microphone closer to the sound would help.`);
      }
    } else reasons.push('Music: silence stays at −70 dBFS, since gaps between tracks are digital silence.');
    const dr = typical.dynamicRange;
    const pulseRangeDb = clamp(half(3.5 + 0.5 * dr), 5, 12);
    reasons.push(`Dynamic range ${dr.toFixed(1)} dB (95th − 10th percentile), so beat sensitivity uses a ${pulseRangeDb} dB pulse range${dr < 6 ? ': compressed sound needs a narrower range to show its beats' : dr > 14 ? ': wide dynamics need a broader range so loud moments do not saturate' : ''}.`);
    let smoothing = 1, why = 'onsets at an ordinary rate: standard smoothing';
    if (typical.onsetRate > 5) { smoothing = 1.4; why = `very frequent onsets (${typical.onsetRate.toFixed(1)}/s): a little extra smoothing keeps motion readable`; }
    else if (kind === 'mic' && typical.flatness > 0.3 && typical.onsetRate < 1) { smoothing = 1.6; why = 'noise-like ambient sound with few onsets: softer smoothing suits it'; }
    else if (dr < 6 && typical.onsetRate >= 1) { smoothing = 0.85; why = 'compressed music with a clear beat: slightly snappier response'; }
    reasons.push(`Smoothing ${smoothing}×: ${why}.`);
    return { gainDb, noiseFloorDb, pulseRangeDb, smoothing, reasons };
  }

  return { DEFAULTS, Recorder, recommend, pct };
});
