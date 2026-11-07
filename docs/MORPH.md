# Experimental › Morph

A sphere whose surface is physically pushed around by the sound. The model is `src/renderer/visualizations/experimental/morph-model.mjs`, which is pure JavaScript and is the same code used by the tests and by rendering. The Three.js renderer is `morph.mjs`, and the tests are `apps/desktop-electron/test/morph.test.mjs`.

## Surface

Each vertex is a unit direction **p** = (x, y, z) moved along itself: **p**′ = **p**·(R + D).

```text
D = A_b·x_b·[0.55·Im((x+iz)² e^{iψ_b}) + 0.45·P₂(y)·cos ψ_z]     bass: rotating elongation + squash/stretch
  + A_m·x_m·(1/√6)  Σ_{j=1..6}  sin(7·(d_j·p) + ψ_j)             mids: travelling waves
  + A_h·x_h·(1/√10) Σ_{j=1..10} sin(19·(d_j·p) + ψ_j)            highs: fine ripples
  + A_s·x_s·x                                                    stereo balance: lean left/right
  + A_br·sin(2π·0.12·t) + A_sw·max(0, x_b)                       breathing + kick swell (v0.3)
```

| Symbol | Value | Meaning |
|---|---|---|
| R | 1 | rest radius |
| A_b, A_m, A_h, A_s, A_br, A_sw | 0.34, 0.07, 0.03, 0.06, 0.01, 0.048 | term amplitudes (A_sw: kick swell, v0.3) |
| x_b, x_m, x_h, x_s | spring positions (below) | audio-driven amplitudes |
| d_j | seeded uniform random unit vectors | plane-wave directions (seed 20260705) |
| P₂(y) | (3y² − 1)/2 | Legendre polynomial; stretches or squashes along the vertical axis |
| ψ | integrated phases | ψ += rate·h each step, so speed changes never cause jumps |

### Changes from the brief's illustrative formula

The brief proposed D = A_b·bass·sin(3θ + ω_b t) + …, with θ and φ as angular coordinates.

**Poles.** θ is undefined at the poles, so sin(mθ) takes every value in [−1, 1] around them: a cusp. Im((x+iz)^m e^{iψ}) equals sin^m φ·sin(mθ + ψ), the shape of the l = m spherical harmonic. The sin^m φ factor sends it smoothly to 0 at the poles, and it needs no trigonometry per vertex. Tested by sampling 64 azimuths at 0.001 rad from the pole.

**m = 2, not 3, for bass.** I implemented m = 3 first and rendered it. A steady 100 Hz tone produced 20% peak displacement, but three equatorial lobes are seen almost edge-on by a camera orbiting at equator height, and the result read as a round blob. m = 2 stretches the silhouette itself into a rotating egg, which reads clearly from any angle.

**Mids and highs.** Instead of sin(11θ) and sin(29θ + 2φ), these use sums of plane waves in random directions. They are smooth everywhere and cover the whole surface evenly, rather than concentrating at the equator as high-m harmonics do.

**Wave normalisation 1/√N, not 1/N.** Random-phase waves add in power, so N waves have a typical amplitude of about √N. Normalising by 1/√N keeps each field's RMS near 0.71 whatever N is. My first version used 1/N, and a test caught that treble ripples were then no bigger than the idle bass motion.

### No self-intersection, by construction

Every bracket in D is bounded: |Im(…)| ≤ 1, |P₂| ≤ 1, a field of N waves ≤ √N, and |x| ≤ 1. The springs are clamped, so:

```text
|D| ≤ 0.34·1.15 + 0.07·√6·1.2 + 0.03·√10·1.2 + 0.06·1.2 + 0.01 + 0.048·1.15 = 0.848 R     (v0.3, with kick swell)
```

The radius therefore never drops below 0.15R. A surface r(**p**) > 0 defined over directions is star-shaped and cannot fold through itself. The test drives 3000 frames of random, extreme input, including kicks, and checks both the bound and the minimum radius.

### Cost

Every term is a time-varying coefficient multiplied by a static per-vertex basis function. The per-vertex trigonometry (sin and cos of k·d_j·**p**, the harmonics and P₂) is computed once. Each frame is then a 37-term linear combination over 8412 vertices, about 310k multiply-adds, followed by `computeVertexNormals`. The Diagnostics panel shows the measured CPU time as *Geometry update*.

## Dynamics

Each amplitude x is a mass–spring–damper driven toward its mapped audio target:

```text
x'' + 2ζω₀·x' + ω₀²·(x − target) = 0,   ω₀ = 2π·f₀
```

| Spring | f₀ | ζ | Clamp | Character |
|---|---|---|---|---|
| bass | 2.0 Hz | 0.30 | −0.5 … 1.15 | bouncy, overshoots on kicks |
| mid | 3.5 Hz | 0.40 | −0.5 … 1.2 | |
| high | 7.0 Hz | 0.60 | −0.5 … 1.2 | quick, little ringing |
| balance | 0.8 Hz | 1.00 | −1.2 … 1.2 | critically damped lean |

**Integration (v0.9): the exact solution.** Within a step the target is constant, so the equation is linear and has a closed-form solution. With y = x − target:

| Regime | y(h) |
|---|---|
| under-damped (ζ < 1) | e^{−ζω₀h}·(y·cos ω_d h + (v + ζω₀y)/ω_d·sin ω_d h), with ω_d = ω₀√(1−ζ²) |
| critical (ζ = 1) | (y + (v + ω₀y)h)·e^{−ω₀h} |
| over-damped (ζ > 1) | the sum of two decaying exponentials |

