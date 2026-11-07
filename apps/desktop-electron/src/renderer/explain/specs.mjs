// "How it works" specifications for the hand-built presets (the wave-and-warp presets generate
// theirs from their parameters, see engine/warp-model.mjs). Pure data + TeX, tested in node:
// every formula must typeset, and every live value must evaluate.
//
// Each builder receives L(), which returns { frame, drives, r } — the latest analysis frame, the
// renderer's mapped drives and the renderer itself — and returns { title, summary, steps[] }.

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '–');
const U = (L, name) => L().r?.ctx?.uniforms?.[name]?.value;
const drive = (L, k) => () => f2(L().drives?.[k]);

const FADE_STEP = (L, halfName = 'uHalf', floorName = 'uFloor') => ({
  title: 'Fade to true black',
  why: 'Trails darken with half-life h and are drained at rate f, so they reach exactly zero instead of leaving a haze. This is the exact solution over each frame, so it looks the same at any refresh rate.',
  tex: ['c \\leftarrow \\max\\!\\bigl((c + q)\\,e^{-\\lambda\\Delta t} - q,\\ 0\\bigr),\\quad \\lambda = \\frac{\\ln 2}{h},\\quad q = \\frac{f}{\\lambda}'],
  vars: [['h', 'trail half-life (s)', () => f2(U(L, halfName))], ['f', 'drain to black (1/s)', () => f2(U(L, floorName))]],
});

const SPECTRUM_STEPS = (L) => [
  { title: 'Window and transform', why: 'The last 2048 samples are multiplied by a Hann window (to stop the cut edges smearing energy across the spectrum), then Fourier-transformed. Bands below 250 Hz use a 4096-sample transform for finer bass resolution.',
    tex: ['w[n] = \\tfrac12\\bigl(1 - \\cos(2\\pi n/N)\\bigr),\\qquad X[k] = \\sum_{n=0}^{N-1} x[n]\\,w[n]\\,e^{-j2\\pi kn/N},\\qquad f_k = k\\,\\frac{f_s}{N}'],
    vars: [['f_s', 'sample rate (Hz)', () => f2(L().frame?.sr)], ['f_s/N', 'bin width (Hz)', () => f2((L().frame?.sr ?? 48000) / 2048)]] },
  { title: 'Calibrated power', why: 'Scaled so that summing the bins gives the signal\'s mean-square power for any FFT size; a full-scale sine sums to ½.',
    tex: ['P[k] = c_k\\,\\frac{|X[k]|^2}{N\\sum_n w[n]^2},\\qquad c_k = \\begin{cases}2 & 0 < k < N/2\\\\ 1 & \\text{otherwise}\\end{cases}'], vars: [] },
  { title: 'Bands in decibels', why: 'Each bar is the summed power of one of 48 log-spaced bands from 20 Hz to 20 kHz, in dB relative to full scale.',
    tex: ['B_b = 10\\log_{10}\\!\\sum_{k \\in b} P[k],\\qquad e_i = 20\\cdot 1000^{\\,i/48}\\ \\text{Hz}'],
    vars: [['B_{\\text{bass}}', 'bass band (dB)', () => f2(L().frame?.bands?.[1])], ['\\text{centroid}', 'spectral centroid (Hz)', () => f2(L().frame?.centroid)]] },
];

