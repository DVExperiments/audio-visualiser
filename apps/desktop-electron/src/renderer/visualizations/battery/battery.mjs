// Battery-inspired (v0.4): the music's actual waveform, wrapped into rings and pushed through
// kaleidoscope and tunnel feedback, with rotating polygons, sharp pulses and rhythmic changes.
// One saturated colour scheme at a time, switching on strong beats; trails fade to TRUE black.
// Original procedural work; evokes the family's character, copies nothing.
import { createFeedbackPreset, makeStrip, COMMON_MAPPINGS } from '../../engine/feedback.mjs';
import { writeStrip, stripIndex, scopeCircle, ScopeGain } from '../../engine/geometry2d.mjs';
import { ProgramCycler } from '../../engine/program.mjs';
import { PolygonRings, StarGate } from './battery-model.mjs';

const SCHEME_CYCLE = ['magma', 'electric', 'toxic', 'inferno', 'violet', 'aqua'];
const N_SCOPE = 512, WAVE_N = 1024;

function flash(ctx, values, tick, scale = 1) {
  if (values.kick > 0 && tick.onsets > 0) ctx.state.flash = Math.max(ctx.state.flash || 0, ctx.env.flash.request(tick.nowSec, values.kick) * scale);
  ctx.state.flash = (ctx.state.flash || 0) * Math.exp(-tick.dt / 0.12);
  return ctx.state.flash;
}

/** Scheme cycling: hold 8–16 s, switch on a strong beat, 1.2 s crossfade. */
function schemeSetup(ctx, seed) {
  ctx.state.schemes = new ProgramCycler(SCHEME_CYCLE.length, { seed, minHold: 8, maxHold: 16, fade: 1.2, threshold: 0.75 });
}
function schemeApply(ctx) {
  const c = ctx.state.schemes, a = SCHEME_CYCLE[c.current], b = SCHEME_CYCLE[c.next];
  ctx.setScheme(a, c.fading ? b : a, c.fading ? c.weight : 0);
}

/** Mid (L+R)/2 waveform of the latest WAVE_N samples, auto-gained for display. */
function readScope(ctx, dt) {
  const st = ctx.state;
  st.wl ||= new Float32Array(WAVE_N); st.wr ||= new Float32Array(WAVE_N); st.wm ||= new Float32Array(WAVE_N);
  st.scopeGain ||= new ScopeGain(0.12, 8);
  if (!ctx.store) return 0;
  ctx.store.recentWave(WAVE_N, st.wl, st.wr);
  for (let i = 0; i < WAVE_N; i++) st.wm[i] = 0.5 * (st.wl[i] + st.wr[i]);
  return st.scopeGain.update(st.wm, dt);
}

// ---------------------------------------------------------------- Polygon Pulse
const RINGS = 6, N_RING = 240;   // 240 is divisible by 3, 4, 5, 6 and 8: every shape uses all points

