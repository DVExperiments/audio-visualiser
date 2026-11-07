# Privacy

- **Audio stays in memory.** System and microphone audio is analysed in the AudioCapture process, held only in a short ring buffer (under 3 seconds) and discarded. It is never written to disk, recorded, logged or sent anywhere.
- **No network use at run time.** The app makes no network requests; Three.js is loaded from local files. Setup downloads NuGet and npm packages once.
- **No monitoring.** Microphone audio is never played back through speakers or headphones, so the app cannot create feedback.
- **What is stored.** `%APPDATA%\Audio Visualisation Studio\settings.json` holds your chosen input (a Windows device ID), collection, preset, window position and display options. Delete the folder to reset.
- **Logs.** The audio service writes short diagnostic messages (errors, device events) to its console. They contain device names and error text, never audio data.
- **Analysis frames** contain features such as levels and spectra plus 512 raw samples per channel per frame for the waveform displays. They travel only between the two local processes over a pipe, and are not stored.
- **Microphone permission** is governed by Windows (Settings → Privacy & security → Microphone). The Electron renderer is denied all device permissions; only the native service opens audio devices.
