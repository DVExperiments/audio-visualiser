// Wave-and-warp presets for the Battery-inspired collection (v0.5): the looks from your
// reference images, each built from waveform + warp feedback + per-channel decay + symmetry.
// All numbers come from computeWarp() in engine/warp-model.mjs, which also builds the
// "How it works" panel, so the explanation and the picture cannot disagree.
import { createFeedbackPreset, makeStrip, COMMON_MAPPINGS } from '../../engine/feedback.mjs';
import { writeStrip, stripIndex, scopeCircle, scopeLine, ScopeGain } from '../../engine/geometry2d.mjs';
import { WARP_PRESETS, computeWarp, symmetryMatrices, explainWarp } from '../../engine/warp-model.mjs';

const N_WAVE = 512, WAVE_N = 1024;

// fold into the symmetry's fundamental domain (twin of foldPoint() in warp-model.mjs)
const FOLD_GLSL = /* glsl */`
  uniform float uSym, uFold, uSymRot;
  vec2 foldP(vec2 p) {
    p = rot(uSymRot) * p;
    if (uSym > 0.5 && uSym < 1.5) p.x = abs(p.x);
    else if (uSym > 1.5 && uSym < 2.5) p.y = abs(p.y);
    else if (uSym > 2.5 && uSym < 3.5) p = abs(p);
    else if (uSym > 3.5) {
      float seg = 3.14159265 / uFold, a = mod(atan(p.y, p.x), 2.0 * seg);
      a = abs(a - seg);
      p = length(p) * vec2(cos(a), sin(a));
    }
    return rot(-uSymRot) * p;
  }`;

const WARP_FS = FOLD_GLSL + /* glsl */`
  uniform float uZoom, uZoomExp, uRot, uSx, uSy, uDx, uDy, uSwirl, uNoise, uNoiseScale, uNoiseSpeed, uFloor, uSparkle;
  uniform vec3 uHalf3, uSparkleColor;
  void main() {
    vec2 p = foldP(toP(vUv));
    float r = length(p);
    vec2 q = rot(-uRot * uDt) * p;
    q *= vec2(exp(-uSx * uDt), exp(-uSy * uDt));
    q *= exp(-uZoom * pow(max(r, 1e-3), uZoomExp) * uDt);
    q -= vec2(uDx, uDy) * uDt;
    q = rot(uSwirl * uDt * (1.0 - smoothstep(0.0, 1.5, r))) * q;
    vec2 n = vec2(noise(uNoiseScale * q + uTime * uNoiseSpeed), noise(uNoiseScale * q + vec2(5.2, 1.3) - uTime * uNoiseSpeed)) - 0.5;
    q += uNoise * uDt * n;
    vec3 c = prevAt(q);
    // per-channel exact fade to true black (each channel its own half-life)
    vec3 k = 0.69314718 / uHalf3, qk = uFloor / k;
    c = max((c + qk) * exp(-k * uDt) - qk, 0.0);
    // sparkles: each 3-pixel cell lights with probability ρ·Δt per frame
    vec2 cell = floor(vUv / (uTexel * 3.0));
    float frame = floor(uTime * 120.0);   // integer salt per frame (the hash is integer-exact)
    c += uSparkleColor * step(1.0 - uSparkle * uDt * 0.002, hash(cell + vec2(mod(frame, 1021.0) * 37.0, mod(frame, 977.0) * 53.0)));
    gl_FragColor = vec4(c, 1.0);
  }`;

const PRESENT_FS = FOLD_GLSL + /* glsl */`
  uniform sampler2D uTex; uniform float uExposure, uMaskOn, uMaskR, uMaskSoft;
  uniform vec2 uMaskStretch; uniform vec3 uMaskColor;
  void main() {
    vec2 p = toP(vUv);
    vec3 c = texture2D(uTex, mirrorUv(toUv(foldP(p)))).rgb;   // folds reach past the frame: mirror, never clamp or blacken
    float m = mix(1.0, smoothstep(uMaskR, uMaskR + uMaskSoft, length(p * uMaskStretch)), uMaskOn);
    c = grade(m * c + (1.0 - m) * uMaskColor);
    c = 1.0 - exp(-c * uExposure);
    gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
  }`;

