# Feature parity: Windows vs macOS

All features, fixes, UI changes, performance improvements and architecture migrations target both Windows
and macOS by default, as required by `AGENTS.md`. Only an explicit user request can narrow a change to one
platform; the OS used for development does not change that scope. Adding a row here does not itself
authorize a new platform exclusion.

Preserve the existing intentional OS differences below. Different platform-specific implementations may
provide equivalent behavior where supported. For any new user-requested platform exception, record the
explicit request and its reason here. Track checks actually run on each OS and outstanding verification
in `STATE.md`; simulated checks do not establish real OS verification.
`app/src/platform.js` (`capabilities()`) is where the code asks about platform support.

| Feature | Windows | macOS | Notes |
| --- | --- | --- | --- |
| Notch UI, layouts, themes, positions | yes | yes | Shared renderer. macOS reads the selected display's camera rectangle (NSScreen safe area + auxiliary top areas), keeping the shape joined to the notch: compact wings beside the camera and expanded content below it. External/notch-free screens keep normal placement. Windows draws at the top edge. Saved positions are preserved. |
| Show notch on a chosen monitor | yes | yes | Settings → Appearance → Position, and the right-click menu. |
| Lyrics (Spotify / Apple Music, own account only) | yes | yes | No third-party lyric sites. Apple storefront is resolved from the account. |
| Music control and position | Windows media sessions, Apple Music via UI Automation | Music and Spotify via AppleScript | Players differ by design; macOS covers only Music and Spotify. |
| Calendar: iCal (ICS) link | yes | yes | |
| Calendar: Apple Calendar (EventKit) | **no** | yes | Windows has no equivalent system calendar API wired up. A Windows equivalent (Outlook/Windows calendar) is not planned yet. |
| Clipboard history, shelf, tasks, focus, water, stats | yes | yes | Shared. |
| Screenshots | yes | yes | macOS needs Screen Recording permission. |
| In-app updates | electron-updater (NSIS installer; fixed in 0.11.6) | custom downloader/swapper | Settings → About checks/downloads/offers Restart on both. Windows also installs a ready update at next quit; macOS only on Restart. Older Windows versions need one manual installation of 0.11.6+ to repair their updater. |
| System indicators (volume, caps lock, charging…) | yes | partly | Helper-based; macOS helper (`native/mac/helper.m`) covers fewer indicators. Check before promising a new one on Mac. |
| Permission setup (Accessibility, Screen Recording, Automation) | n/a | yes | macOS only. After each Mac update macOS may refuse the new build while System Settings still shows Atoll as allowed (ad hoc signing). Settings has **Fix permission** per permission (`app/src/mac-permissions.js`: `tccutil reset` for Atoll only, then asks again). Windows has no equivalent permissions. |
| Signing | unsigned (SmartScreen warning on first install) | ad hoc by default (right-click → Open on first launch); `ATOLL_SIGN_IDENTITY` signs with a certificate so permissions survive rebuilds | Developer ID / code-signing certificate would remove both warnings. |
