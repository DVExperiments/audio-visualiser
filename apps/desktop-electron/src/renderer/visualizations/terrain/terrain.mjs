// Spectrum terrain (v0.19): the spectrum as a synthwave landscape. The newest row rises at the
// front and rolls away towards a striped sun on the horizon. Registered into Bars & Waves.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TERRAIN, heightRow, RowHistory } from './terrain-model.mjs';

const { cols: C, rows: R } = TERRAIN;

const TERRAIN_VS = /* glsl */`
  attribute vec2 grid; attribute float h;
  varying vec2 vGrid; varying float vH; varying float vDist;
  void main() {
    vGrid = vec2(grid.x * 0.5, grid.y); vH = h;      // a line every 2 columns and every row
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const TERRAIN_FS = /* glsl */`
  uniform float uGlow, uFogNear, uFogFar; uniform vec3 uFog;
  varying vec2 vGrid; varying float vH; varying float vDist;
  void main() {
    vec2 g = abs(fract(vGrid - 0.5) - 0.5) / max(fwidth(vGrid), vec2(1e-4));   // anti-aliased grid lines
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    // violet valleys → magenta slopes → orange/yellow peaks
    vec3 lineCol = mix(vec3(0.42, 0.18, 1.0), vec3(1.0, 0.18, 0.72), smoothstep(0.04, 0.45, vH));
    lineCol = mix(lineCol, vec3(1.0, 0.72, 0.22), smoothstep(0.55, 1.0, vH));
    vec3 face = vec3(0.02, 0.0, 0.045) + lineCol * 0.06 * vH;
    vec3 col = face + lineCol * line * (0.75 + 0.6 * uGlow);
    gl_FragColor = vec4(mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist)), 1.0);
  }`;

// sky: screen-space quad behind everything; the sun sits on the projected horizon
const SKY_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }';
const SKY_FS = /* glsl */`
  uniform float uHorizon, uAspect, uSun, uTime; uniform vec3 uFog; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float y = vUv.y - uHorizon;                                       // > 0 above the horizon
    vec3 col = y < 0.0 ? mix(uFog, vec3(0.015, 0.0, 0.03), smoothstep(0.0, 0.08, -y))   // dark ground below the horizon
                       : mix(uFog, vec3(0.03, 0.01, 0.1), smoothstep(0.0, 0.55, y));
    // stars, upper sky only
    vec2 sp = vUv * vec2(uAspect, 1.0) * 140.0;
    float star = step(0.996, hash(sp)) * smoothstep(0.12, 0.45, y) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(sp + 7.0) * 30.0));
    col += vec3(0.8, 0.8, 1.0) * star;
    // the sun: yellow at the top to magenta at the bottom, with widening bands cut out of its lower half
    vec2 p = vec2((vUv.x - 0.5) * uAspect, y - 0.12);
    float r = 0.2, d = length(p);
    if (d < r && y > -0.005) {
      float t = clamp((p.y + r) / (2.0 * r), 0.0, 1.0);
      vec3 sun = mix(vec3(0.95, 0.12, 0.5), vec3(1.0, 0.78, 0.22), t) * (0.62 + 0.18 * uSun);   // stays below 1: bloom must not turn it white
      float band = (p.y < 0.0) ? step(fract(p.y * 22.0), 0.35 + 0.55 * (-p.y / r)) : 0.0;   // gaps widen towards the bottom
      col = mix(sun, col, band);
    }
    col += vec3(1.0, 0.3, 0.6) * 0.04 * exp(-d * 6.0) * (1.0 + 0.5 * uSun);   // haze round the sun
    gl_FragColor = vec4(col, 1.0);
  }`;

function createTerrain() {
  return {
    contextType: 'webgl2',
    initialize(canvas, env) {
      this.env = env;
      const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
      r.setClearColor(0x000000, 1);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
      const fog = new THREE.Color(0.13, 0.02, 0.16);

      // terrain grid: positions and heights rewritten each frame (C × R vertices)
      const g = new THREE.BufferGeometry(), N = C * R;
      this.pos = new Float32Array(N * 3); this.h = new Float32Array(N);
      const grid = new Float32Array(N * 2), idx = [];
      for (let rr = 0; rr < R; rr++) for (let c = 0; c < C; c++) { const i = rr * C + c; grid[2 * i] = c; grid[2 * i + 1] = rr; }
      for (let rr = 0; rr < R - 1; rr++) for (let c = 0; c < C - 1; c++) { const a = rr * C + c, b = a + 1, d = a + C, e = d + 1; idx.push(a, d, b, b, d, e); }
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('h', new THREE.BufferAttribute(this.h, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('grid', new THREE.BufferAttribute(grid, 2));
      g.setIndex(idx);
      this.terrainMat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, side: THREE.DoubleSide,
        uniforms: { uGlow: { value: 0 }, uFog: { value: fog }, uFogNear: { value: 6 }, uFogFar: { value: TERRAIN.depth + 2 } } });
      this.mesh = new THREE.Mesh(g, this.terrainMat); this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);

      this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, depthTest: false,
        uniforms: { uHorizon: { value: 0.6 }, uAspect: { value: 1 }, uSun: { value: 0 }, uTime: { value: 0 }, uFog: { value: fog } } });
      this.sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -1;
      this.scene.add(this.sky);

      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.45); this.composer.addPass(this.bloom);
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uColour: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uColour; varying vec2 vUv;
          void main() { vec4 t = texture2D(tDiffuse, vUv); float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)), s = clamp(uColour, 0.0, 2.0);
            gl_FragColor = vec4(max(mix(vec3(l), t.rgb, s), 0.0) * (0.75 + 0.25 * min(s, 1.6)), t.a); }`,
      });
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());

      this.hist = new RowHistory(); this.row = new Float32Array(C);
      Object.assign(this, { low: 0, flash: 0, time: 0, dt: 1 / 60 });
    },

    update(store, tick) {
      const dt = Math.min(0.1, tick.dt || 1 / 60), inf = this.env.influence, motion = inf ? Math.max(0.05, inf.motion) : 1;
      heightRow(store.spectrum.values, this.row);
      this.hist.step(this.row, dt * motion);                 // Movement: flying speed
      const f = store.frame, p = f?.bandsPulse ? Math.max(f.bandsPulse[0], f.bandsPulse[1]) : 0;
      this.low += (p - this.low) * (1 - Math.exp(-dt / (p > this.low ? 0.03 : 0.3)));
      if (tick.onsets > 0) this.flash = Math.max(this.flash, this.env.flash.request(tick.nowSec, 0.25 + 0.35 * tick.maxConfidence));
      this.flash *= Math.exp(-dt / 0.15);
      this.time += dt * motion; this.dt = dt;
    },

    render() {
      const r = this.renderer;
      if (!r) return;
      const inf = this.env.influence, shape = inf?.shape ?? 1, colour = inf?.colour ?? 1, T = TERRAIN;
      const dz = T.depth / (R - 1), ph = this.hist.phase, H = T.height * shape;
      // row rr holds the snapshot rr steps old; rows recede by the scroll phase, so motion is continuous
      for (let rr = 0; rr < R; rr++) {
        const z = 3.4 - (rr + ph) * dz;               // the front row passes under the camera
        for (let c = 0; c < C; c++) {
          const i = rr * C + c, hv = this.hist.at(rr, c);
          this.pos[3 * i] = (c / (C - 1) - 0.5) * T.width; this.pos[3 * i + 1] = hv * H; this.pos[3 * i + 2] = z;
          this.h[i] = hv;
        }
      }
      const geo = this.mesh.geometry; geo.attributes.position.needsUpdate = true; geo.attributes.h.needsUpdate = true;
      // camera: low over the road, swaying gently
      this.camera.position.set(0.35 * Math.sin(this.time * 0.23), 1.15 + 0.08 * Math.sin(this.time * 0.31), 3.2);
      this.camera.lookAt(0, 0.55, -T.depth * 0.6);
      // the sky's horizon follows the camera: project the far end of the terrain
      const far = new THREE.Vector3(0, 0, 3.4 - T.depth).project(this.camera);
      this.skyMat.uniforms.uHorizon.value = 0.5 + 0.5 * far.y;
      this.skyMat.uniforms.uSun.value = this.low; this.skyMat.uniforms.uTime.value = this.time;
      this.terrainMat.uniforms.uGlow.value = this.low + 0.6 * this.flash;
      this.bloom.strength = Math.min(0.9, (0.38 + 0.25 * this.low + 0.2 * this.flash) * (0.4 + 0.6 * Math.min(colour, 1.6)));
      this.grade.uniforms.uColour.value = colour;
      this.composer.render(this.dt);
    },

    resize(w, h, dpr) {
      const r = this.renderer; if (!r) return;
      r.setPixelRatio(dpr); r.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
      this.skyMat.uniforms.uAspect.value = w / h;
    },

    dispose() {
      this.mesh?.geometry.dispose(); this.terrainMat?.dispose(); this.sky?.geometry.dispose(); this.skyMat?.dispose();
      this.bloom?.dispose(); this.composer?.dispose();
      this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer = null;
    },
  };
}

const reg = (self.Visualizations ||= { collections: [] });
const coll = reg.collections.find((c) => c.id === 'bars-waves');
if (coll) coll.presets = [...coll.presets.filter((p) => p.id !== 'terrain'), { id: 'terrain', name: 'Spectrum terrain', create: createTerrain }];
