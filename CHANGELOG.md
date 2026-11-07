# Changelog

## 0.20.3 — 2026-11-07

### Fixed
- **In the installed app, only Bars & Waves loaded.** Alchemy, Battery, Ambience and Experimental all showed "(failed to load)". electron-builder silently leaves out folders named `examples` inside libraries, and that is where three.js keeps its add-ons (`three/addons/…`: the effect composer, bloom and the full-screen pass used by the feedback engine). The archive held 0 of those files. They are now included explicitly.
- **My earlier packaged test missed it.** It only opened a Bars & Waves view, which uses none of those files.

### Added
- **`tools/verify-package.mjs` (`npm run verify:package`).** Starting from `index.html`, it follows every script, module, import-map entry, three.js add-on and its own imports, stylesheet and font, and checks each is inside the packaged `app.asar`. `package.ps1` runs it after every build (and so does the GitHub build), so a package missing anything fails the build instead of reaching testers.
  - On the broken build it reported the 8 missing add-ons and which module needed each.
  - After the fix: 109 reachable files, all present.
- **Verified in the packaged app:** a preset from every collection renders (Rainbow Mandala, Blue Starburst, Water, Particle Swarm, Spectrum terrain).


## 0.20.2 — 2026-11-07

### Fixed
- **Building from a fresh download failed at the JavaScript tests** (3 failures: "Cannot find package 'three'"). The zip leaves out the downloaded libraries (`node_modules`), and `package.ps1` ran the tests *before* the step that installs them. It now installs them first. `test.ps1` installs them if they are missing too. This also affected `Build Installer.cmd` and the GitHub workflow, which use the same script.
- **Verified from the shipped zip:** a fresh copy gave 111 tests with 3 failing (the same as the reported run); in the corrected order, 118/118 pass.


## 0.20.1 — 2026-11-07

Getting the installer to testers without PowerShell. Guide: docs/DISTRIBUTING.md.

### Added
- **GitHub builds the installer** (`.github/workflows/build-installer.yml`). Publishing a release on github.com makes GitHub's Windows machines run the tests, build the audio service and package the app. About 10–15 minutes later, the Setup and Portable .exe files are attached to the release page, ready to share. It can also be run by hand from the Actions tab. It uses only GitHub's own actions and the `gh` tool (no third-party actions), and signs automatically if certificate secrets are added.
- **`Build Installer.cmd`:** builds on your own PC by double-click. It unblocks the downloaded files, runs the build, and opens the folder with the installer when done, or stops with the error in red.
- **The build script checks for Node.js and the .NET SDK first,** and says where to get them in plain language.
- The README now opens with what testers need (just the Setup .exe), and how to get past the "Windows protected your PC" warning.

### Fixed
- electron-builder could try to publish to GitHub by itself when run there. It now always runs with `--publish never`, and the workflow attaches the files explicitly.

### Not possible here
The installer can't be built in this assistant's environment: the Windows audio service needs the NAudio library from NuGet, which isn't reachable from here. An installer without the service would not work, so none is included.


## 0.20.0 — 2026-11-06

**Phase 6, release readiness**, plus the Appearance options and one-panel-at-a-time behaviour you asked for. Release guide: docs/RELEASE.md.

### Release readiness
- **Installer and portable app.** electron-builder 26.18.0 builds an NSIS installer and a portable .exe, both via `scripts\package.ps1`.
  - The installer installs per user (no administrator prompt), lets you choose the folder, creates Start menu and desktop shortcuts, and includes an uninstaller.
  - The audio service is published self-contained as a single file, so users need no .NET. electron-builder was pinned to a release over two weeks old.
  - **Verified by building and running a packaged app** (Linux target, the same configuration). The bundled service was found in `resources/service-bin` and audio played with no development override.
- **Application icon:** an original design in the app's circular-spectrum style, at 16–256 px.
- **Code signing:** wired to `CSC_LINK` / `CSC_KEY_PASSWORD`. Without a certificate the builds are unsigned, and the script says so. Certificate steps are in docs/RELEASE.md.
- **Single instance:** a second launch focuses the running window. Testing found that the second instance still began its start-up before quitting; it now stops before doing anything.
- **Log file:** `logs/app.log` in the app data folder, rotating at 1 MB, with at most two files. It records start-up, service messages, errors and uncaught exceptions. Settings shows the version and has **Open log folder**.
- **Long-session stability**, three layers:
  - **C# analyser soak** (`dotnet run -c Release -- --soak N`): 10 simulated minutes, memory flat (0.60–0.61 MB), 0 non-finite frames, 22× real time.
  - **JavaScript pipeline soak** (`npm run soak`): 2 simulated hours through the feature store, mappings, music detector, Auto mode, and the Morph, swarm, VU and terrain models. Heap 5.45 → 5.53 MB after GC, 0 non-finite, 59 automatic switches.
  - **Real-app soak mode** (`AUDIOVIZ_SOAK=1`): 4.5 minutes across 9 presets in all collections, with transitions. Always exactly 1 canvas (no leaked GPU contexts), and memory varying with the preset with no upward trend.
- **Known:** the analyser allocates about 3 MB/s of short-lived arrays; .NET's generation-0 collector absorbs this and memory stays flat. Recorded as a future optimisation.

### Appearance (Settings › Appearance)
- **Style:** *Classic* (the Windows Media Player look) or *Modern* (flat surfaces, rounded cards, a clean accent colour, Segoe UI).
- **Mode:** *Dark* or *Light*, with either style. Classic Light takes after WMP 9's silver skin; Modern Light is clean white.
- The style changes instantly, with no reload. The visualisations keep their own looks.

### Panels: one at a time, everywhere
- **Every panel now closes the others:** Settings, Influence, Favourites, the shuffle menu, **How it works** and **Diagnostics**; Calibration closes all of them. Verified with keys: Settings → How it works → Diagnostics → Favourites, with exactly one panel open at each step.

### Tests
JavaScript 118 (new: 2 — settings v5, log rotation), plus the soak tests (run separately). C# 48, plus the soak mode.


## 0.19.0 — 2026-11-06

The second batch of "essential" visualisers: **Spectrum terrain** and **VU meters** (both in Bars & Waves).

### Added
- **Spectrum terrain.** The spectrum as a synthwave landscape, in 3D.
  - **Layout:** each row is a snapshot, mirrored so loud bass raises mountain ranges at both edges, treble rises towards the middle, and a valley with a flat road runs down the centre.
  - **Scrolling:** the newest spectrum rises at the front and rolls smoothly towards the horizon (a row every 1/24 s, about 2.7 s of history).
  - **Look:** anti-aliased glowing grid lines coloured by height (violet → magenta → orange), dark terrain faces, distance haze, a striped sun on the projected horizon that pulses with the bass, a starry sky, and bloom.
  - **Influence:** Sound → shape sets the height, Movement the speed, Colour the grade.
