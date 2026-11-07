// Alchemy-inspired (v0.4): thin luminous curves on black that wander through shape "programs" —
// Lissajous figures, roses, spirograph hypo/epitrochoids — crossfading every 12–22 s on a strong
// beat, one saturated colour scheme at a time. Trails flow outward and fade to TRUE black.
// Original procedural work; evokes the family's character, copies nothing.
import { createFeedbackPreset, makeStrip, COMMON_MAPPINGS } from '../../engine/feedback.mjs';
import { writeStrip, stripIndex } from '../../engine/geometry2d.mjs';
import { ProgramCycler } from '../../engine/program.mjs';
import { writeCurve, spiralArm, SpectrumFollower } from './alchemy-model.mjs';

function flash(ctx, values, tick) {
  if (values.kick > 0 && tick.onsets > 0) ctx.state.flash = Math.max(ctx.state.flash || 0, ctx.env.flash.request(tick.nowSec, values.kick));
  ctx.state.flash = (ctx.state.flash || 0) * Math.exp(-tick.dt / 0.2);
  return ctx.state.flash;
}

/** Colour scheme follows the program cycler (crossfading with it). */
function applyScheme(ctx, programs) {
  const c = ctx.state.cycler, a = programs[c.current].scheme, b = programs[c.next].scheme;
  ctx.setScheme(a, c.fading ? b : a, c.fading ? c.weight : 0);
}

/** Brightness weight of program k during a crossfade. */
function programWeight(c, k) {
  if (!c.fading) return k === c.current ? 1 : 0;
  return k === c.current ? 1 - c.weight : k === c.next ? c.weight : 0;
}

const FEEDBACK_FLOW = /* glsl */`
  uniform float uZoom, uRot, uSwirl, uHalf, uFloor, uFlash;
  void main() {
    vec2 p = toP(vUv);
    vec2 q = rot(-uRot * uDt) * p * exp(-uZoom * uDt);
    q += uSwirl * uDt * vec2(sin(2.7 * q.y + 0.6 * uTime), cos(2.3 * q.x - 0.5 * uTime));
    vec3 c = fadeToBlack(prevAt(q), uHalf, uFloor);
    gl_FragColor = vec4(c + uFlash * 0.04 * grad(0.5) * smoothstep(1.4, 0.0, length(p)), 1.0);
  }`;

// ---------------------------------------------------------------- Liquid Ribbons
const RIBBON_PROGRAMS = [
  { family: 'lissajous', params: { a: 3, b: 2, phase: 0 }, scheme: 'electric', copies: 2, spin: 0.15 },
  { family: 'hypo', params: { R: 5, r: 3, d: 2.2 }, scheme: 'magma', copies: 1, spin: 0.25 },
  { family: 'rose', params: { k: 5 }, scheme: 'toxic', copies: 2, spin: -0.2 },
  { family: 'epi', params: { R: 3, r: 1, d: 1.4 }, scheme: 'violet', copies: 1, spin: 0.3 },
  { family: 'lissajous', params: { a: 5, b: 4, phase: 0.5 }, scheme: 'aqua', copies: 2, spin: -0.12 },
  { family: 'hypo', params: { R: 7, r: 4, d: 3 }, scheme: 'inferno', copies: 1, spin: 0.2 },
];
const N_CURVE = 900;