export const EXPLAIN = {
  // ---------------- Bars & Waves (measurement displays)
  instruments: (L) => ({ title: 'Instruments', summary: 'Measurement displays: every pixel is a measured value.', steps: [...SPECTRUM_STEPS(L),
    { title: 'Level meters', why: 'Root-mean-square level of each channel over the analysis window, in dB relative to full scale (a full-scale sine reads −3 dBFS).',
      tex: ['\\mathrm{RMS} = \\sqrt{\\tfrac1N\\sum_n x[n]^2},\\qquad \\mathrm{dBFS} = 20\\log_{10}\\mathrm{RMS}'], vars: [['L, R', 'level (dBFS)', () => `${f2(L().frame?.dbfs?.[0])}, ${f2(L().frame?.dbfs?.[1])}`]] }] }),
  spectrum: (L) => ({ title: 'Spectrum glow', summary: 'The calibrated spectrum, drawn as glowing bars with a reflection.', steps: SPECTRUM_STEPS(L) }),
  scope: (L) => ({ title: 'Oscilloscope', summary: 'The raw waveform, left channel above and right below.', steps: [
    { title: 'Trigger', why: 'To make periodic sounds stand still, the trace starts at the latest rising zero crossing, as a hardware oscilloscope does. Old traces fade (phosphor persistence).',
      tex: ['n^* = \\max\\{\\,n : x[n-1] < 0 \\le x[n]\\,\\},\\qquad \\text{trace} = x[n^*],\\dots,x[n^* + 1023]'], vars: [['\\text{span}', 'time shown (ms)', () => f2(1024 / (L().frame?.sr ?? 48000) * 1000)]] }] }),
  stereo: (L) => ({ title: 'Stereo field', summary: 'A goniometer: mono content is vertical, wide content spreads sideways, opposite-phase content is horizontal.', steps: [
    { title: 'Mid/side axes', why: 'Each sample pair is plotted with mid (L+R) upward and side (R−L) across.',
      tex: ['x = \\frac{R - L}{\\sqrt2},\\qquad y = \\frac{L + R}{\\sqrt2}'], vars: [] },
    { title: 'Correlation, balance, width', why: '+1 = mono, 0 = unrelated, −1 = opposite phase.',
      tex: ['\\rho = \\frac{\\sum LR}{\\sqrt{\\sum L^2\\sum R^2}},\\quad \\beta = \\frac{\\sum R^2 - \\sum L^2}{\\sum R^2 + \\sum L^2},\\quad W = \\frac{\\sum S^2}{\\sum M^2 + \\sum S^2}'],
      vars: [['\\rho', 'correlation', () => f2(L().frame?.correlation)], ['\\beta', 'balance', () => f2(L().frame?.balance)], ['W', 'width', () => f2(L().frame?.width)]] }] }),

  // ---------------- Experimental
  morph: (L) => {
    const m = () => L().r?.model;
    return { title: 'Morph', summary: 'A sphere physically pushed around by the sound: each point moves along its own direction by D.', steps: [
      { title: 'Surface', why: 'Bass stretches the sphere into a rotating egg and squashes it (smooth spherical harmonics, no cusp at the poles); mids send travelling waves across it; treble adds fine ripples; balance makes it lean; kicks make it swell.',
        tex: ['\\mathbf p\' = \\mathbf p\\,(R + D)',
          'D = A_b x_b\\bigl[0.55\\,\\mathrm{Im}\\bigl((x+iz)^2 e^{i\\psi_b}\\bigr) + 0.45\\,P_2(y)\\cos\\psi_z\\bigr] + \\frac{A_m x_m}{\\sqrt{N_m}}\\sum_j \\sin(k_m\\,\\mathbf d_j\\!\\cdot\\!\\mathbf p + \\psi_j) + \\dots',
          '\\dots + \\frac{A_h x_h}{\\sqrt{N_h}}\\sum_j \\sin(k_h\\,\\mathbf d_j\\!\\cdot\\!\\mathbf p + \\psi_j) + A_s x_s\\,x + A_{br}\\sin(2\\pi\\,0.12\\,t) + A_{sw}\\max(0, x_b)'],
        vars: [['x_b, x_m, x_h', 'spring positions (bass, mid, high)', () => ['bass', 'mid', 'high'].map((k) => f2(m()?.springs?.[k]?.x)).join(', ')], ['\\mathrm{rms}(D)', 'average displacement', () => f3(m()?.stats?.rms)]] },
      { title: 'Springs', why: 'Each amplitude is a mass–spring–damper pulled toward its audio target and kicked by onsets, so motion overshoots and settles like something physical. Each step uses the exact closed-form solution (the target is constant within a step), so there is no numerical error and the result does not depend on the step size; the simulation advances one analysis hop per audio frame.',
        tex: ['\\ddot x + 2\\zeta\\omega_0\\,\\dot x + \\omega_0^2\\,(x - \\text{target}) = 0,\\qquad \\omega_0 = 2\\pi f_0'],
        vars: [['\\text{target}_b', 'bass drive', drive(L, 'bass')], ['\\text{kick}', 'onset impulse', drive(L, 'kick')]] },
      { title: 'Never self-intersects', why: 'Every term is bounded and the springs are clamped, so the radius stays positive; a surface given by a positive radius in every direction cannot fold through itself.',
        tex: ['|D| \\le 0.848\\,R \\;\\Rightarrow\\; r = R + D \\ge 0.15\\,R > 0'], vars: [['\\max|D|', 'largest displacement now', () => f3(m()?.stats?.maxAbs)]] }] };
  },

  // ---------------- Alchemy
  'liquid-ribbons': (L) => ({ title: 'Liquid Ribbons', summary: 'Thin luminous figures that wander through shape families, leaving trails that flow outward and fade to black.', steps: [
    { title: 'The figures', why: 'Smooth closed curves. Every 12–22 s, on a strong beat, the preset crossfades to another family and colour scheme.',
      tex: ['\\text{Lissajous: } (\\sin(a\\theta + \\phi),\\ \\sin b\\theta)/\\sqrt2 \\qquad \\text{rose: } r = \\cos k\\theta',
        '\\text{hypotrochoid: } \\bigl((R-r)\\cos t + d\\cos\\tfrac{R-r}{r}t,\\ (R-r)\\sin t - d\\sin\\tfrac{R-r}{r}t\\bigr)'], vars: [] },
    { title: 'Breathing with the music', why: 'Only the first three Fourier terms along the curve are modulated, so it swells smoothly and can never go jagged.',
      tex: ['\\rho\' = \\rho\\,R_0\\Bigl(1 + \\sum_{k=1}^{3} g_k\\cos(2\\pi k s + \\psi_k)\\Bigr),\\qquad (g_1, g_2, g_3) = (0.10\\,\\text{bass},\\ 0.07\\,\\text{mid},\\ 0.05\\,\\text{high})'],
      vars: [['\\text{bass}', 'bass drive', drive(L, 'bass')], ['\\text{mid}', 'mid drive', drive(L, 'mid')]] },
    { title: 'Flowing trails', why: 'The previous frame is zoomed outward (faster on kicks), turned with the stereo balance and gently swirled.',
      tex: ['\\mathbf q = R(-\\omega\\Delta t)\\,\\mathbf p\\,e^{-z\\Delta t} + \\sigma\\Delta t\\,\\bigl(\\sin(2.7q_y + 0.6t),\\ \\cos(2.3q_x - 0.5t)\\bigr)'],
      vars: [['z', 'zoom (1/s)', () => f2(U(L, 'uZoom'))], ['\\omega', 'rotation (rad/s)', () => f2(U(L, 'uRot'))], ['\\sigma', 'swirl', () => f2(U(L, 'uSwirl'))]] },
    FADE_STEP(L)] }),
  'spiral-elixir': (L) => ({ title: 'Spiral Elixir', summary: 'Logarithmic spiral arms whose trails are wound into a vortex.', steps: [
    { title: 'Spiral arms', why: 'Each arm is a logarithmic spiral (constant angle to the radius, like a nautilus shell); its width follows the 7 band pulses from core (bass) to tip (treble).',
      tex: ['r(\\theta) = r_0\\,e^{g\\theta},\\qquad g = \\frac{\\ln(r_{\\max}/r_0)}{2\\pi\\,\\text{turns}}'], vars: [['\\text{mid}', 'spin speed driver', drive(L, 'mid')]] },
    { title: 'Nebula underneath', why: 'A slowly turning cloud of fractal noise in the current colour scheme is injected every second, so there is no blank space between the arms.',
      tex: ['\\mathbf c \\mathrel{+}= \\beta\\,\\Delta t\\,\\mathrm{grad}(0.05 + 0.35n)\\,(0.1 + 2.2n^2),\\qquad n = \\mathrm{fbm}\\bigl(1.6\\,R(0.05t)\\,\\mathbf q + \\dots\\bigr)'], vars: [['\\beta', 'nebula fill rate', () => f2(U(L, 'uBase'))]] },
    { title: 'Vortex', why: 'Rotation falls off with radius, so the inner image turns faster; an inward pull winds the trails into the centre.',
      tex: ['\\mathbf q = R\\!\\left(\\frac{\\tau\\,\\Delta t}{0.25 + r}\\right)\\mathbf p\\,e^{\\kappa\\Delta t}'], vars: [['\\tau', 'twist', () => f2(U(L, 'uTwist'))], ['\\kappa', 'pull (1/s)', () => f2(U(L, 'uPull'))]] },
    FADE_STEP(L)] }),

  // ---------------- Battery (classic)
  'polygon-pulse': (L) => ({ title: 'Polygon Pulse', summary: 'Concentric polygons pulsing band by band inside a kaleidoscope, with the waveform as a ring.', steps: [
    { title: 'Rings', why: 'Ring j belongs to band j (sub-bass innermost); its radius jumps with that band\'s pulse. On strong onsets the shape switches (at most once per second, always to a different shape).',
      tex: ['r_j = (0.12 + 0.125\\,j)\\,(1 + 0.32\\,\\text{pulse}_j) \\le 0.98'], vars: [['\\text{kick}', 'onset strength', drive(L, 'kick')]] },
    { title: 'Kaleidoscope', why: 'The previous frame is folded into one mirrored wedge and pushed outward, so every pulse echoes symmetrically.',
      tex: ['\\phi \\mapsto \\bigl|(\\phi \\bmod 2\\alpha) - \\alpha\\bigr|,\\ \\alpha = \\frac{\\pi}{\\text{sides}},\\qquad \\mathbf q = \\mathbf p\\,e^{-z\\Delta t}'],
      vars: [['\\text{sides}', 'current shape', () => f2(U(L, 'uFold'))], ['z', 'outward zoom (1/s)', () => f2(U(L, 'uZoom'))]] },
    FADE_STEP(L)] }),
  'star-tunnel': (L) => ({ title: 'Star Tunnel', summary: 'Each frame draws the waveform as a ring; a strong outward zoom turns the stack of rings into tunnel walls.', steps: [
    { title: 'Tunnel', why: 'Zooming outward every frame means older rings are larger: you see the recent history of the waveform as receding walls. Kicks rush it forward.',
      tex: ['\\mathbf q = R(-\\omega\\Delta t)\\,\\mathbf p\\,e^{-z\\Delta t},\\qquad z = 0.6 + 2.2\\,\\text{bass}'], vars: [['z', 'zoom (1/s)', () => f2(U(L, 'uZoom'))]] },
    { title: 'Star', why: 'Alternating outer and inner radii; bass swells it, treble sharpens it.',
      tex: ['r_{\\text{out}} = 0.5(1 + 0.45\\,\\text{bass}),\\qquad r_{\\text{in}} = r_{\\text{out}}(0.42 - 0.18\\,\\text{high})'], vars: [['\\text{bass}', 'bass drive', drive(L, 'bass')]] },
    FADE_STEP(L)] }),

  // ---------------- Ambience
  water: (L) => ({ title: 'Water', summary: 'A ripple tank: the wave equation solved on the GPU 240 times a second; sounds drop stones into it.', steps: [
    { title: 'Wave equation', why: 'Height h obeys the discrete 2D wave equation. The 9-point Laplacian is isotropic, so ripples spread equally fast in every direction and stay round (the simpler 5-point form is about 10 % faster along the axes). With λ = 0.5 it is well inside its stability limit √(3/4) ≈ 0.87; damping γ slowly calms it.',
      tex: ['h^{+} = \\bigl(2h - h^{-} + \\lambda^2\\,\\nabla^2 h\\bigr)(1 - \\gamma\\Delta t),\\qquad \\nabla^2 h = \\frac{4(h_E + h_W + h_N + h_S) + (h_{NE} + h_{NW} + h_{SE} + h_{SW}) - 20h}{6}', '\\lambda = \\frac{c\\,\\Delta t}{\\Delta x} = 0.5 \\le \\sqrt{3/4}'],
      vars: [['\\text{steps}', 'simulation steps per second', () => '240']] },
    { title: 'Drops', why: 'Kicks drop big stones, bass hits medium ones, treble makes light rain. Drops are added as displacements (to h and h⁻ alike), which keeps the mean water level fixed.',
      tex: ['h \\mathrel{+}= s\\,e^{-\\lVert\\mathbf p - \\mathbf p_0\\rVert^2/\\rho^2},\\qquad h^{-} \\mathrel{+}= s\\,e^{-\\lVert\\mathbf p - \\mathbf p_0\\rVert^2/\\rho^2}'],
      vars: [['\\text{kick}', 'onset strength', drive(L, 'kick')], ['\\text{high}', 'rain rate driver', drive(L, 'high')]] },
    { title: 'Shading', why: 'The surface normal comes from the height slope; it bends the view of the dark floor (refraction) and catches a highlight (specular).',
      tex: ['\\mathbf n = \\operatorname{normalize}\\bigl(-18\\,\\partial_x h,\\ -18\\,\\partial_y h,\\ 1\\bigr),\\qquad \\text{spec} = \\max(0,\\ \\mathbf r\\cdot\\hat{\\mathbf z})^{60}'], vars: [] }] }),
  swirl: (L) => ({ title: 'Swirl', summary: 'Soft left- and right-channel waveform rings smoked through a vortex.', steps: [
    { title: 'Vortex and blur', why: 'Rotation strongest at the centre, slow outward drift, and a small blur. The blur radius grows with √Δt, which keeps the spread per second (diffusion) the same at any frame rate.',
      tex: ['\\mathbf q = R\\bigl(\\tau\\Delta t\\,(1 - \\mathrm{smoothstep}(0, 1.4, r))\\bigr)\\,\\mathbf p\\,e^{-z\\Delta t}', 'c = \\tfrac12 c(\\mathbf q) + \\tfrac18\\sum_{\\pm} \\bigl[c(\\mathbf q \\pm \\epsilon\\hat x) + c(\\mathbf q \\pm \\epsilon\\hat y)\\bigr],\\quad \\epsilon = B\\sqrt{\\Delta t}\\ \\Rightarrow\\ \\sigma^2 = \\tfrac14 B^2\\ \\text{per second}'],
      vars: [['\\tau', 'twist', () => f2(U(L, 'uTwist'))], ['B', 'blur', () => f2(U(L, 'uBlur'))]] },
    FADE_STEP(L)] }),
  nebula: (L) => ({ title: 'Nebula', summary: 'Colour carried around by an imaginary fluid.', steps: [
    { title: 'Curl-noise flow', why: 'The velocity is the curl of a noise field, which has zero divergence: like an incompressible fluid, it swirls without bunching up or thinning out. Each pixel looks back along the flow (semi-Lagrangian advection).',
      tex: ['\\mathbf v = \\Bigl(\\frac{\\partial\\psi}{\\partial y},\\ -\\frac{\\partial\\psi}{\\partial x}\\Bigr),\\quad \\nabla\\!\\cdot\\mathbf v = 0,\\qquad c^{+}(\\mathbf p) = c(\\mathbf p - \\mathbf v\\,\\Delta t)'], vars: [['\\text{flow}', 'speed', () => f2(U(L, 'uFlow'))]] },
    { title: 'Light sources', why: 'Three soft sources orbit and inject light in proportion to the bass, mid and treble drives (per second, so frame-rate independent).',
      tex: ['c \\mathrel{+}= \\Delta t\\sum_i a_i\\,e^{-\\lVert\\mathbf p - \\mathbf b_i\\rVert^2/s^2}'], vars: [['\\text{bass}', 'bass source', drive(L, 'bass')]] },
    FADE_STEP(L)] }),
  aurora: (L) => ({ title: 'Aurora', summary: 'Curtains of light from warped fractal noise, low-passed in time.', steps: [
    { title: 'Curtains', why: 'Fractal noise (five octaves) is warped by more noise, stretched vertically and shaped into a band; mids increase the turbulence.',
      tex: ['\\mathrm{fbm}(\\mathbf p) = \\sum_{i=0}^{4} 2^{-(i+1)}\\,n(2.03^i\\,\\mathbf p),\\qquad \\mathbf w = \\mathbf p + W\\bigl(\\mathrm{fbm}(\\mathbf p + \\dots),\\ \\mathrm{fbm}(\\mathbf p - \\dots)\\bigr)'], vars: [['W', 'warp', () => f2(U(L, 'uWarp'))]] },
    { title: 'Softness', why: 'Each frame blends toward the new field with the exact exponential, so motion is smooth at any refresh rate.',
      tex: ['c \\leftarrow \\mathrm{mix}\\bigl(c_{\\text{new}},\\ c_{\\text{old}},\\ 2^{-\\Delta t/h}\\bigr)'], vars: [['h', 'smoothing half-life (s)', () => f2(U(L, 'uHalf'))]] }] }),
};

