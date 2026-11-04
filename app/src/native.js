// Bridge to Windows APIs through helper processes that write JSON lines. In order of preference:
//  1. Prebuilt native helper shipped inside the .exe (built on Windows by `npm run dist` / GitHub Actions)
//  2. Native helper compiled once on this PC with Windows' built-in C# compiler   (~15-25 MB)
//  3. Native "core" helper (no music) + PowerShell for music only                  (~15 + ~70 MB)
//  4. PowerShell for everything                                                      (~100 MB)
// Every failure is kept in `diag` and shown in Settings → Diagnostics (with a Copy button).
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
const WIN = process.env.WINDIR || 'C:\\Windows';
const MEDIA_CMDS = new Set(['toggle', 'next', 'prev', 'seek']);

function frameworkDir() {
  for (const fw of ['Framework64', 'Framework']) {
    const d = path.join(WIN, 'Microsoft.NET', fw, 'v4.0.30319');
    if (fs.existsSync(path.join(d, 'csc.exe'))) return d;
  }
  return null;
}

// facade assemblies live in the framework folder on most PCs, otherwise in the GAC
function findRef(fw, name) {
  const cands = [
    path.join(fw, name),
    path.join(fw, 'WPF', name),
    path.join(WIN, 'Microsoft.NET', 'assembly', 'GAC_MSIL', name.replace(/\.dll$/, ''), 'v4.0_4.0.0.0__b03f5f7f11d50a3a', name),
    path.join(WIN, 'Microsoft.NET', 'assembly', 'GAC_MSIL', name.replace(/\.dll$/, ''), 'v4.0_4.0.10.0__b03f5f7f11d50a3a', name)
  ];
  return cands.find((f) => fs.existsSync(f)) || null;
}

// UI Automation (Apple Music's own controls): only when Windows has the assemblies; `uia: false` builds without
function uiaRefs(fw) {
  const r = ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map((f) => findRef(fw, f));
  return r.every(Boolean) ? r : null;
}
function compileArgs(fw, variant, out, src, { uia = true } = {}) {
  const refs = ['System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll'];
  const u = uia ? uiaRefs(fw) : null;
  if (u) refs.push(...u);
  if (variant === 'full') {
    for (const f of ['System.Runtime.WindowsRuntime.dll', 'System.Runtime.dll', 'System.Threading.Tasks.dll', 'System.Runtime.InteropServices.WindowsRuntime.dll', 'System.IO.dll', 'System.ObjectModel.dll', 'System.Runtime.InteropServices.dll']) {
      const r = findRef(fw, f); if (r) refs.push(r);
    }
    const wm = path.join(WIN, 'System32', 'WinMetadata');
    try { for (const f of fs.readdirSync(wm)) if (f.endsWith('.winmd')) refs.push(path.join(wm, f)); } catch (_) {}
  }
  return ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/warn:0', '/codepage:65001',
    ...(variant === 'core' ? ['/define:NO_MEDIA'] : []), ...(u ? ['/define:UIA'] : []), `/out:${out}`, ...refs.map((r) => `/r:${r}`), src];
}

// Compile atoll-helper.cs -> <dir>/atoll-helper-<variant>-<hash>.exe (cached; a failed build isn't retried until the source changes)
function buildHelper(dir, variant = 'full', { force = false } = {}) {
  return new Promise((resolve) => {
    const src = unpacked(path.join(__dirname, 'helper', 'atoll-helper.cs'));
    let code;
    try { code = fs.readFileSync(src); } catch (e) { return resolve({ error: 'helper source missing: ' + e.message }); }
    const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, `atoll-helper-${variant}-${hash}.exe`);
    const failed = path.join(dir, `build-${variant}-${hash}.failed.txt`);
    if (fs.existsSync(exe)) return resolve({ exe });
    if (fs.existsSync(failed) && !force) return resolve({ error: summarize(fs.readFileSync(failed, 'utf8')), log: failed });
    const fw = frameworkDir();
    if (!fw) return resolve({ error: 'The C# compiler that comes with Windows (.NET Framework 4) was not found' });
    const tmp = exe + '.tmp.exe';
    let args = compileArgs(fw, variant, tmp, src);
    let firstLog = '';
    const run = () => execFile(path.join(fw, 'csc.exe'), args, { windowsHide: true, timeout: 90000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if ((err || !fs.existsSync(tmp)) && args.includes('/define:UIA')) {
        // the Apple Music extras didn't compile here: build without them rather than lose the native helper
        firstLog = `${stdout || ''}\n${stderr || ''}`;
        args = compileArgs(fw, variant, tmp, src, { uia: false });
        return run();
      }
      if (err || !fs.existsSync(tmp)) {
        const full = `csc ${args.join(' ')}\n\n${stdout || ''}\n${stderr || ''}\n${err ? err.message : ''}`;
        try { fs.writeFileSync(failed, full); } catch (_) {}
        return resolve({ error: summarize(full), log: failed, full });
      }
      try { fs.renameSync(tmp, exe); } catch (_) {}
      for (const f of fs.readdirSync(dir)) if (f.startsWith(`atoll-helper-${variant}-`) && f.endsWith('.exe') && path.join(dir, f) !== exe) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
      resolve({ exe, uia: args.includes('/define:UIA'), uiaError: firstLog ? summarize(firstLog) : '' });
    });
    run();
  });
}
// the interesting lines of a compiler log: "error CS...."
function summarize(log) {
  const errs = String(log).split(/\r?\n/).filter((l) => /error CS\d+|error:/i.test(l)).slice(0, 4);
  return (errs.length ? errs.join(' | ') : String(log).trim().split(/\r?\n/).slice(-3).join(' ')).slice(0, 600);
}