- **VU meters.** Two analogue meters (left, right) with warm backlit faces: a −20…+3 VU scale with a red zone, a percentage scale, a needle with a shadow, a pivot cover, and a PEAK lamp (on for 0.5 s at −3 dBFS sample peak).
  - **Scale:** voltage-linear with decibel markings, as on real meters (0 VU at 70.8 %, +3 at 100 %).
  - **Ballistics (IEC 60268-17):** the needle reaches **99 % in 300 ms with 1.25 % overshoot** (spec 1–1.5 %). It's a damped second-order system, ζ = 0.8127 and ω₀ = 13.512 rad/s (solved numerically), advanced by its exact solution each analysis hop, so it moves identically at 44.1 and 48 kHz.
  - **Auto-alignment:** the reference follows the long-term power-average level, so typical sound reads about −3 VU. It is limited to −26…−8 dB and printed under the meters.
- **Pure terrain model** (`terrain-model.mjs`) with 3 tests: mirroring and road, monotonic heights, scroll speed at 60 and 144 Hz.
- **`needleStep`** in `lib/dsp-utils.js`, with a test: t₉₉ = 300 ms, overshoot 1–1.5 %, exact at both sample rates.
- **Explanations (E)** for both. The coverage map, its test and docs/PRESET-MATHS.md are updated.

### Found by testing
- **Terrain:**
  - The sun rendered as a white blob, because colour values above 1 met a low bloom threshold.
  - The foreground showed flat haze.
  - The frame was washed out (mean brightness 146/255).

  **Fix:** the sun kept below 1, dark ground below the horizon, terrain reaching under the camera, gentler bloom. The sun's bands now show, and mean brightness is 86.
- **VU meters:** with a fixed broadcast alignment (0 VU = −18 dBFS sine), both needles pinned past +3: the loud test master reads +8.6 VU. Replaced by auto-alignment, shown on screen.
- A test threshold of mine was too tight (−55 dB correctly gives height 0.011).

### Tests
JavaScript 116 (new: 4). C# unchanged at 48.


## 0.18.0 — 2026-11-06

The fourth "essential" visualiser: **Phosphor scope** (Bars & Waves), an X/Y oscilloscope with a CRT phosphor screen.

### Added
- **Phosphor scope.** The left channel moves the beam sideways, the right channel up and down. Music made for oscilloscopes draws its pictures here.
  - **The beam is drawn through every sample** (48 000 per second at 48 kHz), each frame joined to the last without a gap or a repeat.
  - **Brightness follows CRT physics:** a segment's brightness is (1/sr) ÷ its length, so fast strokes are dim and slow ones bright, and every sample deposits the same energy.
  - **Afterglow:** two-component phosphor decay, a fast glow (35 ms) and a slow tail (0.4 s), each decaying by its exact exponential. It looks the same at any refresh rate and fades fully to black (float buffers on the GPU; an 8-bit canvas leaves stuck "ghost" traces).
  - **Screen:** a white-hot core where the beam rests, a soft glow, and a faint 10 × 10 graticule.
  - **Auto-gain:** shrinks within 50 ms (no overflow), grows over 1.5 s, ×1–×8.
  - Influence colour and Movement apply (Movement lengthens the afterglow).
- **"Lissajous figure" test signal:** left and right at 2:3 with a slowly drifting phase, so a classic scope figure turns once every 8 s. It's in the input list, for trying the scope without oscilloscope music.
- `phosphor-model.mjs`, with 5 tests: equal energy per sample; **the same audio gives the same beam however it is split into frames**; the same energy per second at 60 and 144 fps; resting-beam dots and the segment cap; auto-gain behaviour.
- An explanation (E); the coverage map (and its test, now reading modules that register into Bars & Waves) and docs/PRESET-MATHS.md are updated.

### Found by testing
- **Auto-gain shrank too slowly** (still ×2.55 after 0.3 s, so a loud figure overflowed). The time constant went from 0.15 s to 50 ms.
- **The screen rendered pure black, with no errors.** Measuring the pixels showed every value at zero, and checking another feedback preset cleared the engine. The cause was `pow(x, 2.0)` on a negative x in the beam shader: GLSL leaves that undefined, and it gave NaN, which poisoned the phosphor buffer (and, through the glow, the whole picture). Fixed with `x·x`.

### Note
Most music is close to mono (left ≈ right), and on an X/Y scope that is a diagonal line, as on a real instrument. Wide stereo content and oscilloscope music draw figures.

### Tests
JavaScript 112 (new: 5). C# unchanged at 48 (one new synthetic signal).


## 0.17.0 — 2026-11-06

The third "essential" visualiser: **Particle Swarm** (Experimental), after iTunes' Magnetosphere.

### Added
- **Particle Swarm.** 65 536 particles simulated on the GPU (positions and velocities in float textures, double-buffered; 16 384 in half floats on GPUs without float render targets).
  - **Magnets:** five, each on its own Lissajous path and tied to a band (bass, low mids, mids, upper mids, treble). Softened inverse-square pull grows with the band's pulse, so the swarm gathers round whichever part of the music is active; a swirl turns the pull into spiral orbits.
  - **Shimmer:** divergence-free turbulence driven by the treble (it stirs without bunching).
  - **Containment:** a centring spring plus a soft wall beyond radius 2.4.
  - **Simulation steps:** fixed at 1/120 s, counted by elapsed time and scaled by Movement.
  - **Colour shows the bands holding each particle:** magnet colours (bass magenta, low mids orange, mids green, upper mids blue, treble violet) are mixed by pull over distance squared, with the weights cubed so the dominant band wins.
  - **Look:** glowing magnet orbs, short trails faded by elapsed time, bloom, and the Influence colour grade. The camera orbits slowly.
  - **The beat is a breath:** the swarm is drawn up to 30 % larger on each onset, relaxing with τ = 0.25 s, and can't build up.
- **The model** (`swarm-model.mjs`) is a JavaScript twin of the GPU shaders, term for term. It has **7 tests**: bounded and finite under extreme input, each band attracting the swarm, no inflation under a steady beat, the breath's timing, divergence-free shimmer, magnet paths, and the load-order regression below.
- An explanation (E), and docs/PRESET-MATHS.md updated.

### Found by testing
- **First model (twin):**
  - Particles could escape to radius 41. **Fix:** a soft containment wall, more drag, a lower speed cap.
  - Bass pushed particles *away* from the bass magnet, because a swirl growing as fast as the pull widens orbits (angular momentum). **Fix:** the swirl now grows only gently.