if (typeof self !== 'undefined') self.Explain = EXPLAIN;

// ---------------- Alchemy: psychedelic (v0.6)
const HUE_STEP = {
  title: 'Colour drift and kicks',
  why: 'The palette position drifts slowly and jumps a little on kicks. Jumps pass through the flash limiter (at most three per second when limiting is on) and glide over 80 ms, so the whole-screen colour change never strobes.',
  tex: ['h_{\\text{target}} \\mathrel{+}= \\rho\\,\\Delta t + J\\,[\\text{kick allowed}],\\qquad h \\leftarrow h + \\bigl(1 - e^{-\\Delta t/0.08}\\bigr)(h_{\\text{target}} - h)'],
  vars: [],
};
Object.assign(EXPLAIN, {
  'acid-warp': (L) => ({ title: 'Acid Warp', summary: 'Fractal noise sampled at positions bent by more fractal noise, twice over: domain warping. It folds into marbled, liquid colour that fills the screen.', steps: [
    { title: 'Fractal noise', why: 'Smooth value noise added over five octaves, each twice as fine and half as strong.',
      tex: ['\\mathrm{fbm}(\\mathbf p) = \\sum_{i=0}^{4} 2^{-(i+1)}\\, n\\bigl(2.03^{\\,i} R^i\\,\\mathbf p\\bigr)'], vars: [] },
    { title: 'Domain warping', why: 'Two layers of noise bend the coordinates before the final noise is read. The music sets how hard the last bend pulls (W) and how fast it flows (t), but deliberately gently: W and the scale S glide with a 0.6 s time constant and the flow is slow, because large whole-field motion that lurches on every beat can cause motion sickness.',
      tex: ['\\mathbf q = \\bigl(\\mathrm{fbm}(S\\mathbf p + \\dots),\\ \\mathrm{fbm}(S\\mathbf p + \\dots)\\bigr),\\qquad \\mathbf r = \\bigl(\\mathrm{fbm}(S\\mathbf p + 4\\mathbf q + \\dots),\\ \\dots\\bigr)', 'f = \\mathrm{fbm}(S\\mathbf p + W\\,\\mathbf r)'],
      vars: [['W', 'warp strength, gliding toward 2.8 + 1.2·body + 0.8·bass', () => f2(U(L, 'uWarp'))], ['S', 'scale, gliding toward 1.8 + 0.3·body', () => f2(U(L, 'uScale'))], ['t', 'flow phase (advances 0.08 + 0.3·mid per second)', () => f2(U(L, 'uPhase'))]] },
    { title: 'Colour', why: 'A cosine rainbow indexed by the warped value, so colour bands follow every fold of the liquid. The cosines are a third of a cycle apart, so at least one channel is always lit.',
      tex: ['\\mathbf c = \\tfrac12 + \\tfrac12\\cos\\!\\bigl(2\\pi(3f + h + \\tfrac12\\lVert\\mathbf q\\rVert + 0.3 r_x + (0, 0.33, 0.67))\\bigr)\\cdot(0.55 + 0.9f)'],
      vars: [['h', 'palette position', () => f2(U(L, 'uHue'))]] },
    HUE_STEP] }),
  'plasma-prism': (L) => ({ title: 'Plasma Prism', summary: 'Four interfering sine waves seen through a kaleidoscope: the classic demo-scene plasma, folded into a prism.', steps: [
    { title: 'Kaleidoscope', why: 'Angles are folded into one mirrored wedge; the number of wedges switches on strong beats (at most once every 2 s).',
      tex: ['\\phi \\mapsto \\bigl|(\\phi \\bmod 2\\alpha) - \\alpha\\bigr|,\\qquad \\alpha = \\frac{\\pi}{N}'], vars: [['N', 'fold count', () => f2(U(L, 'uFold'))]] },
    { title: 'Plasma', why: 'Waves along x, along y, along the diagonal, and outward from the centre add and cancel into moving blobs. The bass raises the wave numbers (tighter pattern on kicks); the mids speed up the phases.',
      tex: ['v = \\sin(k_1 x + \\phi_1) + \\sin(k_2 y + \\phi_2) + \\sin\\!\\Bigl(k_3\\frac{x + y}{\\sqrt2} + \\phi_3\\Bigr) + \\sin(k_4 r + \\phi_4)'],
      vars: [['k_1', 'first wave number = 6·(1 + 0.6·bass)', () => f2(U(L, 'uK')?.[0])], ['k_4', 'radial wave number', () => f2(U(L, 'uK')?.[3])]] },
    { title: 'Never black', why: 'Each channel is a cosine of the same value a third of a cycle apart. Whatever v is, one of the three angles is within 60° of a peak, so the brightest channel is at least ½ + ½cos 60° = 0.75 before the colour is deepened by the power 1.8, and at least 0.75^1.8 ≈ 0.60 after (checked in the tests).',
      tex: ['c_k = \\Bigl(\\tfrac12 + \\tfrac12\\cos\\!\\Bigl(\\pi v + \\frac{2\\pi k}{3} + 2\\pi h\\Bigr)\\Bigr)^{1.8},\\qquad \\max_k c_k \\ge \\bigl(\\tfrac34\\bigr)^{1.8} \\approx 0.60'], vars: [['h', 'palette position', () => f2(U(L, 'uHue'))]] },
    HUE_STEP] }),
  'julia-bloom': (L) => ({ title: 'Julia Bloom', summary: 'A Julia set whose parameter circles as the music plays, so its filaments bloom and collapse.', steps: [
    { title: 'Iteration', why: 'Every pixel is a complex number z₀ and is squared and shifted repeatedly. Points whose orbit flies off (|z| > 16) are outside the set. c travels around a circle of radius 0.7885, where the set changes most dramatically; the mids drive it round and kicks nudge it.',
      tex: ['z_{n+1} = z_n^2 + c,\\qquad c = 0.7885\\,e^{i\\alpha}'], vars: [['\\alpha', 'angle of c (rad)', () => f2(Math.atan2(U(L, 'uC')?.[1] ?? 0, U(L, 'uC')?.[0] ?? 1))], ['\\text{zoom}', '0.95·(1 − 0.2·bass)', () => f2(U(L, 'uZoom'))]] },
    { title: 'Smooth colour outside', why: 'The escape count is made continuous (no banding); its logarithm indexes a cosine rainbow, which spreads colour bands far out from the set instead of leaving a flat field.',
      tex: ['\\mu = n + 1 - \\log_2\\!\\bigl(\\tfrac12\\log_2 |z_n|^2\\bigr),\\qquad \\mathbf c = \\mathrm{pal}\\bigl(0.32\\log_2(\\mu + 1) + h\\bigr)'], vars: [] },
    { title: 'Colour inside too', why: 'Points that never escape would normally be black. Instead they are coloured by an orbit trap: how close the orbit ever came to the circle |z| = ½.',
      tex: ['T = \\min_n \\bigl|\\,|z_n| - \\tfrac12\\,\\bigr|,\\qquad \\mathbf c_{\\text{inside}} = \\mathrm{pal}(h + \\tfrac12 + 3T)'], vars: [['h', 'palette position', () => f2(U(L, 'uHue'))]] },
    HUE_STEP] }),
  'hyper-tunnel': (L) => ({ title: 'Hyper Tunnel', summary: 'An endless spiral tunnel drawn in log-polar coordinates, with a white-hot core instead of a hole.', steps: [
    { title: 'Log-polar coordinates', why: 'Using the logarithm of the radius makes every ring the same width per doubling of size, so the tunnel looks the same at every depth. Subtracting the travel moves you down it: the bass drives you forward. Twist turns the walls into spirals and glides slowly with the music; the number of arms changes on strong beats (at most every 4 s) by crossfading over 2 s, never by jumping.',
      tex: ['u = \\ln r - \\text{travel},\\qquad v = \\frac{\\theta}{2\\pi}N + \\text{spin} + \\tau u', 'r \\to 2r \\;\\Rightarrow\\; u \\to u + \\ln 2\\quad\\text{(self-similar: an endless zoom)}'],
      vars: [['\\text{travel}', 'distance travelled (0.25 + 1.0·bass per second)', () => f2(U(L, 'uTravel'))], ['\\tau', 'twist, gliding toward 0.3 + 0.5·body', () => f2(U(L, 'uTwist'))], ['N_A \\to N_B', 'arms (crossfade)', () => `${U(L, 'uArmsA')} → ${U(L, 'uArmsB')}, ${f2(U(L, 'uMix'))}`]] },
    { title: 'Pattern and core, with no hard edges', why: 'A soft checkerboard of sines in (u, v). Colour changes around the tunnel through cos(2πv/N), which is smooth between arms and continuous all the way round. (v0.6 gave each arm its own colour, which made hard spiral edges that looked like glitches.) Near the centre the rings become finer than a pixel and shimmer, so the pattern fades out there into a white glow.',
      tex: ['s = \\sin(3\\pi u)\\,\\sin(2\\pi v)\\cdot \\mathrm{smoothstep}(0.03, 0.3, r)', '\\mathbf c = \\mathrm{pal}\\Bigl(0.25u + 0.12\\cos\\frac{2\\pi v}{N} + h + 0.12s\\Bigr)\\,(0.72 + 0.28s),\\qquad \\mathbf c \\leftarrow \\mathrm{mix}\\bigl(\\mathbf 1,\\ \\mathbf c,\\ \\mathrm{smoothstep}(0, 0.1, r)\\bigr)'], vars: [] },
    HUE_STEP] }),
  'rainbow-mandala': (L) => ({ title: 'Rainbow Mandala', summary: 'Spirograph curves in a kaleidoscope feedback. The curves are drawn in a colour that travels round the rainbow, so every generation of trail keeps the colour it was born with: rings of all hues at once.', steps: [
    { title: 'Seeds', why: 'Two hypotrochoids (spirograph curves) that breathe with the band-limited wobble, drawn in the current rainbow colour. The mids speed up the colour journey; kicks nudge it.',
      tex: ['\\bigl((R-r)\\cos t + d\\cos\\tfrac{R-r}{r}t,\\ (R-r)\\sin t - d\\sin\\tfrac{R-r}{r}t\\bigr)', '\\mathbf c_{\\text{seed}} = \\tfrac12 + \\tfrac12\\cos\\!\\bigl(2\\pi(\\eta + (0, 0.33, 0.67))\\bigr),\\qquad \\dot\\eta = 0.12 + 0.5\\,\\text{mid}'],
      vars: [['\\text{bass}', 'size driver', drive(L, 'bass')], ['\\text{mid}', 'colour speed driver', drive(L, 'mid')]] },
    { title: 'Kaleidoscope feedback', why: 'Each frame the previous picture is folded into N mirrored wedges and pushed outward. Older rings are larger, and they carry older colours, so the mandala shows the recent colour history as rainbow bands. Colour is never re-mixed in the loop: in development, rotating the hue of the whole buffer averaged toward grey, and a saturation boost inside the loop ran away to one flat colour.',
      tex: ['\\mathbf q = \\mathrm{fold}_N(\\mathbf p)\\,e^{-z\\Delta t},\\qquad \\mathbf c \\leftarrow \\mathbf c(\\mathbf q)\\,2^{-\\Delta t/h}'],
      vars: [['N', 'wedges (switches on strong beats)', () => f2(U(L, 'uFold'))], ['z', 'outward zoom', () => f2(U(L, 'uZoom'))], ['h', 'trail half-life (s)', () => f2(U(L, 'uHalf'))]] },
    { title: 'No blank space', why: 'A faint three-phase plasma is injected per second, so anywhere the trails have not reached still glows.',
      tex: ['\\mathbf c \\mathrel{+}= \\beta\\,\\Delta t\\,\\bigl(\\tfrac12 + \\tfrac12\\cos(\\pi v + \\tfrac{2\\pi k}{3})\\bigr)'], vars: [['\\beta', 'base fill rate', () => f2(U(L, 'uBase'))]] }] }),
});

