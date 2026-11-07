// Particle swarm (v0.17): the pure model. The GPU shader in swarm.mjs mirrors stepParticle()
// line for line (same constants, same order), so the tests here check what the GPU computes.
//
// Forces on a particle at p with velocity v:
//   magnets   a += G·s_k·d/(|d|²+ε²)^{3/2}            d = M_k − p   (softened inverse-square pull)
//   swirl     a += G·w_k·(n_k × d)/(|d|²+ε²)^{3/2}   (tangential: spiral orbits instead of collapse)
//   shimmer   a += T·(sin(f·y+t), sin(f·z+t), sin(f·x+t))   (divergence-free: each component
//             ignores its own coordinate, so it stirs without bunching particles)
//   centring  a += −c·p,  plus a soft wall beyond R_wall: a += −k_w·(|p| − R_wall)·p̂
// then v ← (v + a·h)·e^{−γh}, |v| ≤ v_max, p ← p + v·h.
//
// Beats are NOT a physical impulse. Measured on the JS twin: the swirl pumps energy into orbits
// (that is what keeps the swarm alive), so any outward kick knocks particles into wide, self-
// sustaining orbiting shells: under a steady 124 BPM beat a kick impulse inflated the swarm by
// 50–200 % for as long as the beat lasted. A work-free magnetic-style swirl (a ⟂ v) avoided that
// but let drag collapse everything onto the magnets. So the beat is drawn as a BREATH: positions are
// rendered expanded about the centre by (1 + 0.3·b), where b jumps to the onset strength and decays
// with τ = 0.25 s; it cannot accumulate. The bass magnet's pulsing pull adds a physical tug inward.

export const SWARM = Object.freeze({
  G: 0.9, eps: 0.35, centre: 0.35, wallR: 2.4, wall: 8, drag: 1.2, vmax: 3.5, turbFreq: 2.2, turbGain: 2.5,
  step: 1 / 120, maxSteps: 4, breathGain: 0.3, breathRelease: 0.25,
});

/** Five magnets, one per band group; each follows its own Lissajous path. */
export const MAGNETS = Object.freeze([
  { name: 'bass',   radius: 0.6, freq: [0.31, 0.23, 0.27], phase: [0.0, 1.1, 2.3], base: 0.35, gain: 2.2, swirl: 0.9,  axis: [0, 1, 0],   colour: [1.0, 0.12, 0.42] },
  { name: 'lowmid', radius: 1.3, freq: [0.43, 0.37, 0.29], phase: [2.1, 0.4, 1.7], base: 0.2,  gain: 1.6, swirl: -1.1, axis: [0.3, 1, 0.2], colour: [1.0, 0.5, 0.06] },
  { name: 'mid',    radius: 1.5, freq: [0.53, 0.41, 0.47], phase: [4.0, 2.6, 0.3], base: 0.2,  gain: 1.6, swirl: 1.2,  axis: [-0.2, 1, 0.4], colour: [0.15, 1.0, 0.45] },
  { name: 'upper',  radius: 1.7, freq: [0.61, 0.57, 0.39], phase: [1.3, 3.9, 4.4], base: 0.15, gain: 1.4, swirl: -1.3, axis: [0.5, 0.8, -0.3], colour: [0.15, 0.55, 1.0] },
  { name: 'high',   radius: 1.9, freq: [0.71, 0.63, 0.67], phase: [5.2, 5.0, 3.1], base: 0.1,  gain: 1.3, swirl: 1.4,  axis: [0, 0.6, 1],  colour: [0.62, 0.22, 1.0] },
]);

/** Audio → drives. Shape role: bass…high, kick. Colour role: glow, hue. */
export const SWARM_MAPPINGS = Object.freeze({
  bass:   { sources: [['lowPulse', 1.0], ['bass', 0.2]], offset: 0.03, min: 0, max: 1 },
  lowmid: { sources: [['lowMidPulse', 1.0], ['lowMid', 0.15]], offset: 0.03, min: 0, max: 1 },
  mid:    { sources: [['midPulse', 1.0], ['mid', 0.15]], offset: 0.03, min: 0, max: 1 },
  upper:  { sources: [['upperMidPulse', 1.0], ['upperMid', 0.12]], offset: 0.03, min: 0, max: 1 },
  high:   { sources: [['presencePulse', 0.6], ['brilliancePulse', 0.6], ['brilliance', 0.12]], curve: 'sqrt', offset: 0.03, min: 0, max: 1 },
  kick:   { sources: [['onset', 1]] },
  glow:   { sources: [['level', 0.3], ['lowPulse', 0.7], ['levelPulse', 0.3]], attack: 0.02, release: 0.15 },
  hue:    { sources: [['centroid', 1]], attack: 0.3, release: 1.0, offset: 0, min: 0, max: 1 },
});
export const SWARM_ROLES = Object.freeze({ shape: ['bass', 'lowmid', 'mid', 'upper', 'high', 'kick'], colour: ['glow', 'hue'] });
export const DRIVE_NAMES = ['bass', 'lowmid', 'mid', 'upper', 'high'];

