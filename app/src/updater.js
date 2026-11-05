// In-app updates from the GitHub Releases of this repo (package.json -> build.publish).
//
//  Windows: electron-updater reads latest.yml next to the NSIS installer, downloads in the background and
//           installs when the user clicks Restart (or when Atoll next quits).
//  macOS:   Atoll is ad hoc signed, which Squirrel.Mac refuses to update, so this file does it by hand:
//           latest-mac.json -> download Atoll-macOS-arm64.zip -> check sha256, signature, bundle id and
//           version -> on Restart a small detached shell script swaps Atoll.app after Atoll exits and
//           reopens it. The old app is kept as a backup and put back if the swap fails.
//
// Nothing is ever installed while the user is working: only on their click (macOS and Windows) or at the
// next quit (Windows). Disabled in tests and --demo unless ATOLL_UPDATE_FEED points at a test feed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const CHECK_EVERY_MS = 6 * 3600e3;
const FIRST_CHECK_MS = 20e3;
const MAC_ASSET = /^[A-Za-z0-9._-]+\.zip$/;

// ---------------- pure helpers (unit-tested) ----------------

// 1.2.3 vs 1.10.0, ignoring a leading v; a pre-release (1.2.3-beta) sorts before its release.
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
    return m ? { n: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)], pre: m[4] || '' } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

// The release page and the "latest asset" base URL for this repo.
function feedInfo(pkg) {
  const pub = (((pkg || {}).build || {}).publish || [])[0] || {};
  if (!pub.owner || !pub.repo) return null;
  const page = `https://github.com/${pub.owner}/${pub.repo}/releases`;
  return { owner: pub.owner, repo: pub.repo, releasesPage: page, base: `${page}/latest/download` };
}

function allowedUrl(url, testFeed) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol === 'https:') return true;
  return !!testFeed && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
}