// ---------------- Bars & Waves (v0.8)
const S = (L) => L().r?.state ?? {};
Object.assign(EXPLAIN, {
  analysis: (L) => ({ title: 'Analysis', summary: 'The analysis features over the last 6 seconds: what the visualisations are reacting to, and when.', steps: [
    { title: 'Spectrogram', why: 'Each column is one analysis frame (10.7 ms); each row is one of the 48 log-spaced bands; colour is the band power in dB on a perceptually ordered scale. Kicks show as bright vertical streaks at the bottom, hi-hats at the top, held notes as horizontal lines.',
      tex: ['\\text{pixel}(t, b) = \\mathrm{cmap}\\!\\Bigl(\\frac{B_b(t) + 90}{80}\\Bigr),\\qquad B_b = 10\\log_{10}\\sum_{k\\in b} P[k]'], vars: [['B_{\\text{bass}}', 'bass band now (dB)', () => f2(L().frame?.bands?.[1])]] },
    { title: 'Onset detection', why: 'The log spectral flux measures how much new energy appeared since the last frame. Each bin is compared with the loudest of its neighbours (±50 cents) in the previous frame (SuperFlux), so vibrato, which only moves energy sideways, is not mistaken for a new note. An onset is declared at a local peak that clears the adaptive threshold (median plus 3 robust deviations of the last second) and at least 60 ms after the previous one.',
      tex: ['\\Phi(t) = \\frac1K\\sum_k \\max\\Bigl(0,\\ \\ln(1 + \\gamma A_t[k]) - \\max_{|j-k| \\le w_k} \\ln(1 + \\gamma A_{t-1}[j])\\Bigr),\\quad w_k \\approx \\pm 50\\text{ cents}', '\\theta(t) = \\operatorname{median}(\\Phi) + 3\\cdot 1.4826\\,\\operatorname{MAD}(\\Phi) + \\delta'],
      vars: [['\\Phi', 'flux now', () => f2(L().frame?.fluxLog)], ['\\theta', 'threshold now', () => f2(L().frame?.onset?.threshold)]] },
    { title: 'Timbre', why: 'Centroid is the spectrum\'s amplitude-weighted centre of mass (brighter sounds sit higher), rolloff is where 85 % of the power lies below (power is dominated by the loudest bands, so in bass-heavy music the rolloff can sit well below the centroid), flatness is near 1 for noise and near 0 for pure tones, and the zero-crossing rate rises with noisiness and pitch.',
      tex: ['f_c = \\frac{\\sum_k f_k A_k}{\\sum_k A_k},\\qquad \\sum_{f_k \\le f_{85}} P_k = 0.85\\sum_k P_k,\\qquad \\text{flatness} = \\frac{\\exp\\bigl(\\overline{\\ln P}\\bigr)}{\\overline{P}}'],
      vars: [['f_c', 'centroid (Hz)', () => f2(L().frame?.centroid)], ['f_{85}', 'rolloff (Hz)', () => f2(L().frame?.rolloff)], ['\\text{flatness}', 'spectral flatness (0 = pure tone … 1 = noise)', () => f2(L().frame?.flatness)]] },
    { title: 'Pulses, stereo and level', why: 'Pulses show how far each band sits above its own recent typical level (this is what carries the beat in every visualisation). The stereo history plots correlation, balance and width; the level history plots dBFS, the adaptive level and the level pulse.',
      tex: ['\\text{pulse} = \\operatorname{clamp}\\!\\Bigl(\\frac{L_{\\text{fast}} - \\max(\\operatorname{median}_{1.5\\,\\text{s}} L,\\ \\bar L_{0.4\\,\\text{s}}) - 1}{8},\\ 0,\\ 1\\Bigr)'],
      vars: [['\\text{pulse}_{\\text{bass}}', 'bass pulse now', () => f2(L().frame?.bandsPulse?.[1])], ['\\rho', 'correlation now', () => f2(L().frame?.correlation)]] }] }),
  mashup: (L) => ({ title: 'Mashup', summary: 'Every measurement in one radial machine. It looks wild, but every element is a real reading, as in the other Bars & Waves views.', steps: [
    { title: 'What each part is', why: 'Core: a bullseye of the seven adaptive band levels (sub-bass at the centre, brilliance at the edge, each ring as bright as its band), with the goniometer (stereo field) on top, coloured green for mono through to red for opposite phase. Halos: one ring per band, as bright as that band\'s pulse. Waveform ring: the last 1024 samples. Spokes: the 48-band spectrum, mirrored, lows at the bottom. Needle: the spectral centroid. Outer arcs: left and right RMS level. Shockwaves: detected onsets, coloured by the centroid at that moment.',
      tex: ['\\text{hue}_{\\text{core}} = 60^\\circ + 60^\\circ\\rho,\\qquad \\text{needle angle} = \\frac{\\pi}{2} - \\pi\\,\\frac{\\ln(f_c/20)}{\\ln 1000},\\qquad \\text{arc sweep} = \\frac{\\pi}{2}\\cdot\\frac{\\mathrm{dBFS} + 60}{60}'],
      vars: [['\\rho', 'correlation', () => f2(L().frame?.correlation)], ['f_c', 'centroid (Hz)', () => f2(L().frame?.centroid)]] },
    { title: 'Feedback trails and shake', why: 'Each frame starts from the previous one, zoomed outward faster on kicks, turned with the mid pulse (direction follows the stereo balance, with hysteresis so it never flickers) and faded. Onsets kick a damped angular spring (7 Hz, ζ = 0.25), which gives the shake. The turned picture is always scaled enough to cover the screen, and trails fade out in a circle before the frame edge, so the shape never looks like a shaken rectangle. All rates multiply Δt.',
      tex: ['\\text{zoom} = \\max\\!\\Bigl(e^{(0.25 + 0.9\\,\\text{pulse}_{\\text{low}})\\Delta t},\\ \\cos|\\theta| + \\max\\bigl(\\tfrac WH, \\tfrac HW\\bigr)\\sin|\\theta|\\Bigr),\\qquad \\theta = \\pm(0.1 + 0.5\\,\\text{pulse}_{\\text{mid}})\\Delta t + \\phi_{\\text{shake}}', '\\ddot\\phi + 2\\zeta\\omega_0\\dot\\phi + \\omega_0^2\\phi = 0\\ \\text{(kicked by onsets)},\\qquad \\text{keep} = 2^{-\\Delta t/0.28}'],
      vars: [['\\text{pulse}_{\\text{low}}', 'kick drive', () => f2(Math.max(L().frame?.bandsPulse?.[0] ?? 0, L().frame?.bandsPulse?.[1] ?? 0))]] }] }),
});
EXPLAIN.circular = (L) => ({ title: 'Circular spectrum', summary: 'The spectrum wrapped round a ring and mirrored: bass bursts up from 12 o’clock, treble meets at 6 o’clock. Every bar is a measured level.', steps: [
  { title: 'Bars', why: 'The 48 measured bands are evenly spaced in log-frequency, so 64 bars per side are interpolated between them with a Catmull-Rom cubic, which passes exactly through every band. Bar length follows the level in decibels between −75 and −12 dBFS through a gentle curve (power 1.5): mastered music is fairly flat in decibels, so a straight line made every bar nearly the same length. The curve doubles the contrast and stays monotonic, so a louder band is always a longer bar.',
    tex: ['B(x) = \\mathrm{CR}\\bigl(B_0, \\dots, B_{47};\\ x\\bigr),\\quad x = \\tfrac{i + 1/2}{64}\\cdot 48 - \\tfrac12', '\\ell_i = \\ell_{\\max}\\cdot\\operatorname{clamp}\\!\\Bigl(\\frac{B(x_i) + 75}{63},\\ 0,\\ 1\\Bigr)^{1.5}'],
    vars: [['B_{\\text{bass}}', 'a bass band now (dB)', () => f2(L().frame?.bands?.[1])]] },
  { title: 'Peak caps', why: 'The dot at each bar’s tip marks its recent peak: it jumps up instantly, holds for 0.35 s, then falls at 0.8 of the full length per second (scaled by elapsed time, so it looks the same at any refresh rate).',
    tex: ['p \\leftarrow \\begin{cases} v & v \\ge p \\\\ p & \\text{for 0.35 s after a new peak} \\\\ \\max(v,\\ p - 0.8\\,\\Delta t) & \\text{then} \\end{cases}'], vars: [] },
  { title: 'The thump', why: 'The ring swells and glows with the bass pulse (how far the bass sits above its own recent typical level), with a 30 ms attack and a 250 ms release, so each kick lands crisply and relaxes smoothly. Inside the ring, a faint trace of the last 512 samples shows the waveform itself.',
    tex: ['R = R_0\\,(1 + 0.07\\,\\tilde p),\\qquad \\tilde p \\leftarrow \\tilde p + (p - \\tilde p)\\bigl(1 - e^{-\\Delta t/\\tau}\\bigr),\\quad \\tau = \\begin{cases} 0.03\\,\\text{s} & \\text{rising} \\\\ 0.25\\,\\text{s} & \\text{falling} \\end{cases}'],
    vars: [['p', 'bass pulse now', () => f2(Math.max(L().frame?.bandsPulse?.[0] ?? 0, L().frame?.bandsPulse?.[1] ?? 0))]] }] });