function createWarpPreset(def) {
  const first = computeWarp(def, {});
  const matrices = symmetryMatrices(def.warp.sym ?? 'none', def.warp.fold ?? 4, def.warp.symRot ?? 0);
  let live = { ...first, gain: 1, dt: 1 / 60 };
  const renderer = createFeedbackPreset({
    seed: 900, mappings: COMMON_MAPPINGS, exposure: first.exposure, deposit: first.deposit, head: first.head,
    uniforms: {
      uZoom: 0, uZoomExp: 0, uRot: 0, uSx: 0, uSy: 0, uDx: 0, uDy: 0, uSwirl: 0, uNoise: 0, uNoiseScale: 3, uNoiseSpeed: 0.3,
      uFloor: 0.05, uSparkle: 0, uHalf3: [0.5, 0.5, 0.5], uSparkleColor: first.sparkleColor,
      uSym: first.sym, uFold: first.fold, uSymRot: 0,
      uMaskOn: first.mask ? 1 : 0, uMaskR: first.mask?.r ?? 0, uMaskSoft: first.mask?.soft ?? 0.1,
      uMaskStretch: first.mask?.stretch ?? [1, 1], uMaskColor: first.mask?.color ?? [0, 0, 0],
    },
    feedbackFS: WARP_FS,
    presentFS: PRESENT_FS,
    setup(ctx) {
      const st = ctx.state;
      ctx.setScheme(def.scheme);
      st.gain = new ScopeGain(0.12, 8);
      st.wl = new Float32Array(WAVE_N); st.wr = new Float32Array(WAVE_N); st.wm = new Float32Array(WAVE_N);
      st.pts = new Float32Array(N_WAVE * 2); st.tmp = new Float32Array(N_WAVE * 2);
      // one strip per wave per symmetry copy, so the crisp head is as symmetric as the folded buffer
      st.strips = def.waves.map((w) => matrices.map(() => {
        const s = makeStrip(N_WAVE, w.mode === 'circle', { uHue: { value: 0.5 }, uBright: { value: 1 }, uSpread: { value: 0.0 } }, stripIndex);
        ctx.scene.add(s.mesh); return s;
      }));
    },
    frame(ctx, v, tick) {
      const st = ctx.state, U = ctx.uniforms;
      live = computeWarp(def, v);
      if (ctx.store) ctx.store.recentWave(WAVE_N, st.wl, st.wr);
      for (let i = 0; i < WAVE_N; i++) st.wm[i] = 0.5 * (st.wl[i] + st.wr[i]);
      live.gain = st.gain.update(st.wm, tick.dt);
      live.dt = tick.dt;
      for (const [u, k] of [['uZoom', 'zoom'], ['uZoomExp', 'zoomExp'], ['uRot', 'rot'], ['uSx', 'sx'], ['uSy', 'sy'], ['uDx', 'dx'], ['uDy', 'dy'], ['uSwirl', 'swirl'], ['uNoise', 'noise'], ['uNoiseScale', 'noiseScale'], ['uNoiseSpeed', 'noiseSpeed'], ['uFloor', 'floor'], ['uSparkle', 'sparkle'], ['uSymRot', 'symRot']]) U[u].value = live[k];
      U.uHalf3.value = live.half;
      const ax = Math.min(ctx.aspect, 1.9);
      live.waves.forEach((w, wi) => {
        const g = live.gain * w.amp;
        if (w.mode === 'circle') scopeCircle(st.pts, N_WAVE, st.wm, { r0: w.at, gain: g * 0.6 });
        else if (w.mode === 'hline') scopeLine(st.pts, N_WAVE, st.wm, { halfSpan: ax, y0: w.at, gain: g });
        else if (w.mode === 'vline') { scopeLine(st.tmp, N_WAVE, st.wm, { halfSpan: 1, y0: w.at, gain: g }); for (let i = 0; i < N_WAVE; i++) { st.pts[2 * i] = st.tmp[2 * i + 1]; st.pts[2 * i + 1] = st.tmp[2 * i]; } }
        else if (w.mode === 'xy') for (let i = 0; i < N_WAVE; i++) {
          // phase portrait: sample against the one 37 later — loops even for mono music,
          // where left-vs-right collapses to a dot (seen in testing)
          st.pts[2 * i] = 2.5 * g * st.wm[i]; st.pts[2 * i + 1] = 2.5 * g * st.wm[i + 37];
        }
        matrices.forEach((M, mi) => {
          for (let i = 0; i < N_WAVE; i++) {
            const x = st.pts[2 * i], y = st.pts[2 * i + 1];
            st.tmp[2 * i] = M[0] * x + M[1] * y; st.tmp[2 * i + 1] = M[2] * x + M[3] * y;
          }
          const s = st.strips[wi][mi];
          writeStrip(st.tmp, N_WAVE, w.width, w.mode === 'circle', s.out);
          s.commit();
          s.mesh.material.uniforms.uBright.value = w.bright;
          s.mesh.material.uniforms.uHue.value = 0.5;          // the white-hot end of the scheme
        });
      });
    },
    diagnostics: () => [['Zoom / rotation', `${live.zoom.toFixed(2)} / ${live.rot.toFixed(2)}`], ['Half-lives r, g, b', live.half.map((h) => h.toFixed(2)).join(', ') + ' s'], ['Symmetry', live.symName]],
  });
  renderer.explain = () => explainWarp(def, () => live);
  return renderer;
}

const reg = (self.Visualizations ||= { collections: [] });
const battery = reg.collections.find((c) => c.id === 'battery' && c.available);
const presets = WARP_PRESETS.map((d) => ({ id: d.id, name: d.name, create: () => createWarpPreset(d) }));
if (battery) battery.presets.push(...presets);
else reg.collections.push({ id: 'battery', name: 'Battery-inspired', available: true, presets });
