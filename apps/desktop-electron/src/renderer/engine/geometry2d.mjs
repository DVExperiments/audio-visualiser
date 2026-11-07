// 2D helpers shared by the Phase 3 collections. Pure maths: no Three.js, tested in node.

/**
 * Turn a polyline into a triangle strip of constant or per-point half-width.
 * points: Float32Array [x0,y0, x1,y1, ...] (n points). halfWidth: number or Float32Array(n).
 * Writes 2n vertices: position (x, y, 0), along (0..1 along the line) and edge (−1 / +1 across it).
 * Normals are the bisector of adjacent segments; joins are not mitred beyond 2× width (no spikes).
 */
export function writeStrip(points, n, halfWidth, closed, out) {
  const { position, along, edge } = out;
  for (let i = 0; i < n; i++) {
    const ip = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const inx = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    let tx = points[2 * inx] - points[2 * ip], ty = points[2 * inx + 1] - points[2 * ip + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    const w = typeof halfWidth === 'number' ? halfWidth : halfWidth[i];
    const x = points[2 * i], y = points[2 * i + 1];
    position[6 * i] = x + nx * w; position[6 * i + 1] = y + ny * w; position[6 * i + 2] = 0;
    position[6 * i + 3] = x - nx * w; position[6 * i + 4] = y - ny * w; position[6 * i + 5] = 0;
    const a = closed ? i / n : i / Math.max(1, n - 1);
    along[2 * i] = a; along[2 * i + 1] = a;
    edge[2 * i] = 1; edge[2 * i + 1] = -1;
  }
}

/** Index buffer for a strip of n points (closed strips also join the last segment to the first). */
export function stripIndex(n, closed) {
  const segs = closed ? n : n - 1, idx = new Uint32Array(segs * 6);
  for (let i = 0; i < segs; i++) {
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.set([a, a + 1, b, b, a + 1, b + 1], 6 * i);
  }
  return idx;
}

// ---- frame-rate independent feedback parameters ----
// Applying the per-frame factor for dt, N times, equals applying it once for N·dt — exactly —
// so trails persist for the same *time* at 60, 120 or 144 Hz.
/** Brightness kept after dt seconds for a trail half-life. */
export const decayFactor = (halfLife, dt) => Math.pow(0.5, dt / halfLife);
/** Image scale applied after dt seconds at a zoom rate (1/s): >0 expands outward. */
export const zoomFactor = (rate, dt) => Math.exp(rate * dt);

/** Normalise a dB spectrum into 0..1 for shaping geometry (floor −75 dB, 65 dB span). */
export function specTo01(db, out) {
  for (let i = 0; i < db.length; i++) out[i] = Math.max(0, Math.min(1, (db[i] + 75) / 65));
  return out;
}

/** Linear interpolation into an array at fractional position x ∈ [0, 1]. */
export function sampleArray(arr, x) {
  const f = Math.max(0, Math.min(1, x)) * (arr.length - 1), i = Math.floor(f), t = f - i;
  return i >= arr.length - 1 ? arr[arr.length - 1] : arr[i] * (1 - t) + arr[i + 1] * t;
}

/**
 * Fade toward TRUE black: the exact solution over dt of  dc/dt = −k·c − f,  k = ln2/halfLife,
 *   c(dt) = (c + f/k)·e^{−k·dt} − f/k, clamped at 0.
 * Exponential decay alone never reaches 0; in half-float buffers the residue survives and gamma
 * lifts it into a haze (v0.3 on your screen). The constant drain f empties a trail in finite time
 *   t* = ln(1 + c·k/f)/k,
 * and because each step is the exact ODE solution it is frame-rate independent.
 * Same maths as GLSL fadeToBlack() in feedback.mjs.
 */
export function fadeToBlack(c, halfLife, floorRate, dt) {
  const k = Math.LN2 / halfLife;
  if (floorRate <= 0) return c * Math.exp(-k * dt);
  const q = floorRate / k;
  return Math.max(0, (c + q) * Math.exp(-k * dt) - q);
}

/** Tukey (tapered cosine) window value at s ∈ [0,1]; taper = fraction at each end. */
export function tukey(s, taper) {
  if (s < taper) return 0.5 * (1 - Math.cos(Math.PI * s / taper));
  if (s > 1 - taper) return 0.5 * (1 - Math.cos(Math.PI * (1 - s) / taper));
  return 1;
}

/**
 * Oscilloscope wrapped around a circle: r(θ) = r0 + gain·w(θ)·tukey. The taper brings both ends
 * to r0, so the closed ring has no seam. wave: samples (oldest → newest).
 */
export function scopeCircle(out, n, wave, { r0, gain, rotation = 0, taper = 0.12 }) {
  const m = wave.length;
  for (let i = 0; i < n; i++) {
    const s = i / n, w = wave[Math.min(m - 1, Math.floor(s * m))] * tukey(s, taper);
    const r = r0 + gain * w, a = rotation + 2 * Math.PI * s;
    out[2 * i] = r * Math.cos(a); out[2 * i + 1] = r * Math.sin(a);
  }
}

/** Horizontal oscilloscope across [−halfSpan, halfSpan] at height y0, ends tapered to y0. */
export function scopeLine(out, n, wave, { halfSpan, y0 = 0, gain, taper = 0.08 }) {
  const m = wave.length;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    out[2 * i] = -halfSpan + 2 * halfSpan * s;
    out[2 * i + 1] = y0 + gain * wave[Math.min(m - 1, Math.floor(s * (m - 1)))] * tukey(s, taper);
  }
}

/** Display gain for scopes: aims the recent peak at `target`, never more than maxGain (silence stays flat). */
export class ScopeGain {
  constructor(target = 0.25, maxGain = 6) { this.target = target; this.maxGain = maxGain; this.peak = 0.05; }
  update(wave, dt) {
    let p = 0; for (let i = 0; i < wave.length; i++) p = Math.max(p, Math.abs(wave[i]));
    const a = p > this.peak ? 1 - Math.exp(-dt / 0.05) : 1 - Math.exp(-dt / 1.5);
    this.peak += a * (p - this.peak);
    return Math.min(this.maxGain, this.target / Math.max(this.peak, 1e-4));
  }
}