// Validate latest-mac.json. Returns { version, url, sha256, size, notes } or { reject: 'reason' }.
// `file` must be a bare asset name resolved against the feed base: a feed can never point somewhere else.
function parseMacFeed(json, { base, current, macVersion = '99', testFeed = false }) {
  if (!json || typeof json !== 'object') return { reject: 'feed is not an object' };
  const version = String(json.version || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(version)) return { reject: 'bad version' };
  if (!MAC_ASSET.test(String(json.file || ''))) return { reject: 'bad file name' };
  const sha256 = String(json.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { reject: 'bad sha256' };
  if (json.minMacOS && compareVersions(macVersion, json.minMacOS) < 0) return { reject: `needs macOS ${json.minMacOS}` };
  const url = `${String(base).replace(/\/+$/, '')}/${json.file}`;
  if (!allowedUrl(url, testFeed)) return { reject: 'feed URL is not https' };
  const cmp = compareVersions(version, current);
  if (!(cmp > 0)) return { reject: cmp === 0 ? 'already current' : 'older than the running version', current: true };
  return { version, url, sha256, size: Number(json.size) || 0, notes: String(json.notes || '').slice(0, 6000) };
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// The detached script that swaps the app once Atoll has quit. Paths are passed as arguments, never spliced in.
const INSTALL_SCRIPT = `#!/bin/sh
# Atoll updater: wait for Atoll to quit, swap the app, reopen it. The old app is restored if anything fails.
PID="$1"; NEW="$2"; DEST="$3"; BACKUP="$4"
n=0
while kill -0 "$PID" 2>/dev/null && [ "$n" -lt 100 ]; do sleep 0.3; n=$((n+1)); done
if [ -e "$DEST" ]; then mv "$DEST" "$BACKUP" || { [ -n "$ATOLL_NO_RELAUNCH" ] || /usr/bin/open "$DEST"; exit 1; }; fi
reopen() { [ -n "$ATOLL_NO_RELAUNCH" ] || /usr/bin/open "$DEST"; }
if /usr/bin/ditto "$NEW" "$DEST"; then
  /usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
  /usr/bin/touch "$DEST"
  reopen
else
  [ -e "$DEST" ] && mv "$DEST" "$DEST.failed-update"
  mv "$BACKUP" "$DEST"
  reopen
fi
`;

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120000, maxBuffer: 4 << 20, ...opts }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

// ---------------- updater ----------------
function createUpdater({ app, net, getSettings, sendAll, notify, pkg, env = process.env, platform = process.platform, userData, log = () => {} }) {
  const info = feedInfo(pkg);
  const testFeed = env.ATOLL_TEST === '1' && !!env.ATOLL_UPDATE_FEED;
  const base = testFeed ? env.ATOLL_UPDATE_FEED : info && info.base;
  const mac = platform === 'darwin';
  const current = app.getVersion();
  const updatesDir = path.join(userData || app.getPath('userData'), 'updates');

  const state = {
    state: 'idle',           // idle | checking | downloading | ready | uptodate | error | unavailable
    current, version: null, notes: '', progress: 0, error: '', checkedAt: 0,
    canInstall: true,        // false: the app's folder isn't writable, so the button opens the releases page
    releasesPage: info ? info.releasesPage : '', mechanism: mac ? 'custom' : 'electron-updater'
  };
  let ready = null;          // mac: { app, version }
  let busy = false;
  let timer = null, firstTimer = null;
  let notifiedFor = null;
  let winUpdater = null;

  const set = (patch) => { Object.assign(state, patch); try { sendAll('updater', { ...state }); } catch (_) {} };
  // real builds use the GitHub feed; tests only get updates from an explicit test feed
  const enabled = () => testFeed || (!!base && env.ATOLL_TEST !== '1');

  function bundlePath() { return path.resolve(process.execPath, '..', '..', '..'); }
  function writable() {
    try { const b = bundlePath(); fs.accessSync(b, fs.constants.W_OK); fs.accessSync(path.dirname(b), fs.constants.W_OK); return b.endsWith('.app'); }
    catch (_) { return false; }
  }

  async function fetchJson(url) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await net.fetch(url, { signal: ac.signal, headers: { 'User-Agent': `Atoll/${current}`, Accept: 'application/json' }, redirect: 'follow' });
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw new Error(`update feed answered ${res.status}`);
      return { json: await res.json() };
    } finally { clearTimeout(t); }
  }

  // ---- macOS
  async function checkMac(manual) {
    const got = await fetchJson(`${base.replace(/\/+$/, '')}/latest-mac.json`);
    if (got.missing) { set({ state: manual ? 'error' : 'idle', error: manual ? 'No update information was found for this app yet.' : '', checkedAt: Date.now() }); return; }
    const verdict = parseMacFeed(got.json, { base, current, macVersion: macOSVersion(), testFeed });
    if (verdict.reject) {
      if (verdict.current) { set({ state: 'uptodate', version: null, error: '', checkedAt: Date.now() }); return; }
      throw new Error(`Ignoring the update feed: ${verdict.reject}`);
    }
    if (ready && ready.version === verdict.version) { set({ state: 'ready', version: verdict.version, notes: verdict.notes, checkedAt: Date.now() }); return; }
    set({ state: 'downloading', version: verdict.version, notes: verdict.notes, progress: 0, error: '', checkedAt: Date.now() });
    const staged = await downloadMac(verdict);
    ready = { app: staged, version: verdict.version };
    set({ state: 'ready', progress: 1, canInstall: writable() });
    maybeNotify(verdict.version);
  }
  function macOSVersion() {
    try { return execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(); } catch (_) { return '99'; }
  }
  async function downloadMac(v) {
    fs.mkdirSync(updatesDir, { recursive: true });
    const zip = path.join(updatesDir, `Atoll-${v.version}.zip`);
    const out = path.join(updatesDir, `Atoll-${v.version}`);
    fs.rmSync(zip, { force: true }); fs.rmSync(out, { recursive: true, force: true });
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15 * 60e3);
    try {
      const res = await net.fetch(v.url, { signal: ac.signal, headers: { 'User-Agent': `Atoll/${current}` }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`download answered ${res.status}`);
      const total = Number(res.headers.get('content-length')) || v.size || 0;
      let got = 0, last = 0;
      const hash = crypto.createHash('sha256');
      const tap = async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk); got += chunk.length;
          if (total && Date.now() - last > 250) { last = Date.now(); set({ progress: Math.min(0.99, got / total) }); }
          yield chunk;
        }
      };
      await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(zip));
      if (hash.digest('hex') !== v.sha256) throw new Error('The downloaded update did not match its checksum, so it was discarded.');
    } finally { clearTimeout(t); }
    fs.mkdirSync(out, { recursive: true });
    await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
    const staged = path.join(out, 'Atoll.app');
    if (!fs.existsSync(staged)) throw new Error('The update did not contain Atoll.app.');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]).catch((e) => { throw new Error('The update failed its signature check: ' + String(e.stderr || e.message).split('\n')[0]); });
    const plist = path.join(staged, 'Contents', 'Info.plist');
    const read = async (key) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).trim();
    if ((await read('CFBundleIdentifier')) !== 'app.atoll.notch') throw new Error('The update is not Atoll (wrong bundle id).');
    if ((await read('CFBundleShortVersionString')) !== v.version) throw new Error('The update version does not match its feed.');
    fs.rmSync(zip, { force: true });
    return staged;
  }
  function installMac() {
    if (!ready || !fs.existsSync(ready.app)) throw new Error('No update is ready.');
    const dest = bundlePath();
    if (!writable()) throw new Error('Atoll cannot replace itself where it is installed.');
    const script = path.join(updatesDir, 'install.sh');
    const backup = path.join(updatesDir, 'Atoll-previous.app');
    fs.rmSync(backup, { recursive: true, force: true });
    fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
    const child = spawn('/bin/sh', [script, String(process.pid), ready.app, dest, backup], { detached: true, stdio: 'ignore', env: { ...process.env, ...(testFeed ? { ATOLL_NO_RELAUNCH: '1' } : {}) } }); // a test feed never reopens the app
    child.unref();
    log('update: handing over to the installer script');
    app.quit();
  }

  // ---- Windows (electron-updater)
  function windowsUpdater() {
    if (winUpdater) return winUpdater;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    if (testFeed) { autoUpdater.setFeedURL({ provider: 'generic', url: base }); autoUpdater.forceDevUpdateConfig = true; }
    const notes = (i) => (Array.isArray(i.releaseNotes) ? i.releaseNotes.map((n) => n.note).join('\n') : String(i.releaseNotes || '')).replace(/<[^>]+>/g, '').slice(0, 6000);
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
    autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, notes: notes(i), progress: 0 }));
    autoUpdater.on('update-not-available', () => set({ state: 'uptodate', version: null, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.min(0.99, (p.percent || 0) / 100) }));
    autoUpdater.on('update-downloaded', (i) => { set({ state: 'ready', version: i.version, notes: notes(i), progress: 1, checkedAt: Date.now() }); maybeNotify(i.version); });
    autoUpdater.on('error', (e) => set({ state: 'error', error: friendly(e), checkedAt: Date.now() }));
    return (winUpdater = autoUpdater);
  }

  const friendly = (e) => {
    const m = String((e && e.message) || e || '').split('\n')[0];
    return /ENOTFOUND|ECONN|ETIMEDOUT|network|fetch failed|aborted/i.test(m) ? 'Could not reach the update server. Check your connection.' : m.slice(0, 200);
  };
  function maybeNotify(version) {
    if (notifiedFor === version) return;
    notifiedFor = version;
    try { notify({ title: `Atoll ${version} is ready`, body: 'Open Settings → About and choose Restart to update.', icon: 'bell', source: 'atoll', duration: 7000 }); } catch (_) {}
  }

  // ---- public
  async function check({ manual = false } = {}) {
    if (busy || state.state === 'downloading') return { ...state };
    if (!enabled()) { set({ state: 'unavailable', error: info ? '' : 'This build has no update source configured.' }); return { ...state }; }
    if (state.state === 'ready') return { ...state };
    busy = true;
    try {
      if (state.state !== 'downloading') set({ state: 'checking', error: '' });
      if (mac) await checkMac(manual);
      else {
        if (!app.isPackaged && !testFeed) { set({ state: 'unavailable', error: 'Updates only work in the installed app.' }); return { ...state }; }
        const result = await windowsUpdater().checkForUpdates();
        // The library resolves its check before the automatic download finishes. Observe that
        // promise too, so a checksum/network failure is handled and concurrent checks stay blocked.
        if (result && result.downloadPromise) await result.downloadPromise;
      }
    } catch (e) {
      log('update check failed: ' + (e && e.message));
      set({ state: manual || state.state === 'downloading' || state.state === 'error' ? 'error' : 'idle', error: friendly(e), checkedAt: Date.now() });
    } finally { busy = false; }
    return { ...state };
  }
  function install() {
    if (state.state !== 'ready') return { ok: false, error: 'No update is ready.' };
    try {
      if (mac) {
        if (!writable()) return { ok: false, openPage: state.releasesPage, error: 'Atoll cannot replace itself where it is installed. Download the new version instead.' };
        installMac();
      } else {
        windowsUpdater().quitAndInstall(true, true);
        // electron-updater can refuse synchronously by emitting 'error' without throwing.
        if (state.state === 'error') return { ok: false, error: state.error };
      }
      return { ok: true };
    } catch (e) { set({ state: 'error', error: friendly(e) }); return { ok: false, error: friendly(e) }; }
  }
  function start() {
    try { fs.mkdirSync(updatesDir, { recursive: true }); for (const n of fs.readdirSync(updatesDir)) fs.rmSync(path.join(updatesDir, n), { recursive: true, force: true }); } catch (_) {}
    if (!enabled()) { set({ state: 'unavailable' }); return; }
    const auto = () => { if ((getSettings() || {}).autoUpdate !== false) check(); };
    firstTimer = setTimeout(auto, Number(env.ATOLL_UPDATE_DELAY_MS) || FIRST_CHECK_MS);
    timer = setInterval(auto, CHECK_EVERY_MS);
  }
  function stop() { clearTimeout(firstTimer); clearInterval(timer); }

  return { start, stop, check, install, getState: () => ({ ...state }), _state: state };
}

module.exports = { createUpdater, compareVersions, feedInfo, parseMacFeed, sha256OfFile, allowedUrl, INSTALL_SCRIPT };