const polygonPulse = () => createFeedbackPreset({
  seed: 303, mappings: COMMON_MAPPINGS, exposure: 1.3, deposit: 2.5, head: 0.4,
  uniforms: { uFold: 6, uZoom: 0.4, uSpin: 0.1, uHalf: 0.25, uFloor: 0.3, uFlash: 0 },
  // kaleidoscope: fold the previous frame into one mirrored wedge (2·sides wedges per turn),
  // push it outward and fade quickly to black — echoes ripple out in perfect symmetry
  feedbackFS: /* glsl */`
    uniform float uFold, uZoom, uSpin, uHalf, uFloor, uFlash;
    void main() {
      vec2 p = toP(vUv);
      float r = length(p), seg = TAU / (2.0 * uFold);
      float a = mod(atan(p.y, p.x) + uSpin * uDt, 2.0 * seg);
      a = abs(a - seg);
      vec2 q = r * vec2(cos(a), sin(a)) * exp(-uZoom * uDt);
      vec3 c = fadeToBlack(prevAt(q), uHalf, uFloor);
      gl_FragColor = vec4(c + uFlash * 0.1 * grad(0.5) * smoothstep(1.2, 0.0, r), 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    st.model = new PolygonRings(RINGS, 7);
    schemeSetup(ctx, 31);
    st.pts = new Float32Array(N_RING * 2);
    st.rings = Array.from({ length: RINGS }, () => {
      const s = makeStrip(N_RING, true, { uHue: { value: 0 }, uBright: { value: 1 }, uSpread: { value: 0.0 } }, stripIndex);
      ctx.scene.add(s.mesh); return s;
    });
    st.scopePts = new Float32Array(N_SCOPE * 2);
    st.scope = makeStrip(N_SCOPE, true, { uHue: { value: 0.45 }, uBright: { value: 1 }, uSpread: { value: 0.3 } }, stripIndex);
    ctx.scene.add(st.scope.mesh);
    st.scopeRot = 0;
  },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.model.step(v, f, hop);
    st.schemes.step(hop, v.kick);
    st.scopeRot -= (0.2 + 0.8 * v.mid) * hop;
  },
  frame(ctx, v, tick) {
    const st = ctx.state, m = st.model, U = ctx.uniforms;
    schemeApply(ctx);
    st.rings.forEach((s, j) => {
      m.writeRing(st.pts, j, N_RING / m.shape.value);
      writeStrip(st.pts, N_RING, 0.0025 + 0.006 * m.pulse[j], true, s.out);
      s.commit();
      const u = s.mesh.material.uniforms;
      u.uHue.value = 0.12 + 0.3 * (j / RINGS) + 0.2 * m.pulse[j];   // pulsing rings run hot
      u.uBright.value = 0.25 + 2.0 * m.pulse[j];
    });
    // the waveform itself, wrapped into a ring between the polygons
    const gain = readScope(ctx, tick.dt);
    scopeCircle(st.scopePts, N_SCOPE, st.wm, { r0: 0.5 + 0.08 * v.bass, gain, rotation: st.scopeRot });
    writeStrip(st.scopePts, N_SCOPE, 0.003 + 0.003 * v.high, true, st.scope.out);
    st.scope.commit();
    st.scope.mesh.material.uniforms.uBright.value = 0.6 + 1.2 * v.high + 0.6 * v.level;
    U.uFold.value = m.shape.value;
    U.uZoom.value = 0.25 + 1.4 * v.bass;
    U.uSpin.value = 0.1 + 0.8 * v.mid;
    U.uHalf.value = 0.2 + 0.3 * v.body;          // long enough for visible kaleidoscope echoes
    U.uFlash.value = flash(ctx, v, tick);
  },
  diagnostics: (ctx) => [
    ['Shape (sides)', `${ctx.state.model.shape.value}, ${ctx.state.model.shape.changes} changes`],
    ['Colour scheme', SCHEME_CYCLE[ctx.state.schemes.current]],
  ],
});

// ---------------------------------------------------------------- Star Tunnel
const PER_EDGE = 16, MAX_POINTS = 9;

const starTunnel = () => createFeedbackPreset({
  seed: 404, mappings: COMMON_MAPPINGS, exposure: 1.2, deposit: 2.5, head: 0.4,
  uniforms: { uZoom: 1.0, uTurn: 0.3, uHalf: 0.5, uFloor: 0.15, uFlash: 0 },
  // tunnel: strong outward zoom with rotation — each frame's waveform ring becomes a receding wall
  feedbackFS: /* glsl */`
    uniform float uZoom, uTurn, uHalf, uFloor, uFlash;
    void main() {
      vec2 p = toP(vUv);
      vec2 q = rot(-uTurn * uDt) * p * exp(-uZoom * uDt);
      vec3 c = fadeToBlack(prevAt(q), uHalf, uFloor);
      float r = length(p);
      gl_FragColor = vec4(c + uFlash * 0.08 * grad(0.5) * smoothstep(0.0, 1.0, r), 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    st.model = new StarGate(11);
    schemeSetup(ctx, 41);
    st.verts = new Float32Array(MAX_POINTS * 4);
    st.stars = {};
    for (let p = 5; p <= MAX_POINTS; p++) {
      const s = makeStrip(2 * p * PER_EDGE, true, { uHue: { value: 0 }, uBright: { value: 1 }, uSpread: { value: 0.5 } }, stripIndex);
      st.stars[p] = s; ctx.scene.add(s.mesh);
    }
    st.pts = new Float32Array(2 * MAX_POINTS * PER_EDGE * 2);
    st.scopePts = new Float32Array(N_SCOPE * 2);
    st.scope = makeStrip(N_SCOPE, true, { uHue: { value: 0.3 }, uBright: { value: 1 }, uSpread: { value: 0.0 } }, stripIndex);
    ctx.scene.add(st.scope.mesh);
  },
  step(ctx, v, f, hop) { ctx.state.model.step(v, hop); ctx.state.schemes.step(hop, v.kick); },
  frame(ctx, v, tick) {
    const st = ctx.state, m = st.model, U = ctx.uniforms, p = m.points.value;
    schemeApply(ctx);
    // waveform ring near the centre: the tunnel zoom turns successive rings into its walls; the
    // colour walks along the scheme over time so the walls band dark → vivid → hot
    const gain = readScope(ctx, tick.dt);
    scopeCircle(st.scopePts, N_SCOPE, st.wm, { r0: 0.2 + 0.05 * v.bass, gain: gain * 0.7, rotation: m.rot * 0.5 });
    writeStrip(st.scopePts, N_SCOPE, 0.003 + 0.004 * v.level, true, st.scope.out);
    st.scope.commit();
    st.scope.mesh.material.uniforms.uHue.value = 0.1 + 0.45 * (0.5 + 0.5 * Math.sin(ctx.simTime * 0.9));
    st.scope.mesh.material.uniforms.uBright.value = 0.6 + 1.6 * v.level;
    // small star at the core, point count switching on strong beats
    const nv = m.writeStar(st.verts, v);
    for (let e = 0; e < nv; e++) {
      const x0 = st.verts[2 * e], y0 = st.verts[2 * e + 1], x1 = st.verts[2 * ((e + 1) % nv)], y1 = st.verts[2 * ((e + 1) % nv) + 1];
      for (let k = 0; k < PER_EDGE; k++) {
        const t = k / PER_EDGE, i = e * PER_EDGE + k;
        st.pts[2 * i] = 0.55 * (x0 + (x1 - x0) * t); st.pts[2 * i + 1] = 0.55 * (y0 + (y1 - y0) * t);
      }
    }
    for (let q = 5; q <= MAX_POINTS; q++) st.stars[q].mesh.visible = q === p;
    const star = st.stars[p];
    writeStrip(st.pts, nv * PER_EDGE, 0.003 + 0.006 * v.level, true, star.out);
    star.commit();
    star.mesh.material.uniforms.uHue.value = 0.4 + 0.1 * v.hue;
    star.mesh.material.uniforms.uBright.value = 0.3 + 1.4 * v.bass;
    U.uZoom.value = 0.6 + 2.2 * v.bass;            // kicks rush the tunnel forward
    U.uTurn.value = 0.2 + 1.0 * v.mid - 0.5 * v.balance;
    U.uHalf.value = 0.35 + 0.4 * v.body;
    U.uFlash.value = flash(ctx, v, tick, 0.8);
  },
  diagnostics: (ctx) => [
    ['Star points', `${ctx.state.model.points.value}, ${ctx.state.model.points.changes} changes`],
    ['Colour scheme', SCHEME_CYCLE[ctx.state.schemes.current]],
  ],
});

const reg = (self.Visualizations ||= { collections: [] });
const entry = {
  id: 'battery', name: 'Battery-inspired', available: true,
  presets: [
    { id: 'polygon-pulse', name: 'Polygon Pulse', create: polygonPulse },
    { id: 'star-tunnel', name: 'Star Tunnel', create: starTunnel },
  ],
};
const i = reg.collections.findIndex((c) => c.id === entry.id);
if (i >= 0) reg.collections[i] = entry; else reg.collections.push(entry);
