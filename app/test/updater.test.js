// Updater logic that needs no app and no network: version order, feed validation, URL rules, checksums.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareVersions, feedInfo, parseMacFeed, sha256OfFile, allowedUrl, INSTALL_SCRIPT } = require('../src/updater');
const { capabilities } = require('../src/platform');

// version order
assert.equal(compareVersions('0.11.0', '0.10.11'), 1);
assert.equal(compareVersions('0.10.9', '0.10.10'), -1);
assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10') !== 0, true);
assert.ok(Number.isNaN(compareVersions('nonsense', '1.0.0')));

// where the feed lives comes from package.json
const pkg = require('../package.json');
const info = feedInfo(pkg);
assert.ok(info && info.owner && info.repo, 'package.json build.publish names the GitHub repo');
assert.equal(info.base, `https://github.com/${info.owner}/${info.repo}/releases/latest/download`);
assert.equal(feedInfo({}), null);

// feed validation
const good = { version: '0.11.1', file: 'Atoll-macOS-arm64.zip', sha256: 'a'.repeat(64), size: 1234, minMacOS: '13.0', notes: 'Fixes' };
const base = 'https://github.com/o/r/releases/latest/download';
const ok = parseMacFeed(good, { base, current: '0.11.0', macVersion: '15.2' });
assert.equal(ok.version, '0.11.1'); assert.equal(ok.url, `${base}/Atoll-macOS-arm64.zip`); assert.equal(ok.notes, 'Fixes');
assert.equal(parseMacFeed({ ...good, version: 'v0.11.1' }, { base, current: '0.11.0' }).version, '0.11.1', 'leading v accepted');
assert.match(parseMacFeed(good, { base, current: '0.11.1' }).reject, /already current/, 'same version is not an update');
assert.match(parseMacFeed(good, { base, current: '0.12.0' }).reject, /older/, 'a downgrade is never offered');
assert.match(parseMacFeed({ ...good, sha256: 'xyz' }, { base, current: '0.11.0' }).reject, /sha256/);
assert.match(parseMacFeed({ ...good, file: '../evil.zip' }, { base, current: '0.11.0' }).reject, /file name/);
assert.match(parseMacFeed({ ...good, file: 'https://evil.example/x.zip' }, { base, current: '0.11.0' }).reject, /file name/, 'a feed cannot point elsewhere');
assert.match(parseMacFeed({ ...good, file: 'app.dmg' }, { base, current: '0.11.0' }).reject, /file name/);
assert.match(parseMacFeed({ ...good, version: 'latest' }, { base, current: '0.11.0' }).reject, /version/);
assert.match(parseMacFeed({ ...good, minMacOS: '99.0' }, { base, current: '0.11.0', macVersion: '15.2' }).reject, /macOS/);
assert.match(parseMacFeed(good, { base: 'http://example.com/x', current: '0.11.0' }).reject, /https/, 'plain http is refused');
assert.equal(parseMacFeed(good, { base: 'http://127.0.0.1:9/x', current: '0.11.0', testFeed: true }).version, '0.11.1', 'local http only in a test feed');
assert.match(parseMacFeed(null, { base, current: '0.11.0' }).reject, /object/);
assert.equal(parseMacFeed({ ...good, notes: 'x'.repeat(10000) }, { base, current: '0.11.0' }).notes.length, 6000, 'notes are capped');

// url rules
assert.equal(allowedUrl('https://github.com/x', false), true);
assert.equal(allowedUrl('http://github.com/x', false), false);
assert.equal(allowedUrl('http://127.0.0.1:8080/x', false), false);
assert.equal(allowedUrl('http://localhost:8080/x', true), true);
assert.equal(allowedUrl('http://evil.example/x', true), false);
assert.equal(allowedUrl('not a url', true), false);

// checksum
(async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-sha-')), 'x.bin');
  fs.writeFileSync(f, 'atoll');
  assert.equal(await sha256OfFile(f), require('node:crypto').createHash('sha256').update('atoll').digest('hex'));
  fs.rmSync(path.dirname(f), { recursive: true, force: true });

  // the swap script takes its paths as arguments (nothing spliced in) and can restore the old app
  assert.match(INSTALL_SCRIPT, /PID="\$1"; NEW="\$2"; DEST="\$3"; BACKUP="\$4"/);
  assert.match(INSTALL_SCRIPT, /mv "\$BACKUP" "\$DEST"/, 'restores the old app if the copy fails');
  assert.doesNotMatch(INSTALL_SCRIPT, /rm -rf/, 'the script never deletes anything');

  // platform capabilities
  assert.equal(capabilities('darwin').appleCalendar, true);
  assert.equal(capabilities('win32').appleCalendar, false);
  assert.equal(capabilities('darwin').updateMechanism, 'custom');
  assert.equal(capabilities('win32').updateMechanism, 'electron-updater');
  console.log('Updater feed validation, version order, URL rules, checksum, install script and capabilities passed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
