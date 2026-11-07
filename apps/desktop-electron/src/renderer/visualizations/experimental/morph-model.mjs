// Morph: a sphere whose surface is physically pushed around by the sound.
// Pure maths, no rendering — the same code is exercised by the tests and drawn by morph.mjs.
//
// Surface: p'(v) = p(v) · (R + D(v, t)), p(v) a unit direction (purely radial displacement).
//
// D = A_b·x_b·[0.55·Im((x+iz)^2 e^{iψ_b}) + 0.45·P2(y)·cos ψ_z]       bass: rotating elongation + squash/stretch
//   + A_m·x_m·(1/√N_m) Σ_j sin(k_m d_j·p + ψ_j)                      mids: travelling plane-wave field
//   + A_h·x_h·(1/√N_h) Σ_j sin(k_h d_j·p + ψ_j)                      highs: fine surface ripples
//   + A_s·x_s·x                                                       stereo balance → lean left/right
//   + A_br·sin(2π·0.12·t) + A_sw·max(0, x_b)                          breathing (alive in silence) + kick swell
//
// Im((x+iz)^m e^{iψ}) = sin^mφ·sin(mθ+ψ) is the l = m spherical harmonic shape: the brief's
// sin(mθ+ωt) term made smooth at the poles (the plain angular form has a cusp there). m = 2 is
// used for bass rather than the brief's m = 3: three equatorial lobes are seen almost edge-on by
// an orbiting camera (measured: 20 % displacement still read as a round blob), while m = 2
// stretches the silhouette itself, so a bass note visibly turns the sphere into a rotating egg.
// The wave fields are normalised by 1/√N so their typical RMS is ≈ 0.71 whatever N is (random
// phases add in power); their hard bound is therefore √N. With the spring clamps,
//   |D| ≤ maxDisplacement() = Σ A_i·bound_i·max|x_i| ≤ 0.85R
// so the radius never drops below 0.15R: a radial function r(p) > 0 describes a star-shaped
// surface, which cannot self-intersect. Phases ψ are integrated (not ω·t) so speed changes
// never cause jumps.
//
// Every term is (time-varying coefficient) × (static per-vertex basis), so the per-vertex
// trigonometry is done once at build time; each frame is a 37-term linear combination.
//
// Dynamics: each amplitude x is a mass–spring–damper  x'' + 2ζω₀x' + ω₀²(x − target) = 0,
// driven by its mapped audio target, kicked by onsets, and advanced by its EXACT solution over each
// step (v0.9; was semi-implicit Euler). The target is constant within a step, so the equation is
// linear with a closed-form solution: no integration error, no stability limit, and results that
// do not depend on the step size (which varies with the device's sample rate). The simulation advances by exactly one analysis hop per analysis
// frame, so its state depends only on the audio frames — not on the display's refresh rate.

import { mulberry32 } from '../../engine/mapping.mjs';

export const SIM_MAX_STEP = 1 / 240;

export class Spring {
  constructor({ freqHz, zeta, min = -Infinity, max = Infinity }) {
    this.w0 = 2 * Math.PI * freqHz; this.zeta = zeta; this.min = min; this.max = max;
    this.x = 0; this.v = 0;
  }
  /** Exact solution of x'' + 2ζω₀x' + ω₀²(x − target) = 0 over h (under-, critically or over-damped). */
  step(target, h) {
    const w = this.w0, z = this.zeta, y = this.x - target, v = this.v;
    let yh, vh;
    if (Math.abs(z - 1) < 1e-9) {                              // critical: (A + Bt)e^{−ωt}
      const B = v + w * y, e = Math.exp(-w * h);
      yh = (y + B * h) * e; vh = (v - w * B * h) * e;
    } else if (z < 1) {                                        // under-damped: decaying oscillation
      const wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * h), c = Math.cos(wd * h), s = Math.sin(wd * h);
      yh = e * (y * c + ((v + z * w * y) / wd) * s);
      vh = e * (v * c - ((w * w * y + z * w * v) / wd) * s);
    } else {                                                   // over-damped: two decaying exponentials
      const q = Math.sqrt(z * z - 1), r1 = -w * (z - q), r2 = -w * (z + q);
      const c1 = (v - r2 * y) / (r1 - r2), c2 = y - c1, e1 = Math.exp(r1 * h), e2 = Math.exp(r2 * h);
      yh = c1 * e1 + c2 * e2; vh = c1 * r1 * e1 + c2 * r2 * e2;
    }
    this.x = target + yh; this.v = vh;
    if (this.x > this.max) { this.x = this.max; if (this.v > 0) this.v = 0; }
    if (this.x < this.min) { this.x = this.min; if (this.v < 0) this.v = 0; }
  }
  impulse(dv) { this.v += dv; }
}

