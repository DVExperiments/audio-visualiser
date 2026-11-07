'use strict';
// v0.20: a small rotating log file for support (service messages, errors, crashes).
// app.log grows to `maxBytes`, then becomes app.1.log (the previous app.1.log is discarded),
// so the logs never take more than 2 × maxBytes. Lines also go to the console.
const fs = require('node:fs');
const path = require('node:path');

function createLog(dir, { maxBytes = 1024 * 1024, mirror = console } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'app.log'), old = path.join(dir, 'app.1.log');
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* new file */ }
  function write(level, args) {
    const text = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`;
    try {
      if (size + Buffer.byteLength(line) > maxBytes) { try { fs.renameSync(file, old); } catch { /* none yet */ } size = 0; }
      fs.appendFileSync(file, line); size += Buffer.byteLength(line);
    } catch { /* logging must never crash the app */ }
    (mirror[level] || mirror.log).call(mirror, text);
  }
  return { dir, file, info: (...a) => write('info', a), warn: (...a) => write('warn', a), error: (...a) => write('error', a), log: (...a) => write('info', a) };
}
module.exports = { createLog };
