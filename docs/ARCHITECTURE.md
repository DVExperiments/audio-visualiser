# Architecture (v0.20)

## Overview

```text
┌──────────────────────── AudioCapture.exe (.NET 10) ────────────────────────┐
│ WASAPI capture thread ──► SPSC ring ──► analysis thread ──► protocol writer │──stdout NDJSON──┐
│ (NAudio, event-driven)    (lock-free)   (FeatureExtractor)  (drop-oldest)   │                 │
│ control thread: commands, device notifications, recovery ◄──────────────────│◄─stdin NDJSON───┤
└─────────────────────────────────────────────────────────────────────────────┘                 │
┌──────────────────────────────── Electron ─────────────────────────────────────────────────────┤
│ main: ServiceBridge (spawn, validate, restart) · settings · windows/displays ◄────────────────┘
│   │ IPC (validated, file:// sender only)
│ preload: window.studio (explicit API, no ipcRenderer exposure)
│ renderer (sandboxed): FeatureStore ─► active visualisation (initialize/update/render/resize/dispose)
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

The DSP library (`libs/dsp-core`) has no dependencies and knows nothing about devices, IPC or rendering. Renderers know nothing about devices; they read only from `FeatureStore`.

## Decisions and trade-offs

**Stdin/stdout NDJSON for the service link** rather than named pipes, sockets or shared memory. It needs no ports or firewall prompts, the child dies with its parent, and it is easy to inspect and test; I ran the real service here and parsed its output. The cost is JSON overhead: about 8.4 KB per frame (mostly the 2 × 512 waveform samples), roughly 790 KB/s at 94 frames/s. That is trivial for a local pipe. If profiling ever shows it matters, the frame format can move to a binary layout behind the same protocol version check.

**Analysis in the service, not the renderer.** This keeps DSP independent of the GPU and UI, as the brief requires. A stalled renderer cannot stall capture: the writer drops the oldest queued frame and counts it, and the renderer has its own bounded 64-frame queue.

**My own FFT instead of Math.NET Numerics.** It is about 80 lines, allocation-free, and verified against a direct DFT and Parseval's theorem. Math.NET would add a dependency for one function.

**Two FFT sizes.** See [DSP.md](DSP.md#bands).

**NAudio.Wasapi only.** The NAudio meta-package pulls in WinForms and would require the Windows Desktop runtime; the WASAPI package alone does not.

**Canvas 2D for Bars & Waves, WebGL2 via Three.js for Morph.** A canvas keeps the first context type it is given, so the shell creates a fresh canvas for each preset. Each preset declares `contextType`.

**No bundler, by measurement.** In v0.1 I expected to need Vite for Three.js. In v0.2 I tested the alternative: native ES modules served from `file://`, plus an **import map** so Three's add-ons can import the bare name `"three"`. This works in Electron 44's sandboxed renderer.
- The import map is the only inline script, and the CSP allows it by its exact SHA-256 hash rather than `'unsafe-inline'`. `test/csp.test.js` fails if the map and hash drift apart, or if any other inline script appears.
- Benefit: no build step, so the code that runs is the code that is tested.
- Trade-off: no tree-shaking. That is irrelevant for a local desktop app.
- If a dependency ever requires a bundler, Vite can be added without changing module code.

Classic-script collections (Bars & Waves) and module collections (Experimental) share one registry. `app.js` starts on `DOMContentLoaded`, by which time module scripts have registered.

**Explanations from the same source as the pixels (v0.5).** Wave-and-warp presets are data; `computeWarp()` turns the data plus the current drives into every number the shader receives, and `explainWarp()` turns the same data into TeX equations whose live values read that object. Hand-built presets have explanations in `explain/specs.mjs`, and mapping formulas are generated from the running mapping specs. Tests typeset every formula with KaTeX and compare the panel's numbers with the shader's. `npm run docs:maths` renders the same specs to `docs/PRESET-MATHS.md`.

**Simulation clocked by audio.** Physics models advance one analysis hop per analysis frame, not per display frame. Results are therefore reproducible from the frame sequence and independent of monitor refresh rate.

