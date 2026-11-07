// Particle swarm (v0.17): 65 536 particles simulated on the GPU, after iTunes' Magnetosphere.
// Positions and velocities live in float textures, updated by the shaders below, which mirror
// stepParticle() in swarm-model.mjs term for term (the tests run that JS twin).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MappingSet, mulberry32, influenceScales } from '../../engine/mapping.mjs';
import { SWARM, MAGNETS, SWARM_MAPPINGS, SWARM_ROLES, magnetState, initialState, breathStep } from './swarm-model.mjs';

const QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// velocity update: exactly stepParticle()'s force and integration, minus the position update
const VEL_FS = /* glsl */`
  precision highp float;
  uniform sampler2D uPos, uVel;
  uniform float uH, uTurb, uTime, uG, uEps, uCentre, uWallR, uWall, uDrag, uVmax, uTF, uTG;
  uniform vec4 uMagA[5];   // xyz position, w pull strength
  uniform vec4 uMagB[5];   // x swirl strength, yzw swirl axis
  varying vec2 vUv;
  void main() {
    vec3 p = texture2D(uPos, vUv).xyz;
    vec4 vv = texture2D(uVel, vUv);
    vec3 v = vv.xyz;
    float r = length(p), wall = r > uWallR ? uWall * (r - uWallR) / r : 0.0;
    vec3 a = -(uCentre + wall) * p;
    for (int k = 0; k < 5; k++) {
      vec3 d = uMagA[k].xyz - p;
      float r2 = dot(d, d) + uEps * uEps, inv = uG / (r2 * sqrt(r2));
      a += inv * (uMagA[k].w * d + uMagB[k].x * cross(uMagB[k].yzw, d));
    }
    a += uTG * uTurb * vec3(sin(uTF * p.y + uTime), sin(uTF * p.z + uTime), sin(uTF * p.x + uTime));
    v = (v + a * uH) * exp(-uDrag * uH);
    float sp = length(v);
    if (sp > uVmax) v *= uVmax / sp;
    gl_FragColor = vec4(v, vv.w);
  }`;

const POS_FS = /* glsl */`
  precision highp float;
  uniform sampler2D uPos, uVel; uniform float uH; varying vec2 vUv;
  void main() { vec4 p = texture2D(uPos, vUv); gl_FragColor = vec4(p.xyz + texture2D(uVel, vUv).xyz * uH, p.w); }`;

const POINT_VS = /* glsl */`
  uniform sampler2D uPos, uVel; uniform float uBreath, uSize, uPixel;
  uniform vec4 uMagA[5]; uniform vec3 uMagColour[5];
  attribute vec2 ref;
  varying float vSpeed, vSeed; varying vec3 vBand;
  void main() {
    vec4 pp = texture2D(uPos, ref);
    vSpeed = length(texture2D(uVel, ref).xyz); vSeed = pp.w;
    // colour = the bands holding this particle: each magnet weighted by pull / distance²
    vec3 band = vec3(0.0); float wsum = 0.0;
    // weights cubed: a soft "nearest magnet wins", so colours stay saturated instead of averaging to grey
    for (int k = 0; k < 5; k++) { vec3 d = uMagA[k].xyz - pp.xyz; float w = uMagA[k].w / (dot(d, d) + 0.08); w = w * w * w; band += w * uMagColour[k]; wsum += w; }
    band /= max(wsum, 1e-9);
    vBand = band / max(max(band.r, band.g), max(band.b, 1e-4));   // brightest channel = 1: hue and saturation kept
    vec4 mv = modelViewMatrix * vec4(pp.xyz * (1.0 + uBreath), 1.0);   // the beat's breath
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uPixel / -mv.z, 1.0, 24.0);
  }`;

const HSV = /* glsl */`vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }`;

const POINT_FS = /* glsl */`
  uniform float uHue, uGlow;
  varying float vSpeed, vSeed; varying vec3 vBand;
  ${HSV}
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 3.5);
    // mostly the colour of the bands holding the particle; a little scene hue and per-particle variety
    vec3 hue = hsv2rgb(vec3(fract(uHue + vSeed * 0.2), 0.8, 1.0));
    vec3 col = mix(vBand, hue, 0.18);
    gl_FragColor = vec4(col * a * (0.13 + 0.24 * min(vSpeed / 2.5, 1.5)) * uGlow, a);
  }`;

