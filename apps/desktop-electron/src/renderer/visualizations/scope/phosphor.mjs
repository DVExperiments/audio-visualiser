// Phosphor oscilloscope (v0.18): left channel → x, right channel → y, drawn as a CRT beam through
// every sample, with P31-style phosphor afterglow. Registered into Bars & Waves.
import * as THREE from 'three';
import { createFeedbackPreset, EMIT } from '../../engine/feedback.mjs';
import { BEAM, buildBeam, beamIndex, gainStep } from './phosphor-model.mjs';

const MAX = BEAM.maxSegments;

// the phosphor: two decay components, stored in separate channels (r fast glow, g slow tail)
const FEEDBACK_FS = /* glsl */`
  uniform float uFastTau, uSlowTau;
  void main() {
    vec4 c = texture2D(uPrev, vUv);
    gl_FragColor = vec4(c.r * exp(-uDt / uFastTau), c.g * exp(-uDt / uSlowTau), 0.0, 1.0);   // exact decay per step
  }`;

const PRESENT_FS = /* glsl */`
  uniform sampler2D uTex; uniform float uExposure; uniform vec3 uTint; uniform float uSlowShare, uGrid;
  float energy(vec2 uv) { vec4 c = texture2D(uTex, uv); return c.r + uSlowShare * c.g; }
  void main() {
    float e = energy(vUv);
    // glow: a soft ring of samples round the pixel (light scattering in the glass)
    float g = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = 6.2831853 * float(i) / 8.0;
      vec2 o = vec2(cos(a), sin(a)) * uTexel;
      g += energy(vUv + 2.5 * o) + 0.5 * energy(vUv + 6.0 * o);
    }
    g /= 12.0;
    float b = 1.0 - exp(-(e + 0.55 * g) * uExposure);
    vec3 col = uTint * b + vec3(1.0) * smoothstep(0.8, 2.5, e) * 0.55;          // white-hot where the beam rests
    // graticule: 10 × 10 divisions of 0.2 over [−1, 1]², brighter centre cross; faint, like a real scope
    vec2 p = toP(vUv), d = abs(fract(p / 0.2 + 0.5) - 0.5) * 0.2;
    float px = 2.0 / (1.0 / uTexel.y), inside = step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
    float line = max(1.0 - smoothstep(0.0, 1.2 * px, d.x), 1.0 - smoothstep(0.0, 1.2 * px, d.y));
    float axes = max(1.0 - smoothstep(0.0, 1.5 * px, abs(p.x)), 1.0 - smoothstep(0.0, 1.5 * px, abs(p.y)));
    col += uTint * (0.035 * line + 0.05 * axes) * inside * uGrid;
    col += uTint * 0.012 * (1.0 - smoothstep(0.6, 1.8, length(p)));               // faint glass glow
    gl_FragColor = vec4(grade(col), 1.0);
  }`;

const def = {
  seed: 31,
  mappings: { level: { sources: [['level', 1]] } },
  uniforms: { uFastTau: BEAM.fastTau, uSlowTau: BEAM.slowTau, uTint: new THREE.Color(0.32, 1.0, 0.42), uSlowShare: BEAM.slowShare, uGrid: 1 },
  feedbackFS: FEEDBACK_FS,
  presentFS: PRESENT_FS,
  exposure: 1.6,
  deposit: 1,
  head: 0,            // the beam is deposited once, into the phosphor; no separate crisp pass
  setup(ctx) {
    const g = new THREE.BufferGeometry();
    const out = { position: new Float32Array(MAX * 12), edge: new Float32Array(MAX * 4), inten: new Float32Array(MAX * 4) };
    g.setAttribute('position', new THREE.BufferAttribute(out.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('edge', new THREE.BufferAttribute(out.edge, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('inten', new THREE.BufferAttribute(out.inten, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(beamIndex(MAX), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uEmit: EMIT, uNorm: { value: 1 }, uSlowShare: { value: BEAM.slowShare } },
      vertexShader: /* glsl */`
        attribute float edge; attribute float inten; varying float vEdge; varying float vI;
        void main() { vEdge = edge; vI = inten; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // Gaussian beam profile across the stroke; energy goes into the fast and slow phosphor channels
      fragmentShader: /* glsl */`
        uniform float uEmit, uNorm; varying float vEdge; varying float vI;
        // (x·x, not pow(x, 2.0): GLSL's pow is undefined for negative bases and gives NaN on many GPUs)
        void main() { float q = vEdge * ${BEAM.halo.toFixed(1)}; float e = vI * exp(-0.5 * q * q) * uEmit * uNorm; gl_FragColor = vec4(e, e, 0.0, 1.0); }`,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    ctx.scene.add(mesh);
    Object.assign(ctx.state, { mesh, mat, out, pending: 0, gain: 1, peak: 0,
      L: new Float32Array(MAX + 1), R: new Float32Array(MAX + 1), x: new Float32Array(MAX + 1), y: new Float32Array(MAX + 1) });
  },
  step(ctx, values, f) { ctx.state.pending += f.waveL.length; },   // every new sample since the last frame
  frame(ctx, values, tick) {
    const st = ctx.state, store = ctx.store;
    const n = Math.min(st.pending, MAX);
    st.pending = 0;
    if (!store || n < 1) { st.mesh.geometry.setDrawRange(0, 0); return; }
    store.recentWave(n + 1, st.L, st.R);            // + the previous frame's last point, so frames join
    let peak = 0;
    for (let i = 0; i <= n; i++) peak = Math.max(peak, Math.abs(st.L[i]), Math.abs(st.R[i]));
    const dt = Math.min(tick.dt, 0.1);
    st.gain = gainStep(st.gain, peak, dt);
    for (let i = 0; i <= n; i++) { st.x[i] = st.L[i] * st.gain; st.y[i] = st.R[i] * st.gain; }   // x = left, y = right
    const segs = buildBeam(st.x, st.y, n, store.analysis.sr, st.out);
    st.mesh.geometry.setDrawRange(0, segs * 6);
    for (const k of ['position', 'edge', 'inten']) st.mesh.geometry.getAttribute(k).needsUpdate = true;
    // the engine scales deposits by deposit·Δt; beam energy is already per sample, so undo that here
    st.mat.uniforms.uNorm.value = 1 / Math.max(1e-4, dt);
  },
  diagnostics: (ctx) => [['Beam gain', `×${ctx.state.gain.toFixed(2)}`]],
};

const reg = (self.Visualizations ||= { collections: [] });
const coll = reg.collections.find((c) => c.id === 'bars-waves');
if (coll) coll.presets = [...coll.presets.filter((p) => p.id !== 'phosphor'), { id: 'phosphor', name: 'Phosphor scope', create: () => createFeedbackPreset(def) }];
