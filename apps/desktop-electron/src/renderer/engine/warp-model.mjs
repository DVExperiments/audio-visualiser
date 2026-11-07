// Wave-and-warp engine model (pure; no Three.js — tested in node).
//
// The classic player-visualiser recipe, one display frame at a time:
//   1. take the previous frame and WARP it (zoom, rotate, stretch, drift, swirl, noise)
//   2. FADE each colour channel at its own rate (this, not a palette, makes fire and ice gradients)
//   3. FOLD it for symmetry (mirror, four-fold, kaleidoscope)
//   4. DRAW the current audio waveform on top (lines, rings, Lissajous), plus sparkles
//   5. PRESENT with an optional mask (dark disc, lens) and a soft tone curve
// Every number the shader receives comes from computeWarp(); the "How it works" panel builds its
// equations and live values from the same function, so the explanation cannot drift from the code.

/** A parameter is a number or {base, bass?, mid?, high?, level?, kick?, body?}: base + Σ coef·drive. */
export function evalParam(p, drives) {
  if (typeof p === 'number') return p;
  let v = p.base ?? 0;
  for (const k of ['bass', 'mid', 'high', 'level', 'kick', 'body']) if (p[k]) v += p[k] * (drives[k] ?? 0);
  return v;
}

const SYM = { none: 0, mirrorX: 1, mirrorY: 2, quad: 3, kaleido: 4 };

export const WARP_DEFAULTS = Object.freeze({
  zoom: 0, zoomExp: 0, rot: 0, sx: 0, sy: 0, dx: 0, dy: 0, swirl: 0,
  noise: 0, noiseScale: 3, noiseSpeed: 0.3,
  half: [0.5, 0.5, 0.5], floor: 0.05,
  sym: 'none', fold: 4, symRot: 0,
  sparkle: 0, sparkleColor: [0.8, 0.9, 1.0],
  mask: null,                 // { r, soft, stretch: [sx, sy], color: [r,g,b] }
  exposure: 1.3, deposit: 3.0, head: 0.5,
});

/** All live numbers for a preset at the current drives (feeds both the shader and the explanation). */
export function computeWarp(def, drives) {
  const d = { ...WARP_DEFAULTS, ...def.warp };
  const out = {};
  for (const k of ['zoom', 'zoomExp', 'rot', 'sx', 'sy', 'dx', 'dy', 'swirl', 'noise', 'noiseScale', 'noiseSpeed', 'floor', 'sparkle', 'symRot']) out[k] = evalParam(d[k], drives);
  out.half = d.half.map((h) => Math.max(0.02, evalParam(h, drives)));
  out.sym = SYM[d.sym]; out.symName = d.sym; out.fold = d.fold;
  out.sparkleColor = d.sparkleColor; out.mask = d.mask;
  out.exposure = d.exposure; out.deposit = d.deposit; out.head = d.head;
  out.waves = (def.waves || []).map((w) => ({
    ...w, amp: evalParam(w.amp ?? 1, drives), width: evalParam(w.width ?? 0.004, drives),
    bright: evalParam(w.bright ?? 1, drives), at: evalParam(w.at ?? 0, drives),
  }));
  return out;
}

// ---------------------------------------------------------------- symmetry
/**
 * 2×2 matrices [a, b, c, d] (x' = a·x + b·y, y' = c·x + d·y) of the symmetry group, used to draw
 * mirrored copies of the waveform so the crisp "head" pass is as symmetric as the folded buffer.
 * kaleido N: the dihedral group D_N — N rotations by 2πk/N and N reflections across the lines at
 * angle π/N + 2πk/N (the GLSL fold maps every angle into the wedge [0, π/N]).
 */
export function symmetryMatrices(sym, fold = 4, rot = 0) {
  const base = symmetryMatricesUnrotated(sym, fold);
  if (!rot) return base;
  // the shader folds R(rot)·p and rotates back, so the group is conjugated: R(−rot)·M·R(rot)
  const c = Math.cos(rot), s = Math.sin(rot);
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  return base.map((M) => mul(mul([c, s, -s, c], M), [c, -s, s, c]));
}