- **Beats:** with a physical kick impulse, a steady 124 BPM beat inflated the swarm by 50–200 %. The swirl feeds energy into orbits, so kicks knocked particles into wide, self-sustaining shells. A work-free magnetic swirl (a ⟂ v) prevented that but let drag collapse everything onto the magnets. **Fix:** the beat became a rendered breath, and the bass magnet's pulsing pull gives a physical tug.
- **In the real app, Experimental vanished.** Bars & Waves pre-registers a "failed to load" placeholder (available: false). Morph used to replace it; the new merge kept its flag and name. Both modules now restore them; a test reproduces the app's load order.
- **Colour:** the first version was nearly monochrome and washed out (saturation 37 %). Averaging the band colours made it greyer (24 %). Sharpened weights and saturated band colours give **48 %**, and the colour now shows which band holds each particle.

### Tests
JavaScript 107 (new: 7). C# unchanged at 48.


## 0.16.0 — 2026-11-05

The second "essential" visualiser: **Ridgeline** (Bars & Waves), the "Unknown Pleasures" look.

### Added
- **Ridgeline.** 44 stacked spectrum snapshots, about 3.1 s of history, newest at the front and live.
  - Each line is mirrored from the centre: bass in the middle, treble towards the edges.
  - Lines are drawn back to front with the area under each filled black, so tall peaks hide the lines behind them (the occlusion that gives the look its depth).
  - A snapshot is stored every 1/14 s of elapsed time, and every line scrolls up smoothly between snapshots, at the same speed at any refresh rate.
  - The oldest lines fade out as they leave.
  - The outer 35 % tapers to the baseline (a display envelope, as in the original plot).
- `SnapshotHistory` in `lib/dsp-utils.js`, with a test: the same snapshots and scroll position at 60 and 144 Hz.
- An explanation (E); the coverage map and docs/PRESET-MATHS.md are updated.

### Found by testing
- **With the circular spectrum's display curve, every line floated on a raised plateau** that stepped down at the edges, because dense mixes sit at −40…−30 dB. A steeper curve (−60…−12 dB, squared) and a wider taper give flat baselines with peaks rising from the centre, like the original. The curve is still monotonic: louder always draws higher.

### Tests
JavaScript 100 (new: 1). C# unchanged at 48.


## 0.15.0 — 2026-11-05

The first of the "essential" visualisers: **Circular spectrum** (Bars & Waves).

### Added
- **Circular spectrum.** 128 thin bars around a ring, mirrored: bass bursts up from 12 o'clock, treble meets at 6 o'clock.
  - The 48 measured bands are interpolated with a Catmull-Rom cubic, which passes exactly through every band (they are evenly spaced in log-frequency).
  - Bar length follows the level over −75…−12 dBFS through a power-1.5 display curve.
  - Peak caps jump, hold 0.35 s, then fall at 0.8/s.
  - The ring swells up to 7 % and glows on bass pulses (30 ms attack, 250 ms release).
  - Each bar has a faint inward reflection, and a waveform ring sits inside.
  - Colours run from cyan (bass) to magenta (treble), drifting slowly.
  - Everything scales with elapsed time, so it looks the same at any refresh rate.
- `catmullRom` and `peakCapStep` in `lib/dsp-utils.js`, with tests: exact at every band, continuous, reproduces straight lines; hold, fall rate and frame-rate independence.
- An explanation (E) with live values; the coverage map and docs/PRESET-MATHS.md are updated.

### Found by testing
- **The first version mapped decibels linearly to length.** Mastered music is fairly flat in dB, so every bar came out 57–86 % long and the outline was nearly round. The display curve roughly doubles the contrast while staying monotonic, and the outline now traces the music.

### Tests
JavaScript 99 (new: 2). C# unchanged at 48.


## 0.14.0 — 2026-11-05

The menu bar redesigned after Windows Media Player 9/10, plus favourites and shuffle as you asked.

