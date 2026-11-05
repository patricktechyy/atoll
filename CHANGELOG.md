# Changelog

Each release needs a `## <version>` section. It becomes the GitHub release notes and the in-app "What's new".

## 0.12.1 - 2026-11-05

- Fixed Apple Music lyrics incorrectly reporting that a song has no lyrics after the Rust migration, on both Windows and macOS. The account storefront request now sends the same authenticated player headers as search and lyrics, refreshes expired sessions, and reports lookup failures instead of silently searching MusicKit's fallback US catalog. Verified the reported “HAHAHA” by Juicy Luicy against the connected account's Indonesian storefront.

## 0.12.0 - 2026-11-05

- Added a Rust/Tauri desktop host for Windows and macOS using the existing shared interface. The packaged Rust app uses WebView2 on Windows and WKWebView on macOS, without bundling Electron or Node.js. Retains the 95-method renderer contract, native media helpers, integrated MacBook notch, calendars, clipboard, screenshots, tasks, focus, water, notifications, shortcuts and tray controls.
- Preserves the existing Atoll profile and makes a one-time backup before migrating. Player and Todolist accounts must be connected again: OS WebViews cannot reuse Electron's encrypted sessions. New account credentials use the OS credential vault.
- Added native battery events, Rust networking/persistence/update handling, compatible update feeds and a Windows installer migration hook. Memory diagnostics explicitly label the host/helper scope rather than implying it includes OS WebView processes.
- Rust remains under parity verification. macOS is being tested locally; a Windows build, real media accounts, permission prompts, installer migration and consecutive-version updates still require platform verification before release. The Electron implementation remains available for regression checks and fallback. See `RUST_MIGRATION.md` and `STATE.md`.

## 0.11.6 - 2026-11-05

- Windows: fixed in-app update checks and Restart to update failing before the Windows updater was called. Settings → About now checks for new releases, downloads the installer and offers to restart. Download errors are handled, failed downloads can be retried, and repeated checks cannot interrupt an active download. Settings also explains that a downloaded Windows update installs when Atoll quits.

## 0.11.5 - 2026-11-05

- Mac: Atoll stays joined to the physical MacBook notch and now adapts to its measured camera housing. Compact activities and HUD controls sit in visible wings beside the camera; expanded pages, notifications and move controls grow out of the same connected shape with their content below the camera. Camera dimensions stay correct at every Atoll size. External and notch-free displays keep the usual layout, and switching screens or reconnecting them updates the layout automatically. Saved positions are preserved.

## 0.11.4 - 2026-11-04

- Mac: fixed the notch saying "not playing" after you change song in Apple Music, until you restarted Atoll or used Fix permission. Music can answer slowly while it loads the next song; one slow answer used to switch detection off for 60 seconds. Atoll now retries within about a second and, meanwhile, keeps showing the current song instead of "not playing". Only a refused permission still waits longer. Loading the cover art also can no longer freeze detection.

## 0.11.3 - 2026-11-04

- Fix: lyric **translation and romanization** work again. Google had started refusing the request Atoll used (HTTP 429), so both stopped at once. Atoll now uses the request Google's own Chrome extension uses and falls back to the old one.
- Fix: Traditional Chinese songs showed romanization (pinyin) but no English line. Google labels those lyrics as English, and Atoll hides translation for English songs (and for any language you ticked under "Languages I understand"). Atoll now checks the label against the lyrics' script and corrects it.
- Mac: Atoll builds can now be signed with a stable certificate (`ATOLL_SIGN_IDENTITY` in `native/mac/build.sh`). macOS then keeps the Music/Spotify, Calendar, Screen Recording and Accessibility permissions across rebuilds and updates, instead of forgetting them each time. Builds without a certificate are unchanged (ad hoc, permissions reset on update).

## 0.11.2 - 2026-11-04

- Mac: new **Fix permission** buttons. After an Atoll update macOS can keep showing Atoll as allowed (Calendar, Screen Recording, Accessibility, Automation for Music and Spotify) while refusing the new version, and asking again shows no prompt. Fix permission clears Atoll's own saved answer in macOS (nothing else) and asks again. Find it in Settings → System → Mac permissions, and next to Connect in Settings → Calendar when access is missing.

## 0.11.1 - 2026-11-04

- Update test release: no feature changes. If you can read this under Settings → About after an update, in-app updating works.

## 0.11.0 - 2026-11-04

- Atoll now updates itself on Windows and macOS. Settings → About shows the current version, checks in the background every few hours, downloads new versions and installs them when you choose Restart. Turn off "Update automatically" there if you prefer.
- Apple Calendar on Mac: Settings → Calendar → Apple Calendar shows events from every calendar on the Mac, or only the ones you tick. Windows keeps the iCal link.
- Lyrics now come only from the app that is playing: Spotify for Spotify, Apple Music for the Music app, through your own account. The free lyric sites are gone. Apple Music lyrics were empty for many accounts; this is fixed.
- Choose which monitor the notch lives on: Settings → Appearance → Position → Show on screen, or right-click the notch.
- Mac: the window buttons no longer overlap the logo in the setup guide and Settings.
- Side layout: opening Tasks from the menu goes to the Tasks page.
- Earlier 0.10.x changes (water reminders switch, lyric timing range, romanization, Apple Music timing, understood languages) are included.

First install of this version is manual (earlier versions cannot update themselves): Windows runs the installer, macOS replaces Atoll.app. On first launch macOS may need right-click → Open because the app is not notarized, and may ask for Automation, Calendar and Screen Recording again after each update.
