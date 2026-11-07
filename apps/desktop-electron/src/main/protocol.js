'use strict';
// Validation for everything that crosses a process boundary:
//   service (stdout NDJSON) → main, and renderer (IPC) → main.
// Anything that fails validation is dropped and logged; it is never forwarded.

const PROTOCOL_VERSION = 1;
const SOURCES = new Set(['loopback', 'input', 'synthetic']);
const SIGNALS = new Set(['sine100', 'sine440', 'sine1000', 'noise', 'impulses', 'leftOnly', 'antiphase', 'sweep', 'beat', 'denseMix', 'lissajous']);
const MAX_LINE = 64 * 1024;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';
const isStr = (v, max = 512) => typeof v === 'string' && v.length <= max;
const numArr = (v, min, max) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(isNum);

function validateFrame(m) {
  return isNum(m.seq) && isNum(m.t) && isNum(m.wall) && isNum(m.sr) &&
    isBool(m.silent) && isBool(m.clip) && isBool(m.gap) && isBool(m.synthetic) &&
    numArr(m.rms, 3, 3) && numArr(m.dbfs, 3, 3) && numArr(m.peak, 2, 2) && isNum(m.level) &&
    numArr(m.bands, 7, 7) && numArr(m.bandsNorm, 7, 7) && numArr(m.spec, 1, 512) &&
    // added in v0.3 (protocol 1 additions): optional so an older service still works
    (m.bandsPulse === undefined || numArr(m.bandsPulse, 7, 7)) && (m.levelPulse === undefined || isNum(m.levelPulse)) &&
    isNum(m.flux) && isNum(m.fluxLog) &&
    m.onset && typeof m.onset === 'object' && isBool(m.onset.on) && isNum(m.onset.strength) &&
    isNum(m.onset.threshold) && isNum(m.onset.confidence) &&
    isNum(m.centroid) && isNum(m.flatness) && isNum(m.rolloff) && isNum(m.zcr) &&
    isNum(m.balance) && isNum(m.correlation) && isNum(m.width) &&
    numArr(m.waveL, 0, 8192) && numArr(m.waveR, 0, 8192) && m.waveL.length === m.waveR.length;
}

function validateDeviceList(list) {
  return Array.isArray(list) && list.length <= 256 &&
    list.every((d) => d && isStr(d.id) && isStr(d.name) && isBool(d.isDefault));
}

/** Parse and validate one stdout line from the audio service. Returns the message or null. */
function parseServiceLine(line) {
  if (typeof line !== 'string' || line.length === 0 || line.length > MAX_LINE) return null;
  let m;
  try { m = JSON.parse(line); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || !isStr(m.type, 32)) return null;
  switch (m.type) {
    case 'frame': return validateFrame(m) ? m : null;
    case 'hello': return isNum(m.protocol) ? m : null;
    case 'analysis':
      return isNum(m.sr) && isNum(m.fftSize) && isNum(m.hop) && isNum(m.frameRate) &&
        Array.isArray(m.bands) && numArr(m.logEdges, 2, 513) ? m : null;
    case 'devices':
      return validateDeviceList(m.render) && validateDeviceList(m.capture) ? m : null;
    case 'status': return isStr(m.state, 32) ? m : null;
    case 'stats': return isNum(m.t) ? m : null;
    case 'error': return isStr(m.code, 64) && isStr(m.message, 2048) ? m : null;
    case 'pong': return m;
    case 'tuning': return isNum(m.gainDb) && isNum(m.silenceDb) && isNum(m.pulseRangeDb) ? m : null;
    default: return null;
  }
}

/** Validate a capture request coming from the renderer. Returns a sanitised command or null. */
function validateStartRequest(req) {
  if (!req || typeof req !== 'object') return null;
  if (!SOURCES.has(req.source)) return null;
  const out = { cmd: 'start', source: req.source };
  if (req.deviceId != null) {
    if (!isStr(req.deviceId, 512)) return null;
    out.deviceId = req.deviceId;
  }
  if (req.source === 'synthetic') {
    if (!SIGNALS.has(req.signal)) return null;
    out.signal = req.signal;
  }
  return out;
}

/** Validate an input-tuning request from the renderer (calibration / Audio settings). */
function validateTuneRequest(req) {
  if (!req || typeof req !== 'object') return null;
  const ok = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
  if (!ok(req.gainDb, -24, 36) || !ok(req.silenceDb, -100, -20) || !ok(req.pulseRangeDb, 3, 16)) return null;
  return { cmd: 'tune', gainDb: req.gainDb, silenceDb: req.silenceDb, pulseRangeDb: req.pulseRangeDb };
}

module.exports = { validateTuneRequest, PROTOCOL_VERSION, SIGNALS, parseServiceLine, validateStartRequest, validateFrame };
