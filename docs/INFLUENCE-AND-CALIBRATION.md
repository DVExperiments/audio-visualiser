# Influence controls and calibration (v0.12)

## Influence (U, or the Influence button)

Three independent controls, each 0–200 %. Each acts through a separate path, so any combination is possible: for example extreme deformation with subtle colour, or gentle movement with intense colour.

| Control | Mechanism | Formula |
|---|---|---|
| **Sound → shape** | scales the *audio-driven part* of every shape drive (bass, mid, high, kick, lean/balance) around its resting value | v′ = r + g·(v − r), r = the drive's value with no audio; clamped to [min, max] widened by g |
| **Movement** | a time scale on each visualisation's own motion: phases, rotations, flows, zooms, trail decay, springs, particles, simulation steps | Δt′ = m·Δt (the audio analysis and drive smoothing keep real time) |
| **Colour intensity** | a colour grade after rendering, plus the same scaling as shape applied to the colour drives (level/glow, hue) | c′ = max(ℓ + s·(c − ℓ), 0)·(0.75 + 0.25·min(s, 1.6)), with ℓ the Rec. 709 luma and s the control value; bloom × (0.4 + 0.6·min(s, 1.6)) in Morph |

At 100 % everything is unchanged. Scaling never feeds back into a drive's smoother, so changes are instant and reversible. Shape at 0 % holds each drive at rest (no audio influence on geometry). Bars & Waves are measurements and ignore these controls.

**Measured on Morph** (`test/influence.test.mjs` and screenshots):

| Setting | Result |
|---|---|
| Sound → shape 30 % / 100 % / 200 % | bass deformation RMS 0.0074 / 0.0135 / 0.0409 |
| Colour 40 % vs 200 % | glow drive 0.17 vs 0.85; rendered saturation 21.5 % vs 92.5 % |

## Calibration (C, or Settings › Audio input › Calibrate…)

1. **Choose a source:** music/system audio, or microphone/environment.
2. **Quiet sample (microphone only):** 4 s of quiet, to measure the room noise.
3. **Typical sample:** 10 s of typical sound.
4. **Recommendations.** From the frames the wizard computes level percentiles (p10, p50, p95 of RMS dBFS), dynamic range (p95 − p10), crest factor, onset rate and median flatness. It then recommends:

| Setting | Rule | Why |
|---|---|---|
| Input gain | −20 dBFS − typical median (without current gain), in [−12, +30] dB | puts typical sound in the range the analysis is tuned for; applied before analysis, so silence detection, adaptive levels and pulses all benefit |
| Noise floor (silence) | mic: room p95 + 4 dB, at least 8 dB below the softest typical sound; **halfway between the two when they are less than 12 dB apart**; music: −70 dBFS | a microphone's room noise must not count as sound; music gaps are digital silence |
| Beat sensitivity (pulse range) | 3.5 + 0.5·dynamic range dB, in [5, 12] | compressed music needs a narrow range to show its beats; wide dynamics need a broad one |
| Smoothing | 1.4× if onsets > 5/s; 1.6× for noise-like ambience with few onsets; 0.85× for compressed music with a beat; else 1× | readable motion for each kind of sound |

Every recommendation is shown with its reason before you apply it. Settings are **saved per input** (each device, and system audio vs microphone), and applied automatically when you switch. They live in the audio service (gain, noise floor, pulse range) and the renderer (smoothing). The Diagnostics panel shows the values the service has confirmed.

**Example.** On the dense mastered test mix the wizard measured −12.3 dBFS, 3.3 dB dynamic range and 8 onsets/s, and recommended −8 dB gain, a 5 dB pulse range and 1.4× smoothing.

**Found by testing.** When a microphone's softest typical sound is only about 9 dB above the room, the "4 dB above room" and "8 dB below the softest sound" rules cannot both hold. The first version took the minimum, which put the threshold 0.5 dB above the noise, so the room would have flickered between sound and silence. It now picks the halfway point and says so.
