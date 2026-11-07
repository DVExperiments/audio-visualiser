# DSP reference (v0.9)

Every formula here is implemented in `libs/dsp-core` and checked in `tests/DspCore.Tests`. Levels are relative to digital full scale, |x| = 1.0. Results quoted as "measured" come from the test suite.

## Signal path

```text
WASAPI shared-mode mix format (float32 / PCM16/24/32, any rate, 1–8 ch)
  → stereo float L, R            (Core/Buffers.cs: SampleConverter)
  → lock-free SPSC ring          (capture thread never blocks)
  → FeatureExtractor, every hop  (analysis thread)
  → NDJSON frame → Electron main (validated) → renderer
```

**Channels.** Mono devices give L = R. Stereo is used as is. For 5.1 and 7.1 (standard WAVEFORMATEXTENSIBLE speaker order assumed), the fold-down follows ITU-R BS.775 without normalisation: L = FL + 0.7071·FC + 0.7071·(BL [+ SL]), and R likewise. LFE is omitted, as BS.775 does. Other channel counts use the first two channels.

**Stereo is never averaged in the time domain.** `(L+R)/2` cancels opposite-phase content completely; the opposite-phase test proves this cancellation and shows the analyser does not suffer it. Spectra are computed per channel and the **powers** are averaged: P[k] = (P_L[k] + P_R[k]) / 2. Level, stereo features and zero-crossings use the separate channels.

## Framing

| Parameter | Default | At 48 kHz | At 44.1 kHz |
|---|---|---|---|
| Main FFT N | 2048 | 23.44 Hz bins, 42.67 ms window | 21.53 Hz, 46.44 ms |
| Low-band FFT | 4096 | 11.72 Hz bins, 85.33 ms window | 10.77 Hz, 92.88 ms |
| Hop | 512 | 93.75 frames/s (10.67 ms) | 86.13 frames/s (11.61 ms) |

The hop is fixed in samples, so frame rate and bin width scale with the device rate. Every frame carries `sr`, and the `analysis` message carries the derived values. The analyser has been tested at 16, 44.1, 48, 88.2 and 96 kHz.

## Level

```text
RMS  = sqrt( (1/N) Σ x[n]² )            over the main window (N = 2048), per channel
Rms  = sqrt( (E_L + E_R) / 2N )         channel-mean power
dBFS = 20·log10( max(RMS, 1e-6) )       floor −120 dBFS
```

With this definition a full-scale sine reads **−3.01 dBFS** (measured: −3.01). Some meters use the AES17 convention instead, where a full-scale sine reads 0 dBFS; that convention would add 3.01 dB to every reading.

**Finite-window ripple.** RMS over N samples that do not hold a whole number of cycles fluctuates. The relative error in mean square is bounded by 1/(N·|sin ω|), where ω = 2πf/fs. For 100 Hz at 48 kHz that bound is 3.7%, or about 1.9% in RMS; the measured deviation was 1.7%. Above about 300 Hz the ripple is under 0.6%. The display smoothing hides it.

**Peak** is the largest |x| among the hop's new samples. It is a sample peak, not a true (inter-sample) peak, and `clip` is set when it reaches 1.0.

## Spectrum

The window is a periodic Hann, w[n] = 0.5·(1 − cos(2πn/N)). Its exact constants are verified for N = 512…8192:

| Constant | Value |
|---|---|
| S1 = Σw | N/2 (coherent gain 0.5) |
| S2 = Σw² | 3N/8 (power gain 0.375) |
| ENBW = N·S2/S1² | 1.5 bins |

X[k] = Σ x[n]·w[n]·e^(−j2πkn/N). The FFT is checked against a direct DFT to within 1e-9·N, and against Parseval's theorem.

One-sided spectra use k = 0 … N/2, with c_k = 2 for 0 < k < N/2 and 1 at DC and Nyquist:

