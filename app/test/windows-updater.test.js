// Execute Atoll's real Windows updater branch on any OS. Only the OS installer dependency is faked.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const pkg = require('../package.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-win-updater-'));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture({ env = {}, isPackaged = true, autoUpdate = true } = {}) {
  const dependency = new EventEmitter(), events = [], notifications = [], installs = [], feeds = [];
  let checks = 0, loads = 0;
  dependency.checkForUpdates = async () => { checks++; dependency.emit('checking-for-update'); dependency.emit('update-not-available'); return {}; };
  dependency.quitAndInstall = (...args) => installs.push(args);
  dependency.setFeedURL = (value) => feeds.push(value);
  const file = require.resolve('../src/updater');
  const instance = new Module(file, module);
  instance.filename = file; instance.paths = module.paths;
  instance.require = (id) => id === 'electron-updater' ? (loads++, { autoUpdater: dependency }) : require(id);
  instance._compile(fs.readFileSync(file, 'utf8'), file);
  const updater = instance.exports.createUpdater({
    app: { getVersion: () => pkg.version, isPackaged, getPath: () => root },
    net: { fetch: () => { throw new Error('Windows must use electron-updater'); } },
    platform: 'win32', userData: root, pkg, env,
    getSettings: () => ({ autoUpdate }),
    sendAll: (channel, state) => events.push({ channel, ...state }), notify: (n) => notifications.push(n)
  });
  return { updater, dependency, events, notifications, installs, feeds, checks: () => checks, loads: () => loads };
}
(async () => {
  try {
    // Reproduces the old undefined windowUpdater() call: no dependency/check was ever reached.
    const f = fixture();
    assert.equal((await f.updater.check({ manual: true })).state, 'uptodate');
    assert.equal(f.checks(), 1, 'manual checks reach electron-updater');
    assert.equal(f.loads(), 1);
    assert.equal(f.dependency.autoDownload, true);
    assert.equal(f.dependency.autoInstallOnAppQuit, true);
    assert.equal(f.dependency.allowPrerelease, false);
    assert.deepEqual(f.feeds, [], 'production keeps electron-builder app-update.yml / GitHub provider');
    assert.equal(f.updater.install().ok, false, 'cannot install before download');

    const download = deferred();
    let downloadChecks = 0;
    f.dependency.checkForUpdates = async () => {
      downloadChecks++;
      f.dependency.emit('checking-for-update');
      f.dependency.emit('update-available', { version: '99.0.0', releaseNotes: '<p>Windows fixes</p>' });
      return { downloadPromise: download.promise };
    };
    const check = f.updater.check({ manual: true });
    await new Promise(setImmediate);
    assert.equal(f.updater.getState().state, 'downloading');
    assert.equal((await f.updater.check({ manual: true })).state, 'downloading', 'a second check does not interrupt the download');
    assert.equal(downloadChecks, 1);
    f.dependency.emit('download-progress', { percent: 42 });
    assert.equal(f.updater.getState().progress, 0.42);
    f.dependency.emit('update-downloaded', { version: '99.0.0', releaseNotes: [{ note: '<b>Windows fixes</b>' }] });
    download.resolve(['Atoll-Setup-99.0.0.exe']);
    assert.equal((await check).state, 'ready');
    assert.equal(f.updater.getState().notes, 'Windows fixes');
    assert.equal(f.notifications.length, 1);
    assert.equal(f.installs.length, 0, 'download completion does not quit Atoll');
    assert.equal(f.updater.install().ok, true);
    assert.deepEqual(f.installs, [[true, true]], 'Restart invokes silent NSIS install and relaunch');
    assert.equal(f.loads(), 1, 'checking and installing reuse the same updater instance');
    assert.ok(f.events.every((event) => event.channel === 'updater'));

    // A rejected automatic-download promise must be observed, even after the check itself resolves.
    const broken = fixture();
    broken.dependency.checkForUpdates = async () => {
      broken.dependency.emit('update-available', { version: '99.0.0' });
      return { downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')) };
    };
    assert.equal((await broken.updater.check({ manual: true })).state, 'error');
    assert.match(broken.updater.getState().error, /checksum/);
    assert.equal(broken.updater.install().ok, false);
    broken.dependency.checkForUpdates = async () => { broken.dependency.emit('update-not-available'); return {}; };
    assert.equal((await broken.updater.check({ manual: true })).state, 'uptodate', 'failed downloads can be retried');

    const offline = fixture();
    offline.dependency.checkForUpdates = async () => { const e = new Error('ENOTFOUND github.com'); offline.dependency.emit('error', e); throw e; };
    assert.equal((await offline.updater.check()).state, 'error', 'background error events stay visible in Settings');
    assert.match(offline.updater.getState().error, /Check your connection/);
    const installError = fixture();
    await installError.updater.check();
    installError.dependency.emit('update-downloaded', { version: '99.0.0' });
    installError.dependency.quitAndInstall = () => installError.dependency.emit('error', new Error('No update filepath provided'));
    assert.equal(installError.updater.install().ok, false, 'installer refusal is not reported as success');

    const dev = fixture({ isPackaged: false });
    assert.equal((await dev.updater.check({ manual: true })).state, 'unavailable');
    assert.equal(dev.loads(), 0, 'source runs do not initialize an installer');
    const test = fixture({ env: { ATOLL_TEST: '1' } });
    assert.equal((await test.updater.check()).state, 'unavailable');
    assert.equal(test.loads(), 0, 'normal tests cannot reach real releases');
    const local = fixture({ isPackaged: false, env: { ATOLL_TEST: '1', ATOLL_UPDATE_FEED: 'http://127.0.0.1:12345' } });
    await local.updater.check();
    assert.deepEqual(local.feeds, [{ provider: 'generic', url: 'http://127.0.0.1:12345' }]);
    assert.equal(local.dependency.forceDevUpdateConfig, true);

    const disabled = fixture({ autoUpdate: false, env: { ATOLL_UPDATE_DELAY_MS: '1' } });
    disabled.updater.start();
    try { await new Promise((resolve) => setTimeout(resolve, 30)); }
    finally { disabled.updater.stop(); }
    assert.equal(disabled.checks(), 0, 'automatic-check preference is respected');
    assert.equal((await disabled.updater.check({ manual: true })).state, 'uptodate', 'manual checks still work with automatic checks off');
    console.log('Windows updater passed: check, download progress, ready, NSIS restart, failure/retry, feed isolation and preferences.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
