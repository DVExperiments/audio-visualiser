// Alchemy-inspired, psychedelic (v0.6): full-screen colour with as little black as possible.
// Each preset is a mathematical field (domain-warped noise, sine plasma, a Julia set, a log-polar
// tunnel) or a hue-rotating kaleidoscope feedback, driven by the music. Explanations with live
// values: explain/specs.mjs. Hue jumps on kicks pass through the flash limiter (≤ 3/s) and are
// smoothed over 80 ms, so full-screen colour changes never strobe.
import { createFeedbackPreset, makeStrip, COMMON_MAPPINGS, PAL } from '../../engine/feedback.mjs';
import { writeStrip, stripIndex } from '../../engine/geometry2d.mjs';
import { RhythmSwitch } from '../battery/battery-model.mjs';
import { writeCurve } from './alchemy-model.mjs';
import { HueDrift } from './psy-model.mjs';

/** Limited, smoothed hue jump on kicks. */
function hueStep(ctx, v, hop, rate, jump) {
  const st = ctx.state;
  st.hue ||= new HueDrift();
  let j = 0;
  if (v.kick > 0) {
    // own limiter on the audio clock (the shared one runs on display time), same user setting
    const g = ctx.env.flash, fl = (st.limiter ||= new g.constructor());
    fl.limited = g.limited; fl.maxIntensity = g.maxIntensity;
    const f = fl.request(ctx.simTime, v.kick);                      // 0 when it would exceed 3 per second
    j = f > 0 ? jump * Math.min(1, f / (fl.limited ? fl.maxIntensity : 1)) : 0;
  }
  return st.hue.step(rate, hop, j);
}

// ---------------------------------------------------------------- Acid Warp
const acidWarp = () => createFeedbackPreset({
  seed: 1001, mappings: COMMON_MAPPINGS, exposure: 1.0,
  uniforms: { uWarp: 3, uScale: 1.8, uPhase: 0, uHue: 0, uBright: 1 },
  // domain warping: noise evaluated at positions displaced by noise, displaced by noise
  feedbackFS: /* glsl */`
    uniform float uWarp, uScale, uPhase, uHue, uBright;
    void main() {
      vec2 p = toP(vUv) * uScale;
      float t = uPhase;
      vec2 q = vec2(fbm(p + vec2(0.0, 0.1 * t)), fbm(p + vec2(5.2, 1.3) - 0.08 * t));
      vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.15 * t), fbm(p + 4.0 * q + vec2(8.3, 2.8) + 0.126 * t));
      float f = fbm(p + uWarp * r);
      // raising the palette to a power deepens saturation (the plain cosine palette read as milky)
      vec3 col = pow(palette(3.0 * f + uHue + 0.5 * length(q) + 0.3 * r.x), vec3(1.6)) * uBright * (0.6 + 1.0 * f);
      vec3 prev = prevAt(toP(vUv) * exp(-0.04 * uDt));
      gl_FragColor = vec4(mix(col, prev, decay(0.12)), 1.0);
    }`,
  // v0.7: deliberately slow. Whole-field motion that lurched on every beat (flow up to 1.8/s, warp
  // jumping with each kick) is a motion-sickness risk. Flow ≤ 0.38/s; warp and scale glide (τ 0.6 s).
  step(ctx, v, f, hop) {
    const st = ctx.state, a = 1 - Math.exp(-hop / 0.6);
    st.phase = (st.phase || 0) + (0.08 + 0.3 * v.mid) * hop;
    st.warp = (st.warp ?? 3) + a * ((2.8 + 1.2 * v.body + 0.8 * v.bass) - (st.warp ?? 3));
    st.scale = (st.scale ?? 1.8) + a * ((1.8 + 0.3 * v.body) - (st.scale ?? 1.8));
    st.hueV = hueStep(ctx, v, hop, 0.02, 0.05);
  },
  frame(ctx, v) {
    const U = ctx.uniforms, st = ctx.state;
    U.uWarp.value = st.warp ?? 3;
    U.uScale.value = st.scale ?? 1.8;
    U.uPhase.value = st.phase || 0;
    U.uHue.value = st.hueV || 0;
    U.uBright.value = 0.9 + 0.6 * v.level;
  },
});

