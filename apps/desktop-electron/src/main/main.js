'use strict';
const { app, BrowserWindow, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const { ServiceBridge } = require('./service-bridge');
const { validateStartRequest, validateTuneRequest } = require('./protocol');
const { SettingsStore } = require('./settings');
const { createLog } = require('./log');

// v0.20: one instance only. A second launch focuses the existing window (two copies would mean two
// audio services capturing the same device).
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
let log = console;
process.on('uncaughtException', (e) => { log.error('uncaught exception', e); });
process.on('unhandledRejection', (e) => { log.error('unhandled rejection', e instanceof Error ? e : String(e)); });

const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
let win = null;
let bridge = null;
let settings = null;
let lastDevices = null;
let lastStatus = null;
let lastAnalysis = null;

function serviceCommand() {
  // Override for development/testing: AUDIOVIZ_SERVICE_CMD="dotnet path\to\AudioCapture.dll"
  const override = process.env.AUDIOVIZ_SERVICE_CMD;
  if (override) {
    const parts = override.match(/(?:[^\s"]+|"[^"]*")+/g).map((p) => p.replace(/^"|"$/g, ''));
    return { command: parts[0], args: parts.slice(1) };
  }
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
  return { command: path.join(base, 'service-bin', 'AudioCapture.exe'), args: [] };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function isTrustedSender(event) {
  try { return event.senderFrame && new URL(event.senderFrame.url).protocol === 'file:'; } catch { return false; }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('untrusted sender');
    return fn(...args);
  });
}

function pickBounds(s) {
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === s.window.displayId) || screen.getPrimaryDisplay();
  const b = s.window.bounds;
  if (b) {
    const onScreen = displays.some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    if (onScreen) return b;
  }
  const a = target.workArea;
  const width = Math.min(1280, a.width), height = Math.min(800, a.height);
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}

function createWindow() {
  const s = settings.data;
  win = new BrowserWindow({
    ...pickBounds(s),
    minWidth: 480, minHeight: 320,
    backgroundColor: '#000000',
    title: 'Audio Visualisation Studio',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.loadFile(RENDERER_HTML);
  win.once('ready-to-show', () => {
    win.show();
    if (s.window.fullscreen || s.ui.startFullscreen) win.setFullScreen(true);   // v0.13: "always start in full screen"
  });

  // Navigation lock-down: the renderer can never leave index.html or open windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.AUDIOVIZ_DEBUG) {
    // Electron ≥35 passes a single event object; older versions pass (event, level, message)
    win.webContents.on('console-message', (e, level, message) => console.log(`[renderer] ${message ?? e.message}`));
  }

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    const bounds = win.getBounds();
    settings.update({ window: { bounds, displayId: screen.getDisplayMatching(bounds).id } });
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('enter-full-screen', () => { settings.update({ window: { fullscreen: true } }); send('window', { fullscreen: true }); });
  win.on('leave-full-screen', () => { settings.update({ window: { fullscreen: false } }); send('window', { fullscreen: false }); });
  win.on('closed', () => { win = null; });

  // Renderer reloads (Ctrl+R in dev) need the cached state again.
  win.webContents.on('did-finish-load', () => {
    if (lastDevices) send('devices', lastDevices);
    if (lastAnalysis) send('analysis', lastAnalysis);
    if (lastStatus) send('status', lastStatus);
  });
}

function startBridge() {
  const { command, args } = serviceCommand();
  bridge = new ServiceBridge({ command, args, log });
  bridge.on('state', (st) => send('service', st));
  bridge.on('message', (m) => {
    switch (m.type) {
      case 'frame': send('frame', m); break;
      case 'devices': lastDevices = m; send('devices', m); break;
      case 'analysis': lastAnalysis = m; send('analysis', m); break;
      case 'status': lastStatus = m; send('status', m); break;
      case 'stats': send('stats', m); break;
      case 'tuning': send('tuning', m); break;
      case 'error': send('serviceError', m); break;
      default: break;
    }
  });
  // Start capture with the saved input as soon as the service says hello (and again after any restart).
  bridge.lastStart = validateStartRequest(settings.data.input) || { cmd: 'start', source: 'loopback' };
  bridge.start();
}

app.whenReady().then(() => {
  // a second instance must not start anything (found in testing: it logged a start, and would have
  // begun creating a window and a second audio service before quitting)
  if (!primaryInstance) return;
  log = createLog(path.join(app.getPath('userData'), 'logs'));
  log.info(`Audio Visualisation Studio ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.arch}${app.isPackaged ? ', packaged' : ''})`);
  settings = new SettingsStore(app.getPath('userData'));
  settings.load();

  // Deny every permission request: the renderer needs no camera/mic/notifications.
  // (Audio is captured natively in the service, never in the renderer.)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  handle('settings:get', () => settings.data);
  handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged }));
  handle('app:openLogs', () => shell.openPath(log.dir ?? app.getPath('userData')));

  // v0.20 soak mode (AUDIOVIZ_SOAK=1): every 30 s, log process memory, renderer heap, live canvases
  // and the current preset, so long sessions can be checked for leaks (docs/RELEASE.md).
  if (process.env.AUDIOVIZ_SOAK) {
    const t0 = Date.now();
    setInterval(async () => {
      if (!win || win.isDestroyed()) return;
      const procs = app.getAppMetrics(), mb = procs.reduce((s, p) => s + (p.memory?.workingSetSize ?? 0), 0) / 1024;
      let r = '?';
      try { r = await win.webContents.executeJavaScript(`[(performance.memory?.usedJSHeapSize ?? 0) / 1048576, document.querySelectorAll('#stage canvas').length, document.getElementById('preset')?.selectedOptions[0]?.text].join('|')`); } catch { /* reloading */ }
      const [heap, canvases, preset] = String(r).split('|');
      log.info(`soak t=${((Date.now() - t0) / 1000).toFixed(0)}s processes=${procs.length} memoryMB=${mb.toFixed(0)} rendererHeapMB=${Number(heap).toFixed(1)} canvases=${canvases} preset=${preset}`);
    }, 30000);
  }
  handle('settings:update', (patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('bad patch');
    // the renderer may only change these sections
    const allowed = {};
    for (const k of ['collection', 'preset', 'ui', 'auto', 'library', 'influence', 'audio']) if (k in patch) allowed[k] = patch[k];
    return settings.update(allowed);
  });
  handle('capture:start', (req) => {
    const cmd = validateStartRequest(req);
    if (!cmd) throw new Error('invalid capture request');
    settings.update({ input: { source: cmd.source, deviceId: cmd.deviceId ?? null, signal: cmd.signal ?? settings.data.input.signal } });
    bridge.send(cmd);
    return true;
  });
  handle('capture:tune', (req) => {
    const cmd = validateTuneRequest(req);
    if (!cmd) throw new Error('invalid tuning');
    bridge.send(cmd);
    return true;
  });
  handle('capture:listDevices', () => { bridge.send({ cmd: 'listDevices' }); return true; });
  handle('window:toggleFullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win?.isFullScreen() ?? false; });
  handle('window:setFullscreen', (on) => { if (win) win.setFullScreen(!!on); return true; });
  handle('window:displays', () => {
    const current = win ? screen.getDisplayMatching(win.getBounds()).id : null;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id, label: `Display ${i + 1} — ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''}`,
      current: d.id === current,
    }));
  });
  handle('window:moveToDisplay', (id) => {
    const d = screen.getAllDisplays().find((x) => x.id === id);
    if (!d || !win) return false;
    const wasFs = win.isFullScreen();
    const go = () => {
      const a = d.workArea;
      const w = Math.min(win.getBounds().width, a.width), h = Math.min(win.getBounds().height, a.height);
      win.setBounds({ x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h });
      settings.update({ window: { displayId: d.id } });
      if (wasFs) win.setFullScreen(true);
    };
    if (wasFs) { win.once('leave-full-screen', go); win.setFullScreen(false); } else go();
    return true;
  });

  createWindow();
  startBridge();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { bridge?.stop(); settings?.flush(); });
