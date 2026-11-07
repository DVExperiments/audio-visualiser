// Spectrum terrain (v0.19): the pure model. Each terrain row is one spectrum snapshot, mirrored so
// bass sits at both outer edges and treble towards the middle: loud bass raises mountain ranges on
// both sides and a valley runs down the centre, with a flat "road" along it.

export const TERRAIN = Object.freeze({ cols: 96, rows: 64, interval: 1 / 24, lo: -60, hi: -12, power: 2, road: [0.04, 0.2], width: 14, depth: 26, height: 3.2 });

const cr = (a, x) => {   // Catmull-Rom over evenly spaced samples (the bands are evenly spaced in log-frequency)
  const n = a.length, xc = Math.max(0, Math.min(n - 1, x)), i = Math.min(n - 2, Math.floor(xc)), t = xc - i;
  const p0 = a[Math.max(0, i - 1)], p1 = a[i], p2 = a[i + 1], p3 = a[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Column c's distance from the centre, |u| ∈ [0, 1]. */
export const colU = (c, cols = TERRAIN.cols) => Math.abs((c / (cols - 1)) * 2 - 1);

/**
 * One row of heights (0…1) from a spectrum in dB (48 bands): |u| = 1 (edges) → band 0 (bass),
 * |u| = 0 (centre) → the top band (treble). Display curve: level over −60…−12 dB, squared (as the
 * ridgeline). The road envelope flattens the middle 4–20 % to the ground.
 */
export function heightRow(spec, out, cols = TERRAIN.cols) {
  const nb = spec.length, T = TERRAIN;
  for (let c = 0; c < cols; c++) {
    const u = colU(c, cols), db = cr(spec, (1 - u) * (nb - 1));
    const v = Math.max(0, Math.min(1, (db - T.lo) / (T.hi - T.lo))) ** T.power;
    out[c] = v * smooth(T.road[0], T.road[1], u);
  }
  return out;
}

/** Fixed-interval row history with a scroll phase (same contract as the ridgeline's). */
export class RowHistory {
  constructor(rows = TERRAIN.rows, cols = TERRAIN.cols, interval = TERRAIN.interval) {
    Object.assign(this, { rows, cols, interval, acc: 0, head: -1, filled: 0 });
    this.buf = new Float32Array(rows * cols);
  }
  step(row, dt) {
    this.acc += dt;
    while (this.acc >= this.interval) {
      this.acc -= this.interval;
      this.head = (this.head + 1) % this.rows;
      this.buf.set(row, this.head * this.cols);
      this.filled = Math.min(this.rows, this.filled + 1);
    }
  }
  get phase() { return this.acc / this.interval; }
  /** Height at column c of the row `age` steps old (0 = newest), or 0 before the history fills. */
  at(age, c) { return age < this.filled ? this.buf[((this.head - age + this.rows) % this.rows) * this.cols + c] : 0; }
}
