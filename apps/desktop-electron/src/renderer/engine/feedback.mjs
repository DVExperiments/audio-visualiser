// Framebuffer-feedback engine used by the Alchemy-, Battery- and Ambience-inspired collections.
//
// Every display frame:
//   1. feedback pass(es): draw the PREVIOUS frame into a new half-float buffer through the preset's
//      transform shader (zoom / rotate / swirl / fold / advect / wave equation), fading to TRUE
//      black. Presets with a physics simulation run it at a fixed rate (`simRate` substeps per
//      second) so it behaves the same at any refresh rate.
//   2. deposit: draw the preset's audio-driven geometry into that buffer, additively, with
//      intensity ∝ dt — energy per SECOND is constant, so trails are identical at any refresh rate
//   3. present: soft tone curve and sRGB gamma to the screen (or the preset's own present shader)
//   4. head: draw the same geometry once more straight onto the screen at fixed intensity, so the
//      current lines stay crisp at any refresh rate (they are not accumulated)
// Without step 2's dt scaling a lingering line settles at deposit·halfLife/(ln2·dt): 24× brighter
// at 120 Hz than at 5 Hz (found by testing in v0.3 development).
//
// v0.4 (after seeing v0.3 on real hardware): exact fade-to-black (no haze), soft frame edges (no
// dark strip), one colour scheme at a time (no rainbow mush), fixed-rate substeps, custom present.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { MappingSet, mulberry32, influenceScales } from './mapping.mjs';
import { mixSchemes } from './palettes.mjs';

export const GLSL_COMMON = /* glsl */`
  uniform sampler2D uPrev;
  uniform float uAspect, uTime, uDt;
  uniform vec2 uTexel;
  uniform vec3 uPal[3];
  uniform float uColour;
  varying vec2 vUv;
  // v0.12 colour-intensity grade (1 = unchanged): saturation around Rec. 709 luma, and brightness
  vec3 grade(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722)), s = clamp(uColour, 0.0, 2.0);
    return max(mix(vec3(l), c, s), 0.0) * (0.75 + 0.25 * min(s, 1.6));
  }
  const float TAU = 6.28318530718;
  vec3 palette(float t) { return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67))); }
  // current colour scheme, dark → vivid → hot; triangle-wrapped so any t is seamless
  vec3 grad(float t) {
    float u = 1.0 - abs(2.0 * fract(t) - 1.0), s = 2.0 * u;
    return s < 1.0 ? mix(uPal[0], uPal[1], s) : mix(uPal[1], uPal[2], s - 1.0);
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  // v0.9: PCG2D integer hash (Jarzynski & Olano 2020). Exact integer arithmetic, so it never
  // degrades. The old fract(sin(x)·43758.5) hash depended on GPU sin() accuracy for large arguments
  // (implementation-defined, poor on many GPUs as time-based coordinates grow during long sessions)
  // and its float32 result held only a few hundred distinct levels.
  uvec2 pcg2d(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    return v;
  }
  float hash(vec2 p) { return float(pcg2d(uvec2(ivec2(floor(p)) + 1048576)).x) * (1.0 / 4294967296.0); }
  // value noise with QUINTIC interpolation 6t⁵ − 15t⁴ + 10t³ (v0.9; was cubic 3t² − 2t³). Quintic is
  // twice continuously differentiable, so derived fields (Nebula's curl flow) have no creases
  // along the noise grid.
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = rot(0.5) * p * 2.03 + 3.1; a *= 0.5; } return s; }
  vec2 toP(vec2 uv) { return (uv - 0.5) * vec2(uAspect, 1.0) * 2.0; }          // centred, y ∈ [−1, 1]
  vec2 toUv(vec2 p) { return p / (vec2(uAspect, 1.0) * 2.0) + 0.5; }
  float decay(float halfLife) { return pow(0.5, uDt / halfLife); }
  // exact solution of dc/dt = −k c − f over uDt: reaches TRUE black in finite time (= fadeToBlack() in JS)
  vec3 fadeToBlack(vec3 c, float halfLife, float floorRate) {
    float k = 0.69314718 / halfLife, q = floorRate / k;
    return max((c + q) * exp(-k * uDt) - q, 0.0);
  }
  // reflect coordinates that fall outside [0,1] back inside, like a kaleidoscope's mirrors
  vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
  // previous frame at centred position p. v0.6: positions beyond the frame mirror back into it.
  // v0.4–0.5 returned black there; symmetry folds reach past the frame toward the corners, so that
  // black was folded onto the sides (the wedges in your Amethyst Kaleido screenshot).
  vec3 prevAt(vec2 p) { return texture2D(uPrev, mirrorUv(toUv(p))).rgb; }
  vec3 hueShift(vec3 c, float a) {
    const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toYIQ * c; float s = sin(a), co = cos(a);
    yiq.yz = mat2(co, -s, s, co) * yiq.yz;
    return max(toRGB * yiq, 0.0);
  }
`;