// ---------------------------------------------------------------- Plasma Prism
const plasmaPrism = () => createFeedbackPreset({
  seed: 1002, mappings: COMMON_MAPPINGS, exposure: 1.0,
  uniforms: { uK: [6, 7, 5, 9], uP: [0, 0, 0, 0], uHue: 0, uFold: 6, uZoom: 1, uBright: 1 },
  feedbackFS: /* glsl */`
    uniform vec4 uK, uP;
    uniform float uHue, uFold, uZoom, uBright;
    void main() {
      vec2 p = toP(vUv) * uZoom;
      float seg = TAU / (2.0 * uFold), a = mod(atan(p.y, p.x), 2.0 * seg), r = length(p);
      a = abs(a - seg);
      vec2 k = r * vec2(cos(a), sin(a));                       // kaleidoscope-folded position
      float v = sin(uK.x * k.x + uP.x) + sin(uK.y * k.y + uP.y) + sin(uK.z * (k.x + k.y) * 0.7071 + uP.z) + sin(uK.w * r + uP.w);
      // three channels 120° apart: the brightest is always ≥ 0.75, so the field is never black
      // raised to the power 1.8 for deeper colour; the brightest channel stays ≥ 0.75^1.8 ≈ 0.60
      vec3 col = pow(0.5 + 0.5 * cos(3.14159265 * v + vec3(0.0, 2.0943951, 4.1887902) + TAU * uHue), vec3(1.8)) * uBright;
      gl_FragColor = vec4(mix(col, prevAt(toP(vUv)), decay(0.05)), 1.0);
    }`,
  setup(ctx) { ctx.state.fold = new RhythmSwitch([3, 4, 5, 6, 8], { seed: 12, threshold: 0.8, refractory: 2.0 }); ctx.state.P = [0, 1, 2, 3]; },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.fold.step(v.kick, hop);
    const rates = [0.8, -1.1, 0.6, -1.7];
    st.P = st.P.map((p, i) => p + rates[i] * (0.6 + 2.0 * v.mid) * hop);
    st.hueV = hueStep(ctx, v, hop, 0.03, 0.12);
  },
  frame(ctx, v) {
    const U = ctx.uniforms, st = ctx.state, s = 1 + 0.6 * v.bass;
    U.uK.value = [6 * s, 7 * s, 5 * s, 9 * (1 + 0.8 * v.high)];
    U.uP.value = st.P;
    U.uHue.value = st.hueV || 0;
    U.uFold.value = st.fold.value;
    U.uZoom.value = 1 - 0.15 * v.bass;
    U.uBright.value = 0.95 + 0.3 * v.level;
  },
});

// ---------------------------------------------------------------- Julia Bloom
const juliaBloom = () => createFeedbackPreset({
  seed: 1003, mappings: COMMON_MAPPINGS, exposure: 1.0,
  uniforms: { uC: [0.7885, 0], uZoom: 1.5, uRot: 0, uHue: 0, uBright: 1 },
  feedbackFS: /* glsl */`
    uniform vec2 uC;
    uniform float uZoom, uRot, uHue, uBright;
    void main() {
      vec2 z = rot(uRot) * toP(vUv) * uZoom;
      float trap = 1e9, n = 0.0, esc = 0.0;
      for (int i = 0; i < 96; i++) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uC;
        trap = min(trap, abs(length(z) - 0.5));                 // orbit trap: closest approach to a circle
        if (dot(z, z) > 256.0) { esc = 1.0; break; }
        n += 1.0;
      }
      float mu = n + 1.0 - log2(0.5 * log2(max(dot(z, z), 1.0001)));   // smooth escape count
      vec3 outside = palette(0.32 * log2(mu + 1.0) + uHue);       // log spreads colour bands far from the set
      vec3 inside = palette(uHue + 0.5 + 3.0 * trap);           // the interior is coloured too: no black
      vec3 col = mix(inside, outside, esc) * uBright;
      gl_FragColor = vec4(mix(col, prevAt(toP(vUv)), decay(0.04)), 1.0);
    }`,
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.alpha = (st.alpha ?? 0.3) + (0.08 + 0.5 * v.mid) * hop + (v.kick > 0 ? 0.04 * v.kick : 0);
    st.rot = (st.rot || 0) + (0.05 + 0.3 * v.high) * hop;
    st.hueV = hueStep(ctx, v, hop, 0.03, 0.12);
  },
  frame(ctx, v) {
    const U = ctx.uniforms, st = ctx.state, a = st.alpha ?? 0.3;
    U.uC.value = [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)];
    U.uZoom.value = 0.95 * (1 - 0.2 * v.bass);
    U.uRot.value = st.rot || 0;
    U.uHue.value = st.hueV || 0;
    U.uBright.value = 0.85 + 0.4 * v.level;
  },
  diagnostics: (ctx) => [['Julia c', `0.7885·e^(i·${(ctx.state.alpha ?? 0).toFixed(2)})`]],
});

