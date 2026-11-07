// Phosphor oscilloscope (v0.18): the pure beam model.
// An X/Y oscilloscope deflects the beam by the left (x) and right (y) channels. The beam spends
// 1/sr seconds travelling between consecutive samples, so a segment's brightness is
//   I = K·(1/sr) / max(length, w)        (w = beam width: a resting beam is a bright dot, not ∞)
// and the energy it deposits, I × length × width, is the same for every sample: fast strokes are
// dim, slow ones bright, exactly as on a real CRT (what makes "oscilloscope music" pictures read).

export const BEAM = Object.freeze({ width: 0.0035, halo: 2.5, k: 150, maxSegments: 8192, fill: 0.85, fastTau: 0.035, slowTau: 0.4, slowShare: 0.22 });

/** Brightness of one segment of `len` (screen units) at sample rate sr. */
export function segmentIntensity(len, sr) { return (BEAM.k / sr) / Math.max(len, BEAM.width); }

/**
 * Build quads for the beam through points (x[i], y[i]), i = 0…n (n segments; point 0 is the last
 * point of the previous frame, so frames join without a gap or a repeat).
 * out: { position: Float32Array(maxSeg·4·3), edge: Float32Array(maxSeg·4), inten: Float32Array(maxSeg·4) }
 * Returns the number of segments written. Each quad is widened by halo·w and extended by that at
 * both ends, so a resting beam still draws a round-ish dot.
 */
export function buildBeam(x, y, n, sr, out) {
  const hw = BEAM.halo * BEAM.width, m = Math.min(n, BEAM.maxSegments), start = n - m;
  for (let s = 0; s < m; s++) {
    const i = start + s, ax = x[i], ay = y[i], bx = x[i + 1], by = y[i + 1];
    let dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy);
    if (len > 1e-9) { dx /= len; dy /= len; } else { dx = 1; dy = 0; }
    const nx = -dy * hw, ny = dx * hw, ex = dx * hw, ey = dy * hw, I = segmentIntensity(len, sr), o = 12 * s;
    out.position.set([ax - ex + nx, ay - ey + ny, 0, ax - ex - nx, ay - ey - ny, 0, bx + ex + nx, by + ey + ny, 0, bx + ex - nx, by + ey - ny, 0], o);
    out.edge.set([1, -1, 1, -1], 4 * s);
    out.inten.set([I, I, I, I], 4 * s);
  }
  return m;
}

/** Index buffer: two triangles per quad. */
export function beamIndex(maxSeg = BEAM.maxSegments) {
  const idx = new Uint32Array(maxSeg * 6);
  for (let s = 0; s < maxSeg; s++) idx.set([4 * s, 4 * s + 1, 4 * s + 2, 4 * s + 1, 4 * s + 3, 4 * s + 2], 6 * s);
  return idx;
}

/** Auto-gain: the figure fills `fill` of the screen height; shrinks in 50 ms, grows over 1.5 s; ×1…×8. */
export function gainStep(gain, peak, dt) {
  const target = Math.min(8, Math.max(1, BEAM.fill / Math.max(peak, 1e-4)));
  // shrink almost at once (a loud figure must not overflow the screen: 0.15 s still clipped for ~0.3 s
  // in testing); grow slowly so quiet passages do not pump
  const tau = target < gain ? 0.05 : 1.5;
  return gain + (target - gain) * (1 - Math.exp(-dt / tau));
}
