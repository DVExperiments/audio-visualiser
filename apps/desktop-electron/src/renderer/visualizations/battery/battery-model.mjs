// Battery-inspired rhythmic geometry (pure maths, tested).
import { mulberry32 } from '../../engine/mapping.mjs';

/**
 * Shape switching on strong onsets: the shape vocabulary changes in time with the music, but
 * never faster than once per refractory period, and always to a different shape (seeded).
 */
export class RhythmSwitch {
  constructor(choices, { seed = 1, threshold = 0.75, refractory = 1.0 } = {}) {
    this.choices = choices; this.rng = mulberry32(seed); this.threshold = threshold; this.refractory = refractory;
    this.index = 0; this.since = Infinity; this.changes = 0;
  }
  get value() { return this.choices[this.index]; }
  step(kick, dt) {
    this.since += dt;
    if (kick >= this.threshold && this.since >= this.refractory) {
      let k; do { k = Math.floor(this.rng() * this.choices.length); } while (k === this.index && this.choices.length > 1);
      this.index = k; this.since = 0; this.changes++;
      return true;
    }
    return false;
  }
}

/**
 * Concentric rotating polygons. Ring j pulses with band j (sub-bass innermost … presence
 * outermost) and rotates in alternating directions at a speed set by the mids.
 *   r_j = (0.12 + 0.125·j)·(1 + 0.32·pulse_j)   ⇒ r ≤ 0.745·1.32 < 1 (always on screen)
 */
export class PolygonRings {
  constructor(rings = 6, seed = 7) {
    this.rings = rings;
    this.rot = new Float64Array(rings);
    this.pulse = new Float64Array(rings);
    this.shape = new RhythmSwitch([3, 4, 5, 6, 8], { seed, threshold: 0.75, refractory: 1.0 });
  }
  step(values, frame, dt) {
    this.shape.step(values.kick, dt);
    const rel = 1 - Math.exp(-dt / 0.1);
    for (let j = 0; j < this.rings; j++) {
      const target = frame?.bandsPulse ? frame.bandsPulse[Math.min(j, 6)] : 0;
      this.pulse[j] = target > this.pulse[j] ? target : this.pulse[j] + rel * (target - this.pulse[j]);
      const dir = j % 2 ? -1 : 1;
      this.rot[j] += dir * (0.15 + 0.9 * values.mid + (0.3 * j) / this.rings) * dt;
    }
  }
  radius(j) { return (0.12 + 0.125 * j) * (1 + 0.32 * this.pulse[j]); }
  /** Closed polygon for ring j, `segmentsPerSide` points per edge. Returns the point count. */
  writeRing(out, j, segmentsPerSide = 1) {
    const sides = this.shape.value, n = sides * segmentsPerSide, r = this.radius(j);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(i / segmentsPerSide), f = (i % segmentsPerSide) / segmentsPerSide;
      const a0 = this.rot[j] + (2 * Math.PI * side) / sides, a1 = this.rot[j] + (2 * Math.PI * (side + 1)) / sides;
      out[2 * i] = r * ((1 - f) * Math.cos(a0) + f * Math.cos(a1));
      out[2 * i + 1] = r * ((1 - f) * Math.sin(a0) + f * Math.sin(a1));
    }
    return n;
  }
}

/** Star polygon with alternating outer/inner radii; the point count switches on strong onsets. */
export class StarGate {
  constructor(seed = 11) { this.points = new RhythmSwitch([5, 6, 7, 8, 9], { seed, threshold: 0.8, refractory: 1.5 }); this.rot = 0; }
  step(values, dt) { this.points.step(values.kick, dt); this.rot += (0.2 + 1.4 * values.bass) * dt; }
  /** outer = 0.5·(1 + 0.45·bass), inner = outer·(0.42 − 0.18·high). Returns the vertex count (2·points). */
  writeStar(out, values) {
    const p = this.points.value, ro = 0.5 * (1 + 0.45 * values.bass), ri = ro * (0.42 - 0.18 * values.high);
    for (let i = 0; i < 2 * p; i++) {
      const r = i % 2 ? ri : ro, a = this.rot + (Math.PI * i) / p;
      out[2 * i] = r * Math.cos(a); out[2 * i + 1] = r * Math.sin(a);
    }
    return 2 * p;
  }
}
