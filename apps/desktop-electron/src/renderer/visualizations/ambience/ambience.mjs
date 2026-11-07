// Ambience-inspired (v0.4): dark, soft, slowly moving fields — rippling water, smoky waveform
// swirls, fluid nebulae and aurora curtains. Calm mappings; cool colour schemes changing slowly.
// Original procedural work; evokes the family's character, copies nothing.
import { createFeedbackPreset, makeStrip, COMMON_MAPPINGS } from '../../engine/feedback.mjs';
import { writeStrip, stripIndex, scopeCircle, ScopeGain } from '../../engine/geometry2d.mjs';
import { ProgramCycler } from '../../engine/program.mjs';
import { mulberry32 } from '../../engine/mapping.mjs';
import { RIPPLE } from './ripple-model.mjs';

const AMBIENT_MAPPINGS = Object.freeze({
  ...COMMON_MAPPINGS,
  bass:  { sources: [['lowPulse', 0.8], ['bass', 0.4]], attack: 0.04, release: 0.35 },
  mid:   { sources: [['midPulse', 0.5], ['mid', 0.5]], attack: 0.06, release: 0.4 },
  high:  { sources: [['presencePulse', 0.4], ['brilliancePulse', 0.4], ['brilliance', 0.3]], curve: 'sqrt', attack: 0.03, release: 0.25 },
  level: { sources: [['level', 0.5], ['lowPulse', 0.4]], attack: 0.08, release: 0.5 },
});
const COOL = ['aqua', 'electric', 'ice', 'violet'];

function slowSchemes(ctx, seed, list = COOL) {
  ctx.state.schemes = new ProgramCycler(list.length, { seed, minHold: 20, maxHold: 35, fade: 6, threshold: 0.8 });
  ctx.state.schemeList = list;
}
function applySchemes(ctx) {
  const c = ctx.state.schemes, L = ctx.state.schemeList;
  ctx.setScheme(L[c.current], c.fading ? L[c.next] : L[c.current], c.fading ? c.weight : 0);
}

// ---------------------------------------------------------------- Water
// Ripple tank: discrete 2D wave equation at a fixed 240 steps/s on a half-resolution buffer,
// height in R, previous height in G (see ripple-model.mjs for the maths and its tests).
const waterPresent = /* glsl */`
  uniform sampler2D uTex; uniform float uExposure, uGlow;
  float H(vec2 uv) { return texture2D(uTex, uv).r; }
  void main() {
    float hx = H(vUv + vec2(uTexel.x, 0.0)) - H(vUv - vec2(uTexel.x, 0.0));
    float hy = H(vUv + vec2(0.0, uTexel.y)) - H(vUv - vec2(0.0, uTexel.y));
    vec3 n = normalize(vec3(-hx * 18.0, -hy * 18.0, 1.0));
    vec2 q = toP(vUv) + n.xy * 0.12;                         // refraction of the floor below
    float floorPat = fbm(q * 1.6 + vec2(0.03 * uTime, -0.02 * uTime));
    vec3 deep = mix(uPal[0] * 0.06, uPal[1] * 0.09, smoothstep(0.35, 0.85, floorPat));   // dark, moody depths
    vec3 L = normalize(vec3(-0.35, 0.45, 0.8));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
    float slope = clamp(length(vec2(hx, hy)) * 5.0, 0.0, 1.0);
    vec3 col = grade(deep + uPal[2] * spec * (0.6 + 1.4 * uGlow) + uPal[1] * slope * slope * (0.12 + 0.35 * uGlow));
    col = 1.0 - exp(-col * uExposure);
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }`;

