// The companion owns AppKit objects. Electron only receives small JSON events.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

class MacBridge extends EventEmitter {
  constructor() {
    super();
    this.kind = 'macOS';
    this.diag = { build: {}, uia: false, messages: [] };
    this.procs = {};
    this.mem = {};
    this.alive = false;
  }
  report() { return { ...this.diag, kind: this.kind, alive: this.alive }; }
  record(msg) {
    this.diag.messages.push({ where: 'macOS', at: new Date().toISOString(), msg });
    if (this.diag.messages.length > 12) this.diag.messages.shift();
  }
  start() {
    const child = spawn(path.join(process.resourcesPath, 'helper', 'atoll-mac'), [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.procs.main = child;
    child.on('error', e => this.record(e.message));
    child.stdin.on('error', e => this.record(e.message));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'ready') this.alive = true;
      if (m.type === 'mem') this.mem.main = m.ws;
      else if (m.type === 'diag') this.record(m.msg);
      else this.emit(m.type, m);
    });
    child.once('close', () => {
      this.alive = false;
      lines.close();
      delete this.procs.main;
      delete this.mem.main;
    });
  }
  send(m) { const input = this.procs.main?.stdin; if (input?.writable && !input.destroyed) input.write(JSON.stringify(m) + '\n'); }
  stop() { this.procs.main?.stdin.end(); }
}
module.exports = { NativeBridge: MacBridge };
