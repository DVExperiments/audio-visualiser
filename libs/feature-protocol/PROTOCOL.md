# Service protocol, version 1

Newline-delimited JSON over the service's stdin (commands) and stdout (messages). stderr is free-form diagnostics and never contains audio. Validation on the Electron side lives in `apps/desktop-electron/src/main/protocol.js`; a message that fails validation is dropped.

## Commands (app → service)

| Command | Fields | Effect |
|---|---|---|
| `start` | `source`: `loopback` \| `input` \| `synthetic`; `deviceId` (optional, omitted = follow the Windows default); `signal` (synthetic only) | Stops any session and starts a new one |
| `stop` | — | Stops capture |
| `listDevices` | — | Replies with `devices` |
| `tune` | `gainDb` (−24…36), `silenceDb` (−100…−20), `pulseRangeDb` (3…16) | Input tuning applied before analysis (v0.12); replies with `tuning` |
| `ping` | — | Replies with `pong` |
| `shutdown` | — | Stops and exits (closing stdin does the same) |

Signals: `sine100`, `sine440`, `sine1000`, `noise`, `impulses`, `leftOnly`, `antiphase`, `sweep`, `beat`, `denseMix`, `lissajous` (v0.18).

## Messages (service → app)

**hello** `{protocol, version, t, unixAtStartMs, runtime}`. Sent once at start. The app refuses a mismatched `protocol`.

**devices** `{render: [{id, name, isDefault}], capture: [...], signals: [...]}`. Sent at start, on request, and after any device change.

**status** `{state, source?, requestedDeviceId?, deviceName?, deviceId?, format?, channels?, message?}`, where `state` is `starting` | `running` | `recovering` | `stopped`.

**analysis** `{sr, fftSize, lowFftSize, lowCrossoverHz, hop, frameRate, binHz, windowMs, silenceThresholdDb, onsetLagFrames, bands: [{name, lo, hi, available}], logEdges: [49 Hz values]}`. Sent at the start of every session.

**frame**, about 94 per second. All levels are relative to full scale; see docs/DSP.md for definitions.

| Field | Meaning |
|---|---|
| `seq`, `t`, `wall` | sequence number; capture time of the last sample (service ms); the same instant in Unix ms |
| `sr` | sample rate |
| `silent`, `clip`, `gap`, `synthetic` | below −70 dBFS; sample peak ≥ 1.0; includes gap-filled silence; simulated source |
| `nonFinite`, `droppedInput` | NaN/Inf samples replaced with 0; input frames dropped by a full ring buffer |
| `rms` [L, R, mean], `dbfs` [L, R, mean] | RMS over the 2048-sample window; dBFS = 20·log10(RMS) |
| `peak` [L, R] | sample peak over the hop |
| `level` | adaptive 0–1 overall level |
| `bands` [7] | dB power in subBass, bass, lowMid, mid, upperMid, presence, brilliance |
| `bandsNorm` [7] | adaptive 0–1 per band (coupled ceilings) |
| `bandsPulse` [7], `levelPulse` | 0–1: rise above the recent typical level (v0.3; optional for older services) |
| `spec` [48] | dB power in log-spaced bands (`logEdges`) |
| `flux`, `fluxLog` | linear spectral flux (brief's formula); log-compressed mean flux |
| `onset` {on, strength, threshold, confidence} | onset decision for frame `seq − onsetLagFrames` |
| `centroid`, `rolloff` | Hz; 0 when silent |
| `flatness` | 0–1; 0 when silent |
| `zcr` | zero crossings per sample |
| `balance`, `correlation`, `width` | stereo features |
| `waveL`, `waveR` [hop] | the hop's raw samples, rounded to 4 decimals; consecutive frames tile without gaps |

**stats** `{t, framesSent, framesDroppedIpc, inputFramesDropped, overlapFramesDropped, gapFillThresholdMs, managedMemoryMb}`, once per second.

**tuning** `{gainDb, silenceDb, pulseRangeDb}`: the tuning the service is now applying (after clamping).

**error** `{code, message}` with codes `badCommand`, `deviceEnumeration`, `internal`.

## Versioning

Any change to field meaning or units increments `protocol`. Adding fields does not.