```text
Amplitude[k] = c_k · |X[k]| / S1                  sine of peak A centred on bin k → A
Power[k]     = c_k · |X[k]|² / (N · S2)           Σ_k Power[k] = mean square of the windowed signal
```

The second line is an exact identity for real input: Σ_k Power[k] = Σ(x·w)² / S2, verified to 1e-10. As a result:

- A sine of amplitude A sums to A²/2 at **any** FFT size. Measured: within 1% off-bin and 1e-9 on-bin, for N = 1024–8192.
- White noise of variance σ² sums to σ² at any FFT size. Measured: within 8% from a single frame, as expected for 512–4096 random bins.
- The worst-case Hann scalloping loss is −1.42 dB, which the peak-amplitude test allows for.

## Bands

Band power is Σ Power[k] over the band, with fractional weighting at the edges. Bin k covers [(k−½)Δf, (k+½)Δf], and a bin straddling an edge contributes in proportion to its overlap. Contiguous bands therefore add up exactly to the total; this is tested. Bands are reported as 10·log10(power) in dB, with a floor of −120.

| Band | Range (Hz) | Resolution used |
|---|---|---|
| Sub-bass | 20–60 | 4096 FFT |
| Bass | 60–250 | 4096 FFT |
| Low mid | 250–500 | 2048 FFT |
| Mid | 500–2000 | 2048 FFT |
| Upper mid | 2000–4000 | 2048 FFT |
| Presence | 4000–8000 | 2048 FFT |
| Brilliance | 8000–20000 | 2048 FFT; capped at Nyquist; marked unavailable when fs/2 ≤ 8 kHz |

**Why two FFT sizes.** At 2048 points the sub-bass band is under two bins wide, and the Hann main lobe (±2 bins = ±47 Hz) smears a 70 Hz kick into it. In a test with 40 Hz and 120 Hz tones, band error was **0.87 dB with 2048 alone and 0.05 dB with the 4096 low FFT**. The cost is that the low-band window is centred about 21 ms further in the past. Set `LowFftSize = 0` to disable this, or 8192 for 5.9 Hz bins and 170 ms windows.

**Caveat.** Bands partition bins, not energy. A tone within about 2 bins of an edge leaks into the neighbouring band; for a 440 Hz tone, the mid band reads −49 dB. This is inherent to windowed FFT band sums.

The **log spectrum** has 48 bands with geometric edges, 20 Hz → min(20 kHz, Nyquist), so edge[i] = 20·1000^(i/48). Its values are band powers using the same method; bands below 250 Hz use the 4096 FFT. Very narrow low bands can be smaller than a bin, so their values are calibrated fractions of a bin's power. Pink noise (equal power per octave) displays flat on this scale.

## Spectral shape

These are computed on the 2048-point channel-mean spectrum over 20 Hz … min(20 kHz, Nyquist). In silent frames they are undefined and reported as 0; consumers must check `silent`.

| Feature | Definition | Verified |
|---|---|---|
| Centroid | Σ f_k·A_k / Σ A_k (amplitude-weighted) | 440 Hz tone → 440 ± 5 Hz; white noise → 10.0 kHz |
| Flatness | exp(mean ln P_k) / mean P_k | see below |
| Rolloff | lowest f where the cumulative power reaches 85% | white noise → 17.0 kHz (theory 17.0 kHz) |
| Zero-crossing rate | sign changes / (N−1), averaged over L and R | 2f/fs for a sine, within 2% |

**Flatness check.** For white noise each bin's power is exponentially distributed, so E[ln P] = ln E[P] − γ (γ = 0.5772), giving a flatness of e^−γ = **0.561** for one channel. Averaging two independent channels' powers gives a Gamma(2) distribution, so the expected flatness is e^(1−γ)/2 = **0.763**. Measured: **0.563** (mono) and **0.764** (independent stereo). Matching both predictions checks the spectrum's scaling, stereo handling and statistics at once.

