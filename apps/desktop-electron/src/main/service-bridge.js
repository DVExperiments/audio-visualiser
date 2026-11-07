'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { parseServiceLine, PROTOCOL_VERSION } = require('./protocol');

/**
 * Owns the AudioCapture.exe child process. Emits 'message' for each validated message,
 * 'state' for bridge-level state ('missing' | 'starting' | 'running' | 'crashed').
 * Re-sends the last capture request after a crash, with backoff.
 */
class ServiceBridge extends EventEmitter {
  constructor({ command, args = [], log = console }) {
    super();
    this.command = command;
    this.args = args;
    this.log = log;
    this.proc = null;
    this.buffer = '';
    this.lastStart = null;
    this.restarts = 0;
    this.stopping = false;
    this.invalidLines = 0;
  }

  start() {
    if (!this.command || (this.command.endsWith('.exe') && !fs.existsSync(this.command))) {
      this.emit('state', { state: 'missing', path: this.command });
      return;
    }
    this.stopping = false;
    this.emit('state', { state: 'starting' });
    const proc = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (s) => this.log.warn(`[audio-service] ${s.trimEnd()}`));
    proc.on('error', (err) => {
      this.log.error(`[audio-service] spawn failed: ${err.message}`);
      this.emit('state', { state: 'missing', path: this.command, message: err.message });
    });
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopping) return;
      const delay = Math.min(5000, 500 * 2 ** this.restarts++);
      this.log.error(`[audio-service] exited (code ${code}, signal ${signal}); restarting in ${delay} ms`);
      this.emit('state', { state: 'crashed', code, restartInMs: delay });
      setTimeout(() => { if (!this.stopping) this.start(); }, delay);
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 4 * 1024 * 1024) { this.buffer = ''; return; } // runaway guard
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      const msg = parseServiceLine(line);
      if (!msg) { if (this.invalidLines++ < 20) this.log.warn('[audio-service] dropped invalid line'); continue; }
      if (msg.type === 'hello') {
        if (msg.protocol !== PROTOCOL_VERSION) {
          this.emit('message', { type: 'error', code: 'protocol', message: `Audio service speaks protocol ${msg.protocol}, app expects ${PROTOCOL_VERSION}. Rebuild the service.` });
        }
        this.emit('state', { state: 'running' });
        if (this.lastStart) this.send(this.lastStart); // resume after restart
        if (this.lastTune) this.send(this.lastTune);
      }
      if (msg.type === 'frame' && msg.seq > 500) this.restarts = 0;
      this.emit('message', msg);
    }
  }

  send(cmd) {
    if (cmd.cmd === 'start') this.lastStart = cmd;
    if (cmd.cmd === 'stop') this.lastStart = null;
    if (cmd.cmd === 'tune') this.lastTune = cmd;
    if (!this.proc || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(cmd) + '\n');
    return true;
  }

  stop() {
    this.stopping = true;
    const p = this.proc;
    if (!p) return;
    try { p.stdin.write('{"cmd":"shutdown"}\n'); p.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (p.exitCode === null) p.kill(); }, 1500);
  }
}

module.exports = { ServiceBridge };