const liquidRibbons = () => createFeedbackPreset({
  seed: 101, mappings: COMMON_MAPPINGS, exposure: 1.1, deposit: 2.5, head: 0.5,
  uniforms: { uZoom: 0.1, uRot: 0.1, uSwirl: 0.05, uHalf: 0.4, uFloor: 0.12, uFlash: 0 },
  feedbackFS: FEEDBACK_FLOW,
  setup(ctx) {
    const st = ctx.state;
    st.cycler = new ProgramCycler(RIBBON_PROGRAMS.length, { seed: 11, minHold: 12, maxHold: 22, fade: 3 });
    st.pts = new Float32Array(N_CURVE * 2);
    st.phase = 0; st.wob = [0, 0, 0]; st.spin = RIBBON_PROGRAMS.map(() => 0);
    st.strips = RIBBON_PROGRAMS.map((p) => Array.from({ length: p.copies }, () => {
      const s = makeStrip(N_CURVE, true, { uHue: { value: 0 }, uBright: { value: 1 }, uSpread: { value: 0.35 } }, stripIndex);
      s.mesh.visible = false; ctx.scene.add(s.mesh); return s;
    }));
  },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.cycler.step(hop, v.kick);
    st.phase += (0.15 + 1.2 * v.mid) * hop;                  // the figure morphs faster with the mids
    st.wob[0] += 0.7 * hop; st.wob[1] -= 1.1 * hop; st.wob[2] += 1.7 * hop;
    RIBBON_PROGRAMS.forEach((p, k) => { st.spin[k] += p.spin * (0.5 + 1.5 * v.bass) * hop; });
  },
  frame(ctx, v, tick) {
    const st = ctx.state, U = ctx.uniforms, c = st.cycler;
    applyScheme(ctx, RIBBON_PROGRAMS);
    RIBBON_PROGRAMS.forEach((p, k) => {
      const w = programWeight(c, k);
      st.strips[k].forEach((s, copy) => {
        s.mesh.visible = w > 0.001;
        if (!s.mesh.visible) return;
        const params = p.family === 'lissajous' ? { ...p.params, phase: p.params.phase + st.phase + copy * Math.PI / 2 }
          : p.family === 'rose' ? p.params : { ...p.params, d: p.params.d * (1 + 0.15 * Math.sin(st.phase * 0.7)) };
        writeCurve(st.pts, N_CURVE, p.family, params, {
          radius: 0.62 + 0.28 * v.bass + 0.06 * v.body, xScale: Math.min(ctx.aspect, 1.5),
          rotation: st.spin[k] + copy * Math.PI / Math.max(2, p.copies),
          wobble: [0.10 * v.bass, 0.07 * v.mid, 0.05 * v.high], wobblePhase: st.wob,
        });
        writeStrip(st.pts, N_CURVE, 0.0022 + 0.004 * v.level, true, s.out);
        s.commit();
        const u = s.mesh.material.uniforms;
        u.uHue.value = 0.12 + 0.25 * v.hue + 0.2 * v.level + copy * 0.12;   // louder / brighter timbre → hotter colours
        u.uBright.value = (0.6 + 1.6 * v.level) * w;
      });
    });
    U.uZoom.value = 0.05 + 0.55 * v.bass;
    U.uRot.value = 0.08 + 0.5 * v.balance;
    U.uSwirl.value = 0.03 + 0.25 * v.mid;
    U.uHalf.value = 0.3 + 0.35 * v.body;
    U.uFlash.value = flash(ctx, v, tick);
  },
  diagnostics: (ctx) => {
    const c = ctx.state.cycler, p = RIBBON_PROGRAMS[c.current];
    return [['Program', `${c.current + 1}/${RIBBON_PROGRAMS.length}: ${p.family}, ${p.scheme}${c.fading ? ' (crossfading)' : ''}`], ['Program switches', String(c.switches)]];
  },
});

// ---------------------------------------------------------------- Spiral Elixir
const SPIRAL_PROGRAMS = [
  { arms: 5, turns: 1.3, dir: 1, scheme: 'magma' },
  { arms: 3, turns: 1.8, dir: -1, scheme: 'electric' },
  { arms: 7, turns: 1.0, dir: 1, scheme: 'toxic' },
  { arms: 4, turns: 1.5, dir: -1, scheme: 'ice' },
];
const N_ARM = 220;

