# Bars & Waves: what each view shows (v0.8 audit, v0.10 update)

Every analysis frame from the audio service carries the fields below. This table records where each one is shown. `test/barswaves.test.mjs` checks it against what the real service sends, so a new feature cannot go unshown.

| Field | Meaning | Shown in |
|---|---|---|
| `spec` (48 bands) | power per log-spaced band, dB | Instruments, Spectrum glow, **Analysis** (spectrogram), **Mashup** (polar spokes), **Circular spectrum** (v0.15), **Ridgeline** (v0.16), **Spectrum terrain** (v0.19) |
| `rms`, `dbfs` | RMS level per channel | Instruments meters (now with numbers), **Analysis** level history, **Mashup** side arcs, **VU meters** (v0.19) |
| `peak` | sample peak | Instruments meters (marker and number), **VU meters** PEAK lamps |
| `bands`, `bandsNorm` | 7 named bands, dB and adaptive 0–1 | Instruments bands panel; **Mashup** core bullseye |
| `bandsPulse`, `levelPulse` | rise above recent typical level: the beat | **Instruments** (band bars brighten on each pulse; v0.10, replacing white inner bars), **Analysis**, **Mashup** halos |
| `fluxLog`, `onset` | onset-detection function, threshold, decisions | **Analysis** (flux vs threshold, onsets marked), Instruments lamp with confidence, **Mashup** shockwaves |
| `centroid`, `rolloff` | spectral centre of mass, 85 % power point | **Analysis** timbre lines, **Mashup** needle (centroid). The Instruments spectrum markers were removed in v0.10 as distracting. |
| `flatness`, `zcr` | noisiness, zero-crossing rate | **Analysis** timbre panel |
| `balance`, `correlation`, `width` | stereo | Stereo field, Instruments, **Analysis** history, **Mashup** (core colour, turn direction) |
| `waveL`, `waveR` | raw samples | Oscilloscope, Instruments, Stereo field, **Mashup** ring and core, **Circular spectrum** ring, **Phosphor scope** (every sample, v0.18) |
| `flux` (linear), `seq`, `t`, `wall`, `sr`, `droppedInput` | technical | Diagnostics panel (D) |
| `silent`, `gap`, `clip`, `synthetic` | status | status bar; clip also in Instruments |

**Bold** marks what v0.8 added. Before the audit, the pulses, flux and threshold, flatness, zero-crossing rate and any history over time were not drawn anywhere, and centroid and rolloff only appeared as numbers in Diagnostics.

## Reading centroid and rolloff together

In bass-heavy music the centroid often sits far *above* the 85 % rolloff (for example 6.6 kHz against 234 Hz). This is not a contradiction. The rolloff counts **power**, which the loud bass dominates. The centroid uses **amplitude**, the standard definition, which gives quiet treble far more weight.
