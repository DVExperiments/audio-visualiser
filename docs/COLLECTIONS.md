# Classic collections (Phase 3, reworked in v0.4)

> **v0.9 methods review.**
> - Shader noise uses an integer PCG hash and quintic interpolation (no float-precision degradation over long sessions, and no creases in Nebula's curl flow).
> - Water uses an isotropic 9-point Laplacian, so ripples stay round: the 5-point stencil was 10 % faster along the axes.
>
> See docs/METHODS-REVIEW.md.

> **v0.4 changes.** These sit on top of the engine described below; full details are in CHANGELOG 0.4.0.
>
> | Change | What it does |
> |---|---|
> | Exact fade to black | GLSL `fadeToBlack`, JS twin `geometry2d.fadeToBlack`, tested |
> | Colour schemes | one saturated 3-stop scheme at a time (`engine/palettes.mjs`) |
> | Program cycling | Alchemy-style (`engine/program.mjs`) |
> | Oscilloscope rings | `scopeCircle`, `ScopeGain` |
> | Soft frame edges | no hard black cut-off |
> | Fixed-rate substeps | for simulations; custom present shaders |
> | Alchemy curves | Lissajous, rose, hypotrochoid, epitrochoid (`curvePoint`), with a band-limited wobble (`writeCurve`) |
> | New: Ambience › Water | ripple tank, CPU twin in `ambience/ripple-model.mjs` |
> | New: Ambience › Swirl | smoky stereo waveform rings, blur radius ∝ √dt |
>
> Where the preset descriptions below differ (rainbow hue drift, per-point spectrum shaping), v0.4 replaces them.

There are three original procedural collections, each evoking a Windows Media Player XP family without using any of its code or assets. All six presets share one framebuffer-feedback engine: `src/renderer/engine/feedback.mjs`.

## The feedback engine

Every display frame runs five steps:

1. **Feedback.** The previous frame is redrawn into a new half-float buffer through the preset's transform shader: zoom, rotation, swirl, kaleidoscope fold, vortex twist or fluid advection, plus a hue rotation. It is multiplied by the trail decay.
2. **Deposit.** The preset's geometry (ribbons, spirals, polygons, stars) is added into that buffer with intensity ∝ dt.
3. **Present.** A soft tone curve, `1 − e^(−x·exposure)`, then sRGB gamma, to the screen.
4. **Head.** The same geometry is drawn once more directly onto the screen at fixed intensity.
5. **Swap.** The two buffers swap roles.

### Frame-rate independence

Every per-frame factor is an exponential of the frame time:

```text
decay(dt) = 0.5^(dt / halfLife)        zoom(dt) = e^(rate · dt)        deposit(dt) = rate · dt
```

Applying the dt factor N times equals applying it once for N·dt, exactly. A trail therefore lasts the same number of *seconds* at 60, 120 or 144 Hz; this is tested to 1e-12 for 30–240 Hz. Rotations, swirls and advection also scale with dt inside the shaders.

**A bug found during development.** The first version added geometry at a fixed intensity every frame. A lingering line then settles at a brightness of deposit·halfLife/(ln2·dt), which is 24× brighter at 120 Hz than at 5 Hz. On a 120 Hz monitor everything would have washed to white. Scaling the deposit by dt fixes the trails. Drawing the current geometry separately (the head pass) keeps the lines themselves crisp at any refresh rate.

### Audio clock

Preset state (phases, rotations, shape switching) advances by one analysis hop per analysis frame, as in Morph. Only the feedback blending uses display time.

### Shared drives (`COMMON_MAPPINGS`)

| Drive | Sources | Response |
|---|---|---|
| bass | low pulse (max of sub-bass and bass pulse) + 0.2 × bass level | release 80 ms |
| mid | 0.6 mid pulse + 0.4 low-mid pulse + 0.2 mid level | release 100 ms |
| high | presence and brilliance pulses + 0.15 × brilliance level | sqrt curve, release 80 ms |
| body | sustained band levels (bass, mid, overall) | attack 100 ms, release 600 ms |
| level | 0.25 level + 0.85 low pulse + 0.3 level pulse | release 120 ms (a quarter beat at 124 BPM) |
| kick | onset | — |
| hue | spectral centroid (log position) | attack 250 ms, release 800 ms |
| balance, width | stereo features | slow |

Beat-driven parameters use the **pulse** features rather than the adaptive levels. On mastered music the levels stay near 1 the whole time; see "Reactivity" in CHANGELOG 0.3.0 and docs/DSP.md.

## Alchemy-inspired

Flowing luminous ribbons and spirals leaving coloured trails.

**Liquid Ribbons.** Three closed Lissajous ribbons (frequency ratios 3:2, 1:2 and 2:3).
- **Shape from the spectrum.** Each ribbon's radius follows the spectrum as you walk along it, mirrored low → high → low so the curve closes without a seam: r(s) = R·(1 + 0.6·(spec(m(s)) − ½)). The ribbons bulge where the music has energy.
- **Feedback.** Trails flow outward with a swirl; zoom 0.06 + 0.7·bass, so kicks push the trails out. Stereo balance turns the flow, and fuller music lengthens the trails (half-life 0.3–0.8 s).
- **Motion and colour.** The mids set how fast the curves evolve. The level sets brightness and width; the centroid sets hue.

**Spiral Elixir.** Five logarithmic spiral arms, r = r₀·e^{gθ}, with g chosen so each arm reaches r_max = 0.75 + 0.3·bass.
- **Shape from the spectrum.** Arm width follows the spectrum along its length: bass at the core, treble at the tips.
- **Feedback.** A vortex: rotation ∝ 1/(0.25 + r), so the inner image turns faster, plus an inward pull. This differential rotation is a nonlinear map, which is why the trails wind into the centre rather than simply spinning.
- **Motion.** The mids and bass drive the spin.

## Battery-inspired

Radial symmetry, rotating polygons, sharp pulses and rhythmic shape changes.

**Polygon Pulse.** Six concentric rotating polygons.
- **Rings.** Ring j pulses with band j (sub-bass innermost): r_j = (0.12 + 0.125j)(1 + 0.32·pulse_j), which is always on screen. Rings rotate in alternating directions at a speed set by the mids.
- **Rhythmic shape changes.** On strong onsets (≥ 0.75) the shape switches among triangle, square, pentagon, hexagon and octagon. A switch is never more frequent than once per second and always goes to a different shape. The palette jumps with each switch.
- **Feedback.** A kaleidoscope: the previous frame is mirror-folded into 2·sides wedges and pushed outward (zoom 0.25 + 1.4·bass). Short trails (half-life 0.12–0.37 s) give sharp echoes. Onsets add a radial flash through the flash limiter.

**Star Tunnel.** A star polygon with alternating outer and inner radii.
- **Star.** The outer radius grows 45% with the bass, and the treble sharpens the points. The star's point count (5–9) switches on strong onsets, at most once every 1.5 s. Spokes reach out with the treble.
- **Feedback.** A strong outward zoom with rotation (0.6 + 2.2·bass), so each star becomes a receding ring of the tunnel. Kicks rush the tunnel forward. The hue rotates continuously, giving rainbow walls.

## Ambience-inspired

Soft colour fields, atmospheric turbulence and fluid-like drift. These presets have no geometry, and their mappings use slower attack and release than the punchy collections.

**Aurora.** Curtains built from domain-warped fractal noise (fBm), stretched vertically.
- **Temporal smoothing.** Each frame is mixed with the slightly upward-drifting previous frame using the exact exponential (half-life 0.18–0.43 s; quiet passages smear more). Motion stays soft.
- **Mappings.** Level sets the flow speed and the mids the turbulence. The bass lifts a ground glow, the centroid sets the colour, and the treble adds sparse, jittered twinkles.

**Nebula.** Fluid-like drift.
- **Advection.** The previous frame is advected by semi-Lagrangian back-tracing along a curl-noise velocity field, v = (∂ψ/∂y, −∂ψ/∂x). This field is divergence-free, so colour swirls and folds like an incompressible fluid without bunching up or draining away.
- **Colour sources.** Three soft Gaussian sources orbit (speeds set by bass, mid and treble) and inject light in proportion to those drives. Injection is ∝ dt, so it is frame-rate independent. Trail half-life is 0.9–2.1 s.

## Tests (`apps/desktop-electron/test/phase3.test.mjs`)

- Decay and zoom are exactly frame-rate independent (30–240 Hz).
- Strip geometry: exact width, correct normals, and closed strips join.
- Ribbons: closed, on screen, and bulging with the spectrum.
- Spirals: logarithmic (constant radius ratio), r₀ → r_max, and widening with the spectrum.
- Rhythm switching: ignores weak onsets, respects the refractory time, and always changes shape.
- Polygon rings: exactly +32% at a full pulse and always inside the unit circle. The star's radii follow bass and treble.
- **Gate:** on frames recorded from the real service playing the dense mix, every collection's main drive is measurably larger just after kicks than between them:

| Drive | Beat contrast |
|---|---|
| ribbon trail push | 0.22 |
| low polygon rings | 0.022 (radius units) |
| tunnel rush | 0.70 |
| brightness | 0.19 |

  The polygon shape also changes 7 times in 7.5 s, within the one-per-second limit.

## What I could only check by eye

I rendered all six presets in the real app on software WebGL against the dense mix. Two problems were found and fixed that way:

- **Washed-out ribbons.** This was the frame-rate emission bug above.
- **Aurora's treble sparkles.** They lined up on a visible grid and were far too dense, because the constant hi-hat bed kept them maxed. They are now jittered and sparse.

Because my environment renders at about 5 FPS, the look of the trails at 120 Hz depends on the frame-rate-independence maths above, which is tested. It has not been seen by me on real hardware.