const water = () => createFeedbackPreset({
  seed: 707, mappings: AMBIENT_MAPPINGS, exposure: 1.4,
  simRate: RIPPLE.simRate, maxSubsteps: 16, simScale: 0.5,
  uniforms: {
    uLambda2: RIPPLE.lambda * RIPPLE.lambda, uDamp: 1 - RIPPLE.damping / RIPPLE.simRate,
    // flat Float32Array: three.js uploads it as-is (an array of plain objects would crash its
    // flatten(), which calls .toArray() on each element — checked in the three 0.186.1 source)
    uDrop: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    uDropOn: 0, uGlow: 0,
  },
  feedbackFS: /* glsl */`
    uniform float uLambda2, uDamp, uDropOn;
    uniform vec4 uDrop[4];
    void main() {
      vec4 s = texture2D(uPrev, vUv);
      float h = s.r, hp = s.g;
      // isotropic 9-point Laplacian (v0.9; was 5-point): (4·edges + corners − 20h)/6. Waves travel
      // at the same speed in every direction, so ripples stay round (the 5-point stencil is faster
      // along the axes); stable up to λ = √(3/4) ≈ 0.87, used at 0.5.
      vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
      float edges = texture2D(uPrev, vUv + tx).r + texture2D(uPrev, vUv - tx).r + texture2D(uPrev, vUv + ty).r + texture2D(uPrev, vUv - ty).r;
      float corners = texture2D(uPrev, vUv + tx + ty).r + texture2D(uPrev, vUv + tx - ty).r + texture2D(uPrev, vUv - tx + ty).r + texture2D(uPrev, vUv - tx - ty).r;
      float lap = (4.0 * edges + corners - 20.0 * h) / 6.0;
      float hn = (2.0 * h - hp + uLambda2 * lap) * uDamp;
      // drops are DISPLACEMENTS (added to both heights): no net velocity, so the mean level
      // cannot drift (the impulse form drifts linearly — caught by the CPU model's test)
      vec2 p = toP(vUv); float d = 0.0;
      for (int i = 0; i < 4; i++) { vec2 dd = p - uDrop[i].xy; d += uDrop[i].z * exp(-dot(dd, dd) / (uDrop[i].w * uDrop[i].w)); }
      d *= uDropOn;
      gl_FragColor = vec4(hn + d, h + d, 0.0, 1.0);
    }`,
  presentFS: waterPresent,
  setup(ctx) {
    slowSchemes(ctx, 71);
    ctx.state.queue = []; ctx.state.rain = 0; ctx.state.idle = 0; ctx.state.lastLow = 0;
    ctx.state.rng = mulberry32(707);
  },
  step(ctx, v, f, hop) {
    const st = ctx.state, r = st.rng, ax = Math.min(ctx.aspect, 2) * 0.9;
    const at = () => [(2 * r() - 1) * ax, (2 * r() - 1) * 0.85];
    st.schemes.step(hop, v.kick);
    const low = f.bandsPulse ? Math.max(f.bandsPulse[0], f.bandsPulse[1]) : 0;
    if (v.kick > 0) st.queue.push([...at(), 0.3 + 0.35 * v.kick, 0.05 + 0.04 * v.kick]);          // kick: a big drop
    else if (low > 0.6 && st.lastLow <= 0.6) st.queue.push([...at(), 0.2, 0.045]);                 // bass hit: medium drop
    st.lastLow = low;
    st.rain += 10 * v.high * hop;                                                                   // treble: light rain
    while (st.rain >= 1) { st.rain -= 1; st.queue.push([...at(), 0.08, 0.014]); }
    st.idle += hop;                                                                                 // autonomous: never still
    if (st.idle > 1.6) { st.idle = 0; st.queue.push([...at(), 0.12, 0.03]); }
    if (st.queue.length > 24) st.queue.splice(0, st.queue.length - 24);
  },
  frame(ctx, v) { applySchemes(ctx); ctx.uniforms.uGlow.value = v.level; },
  substep(ctx, i) {
    const U = ctx.uniforms, q = ctx.state.queue;
    if (i === 0 && q.length) {
      const D = U.uDrop.value;
      for (let k = 0; k < 4; k++) {
        const d = q.shift();
        if (d) D.set(d, 4 * k); else { D[4 * k + 2] = 0; D[4 * k + 3] = 1; }
      }
      U.uDropOn.value = 1;
    } else U.uDropOn.value = 0;
  },
  diagnostics: (ctx) => [['Pending drops', String(ctx.state.queue.length)], ['Colour scheme', ctx.state.schemeList[ctx.state.schemes.current]]],
});

// ---------------------------------------------------------------- Swirl
const N_RING = 384, WAVE_N = 1024;