This replaced semi-implicit Euler (v0.2–v0.8), which had a small integration error and a stability limit. Its results also depended on the step size, which depends on the device's sample rate (512/44100 vs 512/48000 s hops). Measured after 1 s: Euler differs between 1/240 s and 1/48000 s steps by 5.1·10⁻⁴; the exact step by 3.3·10⁻¹⁵. A test matches it against the analytic step response in all three regimes to 10⁻¹².

Particles move exactly under linear drag as well: v ← v·e^{−ch}, x ← x + v·(1 − e^{−ch})/c.

Tests confirm that a spring settles on its target and rings at the damped frequency f₀√(1 − ζ²), within 0.02 Hz. They also run 60 s of random drive and kicks, and the state stays finite and inside its clamps.

**The simulation clock is the audio clock.** Each analysis frame advances the model by exactly one hop (512/48000 s, split into 3 substeps). The geometry is therefore a function of the audio frames alone. The test feeds the same 500 frames in batches of 1 and 3, mimicking different display rates, and the vertex positions come out **bit-identical**. Gap-filled frames keep this clock running during silence.

**Onsets** add an impulse to the bass and mid spring velocities (3.0 and 4.0 units/s × strength) and launch particles.

## Mappings (`MORPH_MAPPINGS`, v0.3)

Version 0.2 drove Morph from adaptive band levels. On real music those stay near 1, so the springs sat at full deflection: your diagnostics read 0.93 / 0.92 / 1.00. Version 0.3 drives it mainly from **pulses** (docs/DSP.md), with a small share of level for body. The springs are snappier: bass 3.0 Hz (ζ 0.28), mid 4.5 Hz (ζ 0.35), high 8 Hz (ζ 0.5). Kick impulses are 4.0 / 5.0, and a uniform swell (0.048·max(0, x_b)) makes the whole form pump on kicks. The bound is now 0.85R, so r ≥ 0.15R.

Measured on frames recorded from the real service playing the dense mix (`test/reactivity.test.mjs`):

| | Bass drive | Deformation over time | Beat contrast | Glow contrast |
|---|---|---|---|---|
| v0.2 | 0.99 ± 0.02 | 0.120 ± 0.009 | 0.001 | 0.01 |
| v0.3 | 0.33 ± 0.20 | 0.045 ± 0.026 | 0.027 | 0.18 |

The mean deformation is lower in v0.3 because the form now relaxes between kicks; that relaxation is what makes each kick visible.

The v0.2 table below is kept for reference.

## Mappings in v0.2

These use the generic engine from the brief: `value = clamp(gain·curve((Σwᵢ·featureᵢ − threshold)/(1 − threshold)) + offset, min, max)`, followed by attack/release smoothing.

| Drive | Sources | Curve | Notes |
|---|---|---|---|
| bass | 0.45 sub-bass + 0.55 bass (adaptive 0–1) | smoothstep | offset 0.06 keeps a little motion in silence |
| mid | 0.4 low-mid + 0.6 mid | linear | offset 0.06; also sets the wave travel speed |
| high | 0.3 upper-mid + 0.4 presence + 0.3 brilliance | sqrt, threshold 0.05 | offset 0.04; also sets ripple speed |
| asym | balance | signed, gain 1.6 | lean toward the louder side |
| kick | onset (0.5 + 0.5·confidence when an onset fires) | — | spring impulses, particles, glow |
| glow | level | smoothstep, attack 30 ms / release 450 ms | brightness, rim, bloom, camera distance |
| hue | centroid (log position, 100 Hz → 0, 20 kHz → 1) | attack 250 ms / release 800 ms | palette; held while silent |
| width | stereo width | attack 100 ms / release 600 ms | camera orbit speed |

The other layers:
- **Particles** (pool of 3000, seeded): launched from the surface at onsets, with speed ∝ strength, drag 1.2/s and about 1.6 s of life.
- **Background**: a swirl field whose distortion and brightness follow the bass spring, with hue from the centroid.
- **Bloom**: strength 0.35 + 0.45·glow, plus onset flashes through the flash limiter, capped at 1.2. The threshold of 0.55 means only crests and rims glow.

## Phase 2 gate: tests

| Controlled input | Measured outcome |
|---|---|
| Silence for 3 s | shape keeps moving (RMS change > 1e-3) but deformation stays small (RMS < 0.03) |
| Bass 0, 0.25, 0.5, 0.75, 1 | bass deformation RMS strictly increases |
| Bass only | bass RMS 0.114 vs high 0.0008 (over 100×) |
| Treble only | high RMS 0.021 vs bass 0.0066 (over 3×; the residual bass is the idle offset) |
| One onset | bass spring velocity jumps by > 1; ≥ 200 particles launched; all expire within 4 s |
| Balance −1 / +1 | vertex centroid moves to −x / +x |
| The real service's 100 Hz sine, through the real mappings | bass drive 0.76, bass RMS 0.088, mid 0.003, high 0.0008 |

## Tuning I did by looking

I rendered all of this on a virtual display (software WebGL) against test signals and fixed two problems that only showed up visually.

**Overexposure.** The first version blew out to white: the colour terms summed well above 1, and with a bloom threshold of 0.12 everything glowed. The colour terms now have an explicit linear-light budget, and the bloom threshold is 0.55.

**Invisible bass.** The m = 3 harmonic problem described above.
