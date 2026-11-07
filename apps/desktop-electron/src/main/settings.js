'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_VERSION = 5;   // v5 (0.20): ui.style ('classic' | 'modern'), ui.theme ('dark' | 'light')   // v4 (0.13): ui.menu ('auto' | 'always' | 'hidden'), ui.edgeReveal, ui.startFullscreen   // v2 (app 0.11): auto, library, ui.autoHide. v3 (0.12): influence, per-input audio profiles
const KEY_RE = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/;
const TRANSITIONS = ['mixed', 'crossfade', 'blend', 'iris', 'wipe', 'clock'];

const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  input: { source: 'loopback', deviceId: null, signal: 'beat' },
  collection: 'bars-waves',
  preset: 'instruments',
  ui: { diagnostics: false, limitFlashes: true, mode: 'classic', autoHide: true, menu: 'auto', edgeReveal: true, startFullscreen: false, style: 'classic', theme: 'dark' },
  auto: { enabled: false, mode: 'music', minutes: 3, pool: 'all', transition: 'mixed', seconds: 2.5 },
  library: { favourites: [], collections: [] },
  influence: { shape: 1, motion: 1, colour: 1 },
  audio: { profiles: {} },
  window: { bounds: null, displayId: null, fullscreen: false },
});

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Merge stored values onto defaults, keeping only known keys with the right types. */
function sanitize(raw) {
  const s = clone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return s;
  // future: migrate older versions here (raw.version < SETTINGS_VERSION)
  const inp = raw.input || {};
  if (['loopback', 'input', 'synthetic'].includes(inp.source)) s.input.source = inp.source;
  if (typeof inp.deviceId === 'string' && inp.deviceId.length <= 512) s.input.deviceId = inp.deviceId;
  if (typeof inp.signal === 'string' && inp.signal.length <= 32) s.input.signal = inp.signal;
  if (typeof raw.collection === 'string' && raw.collection.length <= 64) s.collection = raw.collection;
  if (typeof raw.preset === 'string' && raw.preset.length <= 64) s.preset = raw.preset;
  const ui = raw.ui || {};
  if (typeof ui.diagnostics === 'boolean') s.ui.diagnostics = ui.diagnostics;
  if (typeof ui.limitFlashes === 'boolean') s.ui.limitFlashes = ui.limitFlashes;
  if (ui.mode === 'classic' || ui.mode === 'advanced') s.ui.mode = ui.mode;
  if (typeof ui.autoHide === 'boolean') s.ui.autoHide = ui.autoHide;
  // v4: menu mode; older files map autoHide → 'auto' / 'always'
  if (['auto', 'always', 'hidden'].includes(ui.menu)) s.ui.menu = ui.menu;
  else if (ui.autoHide === false) s.ui.menu = 'always';
  if (typeof ui.edgeReveal === 'boolean') s.ui.edgeReveal = ui.edgeReveal;
  if (typeof ui.startFullscreen === 'boolean') s.ui.startFullscreen = ui.startFullscreen;
  if (ui.style === 'classic' || ui.style === 'modern') s.ui.style = ui.style;
  if (ui.theme === 'dark' || ui.theme === 'light') s.ui.theme = ui.theme;
  // v1 files have no auto/library sections: the defaults above stand in (migration)
  const a = raw.auto || {};
  if (typeof a.enabled === 'boolean') s.auto.enabled = a.enabled;
  if (a.mode === 'timer' || a.mode === 'music') s.auto.mode = a.mode;
  if (Number.isFinite(a.minutes)) s.auto.minutes = Math.min(30, Math.max(0.5, a.minutes));
  if (['all', 'favourites', 'collection'].includes(a.pool)) s.auto.pool = a.pool;
  if (TRANSITIONS.includes(a.transition)) s.auto.transition = a.transition;
  if (Number.isFinite(a.seconds)) s.auto.seconds = Math.min(8, Math.max(0.3, a.seconds));
  const inf = raw.influence || {};
  for (const k of ['shape', 'motion', 'colour']) if (Number.isFinite(inf[k])) s.influence[k] = Math.min(2, Math.max(0, inf[k]));
  const profiles = raw.audio?.profiles;
  if (profiles && typeof profiles === 'object') {
    for (const [key, p] of Object.entries(profiles).slice(0, 30)) {
      if (!/^(loopback|input|synthetic):[^\u0000-\u001f]{1,300}$/.test(key) || !p || typeof p !== 'object') continue;
      const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
      s.audio.profiles[key] = { gainDb: num(p.gainDb, -24, 36, 0), noiseFloorDb: num(p.noiseFloorDb, -100, -20, -70), pulseRangeDb: num(p.pulseRangeDb, 3, 16, 8), smoothing: num(p.smoothing, 0.5, 2, 1) };
    }
  }
  const lib = raw.library || {};
  const keys = (list) => (Array.isArray(list) ? [...new Set(list.filter((k) => typeof k === 'string' && KEY_RE.test(k)))].slice(0, 500) : []);
  s.library.favourites = keys(lib.favourites);
  if (Array.isArray(lib.collections)) {
    s.library.collections = lib.collections
      .filter((c) => c && typeof c.id === 'string' && /^user-[a-z0-9-]{1,40}$/.test(c.id) && typeof c.name === 'string')
      .slice(0, 50)
      .map((c) => ({ id: c.id, name: c.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'My mix', items: keys(c.items) }));
  }
  const w = raw.window || {};
  const b = w.bounds;
  if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 320 && b.height >= 240) {
    s.window.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  if (Number.isFinite(w.displayId)) s.window.displayId = w.displayId;
  if (typeof w.fullscreen === 'boolean') s.window.fullscreen = w.fullscreen;
  return s;
}

class SettingsStore {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = clone(DEFAULTS);
    this.timer = null;
  }

  load() {
    try { this.data = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch { this.data = clone(DEFAULTS); }
    return this.data;
  }

  update(patch) {
    this.data = sanitize(deepMerge(clone(this.data), patch));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
    return this.data;
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file); // atomic replace
    } catch (e) { console.error('settings write failed:', e.message); }
  }
}

function deepMerge(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

module.exports = { SettingsStore, sanitize, DEFAULTS, SETTINGS_VERSION };
