// Audio-to-visual mapping engine (shared by every visualisation; Phase 4 adds the editor).
//
//   x      = Σ weight_i · feature_i(frame)                  (signed sources keep their sign)
//   x'     = max(0, (|x| − threshold) / (1 − threshold))     (dead zone, re-scaled to 0..1)
//   value  = clamp(gain · curve(x') · sign + offset, min, max)
//   output = attack/release smoothing of value, α = 1 − exp(−dt/τ)
//
// Features that are undefined in silence (centroid, flatness) return NaN; a mapping whose
// sources are all NaN holds its previous output instead of jumping.

export const FEATURES = Object.freeze({
  level:      (f) => f.level,
  subBass:    (f) => f.bandsNorm[0],
  bass:       (f) => f.bandsNorm[1],
  lowMid:     (f) => f.bandsNorm[2],
  mid:        (f) => f.bandsNorm[3],
  upperMid:   (f) => f.bandsNorm[4],
  presence:   (f) => f.bandsNorm[5],
  brilliance: (f) => f.bandsNorm[6],
  // 0 without an onset; 0.5..1 with one, scaled by detector confidence
  onset:      (f) => (f.onset.on ? 0.5 + 0.5 * f.onset.confidence : 0),
  // log-frequency position of the centroid: 100 Hz → 0, 20 kHz → 1
  centroid:   (f) => (f.silent ? NaN : clamp01(Math.log(Math.max(f.centroid, 1) / 100) / Math.log(200))),
  flatness:   (f) => (f.silent ? NaN : f.flatness),
  balance:    (f) => f.balance,        // −1..1
  correlation:(f) => f.correlation,    // −1..1
  width:      (f) => f.width,          // 0..1
  silent:     (f) => (f.silent ? 1 : 0),
  // Pulses (0..1): how far each band sits above its own median of the last 1.5 s. These carry the
  // beat; the adaptive levels above stay near 1 throughout mastered music (measured 0.81 ± 0.09).
  subBassPulse:    (f) => pulse(f, 0),
  bassPulse:       (f) => pulse(f, 1),
  lowMidPulse:     (f) => pulse(f, 2),
  midPulse:        (f) => pulse(f, 3),
  upperMidPulse:   (f) => pulse(f, 4),
  presencePulse:   (f) => pulse(f, 5),
  brilliancePulse: (f) => pulse(f, 6),
  lowPulse:        (f) => Math.max(pulse(f, 0), pulse(f, 1)),   // kick evidence from either low band
  levelPulse:      (f) => f.levelPulse ?? 0,
});

function pulse(f, i) { return f.bandsPulse ? f.bandsPulse[i] : 0; }

export const CURVES = Object.freeze({
  linear: (x) => x,
  square: (x) => x * x,
  cube: (x) => x * x * x,
  sqrt: (x) => Math.sqrt(x),
  smoothstep: (x) => x * x * (3 - 2 * x),
  log: (x) => Math.log1p(9 * x) / Math.LN10,   // 0→0, 1→1, steep at the bottom
});

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

const DEFAULTS = { curve: 'linear', threshold: 0, gain: 1, offset: 0, min: 0, max: 1, attack: 0, release: 0, signed: false };

/** Validate and normalise a mapping spec; throws on anything unknown or out of range. */
export function normaliseSpec(spec) {
  const s = { ...DEFAULTS, ...spec };
  if (!Array.isArray(s.sources) || s.sources.length === 0 || s.sources.length > 8) throw new Error('mapping needs 1–8 sources');
  s.sources = s.sources.map((src) => {
    const [feature, weight = 1] = Array.isArray(src) ? src : [src.feature, src.weight];
    if (!(feature in FEATURES)) throw new Error(`unknown feature '${feature}'`);
    if (!Number.isFinite(weight)) throw new Error('weight must be finite');
    return { feature, weight };
  });
  if (!(s.curve in CURVES)) throw new Error(`unknown curve '${s.curve}'`);
  for (const k of ['threshold', 'gain', 'offset', 'min', 'max', 'attack', 'release']) {
    if (!Number.isFinite(s[k])) throw new Error(`${k} must be finite`);
  }
  if (s.threshold < 0 || s.threshold >= 1) throw new Error('threshold must be in [0, 1)');
  if (s.attack < 0 || s.release < 0) throw new Error('attack/release must be ≥ 0');
  if (s.min > s.max) throw new Error('min > max');
  return s;
}

export class Mapping {
  constructor(spec) {
    this.spec = normaliseSpec(spec);
    this.value = clamp(this.spec.offset, this.spec.min, this.spec.max);
    this.raw = 0;
  }