EXPLAIN.ridgeline = (L) => ({ title: 'Ridgeline', summary: 'The last three seconds of spectrum, stacked like the pulsar plot on Joy Division’s Unknown Pleasures: newest at the front, each line hiding the ones behind it.', steps: [
  { title: 'Each line', why: 'One snapshot of the spectrum, mirrored from the centre: bass in the middle, treble towards the edges. The level is mapped over −60 to −12 dBFS and squared, so moderate levels sit near the baseline and strong components rise out of it (a gentler curve left every line floating on a raised plateau). It stays monotonic: a louder band always draws higher. The outer 35 % tapers smoothly to the baseline, a display envelope that keeps the edges calm, as in the original plot.',
    tex: ['h(x) = A\\cdot\\operatorname{clamp}\\!\\Bigl(\\frac{B(f(|x|)) + 60}{48},\\ 0,\\ 1\\Bigr)^{2}\\cdot e(|x|),\\qquad e(u) = \\operatorname{smoothstep}\\!\\Bigl(0,\\ 1,\\ \\frac{1 - u}{0.35}\\Bigr)'], vars: [] },
  { title: 'History and scrolling', why: 'A snapshot is stored every 1/14 s of elapsed time (44 lines, about 3.1 s), however the frames fall, so it scrolls at the same speed at any refresh rate. Between snapshots every line moves up smoothly by the fraction of the interval that has passed; the newest line is live.',
    tex: ['y_a = y_{\\text{front}} - (a + 1 + \\phi)\\,g,\\qquad \\phi = \\frac{t_{\\text{since last snapshot}}}{1/14\\ \\text{s}} \\in [0, 1)'], vars: [] },
  { title: 'Hidden lines', why: 'Lines are drawn from the back to the front, and the area under each is filled with black before its line is drawn, so a tall peak hides the quieter lines behind it. That occlusion is what gives the look its depth.',
    tex: ['\\text{draw order: } a = 43, 42, \\dots, 0,\\ \\text{then the live line}'], vars: [] }] });
