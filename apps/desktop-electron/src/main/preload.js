'use strict';
// Runs in an isolated, sandboxed context. Exposes a small, explicit API — never ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['frame', 'devices', 'analysis', 'status', 'stats', 'service', 'serviceError', 'window', 'tuning'];

contextBridge.exposeInMainWorld('studio', {
  on(channel, fn) {
    if (!CHANNELS.includes(channel) || typeof fn !== 'function') throw new Error(`unknown channel ${channel}`);
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  startCapture: (req) => ipcRenderer.invoke('capture:start', req),
  refreshDevices: () => ipcRenderer.invoke('capture:listDevices'),
  tune: (req) => ipcRenderer.invoke('capture:tune', req),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('window:setFullscreen', on),
  listDisplays: () => ipcRenderer.invoke('window:displays'),
  moveToDisplay: (id) => ipcRenderer.invoke('window:moveToDisplay', id),
});