  /** Target value for a frame, before smoothing (NaN if no source is defined). */
  target(frame) {
    const s = this.spec;
    let x = 0, any = false;
    for (const { feature, weight } of s.sources) {
      const v = FEATURES[feature](frame);
      if (Number.isFinite(v)) { x += weight * v; any = true; }
    }
    if (!any) return NaN;
    this.raw = x;
    const sign = s.signed && x < 0 ? -1 : 1;
    let m = s.signed ? Math.abs(x) : x;
    m = clamp01((m - s.threshold) / (1 - s.threshold));
    return clamp(s.gain * CURVES[s.curve](m) * sign + s.offset, s.min, s.max);
  }

  /** Resting value: what the drive reads with no audio (offset, clamped). */
  get rest() { return Math.min(this.spec.max, Math.max(this.spec.min, this.spec.offset)); }

  apply(frame, dt, timeFactor = 1) {
    const t = this.target(frame);
    if (!Number.isFinite(t)) return this.value;
    const tau = (t > this.value ? this.spec.attack : this.spec.release) * timeFactor;
    const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    this.value += a * (t - this.value);
    return this.value;
  }
}

/** A named set of mappings evaluated together, one result object per frame. */
export class MappingSet {
  constructor(specs) {
    this.mappings = Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, new Mapping(spec)]));
    this.values = Object.fromEntries(Object.keys(specs).map((n) => [n, this.mappings[n].value]));
  }
  /**
   * opts.scales {name: g}: influence on a drive — its audio-driven part is scaled around its rest
   *   value: v′ = rest + g·(v − rest), clamped to [min, max] widened by g (g > 1 may exceed max).
   *   The smoother's own state is never scaled, so changing g is instant and reversible.
   * opts.timeFactor: multiplies every attack/release (calibrated smoothing).
   */
  apply(frame, dt, opts = {}) {
    const { scales = null, timeFactor = 1 } = opts;
    for (const [name, m] of Object.entries(this.mappings)) {
      const v = m.apply(frame, dt, timeFactor), g = scales?.[name];
      if (g === undefined || g === 1) { this.values[name] = v; continue; }
      const r = m.rest, span = m.spec.max - m.spec.min, wide = Math.max(0, g - 1) * span;
      this.values[name] = Math.min(m.spec.max + wide, Math.max(m.spec.min - wide, r + g * (v - r)));
    }
    return this.values;
  }
}

/**
 * Influence roles (v0.12): which drives shape geometry and which drive colour. Movement is applied
 * as a time scale by each engine, not through drives.
 */
export const DEFAULT_ROLES = Object.freeze({ shape: ['bass', 'mid', 'high', 'kick', 'balance', 'asym'], colour: ['level', 'glow', 'hue'] });
export function influenceScales(influence, roles = DEFAULT_ROLES) {
  const out = {};
  if (!influence) return out;
  for (const n of roles.shape) out[n] = influence.shape;
  for (const n of roles.colour) out[n] = influence.colour;
  return out;
}

/** Small, fast, seedable PRNG (mulberry32): identical sequences for identical seeds. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * TeX for a mapping spec, generated from the same spec the engine runs (for "How it works").
 *   name = clamp_[min,max]( gain · curve((x − t)/(1 − t)) + offset ),  x = Σ w_i · feature_i
 */
const CURVE_TEX = { linear: 'u', square: 'u^2', cube: 'u^3', sqrt: '\\sqrt{u}', smoothstep: 'u^2(3 - 2u)', log: '\\log_{10}(1 + 9u)' };
const FEATURE_TEX = (f) => `\\text{${f}}`;
export function mappingTex(name, specIn) {
  const s = normaliseSpec(specIn);
  const x = s.sources.map(({ feature, weight }, i) => `${i ? (weight < 0 ? ' - ' : ' + ') : weight < 0 ? '-' : ''}${Math.abs(weight) === 1 ? '' : Math.abs(weight).toFixed(2) + '\\,'}${FEATURE_TEX(feature)}`).join('');
  const u = s.threshold > 0 ? `u = \\frac{${s.signed ? '|x|' : 'x'} - ${s.threshold.toFixed(2)}}{${(1 - s.threshold).toFixed(2)}}` : `u = ${s.signed ? '|x|' : 'x'}`;
  const core = `${s.gain === 1 ? '' : s.gain.toFixed(2) + '\\,'}${CURVE_TEX[s.curve]}${s.signed ? '\\,\\operatorname{sgn}(x)' : ''}${s.offset ? ` + ${s.offset.toFixed(2)}` : ''}`;
  const smooth = s.attack || s.release ? `\\quad\\text{then smoothed: attack } ${(s.attack * 1000).toFixed(0)}\\text{ ms, release } ${(s.release * 1000).toFixed(0)}\\text{ ms}` : '';
  return `\\text{${name}} = \\operatorname{clamp}_{[${s.min}, ${s.max}]}\\bigl(${core}\\bigr),\\quad ${u},\\quad x = ${x}${smooth}`;
}