const ORB_VS = /* glsl */`
  attribute vec3 tint; attribute float strength; uniform float uPixel, uBreath; varying vec3 vTint; varying float vStrength;
  void main() {
    vTint = tint; vStrength = strength;
    vec4 mv = modelViewMatrix * vec4(position * (1.0 + uBreath), 1.0); gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((0.06 + 0.07 * strength) * uPixel / -mv.z, 2.0, 64.0);
  }`;
const ORB_FS = /* glsl */`
  varying vec3 vTint; varying float vStrength; uniform float uGlow;
  void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
    float a = exp(-r2 * 5.0) + 0.6 * exp(-r2 * 40.0);
    gl_FragColor = vec4(vTint * a * (0.35 + 0.35 * vStrength) * uGlow, a); }`;

function createSwarm() {
  return {
    contextType: 'webgl2',
    initialize(canvas, env) {
      this.env = env;
      const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }));
      r.setClearColor(0x000000, 1);
      // float textures for the simulation; half floats (and fewer particles) if the GPU lacks them
      this.float = r.extensions.has('EXT_color_buffer_float');
      const S = (this.side = this.float ? 256 : 128), N = (this.count = S * S);
      const type = this.float ? THREE.FloatType : THREE.HalfFloatType;
      const rt = () => new THREE.WebGLRenderTarget(S, S, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
      this.rtPos = [rt(), rt()]; this.rtVel = [rt(), rt()]; this.flip = 0;
      const init = initialState(N, mulberry32(17));
      const tex = (data) => {
        const src = this.float ? data : (() => { const h = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) h[i] = THREE.DataUtils.toHalfFloat(data[i]); return h; })();
        const t = new THREE.DataTexture(src, S, S, THREE.RGBAFormat, type); t.needsUpdate = true; return t;
      };
      this.initPos = tex(init.pos); this.initVel = tex(init.vel);
      this.posSrc = this.initPos; this.velSrc = this.initVel;

      // simulation passes on a full-screen quad
      this.simScene = new THREE.Scene(); this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const magA = Array.from({ length: 5 }, () => new THREE.Vector4()), magB = Array.from({ length: 5 }, () => new THREE.Vector4());
      this.velMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: VEL_FS, uniforms: {
        uPos: { value: null }, uVel: { value: null }, uH: { value: SWARM.step }, uTurb: { value: 0 }, uTime: { value: 0 },
        uG: { value: SWARM.G }, uEps: { value: SWARM.eps }, uCentre: { value: SWARM.centre }, uWallR: { value: SWARM.wallR }, uWall: { value: SWARM.wall },
        uDrag: { value: SWARM.drag }, uVmax: { value: SWARM.vmax }, uTF: { value: SWARM.turbFreq }, uTG: { value: SWARM.turbGain },
        uMagA: { value: magA }, uMagB: { value: magB } } });
      this.posMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: POS_FS, uniforms: { uPos: { value: null }, uVel: { value: null }, uH: { value: SWARM.step } } });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.velMat);
      this.simScene.add(this.quad);

      // the visible scene
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      const g = new THREE.BufferGeometry(), ref = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { ref[2 * i] = ((i % S) + 0.5) / S; ref[2 * i + 1] = (Math.floor(i / S) + 0.5) / S; }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));   // unused; sets the draw count
      g.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
      this.pointMat = new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uPos: { value: null }, uVel: { value: null }, uBreath: { value: 0 }, uSize: { value: 0.022 }, uPixel: { value: 600 }, uHue: { value: 0.6 }, uGlow: { value: 1 },
          uMagA: this.velMat.uniforms.uMagA,      // shared: the same magnet positions and pulls as the simulation
          uMagColour: { value: MAGNETS.map((m) => new THREE.Vector3(...m.colour)) } } });
      this.points = new THREE.Points(g, this.pointMat); this.points.frustumCulled = false;
      this.scene.add(this.points);
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
      og.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(MAGNETS.flatMap((m) => m.colour)), 3));
      og.setAttribute('strength', new THREE.BufferAttribute(new Float32Array(5), 1));
      this.orbMat = new THREE.ShaderMaterial({ vertexShader: ORB_VS, fragmentShader: ORB_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uPixel: { value: 600 }, uBreath: { value: 0 }, uGlow: { value: 1 } } });
      this.orbs = new THREE.Points(og, this.orbMat); this.orbs.frustumCulled = false;
      this.scene.add(this.orbs);

      // post: short trails (frame-rate independent), bloom, colour grade (Influence), output
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.trails = new AfterimagePass(0.8); this.composer.addPass(this.trails);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.12); this.composer.addPass(this.bloom);
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uColour: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uColour; varying vec2 vUv;
          void main() { vec4 t = texture2D(tDiffuse, vUv); float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)), s = clamp(uColour, 0.0, 2.0);
            gl_FragColor = vec4(max(mix(vec3(l), t.rgb, s), 0.0) * (0.75 + 0.25 * min(s, 1.6)), t.a); }`,
      });
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());

      this.maps = new MappingSet(SWARM_MAPPINGS);
      this.values = this.maps.values;
      this.mags = new Float32Array(40);
      Object.assign(this, { simDebt: 0, phaseTime: 0, simTime: 0, breath: 0, flash: 0, orbit: 0.4, hueDrift: 0, pendingDt: 1 / 60 });
    },

    update(store, tick) {
      if (!store.analysis) return;
      const hop = store.analysis.hop / store.analysis.sr, inf = this.env.influence;
      const opts = { scales: influenceScales(inf, SWARM_ROLES), timeFactor: this.env.audio?.smoothing ?? 1 };
      const shape = inf?.shape ?? 1;
      let onset = 0;
      for (const f of tick.frames) {
        this.values = this.maps.apply(f, hop, opts);
        if (f.onset.on) onset = Math.max(onset, (0.4 + 0.6 * f.onset.confidence) * shape);
      }
      const dt = Math.min(0.1, tick.dt || 1 / 60);
      this.breath = breathStep(this.breath, onset, dt);
      if (onset > 0) this.flash = Math.max(this.flash, this.env.flash.request(tick.nowSec, 0.3 + 0.4 * Math.min(1, onset)));
      this.flash *= Math.exp(-dt / 0.15);
      this.pendingDt = dt;
    },

    /** Advance the simulation by `steps` fixed steps on the GPU. */
    simulate(steps) {
      const r = this.renderer, v = this.values, uA = this.velMat.uniforms.uMagA.value, uB = this.velMat.uniforms.uMagB.value;
      for (let s = 0; s < steps; s++) {
        // magnets move along their paths a little faster when the mids are busy
        this.phaseTime += SWARM.step * (0.7 + 0.6 * (v.mid ?? 0));
        this.simTime += SWARM.step * 1.3;
        magnetState(this.phaseTime, v, this.mags);
        for (let k = 0; k < 5; k++) { const o = 8 * k; uA[k].set(this.mags[o], this.mags[o + 1], this.mags[o + 2], this.mags[o + 3]); uB[k].set(this.mags[o + 4], this.mags[o + 5], this.mags[o + 6], this.mags[o + 7]); }
        const i = this.flip;
        this.velMat.uniforms.uPos.value = this.posSrc; this.velMat.uniforms.uVel.value = this.velSrc;
        this.velMat.uniforms.uTurb.value = 0.12 + (v.high ?? 0);        // a little shimmer always, more with treble
        this.velMat.uniforms.uTime.value = this.simTime;
        this.quad.material = this.velMat; r.setRenderTarget(this.rtVel[i]); r.render(this.simScene, this.simCam);
        this.posMat.uniforms.uPos.value = this.posSrc; this.posMat.uniforms.uVel.value = this.rtVel[i].texture;
        this.quad.material = this.posMat; r.setRenderTarget(this.rtPos[i]); r.render(this.simScene, this.simCam);
        this.posSrc = this.rtPos[i].texture; this.velSrc = this.rtVel[i].texture; this.flip ^= 1;
      }
      r.setRenderTarget(null);
    },

    render() {
      const r = this.renderer;
      if (!r) return;
      const dt = this.pendingDt, inf = this.env.influence, motion = inf ? Math.max(0.05, inf.motion) : 1, colour = inf?.colour ?? 1, v = this.values;
      // fixed simulation steps, scaled by Movement; capped so a stall cannot cause a burst of work
      this.simDebt = Math.min(this.simDebt + dt * motion, SWARM.step * SWARM.maxSteps);
      const steps = Math.floor(this.simDebt / SWARM.step);
      this.simDebt -= steps * SWARM.step;
      this.simulate(steps);
      // camera orbits slowly; a touch faster with the mids
      this.orbit += dt * motion * (0.07 + 0.18 * (v.mid ?? 0));
      this.camera.position.set(6.5 * Math.sin(this.orbit), 1.4 + 0.6 * Math.sin(this.orbit * 0.37), 6.5 * Math.cos(this.orbit));
      this.camera.lookAt(0, 0, 0);
      this.hueDrift = (this.hueDrift + dt * motion * 0.01) % 1;
      const glow = 0.7 + 0.6 * (v.glow ?? 0) + 0.5 * this.flash;
      const pu = this.pointMat.uniforms;
      pu.uPos.value = this.posSrc; pu.uVel.value = this.velSrc;
      pu.uBreath.value = SWARM.breathGain * this.breath; pu.uHue.value = (0.55 + 0.35 * (v.hue ?? 0) + this.hueDrift) % 1; pu.uGlow.value = glow;
      const pos = this.orbs.geometry.attributes.position, st = this.orbs.geometry.attributes.strength;
      for (let k = 0; k < 5; k++) { pos.setXYZ(k, this.mags[8 * k], this.mags[8 * k + 1], this.mags[8 * k + 2]); st.setX(k, Math.min(2, this.mags[8 * k + 3] / MAGNETS[k].gain)); }
      pos.needsUpdate = true; st.needsUpdate = true;
      this.orbMat.uniforms.uBreath.value = pu.uBreath.value; this.orbMat.uniforms.uGlow.value = glow;
      this.trails.damp = Math.exp(-dt / 0.07);                        // trail fade by elapsed time, not per frame
      this.bloom.strength = Math.min(1.0, (0.32 + 0.28 * (v.glow ?? 0) + 0.3 * this.flash) * (0.4 + 0.6 * Math.min(colour, 1.6)));
      this.grade.uniforms.uColour.value = colour;
      this.composer.render(dt);
    },

    resize(w, h, dpr) {
      const r = this.renderer;
      if (!r) return;
      r.setPixelRatio(dpr); r.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
      // point size in world units → pixels: px = size · (pixel height / (2·tan(fov/2))) / depth
      const px = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      this.pointMat.uniforms.uPixel.value = px; this.orbMat.uniforms.uPixel.value = px;
    },

    diagnostics() {
      return [['Particles', `${this.count.toLocaleString()} (${this.float ? 'float' : 'half-float'} simulation)`], ['Breath', (this.breath ?? 0).toFixed(2)]];
    },

    dispose() {
      for (const t of [...(this.rtPos ?? []), ...(this.rtVel ?? [])]) t.dispose();
      this.initPos?.dispose(); this.initVel?.dispose();
      this.velMat?.dispose(); this.posMat?.dispose(); this.quad?.geometry.dispose();
      this.points?.geometry.dispose(); this.pointMat?.dispose(); this.orbs?.geometry.dispose(); this.orbMat?.dispose();
      this.bloom?.dispose(); this.trails?.dispose(); this.composer?.dispose();
      this.renderer?.dispose(); this.renderer?.forceContextLoss();
      this.renderer = null;
    },
  };
}

// merge into the Experimental collection (Morph registers there too)
const reg = (self.Visualizations ||= { collections: [] });
let coll = reg.collections.find((c) => c.id === 'experimental');
if (!coll) { coll = { id: 'experimental', name: 'Experimental', available: true, presets: [] }; reg.collections.push(coll); }
coll.presets = [...coll.presets.filter((p) => p.id !== 'swarm'), { id: 'swarm', name: 'Particle Swarm', create: createSwarm }];
coll.available = true; coll.name = 'Experimental';   // replaces Bars & Waves' 'failed to load' placeholder
