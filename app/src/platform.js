// What each platform can do. One place to ask instead of scattered `process.platform` checks.
// Add a key here when a feature is not available everywhere, and list it in PARITY.md.
// main.js answers the renderer through the 'caps' IPC; preload exposes it as window.atoll.caps.
function capabilities(platform = process.platform) {
  const mac = platform === 'darwin';
  return {
    platform,
    appleCalendar: mac,                       // EventKit; Windows uses an iCal (ICS) link
    icsCalendar: true,
    screenPermission: mac,                    // macOS asks for Screen Recording / Accessibility
    displaySafeArea: mac,                     // NSScreen camera-cutout geometry, per selected display
    nativeMediaPlayers: mac ? ['Music', 'Spotify'] : ['Apple Music', 'Spotify', 'any Windows media session'],
    updateMechanism: mac ? 'custom' : 'electron-updater',
    installsOnQuit: !mac                      // Windows installs a downloaded update when Atoll quits; Mac only on Restart
  };
}
module.exports = { capabilities };