/** Unit directions on a sphere, uniformly distributed (seeded). */
function randomDirections(n, rng) {
  const d = [];
  for (let i = 0; i < n; i++) {
    const z = 2 * rng() - 1, a = 2 * Math.PI * rng(), r = Math.sqrt(1 - z * z);
    d.push([r * Math.cos(a), z, r * Math.sin(a)]);
  }
  return d;
}

export const DEFAULT_PARAMS = Object.freeze({
  seed: 20260705,
  radius: 1,
  amp: { bass: 0.34, mid: 0.07, high: 0.03, asym: 0.06, breathe: 0.01, swell: 0.048 },
  springs: {
    bass: { freqHz: 3.0, zeta: 0.28, min: -0.5, max: 1.15 },
    mid:  { freqHz: 4.5, zeta: 0.35, min: -0.5, max: 1.2 },
    high: { freqHz: 8.0, zeta: 0.50, min: -0.5, max: 1.2 },
    asym: { freqHz: 0.8, zeta: 1.00, min: -1.2, max: 1.2 },
  },
  waves: { midCount: 6, midK: 7, highCount: 10, highK: 19 },
  speeds: { bass: 0.7, zonal: 0.45, wave: 0.9 },   // rad/s at drive 0; scaled by (0.4 + 1.6·drive)
  kick: { bass: 4.0, mid: 5.0, particles: 220 },
  particles: { pool: 3000, speed: 1.6, drag: 1.2, life: 1.6 },
});

export class MorphModel {
  /** dirs: Float32Array of unit vectors (x, y, z per vertex). */
  constructor(dirs, params = DEFAULT_PARAMS) {
    this.p = params;
    this.n = dirs.length / 3;
    this.dirs = dirs;
    const rng = mulberry32(params.seed);
    this.midDirs = randomDirections(params.waves.midCount, rng);
    this.highDirs = randomDirections(params.waves.highCount, rng);
    this.midPhase = this.midDirs.map(() => 2 * Math.PI * rng());
    this.highPhase = this.highDirs.map(() => 2 * Math.PI * rng());
    this.midRate = this.midDirs.map(() => 0.6 + 0.8 * rng());
    this.highRate = this.highDirs.map(() => 0.6 + 0.8 * rng());
    this.psiBass = 0; this.psiZonal = 0;
    this.time = 0;
    this.springs = Object.fromEntries(Object.entries(params.springs).map(([k, s]) => [k, new Spring(s)]));
    this.particles = new Particles(params.particles, mulberry32(params.seed ^ 0x5bd1e995));
    this.buildBasis();
    this.coef = new Float64Array(this.nBasis);
    this.stats = { rms: 0, maxAbs: 0, minRadius: params.radius };
  }

  buildBasis() {
    const { midCount, midK, highCount, highK } = this.p.waves;
    // order: [Re z², Im z², P2, mid sin/cos ×count, high sin/cos ×count, x, 1]
    this.nBasis = 3 + 2 * midCount + 2 * highCount + 2;
    const n = this.n, B = new Float32Array(this.nBasis * n);
    for (let v = 0; v < n; v++) {
      const x = this.dirs[3 * v], y = this.dirs[3 * v + 1], z = this.dirs[3 * v + 2];
      // (x + iz)^2 = (x² − z²) + i·2xz
      B[0 * n + v] = x * x - z * z;
      B[1 * n + v] = 2 * x * z;
      B[2 * n + v] = 0.5 * (3 * y * y - 1);
      let j = 3;
      for (const [dirsArr, k] of [[this.midDirs, midK], [this.highDirs, highK]]) {
        for (const d of dirsArr) {
          const a = k * (d[0] * x + d[1] * y + d[2] * z);
          B[j++ * n + v] = Math.sin(a);
          B[j++ * n + v] = Math.cos(a);
        }
      }
      B[j++ * n + v] = x;
      B[j * n + v] = 1;
    }
    this.basis = B;
  }

