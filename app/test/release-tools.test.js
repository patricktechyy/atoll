// The release helpers: changelog sections, the Mac update feed, and the tag/version guard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { section, macFeed, checkTag } = require('../../tools/release-notes');
const { parseMacFeed } = require('../src/updater');

const log = '# Changelog\n\n## 0.11.1 - 2026-12-01\n- Newer thing\n- Another\n\n## 0.11.0 - 2026-11-04\n- First updater\n\n## 0.10.11\n- Old\n';
assert.equal(section(log, '0.11.1'), '- Newer thing\n- Another');
assert.equal(section(log, '0.11.0'), '- First updater');
assert.equal(section(log, '0.10.11'), '- Old');
assert.equal(section(log, '9.9.9'), null);
assert.equal(section(log, '0.11'), null, 'versions match exactly');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-rel-'));
const zip = path.join(dir, 'Atoll-macOS-arm64.zip');
fs.writeFileSync(zip, 'zip bytes');
const feed = macFeed({ version: '0.11.1', zipPath: zip, notes: '- Newer thing' });
assert.equal(feed.sha256, crypto.createHash('sha256').update('zip bytes').digest('hex'));
assert.equal(feed.file, 'Atoll-macOS-arm64.zip');
// the app accepts exactly what the release tool writes
const accepted = parseMacFeed(feed, { base: 'https://github.com/o/r/releases/latest/download', current: '0.11.0', macVersion: '14.0' });
assert.equal(accepted.version, '0.11.1'); assert.equal(accepted.sha256, feed.sha256);

const pkg = path.join(dir, 'package.json');
fs.writeFileSync(pkg, JSON.stringify({ version: '0.11.1' }));
assert.equal(checkTag('v0.11.1', pkg).ok, true);
assert.equal(checkTag('v0.11.2', pkg).ok, false);
assert.equal(checkTag('0.11.1', pkg).ok, false, 'the tag needs its v');
fs.rmSync(dir, { recursive: true, force: true });

// the repository's own changelog covers the current version
const version = require('../package.json').version;
assert.ok(section(fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8'), version), `CHANGELOG.md needs a "## ${version}" section`);
console.log('Release tools passed: changelog sections, Mac feed (accepted by the app), tag guard, current version documented.');
