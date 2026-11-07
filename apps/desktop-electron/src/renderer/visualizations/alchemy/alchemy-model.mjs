// Alchemy-inspired curves (pure maths, tested). Coordinates: y ∈ [−1, 1], x ∈ [−aspect, aspect].
import { sampleArray } from '../../engine/geometry2d.mjs';

/**
 * Closed Lissajous ribbon whose radius is shaped by the spectrum: walking along the curve
 * walks the spectrum low → high → low (mirrored so the curve closes without a seam), so the
 * ribbon literally bulges where the music has energy.
 *   x = r(s)·k_x·sin(a·2πs + φ₁),  y = r(s)·sin(b·2πs + φ₂),  r(s) = R·(1 + g·(spec(m(s)) − ½))
 * a, b integers ⇒ closed curve.
 */
export function lissajousRibbon(out, n, { a, b, phase1, phase2, radius, xScale, spec, specGain }) {
  let sumR = 0;
  for (let i = 0; i < n; i++) {
    const s = i / n, th = 2 * Math.PI * s;
    const m = s < 0.5 ? 2 * s : 2 - 2 * s;
    const r = radius * (1 + specGain * ((spec ? sampleArray(spec, m) : 0.5) - 0.5));
    out[2 * i] = r * xScale * Math.sin(a * th + phase1);
    out[2 * i + 1] = r * Math.sin(b * th + phase2);
    sumR += r;
  }
  return sumR / n;
}

/**
 * Logarithmic spiral arm r = r₀·e^{gθ}, θ ∈ [0, 2π·turns], with g chosen so it ends at rMax.
 * Half-width along the arm follows the spectrum (inner = bass … outer = treble).
 */
export function spiralArm(out, widths, n, { arm, arms, turns, r0, rMax, rotation, spec, baseWidth, specWidth }) {
  const span = 2 * Math.PI * turns, g = Math.log(rMax / r0) / span;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1), th = s * span, r = r0 * Math.exp(g * th);
    const ang = th + rotation + (2 * Math.PI * arm) / arms;
    out[2 * i] = r * Math.cos(ang); out[2 * i + 1] = r * Math.sin(ang);
    widths[i] = baseWidth * (0.3 + 0.7 * s) + specWidth * (spec ? sampleArray(spec, s) : 0) * Math.sin(Math.PI * Math.min(1, s * 1.2));
  }
}

/** Spectrum smoother on the audio clock: instant attack, exponential release (per band). */
export class SpectrumFollower {
  constructor(n, release = 0.15) { this.v = new Float32Array(n); this.release = release; }
  update(target01, dt) {
    const a = 1 - Math.exp(-dt / this.release);
    for (let i = 0; i < this.v.length && i < target01.length; i++) {
      const t = target01[i];
      this.v[i] = t > this.v[i] ? t : this.v[i] + a * (t - this.v[i]);
    }
    return this.v;
  }
}

// ---------------------------------------------------------------- v0.4 curve families
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * Point on a closed curve family at s ∈ [0, 1), scaled so the curve fits the unit disc.
 *   lissajous {a, b, phase}:  (sin(aθ + phase), sin(bθ)) / √2                      a, b integers
 *   rose {k}:                 r = cos(kθ)                                            k integer
 *   hypo {R, r, d}:  ((R−r)cos t + d cos((R−r)t/r), (R−r)sin t − d sin((R−r)t/r)) / (R−r+d)
 *   epi {R, r, d}:   ((R+r)cos t − d cos((R+r)t/r), (R+r)sin t − d sin((R+r)t/r)) / (R+r+d)
 * Spirograph curves close after t = 2π·r/gcd(R, r).
 */
export function curvePoint(family, p, s) {
  const th = 2 * Math.PI * s;
  switch (family) {
    case 'lissajous': return [Math.SQRT1_2 * Math.sin(p.a * th + p.phase), Math.SQRT1_2 * Math.sin(p.b * th)];
    case 'rose': { const r = Math.cos(p.k * th); return [r * Math.cos(th), r * Math.sin(th)]; }
    case 'hypo': {
      const t = th * p.r / gcd(p.R, p.r), q = (p.R - p.r) / p.r, n = p.R - p.r + p.d;
      return [((p.R - p.r) * Math.cos(t) + p.d * Math.cos(q * t)) / n, ((p.R - p.r) * Math.sin(t) - p.d * Math.sin(q * t)) / n];
    }
    case 'epi': {
      const t = th * p.r / gcd(p.R, p.r), q = (p.R + p.r) / p.r, n = p.R + p.r + p.d;
      return [((p.R + p.r) * Math.cos(t) - p.d * Math.cos(q * t)) / n, ((p.R + p.r) * Math.sin(t) - p.d * Math.sin(q * t)) / n];
    }
    default: throw new Error(`unknown curve family ${family}`);
  }
}

/**
 * Write a curve with audio modulation that cannot go jagged: a band-limited radial wobble
 *   ρ' = ρ·radius·(1 + Σ_{k=1..3} g_k·cos(2πk·s + ψ_k))
 * (only the first three Fourier terms along the curve), then rotation and horizontal stretch.
 * v0.3 shaped ribbons with the raw 48-band spectrum per point, which jittered (seen on your screen).
 */
export function writeCurve(out, n, family, params, { radius, xScale = 1, rotation = 0, wobble = [0, 0, 0], wobblePhase = [0, 0, 0] }) {
  const c = Math.cos(rotation), sn = Math.sin(rotation);
  for (let i = 0; i < n; i++) {
    const s = i / n;
    const [x, y] = curvePoint(family, params, s);
    let m = 1;
    for (let k = 0; k < 3; k++) m += wobble[k] * Math.cos(2 * Math.PI * (k + 1) * s + wobblePhase[k]);
    const X = x * radius * m, Y = y * radius * m;
    out[2 * i] = (X * c - Y * sn) * xScale;
    out[2 * i + 1] = X * sn + Y * c;
  }
}
