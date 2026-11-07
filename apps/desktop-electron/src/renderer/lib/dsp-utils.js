/* Renderer-side signal helpers. Loaded as a classic script in the renderer (window.DspUtils)
 * and via require() in node tests. These only shape *display* ballistics; all analysis is done
 * in the native service. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DspUtils = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Same formula as the C# AttackReleaseSmoother: alpha = 1 - exp(-dt/tau). */
  class Smoother {
    constructor(attack, release, initial = 0) { this.attack = attack; this.release = release; this.value = initial; }
    update(target, dt) {
      if (!Number.isFinite(target) || !(dt > 0)) return this.value;
      const tau = target > this.value ? this.attack : this.release;
      const alpha = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      this.value += alpha * (target - this.value);
      return this.value;
    }
  }

  /** Smoother over an array of values (e.g. spectrum bands). */
  class ArraySmoother {
    constructor(n, attack, release, initial = 0) {
      this.attack = attack; this.release = release;
      this.values = new Float64Array(n).fill(initial);
    }
    update(targets, dt) {
      if (targets.length !== this.values.length) { this.values = Float64Array.from(targets); return this.values; }
      if (!(dt > 0)) return this.values;
      const aA = this.attack <= 0 ? 1 : 1 - Math.exp(-dt / this.attack);
      const aR = this.release <= 0 ? 1 : 1 - Math.exp(-dt / this.release);
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]; if (!Number.isFinite(t)) continue;
        const v = this.values[i];
        this.values[i] = v + (t > v ? aA : aR) * (t - v);
      }
      return this.values;
    }
  }

  /** Peak hold: jumps to new maxima, holds for holdSeconds, then falls at fallPerSecond (units/s). */
  class PeakHold {
    constructor(n, holdSeconds = 1.0, fallPerSecond = 20, floor = -120) {
      this.hold = holdSeconds; this.fall = fallPerSecond; this.floor = floor;
      this.values = new Float64Array(n).fill(floor);
      this.age = new Float64Array(n);
    }
    update(current, dt) {
      if (current.length !== this.values.length) { this.values = new Float64Array(current.length).fill(this.floor); this.age = new Float64Array(current.length); }
      for (let i = 0; i < current.length; i++) {
        const c = current[i];
        if (c >= this.values[i]) { this.values[i] = c; this.age[i] = 0; }
        else {
          this.age[i] += dt;
          if (this.age[i] > this.hold) this.values[i] = Math.max(c, this.floor, this.values[i] - this.fall * dt);
        }
      }
      return this.values;
    }
  }

  /**
   * Photosensitivity guard. When limited: at most 3 flashes per second (WCAG 2.3.1 general
   * flash threshold) and flash intensity scaled to maxIntensity.
   */
  class FlashLimiter {
    constructor() { this.limited = true; this.maxIntensity = 0.35; this.lastFlashAt = -Infinity; }
    request(nowSeconds, intensity) {
      if (!this.limited) { this.lastFlashAt = nowSeconds; return Math.max(0, Math.min(1, intensity)); }
      if (nowSeconds - this.lastFlashAt < 1 / 3) return 0;
      this.lastFlashAt = nowSeconds;
      return Math.max(0, Math.min(this.maxIntensity, intensity * this.maxIntensity));
    }
  }

  /** Map dB to 0..1 between lo and hi. */
  function dbTo01(db, lo, hi) { return Math.max(0, Math.min(1, (db - lo) / (hi - lo))); }

  /** Percentile of a numeric array (linear interpolation), p in [0,1]. */
  function percentile(values, p) {
    if (!values.length) return NaN;
    const s = Array.from(values).sort((a, b) => a - b);
    const idx = (s.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  }

  /**
   * Catmull-Rom interpolation of evenly spaced samples at fractional index x (ends clamped).
   * Passes exactly through every sample; between samples it is a smooth cubic. Used to draw more
   * bars than there are measured bands (the bands are evenly spaced in log-frequency).
   */
  function catmullRom(arr, x) {
    const n = arr.length, xc = Math.max(0, Math.min(n - 1, x)), i = Math.min(n - 2, Math.floor(xc)), t = xc - i;
    const p0 = arr[Math.max(0, i - 1)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(n - 1, i + 2)];
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  /**
   * Peak caps: each peak jumps up to the value, holds `hold` seconds, then falls at `fall` per second
   * (never below the value). Frame-rate independent. peaks/holds are updated in place.
   */
  function peakCapStep(values, peaks, holds, dt, hold = 0.35, fall = 0.8) {
    for (let i = 0; i < values.length; i++) {
      if (values[i] >= peaks[i]) { peaks[i] = values[i]; holds[i] = hold; }
      else if (holds[i] > 0) holds[i] = Math.max(0, holds[i] - dt);
      else peaks[i] = Math.max(values[i], peaks[i] - fall * dt);
    }
  }

  /**
   * Fixed-interval snapshot history (ridgeline): a snapshot is stored every `interval` seconds of
   * elapsed time, however the frames fall; `phase` ∈ [0, 1) is the progress towards the next one,
   * for smooth scrolling. line(a) returns the snapshot a steps old (0 = newest).
   */
  class SnapshotHistory {
    constructor(count, size, interval) {
      this.count = count; this.interval = interval; this.acc = 0; this.head = -1; this.filled = 0;
      this.buf = Array.from({ length: count }, () => new Float32Array(size));
    }
    step(values, dt) {
      this.acc += dt;
      while (this.acc >= this.interval) {
        this.acc -= this.interval;
        this.head = (this.head + 1) % this.count;
        this.buf[this.head].set(values);
        this.filled = Math.min(this.count, this.filled + 1);
      }
    }
    get phase() { return this.acc / this.interval; }
    line(a) { return a < this.filled ? this.buf[(this.head - a + this.count) % this.count] : null; }
  }

  /**
   * VU-meter needle (IEC 60268-17 ballistics): a damped second-order system that reaches 99 % of a
   * step in 300 ms with 1.25 % overshoot (spec: 1–1.5 %). ζ = −ln(0.0125)/√(π² + ln²0.0125) = 0.8127;
   * ω₀ = 13.512 rad/s solved numerically for t₉₉ = 300 ms. Advanced by the EXACT solution for a
   * constant target over h, so the motion does not depend on the step (or sample rate).
   */
  const VU_BALLISTICS = Object.freeze({ zeta: 0.8127, w0: 13.512 });
  function needleStep(state, target, h, { zeta, w0 } = VU_BALLISTICS) {
    const y = state.x - target, v = state.v, wd = w0 * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * w0 * h), c = Math.cos(wd * h), s = Math.sin(wd * h);
    state.x = target + e * (y * c + ((v + zeta * w0 * y) / wd) * s);
    state.v = e * (v * c - ((w0 * w0 * y + zeta * w0 * v) / wd) * s);
    return state;
  }

  return { Smoother, ArraySmoother, PeakHold, FlashLimiter, dbTo01, percentile, catmullRom, peakCapStep, SnapshotHistory, VU_BALLISTICS, needleStep };
});