## Stereo

All computed over the main window:

```text
E_L = ΣL²,  E_R = ΣR²,  E_LR = ΣLR,  M = (L+R)/2,  S = (L−R)/2
balance     = (E_R − E_L) / (E_R + E_L)       −1 left only … +1 right only
correlation = E_LR / sqrt(E_L·E_R)            +1 mono, 0 uncorrelated, −1 opposite phase; 0 if a channel is silent (undefined)
width       = E_S / (E_M + E_S)               0 mono, 0.5 one channel only, 1 opposite phase
```

## Onsets

The brief's linear flux is computed and sent unchanged as `flux`:

```text
flux[t] = Σ_k max(0, A_t[k] − A_{t−1}[k])
```

Onset detection uses log-compressed flux instead:

```text
fluxLog[t] = mean_k max(0, ln(1 + γA_t[k]) − max_{|j−k| ≤ w_k} ln(1 + γA_{t−1}[j])),   γ = 100
w_k = max(1, ⌈k·(2^{50/1200} − 1)⌉)        (± 50 cents around bin k)
```

Linear flux is dominated by loud low-frequency bins and scales with playback volume. Log compression is standard practice (see Böck et al. on onset detection) and makes transients in quiet passages and high frequencies count. Using the mean over bins, rather than the sum, makes the value independent of FFT size.

**SuperFlux vibrato suppression (v0.9).** Each bin is compared with the *maximum* of the previous frame over ±50 cents around it (Böck & Widmer, "Maximum filter vibrato suppression for onset detection", DAFx 2013). Pitch wobble moves energy into neighbouring bins, which plain flux counts as new energy. Real attacks raise many bins at once, so they still register. SuperFlux runs on a log-frequency filterbank; on this linear FFT grid the filter therefore widens in proportion to frequency, because a vibrato of fixed cents spans more bins at higher harmonics.

Measured on vibrato that comes and goes, with 8 harmonics, over 10.5 s with no real onsets:

| Vibrato | Plain flux | Fixed ±1 bin | ±50 cents |
|---|---|---|---|
| ±15 Hz | 13 false onsets | 1 | **0** |
| ±30 Hz | 18 false onsets | 22 | **0** |

The fixed ±1-bin filter alone is worse on deep vibrato, which is why it widens with frequency. Impulse timing (10/10) and dense-mix kicks (16/16) are unchanged.

The adaptive threshold uses the last ≈1 s of frames (H):

```text
threshold = median(H) + 3 · 1.4826 · MAD(H) + 0.002
```

Frame t−1 is reported at frame t when all of these hold:
- its flux exceeds the threshold
- it is a local maximum
- at least 60 ms have passed since the last onset (refractory period)
- the frame is not silent

This adds exactly one hop of lag (`onsetLagFrames`). `confidence` = clamp((flux − threshold) / threshold, 0, 1) is a margin, not a probability. **An onset is a transient, not a guaranteed beat**; beat and tempo tracking come later.

Measured results:
- an impulse train every 500 ms gives 10 of 10 onsets, each 22–31 ms after its impulse
- a steady sine gives at most 1 onset (the start)
- 10 s of steady white noise gives 0 false onsets

## Pulses (v0.3)

`bandsPulse[b]` and `levelPulse` measure how far a level currently sits above its own recent typical level. This is the part of the music that changes, and it is what visuals should follow for the beat.

```text
fast    = attack/release smoothing of the level in dB (attack 5 ms, release 70 ms)
typical = max( median of the level in dB over the last 1.5 s,  0.4 s exponential average )
pulse   = clamp((fast − typical − 1 dB) / 8 dB, 0, 1)        0 below −85 dB
```

Working in dB makes the pulse independent of loudness and band width. The baseline went through several versions, each checked by tests:

