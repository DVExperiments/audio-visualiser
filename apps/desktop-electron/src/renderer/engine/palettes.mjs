// Saturated 3-stop colour schemes (dark → vivid → hot), linear RGB. WMP-era visualisations
// tended to show one strong scheme at a time and change it occasionally, rather than cycling
// the whole hue wheel — v0.3's rainbow cosine palette read as pastel mush on real hardware.
export const SCHEMES = Object.freeze({
  electric: [[0.01, 0.04, 0.30], [0.05, 0.55, 1.00], [0.85, 0.95, 1.00]],
  magma:    [[0.30, 0.00, 0.40], [1.00, 0.08, 0.50], [1.00, 0.72, 0.15]],
  toxic:    [[0.00, 0.20, 0.04], [0.30, 1.00, 0.08], [0.95, 1.00, 0.40]],
  ice:      [[0.12, 0.03, 0.45], [0.50, 0.30, 1.00], [0.75, 0.95, 1.00]],
  inferno:  [[0.35, 0.00, 0.00], [1.00, 0.28, 0.00], [1.00, 0.88, 0.45]],
  aqua:     [[0.00, 0.12, 0.28], [0.00, 0.80, 0.72], [0.70, 1.00, 0.95]],
  violet:   [[0.10, 0.00, 0.25], [0.65, 0.10, 1.00], [1.00, 0.60, 0.95]],
  // v0.5 — for the wave-and-warp looks (the hot end is near-white, so per-channel decay paints the trail)
  flare:       [[0.50, 0.06, 0.00], [1.00, 0.60, 0.15], [1.00, 1.00, 1.00]],
  frost:       [[0.03, 0.10, 0.55], [0.30, 0.70, 1.00], [1.00, 1.00, 1.00]],
  rose:        [[0.45, 0.00, 0.20], [1.00, 0.25, 0.55], [1.00, 0.95, 1.00]],
  teal:        [[0.00, 0.25, 0.30], [0.20, 0.90, 0.95], [0.95, 1.00, 1.00]],
  ultraviolet: [[0.20, 0.00, 0.50], [0.65, 0.35, 1.00], [1.00, 0.92, 1.00]],
});
export const SCHEME_NAMES = Object.freeze(Object.keys(SCHEMES));

/** Write the blend of two schemes (m ∈ [0,1]) into three {x,y,z}-like targets. */
export function mixSchemes(a, b, m, out) {
  for (let i = 0; i < 3; i++) {
    const A = SCHEMES[a][i], B = SCHEMES[b][i];
    out[i].x = A[0] + (B[0] - A[0]) * m; out[i].y = A[1] + (B[1] - A[1]) * m; out[i].z = A[2] + (B[2] - A[2]) * m;
  }
  return out;
}

/** CPU twin of the GLSL grad(): triangle-wrapped position t → 3-stop gradient (for tests). */
export function gradient(stops, t) {
  const u = 1 - Math.abs(2 * (t - Math.floor(t)) - 1);          // 0→1→0 over one period: no seam
  const s = u * 2, i = Math.min(1, Math.floor(s)), f = s - i;
  return stops[i].map((c, k) => c + (stops[i + 1][k] - c) * f);
}