EXPLAIN.swarm = (L) => ({ title: 'Particle Swarm', summary: '65 536 particles simulated on the graphics card, pulled around by five orbiting magnets, one for each part of the music, after iTunes’ Magnetosphere.', steps: [
  { title: 'Magnets', why: 'Each magnet follows its own looping path and belongs to a band: bass, low mids, mids, upper mids, treble. Its pull grows with that band’s pulse, so the swarm gathers round whichever part of the music is active. A swirl round each magnet turns the pull into spiral orbits instead of a collapse. The pull is softened (ε) so it never divides by zero.',
    tex: ['\\mathbf a \\mathrel{+}= \\frac{G\\,\\bigl(s_k\\,\\mathbf d + w_k\\,\\hat{\\mathbf n}_k \\times \\mathbf d\\bigr)}{\\bigl(|\\mathbf d|^2 + \\varepsilon^2\\bigr)^{3/2}},\\qquad \\mathbf d = \\mathbf M_k - \\mathbf p,\\quad s_k = s_k^0 + g_k\\,\\text{drive}_k'],
    vars: [['\\text{drive}_{\\text{bass}}', 'bass drive', () => f2(L().r?.values?.bass)], ['\\text{drive}_{\\text{treble}}', 'treble drive', () => f2(L().r?.values?.high)]] },
  { title: 'Shimmer, centring and motion', why: 'Treble adds a shimmering turbulence that is divergence-free (each component ignores its own coordinate), so it stirs the swarm without bunching it. A gentle spring and a soft wall beyond radius 2.4 keep everything in view; drag and a speed limit keep it calm. Every step is fixed at 1/120 s and the number of steps follows elapsed time (scaled by Movement), so it runs the same at any refresh rate.',
    tex: ['\\mathbf a \\mathrel{+}= T\\bigl(\\sin(f y + t),\\ \\sin(f z + t),\\ \\sin(f x + t)\\bigr) - \\bigl(c + k_w\\,\\max(0,\\ |\\mathbf p| - 2.4)/|\\mathbf p|\\bigr)\\,\\mathbf p', '\\mathbf v \\leftarrow (\\mathbf v + \\mathbf a\\,h)\\,e^{-\\gamma h},\\quad |\\mathbf v| \\le v_{\\max},\\qquad \\mathbf p \\leftarrow \\mathbf p + \\mathbf v\\,h'], vars: [] },
  { title: 'The beat: a breath', why: 'Each beat makes the whole swarm breathe out: positions are drawn up to 30 % further from the centre, jumping to the beat’s strength and relaxing with a 0.25 s time constant. Colour shows which bands hold each particle: every magnet has a colour (bass pink, low mids orange, mids green, upper mids blue, treble violet), and each particle mixes them weighted by pull over distance squared. A physical kick was tried first: the swirl keeps feeding energy into orbits, so kicks knocked particles into wide orbits that sustained themselves, and a steady beat inflated the swarm by 50–200 %. The breath cannot build up.',
    tex: ['\\mathbf p_{\\text{drawn}} = (1 + 0.3\\,b)\\,\\mathbf p,\\qquad b \\leftarrow \\max\\bigl(b\\,e^{-\\Delta t/0.25},\\ \\text{beat strength}\\bigr)'],
    vars: [['b', 'breath now', () => f2(L().r?.breath)]] }] });