### Changed
- **New bar, in the style of WMP's "Now Playing" strip:**
  - **Transport capsule:** previous, a big round glowing **shuffle orb** in the middle (where WMP's play button sat), next, and a ▾ to choose what to shuffle.
  - **Info screen:** a recessed display showing the visualisation's name in large glowing type, its collection beneath, and the ★ beside them. Both names are still lists you can click to choose from.
  - **Tools:** compact icon buttons on the right. Favourites, Auto and Influence keep their labels down to 1180 px wide; the others are icons with tooltips (all labelled above 1480 px).
  - **Icons are SVG symbols,** so they look the same on every PC.
- **The device text next to the input list is gone.** A status light replaces it: green for playing, grey for silence or nothing playing, amber for simulated, red for reconnecting or clipping. The full detail is in its tooltip and in Diagnostics.

### Added
- **Favourites panel** (the Favourites button, or L):
  - your favourites by name and collection; **click one to play it**; ✕ removes it; ▶ marks the one playing
  - **Shuffle favourites** and **Shuffle all** buttons
  - add or remove the current visualisation
- **Shuffle source** (the ▾ beside the orb): **Shuffle all visualisations** or **Shuffle favourites only**. Choosing one shuffles at once and is remembered. Auto mode uses the same source (shown under Settings › Automatic mode), and a small ★ on the orb shows when favourites are the source. Asking to shuffle favourites with fewer than two gives a hint instead of silently shuffling everything.
- Only one panel (Settings, Influence, Favourites, shuffle menu) is open at a time; Esc closes it.

### Removed
- **"Your collections"** in Settings, as you suggested, together with user collections in the collection list. ★ Favourites remains there for previous/next within favourites. Previously saved collections are kept in the settings file, unused.

### Verified
- **Rendered at 1280 × 720 in the real app.** The bar, the Favourites panel and the shuffle menu all render correctly. **Clicking "Eclipse" in the panel played it:** the info screen, the ▶ marker and the add/remove button all updated.
- **Tests:** JavaScript 97 (all pass), C# 48 (unchanged).


## 0.13.0 — 2026-11-05

Batch 3, as you specified: a full-screen option, and an option that hides the menu, with the bottom-edge reveal. This completes your six-feature list (wallpaper integration was dropped at your request).

### Added
- **Menu modes** (Settings › Interface › Menu):
  - **show when the mouse moves**: hides after 3 s (the previous behaviour)
  - **always show**
  - **hidden**: mouse movement and other keys never bring it back; **M** shows it, and so does **touching the bottom edge of the screen** if that option is on (default on). It hides again 3 s after you stop using it, and never while the pointer is on it or a panel is open.

  Choosing Hidden, or starting in it, shows a hint saying how to get the menu back. A hidden bar ignores the pointer, so it can't be brought back by brushing past where it would be.
- **Full screen:**
  - a **Full screen** switch in Settings (beside the button, F and double-click)
  - **Always start in full screen** (the app already restores your last state; this forces full screen on)
- **H** hides the menu now in any mode; **M** shows it.
- The cursor hides after 3 s without movement whenever the menu is hidden.
- Settings schema v4: `ui.menu`, `ui.edgeReveal`, `ui.startFullscreen`. The older auto-hide switch migrates (off → "always show").

### Verified
- **Tests:** JavaScript 97 (new: 6). A pure, tested menu state machine (`lib/menu-policy.js`) covers every mode, the edge, M, H and "never hide while in use"; settings v4 migration is tested too. C# unchanged at 48.
- **In the real app, driven by the mouse and keyboard:** in Hidden mode the bar stays hidden at start, after mouse movement and after idling; it appears at the bottom edge, stays while the pointer is on it, and appears with M. "Always start in full screen" opens full screen (1100 × 700 at 0,0), and the control run without it opens windowed.
- **A note on testing:** on Linux, full screen needs a window manager, so the first check (on a bare virtual display) stayed windowed. Repeated with a window manager, it works. On Windows the system handles full screen directly.


## 0.12.0 — 2026-11-05

Batch 2 of your feature list: audio influence controls (5) and the calibration wizard (4). The details and maths are in docs/INFLUENCE-AND-CALIBRATION.md.

### Influence controls (U, or the Influence button; highlighted in Experimental)
- **Sound → shape**, **Movement** and **Colour intensity**, each 0–200 % and independent:
  - shape scales the audio-driven part of the shape drives around their rest values
  - movement is a time scale on each visualisation's own motion
  - colour is a grade (saturation and brightness) after rendering, plus scaling of the colour drives
- Applies to Experimental, Alchemy, Battery (including the 17 wave-and-warp presets) and Ambience. Bars & Waves are measurements and are left alone.
- **Measured on Morph:**

| Setting | Result |
|---|---|
| shape 30 / 100 / 200 % | bass deformation 0.0074 / 0.0135 / 0.0409 |
| shape 200 %, colour 40 % | rendered saturation 21.5 % |
| shape 30 %, colour 200 % | rendered saturation 92.5 % |

### Calibration wizard (C, or Settings › Audio input › Calibrate…)
- A 4 s quiet sample (microphone only), then 10 s of typical sound.
- Recommends input gain, noise floor, beat sensitivity (pulse range) and smoothing, each with its reason; you apply or cancel.
- **New Audio input settings** with the same four controls, **saved per input**: microphone and system audio keep their own calibration and switch automatically.
- **Gain, noise floor and pulse range apply inside the audio service before analysis** (a new `tune` command, validated and re-sent if the service restarts), so a quiet microphone gets real beat response. Diagnostics shows the values the service confirmed.

### Found by testing
- **Noise floor on low signal-to-noise microphones.** When the two noise-floor rules conflicted, the threshold landed just above the room noise. It now sits halfway, and says so.
- **The pulse-sensitivity test's ideal value was too simple.** It ignored the short average's rise during the attack. The test now checks the true range.

### Tests
C# 48 (new: 4 — gain exactness, live silence threshold, pulse range, clamping). JavaScript 91 (new: 7 — influence scaling, smoothing factor, Morph shape/colour independence, three calibration scenarios, tuning validation and settings v3).

### Next: batch 3, as you specified
A fullscreen option and an option that hides the menu (not desktop-wallpaper integration).


## 0.11.0 — 2026-11-05

Batch 1 of your feature list: shuffle and automatic transitions (1), favourites and personal collections (3), classic keyboard and mouse controls with a fading interface (6). Batch 2 will be audio influence controls (5) and the calibration wizard (4); batch 3, wallpaper and secondary-monitor mode (2).

### Shuffle and automatic transitions
- **Transitions on every change** (manual and automatic): the outgoing preset keeps running on top and dissolves away. Five styles:
  - *crossfade*
  - *colour blend* (screen-blended fade)
  - *iris* (a soft circle opens)
  - *wipe* (a soft edge at a random angle)
  - *clock* (a sweeping hand)

  *Mixed* never repeats a style twice running. Lengths are 1–6 s; manual changes use half the length.
- **Automatic mode** (button, or A), two triggers:
  - **Follow the music** switches at a **track gap** (≥ 0.6 s of silence after ≥ 5 s of sound: right for albums) or at a **section change** (the 3 s and 20 s averages of the band levels differ by more than 6 dB RMS), never more often than every 45 s. The set time is used as a fallback.
  - **Timer** switches every 1–12 minutes.

  A decided switch waits up to 3 s for the next strong beat so the transition lands on the music; at a track gap it happens at once. Automatic mode runs on the audio clock and restarts its timer when you change preset yourself.
- **Shuffle bag:** every preset in the pool plays once before any repeats, and never the same one twice running. Pools: all presets, favourites only, or the current collection (including your own).

### Favourites and personal collections
- ☆/★ button (or S) to favourite the current preset. **★ Favourites** appears in the collection list.
- **Your collections** (Settings): create named collections that mix presets from any collection; add or remove the current preset; delete. They appear in the collection list.
- Saved in settings (schema v2; v1 files migrate automatically). Keys, names and sizes are validated in the main process.
- *Saving modified presets* needs the parameter editor (Phase 4, Advanced mode), so it is not included yet.

### Controls
- **New keys:** A automatic mode, S favourite, H hide the interface now, O options, ? shows the key list on screen. PageUp/PageDown change preset too. **The mouse wheel** changes preset.
- **The interface fades after 3 s without mouse movement in any window mode** (optional), along with the cursor. The bar now overlays the picture, so no strip is left behind.
- **On-screen title:** the preset name (and why, for automatic changes) fades in and out on every change.

### Fixed
- **Double-click for full screen worked only until the first preset change.** It was bound to the first canvas, and each preset gets a new one. It is now bound to the stage.
- **Found while testing this batch:**
  - Automatic mode first ran on the display clock, which was capped per frame, so it ran slow whenever rendering dropped below 10 fps. It now runs on the audio clock.
  - A saved value missing from a dropdown made it show blank.

### Verified
- **Tests:** JavaScript 84 (new: 8) — shuffle bag, track and section detection, timer and music policies with beat alignment, every transition style fully covering at the start and fully revealing at the end, library helpers, settings v2 validation and migration.
- **Driven in the real app with keyboard input:**
  - an iris transition captured mid-dissolve
  - favourite toggling with its on-screen title
  - the options panel
  - the interface fading
  - automatic mode firing on schedule: 30 s timer, beat wait, and the timer pausing during the 4 s transition


## 0.10.0 — 2026-11-05

Bars & Waves refinements from your review.

- **Instruments.**
  - The centroid and rolloff marker lines are removed from the spectrum. Both remain in Analysis and Mashup.
  - The white pulse bars are removed. Band bars now **brighten** on their pulse instead.
- **Stereo field particles escaping their box (bug).** The goniometer wasn't clipped to its panel, so auto-gained points could be drawn over the spectrum. It is now clipped.
- **Mashup.**
  - **The shake is now intentional.** The old shake was accidental: the spin direction followed the *sign* of the stereo balance, which flickers on near-mono music. Onsets now kick a damped angular spring (7 Hz, ζ = 0.25), and the spin direction follows the balance with hysteresis.
  - **No visible rectangle.** The turned previous frame is always scaled by at least cos|θ| + max(W/H, H/W)·sin|θ|, the smallest scale that still covers the screen (tested for every corner, orientation and angle). Trails also fade out in a circle before the frame edge, so the shape reads as round.
  - **Less white.** The overlapping additive layers were turned down. Measured on the same signal, mean saturation went 42 % → 54 % and whitish (light, unsaturated) pixels 3.8 % → 1.0 %.
- Explanations (E), docs/BARS-AND-WAVES.md and the coverage map are updated.
- **Tests:** JavaScript 76 (new: cover-scale geometry). C# unchanged at 44.


## 0.9.0 — 2026-11-05

A review of every documented method. Five were replaced by better-established ones, each measured against the method it replaced. Full write-up, with references: docs/METHODS-REVIEW.md.

| Area | New method | Measured |
|---|---|---|
| Onset detection | SuperFlux max-filter vibrato suppression (±50 cents, widened with frequency) | false onsets on intermittent vibrato 13 / 18 → **0 / 0**; impulses and kicks unchanged |
| Shader noise | PCG2D integer hash + quintic interpolation | 50 000 / 50 000 distinct hash values (sine hash: 3 655); curvature jump at noise cell edges 11.98 → 0.12 |
| Water | Isotropic 9-point Laplacian | ripple axis/diagonal speed 0.90 → **1.00**; stability limit 0.71 → 0.87 |
| Morph springs | Exact closed-form step | step-size dependence 5.1·10⁻⁴ → 3.3·10⁻¹⁵ |
| Particles | Exact motion under drag | step-size independent |

Docs (DSP, MORPH, COLLECTIONS), the How it works explanations and docs/PRESET-MATHS.md are updated to the new methods. The recorded test fixture was regenerated with the new onset detector; every reactivity and beat-gate number is unchanged.

Tests: C# 44 (new: 2), JavaScript 75 (new: 7).


## 0.8.0 — 2026-11-05

A completeness audit of Bars & Waves, the gaps it found filled, and two new views. Full table: docs/BARS-AND-WAVES.md.

### Audit findings
The views were accurate but hid about a third of the analysis:
- **Never drawn:** band pulses and level pulse (what drives most beat response since v0.3), the onset-detection flux and its adaptive threshold, flatness, zero-crossing rate, and any history over time.
- **Only as numbers in Diagnostics:** centroid and rolloff.
- **Missing readouts:** the meters had no numbers.

### Added
- **Instruments:**
  - centroid and 85 % rolloff marked on the spectrum
  - band pulses as white bars inside the band levels
  - RMS dBFS and sample-peak numbers under the meters
  - onset confidence beside the lamp
- **Analysis view** (features over the last 6 s):
  - a spectrogram
  - onset detection (log flux, adaptive threshold, every detected onset)
  - timbre (centroid, rolloff, flatness, zero-crossing rate)
  - live pulses
  - stereo and level history
- **Mashup view.** Every measurement in one radial machine, with zooming feedback trails:
  - a band-level bullseye core with the goniometer on top (coloured by correlation)
  - band-pulse halos
  - a waveform ring
  - a mirrored polar spectrum
  - a centroid needle
  - level arcs
  - onset shockwaves

  Trail zoom, turn and fade all scale with Δt. Measured near-black: 9.3 %.
- **Coverage test.** Every field the service sends (read from the recorded fixture) must appear in `bars-waves-coverage.mjs`, and every preset named there must exist and have an explanation.
- Explanations (E) for Analysis and Mashup. Instruments' explanation now covers the markers and pulses, and explains why the centroid can sit above the rolloff (amplitude vs power weighting).

### Fixed during development
- Chart legends were drawn inside the charts, where lines covered them. They now sit in each panel's title row.
- Mashup's level-arc code was muddled. It is now a clear symmetric sweep, with each channel centred on its own side.

### Tests
JavaScript 68 (new: 3). C# unchanged at 42.


## 0.7.0 — 2026-11-05

Refinements from your v0.6 review.

| Preset | Your note | Cause | Change |
|---|---|---|---|
| **Hyper Tunnel** | jarring, hard spiral edges feel glitchy | Each arm had its own colour (hard boundaries); the arm count switched instantly on beats, jumping the whole screen; the twist followed the mid pulse, so the spiral jerked every beat; rings finer than a pixel shimmered at the centre | Colour varies through cos(2πv/N), smooth between arms and continuous round the circle (tested); arm changes crossfade over 2 s, at most every 4 s; twist glides (τ 0.8 s); slower travel; pattern fades out near the centre |
| **Spiral Elixir** | too much blank space | Arms on black, by the v0.4 design | A slowly turning nebula in the scheme's colours, with squared-noise contrast so the arms still stand out; wider arms; longer trails. **Measured near-black: 84.7% → 0.3%** |
| **Acid Warp** | moves too fast, could cause nausea | Flow speed and warp strength followed beat pulses, so the whole field lurched every kick | Flow 0.3–1.8/s → **0.08–0.38/s** (about 5× slower at most); warp and scale glide (τ 0.6 s) instead of jumping; smaller hue jumps; longer temporal smoothing |
| **Plasma Prism** | a little light in colour | ½ + ½·cos keeps two channels fairly high: pastel | Colour raised to the power 1.8; the brightest channel is still ≥ 0.75^1.8 ≈ 0.60, so never dark (tested) |
| **Crimson Tunnel** | the blue in the middle looks bad | The glowing-core mask | Mask removed; the ring sits near the centre, so the walls stream out of a bright core and the middle is never empty |

Rainbow Mandala is unchanged.

All explanations in the How it works panel and docs/PRESET-MATHS.md are updated to match. Tests: JavaScript 65 (one rewritten, one added); C# unchanged at 42.


## 0.6.0 — 2026-11-05

Psychedelic Alchemy presets with almost no blank space, and the black side wedges removed.

### Fixed: black wedges at the sides (your Amethyst Kaleido screenshot)
- **Cause.** Symmetry folds map every screen point into one wedge. Toward the corners that wedge reaches beyond the frame buffer, where the feedback returned black (and the present pass clamped, smearing edge pixels). The fold then copied that black symmetrically onto the sides.
- **Fix.** Sampling beyond the frame now **mirror-wraps** back into the picture, the way a kaleidoscope's mirrors reflect, in both the feedback and the present pass. This applies to every feedback preset.
- **Measured.** Amethyst Kaleido's near-black area went from **29.0% to 0.9%**. Its central hole is also smaller.

### Added: five psychedelic Alchemy presets
Each has its maths in the How it works panel (E) and in docs/PRESET-MATHS.md. Every one measured **0.1% near-black pixels** in testing.

| Preset | Mathematics |
|---|---|
| **Acid Warp** | domain-warped fractal noise, f(p + W·r(p + 4·q(p))); bass churns, mids flow, treble adds detail |
| **Plasma Prism** | four interfering sine waves through a 3- to 8-fold kaleidoscope that switches on beats; three-phase colour, whose brightest channel is provably ≥ 0.75 (tested) |
| **Julia Bloom** | z → z² + c with c = 0.7885·e^(iα) circling as the mids drive it; log-smooth escape colouring outside and orbit-trap colouring inside, so no black interior |
| **Hyper Tunnel** | log-polar coordinates: an endless self-similar spiral tunnel (doubling r ≡ travelling ln 2, tested) with a white-hot core instead of a hole |
| **Rainbow Mandala** | spirograph seeds in kaleidoscope feedback; the seed colour travels round the rainbow, so rings keep the colour they were born with |

**Photosensitivity.** Hue jumps on kicks pass through a flash limiter (at most 3 per second when limiting is on) and glide over 80 ms, so whole-screen colour changes never strobe.

### Found while testing
- **Hyper Tunnel seam.** The arm colour index ⌊v⌋ jumps by N going once round the circle, which drew a visible line from the centre. It now uses ⌊v⌋ mod N; tested.
- **A flash-limiter clock mix-up.** The psychedelic presets would have shared the limiter on a different clock, which could block their hue jumps for minutes after switching from another preset. Each now has its own limiter, using your setting.
- **Rainbow Mandala took four attempts:**
  - Rotating the hue of the whole buffer averaged toward grey.
  - A saturation boost inside the feedback loop ran away to one flat orange.
  - Colouring trails by age at the source works, with fast-travelling, short-lived rings so colours don't pile into mud.
  - All four steps were judged from screenshots, and the reasons are recorded in the panel's explanation.
- **Julia Bloom** was framed too wide, leaving a flat field. It is now zoomed in, with logarithmic colour bands. **Acid Warp** is more saturated.

### Tests
JavaScript 64 (new: 6). C# unchanged at 42.


## 0.5.0 — 2026-11-05

The looks from your reference images, plus a panel that shows the maths behind every preset.

### Added
- **17 wave-and-warp presets** in Battery-inspired, one per look in your reference grid (the spirograph look is Alchemy's): Blue Starburst, Ghost Wires, Copper Flame, Crimson Tunnel, Cobalt Cross, Violet Streams, Neon Waveline, Teal Vortex, Violet Lens, Ion Storm, Midnight Star, Solar Flare, Ultraviolet Swirl, Cyan Clover, Eclipse, Frost Cross, Amethyst Kaleido.
  - All are built from one recipe: draw the waveform → warp the previous frame (zoom, rotation, stretch, drift, swirl, noise) → fade each colour channel at its own rate → fold for symmetry (mirror, four-fold, kaleidoscope) → present (with an optional dark or glowing mask, and sparkles).
  - **Per-channel fading is where the colours come from.** When red outlasts green and green outlasts blue, a white line ages through yellow, orange and red (fire). The opposite order gives ice.
  - Each preset is plain data (`engine/warp-model.mjs`). `computeWarp()` produces every number the shader receives.
- **How it works panel** (button or E):
  - Each preset's real equations, typeset with KaTeX.
  - A plain-language reason for each step.
  - Every symbol's meaning and **live value**, refreshed four times a second.
  - An "Audio → drives" section **generated from the preset's running mapping specs**.
  - For wave-and-warp presets the equations are generated from the same parameters as the shader, and a test checks that the panel's numbers equal the shader's.
  - Hand-written explanations cover Bars & Waves, Morph, Alchemy, classic Battery and Ambience.
- **`docs/PRESET-MATHS.md`**: the same explanations as a document (about 200 equations), generated by `npm run docs:maths`.
- **Phase-portrait waveform mode**: sample i against sample i + 37. It draws loops even for mono music, where left-against-right collapses to a dot (seen in testing).
- **Rotated kaleidoscopes**: the symmetry group is conjugated by the rotation, and this is tested.
- New colour schemes: flare, frost, rose, teal, ultraviolet.
- **Tests:** JavaScript 58 (new: 8).
  - Every formula on every preset typesets, and every live value evaluates.
  - The panel's numbers equal the shader's.
  - The mirrored waveform copies fold exactly onto the GPU fold, for all symmetries.
  - The warp directions are checked (what each sign does to the picture).
  - The fire, ice and uniform decay journeys are checked numerically.
  - No raw TeX leaks into the prose.

### Found by testing and by looking
- **A sign error in the stretch terms.** Writing out q = p·e^(−s·Δt) for the panel showed that s > 0 *spreads* the picture outward. The panel text said the opposite, and three presets were built on that reading, so they squeezed instead of smearing. Fixed, and a test now pins every direction down.
- **Sparse presets.** The first gallery rendering showed thin lines where your references are full-frame textures. Long persistence (half-lives of 1–2 s), low drains and stronger warps fill the frame as theirs do. Two rounds of tuning against contact sheets of all 17.
- **Crimson Tunnel** used a receding zoom that pulled everything into its masked core, leaving black. It now uses outward-flying walls.

### Notes
- These presets reproduce the *looks* procedurally, following your clarification: everything is computed by shaders from the audio at run time, with no AI-generated or stored imagery, and no code or assets from the originals.
- Three.js 0.186.1 and KaTeX 0.19.0 (MIT) are loaded locally. The strict content-security policy is unchanged: KaTeX's HTML output sets styles through the DOM, which the policy allows.


## 0.4.0 — 2026-11-05

The classic collections reworked to sit closer to the character of the Windows Media Player XP visualisations, after seeing v0.3 on your RTX 4080.

### What was wrong in v0.3, and the fix

| Problem (seen in your screenshot) | Cause | Fix |
|---|---|---|
| Pastel haze instead of black | Exponential decay never reaches zero. WMP-era 8-bit buffers rounded dim pixels to black; my half-float buffers kept the residue and gamma lifted it. | **Exact fade to true black.** Each frame solves dc/dt = −k·c − f exactly, so trails reach exactly 0 in finite time and the result is still frame-rate independent (tested at 30–144 Hz). |
| Jagged, wobbly ribbons | Each point was shaped by the raw 48-band spectrum, which jitters | Smooth curve families (Lissajous, rose, spirograph hypo- and epitrochoids) modulated only by a **band-limited wobble** (first 3 Fourier terms). Measured roughness is 290× lower. |
| Rainbow mush | A full-hue cosine palette, plus a hue offset per ribbon | **One saturated 3-stop scheme at a time** (electric, magma, toxic, ice, inferno, aqua, violet), crossfading on strong beats |
| Never changes character | One fixed set of figures | **Program cycling** in the spirit of Alchemy: after a 12–22 s hold, switches shape family and scheme on the next strong beat (or 4 s later), with a 3 s crossfade. Deterministic and tested. |
| No waveform | Geometry only | **Oscilloscope rings** (tapered so they close seamlessly, auto-gained) inside Battery's kaleidoscope and as the walls of Star Tunnel; stereo smoke rings in Ambience › Swirl |
| Dark strip at the frame edge | Hard black cut-off when sampling outside the frame | Soft edge fade |

### New presets
- **Ambience › Water.** A real ripple tank: the discrete 2D wave equation, solved on the GPU at a fixed 240 steps per second (λ = 0.5 < 1/√2, the stability limit). Drops come from kicks, bass hits and treble "rain"; the surface is shaded by refraction and specular highlights.
  - Tests (on a CPU twin of the shader): stable at λ = 0.5 and unstable at 0.8; waves travel 48 px in 100 steps (theory 50); damping works; the same number of steps per second at 30–165 Hz.
  - **Bug caught by test:** adding drops as impulses made the mean water level drift upward linearly forever, which on the GPU would eventually have swallowed the ripples in float precision. Drops are now displacements.
- **Ambience › Swirl.** Soft left and right waveform rings carried by a vortex and diffused by a blur whose radius ∝ √dt, so diffusion per second is frame-rate independent.
- Ambience now has four presets: Water, Swirl, Nebula, Aurora.

### Other changes
- Engine: fixed-rate simulation substeps (capped at 16 per frame), custom present shaders, a shared colour-scheme uniform, and per-buffer texel size.
- Polygon Pulse has longer kaleidoscope echoes; Star Tunnel's walls band through the scheme over time.
- Diagnostics show the current program, colour scheme, program switches and simulation substeps.
- **Tests:** JavaScript 50 (new: 10 — exact fade, scheme gradient, program cycler, curve closure and smoothness, scopes, ripple tank stability, speed, damping and refresh-rate independence, blur diffusion). C# unchanged at 42.

### Verified, and not verified
- All tests pass, and the service compiles against NAudio 2.2.1.
- All eight classic presets were rendered in the real app against the dense mix and tuned by eye: Water and Swirl were darkened twice, and Polygon Pulse's echoes were lengthened.
- I am working from the WMP visualisations' general character, not frame-by-frame reference (the brief rules out copying them). Your eye on specific presets you remember is the best next input.


## 0.3.0 — 2026-11-05

Phase 3 (the classic collections), plus a reactivity fix for Morph based on your v0.2 diagnostics.

### Fixed: Morph was not reactive enough
- **Cause.** Your Diagnostics showed *Drive bass / mid / high* at 0.93 / 0.92 / 1.00. Morph was driven by adaptive band *levels*, each measured against its own recent peak, and mastered music stays near its peak all the time. The springs sat at full deflection, so the shape was big but static.
- **Fix: new DSP features, "pulses"** (`bandsPulse[7]`, `levelPulse`). Each is how far a band sits above its own recent typical level, which is the part of the sound that changes.
  - The typical level is max(median over 1.5 s, 0.4 s average).
  - The median ignores kicks.
  - The short average lets a sustained change, such as a new bass note, become normal quickly.
- **Two baselines rejected by tests along the way:**
  - A plain 1.2 s average: after silence it took about 3 s to catch up, holding pulses at maximum.
  - A median alone: it held a pulse through bass-note changes, blurring the following kicks.
- **New test signal *Dense mastered mix*:** a sustained bass line, chords, a hi-hat bed and kicks at 124 BPM, soft-clipped like a mastered track.
- **Measured on it:**
  - The adaptive bass level stays pinned at **0.81 ± 0.09**, reproducing your report.
  - The bass pulse fires on 14/16 kicks.
  - Pulse or onset catches **16/16**, and the pulse falls to 0.05 between kicks.
- **Morph remapped to pulses** (levels keep a small share for body), with snappier springs (3.0 / 4.5 / 8 Hz), stronger kick impulses, a uniform swell on kicks (the bound is now r ≥ 0.15R), and brightness following the kick.
- **Measured on frames recorded from the real service:**

| | Bass drive | Beat contrast | Glow contrast |
|---|---|---|---|
| v0.2 | 0.99 ± 0.02 | 0.001 | 0.01 |
| v0.3 | 0.33 ± 0.20 | 0.027 | 0.18 |

### Added
- **Framebuffer-feedback engine** (`engine/feedback.mjs`): half-float ping-pong buffers; preset transform shaders; trail deposit ∝ dt plus a crisp head pass; soft tone curve; GPU diagnostics.
- **Alchemy-inspired:** Liquid Ribbons (spectrum-shaped Lissajous ribbons, swirling outward trails) and Spiral Elixir (spectrum-width log spirals, vortex feedback).
- **Battery-inspired:** Polygon Pulse (band-pulsing rotating polygons, onset-switched shapes, kaleidoscope feedback) and Star Tunnel (onset-switched star, spokes, tunnel zoom).
- **Ambience-inspired:** Aurora (domain-warped fBm curtains, exact temporal low-pass, twinkles) and Nebula (semi-Lagrangian curl-noise advection, i.e. divergence-free fluid-like drift, with orbiting band-driven colour sources).
- **Mapping features:** `subBassPulse` … `brilliancePulse`, `lowPulse`, `levelPulse`.
- **Recorded fixture** `test/fixtures/densemix-frames.ndjson`: 700 frames from the real C# service.
- **Tests:** C# 42 (new: 4 pulse tests); JavaScript 40 (new: fixture reactivity vs v0.2, 9 Phase 3 tests including the beat gate).

### Fixed during development (never released)
- **Feedback brightness depended on refresh rate.** Geometry was added at fixed intensity each frame, so trails would have been 24× brighter at 120 Hz than at 5 Hz. The deposit is now ∝ dt.

### Verified
- All tests pass, and the service compiles against NAudio 2.2.1.
- All six new presets were rendered in the real app with the real service on software WebGL, with no shader or console errors. They are visually distinct, and two look problems were fixed from the screenshots.

### Not verified
- Frame rate and the look of trails on real hardware at 120 Hz. My renderer runs at about 5 FPS, so this rests on the tested frame-rate-independence maths.

### Known limitations (new)
- Two presets per collection; more are cheap to add on the engine.
- Feedback buffers are capped at 1.25× device pixels. There is no adaptive quality yet (Phase 6).
- An older AudioCapture service (v0.2) still works with this app, but sends no pulses, so the presets lose most of their beat response. Run setup again.


## 0.2.0 — 2026-11-04 (late)

Phase 2: the first 3D, audio-deformed visualisation, plus a capture timing fix found in your v0.1 diagnostics.

### Fixed
- **Loopback analysis ran at ~150 frames/s instead of 93.75**, as reported in the v0.1 Diagnostics screenshot.
  - Cause: NAudio's loopback capture polls rather than using event callbacks. Packets arrive 50–65 ms apart, and the 60 ms gap-fill threshold mistook late polls for silence. It inserted zeros, and the real audio for that time then arrived as well, so time was counted twice.
  - Symptoms: the high frame rate, false onsets (each zero splice is a click), and extra treble in the spectral features.
  - Fix:
    - The gap-fill threshold now adapts to 3× the longest recent packet interval (150–600 ms).
    - Real audio overlapping already-filled time is trimmed.
    - Loopback uses its own 60 ms polling buffer instead of NAudio's 100 ms default, which also lowers latency by about 20 ms.
  - Regression tests reproduce the bursty delivery in real time: before the fix, 111.7 frames/s; after, 85–95 frames/s with 0 gap-fill frames and no false onsets.
- Band normalisation, from late 0.1 work: bands holding only window leakage are no longer stretched to full scale (coupled ceilings).

### Added
- **Experimental › Morph** (Three.js 0.186.1), documented in docs/MORPH.md:
  - A deformable icosphere with 8412 vertices.
  - Bass drives a rotating l = 2 elongation plus squash/stretch; mids drive travelling waves; highs drive fine ripples; balance makes it lean; onsets give spring kicks.
  - Mass–spring–damper dynamics with fixed-step semi-implicit Euler at ≤ 1/240 s, clocked by audio frames, so the result is identical at any display refresh rate.
  - A proven displacement bound, so the surface never self-intersects (r ≥ 0.2R).
  - Seeded onset particles, a swirling background field, bloom, and an autonomous camera orbit.
- **Mapping engine** (`engine/mapping.mjs`): the brief's `clamp(gain·curve(feature) + offset)` with weighted sources, threshold, six response curves, signed values, attack/release, NaN-hold for features undefined in silence, and spec validation. Morph's behaviour is defined as data (`MORPH_MAPPINGS`), ready for the Phase 4 editor.
- WebGL support in the shell:
  - a fresh canvas per preset, so 2D and WebGL presets can switch freely
  - GPU context-loss recovery that rebuilds the preset
  - a per-renderer Diagnostics section (GPU name, triangles, draw calls, CPU geometry time, drive values, displacement)
- `AUDIOVIZ_DEBUG=1` forwards renderer console messages to the terminal.
- **Tests:**
  - C#: 38 (new: 2 real-time capture-session tests)
  - JavaScript: 30 (new: mapping, springs, geometry bounds, pole smoothness, basis correctness, the Phase 2 gate, determinism, CSP hash check)

### Verified
- All tests pass.
- The service compiles against the NAudio 2.2.1 source.
- Morph was run in the real Electron app with the real service on software WebGL. Screenshots against 100 Hz sine, white noise and the synthetic beat show distinct, predictable shapes.
- Live switching 2D → WebGL → 2D → WebGL via keyboard shortcuts works with no console errors, and the selection is saved.

### Not verified
- Frame rate and GPU cost on real hardware. My environment renders WebGL on the CPU at about 2 FPS, so performance numbers must come from your machine.
- GPU context-loss recovery. It is implemented, but no test triggers a real context loss.

### Known limitations (new)
- At render rates above the 93.75 Hz analysis rate (e.g. 120 Hz), some display frames repeat the previous geometry. Interpolation would add latency and is not done.
- Render scale is capped at 1.5× device pixels. There is no adaptive quality yet (Phase 6).
- Organism, Crystal, Sound Sculpture and Singularity are Phase 5.


## 0.1.0 — 2026-11-04

First runnable version: Phases 0 and 1, plus the Bars & Waves collection from Phase 2.

### Added
- **Audio service** (`AudioCapture.exe`, .NET 10 + NAudio.Wasapi 2.2.1):
  - WASAPI loopback of any output device, and capture from any input device, in shared mode
  - float32 and PCM 16/24/32 formats at any sample rate; mono, stereo, and 5.1/7.1 folded down to stereo
  - device list and change notifications, follow-default mode, and automatic recovery with backoff
  - gap-fill for idle loopback, with gap-filled frames flagged
  - labelled synthetic test signals
- **DSP core:**
  - verified FFT, and calibrated one-sided amplitude and power spectra
  - 7 named bands plus 48 log bands, using two FFT sizes (2048 and 4096)
  - RMS, dBFS and sample peak
  - centroid, flatness, rolloff and zero-crossing rate
  - balance, correlation and stereo width
  - linear and log spectral flux, adaptive-threshold onset detection
  - attack/release smoothing, and adaptive band normalisation with coupled ceilings
- **Electron app** (44.9.3):
  - hardened main process and preload bridge, with validated IPC
  - service supervision with restart
  - saved settings
  - full screen with auto-hiding controls, multi-monitor display picker, keyboard shortcuts, flash limiter
  - diagnostics panel showing frame rates, drops and capture→draw latency
- **Bars & Waves presets:** Instruments, Spectrum glow, Oscilloscope, Stereo field.
- **Tests:** 36 C# tests (31 DSP fixtures, 5 capture-core: PCM conversion, 5.1 fold-down, lock-free ring) and 13 app tests (JavaScript).
- **Docs:** architecture, DSP mathematics, protocol, privacy.

### Verified before release
- All 36 C# and 13 JavaScript tests pass.
- The service compiles against the NAudio 2.2.1 source with no warnings from project code.
- The real service process was run with synthetic input, and its protocol output was parsed: 93.75 frames/s, the 440 Hz tone measured −9.03 dB (theory −9.031), and onsets came exactly 500 ms apart.
- The Electron app was run with the real service on a virtual display, with all four presets screenshotted against known test signals. Results: 94 frames/s received, 60 FPS, 8 ms median capture→draw, zero drops.

### Not yet verified
- WASAPI loopback and microphone capture on real Windows hardware (the Phase 0 gate). This needs your test; see the README checklist.

### Known limitations
- 5.1/7.1 fold-down assumes standard speaker order, because the channel mask is not read.
- Apps using exclusive mode or ASIO cannot be captured by loopback.
- No microphone noise-floor calibration yet. Silence is detected with a fixed −70 dBFS threshold, and the adaptive normaliser keeps a −50 dB minimum ceiling.
- No pitch or tempo estimates yet; onsets are transients, not beats.
- The capture→draw figure excludes Windows audio engine buffering and display scan-out.
- Peak is sample peak, not true peak.
- Visualisation code sits inside the Electron app until a bundler is added in Phase 2.
- There is no installer yet; run from source using the scripts.
- The roadmap collections appear in the collection list but cannot be selected yet.