function prebuilt(variant) {
  const names = variant === 'full' ? ['atoll-helper.exe'] : ['atoll-helper-core.exe'];
  const dirs = [process.resourcesPath && path.join(process.resourcesPath, 'helper'), path.join(__dirname, '..', 'build', 'helper')].filter(Boolean);
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (fs.existsSync(f)) return f; }
  return null;
}

class NativeBridge extends EventEmitter {
  constructor() {
    super();
    this.procs = {};          // main, media
    this.stopping = false;
    this.kind = 'none';       // native | native-core+powershell | powershell | none
    this.diag = { build: {}, messages: [], stderr: [], parts: null, exe: null };
    this.mem = {};
    this.crashes = 0;
    this.alive = false;
  }

  note(where, msg) {
    const m = { at: new Date().toISOString().slice(11, 19), where, msg: String(msg).slice(0, 400) };
    this.diag.messages.push(m);
    if (this.diag.messages.length > 30) this.diag.messages.shift();
  }

  async start(helperDir) {
    if (process.platform !== 'win32') return false;
    let full = prebuilt('full'), core = null;
    if (!full && helperDir) {
      const r = await buildHelper(helperDir, 'full');
      if (r.exe) { full = r.exe; this.diag.uia = !!r.uia; if (r.uiaError) this.note('build (Apple Music controls)', r.uiaError); } else { this.diag.build.full = r.error; this.note('build (full)', r.error); }
    }
    if (!full) {
      core = prebuilt('core');
      if (!core && helperDir) {
        const r = await buildHelper(helperDir, 'core');
        if (r.exe) { core = r.exe; this.diag.uia = !!r.uia; if (r.uiaError) this.note('build (Apple Music controls)', r.uiaError); } else { this.diag.build.core = r.error; this.note('build (core)', r.error); }
      }
    }
    this.plan = full ? { main: ['exe', full] } : core ? { main: ['exe', core], media: ['ps', true] } : { main: ['ps', false] };
    this.kind = full ? 'native' : core ? 'native-core+powershell' : 'powershell';
    this.diag.exe = full || core;
    for (const role of Object.keys(this.plan)) this.spawn(role);
    return true;
  }

  spawn(role) {
    const [how, arg] = this.plan[role];
    let proc;
    if (how === 'exe') proc = spawn(arg, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    else {
      const script = unpacked(path.join(__dirname, 'native.ps1'));
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...(arg ? ['-MediaOnly'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    this.procs[role] = proc;
    const started = Date.now();
    proc.on('error', (e) => this.note(`${role} start`, e.message));
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      line = line.trim();
      if (!line.startsWith('{')) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { return; }
      if (role === 'main') this.alive = true;
      if (msg.type === 'diag' || msg.type === 'error') { this.note(msg.where || role, msg.msg); }
      if (msg.type === 'ready' && msg.parts) this.diag.parts = msg.parts;
      if (msg.type === 'mem') { this.mem[role] = Number(msg.ws) || 0; }
      // with a core helper, music comes only from the PowerShell media process
      if (this.plan.media && role === 'main' && (msg.type === 'media' || msg.type === 'art')) return;
      this.emit(msg.type, msg, role);
    });
    proc.stderr.on('data', (d) => {
      const t = d.toString().trim();
      if (!t) return;
      this.diag.stderr.push(t.slice(0, 500));
      if (this.diag.stderr.length > 10) this.diag.stderr.shift();
    });
    proc.on('exit', (code) => {
      if (this.procs[role] === proc) delete this.procs[role];
      if (role === 'main') this.alive = false;
      if (this.stopping) return;
      this.note(`${role} exited`, `code ${code}`);
      // a native helper that keeps dying at start -> PowerShell for everything
      if (how === 'exe' && Date.now() - started < 5000 && ++this.crashes >= 2) {
        this.note('fallback', 'native helper kept crashing; switching to PowerShell');
        for (const r of Object.keys(this.procs)) { try { this.procs[r].kill(); } catch (_) {} }
        this.plan = { main: ['ps', false] };
        this.kind = 'powershell';
        setTimeout(() => this.spawn('main'), 500);
        return;
      }
      if (!this.plan[role]) return;
      setTimeout(() => { if (!this.procs[role] && this.plan[role]) this.spawn(role); }, Math.min(30000, 1000 * 2 ** Math.min(5, this.crashes++)));
    });
  }

  send(cmd) {
    const role = this.plan && this.plan.media && MEDIA_CMDS.has(cmd.cmd) ? 'media' : 'main';
    const p = this.procs[role];
    if (p && p.stdin.writable) p.stdin.write(JSON.stringify(cmd) + '\n');
  }

  totalMem() { return Object.values(this.mem).reduce((a, b) => a + b, 0); }

  report() {
    return { kind: this.kind, exe: this.diag.exe, build: this.diag.build, parts: this.diag.parts, uia: this.diag.uia, messages: this.diag.messages, stderr: this.diag.stderr, mem: this.mem };
  }

  stop() {
    this.stopping = true;
    for (const p of Object.values(this.procs)) { try { p.stdin.end(); p.kill(); } catch (_) {} }
  }
}

module.exports = { NativeBridge, buildHelper, compileArgs, summarize };
