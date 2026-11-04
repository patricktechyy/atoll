// End-to-end update on macOS against a local fake release feed (the real app, a real swap):
//   1. a newer build is found, downloaded, verified and ready  -> Restart swaps the app on disk
//   2. a download that does not match its checksum is discarded -> the installed app is untouched
//   3. an app in a read-only place cannot replace itself       -> the button opens the releases page instead
// Windows uses electron-updater against the NSIS installer; that path is covered by the release workflow
// and the manual check in STATE.md, not here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { launchAtoll, executable } = require('./launch');

if (process.platform !== 'darwin') { console.log('Skipped: the custom updater is macOS only.'); process.exit(0); }

const bundleOf = (exe) => path.resolve(exe, '..', '..', '..');
const plistVersion = (app) => execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-update-e2e-'));

// A copy of the app under test, re-versioned and re-signed ad hoc: stands in for the next release.
function makeRelease(source, version, zipName) {
  const stage = path.join(tmp, 'release-' + version);
  fs.mkdirSync(stage, { recursive: true });
  const app = path.join(stage, 'Atoll.app');
  execFileSync('/usr/bin/ditto', [source, app]);
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) execFileSync('/usr/bin/plutil', ['-replace', key, '-string', version, path.join(app, 'Contents', 'Info.plist')]);
  const pkgFile = path.join(app, 'Contents', 'Resources', 'app', 'package.json');
  fs.writeFileSync(pkgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkgFile, 'utf8')), version }, null, 2));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  const zip = path.join(tmp, zipName);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  return { zip, sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), size: fs.statSync(zip).size };
}

function serve(files) {
  const server = http.createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.type, 'content-length': f.body.length }); res.end(f.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

async function waitState(page, want, ms = 60000) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) {
    s = await page.evaluate(() => API.updater.state());
    if (want.includes(s.state)) return s;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`updater never reached ${want}; last state ${JSON.stringify(s)}`);
}

(async () => {
  const source = bundleOf(executable());
  const current = plistVersion(source);
  const next = '99.0.0';
  const good = makeRelease(source, next, 'Atoll-macOS-arm64.zip');
  const feed = (sha) => JSON.stringify({ version: next, file: 'Atoll-macOS-arm64.zip', sha256: sha, size: good.size, minMacOS: '13.0', notes: 'Fixes and polish.\nNew things.' });
  const files = { '/Atoll-macOS-arm64.zip': { type: 'application/zip', body: fs.readFileSync(good.zip) }, '/latest-mac.json': { type: 'application/json', body: Buffer.from(feed(good.sha256)) } };
  const { server, url } = await serve(files);
  const env = { ATOLL_UPDATE_FEED: url, ATOLL_UPDATE_DELAY_MS: '300' };
  const install = (name, readOnly = false) => {
    const dir = path.join(tmp, name); fs.mkdirSync(dir);
    const app = path.join(dir, 'Atoll.app'); execFileSync('/usr/bin/ditto', [source, app]);
    if (readOnly) { execFileSync('/bin/chmod', ['-R', 'a-w', dir]); }
    return { dir, app };
  };
  try {
    // 1. good update
    const a = install('good');
    let run = await launchAtoll({ app: a.app, env });
    let page = await run.app.firstWindow(); await page.waitForFunction(() => !!window.API);
    const ready = await waitState(page, ['ready', 'error']);
    assert.equal(ready.state, 'ready', 'update is downloaded and verified: ' + ready.error);
    assert.equal(ready.version, next); assert.match(ready.notes, /Fixes and polish/); assert.equal(ready.canInstall, true);
    assert.equal(plistVersion(a.app), current, 'nothing is installed until the user chooses to');
    await page.evaluate(() => API.updater.install()).catch(() => {}); // the app quits itself
    const t0 = Date.now();
    const versionOrNull = () => { try { return plistVersion(a.app); } catch (_) { return null; } }; // briefly absent mid-swap
    while (versionOrNull() !== next && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 300));
    assert.equal(plistVersion(a.app), next, 'the app on disk is now the new version');
    await run.close();
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', a.app]);
    run = await launchAtoll({ app: a.app });
    page = await run.app.firstWindow(); await page.waitForFunction(() => !!window.API);
    assert.equal((await page.evaluate(() => API.diagnostics())).version, next, 'the swapped app starts and reports the new version');
    await run.close();

    // 2. corrupted download
    files['/latest-mac.json'].body = Buffer.from(feed('0'.repeat(64)));
    const b = install('corrupt');
    run = await launchAtoll({ app: b.app, env });
    page = await run.app.firstWindow(); await page.waitForFunction(() => !!window.API);
    const bad = await waitState(page, ['ready', 'error']);
    assert.equal(bad.state, 'error'); assert.match(bad.error, /checksum/i);
    assert.equal(plistVersion(b.app), current, 'a bad download never touches the installed app');
    assert.equal((await page.evaluate(() => API.updater.install())).ok, false, 'install refuses without a verified update');
    await run.close();

    // 3. read-only location
    files['/latest-mac.json'].body = Buffer.from(feed(good.sha256));
    const c = install('readonly', true);
    run = await launchAtoll({ app: c.app, env });
    page = await run.app.firstWindow(); await page.waitForFunction(() => !!window.API);
    const ro = await waitState(page, ['ready', 'error']);
    assert.equal(ro.state, 'ready'); assert.equal(ro.canInstall, false, 'cannot replace itself here');
    const r = await page.evaluate(() => API.updater.install());
    assert.equal(r.ok, false); assert.match(r.openPage || '', /releases/, 'falls back to the releases page');
    assert.equal(plistVersion(c.app), current);
    await run.close();
    console.log('Updater end-to-end passed: verified update installs and relaunches as the new version, a corrupted download is refused, a read-only install falls back to the releases page.');
  } finally {
    server.close();
    try { execFileSync('/bin/chmod', ['-R', 'u+w', tmp]); } catch (_) {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