function symmetryMatricesUnrotated(sym, fold) {
  const I = [1, 0, 0, 1];
  switch (sym) {
    case 'mirrorX': return [I, [-1, 0, 0, 1]];
    case 'mirrorY': return [I, [1, 0, 0, -1]];
    case 'quad': return [I, [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1]];
    case 'kaleido': {
      const out = [], a = Math.PI / fold;
      const S = [Math.cos(2 * a), Math.sin(2 * a), Math.sin(2 * a), -Math.cos(2 * a)];   // reflect across angle π/N
      for (let k = 0; k < fold; k++) {
        const t = (2 * Math.PI * k) / fold, c = Math.cos(t), s = Math.sin(t);
        out.push([c, -s, s, c]);
        out.push([c * S[0] - s * S[2], c * S[1] - s * S[3], s * S[0] + c * S[2], s * S[1] + c * S[3]]);
      }
      return out;
    }
    default: return [I];
  }
}

/** JS twin of the GLSL fold: map a point into the fundamental domain of the symmetry. */
export function foldPoint(x, y, sym, fold = 4, rot = 0) {
  if (rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const [fx, fy] = foldPoint(c * x - s * y, s * x + c * y, sym, fold, 0);
    return [c * fx + s * fy, -s * fx + c * fy];
  }
  switch (sym) {
    case 'mirrorX': return [Math.abs(x), y];
    case 'mirrorY': return [x, Math.abs(y)];
    case 'quad': return [Math.abs(x), Math.abs(y)];
    case 'kaleido': {
      const seg = Math.PI / fold, r = Math.hypot(x, y);
      let a = Math.atan2(y, x); a = ((a % (2 * seg)) + 2 * seg) % (2 * seg); a = Math.abs(a - seg);
      return [r * Math.cos(a), r * Math.sin(a)];
    }
    default: return [x, y];
  }
}

/**
 * JS twin of the shader's warp (without noise): pixel p fetches its colour from q.
 * If q is nearer the centre than p, the picture moves OUTWARD; if farther, it moves inward.
 */
