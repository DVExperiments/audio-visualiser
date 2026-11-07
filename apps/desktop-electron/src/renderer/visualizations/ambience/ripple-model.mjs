// CPU reference of the Water preset's ripple tank (the GLSL in ambience.mjs is the same update).
//
// Discrete 2D wave equation (leapfrog / FDTD), height h on a pixel grid:
//   h⁺ = (2h − h⁻ + λ²·∇²h)·(1 − γΔt),   λ = cΔt/Δx
// v0.9: ∇² is the isotropic 9-point stencil  (4·(E+W+N+S) + (NE+NW+SE+SW) − 20h)/6  — its error
// term is direction-independent, so ripples stay round (the 5-point stencil carries waves faster
// along the axes than diagonally). Stability: λ²·max|eig| ≤ 4 with max|eig| = 16/3 → λ ≤ √(3/4) ≈ 0.87
// (5-point: max|eig| = 8 → λ ≤ 1/√2). λ = 0.5 is used. Edges reflect (clamped neighbours).
// The simulation runs at a fixed 240 steps per second whatever the display rate (StepAccumulator),
// so ripples move at λ pixels per step = 120 px/s on the buffer at any refresh rate.
export const RIPPLE = Object.freeze({ simRate: 240, lambda: 0.5, damping: 0.6 });

export class RippleCPU {
  constructor(W, H, { lambda = RIPPLE.lambda, damping = RIPPLE.damping, simRate = RIPPLE.simRate, stencil = 9 } = {}) {
    Object.assign(this, { W, H, l2: lambda * lambda, damp: 1 - damping / simRate, stencil });
    this.cur = new Float64Array(W * H); this.prev = new Float64Array(W * H); this.next = new Float64Array(W * H);
  }
  at(x, y) { x = Math.max(0, Math.min(this.W - 1, x)); y = Math.max(0, Math.min(this.H - 1, y)); return this.cur[y * this.W + x]; }
  step() {
    const { W, H } = this;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = this.cur[i];
      const edges = this.at(x + 1, y) + this.at(x - 1, y) + this.at(x, y + 1) + this.at(x, y - 1);
      const lap = this.stencil === 5 ? edges - 4 * c
        : (4 * edges + this.at(x + 1, y + 1) + this.at(x + 1, y - 1) + this.at(x - 1, y + 1) + this.at(x - 1, y - 1) - 20 * c) / 6;
      this.next[i] = (2 * c - this.prev[i] + this.l2 * lap) * this.damp;
    }
    [this.prev, this.cur, this.next] = [this.cur, this.next, this.prev];
  }
  /**
   * Gaussian drop as a DISPLACEMENT: added to the current and previous heights alike, so it carries
   * no net velocity. (Adding it to the current height only gives an impulse with non-zero mean; with
   * reflecting edges ∇² sums to 0, so the mean obeys m⁺ = 2m − m⁻ and drifts upward linearly forever —
   * on the GPU the level would climb until half-float precision swallowed the ripples. Found by test.)
   */
  drop(cx, cy, strength, radius) {
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2, v = strength * Math.exp(-d2 / (radius * radius));
      this.cur[y * this.W + x] += v; this.prev[y * this.W + x] += v;
    }
  }
  mean() { let m = 0; for (const v of this.cur) m += v; return m / this.cur.length; }
  energy() { let e = 0; for (let i = 0; i < this.cur.length; i++) e += this.cur[i] ** 2 + (this.cur[i] - this.prev[i]) ** 2; return e; }
}

/** Fixed-rate stepping: how many simulation steps each display frame owes (same rule as the engine). */
export class StepAccumulator {
  constructor(rate, maxPerFrame = 16) { this.rate = rate; this.max = maxPerFrame; this.debt = 0; }
  take(dt) {
    this.debt += dt * this.rate;
    const n = Math.min(this.max, Math.floor(this.debt));
    this.debt = Math.min(this.debt - n, 2);
    return n;
  }
}
