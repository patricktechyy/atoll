// Shared by the UI tests: start the packaged Atoll (macOS .app or Windows Atoll.exe) with a throwaway profile.
//
//   ATOLL_APP=/path/to/Atoll.app   (or Atoll.exe)   or pass it as the first argument
//
// Defaults: dist/Atoll.app on macOS (npm run build:mac), dist/win-unpacked/Atoll.exe on Windows
// (npm run dist:win:dir). Playwright is found through ATOLL_PLAYWRIGHT_MODULE or normal resolution.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function executable(given) {
  const dist = path.join(__dirname, '..', '..', 'dist');
  let p = given || process.env.ATOLL_APP || process.argv[2] || (process.platform === 'darwin' ? path.join(dist, 'Atoll.app') : path.join(dist, 'win-unpacked', 'Atoll.exe'));
  p = path.resolve(p);
  if (p.endsWith('.app')) p = path.join(p, 'Contents', 'MacOS', 'Atoll');
  if (!fs.existsSync(p)) throw new Error(`Atoll not found at ${p}. Build it first (npm run build:mac / npm run dist:win:dir) or set ATOLL_APP.`);
  return p;
}

// A temporary profile so tests never touch real settings, with quiet defaults.
function makeProfile(settings = {}, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-test-'));
  fs.writeFileSync(path.join(dir, 'atoll.json'), JSON.stringify({ ...extra, settings: { clipboardPaused: true, notifyPort: 0, artLookup: false, ...settings } }));
  return dir;
}

async function launchAtoll({ settings, extra, env = {}, app: appPath } = {}) {
  const { _electron } = require(process.env.ATOLL_PLAYWRIGHT_MODULE || 'playwright');
  const profile = makeProfile(settings, extra);
  const app = await _electron.launch({
    executablePath: executable(appPath), chromiumSandbox: true,
    env: { ...process.env, ATOLL_TEST: '1', ATOLL_TEST_USER_DATA: profile, ...env }
  });
  const close = async () => { try { await app.close(); } catch (_) {} fs.rmSync(profile, { recursive: true, force: true }); };
  return { app, profile, close };
}

// Ask the notch to open a tab, and make sure it did. The bridge (window.API) exists before the page's own
// script has registered its handlers, so on a slow machine the first message can be lost: send it again
// until the panel is open (and, if given, until `visible` can be seen). On failure the error says what the
// app looked like, so a CI-only failure can be diagnosed from its log.
async function openTab(app, page, tab, { tries = 8, visible } = {}) {
  const target = visible ? { selector: visible, state: 'visible' } : { selector: '#island.state-panel', state: 'attached' };
  for (let i = 0; i < tries; i++) {
    await app.evaluate(({ BrowserWindow }, t) => {
      const w = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL())) || BrowserWindow.getAllWindows()[0];
      w.webContents.send('open-tab', t);
    }, tab);
    try { await page.waitForSelector(target.selector, { state: target.state, timeout: 2500 }); return; } catch (_) { /* not ready yet: ask again */ }
  }
  const look = await page.evaluate(() => {
    const el = document.querySelector('#island'), box = (document.querySelector('#panel') || {}).getBoundingClientRect;
    return { island: el && el.className, page: (document.querySelector('.page.on') || {}).dataset && document.querySelector('.page.on').dataset.page, viewport: [innerWidth, innerHeight], hidden: document.hidden, focus: document.hasFocus(), panel: box ? JSON.stringify(document.querySelector('#panel').getBoundingClientRect()) : null };
  }).catch((e) => ({ error: e.message }));
  const host = await app.evaluate(({ BrowserWindow, screen }) => ({ windows: BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL().split('/').pop(), visible: w.isVisible(), bounds: w.getBounds() })), displays: screen.getAllDisplays().map((d) => d.bounds) })).catch((e) => ({ error: e.message }));
  throw new Error(`The notch never showed "${target.selector}" after opening the "${tab}" tab ${tries} times.\nPage: ${JSON.stringify(look)}\nApp: ${JSON.stringify(host)}`);
}

module.exports = { launchAtoll, makeProfile, executable, openTab };
