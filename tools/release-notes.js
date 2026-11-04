#!/usr/bin/env node
// Release helpers used by .github/workflows/release.yml (and unit-tested in app/test/release-tools.test.js).
//
//   node tools/release-notes.js notes   <version> [CHANGELOG.md]         -> prints that version's changelog section
//   node tools/release-notes.js mac-feed <version> <zip> <out.json>      -> writes latest-mac.json for the in-app updater
//   node tools/release-notes.js check   <tag> [app/package.json]         -> fails unless tag == v<package version>
//
// CHANGELOG.md sections look like "## 0.11.0 - 2026-11-04" followed by bullet points.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function section(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  const head = (l) => /^##\s+v?(\d+\.\d+\.\d+\S*)/.exec(l);
  const start = lines.findIndex((l) => { const m = head(l); return m && m[1] === version; });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end).join('\n').trim();
}

function macFeed({ version, zipPath, notes, minMacOS = '13.0' }) {
  const buf = fs.readFileSync(zipPath);
  return {
    version, file: path.basename(zipPath), sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    size: buf.length, minMacOS, notes: String(notes || '').slice(0, 6000), date: new Date().toISOString()
  };
}

function checkTag(tag, pkgPath) {
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  return { ok: tag === `v${version}`, version };
}

module.exports = { section, macFeed, checkTag };

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  const root = path.join(__dirname, '..');
  try {
    if (cmd === 'notes') {
      const text = section(fs.readFileSync(b || path.join(root, 'CHANGELOG.md'), 'utf8'), a);
      if (!text) throw new Error(`CHANGELOG.md has no "## ${a}" section. Add one before releasing.`);
      process.stdout.write(text + '\n');
    } else if (cmd === 'mac-feed') {
      const notes = section(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), a);
      if (!notes) throw new Error(`CHANGELOG.md has no "## ${a}" section. Add one before releasing.`);
      fs.writeFileSync(c, JSON.stringify(macFeed({ version: a, zipPath: b, notes }), null, 2) + '\n');
    } else if (cmd === 'check') {
      const r = checkTag(a, b || path.join(root, 'app', 'package.json'));
      if (!r.ok) throw new Error(`Release tag "${a}" does not match app/package.json version ${r.version} (expected v${r.version}).`);
    } else {
      throw new Error('usage: release-notes.js notes|mac-feed|check ...');
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