const swirl = () => createFeedbackPreset({
  seed: 808, mappings: AMBIENT_MAPPINGS, exposure: 1.2, deposit: 0.7, head: 0.15,
  uniforms: { uTwist: 0.8, uZoom: 0.1, uHalf: 0.6, uFloor: 0.08, uBlur: 0.06 },
  // smoke: soft waveform rings carried by a vortex that is strongest at the centre, slowly
  // expanding, diffused by a small blur whose radius ∝ √dt (diffusion per second is then
  // independent of the frame rate — tested)
  feedbackFS: /* glsl */`
    uniform float uTwist, uZoom, uHalf, uFloor, uBlur;
    void main() {
      vec2 p = toP(vUv);
      float r = length(p);
      vec2 q = rot(uTwist * uDt * (1.0 - smoothstep(0.0, 1.4, r))) * p * exp(-uZoom * uDt);
      float e = uBlur * sqrt(uDt);
      vec3 c = 0.5 * prevAt(q) + 0.125 * (prevAt(q + vec2(e, 0.0)) + prevAt(q - vec2(e, 0.0)) + prevAt(q + vec2(0.0, e)) + prevAt(q - vec2(0.0, e)));
      gl_FragColor = vec4(fadeToBlack(c, uHalf, uFloor), 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    slowSchemes(ctx, 81);
    st.gain = new ScopeGain(0.1, 8);
    st.wl = new Float32Array(WAVE_N); st.wr = new Float32Array(WAVE_N); st.pts = new Float32Array(N_RING * 2);
    st.rings = [0, 1].map((k) => {
      const s = makeStrip(N_RING, true, { uHue: { value: 0.3 + 0.2 * k }, uBright: { value: 1 }, uSpread: { value: 0.25 } }, stripIndex);
      ctx.scene.add(s.mesh); return s;
    });
    st.rot = 0;
  },
  step(ctx, v, f, hop) { ctx.state.schemes.step(hop, v.kick); ctx.state.rot += (0.1 + 0.4 * v.mid) * hop; },
  frame(ctx, v, tick) {
    const st = ctx.state, U = ctx.uniforms;
    applySchemes(ctx);
    if (ctx.store) ctx.store.recentWave(WAVE_N, st.wl, st.wr);
    const g = st.gain.update(st.wl, tick.dt);
    // left channel inner ring, right channel outer ring (stereo becomes two separate smokes)
    [[st.wl, 0.28 + 0.06 * v.bass, 1], [st.wr, 0.5 + 0.08 * v.bass, -1]].forEach(([w, r0, dir], k) => {
      scopeCircle(st.pts, N_RING, w, { r0, gain: g, rotation: dir * st.rot + k });
      const s = st.rings[k];
      writeStrip(st.pts, N_RING, 0.008 + 0.012 * v.level, true, s.out);  // soft strokes
      s.commit();
      s.mesh.material.uniforms.uBright.value = 0.35 + 0.9 * v.level;
    });
    U.uTwist.value = 0.5 + 1.4 * v.mid;
    U.uZoom.value = 0.06 + 0.35 * v.bass;
    U.uHalf.value = 0.45 + 0.6 * v.body;
    U.uBlur.value = 0.05 + 0.06 * v.high;
  },
  diagnostics: (ctx) => [['Colour scheme', ctx.state.schemeList[ctx.state.schemes.current]]],
});

// ---------------------------------------------------------------- Nebula (v0.3, now on schemes, fades to black)
const nebula = () => createFeedbackPreset({
  seed: 606, mappings: AMBIENT_MAPPINGS, exposure: 1.3,
  uniforms: { uFlow: 0.5, uHalf: 2.0, uFloor: 0.02, uHue: 0.5, uB0: [0, 0, 0], uB1: [0, 0, 0], uB2: [0, 0, 0], uSize: 0.2 },
  // fluid-like drift: semi-Lagrangian advection along a curl-noise (divergence-free) velocity
  // field; three soft colour sources orbit and inject light with the bass, mid and treble
  feedbackFS: /* glsl */`
    uniform float uFlow, uHalf, uFloor, uHue, uSize;
    uniform vec3 uB0, uB1, uB2;
    vec2 curl(vec2 p) {
      const float e = 0.02;
      float n1 = fbm(p + vec2(0.0, e)), n2 = fbm(p - vec2(0.0, e));
      float n3 = fbm(p + vec2(e, 0.0)), n4 = fbm(p - vec2(e, 0.0));
      return vec2(n1 - n2, n4 - n3) / (2.0 * e);
    }
    vec3 blob(vec2 p, vec3 b, float t) { vec2 d = p - b.xy; return grad(t) * b.z * exp(-dot(d, d) / (uSize * uSize)); }
    void main() {
      vec2 p = toP(vUv);
      vec2 vel = 0.35 * curl(1.2 * p + vec2(0.05 * uTime, -0.03 * uTime)) * uFlow;
      vec3 c = fadeToBlack(prevAt(p - vel * uDt), uHalf, uFloor);
      c += (blob(p, uB0, uHue) + blob(p, uB1, uHue + 0.18) + blob(p, uB2, uHue + 0.36)) * uDt * 1.3;
      gl_FragColor = vec4(c, 1.0);
    }`,
  setup(ctx) { ctx.state.orbit = [0, 2.1, 4.2]; slowSchemes(ctx, 61, ['violet', 'magma', 'aqua', 'ice']); },
  step(ctx, v, f, hop) {
    const o = ctx.state.orbit;
    o[0] += (0.15 + 0.5 * v.bass) * hop; o[1] -= (0.2 + 0.5 * v.mid) * hop; o[2] += (0.27 + 0.6 * v.high) * hop;
    ctx.state.schemes.step(hop, v.kick);
  },
  frame(ctx, v) {
    const U = ctx.uniforms, o = ctx.state.orbit, ax = Math.min(ctx.aspect, 1.7);
    applySchemes(ctx);
    const pos = (k, rx, ry) => [rx * ax * Math.cos(o[k]), ry * Math.sin(o[k] * 1.3)];
    U.uB0.value = [...pos(0, 0.45, 0.45), 0.25 + 1.8 * v.bass];
    U.uB1.value = [...pos(1, 0.6, 0.35), 0.2 + 1.4 * v.mid];
    U.uB2.value = [...pos(2, 0.3, 0.6), 0.15 + 1.6 * v.high];
    U.uSize.value = 0.14 + 0.16 * v.level;
    U.uFlow.value = 0.4 + 1.2 * v.level;
    U.uHalf.value = 0.9 + 1.2 * v.body;
    U.uHue.value = 0.15 + 0.3 * v.hue;
  },
});

// ---------------------------------------------------------------- Aurora (v0.3, now on schemes)
const aurora = () => createFeedbackPreset({
  seed: 505, mappings: AMBIENT_MAPPINGS, exposure: 1.5,
  uniforms: { uFlow: 0.4, uWarp: 0.4, uBright: 0.6, uLow: 0, uHigh: 0, uHue: 0.5, uHalf: 0.25 },
  feedbackFS: /* glsl */`
    uniform float uFlow, uWarp, uBright, uLow, uHigh, uHue, uHalf;
    void main() {
      vec2 p = toP(vUv);
      float t = uTime * uFlow;
      vec2 w = p + uWarp * vec2(fbm(p * 1.3 + vec2(0.2 * t, 0.0)), fbm(p * 1.3 - vec2(0.17 * t, -4.0)));
      float curtain = fbm(vec2(w.x * 1.6 + 0.3 * t, w.y * 0.35 - 0.05 * t));
      float shape = smoothstep(0.42, 0.8, curtain) * smoothstep(1.15, -0.3, p.y + 0.3 * sin(1.5 * w.x + t));
      vec3 col = grad(uHue + 0.3 * curtain + 0.1 * p.y) * shape * uBright;
      col += uPal[1] * uLow * 0.3 * smoothstep(0.1, -1.0, p.y);
      vec2 cell = floor(vUv * vec2(260.0, 160.0)), fr = fract(vUv * vec2(260.0, 160.0));
      vec2 jitter = vec2(hash(cell + 7.1), hash(cell + 3.3));
      float on = step(0.9988 - 0.0012 * uHigh, hash(cell + floor(uTime * 12.0)));
      col += uPal[2] * on * smoothstep(0.35, 0.0, length(fr - jitter)) * smoothstep(-0.2, 0.6, p.y) * (0.3 + 0.9 * uHigh);
      vec3 prev = prevAt(p - vec2(0.0, 0.05 * uDt));
      gl_FragColor = vec4(mix(col, prev, decay(uHalf)), 1.0);
    }`,
  setup(ctx) { slowSchemes(ctx, 51, ['toxic', 'aqua', 'violet', 'electric']); },
  step(ctx, v, f, hop) { ctx.state.schemes.step(hop, v.kick); },
  frame(ctx, v) {
    const U = ctx.uniforms;
    applySchemes(ctx);
    U.uFlow.value = 0.25 + 0.9 * v.level;
    U.uWarp.value = 0.25 + 0.9 * v.mid;
    U.uBright.value = 0.3 + 1.0 * v.body + 0.5 * v.bass;
    U.uLow.value = v.bass;
    U.uHigh.value = v.high;
    U.uHue.value = 0.1 + 0.3 * v.hue;
    U.uHalf.value = 0.18 + 0.25 * (1 - v.level);
  },
});

const reg = (self.Visualizations ||= { collections: [] });
const entry = {
  id: 'ambience', name: 'Ambience-inspired', available: true,
  presets: [
    { id: 'water', name: 'Water', create: water },
    { id: 'swirl', name: 'Swirl', create: swirl },
    { id: 'nebula', name: 'Nebula', create: nebula },
    { id: 'aurora', name: 'Aurora', create: aurora },
  ],
};
const i = reg.collections.findIndex((c) => c.id === entry.id);
if (i >= 0) reg.collections[i] = entry; else reg.collections.push(entry);