export function warpSample(x, y, w, dt) {
  const r = Math.hypot(x, y);
  let c = Math.cos(-w.rot * dt), s = Math.sin(-w.rot * dt);
  let qx = c * x - s * y, qy = s * x + c * y;
  qx *= Math.exp(-w.sx * dt); qy *= Math.exp(-w.sy * dt);
  const z = Math.exp(-w.zoom * Math.pow(Math.max(r, 1e-3), w.zoomExp) * dt);
  qx *= z; qy *= z;
  qx -= w.dx * dt; qy -= w.dy * dt;
  const a = w.swirl * dt * (1 - smoothstep(0, 1.5, r));
  c = Math.cos(a); s = Math.sin(a);
  return [c * qx - s * qy, s * qx + c * qy];
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Colour of a pure-white pixel after t seconds of per-channel fading (explains the gradient). */
export function ageColour(half, floor, t) {
  return half.map((h) => {
    const k = Math.LN2 / h, q = floor / k;
    return Math.max(0, (1 + q) * Math.exp(-k * t) - q);
  });
}

/** Plain-language name of the colour journey implied by per-channel half-lives. */
export function describeDecay(half) {
  const [r, g, b] = half, names = ['red', 'green', 'blue'];
  const order = [0, 1, 2].sort((i, j) => half[j] - half[i]).map((i) => names[i]);
  if (Math.max(r, g, b) / Math.min(r, g, b) < 1.15) return 'all channels fade together, so trails keep their colour while they darken';
  if (r >= g && g >= b) return 'red outlasts green, which outlasts blue: a white line ages white → yellow → orange → red → black, the fire gradient';
  if (b >= g && g >= r) return 'blue outlasts green, which outlasts red: a white line ages white → cyan → blue → black, the ice gradient';
  if (r >= b && b >= g) return 'red and blue outlast green: a white line ages white → pink → magenta → black';
  if (b >= r && r >= g) return 'blue outlasts red, red outlasts green: a white line ages white → lavender → violet → blue → black';
  if (g >= b && b >= r) return 'green and blue outlast red: a white line ages white → aqua → teal → black';
  return `the longest-lived channel is ${order[0]}, then ${order[1]}: trails drift toward ${order[0]} as they age`;
}

// ---------------------------------------------------------------- the looks
// Each preset reproduces one of the looks you sent, by combining the ingredients above.
const W = (mode, o = {}) => ({ mode, ...o });

export const WARP_PRESETS = [
  { id: 'blue-starburst', name: 'Blue Starburst', scheme: 'frost', look: 'radial streaks of blue light and glitter bursting from a dark centre',
    waves: [W('circle', { at: { base: 0.22, bass: 0.1 }, amp: 0.8, width: 0.004, bright: { base: 0.8, level: 1.2 } })],
    warp: { zoom: { base: 0.5, bass: 1.6 }, zoomExp: 1, rot: 0.15, half: [0.25, 0.45, 0.9], floor: 0.04, sym: 'quad', sparkle: { base: 3, high: 30 }, sparkleColor: [0.6, 0.8, 1.0], mask: { r: 0.1, soft: 0.12, stretch: [1, 1.6], color: [0, 0, 0] } } },
  { id: 'ghost-wires', name: 'Ghost Wires', scheme: 'ice', look: 'faint lavender wires drifting upward like smoke',
    waves: [W('vline', { at: -0.45, amp: 0.9, width: 0.002 }), W('vline', { at: 0, amp: 1.1, width: 0.0025 }), W('vline', { at: 0.45, amp: 0.9, width: 0.002 })],
    warp: { dy: { base: 0.1, mid: 0.2 }, noise: { base: 0.4, mid: 0.4 }, noiseScale: 3, half: [0.9, 0.9, 1.6], floor: 0.015 } },
  { id: 'copper-flame', name: 'Copper Flame', scheme: 'flare', look: 'mirrored copper flames licking away from a horizontal line',
    waves: [W('hline', { at: 0.25, amp: 1.1, width: 0.004, bright: { base: 1, level: 1 } })],
    warp: { dy: { base: 0.45, bass: 0.5 }, noise: { base: 0.9, mid: 0.6 }, noiseScale: 4, noiseSpeed: 0.6, half: [1.3, 0.5, 0.15], floor: 0.02, sym: 'quad' } },
  { id: 'crimson-tunnel', name: 'Crimson Tunnel', scheme: 'rose', look: 'textured magenta tunnel walls streaming out of a bright core',
    waves: [W('circle', { at: 0.14, amp: 1.0, width: 0.005, bright: { base: 1.1, level: 1.2 } })],
    warp: { zoom: { base: 0.9, bass: 1.2 }, zoomExp: 0.25, rot: { base: 0.5, mid: 0.6 }, noise: 0.6, noiseScale: 6, half: [1.4, 0.35, 0.9], floor: 0.015 } },
  { id: 'cobalt-cross', name: 'Cobalt Cross', scheme: 'frost', look: 'a deep-blue cross of streaks exploding along the axes',
    waves: [W('hline', { at: 0, amp: 0.6, width: 0.003 }), W('vline', { at: 0, amp: 0.6, width: 0.003 })],
    warp: { zoom: { base: 0.6, bass: 1.6 }, zoomExp: 0.5, half: [0.18, 0.32, 0.85], floor: 0.05, sym: 'quad' } },
  { id: 'violet-streams', name: 'Violet Streams', scheme: 'ultraviolet', look: 'vertical violet streaks pouring downward',
    waves: [W('vline', { at: -0.3, amp: 2.2, width: 0.004 }), W('vline', { at: 0.3, amp: 2.2, width: 0.004 })],
    warp: { dy: { base: -0.7, bass: -0.8 }, sx: 0.15, noise: 0.5, noiseScale: 3, half: [0.9, 0.3, 1.4], floor: 0.015, sym: 'mirrorX' } },
  { id: 'neon-waveline', name: 'Neon Waveline', scheme: 'rose', look: 'one white-hot waveform smearing sideways into pink and red',
    waves: [W('hline', { at: 0, amp: { base: 1.2, bass: 0.6 }, width: { base: 0.005, level: 0.006 }, bright: { base: 1.2, level: 1 } })],
    warp: { sx: { base: 0.6, bass: 0.8 }, dy: { base: 0.15, bass: 0.25 }, noise: 0.35, noiseScale: 4, half: [1.1, 0.3, 0.45], floor: 0.02, sym: 'mirrorY' } },
  { id: 'teal-vortex', name: 'Teal Vortex', scheme: 'teal', look: 'a teal whirlpool of torn waveform',
    waves: [W('circle', { at: 0.5, amp: 1.6, width: 0.004 })],
    warp: { swirl: { base: 2.0, mid: 1.6 }, zoom: 0.35, noise: { base: 0.5, high: 0.4 }, noiseScale: 5, half: [0.3, 1.2, 1.4], floor: 0.015 } },
  { id: 'violet-lens', name: 'Violet Lens', scheme: 'ultraviolet', look: 'mirrored violet waveforms framing a dark lens',
    waves: [W('hline', { at: 0.32, amp: 1.2, width: 0.003, bright: { base: 1, level: 1 } })],
    warp: { sx: { base: 0.35, bass: 0.5 }, dy: 0.35, noise: 0.3, half: [1.0, 0.4, 1.3], floor: 0.02, sym: 'mirrorY', mask: { r: 0.3, soft: 0.12, stretch: [0.45, 1.6], color: [0, 0, 0] } } },
  { id: 'ion-storm', name: 'Ion Storm', scheme: 'rose', look: 'jagged red and white lightning in four-fold symmetry',
    waves: [W('hline', { at: 0.18, amp: { base: 1.8, high: 1.2 }, width: 0.0025, bright: { base: 1.3, level: 1 } }), W('vline', { at: 0.18, amp: 1.4, width: 0.0025 })],
    warp: { zoom: { base: 0.3, bass: 1.2 }, half: [0.45, 0.15, 0.2], floor: 0.06, sym: 'quad' } },
  { id: 'midnight-star', name: 'Midnight Star', scheme: 'frost', look: 'a soft four-pointed star glowing on midnight blue',
    waves: [W('circle', { at: 0.3, amp: 0.8, width: 0.004, bright: 0.8 })],
    warp: { zoom: { base: 0.8, bass: 1.4 }, zoomExp: 1.2, half: [0.4, 0.6, 1.4], floor: 0.02, sym: 'kaleido', fold: 4, symRot: 0.7853981634 } },
  { id: 'solar-flare', name: 'Solar Flare', scheme: 'flare', look: 'an orange and yellow explosion of fiery rays',
    waves: [W('circle', { at: { base: 0.12, bass: 0.08 }, amp: 1.0, width: 0.005, bright: { base: 1.2, level: 1.2 } })],
    warp: { zoom: { base: 0.8, bass: 2.0 }, zoomExp: 0.6, rot: 0.03, noise: 0.15, half: [1.3, 0.55, 0.15], floor: 0.03, sparkle: { base: 2, high: 20 }, sparkleColor: [1.0, 0.8, 0.4] } },
  { id: 'ultraviolet-swirl', name: 'Ultraviolet Swirl', scheme: 'ultraviolet', look: 'a white waveform stirred into swirling violet liquid',
    waves: [W('hline', { at: 0, amp: 1.4, width: 0.003, bright: { base: 1.2, level: 0.8 } })],
    warp: { swirl: { base: 1.4, mid: 1.4 }, zoom: 0.1, noise: { base: 0.8, mid: 0.5 }, noiseScale: 2.5, half: [0.9, 0.4, 1.5], floor: 0.015 } },
  { id: 'cyan-clover', name: 'Cyan Clover', scheme: 'teal', look: 'a bright cyan four-leaf figure folded from a swirling waveform ring',
    waves: [W('circle', { at: 0.35, amp: 1.4, width: 0.004, bright: { base: 1, level: 1 } })],
    warp: { swirl: { base: 0.8, mid: 1.0 }, rot: 0.3, zoom: 0.3, noise: 0.3, noiseScale: 4, half: [0.3, 1.0, 1.3], floor: 0.02, sym: 'quad' } },
  { id: 'eclipse', name: 'Eclipse', scheme: 'rose', look: 'pink fire streaming from the rim of a black disc',
    waves: [W('circle', { at: 0.42, amp: 0.7, width: 0.004, bright: { base: 1, level: 1 } })],
    warp: { zoom: { base: 0.45, bass: 0.6 }, noise: { base: 0.7, mid: 0.5 }, noiseScale: 6, noiseSpeed: 0.7, half: [1.0, 0.35, 0.7], floor: 0.02, mask: { r: 0.38, soft: 0.03, stretch: [1, 1], color: [0, 0, 0] } } },
  { id: 'frost-cross', name: 'Frost Cross', scheme: 'frost', look: 'an icy, glittering cross',
    waves: [W('hline', { at: 0, amp: 0.5, width: 0.003 }), W('vline', { at: 0, amp: 0.5, width: 0.003 })],
    warp: { zoom: { base: 0.4, bass: 1.0 }, noise: 0.2, noiseScale: 6, half: [0.25, 0.6, 1.0], floor: 0.04, sym: 'quad', sparkle: { base: 4, high: 30 } } },
  { id: 'amethyst-kaleido', name: 'Amethyst Kaleido', scheme: 'ultraviolet', look: 'a jagged violet-pink kaleidoscope diamond',
    waves: [W('circle', { at: 0.22, amp: 1.6, width: 0.003, bright: { base: 1, level: 1 } })],
    warp: { swirl: { base: 0.9, mid: 1.0 }, noise: 0.5, noiseScale: 4, zoom: { base: 0.5, bass: 0.8 }, half: [1.0, 0.4, 1.4], floor: 0.015, sym: 'kaleido', fold: 4, symRot: 0.7853981634 } },
];

// ---------------------------------------------------------------- explanation
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const tex = (x) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(2));
/** "base + coef·drive" as plain text, for the panel's prose and tables. */
function paramPlain(p) {
  if (typeof p === 'number') return tex(p);
  const parts = [tex(p.base ?? 0)];
  for (const k of ['bass', 'mid', 'high', 'level', 'kick', 'body']) if (p[k]) parts.push(`${p[k] < 0 ? '−' : '+'} ${Math.abs(p[k]).toFixed(2)}·${k}`);
  return parts.join(' ');
}

