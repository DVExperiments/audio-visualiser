# Methods review (v0.9)

Every method described in the documentation was checked for whether it suits this project, a real-time, visual, audio-reactive desktop app, and whether a better-established method exists. Where one did, it was implemented and **measured against the method it replaced**: the measurements are in `tests/DspCore.Tests/SuperFluxTests.cs` and `apps/desktop-electron/test/methods.test.mjs`.

## Changed

| Area | Before | After | Why it is better, measured |
|---|---|---|---|
| Onset detection | Log spectral flux, each bin against the same bin one frame earlier | **SuperFlux**: against the maximum of ±50 cents in the previous frame (Böck & Widmer, DAFx 2013), widened with frequency because the FFT grid is linear | Vibrato that comes and goes caused 13 and 18 false onsets in 10.5 s; now **0 and 0**. A fixed ±1-bin filter was *worse* (22) on deep vibrato, hence the frequency-proportional width. Impulses (10/10) and dense-mix kicks (16/16) unchanged. |
| Shader random numbers | `fract(sin(x)·43758.5)` | **PCG2D integer hash** (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020) | Exact integer arithmetic, so it doesn't depend on the GPU's sin() accuracy, which is implementation-defined and degrades as time-based coordinates grow over long sessions. Over 50 000 cells: **50 000** distinct values (χ² 21.5, uniform) vs 3 655 for the sine hash in float32. |
| Noise interpolation | Cubic 3t² − 2t³ | **Quintic** 6t⁵ − 15t⁴ + 10t³ (Perlin, "Improving Noise", 2002) | Twice differentiable: the curvature jump at cell edges falls from 11.98 to 0.12, so Nebula's curl flow (a derivative of the noise) no longer creases along the grid. |
| Ripple tank (Water) | 5-point Laplacian | **Isotropic 9-point Laplacian** | Waves travelled 10 % faster along the axes (wavefront 55 vs 61 px); now **55 vs 55**: round ripples. The stability limit rises from 0.71 to √(3/4) ≈ 0.87 (λ = 0.5 used). |
| Morph springs | Semi-implicit Euler | **Exact closed-form step** (under-, critical and over-damped) | No integration error or stability limit; results no longer depend on the device sample rate. The difference between step sizes fell from 5.1·10⁻⁴ to **3.3·10⁻¹⁵**; it matches the analytic response to 10⁻¹². |
| Particles | Euler position update | **Exact motion under linear drag** | Step-size independent (tested 1/240 s vs 1/48000 s). |

## Kept, and why

| Method | Verdict |
|---|---|
| Radix-2 FFT (own), periodic Hann window | Correct (DFT and Parseval tests); the Hann window has the right resolution-vs-leakage balance for a 48-band display. |
| Two FFT sizes (2048, plus 4096 below 250 Hz) | A standard multi-resolution compromise; measured 0.87 → 0.05 dB band error. Constant-Q transforms are more elegant but cost more for little visual gain. |
| Band power by fractional bin partition | Exactly power-preserving (tested). Leakage across band edges is inherent to windowed FFTs and documented. |
| RMS over the analysis window, dBFS = 20·log₁₀(RMS) | As specified in the brief. The window ripple for bass is bounded and documented; display smoothing hides it. |
| Sample peak (not true peak) | Adequate for a visualiser's clip indicator. ITU-R BS.1770 true-peak (4× oversampling) would matter for mastering tools; noted as a possible addition. |
| Spectral centroid (amplitude-weighted), rolloff (power), flatness (geometric/arithmetic mean of power), ZCR | Standard definitions, used as in common MIR libraries. Centroid vs rolloff disagreement in bass-heavy music is explained in BARS-AND-WAVES.md. |
| Adaptive median + MAD onset threshold, 60 ms refractory | A robust, widely used peak-picking scheme; one frame of latency. |
| Pulse baseline = max(1.5 s median, 0.4 s average) | Chosen by tests over three alternatives (DSP.md). |
| Attack/release smoothing α = 1 − e^{−Δt/τ}; fade to black as the exact ODE step; deposit ∝ Δt; blur radius ∝ √Δt; hue glide | Each is the exact or variance-correct form for variable frame times (tested). |
| Leapfrog (FDTD) time stepping for the wave equation | The standard second-order scheme; now paired with an isotropic stencil. |
| Semi-Lagrangian curl-noise advection (Nebula) | The standard stable method for divergence-free visual flow (Bridson et al., "Curl-noise for procedural fluid flow", SIGGRAPH 2007). |
| Domain warping, plasma, smooth-coloured Julia sets, log-polar tunnel | The established formulations; the explanations show the exact formulas used. |
| Radial displacement with bounded amplitudes (Morph) | Gives a proof of no self-intersection; analytic normals were considered, but `computeVertexNormals` costs about 1 ms and is exact for the mesh drawn. |

## Considered, not adopted (yet)

- **True-peak metering** (BS.1770): useful if the app ever shows mastering-grade meters.
- **Beat and tempo tracking**: onsets are transients, not beats (as the brief says). A tempo estimator (e.g. autocorrelation of the onset function) could drive tempo-synced visuals later.
- **Constant-Q / log-frequency filterbank analysis**: would make SuperFlux exact rather than approximated on the linear grid, at a higher cost per frame.
