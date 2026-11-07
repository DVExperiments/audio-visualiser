/* FeatureStore: the renderer's single source of audio truth. Every visualisation reads from it.
 * Frames are queued (bounded) as they arrive and consumed once per animation frame, so no onset
 * is lost even when several analysis frames arrive between two screen refreshes. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./dsp-utils.js') : root.DspUtils);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FeatureStore = api.FeatureStore;
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';
  const WAVE_LEN = 8192;
  const MAX_QUEUE = 64;

  class FeatureStore {
    constructor() {
      this.queue = [];
      this.droppedInRenderer = 0;
      this.frame = null;              // latest raw frame
      this.analysis = null;           // analysis config message
      this.waveL = new Float32Array(WAVE_LEN);
      this.waveR = new Float32Array(WAVE_LEN);
      this.waveWrite = 0;
      this.spectrum = new U.ArraySmoother(48, 0.012, 0.22, -120);
      this.spectrumPeak = new U.PeakHold(48, 1.0, 18, -120);
      this.bands = new U.ArraySmoother(7, 0.012, 0.22, -120);
      this.bandsNorm = new U.ArraySmoother(7, 0.010, 0.18, 0);
      this.rmsDb = new U.ArraySmoother(2, 0.010, 0.30, -120);
      this.peakDb = new U.PeakHold(2, 1.5, 20, -120);
      this.level = new U.Smoother(0.02, 0.4, 0);
      this.onsetEnvelope = 0;         // decays after each onset, for display
      this.onsetCount = 0;
      this.lastOnsetConfidence = 0;
      this.lastSeq = -1;
      this.seqGaps = 0;
      this.ages = [];                 // ms from capture-time estimate to render
      this.frameTimes = [];           // arrival times (performance.now) for measured frame rate
    }

    setAnalysis(a) {
      this.analysis = a;
      const n = a.logEdges.length - 1;
      this.spectrum = new U.ArraySmoother(n, 0.012, 0.22, -120);
      this.spectrumPeak = new U.PeakHold(n, 1.0, 18, -120);
    }

    push(frame, nowMs) {
      this.queue.push(frame);
      if (this.queue.length > MAX_QUEUE) { this.queue.shift(); this.droppedInRenderer++; }
      this.frameTimes.push(nowMs);
      while (this.frameTimes.length && nowMs - this.frameTimes[0] > 1000) this.frameTimes.shift();
    }

    get measuredFrameRate() { return this.frameTimes.length; }

    /** Consume queued frames. Returns {onsets, maxConfidence, frames} for this display frame. */
    consume(wallNowMs) {
      let onsets = 0, maxConfidence = 0;
      const frames = this.queue.slice();
      for (const f of this.queue) {
        const dt = this.analysis ? this.analysis.hop / this.analysis.sr : 512 / f.sr;
        if (this.lastSeq >= 0 && f.seq !== this.lastSeq + 1 && f.seq > this.lastSeq) this.seqGaps++;
        this.lastSeq = f.seq;
        for (let i = 0; i < f.waveL.length; i++) {
          this.waveL[this.waveWrite] = f.waveL[i];
          this.waveR[this.waveWrite] = f.waveR[i];
          this.waveWrite = (this.waveWrite + 1) % WAVE_LEN;
        }
        this.spectrumPeak.update(this.spectrum.update(f.spec, dt), dt);
        this.bands.update(f.bands, dt);
        this.bandsNorm.update(f.bandsNorm, dt);
        this.rmsDb.update([f.dbfs[0], f.dbfs[1]], dt);
        this.peakDb.update([20 * Math.log10(Math.max(f.peak[0], 1e-6)), 20 * Math.log10(Math.max(f.peak[1], 1e-6))], dt);
        this.level.update(f.level, dt);
        this.onsetEnvelope *= Math.exp(-dt / 0.12);
        if (f.onset.on) {
          onsets++; this.onsetCount++;
          this.lastOnsetConfidence = f.onset.confidence;
          maxConfidence = Math.max(maxConfidence, f.onset.confidence);
          this.onsetEnvelope = 1;
        }
        this.frame = f;
      }
      if (this.queue.length && this.frame) {
        this.ages.push(wallNowMs - this.frame.wall);
        if (this.ages.length > 240) this.ages.shift();
      }
      this.queue.length = 0;
      return { onsets, maxConfidence, frames };
    }

    /** Copy the most recent n samples (oldest first) into out arrays. */
    recentWave(n, outL, outR, endOffset = 0) {
      n = Math.min(n, WAVE_LEN - endOffset);
      let idx = (this.waveWrite - n - endOffset + 2 * WAVE_LEN) % WAVE_LEN;
      for (let i = 0; i < n; i++) { outL[i] = this.waveL[idx]; outR[i] = this.waveR[idx]; idx = (idx + 1) % WAVE_LEN; }
      return n;
    }

    latencyStats() {
      if (!this.ages.length) return null;
      return { median: U.percentile(this.ages, 0.5), p95: U.percentile(this.ages, 0.95) };
    }
  }

  return { FeatureStore, WAVE_LEN };
});