const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const AXES = MAGNETS.map((m) => norm(m.axis));

/** Magnet positions and strengths at phase-time t for drives d (0…≥1 each). out: Float32Array(5·8). */
export function magnetState(t, drives, out = new Float32Array(MAGNETS.length * 8)) {
  MAGNETS.forEach((m, k) => {
    const o = 8 * k, [fx, fy, fz] = m.freq, [px, py, pz] = m.phase, d = drives[DRIVE_NAMES[k]] ?? 0;
    out[o] = m.radius * Math.sin(fx * t + px);
    out[o + 1] = 0.7 * m.radius * Math.sin(fy * t + py);
    out[o + 2] = m.radius * Math.cos(fz * t + pz);
    out[o + 3] = m.base + m.gain * d;          // pull strength
    // swirl grows only gently with the drive: more tangential speed means WIDER orbits (angular
    // momentum), so a strong swirl would push particles away from the very magnet that is pulling
    out[o + 4] = m.swirl * (0.6 + 0.3 * d);
    out[o + 5] = AXES[k][0]; out[o + 6] = AXES[k][1]; out[o + 7] = AXES[k][2];
  });
  return out;
}

/** One step for one particle (p, v are 3-arrays, updated in place). The GPU does exactly this. */
export function stepParticle(p, v, mags, h, { turb = 0, time = 0 } = {}) {
  const S = SWARM;
  const r = Math.hypot(p[0], p[1], p[2]), wall = r > S.wallR ? S.wall * (r - S.wallR) / r : 0;
  let ax = -(S.centre + wall) * p[0], ay = -(S.centre + wall) * p[1], az = -(S.centre + wall) * p[2];
  for (let k = 0; k < MAGNETS.length; k++) {
    const o = 8 * k, dx = mags[o] - p[0], dy = mags[o + 1] - p[1], dz = mags[o + 2] - p[2];
    const r2 = dx * dx + dy * dy + dz * dz + S.eps * S.eps, inv = S.G / (r2 * Math.sqrt(r2));
    const s = mags[o + 3], w = mags[o + 4], nx = mags[o + 5], ny = mags[o + 6], nz = mags[o + 7];
    ax += inv * (s * dx + w * (ny * dz - nz * dy));
    ay += inv * (s * dy + w * (nz * dx - nx * dz));
    az += inv * (s * dz + w * (nx * dy - ny * dx));
  }
  const f = S.turbFreq, T = S.turbGain * turb;
  ax += T * Math.sin(f * p[1] + time); ay += T * Math.sin(f * p[2] + time); az += T * Math.sin(f * p[0] + time);
  const damp = Math.exp(-S.drag * h);
  v[0] = (v[0] + ax * h) * damp; v[1] = (v[1] + ay * h) * damp; v[2] = (v[2] + az * h) * damp;
  const sp = Math.hypot(v[0], v[1], v[2]);
  if (sp > S.vmax) { const q = S.vmax / sp; v[0] *= q; v[1] *= q; v[2] *= q; }
  p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
}

/** The beat's breath: jumps to the onset strength, then decays with τ = 0.25 s (frame-rate independent). */
export function breathStep(b, onsetStrength, dt) {
  const decayed = b * Math.exp(-dt / SWARM.breathRelease);
  return Math.max(decayed, Math.min(1, onsetStrength));
}

/** Initial state: positions in a ball of radius 1.6, small tangential velocities (seeded, deterministic). */
export function initialState(n, rng) {
  const pos = new Float32Array(n * 4), vel = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x, y, z; do { x = 2 * rng() - 1; y = 2 * rng() - 1; z = 2 * rng() - 1; } while (x * x + y * y + z * z > 1);
    pos.set([1.6 * x, 1.6 * y, 1.6 * z, rng()], 4 * i);        // w: a per-particle seed (colour variety)
    vel.set([-0.4 * z, 0.1 * (rng() - 0.5), 0.4 * x, 0], 4 * i);
  }
  return { pos, vel };
}
