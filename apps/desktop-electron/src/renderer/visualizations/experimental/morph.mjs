// Experimental › Morph — Three.js renderer for MorphModel.
// Layers and what drives them (all through MORPH_MAPPINGS):
//   mesh shape      bass → 3-lobed harmonic + squash/stretch; mids → travelling waves;
//                   highs → fine ripples; balance → lean; onsets → spring kick
//   mesh colour     centroid → palette position; level → brightness and rim glow; crests glow on onsets
//   particles       launched from the surface on onsets (count and speed ∝ onset strength)
//   background      bass → swirl distortion and brightness; centroid → hue; onsets → flash (limited)
//   bloom           level → strength; onsets → brief boost (through the flash limiter)
//   camera          slow autonomous orbit; stereo width → orbit speed; level → distance
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MappingSet, influenceScales } from '../../engine/mapping.mjs';
import { MorphModel, DEFAULT_PARAMS, MORPH_MAPPINGS } from './morph-model.mjs';

const PALETTE = /* glsl */`
  vec3 palette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
`;

const MESH_VS = /* glsl */`
  attribute float disp;
  varying vec3 vN; varying vec3 vView; varying float vDisp; varying vec3 vPos;
  void main() {
    vDisp = disp; vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const MESH_FS = /* glsl */`
  uniform float uHue, uGlow, uTime, uKick, uMaxDisp;
  varying vec3 vN; varying vec3 vView; varying float vDisp; varying vec3 vPos;
  ${PALETTE}
  void main() {
    vec3 n = normalize(vN), v = normalize(vView);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    float t = uHue + 0.45 * vDisp / uMaxDisp + 0.06 * sin(uTime * 0.3 + vPos.y * 3.0);
    vec3 base = palette(t);
    vec3 L = normalize(vec3(0.4, 0.8, 0.5));
    float diff = 0.25 + 0.75 * max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), v), 0.0), 32.0);
    // linear-light budget: diffuse ≤ 0.85, rim ≤ 0.9, crest ≤ 0.6 — only crests and rims exceed
    // the bloom threshold, so glow marks where the sound pushes, not the whole object
    vec3 col = base * diff * (0.22 + 0.55 * uGlow)
             + palette(t + 0.5) * fres * (0.25 + 0.65 * uGlow)
             + vec3(spec) * 0.25
             + base * smoothstep(0.2 * uMaxDisp, uMaxDisp, vDisp) * (0.15 + 0.45 * uKick);
    gl_FragColor = vec4(col, 1.0);
  }`;

const POINTS_VS = /* glsl */`
  attribute float alpha;
  uniform float uSize;
  varying float vA;
  void main() {
    vA = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = alpha > 0.0 ? uSize * (0.4 + alpha) * (300.0 / -mv.z) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;

const POINTS_FS = /* glsl */`
  uniform float uHue;
  varying float vA;
  ${PALETTE}
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    gl_FragColor = vec4(palette(uHue + 0.5 + 0.2 * vA) * a, a);
  }`;

const BG_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

const BG_FS = /* glsl */`
  uniform float uTime, uHue, uBass, uFlash, uAspect;
  varying vec2 vUv;
  ${PALETTE}
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
    float r = length(p), a = atan(p.y, p.x);
    // integer multiples of the angle keep the field continuous across atan's ±π seam
    float swirl = 3.0 * a + 4.0 * r - 0.25 * uTime + 1.5 * sin(3.0 * r - 0.4 * uTime) * uBass;
    float bands = 0.5 + 0.5 * sin(2.0 * swirl);
    vec3 c = palette(uHue + 0.6 + 0.15 * r + 0.1 * bands);
    float vign = smoothstep(1.7, 0.15, r);
    vec3 col = c * (0.015 + 0.035 * bands + 0.09 * uBass * bands) * vign + c * uFlash * 0.12;
    gl_FragColor = vec4(col, 1.0);
  }`;

function createMorph() {
  return {
    contextType: 'webgl2',
    initialize(canvas, env) {
      this.env = env;
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      r.setClearColor(0x000000, 1);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.info.autoReset = false;   // count every pass of a frame, not just the last one
      this.renderer = r;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      this.orbit = 0; this.renderTime = 0; this.flash = 0;

      // ---- deformable mesh: indexed icosphere so normals are smooth ----
      let g = new THREE.IcosahedronGeometry(1, 28);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      g = mergeVertices(g, 1e-5);
      const dirs = Float32Array.from(g.getAttribute('position').array);
      for (let i = 0; i < dirs.length; i += 3) {
        const l = Math.hypot(dirs[i], dirs[i + 1], dirs[i + 2]);
        dirs[i] /= l; dirs[i + 1] /= l; dirs[i + 2] /= l;
      }
      this.model = new MorphModel(dirs, DEFAULT_PARAMS);
      this.maps = new MappingSet(MORPH_MAPPINGS);
      this.values = { ...this.maps.values };
      const n = this.model.n;
      this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.dispAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.posAttr);
      g.setAttribute('disp', this.dispAttr);
      this.geometry = g;
      this.meshUniforms = { uHue: { value: 0.55 }, uGlow: { value: 0 }, uTime: { value: 0 }, uKick: { value: 0 }, uMaxDisp: { value: this.model.maxDisplacement() * 0.35 } };
      this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: MESH_VS, fragmentShader: MESH_FS, uniforms: this.meshUniforms }));
      this.scene.add(this.mesh);

      // ---- particles ----
      const P = this.model.particles;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.alphaAttr = new THREE.BufferAttribute(new Float32Array(P.N), 1).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('alpha', this.alphaAttr);
      this.pointUniforms = { uHue: this.meshUniforms.uHue, uSize: { value: 0.09 } };
      this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
        vertexShader: POINTS_VS, fragmentShader: POINTS_FS, uniforms: this.pointUniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.points.frustumCulled = false;
      this.scene.add(this.points);

      // ---- background field ----
      this.bgUniforms = { uTime: { value: 0 }, uHue: this.meshUniforms.uHue, uBass: { value: 0 }, uFlash: { value: 0 }, uAspect: { value: 1 } };
      this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        vertexShader: BG_VS, fragmentShader: BG_FS, uniforms: this.bgUniforms, depthTest: false, depthWrite: false,
      }));
      this.bg.frustumCulled = false; this.bg.renderOrder = -1;
      this.scene.add(this.bg);

      // ---- post: bloom, then tone mapping + sRGB output ----
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.55);
      this.composer.addPass(this.bloom);
      // v0.12 colour intensity (Influence panel): saturation and brightness around Rec. 709 luma
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uColour: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uColour; varying vec2 vUv;
          void main() { vec4 t = texture2D(tDiffuse, vUv); float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)), s = clamp(uColour, 0.0, 2.0);
            gl_FragColor = vec4(max(mix(vec3(l), t.rgb, s), 0.0) * (0.75 + 0.25 * min(s, 1.6)), t.a); }`,
      });
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());
      this.geomMs = 0;
    },

    update(store, tick) {
      const hop = store.analysis.hop / store.analysis.sr, inf = this.env.influence;
      const motion = inf ? Math.max(0.05, inf.motion) : 1;
      // shape: bass/mid/high/lean/kick drive the springs; colour: glow and hue (Influence panel)
      const opts = { scales: influenceScales(inf, { shape: ['bass', 'mid', 'high', 'asym', 'kick'], colour: ['glow', 'hue'] }), timeFactor: this.env.audio?.smoothing ?? 1 };
      let kickPeak = 0;
      for (const f of tick.frames) {
        this.values = this.maps.apply(f, hop, opts);
        this.model.stepFrame(this.values, hop * motion);
        if (this.values.kick > 0) {
          kickPeak = Math.max(kickPeak, this.values.kick);
          this.flash = Math.max(this.flash, this.env.flash.request(tick.nowSec, this.values.kick));
        }
      }
      const dt = tick.dt * motion;
      this.renderTime += dt;
      this.flash *= Math.exp(-dt / 0.18);
      this.kickGlow = Math.max((this.kickGlow || 0) * Math.exp(-dt / 0.25), kickPeak);
      this.orbit += dt * (0.07 + 0.35 * this.values.width);
    },

    render() {
      const t0 = performance.now();
      this.model.writeGeometry(this.posAttr.array, this.dispAttr.array);
      this.posAttr.needsUpdate = true; this.dispAttr.needsUpdate = true;
      this.geometry.computeVertexNormals();
      const P = this.model.particles;
      for (let k = 0; k < P.N; k++) this.alphaAttr.array[k] = P.life[k] > 0 ? P.life[k] / P.maxLife[k] : 0;
      this.points.geometry.getAttribute('position').needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.geomMs = 0.9 * this.geomMs + 0.1 * (performance.now() - t0);

      const v = this.values, u = this.meshUniforms;
      u.uHue.value = 0.55 + 0.8 * v.hue;
      u.uGlow.value = v.glow;
      u.uTime.value = this.renderTime;
      u.uKick.value = this.kickGlow;
      this.bgUniforms.uTime.value = this.renderTime;
      this.bgUniforms.uBass.value = Math.max(0, this.model.springs.bass.x);
      this.bgUniforms.uFlash.value = this.flash;
      const colour = this.env.influence?.colour ?? 1;
      this.grade.uniforms.uColour.value = colour;
      this.bloom.strength = Math.min(1.2, (0.35 + 0.45 * v.glow + 0.6 * this.flash) * (0.4 + 0.6 * Math.min(colour, 1.6)));

      const d = 4.2 - 0.35 * v.glow;
      this.camera.position.set(Math.sin(this.orbit) * d, 0.35 * Math.sin(this.renderTime * 0.07) * d, Math.cos(this.orbit) * d);
      this.camera.lookAt(0, 0, 0);
      this.mesh.rotation.y = this.points.rotation.y = 0.1 * this.renderTime;
      this.renderer.info.reset();
      this.composer.render();
    },

    resize(w, h, dpr) {
      // render scale is capped at 1.5× to keep 1080p+ fill-rate reasonable on high-DPI screens
      const pr = Math.min(dpr, 1.5);
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.bgUniforms.uAspect.value = w / h;
    },

    diagnostics() {
      const info = this.renderer.info, v = this.values, s = this.model.stats;
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return [
        ['GPU', ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)],
        ['Vertices / triangles', `${this.model.n} / ${info.render.triangles}`],
        ['Draw calls', String(info.render.calls)],
        ['Geometry update (CPU)', `${this.geomMs.toFixed(2)} ms`],
        ['Drive bass / mid / high', `${v.bass.toFixed(2)} / ${v.mid.toFixed(2)} / ${v.high.toFixed(2)}`],
        ['Lean (balance)', v.asym.toFixed(2)],
        ['Displacement rms / max', `${s.rms.toFixed(3)} / ${s.maxAbs.toFixed(3)} (bound ${this.model.maxDisplacement().toFixed(2)})`],
        ['Particles alive', String(this.model.particles.active)],
        ['Simulated time', `${this.model.time.toFixed(1)} s`],
      ];
    },

    dispose() {
      this.geometry?.dispose(); this.mesh?.material.dispose();
      this.points?.geometry.dispose(); this.points?.material.dispose();
      this.bg?.geometry.dispose(); this.bg?.material.dispose();
      this.bloom?.dispose(); this.composer?.dispose();
      this.renderer?.dispose();
      this.renderer?.forceContextLoss();   // free the GPU context now, not at garbage collection
      this.renderer = null;
    },
  };
}

// merge into the Experimental collection (v0.17: Particle Swarm registers there too); Morph first
const reg = (self.Visualizations ||= { collections: [] });
let coll = reg.collections.find((c) => c.id === 'experimental');
if (!coll) { coll = { id: 'experimental', name: 'Experimental', available: true, presets: [] }; reg.collections.push(coll); }
coll.presets = [{ id: 'morph', name: 'Morph', create: createMorph }, ...coll.presets.filter((p) => p.id !== 'morph')];
coll.available = true; coll.name = 'Experimental';   // replaces Bars & Waves' 'failed to load' placeholder