const QUAD_VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PRESENT_FS = /* glsl */`
  uniform sampler2D uTex; uniform float uExposure, uColour; varying vec2 vUv;
  vec3 grade(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722)), s = clamp(uColour, 0.0, 2.0);
    return max(mix(vec3(l), c, s), 0.0) * (0.75 + 0.25 * min(s, 1.6));
  }
  void main() {
    vec3 c = grade(texture2D(uTex, vUv).rgb);
    c = 1.0 - exp(-c * uExposure);
    gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
  }`;

/** Shared emission scale: set by the engine per pass (deposit ∝ dt, or fixed for the head). */
export const EMIT = { value: 1 };
/** Shared colour scheme (3 stops), written by setScheme(). One renderer is active at a time. */
export const PAL = { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
/** Shared colour-intensity uniform (Influence panel), applied in every present pass. */
export const COLOUR = { value: 1 };

/** Additive line material for strips: soft across the width, scheme colour along the length. */
export function stripMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uEmit: EMIT, uPal: PAL },
    vertexShader: /* glsl */`
      attribute float along; attribute float edge;
      varying float vAlong; varying float vEdge;
      void main() { vAlong = along; vEdge = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uHue, uBright, uSpread, uEmit;
      uniform vec3 uPal[3];
      varying float vAlong; varying float vEdge;
      vec3 grad(float t) {
        float u = 1.0 - abs(2.0 * fract(t) - 1.0), s = 2.0 * u;
        return s < 1.0 ? mix(uPal[0], uPal[1], s) : mix(uPal[1], uPal[2], s - 1.0);
      }
      void main() {
        float core = pow(max(0.0, 1.0 - vEdge * vEdge), 1.5);
        gl_FragColor = vec4(grad(uHue + uSpread * vAlong) * uBright * uEmit * core, 1.0);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** A strip mesh with preallocated buffers for n points. */
export function makeStrip(n, closed, uniforms, indexFn) {
  const g = new THREE.BufferGeometry();
  const out = { position: new Float32Array(n * 6), along: new Float32Array(n * 2), edge: new Float32Array(n * 2) };
  g.setAttribute('position', new THREE.BufferAttribute(out.position, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('along', new THREE.BufferAttribute(out.along, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('edge', new THREE.BufferAttribute(out.edge, 1).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(new THREE.BufferAttribute(indexFn(n, closed), 1));
  const mesh = new THREE.Mesh(g, stripMaterial(uniforms));
  mesh.frustumCulled = false;
  return { mesh, out, n, closed, commit() { for (const k of ['position', 'along', 'edge']) g.getAttribute(k).needsUpdate = true; } };
}

/**
 * Create a renderer (initialize/update/render/resize/dispose) from a preset definition:
 *   { mappings, uniforms, feedbackFS, presentFS?, simRate?, maxSubsteps?, simScale?, exposure,
 *     deposit?, head?, setup(ctx), step(ctx, values, frame, hop), frame(ctx, values, tick),
 *     substep?(ctx, index, count), diagnostics?(ctx) }
 */
export function createFeedbackPreset(def) {
  return {
    contextType: 'webgl2',
    initialize(canvas, env) {
      const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      r.autoClear = false;
      this.renderer = r;
      const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      this.rt = [new THREE.WebGLRenderTarget(4, 4, rtOpts), new THREE.WebGLRenderTarget(4, 4, rtOpts)];
      this.uniforms = { uPrev: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 }, uDt: { value: 1 / 60 }, uTexel: { value: new THREE.Vector2(1, 1) }, uPal: PAL, uColour: COLOUR };
      for (const [k, v] of Object.entries(def.uniforms || {})) this.uniforms[k] = { value: v };
      this.fbQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: QUAD_VS, fragmentShader: GLSL_COMMON + def.feedbackFS }));
      this.presentUniforms = { ...this.uniforms, uTex: { value: null }, uExposure: { value: def.exposure ?? 1.2 } };
      this.presentQuad = new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: this.presentUniforms, vertexShader: QUAD_VS,
        fragmentShader: def.presentFS ? GLSL_COMMON + def.presentFS : PRESENT_FS,
      }));
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
      this.maps = new MappingSet(def.mappings);
      this.values = { ...this.maps.values };
      this.ctx = {
        THREE, scene: this.scene, camera: this.camera, uniforms: this.uniforms, env, rng: mulberry32(def.seed ?? 1),
        simTime: 0, aspect: 1, state: {}, lastFrame: null, store: null,
        setScheme: (a, b = a, m = 0) => mixSchemes(a, b, m, PAL.value),
      };
      this.ctx.setScheme('electric');
      def.setup?.(this.ctx);
      this.ping = 0; this.frameMs = 0; this.simDebt = 0; this.lastSteps = 1;
    },

    update(store, tick) {
      const hop = store.analysis.hop / store.analysis.sr, env = this.ctx.env;
      // Influence: shape/colour scale their drives; Movement scales the preset's own clock
      const inf = env.influence, motion = inf ? Math.max(0.05, inf.motion) : 1;
      const opts = { scales: influenceScales(inf, def.influenceRoles), timeFactor: env.audio?.smoothing ?? 1 };
      this.ctx.store = store;
      for (const f of tick.frames) {
        this.values = this.maps.apply(f, hop, opts);
        this.ctx.lastFrame = f;
        this.ctx.simTime += hop * motion;
        def.step?.(this.ctx, this.values, f, hop * motion);
      }
      tick = { ...tick, dt: tick.dt * motion };
      this.tick = tick;
    },

    render() {
      const t0 = performance.now();
      const r = this.renderer, ctx = this.ctx, tick = this.tick || { dt: 1 / 60, onsets: 0, nowSec: 0, frames: [] };
      COLOUR.value = ctx.env.influence?.colour ?? 1;
      const dt = Math.min(tick.dt, 0.1);
      this.uniforms.uTime.value = ctx.simTime;
      def.frame?.(ctx, this.values, tick);
      // fixed-rate simulation: as many substeps as simulated time owed (capped to avoid a spiral of death)
      let steps = 1, stepDt = dt;
      if (def.simRate) {
        this.simDebt += dt * def.simRate;
        steps = Math.min(def.maxSubsteps ?? 16, Math.floor(this.simDebt));
        this.simDebt = Math.min(this.simDebt - steps, 2);
        stepDt = 1 / def.simRate;
      }
      this.lastSteps = steps;
      this.uniforms.uDt.value = stepDt;
      for (let i = 0; i < steps; i++) {
        def.substep?.(ctx, i, steps);
        const src = this.rt[this.ping], dst = this.rt[1 - this.ping];
        this.uniforms.uPrev.value = src.texture;
        r.setRenderTarget(dst);
        r.clear();
        this.fbQuad.render(r);
        this.ping = 1 - this.ping;
      }
      const cur = this.rt[this.ping];
      this.uniforms.uDt.value = dt;
      if (this.scene.children.length) {
        r.setRenderTarget(cur);
        EMIT.value = (def.deposit ?? 2.5) * dt;          // per-second deposit rate
        r.render(this.scene, this.camera);
      }
      r.setRenderTarget(null);
      this.presentUniforms.uTex.value = cur.texture;
      this.presentQuad.render(r);
      if (this.scene.children.length) {
        EMIT.value = def.head ?? 0.35;                   // crisp current lines
        r.render(this.scene, this.camera);
      }
      this.frameMs = 0.9 * this.frameMs + 0.1 * (performance.now() - t0);
    },

    resize(w, h, dpr) {
      const pr = Math.min(dpr, 1.25) * (def.simScale ?? 1);   // simulations may run below screen resolution
      this.renderer.setPixelRatio(Math.min(dpr, 1.25));
      this.renderer.setSize(w, h, false);
      const W = Math.max(2, Math.round(w * pr)), H = Math.max(2, Math.round(h * pr));
      for (const t of this.rt) t.setSize(W, H);
      this.uniforms.uTexel.value.set(1 / W, 1 / H);
      const aspect = w / h;
      this.ctx.aspect = aspect;
      this.ctx.bufferHeight = H;
      this.uniforms.uAspect.value = aspect;
      Object.assign(this.camera, { left: -aspect, right: aspect, top: 1, bottom: -1 });
      this.camera.updateProjectionMatrix();
      def.resize?.(this.ctx, aspect);
    },

    diagnostics() {
      const v = this.values, gl = this.renderer.getContext();
      const rows = [
        ['Feedback buffers', `${this.rt[0].width} × ${this.rt[0].height}, half-float`],
        ['CPU per frame', `${this.frameMs.toFixed(2)} ms`],
        ['Simulated time', `${this.ctx.simTime.toFixed(1)} s`],
      ];
      if (def.simRate) rows.push(['Simulation substeps', `${this.lastSteps} this frame (${def.simRate}/s)`]);
      for (const k of ['bass', 'mid', 'high', 'level', 'kick']) if (k in v) rows.push([`Drive ${k}`, v[k].toFixed(2)]);
      if (def.diagnostics) rows.push(...def.diagnostics(this.ctx, v));
      rows.unshift(['GPU', gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)]);
      return rows;
    },

    dispose() {
      this.scene?.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      this.fbQuad?.material.dispose(); this.fbQuad?.dispose();
      this.presentQuad?.material.dispose(); this.presentQuad?.dispose();
      for (const t of this.rt || []) t.dispose();
      this.renderer?.dispose(); this.renderer?.forceContextLoss();
      this.renderer = null;
    },
  };
}

/** Program cycling helper: advances the cycler on the audio clock and crossfades the colour scheme. */
export function cycleSchemes(ctx, cycler, programs, hop, kick) {
  cycler.step(hop, kick);
  const a = programs[cycler.current].scheme, b = programs[cycler.next].scheme;
  ctx.setScheme(a, cycler.fading ? b : a, cycler.fading ? cycler.weight : 0);
}

/** Common audio drives for Phase 3 presets: pulses carry the beat, levels carry the body. */
export const COMMON_MAPPINGS = Object.freeze({
  bass:  { sources: [['lowPulse', 1.0], ['bass', 0.2]], release: 0.08 },
  mid:   { sources: [['midPulse', 0.6], ['lowMidPulse', 0.4], ['mid', 0.2]], release: 0.1 },
  high:  { sources: [['presencePulse', 0.5], ['brilliancePulse', 0.5], ['brilliance', 0.15]], curve: 'sqrt', threshold: 0.05, release: 0.08 },
  body:  { sources: [['bass', 0.5], ['mid', 0.3], ['level', 0.2]], attack: 0.1, release: 0.6 },
  // brightness: the kick pulse, not overall level (limited masters barely move); quarter-beat release
  level: { sources: [['level', 0.25], ['lowPulse', 0.85], ['levelPulse', 0.3]], attack: 0.02, release: 0.12 },
  kick:  { sources: [['onset', 1]] },
  hue:   { sources: [['centroid', 1]], attack: 0.25, release: 0.8 },
  balance: { sources: [['balance', 1]], signed: true, gain: 1.5, min: -1, max: 1, attack: 0.2, release: 0.4 },
  width: { sources: [['width', 1]], attack: 0.1, release: 0.6 },
});
