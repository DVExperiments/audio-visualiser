# Third-party notices

| Component | Version | Licence | Used for |
|---|---|---|---|
| NAudio.Wasapi, NAudio.Core | 2.2.1 | MIT, © 2020 Mark Heath | WASAPI capture and device enumeration |
| .NET runtime and libraries | 10.0 | MIT, © .NET Foundation and contributors | audio service runtime; bundled inside AudioCapture.exe in release packages (self-contained) |
| electron-builder | 26.18.0 | MIT | build tool only (packaging); not shipped |
| three.js | 0.186.1 | MIT, © 2010–2026 three.js authors | 3D rendering, post-processing (Morph) |
| KaTeX | 0.19.0 | MIT, © 2013–2026 Khan Academy and contributors | typesetting the equations in the How it works panel |
| Electron | 44.9.3 | MIT, © Electron contributors / GitHub Inc. | desktop shell (bundles Chromium under BSD-style licences and Node.js under MIT; see `LICENSES.chromium.html` in the Electron distribution) |

The full licence texts ship with each package (`~/.nuget/packages/naudio.*/2.2.1/`, `apps/desktop-electron/node_modules/electron/`, `apps/desktop-electron/node_modules/three/LICENSE`). They must be included with any binary distribution; Phase 6 will bundle them in the installer.
