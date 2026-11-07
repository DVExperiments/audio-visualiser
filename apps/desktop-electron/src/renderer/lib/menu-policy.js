/* When the control bar is visible (v0.13). Pure state machine: window.MenuPolicy and node tests.
 *   auto:   shows on any mouse movement or key, hides after `idleMs` without activity
 *   always: always visible
 *   hidden: mouse movement never shows it; M (reveal) or the bottom edge (if enabled) shows it,
 *           then it hides `idleMs` after the last interaction with it
 * While the pointer is over the bar, or a menu panel is open, it never hides. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenuPolicy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EDGE_PX = 6;

  class MenuController {
    constructor({ mode = 'auto', edgeReveal = true, idleMs = 3000 } = {}) {
      Object.assign(this, { mode, edgeReveal, idleMs });
      this.lastActive = -Infinity;    // last time something that may show the bar happened
      this.forcedHidden = false;      // H: hide now until the next qualifying activity
    }
    configure(o) { Object.assign(this, o); }
    /** Pointer moved to y (CSS px) in a window `height` tall. */
    pointer(y, height, now) {
      const atEdge = y >= height - EDGE_PX;
      if (this.mode === 'hidden' && !(this.edgeReveal && atEdge)) return;
      this.forcedHidden = false; this.lastActive = now;
    }
    /** A key that controls the app (not M/H). In hidden mode keys do not reveal the bar. */
    key(now) { if (this.mode === 'auto') { this.forcedHidden = false; this.lastActive = now; } }
    /** M: show the bar now (any mode). */
    reveal(now) { this.forcedHidden = false; this.lastActive = now; }
    /** H: hide the bar now. */
    hide() { this.forcedHidden = true; this.lastActive = -Infinity; }
    /** busy = pointer over the bar, or a menu panel open, or a list/field focused. */
    visible(now, busy = false) {
      if (this.mode === 'always') return !this.forcedHidden || busy;
      if (busy) { this.lastActive = now; return true; }
      if (this.forcedHidden) return false;
      return now - this.lastActive < this.idleMs;
    }
  }
  return { MenuController, EDGE_PX };
});