| Baseline | Problem |
|---|---|
| 1.2 s exponential average | after silence it needed ~3 s to catch up, holding pulses at 1 |
| median, 1.5 s | ignores kicks, but held a "pulse" for 0.75 s after a bass note changed band |
| median, 1.0 s | worse: 13/16 kicks |
| **max(median 1.5 s, 0.4 s average)** | the median ignores kicks; the short average (snapped to within 24 dB) absorbs sustained changes in ≈ 0.4 s |

**Why it was needed.** On a mastered, soft-clipped mix (the `denseMix` test signal) the adaptive bass level reads **0.81 ± 0.09**, pinned high, matching the 0.93 in your v0.2 diagnostics. On the same mix the pulse behaves as follows:

| Test | Result |
|---|---|
| Bass pulse fires on kicks | 14/16 |
| Pulse or onset fires on kicks | **16/16** |
| Pulse between kicks | 0.05 |
| Steady tone | exactly 0 |
| +12 dB step | 1.0, back to 0 within 1 s |
| Silence | 0 |

The two kicks the pulse misses fall in a bar where the bass line plays inside the bass band and the soft clipper squashes the kick against it. The kick genuinely adds little low-end energy there; the broadband onset detector catches those.

## Smoothing

The attack/release smoother is exact for variable time steps:

```text
α = 1 − exp(−Δt/τ),   y ← y + α·(target − y),   τ = attack if target > y, else release
```

After one time constant a step reaches 63.2%, whatever Δt is. This is tested at 1/1000, 1/93.75, 1/60 and 1/20 s to 1e-12, and the C# and JavaScript versions are tested identically. In v0.1 the service sends unsmoothed features, and all smoothing is display ballistics in the renderer. The mapping engine (Phase 4) will expose attack and release per mapping.

## Normalisation

`bandsNorm` and `level` are 0–1 values for driving visuals. Each band tracks its own ceiling: the ceiling jumps instantly to a new peak, decays at 3 dB/s, and never drops below −50 dB. The normalised value is:

```text
C    = max(own ceiling, loudest band's ceiling − 20 dB)
norm = clamp((x − (C − 30 dB)) / 30 dB, 0, 1)
```

The coupling term matters. Without it, a band that contains only leakage 40 dB below a pure tone was stretched to 0.96. With it, that band reads 0.34, while a real band 12 dB below the dominant one still reaches 1.0. Microphone noise-floor calibration is planned (see CHANGELOG).

## Gap fill (loopback silence)

WASAPI loopback stops delivering packets while nothing is playing. To keep analysis running in time, the analysis thread feeds zeros up to "now − 20 ms" once no audio has arrived for the **gap threshold**. Frames that include filled samples carry `gap: true`, and the UI says "nothing playing". These frames are never presented as captured audio.

Loopback capture is *polled* rather than event-driven, so packets arrive in bursts 30–65 ms apart. The threshold is therefore adaptive: 3 × the longest recent packet interval (a decaying peak, with roughly 10 s of memory), clamped to 150–600 ms. If gap-fill has run and real audio then arrives for an overlapping stretch, the overlap is trimmed, so time is never counted twice. *Stats* reports `overlapFramesDropped` and `gapFillThresholdMs`.

v0.1 used a fixed 60 ms threshold. Late polls were mistaken for silence and their time was counted twice, giving about 150 frames/s on Windows plus false onsets from the zero splices. Real-time regression tests now reproduce that delivery pattern (`SessionTests`).

## Timestamps and latency

`t` is the estimated capture time of a frame's last sample, on the service's monotonic clock. It is calculated as the arrival time of the newest block minus the samples queued after the frame's end. `wall` is the same instant in Unix milliseconds.

The renderer's *Capture→draw* figure is Date.now() − wall at draw time. It **excludes** the Windows audio engine's buffering before packets arrive (typically 10–30 ms in shared mode) and the display's scan-out after drawing. The perceptual latency is therefore larger than this figure, and this is not a guaranteed latency.
