// "Fix permission" for macOS privacy permissions.
//
// Atoll is ad hoc signed, so every build has a different code fingerprint, and macOS ties a permission to the
// fingerprint it was granted to. After an update System Settings can still list Atoll as allowed while macOS
// refuses the new build, and asking again shows no prompt. `tccutil reset <service> <bundle id>` clears the
// stale entry for Atoll only; the permission is then requested again so macOS shows its prompt.
//
// The reset needs no privileges, never touches another app, and is only ever run from the user's click in
// Settings. Tests use a recording runner (ATOLL_TEST), never the real tool: the test build shares Atoll's
// bundle id, so a real reset would wipe the user's real permissions.
const BUNDLE_ID = 'app.atoll.notch';

// kind (used by the UI) -> TCC service name
const SERVICES = {
  calendar: 'Calendar',
  screen: 'ScreenCapture',
  accessibility: 'Accessibility',
  automation: 'AppleEvents'   // Music and Spotify, used for now-playing and lyrics timing
};

const isKind = (kind) => Object.prototype.hasOwnProperty.call(SERVICES, kind);

// The exact command for a kind, or null.
function resetCommand(kind, bundleId = BUNDLE_ID) {
  return isKind(kind) ? ['/usr/bin/tccutil', ['reset', SERVICES[kind], bundleId]] : null;
}

// run(cmd, args) -> Promise. Resolves { ok: true } or { ok: false, error }.
async function resetPermission(kind, { run, packaged = true, bundleId = BUNDLE_ID } = {}) {
  const command = resetCommand(kind, bundleId);
  if (!command) return { ok: false, error: 'Unknown permission.' };
  // an unpackaged Electron has another bundle id (and `tccutil` would clear the wrong app)
  if (!packaged) return { ok: false, error: 'Only the installed Atoll can reset its permissions.' };
  try { await run(command[0], command[1]); return { ok: true }; }
  catch (e) { return { ok: false, error: String((e && (e.stderr || e.message)) || e).split('\n')[0].slice(0, 200) }; }
}

module.exports = { BUNDLE_ID, SERVICES, isKind, resetCommand, resetPermission };