  /** Bound on |D| implied by amplitudes and spring clamps. */
  maxDisplacement() {
    const { amp, springs } = this.p;
    const m = (s) => Math.max(Math.abs(s.min), Math.abs(s.max));
    const { midCount, highCount } = this.p.waves;
    return amp.bass * m(springs.bass) + amp.mid * Math.sqrt(midCount) * m(springs.mid) +
      amp.high * Math.sqrt(highCount) * m(springs.high) + amp.asym * m(springs.asym) + amp.breathe +
      amp.swell * Math.max(0, springs.bass.max);
  }

  /**
   * Advance by one analysis frame. values: mapped drives {bass, mid, high, asym, kick} (0..1, asym −1..1).
   * frameSeconds: the analysis hop duration (512/48000 s at 48 kHz).
   */
  stepFrame(values, frameSeconds) {
    const S = this.springs, P = this.p;
    if (values.kick > 0) {
      S.bass.impulse(P.kick.bass * values.kick);
      S.mid.impulse(P.kick.mid * values.kick);
      this.particles.spawn(Math.round(P.kick.particles * values.kick), P.radius, values.kick);
    }
    const steps = Math.max(1, Math.ceil(frameSeconds / SIM_MAX_STEP - 1e-9));
    const h = frameSeconds / steps;
    const sp = P.speeds;
    for (let i = 0; i < steps; i++) {
      S.bass.step(values.bass, h);
      S.mid.step(values.mid, h);
      S.high.step(values.high, h);
      S.asym.step(values.asym, h);
      this.psiBass += sp.bass * (0.4 + 1.6 * clamp01(S.bass.x)) * h;
      this.psiZonal += sp.zonal * (0.4 + 1.6 * clamp01(S.bass.x)) * h;
      const midRate = sp.wave * (0.4 + 1.6 * clamp01(values.mid));
      const highRate = sp.wave * 2 * (0.4 + 1.6 * clamp01(values.high));
      for (let j = 0; j < this.midPhase.length; j++) this.midPhase[j] += this.midRate[j] * midRate * h;
      for (let j = 0; j < this.highPhase.length; j++) this.highPhase[j] += this.highRate[j] * highRate * h;
      this.particles.update(h);
      this.time += h;
    }
  }

  /** Coefficients c_j such that D(v) = Σ c_j · basis_j(v). */
  coefficients() {
    const A = this.p.amp, S = this.springs, c = this.coef;
    const xb = A.bass * S.bass.x;
    // Im((re + i·im)(cos ψ + i sin ψ)) = re·sin ψ + im·cos ψ
    c[0] = xb * 0.55 * Math.sin(this.psiBass);
    c[1] = xb * 0.55 * Math.cos(this.psiBass);
    c[2] = xb * 0.45 * Math.cos(this.psiZonal);
    let j = 3;
    // sin(a + ψ) = sin a · cos ψ + cos a · sin ψ
    const xm = A.mid * S.mid.x / Math.sqrt(this.midPhase.length);
    for (const ph of this.midPhase) { c[j++] = xm * Math.cos(ph); c[j++] = xm * Math.sin(ph); }
    const xh = A.high * S.high.x / Math.sqrt(this.highPhase.length);
    for (const ph of this.highPhase) { c[j++] = xh * Math.cos(ph); c[j++] = xh * Math.sin(ph); }
    c[j++] = A.asym * S.asym.x;
    // uniform term: slow autonomous breathing + the whole form swelling with the bass spring
    c[j] = A.breathe * Math.sin(2 * Math.PI * 0.12 * this.time) + A.swell * Math.max(0, S.bass.x);
    return c;
  }