EXPLAIN.phosphor = (L) => ({ title: 'Phosphor scope', summary: 'An X/Y oscilloscope with a glowing phosphor screen: the left channel moves the beam sideways, the right channel up and down. Music made for oscilloscopes draws pictures here.', steps: [
  { title: 'The beam', why: 'The beam is drawn through every sample (48 000 per second at 48 kHz), joining each frame to the last without a gap. It spends 1/sr seconds between consecutive samples, so a long, fast stroke is dim and a short, slow one bright, while every sample deposits the same energy, as on a real cathode-ray tube. A resting beam is a bright dot, limited by the beam width w.',
    tex: ['(x, y) = g\\,(L, R),\\qquad I = \\frac{K/\\mathrm{sr}}{\\max(\\ell,\\ w)},\\qquad I\\cdot\\ell\\cdot w = \\text{constant per sample}'],
    vars: [['g', 'auto-gain (fills 85 % of the screen; ×1 to ×8)', () => f2(L().r?.ctx?.state?.gain)]] },
  { title: 'Phosphor afterglow', why: 'Like the P31 green phosphor in classic scopes, the glow has two parts: a bright fast decay (35 ms) and a faint slow tail (0.4 s). Both decay by their exact exponential each step, so the afterglow looks the same at any refresh rate and fades all the way to black.',
    tex: ['E_{\\text{fast}} \\leftarrow E_{\\text{fast}}\\,e^{-\\Delta t/0.035},\\qquad E_{\\text{slow}} \\leftarrow E_{\\text{slow}}\\,e^{-\\Delta t/0.4},\\qquad E = E_{\\text{fast}} + 0.22\\,E_{\\text{slow}}'], vars: [] },
  { title: 'Screen', why: 'Brightness saturates smoothly; where the beam rests it turns white-hot. A soft glow around bright traces imitates light scattering in the glass, and a faint 10 × 10 graticule marks the screen, as on a real instrument.',
    tex: ['b = 1 - e^{-(E + 0.55\\,E_{\\text{glow}})\\,\\kappa}'], vars: [] }] });
