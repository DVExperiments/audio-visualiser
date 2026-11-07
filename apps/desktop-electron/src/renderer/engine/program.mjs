// Alchemy-style autonomous variation: a visualisation wanders through "programs" (shape families,
// colour schemes), switching on a strong beat once it has held for a while, and crossfading.
import { mulberry32 } from './mapping.mjs';

export class ProgramCycler {
  /**
   * count programs; each is held for a seeded random time in [minHold, maxHold], then the switch
   * waits for a strong onset (kick ≥ threshold), at most 4 s; crossfades over `fade` seconds.
   */
  constructor(count, { seed = 1, minHold = 12, maxHold = 22, fade = 3, threshold = 0.7 } = {}) {
    Object.assign(this, { count, minHold, maxHold, fade, threshold });
    this.rng = mulberry32(seed);
    this.current = 0; this.next = 0; this.mix = 0; this.fading = false;
    this.held = 0; this.hold = this.pickHold(); this.switches = 0;
  }
  pickHold() { return this.minHold + (this.maxHold - this.minHold) * this.rng(); }
  /** Smoothstep of the raw crossfade fraction (0 = current only, 1 = next only). */
  get weight() { const m = this.mix; return m * m * (3 - 2 * m); }
  step(dt, kick = 0) {
    if (this.fading) {
      this.mix = Math.min(1, this.mix + dt / this.fade);
      if (this.mix >= 1) { this.current = this.next; this.fading = false; this.mix = 0; this.held = 0; this.hold = this.pickHold(); }
      return;
    }
    this.held += dt;
    // after the (random) hold time, switch on the next strong beat — or 4 s later if none comes
    const onBeat = this.held >= this.hold && kick >= this.threshold;
    const overdue = this.held >= this.hold + 4;
    if (this.count > 1 && (onBeat || overdue)) {
      let k; do { k = Math.floor(this.rng() * this.count); } while (k === this.current);
      this.next = k; this.fading = true; this.mix = 0; this.switches++;
    }
  }
}