  /** Write displaced positions (xyz per vertex) and per-vertex displacement D. */
  writeGeometry(positions, displacement) {
    const n = this.n, B = this.basis, c = this.coefficients(), R = this.p.radius;
    displacement.fill(0);
    for (let j = 0; j < this.nBasis; j++) {
      const cj = c[j];
      if (cj === 0) continue;
      const off = j * n;
      for (let v = 0; v < n; v++) displacement[v] += cj * B[off + v];
    }
    let sum2 = 0, maxAbs = 0, minR = Infinity;
    for (let v = 0; v < n; v++) {
      const d = displacement[v], r = R + d;
      positions[3 * v] = this.dirs[3 * v] * r;
      positions[3 * v + 1] = this.dirs[3 * v + 1] * r;
      positions[3 * v + 2] = this.dirs[3 * v + 2] * r;
      sum2 += d * d; if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d); if (r < minR) minR = r;
    }
    this.stats.rms = Math.sqrt(sum2 / n); this.stats.maxAbs = maxAbs; this.stats.minRadius = minR;
    return this.stats;
  }

  /** RMS over the surface of each term group's displacement (for tests and diagnostics). */
  termRms() {
    const c = this.coefficients(), m = this.p.waves.midCount, h = this.p.waves.highCount, n = this.n, B = this.basis;
    const rms = (a, b) => {
      let s2 = 0;
      for (let v = 0; v < n; v++) { let d = 0; for (let j = a; j < b; j++) d += c[j] * B[j * n + v]; s2 += d * d; }
      return Math.sqrt(s2 / n);
    };
    const ia = 3 + 2 * m + 2 * h;
    return { bass: rms(0, 3), mid: rms(3, 3 + 2 * m), high: rms(3 + 2 * m, ia), asym: rms(ia, ia + 1) };
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/** Fixed-size, seeded particle pool launched from the surface on onsets. */
export class Particles {
  constructor({ pool, speed, drag, life }, rng) {
    this.N = pool; this.speed = speed; this.drag = drag; this.lifeSpan = life; this.rng = rng;
    this.pos = new Float32Array(pool * 3);
    this.vel = new Float32Array(pool * 3);
    this.life = new Float32Array(pool);      // seconds remaining (0 = dead)
    this.maxLife = new Float32Array(pool).fill(1);
    this.next = 0;
  }
  spawn(count, radius, strength) {
    const r = this.rng;
    for (let i = 0; i < Math.min(count, this.N); i++) {
      const k = this.next; this.next = (this.next + 1) % this.N;
      const z = 2 * r() - 1, a = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
      const ux = s * Math.cos(a), uy = z, uz = s * Math.sin(a);
      const sp = this.speed * (0.5 + strength) * (0.6 + 0.8 * r());
      this.pos.set([ux * radius * 1.05, uy * radius * 1.05, uz * radius * 1.05], 3 * k);
      this.vel.set([ux * sp, uy * sp, uz * sp], 3 * k);
      this.maxLife[k] = this.life[k] = this.lifeSpan * (0.6 + 0.8 * r());
    }
  }
  /** Exact motion under linear drag over h: v ← v·e^{−ch}, x ← x + v·(1 − e^{−ch})/c (v0.9; was Euler). */
  update(h) {
    const damp = Math.exp(-this.drag * h), travel = this.drag > 0 ? (1 - damp) / this.drag : h;
    for (let k = 0; k < this.N; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] = Math.max(0, this.life[k] - h);
      for (let a = 0; a < 3; a++) { this.pos[3 * k + a] += this.vel[3 * k + a] * travel; this.vel[3 * k + a] *= damp; }
    }
  }
  get active() { let n = 0; for (let k = 0; k < this.N; k++) if (this.life[k] > 0) n++; return n; }
}

/**
 * Mapping preset for Morph: which sounds drive which motion (Phase 4 will make this editable).
 * v0.3: driven mainly by *pulses* (rise above each band's recent median) with a small share of
 * the steady adaptive level for base shape. v0.2 used the adaptive levels alone; on mastered
 * music they sit near 1 all the time, pinning the springs (your diagnostics: 0.93 / 0.92 / 1.00).
 */
export const MORPH_MAPPINGS = Object.freeze({
  bass:  { sources: [['lowPulse', 1.0], ['bass', 0.2]], curve: 'linear', offset: 0.04, min: 0, max: 1 },
  mid:   { sources: [['midPulse', 0.6], ['lowMidPulse', 0.4], ['upperMidPulse', 0.3], ['mid', 0.15]], curve: 'linear', offset: 0.04, min: 0, max: 1 },
  high:  { sources: [['presencePulse', 0.5], ['brilliancePulse', 0.5], ['brilliance', 0.12]], curve: 'sqrt', threshold: 0.05, offset: 0.03, min: 0, max: 1 },
  asym:  { sources: [['balance', 1]], signed: true, gain: 1.6, min: -1, max: 1 },
  kick:  { sources: [['onset', 1]] },
  // overall level barely moves in limited (mastered) music, so brightness follows the kick too
  glow:  { sources: [['level', 0.25], ['lowPulse', 0.85], ['levelPulse', 0.3]], curve: 'linear', attack: 0.02, release: 0.12 },
  hue:   { sources: [['centroid', 1]], attack: 0.25, release: 0.8, offset: 0, min: 0, max: 1 },
  width: { sources: [['width', 1]], attack: 0.1, release: 0.6 },
});
