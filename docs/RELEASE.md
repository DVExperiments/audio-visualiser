# Releasing (Phase 6)

> No command line? See [DISTRIBUTING.md](DISTRIBUTING.md): GitHub can build the installer for you, or double-click `Build Installer.cmd`.

## Build the packages (on Windows)

Requirements: Windows 10/11 x64, Node.js 22+, .NET SDK 10.

```powershell
.\scripts\package.ps1
```

This runs both test suites, publishes the audio service as a **self-contained single file** (no .NET needed on users' PCs), and builds two packages in `apps\desktop-electron\dist`:

- `Audio Visualisation Studio-Setup-<version>.exe`: the installer. It installs per user, so there is no administrator prompt. You can choose the folder, and it creates Start menu and desktop shortcuts and an uninstaller. Settings are kept on uninstall.
- `Audio Visualisation Studio-Portable-<version>.exe`: a single file that runs from anywhere (for example a USB stick).

After building, `package.ps1` checks the package with `tools/verify-package.mjs`: every file the app loads must be inside it, or the build fails.

The packaged app finds its service in `resources\service-bin\AudioCapture.exe`. This was verified with a packaged build: the bundled service started and audio played with no development override.

## Code signing

Unsigned packages work, but Windows SmartScreen shows "Windows protected your PC" on first run, until users click **More info → Run anyway**. Signing removes that warning (an EV certificate does so immediately; a standard OV certificate once the publisher has built reputation).

1. Buy a code-signing certificate from a certificate authority. A `.pfx` file, or a cloud or HSM signing service, will work.
2. Before running `package.ps1`, set:
   ```powershell
   $env:CSC_LINK = 'C:\path\to\certificate.pfx'    # or the base64 of the .pfx
   $env:CSC_KEY_PASSWORD = '...'
   ```
3. electron-builder signs the app, the installer and the portable exe with signtool, using SHA-256 and a timestamp.

To refuse to build unsigned, set `"forceCodeSigning": true` under `build.win` in `apps/desktop-electron/package.json`.

## Long-session stability

Three layers. Run all of them before a release.

| Test | Command | Checks | Result (v0.20, this machine) |
|---|---|---|---|
| Analyser soak (C#) | `cd tests\DspCore.Tests; dotnet run -c Release -- --soak 120` | memory flat, 93.75 frames/s, every frame finite | 10 simulated min: managed memory 0.60–0.61 MB (−0.01 MB), 0 non-finite, 22× real time |
| Pipeline soak (JS) | `cd apps\desktop-electron; npm run soak` (or `node --expose-gc test/soak/run.mjs 8` for 8 h) | heap flat after GC, every drive and model output finite, automatic mode working | 2 simulated h: heap 5.45 → 5.53 MB, 0 non-finite, 59 automatic switches, 70× real time |
| Real app | `$env:AUDIOVIZ_SOAK=1; npm start` (Auto mode on), then read `%APPDATA%\Audio Visualisation Studio\logs\app.log` | every 30 s: process memory, renderer heap, live canvases, current preset | 4.5 min, 9 presets across all collections with transitions: always 1 canvas (no leaked GPU contexts), memory 450–532 MB varying with the preset, no upward trend (software renderer; lower on a real GPU) |

**Overnight check on real hardware (recommended once per release).** Enable Auto mode (timer, 1 minute, all visualisations) and launch with `AUDIOVIZ_SOAK=1`. Play an album or a radio stream on loop overnight, then check that `memoryMB` shows no upward trend and `canvases` stays at 1. For precise renderer-heap figures, add `--enable-precise-memory-info` (Chromium otherwise rounds them).

**Known.** The analyser allocates about 3 MB/s of short-lived arrays (about 32 KB per frame, copied into each frame). .NET's generation-0 collector absorbs this cheaply, and memory stays flat. Reducing it is a possible future optimisation.

## Support

- **Logs:** `%APPDATA%\Audio Visualisation Studio\logs\app.log` (rotates at 1 MB, keeping `app.1.log`). Settings › **Open log folder** opens it. The log records start-up (version, packaged or not), audio-service messages, errors and uncaught exceptions. It never records audio.
- **Single instance:** launching the app again focuses the running window.

## Release checklist

- [ ] Version bumped in `apps/desktop-electron/package.json` and `services/audio-capture-dotnet/AudioCapture.csproj`; CHANGELOG entry written
- [ ] `.\scripts\package.ps1` passes (both test suites included)
- [ ] Soak tests pass (C# 120 min, JS 8 h); one overnight real-app soak on a real GPU
- [ ] Install from the installer on a clean Windows user account: first run, loopback capture, microphone (permission prompt), uninstall
- [ ] Portable exe runs from a different folder and keeps its settings
- [ ] Signed (if a certificate is available): right-click the exe › Properties › Digital Signatures
- [ ] THIRD_PARTY_NOTICES.md is current (Electron, Three.js, KaTeX, NAudio, .NET runtime)