// ---------------------------------------------------------------- Hyper Tunnel
const hyperTunnel = () => createFeedbackPreset({
  seed: 1004, mappings: COMMON_MAPPINGS, exposure: 1.0,
  uniforms: { uTravel: 0, uSpin: 0, uTwist: 0.3, uArmsA: 5, uArmsB: 5, uMix: 0, uHue: 0, uBright: 1 },
  // v0.7: no hard edges anywhere. Colour varies with cos(2πv/N), which is smooth between arms and
  // continuous round the circle (v0.6 coloured each arm separately: hard spiral edges that read as
  // glitches); arm-count changes crossfade over 2 s instead of jumping the whole screen.
  feedbackFS: /* glsl */`
    uniform float uTravel, uSpin, uTwist, uArmsA, uArmsB, uMix, uHue, uBright;
    vec3 tunnel(float u, float th, float arms, float fine) {
      float v = th / TAU * arms + uSpin + uTwist * u;
      float s = sin(TAU * 1.5 * u) * sin(TAU * v) * fine;
      return palette(0.25 * u + 0.12 * cos(TAU * v / arms) + uHue + 0.12 * s) * (0.72 + 0.28 * s);
    }
    void main() {
      vec2 p = toP(vUv);
      float r = max(length(p), 1e-4), th = atan(p.y, p.x);
      float u = log(r) - uTravel;                               // log-polar: self-similar, endless
      // near the centre the rings get finer than a pixel and shimmer: fade the pattern out there
      float fine = smoothstep(0.03, 0.3, r);
      vec3 col = mix(tunnel(u, th, uArmsA, fine), tunnel(u, th, uArmsB, fine), uMix);
      col = mix(vec3(1.0), col, smoothstep(0.0, 0.1, r)) * uBright;   // a white-hot core, not a hole
      gl_FragColor = vec4(mix(col, prevAt(p), decay(0.05)), 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    st.arms = new RhythmSwitch([3, 4, 5, 6, 8], { seed: 14, threshold: 0.8, refractory: 4.0 });
    st.armsA = st.armsB = st.arms.value; st.armMix = 1;
  },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    if (st.arms.step(v.kick, hop)) { st.armsA = st.armMix < 0.5 ? st.armsA : st.armsB; st.armsB = st.arms.value; st.armMix = 0; }
    st.armMix = Math.min(1, st.armMix + hop / 2.0);              // 2 s crossfade
    st.travel = (st.travel || 0) + (0.25 + 1.0 * v.bass) * hop;
    st.spin = (st.spin || 0) + (0.08 + 0.4 * v.mid) * hop;
    st.twist = (st.twist ?? 0.3) + (1 - Math.exp(-hop / 0.8)) * ((0.3 + 0.5 * v.body) - (st.twist ?? 0.3));   // glides
    st.hueV = hueStep(ctx, v, hop, 0.03, 0.08);
  },
  frame(ctx, v) {
    const U = ctx.uniforms, st = ctx.state;
    U.uTravel.value = st.travel || 0;
    U.uSpin.value = st.spin || 0;
    U.uTwist.value = st.twist ?? 0.3;
    const m = st.armMix ?? 1;
    U.uArmsA.value = st.armsA; U.uArmsB.value = st.armsB; U.uMix.value = m * m * (3 - 2 * m);
    U.uHue.value = st.hueV || 0;
    U.uBright.value = 0.85 + 0.3 * v.level;
  },
});

// ---------------------------------------------------------------- Rainbow Mandala
const N_CURVE = 900;
const rainbowMandala = () => createFeedbackPreset({
  seed: 1005, mappings: COMMON_MAPPINGS, exposure: 0.9, deposit: 1.4, head: 0.45,
  uniforms: { uZoom: 0.3, uSpin: 0.2, uHalf: 1.2, uFold: 6, uBase: 0.025 },
  // kaleidoscope feedback; the seed colour travels round the rainbow, so each generation of trail
  // keeps the colour it was born with. (v0.6 development: rotating the hue of the whole buffer
  // averaged toward grey, and a saturation gain inside the loop ran away to one flat colour.)
  feedbackFS: /* glsl */`
    uniform float uZoom, uSpin, uHalf, uFold, uBase;
    void main() {
      vec2 p = toP(vUv);
      float r = length(p), seg = TAU / (2.0 * uFold), a = mod(atan(p.y, p.x) + uSpin * uDt, 2.0 * seg);
      a = abs(a - seg);
      vec2 q = r * vec2(cos(a), sin(a)) * exp(-uZoom * uDt);
      vec3 c = prevAt(q) * decay(uHalf);
      // a faint plasma base, injected per second, fills any gaps with colour
      float v = sin(5.0 * q.x + uTime) + sin(6.0 * q.y - 0.7 * uTime) + sin(7.0 * r - 1.3 * uTime);
      c += uBase * uDt * (0.5 + 0.5 * cos(3.14159265 * v + vec3(0.0, 2.0943951, 4.1887902)));
      gl_FragColor = vec4(c, 1.0);
    }`,
  setup(ctx) {
    const st = ctx.state;
    ctx.setScheme('magma');
    st.pts = new Float32Array(N_CURVE * 2);
    // uHue 0.25 is exactly the scheme's middle (fully saturated) stop; no spread along the curve
    st.strips = [0, 1].map(() => { const s = makeStrip(N_CURVE, true, { uHue: { value: 0.25 }, uBright: { value: 1 }, uSpread: { value: 0 } }, stripIndex); ctx.scene.add(s.mesh); return s; });
    st.fold = new RhythmSwitch([5, 6, 8], { seed: 15, threshold: 0.8, refractory: 3.0 });
    st.phase = 0; st.spin = 0;
  },
  step(ctx, v, f, hop) {
    const st = ctx.state;
    st.fold.step(v.kick, hop);
    st.phase += (0.2 + 1.2 * v.mid) * hop;
    st.spin += (0.2 + 0.8 * v.bass) * hop;
    st.rainbow = (st.rainbow || 0) + (0.12 + 0.5 * v.mid) * hop + (v.kick > 0 ? 0.04 : 0);
  },
  frame(ctx, v) {
    const st = ctx.state, U = ctx.uniforms;
    // seed colour: a point travelling round the cosine rainbow (dark → full → pale stops)
    const h = st.rainbow || 0, pal = (t) => [0, 0.33, 0.67].map((o) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (t + o)));
    const c = pal(h);
    PAL.value[0].set(c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
    PAL.value[1].set(...c);
    PAL.value[2].set(...c.map((x) => 0.5 + 0.5 * x));
    st.strips.forEach((s, k) => {
      writeCurve(st.pts, N_CURVE, 'hypo', { R: 5 + k * 2, r: 3, d: 2.2 * (1 + 0.2 * Math.sin(st.phase)) }, {
        radius: 0.45 + 0.3 * v.bass, rotation: st.spin * (k ? -1 : 1), wobble: [0.1 * v.bass, 0.08 * v.mid, 0.05 * v.high], wobblePhase: [st.phase, -st.phase, 2 * st.phase],
      });
      writeStrip(st.pts, N_CURVE, 0.003 + 0.004 * v.level, true, s.out);
      s.commit();
      s.mesh.material.uniforms.uBright.value = 0.6 + 1.4 * v.level;
    });
    U.uZoom.value = 0.7 + 1.2 * v.bass;            // fast outward travel keeps successive colours apart
    U.uSpin.value = 0.1 + 0.6 * v.mid;
    U.uHalf.value = 0.45 + 0.35 * v.body;          // short memory: rings fade before they pile up into mud
    U.uFold.value = st.fold.value;
  },
});

const reg = (self.Visualizations ||= { collections: [] });
const alchemy = reg.collections.find((c) => c.id === 'alchemy' && c.available);
const presets = [
  { id: 'acid-warp', name: 'Acid Warp', create: acidWarp },
  { id: 'plasma-prism', name: 'Plasma Prism', create: plasmaPrism },
  { id: 'julia-bloom', name: 'Julia Bloom', create: juliaBloom },
  { id: 'hyper-tunnel', name: 'Hyper Tunnel', create: hyperTunnel },
  { id: 'rainbow-mandala', name: 'Rainbow Mandala', create: rainbowMandala },
];
if (alchemy) alchemy.presets.push(...presets);
else reg.collections.push({ id: 'alchemy', name: 'Alchemy-inspired', available: true, presets });