/**
 * Build the "How it works" spec for a warp preset. Static TeX comes from the preset's own
 * parameters; live values are closures over the latest computeWarp() result (get()).
 */
export function explainWarp(def, get) {
  const w = { ...WARP_DEFAULTS, ...def.warp };
  const steps = [];
  // 1. waveform
  const waveTex = {
    hline: 'y_i = y_0 + g\\,a\\,w_i\\,T(s_i), \\quad x_i = -X + 2X s_i',
    vline: 'x_i = x_0 + g\\,a\\,w_i\\,T(s_i), \\quad y_i = -1 + 2 s_i',
    circle: 'r_i = r_0 + g\\,a\\,w_i\\,T(s_i), \\quad \\phi_i = 2\\pi s_i',
    xy: '(x_i, y_i) = 2.5\\,g\\,a\\,(w_i,\\ w_{i+\\ell}),\\qquad \\ell = 37\\ \\text{samples}',
  };
  const modes = [...new Set((def.waves || []).map((x) => x.mode))];
  steps.push({
    title: 'Draw the waveform',
    why: `The shape seeded every frame is the music's own waveform (the last 1024 samples), drawn as ${modes.map((m) => ({ hline: 'a horizontal line', vline: 'a vertical line', circle: 'a ring', xy: 'a phase portrait (each sample plotted against the one 37 samples later, which draws loops even for mono music)' }[m])).join(' and ')}. g is an automatic gain that keeps quiet and loud music the same size; T is a taper that pins both ends so rings close without a seam.`,
    tex: [...modes.map((m) => waveTex[m]), 'T(s) = \\tfrac12\\bigl(1 - \\cos(\\pi s/\\tau)\\bigr)\\ \\text{near the ends},\\ 1\\ \\text{elsewhere}'],
    vars: [['a', 'wave amplitude', () => f2(get().waves[0]?.amp)], ['g', 'automatic display gain', () => f2(get().gain)], ['\\text{brightness}', 'line brightness', () => f2(get().waves[0]?.bright)]],
  });
  // 2. warp
  const terms = [], wv = [];
  if (w.rot) { terms.push('R(-\\omega\\,\\Delta t)'); wv.push(['\\omega', `rotation (rad/s) = ${paramPlain(w.rot)}`, () => f2(get().rot)]); }
  if (w.sx || w.sy) { terms.push('\\operatorname{diag}\\!\\bigl(e^{-s_x\\Delta t}, e^{-s_y\\Delta t}\\bigr)'); wv.push(['s_x, s_y', `stretch (1/s); > 0 spreads outward along that axis, < 0 squeezes toward it = ${paramPlain(w.sx)}, ${paramPlain(w.sy)}`, () => `${f2(get().sx)}, ${f2(get().sy)}`]); }
  if (w.zoom) { terms.push(w.zoomExp ? 'e^{-z\\,r^{\\gamma}\\,\\Delta t}' : 'e^{-z\\,\\Delta t}'); wv.push(['z', `zoom (1/s); > 0 flies outward, < 0 recedes = ${paramPlain(w.zoom)}`, () => f2(get().zoom)]); if (w.zoomExp) wv.push(['\\gamma', 'zoom grows with distance r from the centre (makes rays)', () => f2(get().zoomExp)]); }
  let warpTex = `\\mathbf{q} = ${terms.length ? terms.join('\\,') : ''}\\,\\mathbf{p}`;
  if (w.dx || w.dy) { warpTex += ' - \\Delta t\\,(d_x, d_y)'; wv.push(['d_x, d_y', `drift (units/s); d_y > 0 moves the picture up = ${paramPlain(w.dx)}, ${paramPlain(w.dy)}`, () => `${f2(get().dx)}, ${f2(get().dy)}`]); }
  const extra = [];
  if (w.swirl) { extra.push('\\mathbf{q} \\leftarrow R\\bigl(\\sigma\\,\\Delta t\\,(1 - \\mathrm{smoothstep}(0, 1.5, r))\\bigr)\\,\\mathbf{q}'); wv.push(['\\sigma', `swirl (rad/s), strongest at the centre = ${paramPlain(w.swirl)}`, () => f2(get().swirl)]); }
  if (w.noise) { extra.push('\\mathbf{q} \\leftarrow \\mathbf{q} + \\nu\\,\\Delta t\\,\\bigl(n(k\\mathbf{q} + ut) - \\tfrac12\\bigr)'); wv.push(['\\nu', `noise warp strength = ${paramPlain(w.noise)}`, () => f2(get().noise)], ['k', 'noise scale (bigger = finer turbulence)', () => f2(get().noiseScale)]); }
  steps.push({
    title: 'Warp the previous frame',
    why: 'Each pixel p fetches its colour from position q in the previous frame. Sampling nearer the centre (z > 0) makes everything fly outward, leaving streaks and rays; sampling farther out (z < 0) makes it recede like a tunnel. Drift smears trails in one direction (flames rise), stretch smears them along an axis, swirl twists them and noise tears them into smoke. All rates multiply Δt, so the motion is identical at 60 or 144 Hz.',
    tex: [warpTex, ...extra], vars: [['\\Delta t', 'frame time (s)', () => f2(get().dt)], ...wv],
  });
  // 3. fade
  steps.push({
    title: 'Fade each colour channel at its own rate',
    why: `Every channel decays toward true black with its own half-life h_k. Here h = (${w.half.map(paramPlain).join(', ')}) s for red, green and blue: ${describeDecay(w.half.map((h) => evalParam(h, {})))}. This is where the colours of the trails come from.`,
    tex: ['c_k \\leftarrow \\max\\!\\bigl((c_k + q_k)\\,e^{-\\lambda_k \\Delta t} - q_k,\\ 0\\bigr), \\qquad \\lambda_k = \\frac{\\ln 2}{h_k},\\quad q_k = \\frac{f}{\\lambda_k}',
      '\\text{exact solution of}\\ \\frac{dc_k}{dt} = -\\lambda_k c_k - f\\ \\text{over one frame: reaches 0 in}\\ t^* = \\frac{1}{\\lambda_k}\\ln\\!\\Bigl(1 + \\frac{c_k\\lambda_k}{f}\\Bigr)'],
    vars: [['h_r, h_g, h_b', 'half-lives (s)', () => get().half.map(f2).join(', ')], ['f', 'drain to black (1/s)', () => f2(get().floor)]],
  });
  // 4. symmetry
  if (w.sym !== 'none') {
    const symTex = {
      mirrorX: '(x, y) \\mapsto (|x|,\\ y)', mirrorY: '(x, y) \\mapsto (x,\\ |y|)', quad: '(x, y) \\mapsto (|x|,\\ |y|)',
      kaleido: `\\phi \\mapsto \\bigl|\\,(\\phi \\bmod 2\\alpha) - \\alpha\\,\\bigr|, \\qquad \\alpha = \\pi/${w.fold}`,
    }[w.sym];
    steps.push({
      title: 'Fold for symmetry',
      why: { mirrorX: 'Left and right are mirror images.', mirrorY: 'Top and bottom are mirror images.', quad: 'Both axes are mirrors, so every quarter of the screen is the same picture: four-fold symmetry.', kaleido: `A ${2 * w.fold}-wedge kaleidoscope: angles are folded into one wedge and mirrored (the dihedral group D${w.fold}).` }[w.sym] +
        ' The fold is applied when sampling the previous frame and again when presenting, and the waveform is drawn in every mirrored position, so the symmetry is exact.',
      tex: [symTex], vars: [],
    });
  }
  if (w.sparkle) steps.push({
    title: 'Sparkles',
    why: 'Glitter: each 3×3-pixel cell lights up at random with probability ρΔt/500 per frame, so the expected number per second is the same at any frame rate. Treble raises ρ.',
    tex: ['P(\\text{cell sparkles this frame}) = \\rho\\,\\Delta t / 500'], vars: [['\\rho', `sparkles per second per 500 cells = ${paramPlain(w.sparkle)}`, () => f2(get().sparkle)]],
  });
  if (w.mask) steps.push({
    title: w.mask.color.every((c) => c === 0) ? 'Dark mask' : 'Glowing core',
    why: 'A smooth elliptical mask is applied when presenting, so its edge stays crisp while everything around it streams past.',
    tex: [`m = \\mathrm{smoothstep}\\bigl(${tex(w.mask.r)},\\ ${tex(w.mask.r + w.mask.soft)},\\ \\lVert (${tex(w.mask.stretch[0])}x,\\ ${tex(w.mask.stretch[1])}y) \\rVert\\bigr),\\quad c \\leftarrow m\\,c + (1-m)\\,c_{\\text{mask}}`], vars: [],
  });
  steps.push({
    title: 'Present',
    why: 'A soft tone curve lets bright overlaps saturate gracefully instead of clipping, then sRGB gamma.',
    tex: ['c_{\\text{screen}} = \\bigl(1 - e^{-E\\,c}\\bigr)^{1/2.2}'], vars: [['E', 'exposure', () => f2(get().exposure)]],
  });
  return { title: def.name, summary: `Looks like ${def.look}.`, steps };
}