const spiralElixir = () => createFeedbackPreset({
  seed: 202, mappings: COMMON_MAPPINGS, exposure: 1.1, deposit: 2.5, head: 0.45,
  uniforms: { uTwist: 0.5, uPull: 0.1, uHalf: 1.0, uFloor: 0.03, uFlash: 0, uBase: 0.2 },
  // vortex: rotation ∝ 1/(0.25 + r) (inner turns faster) and an inward pull — trails wind inward.
  // v0.7: a slow nebula in the scheme's colours is injected per second underneath, so there is no
  // blank space (you found too much black); longer trails and wider arms fill the rest.
  feedbackFS: /* glsl */`
    uniform float uTwist, uPull, uHalf, uFloor, uFlash, uBase;
    void main() {
      vec2 p = toP(vUv);
      float r = length(p);
      vec2 q = rot(uTwist * uDt / (0.25 + r)) * p * exp(uPull * uDt);
      vec3 c = fadeToBlack(prevAt(q), uHalf, uFloor);
      float n = fbm(1.6 * rot(0.05 * uTime) * q + vec2(0.04 * uTime, -0.03 * uTime));
      c += uBase * uDt * grad(0.05 + 0.35 * n) * (0.1 + 2.2 * n * n);   // squared: clouds with darker gaps, not a flat wash
      gl_FragColor = vec4(c + uFlash * 0.04 * grad(0.5) * smoothstep(1.0, 0.0, r), 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    st.cycler = new ProgramCycler(SPIRAL_PROGRAMS.length, { seed: 22, minHold: 14, maxHold: 24, fade: 3 });
    st.pts = new Float32Array(N_ARM * 2); st.w = new Float32Array(N_ARM);
    st.rotation = 0;
    st.pulses = new SpectrumFollower(7, 0.2);
    st.arms = SPIRAL_PROGRAMS.map((p) => Array.from({ length: p.arms }, () => {
      const s = makeStrip(N_ARM, false, { uHue: { value: 0 }, uBright: { value: 1 }, uSpread: { value: 0.5 } }, stripIndex);
      s.mesh.visible = false; ctx.scene.add(s.mesh); return s;
    }));
  },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.cycler.step(hop, v.kick);
    st.rotation += (0.25 + 1.4 * v.mid + 0.7 * v.bass) * hop;
    if (f.bandsPulse) st.pulse = st.pulses.update(f.bandsPulse, hop);   // 7 smooth values: no jaggies
  },
  frame(ctx, v, tick) {
    const st = ctx.state, U = ctx.uniforms, c = st.cycler;
    applyScheme(ctx, SPIRAL_PROGRAMS);
    SPIRAL_PROGRAMS.forEach((p, k) => {
      const w = programWeight(c, k);
      st.arms[k].forEach((s, arm) => {
        s.mesh.visible = w > 0.001;
        if (!s.mesh.visible) return;
        spiralArm(st.pts, st.w, N_ARM, {
          arm, arms: p.arms, turns: p.turns, r0: 0.03, rMax: 0.8 + 0.25 * v.bass, rotation: p.dir * st.rotation,
          spec: st.pulse, baseWidth: 0.006 + 0.008 * v.level, specWidth: 0.035,
        });
        if (p.dir < 0) for (let i = 0; i < N_ARM; i++) st.pts[2 * i + 1] *= -1;   // mirror for the opposite spin
        writeStrip(st.pts, N_ARM, st.w, false, s.out);
        s.commit();
        const u = s.mesh.material.uniforms;
        u.uHue.value = 0.08 + 0.25 * v.hue + 0.2 * v.level;
        u.uBright.value = (0.5 + 1.5 * v.level) * w;
      });
    });
    U.uTwist.value = 0.3 + 1.5 * v.mid + 0.5 * v.balance;
    U.uPull.value = 0.08 + 0.45 * v.bass;
    U.uHalf.value = 0.9 + 0.8 * v.body;
    U.uFlash.value = flash(ctx, v, tick);
  },
  diagnostics: (ctx) => {
    const c = ctx.state.cycler, p = SPIRAL_PROGRAMS[c.current];
    return [['Program', `${p.arms} arms, ${p.scheme}${c.fading ? ' (crossfading)' : ''}`], ['Program switches', String(c.switches)]];
  },
});

const reg = (self.Visualizations ||= { collections: [] });
const entry = {
  id: 'alchemy', name: 'Alchemy-inspired', available: true,
  presets: [
    { id: 'liquid-ribbons', name: 'Liquid Ribbons', create: liquidRibbons },
    { id: 'spiral-elixir', name: 'Spiral Elixir', create: spiralElixir },
  ],
};
const i = reg.collections.findIndex((c) => c.id === entry.id);
if (i >= 0) reg.collections[i] = entry; else reg.collections.push(entry);