EXPLAIN.terrain = (L) => ({ title: 'Spectrum terrain', summary: 'The spectrum as a synthwave landscape: the newest spectrum rises at the front and rolls away towards a striped sun on the horizon.', steps: [
  { title: 'Each row', why: 'One spectrum snapshot, mirrored so bass sits at both outer edges and treble towards the middle: loud bass raises mountain ranges on both sides, and a valley runs down the centre. The middle 4–20 % is flattened into a road (a display envelope). Heights use the ridgeline’s curve: level over −60 to −12 dBFS, squared.',
    tex: ['h(u) = \\operatorname{clamp}\\!\\Bigl(\\frac{B\\bigl((1 - |u|)\\cdot 47\\bigr) + 60}{48},\\ 0,\\ 1\\Bigr)^{2}\\cdot \\operatorname{smoothstep}(0.04,\\ 0.2,\\ |u|),\\qquad u \\in [-1, 1]\\ \\text{across the terrain}'], vars: [] },
  { title: 'Scrolling', why: 'A new row is stored every 1/24 s of elapsed time (64 rows, about 2.7 s), however the frames fall, and the whole landscape moves back smoothly between rows. Movement (Influence) sets the speed; Sound → shape sets the height.',
    tex: ['z_a = z_0 - (a + \\phi)\\,\\Delta z,\\qquad \\phi \\in [0, 1)'], vars: [] },
  { title: 'Light', why: 'Grid lines are anti-aliased with screen-space derivatives and coloured by height (violet valleys, magenta slopes, orange peaks). The terrain fades into a magenta haze with distance. The sun sits on the projected horizon, and it and the grid glow with the bass pulse.',
    tex: ['\\text{line} = 1 - \\min\\!\\Bigl(\\frac{|\\operatorname{fract}(g - \\tfrac12) - \\tfrac12|}{\\operatorname{fwidth}(g)},\\ 1\\Bigr)'],
    vars: [['p', 'bass pulse now', () => f2(Math.max(L().frame?.bandsPulse?.[0] ?? 0, L().frame?.bandsPulse?.[1] ?? 0))]] }] });
EXPLAIN.vu = (L) => ({ title: 'VU meters', summary: 'Two analogue VU meters, left and right, with the standard needle movement and broadcast alignment.', steps: [
  { title: 'Scale', why: 'Like a real meter, the needle moves in proportion to voltage, and the scale is marked in decibels: 0 VU sits at 70.8 % of full deflection and +3 VU at 100 %, with the red zone above 0. The small numbers underneath are the old percentage scale (100 % at 0 VU).',
    tex: ['d = 0.708\\cdot 10^{\\,\\mathrm{VU}/20},\\qquad \\theta = -50^\\circ + 100^\\circ\\, d'], vars: [] },
  { title: 'Alignment', why: 'The meter aligns itself to the music, as an engineer trims a meter for the material: the reference follows the long-term level (a power average over about 20 s, settling within a second or two at the start), so typical sound reads about −3 VU and peaks swing into the red. It stays between −26 and −8 dB, the range of real alignments, and is printed under the meters. A fixed broadcast alignment (0 VU = −18 dBFS sine, −21 dB in this app’s RMS convention) pins the needles on modern masters: the test mix reads +8.6 VU against it.',
    tex: ['\\mathrm{VU} = L_{\\text{RMS}} - A,\\qquad A = \\operatorname{clamp}\\bigl(10\\log_{10}\\overline{P} + 3,\\ -26,\\ -8\\bigr)\\ \\text{dB}'],
    vars: [['L_{\\text{RMS}}', 'left level now (dB)', () => f2(L().frame?.dbfs?.[0])], ['A', 'alignment: 0 VU in dB RMS', () => f2(L().r?.state?.align)]] },
  { title: 'Ballistics', why: 'The standard VU response (IEC 60268-17): after a sudden change the needle reaches 99 % in 300 ms and overshoots by 1–1.5 %. That is a damped second-order system; the needle follows its exact solution over each analysis hop, so it moves the same at any sample rate. The PEAK lamp lights for half a second whenever a sample reaches −3 dBFS.',
    tex: ['\\ddot d + 2\\zeta\\omega_0\\dot d + \\omega_0^2\\,(d - d_{\\text{target}}) = 0,\\qquad \\zeta = 0.8127,\\ \\omega_0 = 13.51\\ \\mathrm{rad/s}', 't_{99\\%} = 300\\ \\mathrm{ms},\\qquad \\text{overshoot} = 1.25\\ \\%'], vars: [] }] });
EXPLAIN.instruments = ((base) => (L) => { const s = base(L); s.steps.push(
  { title: 'Pulses and readouts', why: 'Each band bar shows the adaptive level, and brightens on that band\'s pulse (its rise above its own recent typical level, which is what carries the beat). The meters show RMS dBFS and sample peak as numbers under each bar. Centroid and rolloff are shown in the Analysis view.',
    tex: ['\\text{lightness}_b = 46\\% + 26\\%\\cdot\\text{pulse}_b,\\qquad \\text{peak}_{\\text{dB}} = 20\\log_{10}\\max_n |x[n]|'],
    vars: [['\\text{pulse}_{\\text{bass}}', 'bass pulse now', () => f2(L().frame?.bandsPulse?.[1])], ['\\text{peak}_L', 'left sample peak (dBFS)', () => f2(20 * Math.log10(Math.max(L().frame?.peak?.[0] ?? 1e-6, 1e-6)))]] }); return s; })(EXPLAIN.instruments);

// the mapping-to-TeX generator, for the panel's "Audio → drives" section (app.js is a classic script)
import { mappingTex } from '../engine/mapping.mjs';
if (typeof self !== 'undefined') self.MappingTex = mappingTex;
