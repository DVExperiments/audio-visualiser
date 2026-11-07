// Pure maths behind the psychedelic Alchemy presets (JS twins of shader formulas, for tests and
// the "How it works" panel).

/** Three-phase colour: c_k = ½ + ½cos(πv + 2πk/3 + 2πh). */
export function threePhase(v, hue = 0, gamma = 1) {
  return [0, 1, 2].map((k) => (0.5 + 0.5 * Math.cos(Math.PI * v + (2 * Math.PI * k) / 3 + 2 * Math.PI * hue)) ** gamma);
}

/**
 * Log-polar tunnel coordinates: u = ln r − travel, v = θ·arms/2π + spin + twist·u.
 * Doubling r adds ln 2 to u, so the picture at radius 2r equals the picture at r one "ln 2" of
 * travel later: the tunnel is self-similar, an endless zoom with no centre and no edge.
 */
export function tunnelCoords(x, y, { travel, spin, twist, arms }) {
  const r = Math.max(Math.hypot(x, y), 1e-6), th = Math.atan2(y, x);
  const u = Math.log(r) - travel;
  return [u, (th / (2 * Math.PI)) * arms + spin + twist * u];
}

/** Julia iteration count with smooth (continuous) escape, as in the shader. */
export function juliaSmooth(zx, zy, cx, cy, maxIter = 96) {
  let n = 0;
  for (; n < maxIter; n++) {
    const x = zx * zx - zy * zy + cx; zy = 2 * zx * zy + cy; zx = x;
    if (zx * zx + zy * zy > 256) return n + 1 - Math.log2(0.5 * Math.log2(zx * zx + zy * zy));
  }
  return Infinity;
}

/** Hue jumps on kicks, limited by the flash limiter and smoothed over ~80 ms (photosensitivity). */
export class HueDrift {
  constructor() { this.target = 0; this.value = 0; }
  step(rate, dt, jump = 0) {
    this.target += rate * dt + jump;
    this.value += (1 - Math.exp(-dt / 0.08)) * (this.target - this.value);
    return this.value;
  }
}
