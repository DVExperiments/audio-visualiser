/* Shuffle, automatic switching, transitions and the personal library (v0.11).
 * Pure logic — no DOM — loaded as a classic script (window.AutoShuffle) and by node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoShuffle = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Preset key "collection/preset". */
  const keyOf = (collection, preset) => `${collection}/${preset}`;
  const KEY_RE = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/;
  const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);

  /**
   * Shuffle bag: every item is played once, in random order, before any repeats; a new bag never
   * starts with the item that just played. rng() returns [0, 1).
   */
  class ShuffleBag {
    constructor(items, rng = Math.random) { this.rng = rng; this.setItems(items); }
    setItems(items) { this.items = [...new Set(items)]; this.bag = []; }
    next(current) {
      if (this.items.length === 0) return null;
      if (this.items.length === 1) return this.items[0];
      if (this.bag.length === 0) {
        this.bag = [...this.items];
        for (let i = this.bag.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
        // the bag is popped from the end: keep the current item away from the next draw
        if (this.bag[this.bag.length - 1] === current) [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]];
      }
      let k = this.bag.pop();
      if (k === current && this.bag.length) { this.bag.unshift(k); k = this.bag.pop(); }
      return k;
    }
  }

  /**
   * Musical change detector (a heuristic; it does not identify songs):
   *  - track:   ≥ minGap seconds of silence (below silenceDb, or the service's silent/gap flag)
   *             after at least minHeard seconds of sound, reported when sound resumes;
   *  - section: the music's tonal balance moves: the RMS difference (dB) between a 3 s and a 20 s
   *             exponential average of the 7 band levels exceeds noveltyDb.
   */
  class MusicalChangeDetector {
    constructor({ silenceDb = -50, minGap = 0.6, minHeard = 5, noveltyDb = 6, refractory = 25 } = {}) {
      Object.assign(this, { silenceDb, minGap, minHeard, noveltyDb, refractory });
      this.silentFor = 0; this.heardFor = 0; this.since = Infinity; this.mid = null; this.long = null; this.novelty = 0;
    }
    push(f, dt) {
      this.since += dt;
      const quiet = f.silent || f.gap || f.dbfs[2] < this.silenceDb;
      if (quiet) { this.silentFor += dt; return null; }
      let event = null;
      if (this.silentFor >= this.minGap && this.heardFor >= this.minHeard) { event = { kind: 'track', strength: 1 }; this.reset(); }
      this.silentFor = 0; this.heardFor += dt;
      const v = f.bands.map((b) => Math.max(-90, b));
      if (!this.mid) { this.mid = [...v]; this.long = [...v]; }
      const am = 1 - Math.exp(-dt / 3), al = 1 - Math.exp(-dt / 20);
      let s2 = 0;
      for (let i = 0; i < v.length; i++) { this.mid[i] += am * (v[i] - this.mid[i]); this.long[i] += al * (v[i] - this.long[i]); s2 += (this.mid[i] - this.long[i]) ** 2; }
      this.novelty = Math.sqrt(s2 / v.length);
      if (!event && this.novelty > this.noveltyDb && this.since > this.refractory && this.heardFor > 10) {
        event = { kind: 'section', strength: Math.min(1, this.novelty / (2 * this.noveltyDb)) };
        this.long = [...this.mid]; this.since = 0;           // adapt, so one change is reported once
      }
      if (event) this.since = 0;
      return event;
    }
    reset() { this.mid = null; this.long = null; this.heardFor = 0; this.since = 0; }
  }

  /**
   * Automatic mode policy.
   *   timer: switch every `minutes`.
   *   music: switch on a track or section change (at least minHold s apart), or after `minutes`
   *          if the music never changes.
   * A decided switch waits for the next strong onset (confidence ≥ 0.5) so the transition lands
   * on the beat, at most beatWait seconds; at a track change it happens at once.
   */
  class AutoDirector {
    constructor({ mode = 'timer', minutes = 3, minHold = 45, beatWait = 3 } = {}) {
      Object.assign(this, { mode, minutes, minHold, beatWait });
      this.since = 0; this.pending = false; this.pendingFor = 0; this.reason = null;
    }
    configure(o) { Object.assign(this, o); }
    restart() { this.since = 0; this.pending = false; this.pendingFor = 0; }
    /** Returns null or { reason } when it is time to switch. */
    step(dt, event, onset) {
      this.since += dt;
      if (!this.pending) {
        if (this.mode === 'music' && event && this.since >= this.minHold) {
          if (event.kind === 'track') { this.restart(); return { reason: 'new track' }; }
          this.pending = true; this.reason = 'the music changed';
        } else if (this.since >= this.minutes * 60) { this.pending = true; this.reason = this.mode === 'music' ? 'no change for a while' : 'timer'; }
        return null;
      }
      this.pendingFor += dt;
      if ((onset && onset.on && onset.confidence >= 0.5) || this.pendingFor >= this.beatWait) {
        const reason = this.reason; this.restart(); return { reason };
      }
      return null;
    }
  }

  // ---------------- transitions
  const TRANSITIONS = ['crossfade', 'blend', 'iris', 'wipe', 'clock'];
  const TRANSITION_NAMES = { crossfade: 'Crossfade', blend: 'Colour blend', iris: 'Iris', wipe: 'Wipe', clock: 'Clock', mixed: 'Mixed' };
  const ease = (p) => { const t = Math.max(0, Math.min(1, p)); return t * t * (3 - 2 * t); };

  /** A transition for "mixed" mode: never the same type twice running; a random angle for wipes. */
  function pickTransition(setting, last, rng = Math.random) {
    let type = setting;
    if (setting === 'mixed' || !TRANSITIONS.includes(setting)) {
      const choices = TRANSITIONS.filter((t) => t !== last);
      type = choices[Math.floor(rng() * choices.length)];
    }
    return { type, angle: Math.floor(rng() * 360) };
  }

  /**
   * CSS for the OUTGOING canvas (drawn over the incoming one) at progress p ∈ [0,1].
   * p = 0: outgoing fully visible; p = 1: fully gone (the incoming one shows).
   * Masks: black = keep the outgoing picture, transparent = reveal the incoming one.
   */
  function transitionStyle(t, p) {
    const e = ease(p);
    switch (t.type) {
      case 'blend':   // colour blending: screen-blend the outgoing picture as it fades
        return { opacity: String(1 - e), mixBlendMode: 'screen', maskImage: 'none' };
      case 'iris': {  // a soft circle opening from the centre
        const r = e * 115 - 12;
        return { opacity: '1', mixBlendMode: 'normal', maskImage: `radial-gradient(circle farthest-corner at 50% 50%, transparent ${r.toFixed(2)}%, black ${(r + 12).toFixed(2)}%)` };
      }
      case 'wipe': {  // a soft straight edge sweeping across at a random angle
        const x = e * 130 - 15;
        return { opacity: '1', mixBlendMode: 'normal', maskImage: `linear-gradient(${t.angle}deg, transparent ${x.toFixed(2)}%, black ${(x + 15).toFixed(2)}%)` };
      }
      case 'clock': { // a soft hand sweeping round
        const a = e * 380 - 10;
        return { opacity: '1', mixBlendMode: 'normal', maskImage: `conic-gradient(from ${t.angle}deg at 50% 50%, transparent ${Math.max(0, a).toFixed(1)}deg, black ${Math.max(0, a + 10).toFixed(1)}deg)` };
      }
      default:        // crossfade
        return { opacity: String(1 - e), mixBlendMode: 'normal', maskImage: 'none' };
    }
  }

  // ---------------- personal library
  /** Toggle a key in a list (favourites, or a collection's items); returns a new list. */
  function toggleKey(list, key) {
    if (!isKey(key)) return list;
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  /** Collection ids for user collections: "user-" + a short slug of the name, made unique. */
  function newCollectionId(name, existing) {
    const base = 'user-' + (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'mix');
    let id = base, n = 2;
    while (existing.some((c) => c.id === id)) id = `${base}-${n++}`;
    return id;
  }

  /**
   * Virtual collections built from the library: "★ Favourites" and user collections. Each entry's
   * presets point at real presets (any collection), keeping their real id for explanations.
   */
  function virtualCollections(library, registry) {
    const find = (key) => {
      const [c, p] = key.split('/');
      const coll = registry.find((x) => x.id === c && x.available);
      const preset = coll?.presets.find((x) => x.id === p);
      return preset ? { ...preset, key, realCollection: c, label: `${preset.name} · ${coll.name.replace(/-inspired$/, '')}` } : null;
    };
    const build = (id, name, keys) => ({ id, name, virtual: true, available: keys.length > 0, presets: keys.map(find).filter(Boolean) });
    return [build('favourites', '★ Favourites', library.favourites), ...library.collections.map((c) => build(c.id, `▸ ${c.name}`, c.items))];
  }

  return { keyOf, isKey, ShuffleBag, MusicalChangeDetector, AutoDirector, TRANSITIONS, TRANSITION_NAMES, pickTransition, transitionStyle, toggleKey, newCollectionId, virtualCollections, ease };
});
