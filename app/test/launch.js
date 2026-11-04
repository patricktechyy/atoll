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

module.exports = { launchAtoll, makeProfile, executable };