**Framework-dependent publish.** `build-service.ps1` produces `AudioCapture.exe` plus DLLs, which use the .NET 10 runtime installed with the SDK. A self-contained build for distribution belongs to Phase 6.

## Threads in the service

| Thread | Does | Must never |
|---|---|---|
| WASAPI capture (NAudio) | convert to stereo float, write to ring | wait on locks, I/O or IPC |
| analysis | drain ring, run DSP every hop, gap-fill silence | wait on the writer (drop-oldest queue) |
| protocol writer | write NDJSON to stdout | — |
| control | commands, device events, start/stop, retries | run on a COM notification thread |

All session changes happen on the control thread, so start/stop/restart cannot race. Device notifications are debounced for 300 ms, because Windows often sends several events per change.

## Failure handling

| Event | Behaviour |
|---|---|
| Nothing playing (loopback) | silence gap-fill; frames flagged `gap` |
| Default device changed, following default | restart on the new default |
| Device unplugged or disabled | status `recovering`, retries at 0.5, 1, 2, 4, 5 s; restarts as soon as Windows reports the device again |
| Device invalidated (sleep/resume, format change) | NAudio raises `RecordingStopped` with an error → same recovery |
| Service crash | Electron restarts it with backoff (0.5 s doubling to 5 s) and resends the last capture request |
| Malformed message either direction | dropped and logged, never forwarded |
| Renderer exception | caught per frame and shown in Diagnostics; the loop continues |

## Security

- Renderer: `contextIsolation`, `sandbox`, no Node integration, strict CSP (`script-src 'self'`, no network), navigation and new windows blocked, every permission request denied. The renderer never touches audio devices.
- IPC: only `file://` senders are accepted; capture requests are whitelisted and rebuilt (`protocol.js`), and settings patches can only touch `collection`, `preset` and `ui`.
- Service input: commands are length-limited, JSON-validated and whitelisted.
- No network access is used at run time.

## Review of the brief: risks and recommendations

1. **Exclusive-mode and protected audio.** Loopback captures the Windows shared-mode mix. Apps using exclusive mode or ASIO bypass it, and some DRM paths may deliver silence. This should be documented to users rather than worked around.
2. **Loopback is silent while idle.** This is handled with flagged gap-fill.
3. **Bass resolution vs latency.** A 2048-point FFT is too coarse for 20–60 Hz. Multiresolution is used (above); the trade-off is the low-band window's extra delay.
4. **Mono summing cancels opposite-phase content.** This is avoided by power-domain combination, and tested.
5. **Latency promises.** The app reports a measured pipeline figure and states what it excludes.
6. **Spatial audio and multichannel.** The 5.1/7.1 fold-down assumes standard speaker order, because NAudio 2.2.1 does not expose the channel mask. A future version can read the mask through raw COM.
7. **Visual intensity.** A flash limiter (WCAG 2.3.1: at most 3 flashes per second, reduced amplitude) is on by default. Every future collection must route flashes through it.
8. **Stack weight.** Electron plus .NET means two runtimes. The alternative of Chromium's own loopback capture inside Electron cannot select an output device, so the brief's stack is the right call.

## Roadmap

| Phase | Status |
|---|---|
| 0 Architecture proof | Passed on your Windows machine (v0.1) |
| 1 Correct DSP | Built and tested (38 C# tests); loopback timing bug fixed in v0.2 |
| 2 First MVP | Done; confirmed on your RTX 4080 (120 FPS, 1.3 ms geometry). Reactivity reworked in v0.3 |
| 3 Classic collections | v0.3 confirmed on your hardware; v0.4 reworks them toward the WMP character (true black, schemes, program cycling, waveforms, Water/Swirl) |
| Your feature list | Batch 1 (v0.11): shuffle, transitions, favourites, collections, controls. Batch 2 (v0.12): influence controls, calibration. Batch 3 (v0.13): full-screen options and a hidden-menu mode with M and bottom-edge reveal. Feature list complete |
| 4 Advanced mode | Mapping editor UI over the existing mapping engine, versioned JSON presets, import/export, saving modified presets |
| 5 Experimental expansion | Organism, Crystal, Sound Sculpture, Singularity |
| 6 Release | Installer/portable build, long-run soak tests, accessibility, signing |
