// Exercise the packaged Windows app's real updater, IPC and Settings UI. The NSIS dependency is
// replaced with a fixture so CI never installs software or contacts the real release feed.
const assert = require('node:assert/strict');
const { launchAtoll } = require('./launch');
if (process.platform !== 'win32') { console.log('Skipped: packaged Windows updater UI needs Windows.'); process.exit(0); }
(async () => {
  const { app, close } = await launchAtoll({ settings: { autoUpdate: false }, env: { ATOLL_UPDATE_FEED: 'http://127.0.0.1:9' } });
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.API);
    await app.evaluate(({ app }) => {
      const req = process.mainModule.require.bind(process.mainModule);
      const Module = req('module');
      const fromApp = Module.createRequire(req('path').join(app.getAppPath(), 'main.js'));
      const file = fromApp.resolve('electron-updater');
      const fake = new (req('events').EventEmitter)();
      global.__winUpdateFixture = { fake, installs: [], checks: 0 };
      fake.setFeedURL = () => {};
      fake.checkForUpdates = async () => {
        global.__winUpdateFixture.checks++;
        fake.emit('checking-for-update');
        fake.emit('update-available', { version: '99.0.0', releaseNotes: 'Windows update regression' });
        fake.emit('download-progress', { percent: 42 });
        return { downloadPromise: new Promise((resolve, reject) => Object.assign(global.__winUpdateFixture, { resolve, reject })) };
      };
      fake.quitAndInstall = (...args) => global.__winUpdateFixture.installs.push(args);
      const fixtureModule = new Module(file);
      fixtureModule.exports = { autoUpdater: fake };
      fixtureModule.loaded = true;
      fromApp.cache[file] = fixtureModule;
    });
    const next = app.waitForEvent('window'); await page.evaluate(() => API.openSettings('about')); const settings = await next;
    await settings.locator('#upd-check:not([disabled])').waitFor();
    assert.match(await settings.locator('body').innerText(), /Updates install when you choose Restart or quit Atoll/);
    await settings.locator('#upd-check').click();
    await settings.getByText(/Downloading Atoll 99\.0\.0.*42%/).waitFor();
    assert.equal(await settings.locator('#upd-check').isDisabled(), true);
    assert.equal(await settings.locator('#upd-install').count(), 0, 'restart is unavailable before download verification');
    await app.evaluate(() => {
      const f = global.__winUpdateFixture;
      f.fake.emit('error', new Error('sha512 checksum mismatch'));
      f.reject(new Error('sha512 checksum mismatch'));
    });
    await settings.getByText('sha512 checksum mismatch', { exact: true }).waitFor();
    await settings.locator('#upd-check:not([disabled])').waitFor();
    await settings.locator('#upd-check').click();
    await settings.getByText(/Downloading Atoll 99\.0\.0/).waitFor();
    await app.evaluate(() => {
      const f = global.__winUpdateFixture;
      f.fake.emit('update-downloaded', { version: '99.0.0', releaseNotes: '<p>Windows update regression</p>' });
      f.resolve(['Atoll-Setup-99.0.0.exe']);
    });
    await settings.locator('#upd-install').waitFor();
    await settings.getByText('Windows update regression', { exact: true }).waitFor();
    assert.match(await settings.locator('body').innerText(), /Restart now or quit Atoll to install/);
    await settings.locator('#upd-install').click();
    assert.deepEqual(await app.evaluate(() => global.__winUpdateFixture.installs), [[true, true]], 'Restart invokes NSIS install with relaunch');
    assert.equal(await app.evaluate(() => global.__winUpdateFixture.checks), 2, 'failed download is retried once');
    console.log('Windows updater UI passed: check, progress, checksum failure, retry, release notes and Restart to update.');
  } finally { await close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
