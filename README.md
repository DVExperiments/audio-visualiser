# Audio Visualisation Studio — v0.20.3

> **Testers:** you only need **`Audio Visualisation Studio-Setup-<version>.exe`**. Double-click it to install. If Windows says "Windows protected your PC", click **More info › Run anyway** (the app isn't code-signed yet).
>
> **Making that installer** (no command line): see [docs/DISTRIBUTING.md](docs/DISTRIBUTING.md). Either GitHub builds it for you, or you double-click **`Build Installer.cmd`**.

A Windows desktop visualiser that listens to whatever your PC is playing (Spotify, YouTube, games, VLC) or to a microphone, analyses it with tested DSP, and draws it in real time. Everything on screen is computed from the audio; there are no pre-made images or animations.

This version completes **Phase 3**. Collections:
- **Bars & Waves** (diagnostics)
- **Experimental › Morph** ([docs/MORPH.md](docs/MORPH.md)), now driven by the beat rather than pinned at maximum
- three new classic collections, **Alchemy-, Battery- and Ambience-inspired**, with two presets each, all built on a frame-rate-independent framebuffer-feedback engine ([docs/COLLECTIONS.md](docs/COLLECTIONS.md))

The Advanced Mode mapping editor is next; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap).

## Requirements

- Windows 10 (1809+) or Windows 11, x64 or ARM64
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) — `winget install Microsoft.DotNet.SDK.10`
- [Node.js 22 LTS or newer](https://nodejs.org) — `winget install OpenJS.NodeJS.LTS`
- Internet access the first time, for NuGet (NAudio) and npm (Electron)

## Setup

Unzip anywhere (a path without unusual characters is safest, e.g. `C:\dev\audio-visualiser`), open PowerShell in that folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

This checks the prerequisites, installs Electron, builds the audio service and runs all tests. You should see `48/48 tests passed` and `pass 118` before it finishes. (The capture-session tests run in real time and take about 12 seconds.)

Then start the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

Other scripts: `scripts\build-service.ps1` (rebuild only the audio service), `scripts\test.ps1` (run tests only).

## Using it

The app starts on **Default output**, i.e. whatever Windows is playing. Play something in Spotify or a browser and the displays should move.

The control strip at the bottom has preset arrows, the collection and preset lists, the input list, Diagnostics, Settings and full screen. The input list has three groups: what this PC is playing (any output device), microphone or line in, and **test signals**, which are simulated and always labelled *Simulated* in amber.

Mouse: the wheel changes preset; double-click goes full screen. The menu fades after 3 s without mouse movement. It can instead always show, or stay hidden until M or the bottom edge (Settings › Interface).

| Key | Action |
|---|---|
| F, F11, double-click | Toggle full screen (the control strip and cursor hide after 2.5 s) |
| Esc | Leave full screen / close settings |
| ← → (or PageUp/PageDown, or the mouse wheel) | Previous / next preset, with a short transition |
| A | Automatic mode on/off (switches with the music or on a timer; set it up in Settings) |
| S | Favourite the current visualisation |
| L | Favourites list: click one to play it; shuffle favourites or all |
| H | Hide the menu now |
| M | Show the menu (the way back when the menu is set to Hidden) |
| O | Options (automatic mode, your collections, interface) |
| U | Influence: Sound → shape, Movement, Colour intensity |
| C | Calibrate the current input (recommends gain, noise floor, beat sensitivity, smoothing) |
| ? | Show the key list on screen |
| ↑ ↓ | Previous / next collection |
| R | Shuffle (the round orb): from all visualisations or favourites only, as chosen with the ▾ beside it |
| D | Diagnostics panel (includes per-renderer GPU, timing and drive values) |
| E | How it works: the maths behind the current preset, with live values |
| I | Focus the input list |

Settings has a flash limiter (on by default, and forced on if Windows "Show animations" is off) and a display picker for multi-monitor setups. Your input, collection, preset, window position and these options are remembered.

## v0.20: installer, appearance, stability

- **Install it:** run `.\scripts\package.ps1` to build an installer and a portable .exe in `apps\desktop-electron\dist` (see [docs/RELEASE.md](docs/RELEASE.md), including code signing).
- **Appearance:** Settings › Appearance › Classic or Modern style, Dark or Light mode.
- Opening any panel closes the others.
- **Logs** for support: Settings › Open log folder.

## v0.14: a WMP-style bar, favourites and shuffle

- **The bar:**
  - previous, a round shuffle orb and next
  - an info screen showing what's playing, with its ★
  - a status light, replacing the device text
  - compact tools
- **Favourites:** press S or click ★ to favourite, then open **Favourites** (L) and click any of them to play it.
- **Shuffle:** the ▾ beside the orb chooses between all visualisations and favourites only. Auto mode follows the same choice.

## v0.13: full screen and a hidden menu

Settings › Interface:
- **Menu:** show when the mouse moves (hides after 3 s), always show, or **hidden**. In Hidden mode only **M**, or touching the **bottom edge of the screen** (optional), brings it back.
- **Full screen**, and **Always start in full screen**.

## v0.12: influence controls and calibration

- **Influence (U):** set how strongly sound shapes the picture, how much it moves, and how intense its colour is, independently. For example, extreme deformation with subtle colour.
- **Calibrate (C):** a short measurement recommends input gain, noise floor, beat sensitivity and smoothing for the current input, and explains why. Each input keeps its own settings (Settings › Audio input).

See [docs/INFLUENCE-AND-CALIBRATION.md](docs/INFLUENCE-AND-CALIBRATION.md).

## v0.11: shuffle, automatic transitions, favourites, collections, controls

- **Automatic mode:** press A or the Auto button. By default it follows the music, changing at gaps between tracks or when the music changes character, ideal for an album. Settings: timer or music, how often, which presets (all, favourites, the current collection), and the transition style and length.
- **Favourites and collections:** S or ☆ favourites a preset. Create your own mixed collections in Settings.
- **Controls:** see the key table below. The interface fades after 3 s.

## v0.9: methods review

Five methods were upgraded to better-established ones, each measured against what it replaced; see [docs/METHODS-REVIEW.md](docs/METHODS-REVIEW.md). The visible effects are fewer false onsets on vocals or strings with vibrato, and rounder ripples in Water. The rest is robustness: long-session stability of the shader noise, and identical results at every sample rate.

## v0.8 check — please try these

- **Bars & Waves › Instruments:** spectrum markers, pulses in the band bars, meter readouts.
- **Bars & Waves › Analysis:** the music's features over the last 6 s.
- **Bars & Waves › Mashup:** everything at once.

docs/BARS-AND-WAVES.md lists where every measurement is shown.

## v0.7 check

Hyper Tunnel (smooth now), Spiral Elixir (filled), Acid Warp (much calmer), Plasma Prism (deeper colour) and Crimson Tunnel (no blue core). Each changed setting is visible in its How it works panel (E).

## v0.6 check

1. **Alchemy-inspired** has five new full-screen psychedelic presets: *Acid Warp*, *Plasma Prism*, *Julia Bloom*, *Hyper Tunnel* and *Rainbow Mandala*. Press E on each to see the maths.
2. **Battery-inspired**: the black wedges at the sides of the kaleidoscope presets (e.g. Amethyst Kaleido) should be gone.
3. If any preset still has blank areas you don't like, tell me which. Most are a fill or persistence setting.

## v0.5 check

1. **Battery-inspired** now has 19 presets. The 17 new ones are the looks from your reference images (Blue Starburst, Copper Flame, Crimson Tunnel, Solar Flare, Eclipse, and so on). Use ← → to step through them.
2. Press **E** (or *How it works*) on any preset to see its equations, why each step produces what you see, and the live value of every symbol as the music plays. The same content is in [docs/PRESET-MATHS.md](docs/PRESET-MATHS.md).
3. Tell me which looks are closest to what you remember, and which still differ: colour, motion, density or symmetry. Each is a handful of numbers in `engine/warp-model.mjs`, and the panel shows which ones.

## v0.4 check

1. **Black, not haze:** every classic preset should now sit on true black, with trails that fade away completely.
2. **Alchemy:** Liquid Ribbons and Spiral Elixir should change shape family and colour scheme every 12–22 s, on a strong beat, with a smooth 3 s crossfade. Diagnostics shows the current program.
3. **Battery:** Polygon Pulse and Star Tunnel now include the music's waveform. Star Tunnel's walls are made of it.
4. **Ambience:** try the new *Water* (ripples from kicks, bass hits and treble rain) and *Swirl* (smoky stereo waveform rings).
5. Tell me which presets now feel right, and which WMP presets you remember that are still missing a quality you'd like. Names (e.g. a Battery or Ambience preset name) or a description both help.

## Phase 3 check (v0.3)

1. **Morph reactivity:** play something with a clear beat. In Diagnostics, *Drive bass / mid / high* should now swing with the music (roughly 0.1–1.0) instead of sitting at 0.9–1.0. Kicks should make the form swell and bounce, with a brightness pulse.
2. **The six new presets** (press ↓ to move between collections, ← → between presets):
   - *Alchemy › Liquid Ribbons* and *Spiral Elixir*
   - *Battery › Polygon Pulse* and *Star Tunnel*
   - *Ambience › Aurora* and *Nebula*

   On a track with drums, Battery's shapes should switch with strong hits (at most once per second). Alchemy's trails should surge on kicks. Ambience should stay soft but breathe with the music.
3. **Refresh-rate independence:** the trails should look equally long whether the window runs at 120 Hz or you drag it to a 60 Hz monitor.
4. **Performance:** please send me the Diagnostics *Render FPS* and *CPU per frame* for one preset from each collection, at fullscreen 1080p.
5. **Test signal:** *Dense mastered mix (124 BPM)* simulates loud, compressed modern music. It's useful for comparing presets.

## Phase 2 check (v0.2)

1. **Loopback timing fix:** with music playing, Diagnostics → *Frames/s received* should now read about 94, not 150. *Overlap trimmed* should stay at or near 0.
2. **Morph:** choose *Experimental › Morph* (or press ↓ from Bars & Waves).
   - Bass-heavy music should stretch the form into a rotating, squashing egg.
   - Cymbals and hiss should cover it in fine ripples.
   - Drum hits should kick it and throw out particles.
   - Panning should lean it left or right.
   - Silence leaves only a slow drift.
3. **Test signals with Morph:**
   - *Sine 100 Hz*: a tall egg, smooth surface.
   - *White noise*: fine ripples all over.
   - *Synthetic beat*: pulsing bulges and particle bursts.
   - *Sine 440 Hz, left only*: leans to the left.
4. **Performance:** at your normal window size, check *Render FPS* and *Geometry update* in Diagnostics, and go fullscreen on your 1080p display. Please send me the *Renderer: Morph* section of the panel.

## Phase 0 acceptance check (passed on your machine with v0.1)

1. **System audio:** play music in Spotify or YouTube. Levels, spectrum and waveform move, and **playback is not muted or changed**.
2. **Microphone:** pick your microphone in the input list and speak, clap, or hold it near rain or birdsong. Nothing is played back through the speakers.
3. **Silence:** pause the music. The status changes to *nothing playing*, the display drops to the floor and frames keep flowing (Diagnostics → Frames/s received stays near 94).
4. **Device changes:** with Default output selected, switch the Windows output device (e.g. speakers ↔ headphones). Capture follows within about a second. Unplug a USB device that is in use: the status shows *Reconnecting…* and it recovers when replugged.
5. **Test signals:** pick *Sine 440 Hz*. Diagnostics should read centroid ≈ 440 Hz, flatness ≈ 0.000, balance 0.00, correlation 1.00; the Low mid band reads about −9 dB. *Sine 440 Hz, opposite phase* reads correlation −1.00 and draws a horizontal line in Stereo field.

Please send me the Diagnostics panel values (or a screenshot) for items 1 and 2, plus anything that misbehaves. "Capture→draw" is the latency from audio arriving in the service to the frame being drawn; on my test setup it was 8 ms median.

## Troubleshooting

- **"The audio service is not built yet"** — run `scripts\build-service.ps1`, then restart the app.
- **`electron.exe` missing after setup** — some npm configurations skip install scripts. Run `node node_modules\electron\install.js` inside `apps\desktop-electron`.
- **Nothing moves with system audio** — check you picked an output device that is actually playing (Diagnostics → Device). Exclusive-mode apps (some DAWs, ASIO drivers) bypass the Windows mixer and cannot be captured by loopback.
- **Microphone shows nothing** — Windows Settings → Privacy & security → Microphone → allow desktop apps to access your microphone.
- **Service log** — the PowerShell window running `start.ps1` shows the audio service's diagnostic messages. It never logs audio.

## Repository

```text
apps/desktop-electron/     Electron shell: main, preload, renderer (engine/ mappings, visualizations/), JS tests
services/audio-capture-dotnet/  WASAPI capture + analysis sidecar (stdin/stdout NDJSON)
  Core/                    portable parts: ring buffer, format conversion, session, protocol, test signals
  Windows/                 NAudio WASAPI loopback/input and device notifications
libs/dsp-core/             pure C# DSP: FFT, spectra, bands, onsets, smoothing, normalisation
libs/feature-protocol/     the service ↔ app message protocol
tests/DspCore.Tests/       DSP fixture tests (no NuGet dependencies)
presets/builtin/           JSON presets (from Phase 4)
docs/                      architecture, DSP, Morph and collection mathematics, methods review, privacy
scripts/                   Windows setup/build/test/start
```

See [CHANGELOG.md](CHANGELOG.md) for what is in this version and its known limitations.
