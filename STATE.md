# State and hand-off

Rewritten at the end of every session. Read it first; clear items from "Needs verifying" when you verify them.

**Last updated:** 2026-11-04, macOS (Claude Sonnet 5.5). Version in the repo: 0.11.0 (not yet released).

## What was done this session

- Built this repo from the old `Atoll Workspace` folder (which held the Windows runtime and the Mac `Atoll.app` around one shared `resources/app`).
- Added the in-app updater (`app/src/updater.js`), Settings → About UI, `app/src/platform.js` capabilities, CI and Release workflows, release tools, `AGENTS.md`/`PARITY.md`/this file.
- Carried over all changes made on the Mac up to 0.10.11: Apple Calendar (EventKit), lyrics only from the playing app (LRCLIB/NetEase removed), Apple storefront fix, Mac window-button spacing in Setup/Settings, monitor selector, side-mode "open Tasks" fix.
- Tests made portable (shared launcher `app/test/launch.js`; they run the built app on either OS). `package.json` test scripts now list only files that exist.

## Verified (macOS, this session)

- `npm test` (unit), and `npm run test:ui` + `node app/test/apple-calendar-ui.test.js` + `native/mac/qa/workflows-qa.cjs` + `native/mac/qa/qa.cjs` against `dist/Atoll.app` built with `native/mac/build.sh`.
- Updater end to end on macOS against a local fake feed: verified update installs and relaunches as the new version; a corrupted download is refused; a read-only install falls back to the releases page.

## Needs verifying on WINDOWS (nothing below has ever run on Windows)

- The whole shared test suite on a Windows runner: first CI run will show it.
- `npm run dist:win:dir` / `dist:win` (electron-builder): `native/win/build-helper.js` was recreated from `app/src/native.js` (`buildHelper`) and has never run. Prebuilt helpers in `native/win/prebuilt/` are used as fallback (CI does not yet require a fresh compile: `ATOLL_REQUIRE_FRESH_HELPER=0`).
- `app/test/win-smoke.test.js` (written without a Windows machine).
- electron-updater path: install 0.11.0, publish 0.11.1, confirm Settings → About shows it and Restart installs it. The Windows updater code path has never run.
- Windows app after this session's shared-code changes: lyrics routing (Apple Music for Windows app id `AppleInc.AppleMusic…` must map to Apple Music), display selector, calendar settings (ICS only, Apple row hidden), About page.
- Upgrade from the old portable folder to the installer keeps settings in `%APPDATA%\Atoll` (same `appId`/`productName`); confirm on the first real install.
- `app/test/reminders-settings-ui.test.js` is a leftover browser-level test needing a Chrome path; not in any suite. Decide to fix or delete.

## Needs verifying on macOS

- Real Apple Music and Spotify lyric fetching with signed-in accounts (verified once by hand at 0.10.9 for Apple Music).
- Real Apple Calendar permission grant and real events (UI is tested with a stubbed reader; the EventKit query runs unauthorized in tests).
- Release workflow on a real GitHub Release (asset names, `latest-mac.json`), then an in-app update from a downloaded 0.11.0 to 0.11.1.
- `native/mac/qa/qa.cjs` has failed once on the first launch of some fresh builds and passes on rerun; cause not found.

## Open items for the user

- Create the GitHub repo (the code assumes `patricktechyy/atoll`, public). If the name differs, change `build.publish` and `repository` in `app/package.json`. In the repo's Settings → Actions → General, set Workflow permissions to **Read and write**.
- Existing 0.10.x users have no updater: they must install 0.11.0 by hand once.
- Optional later: Apple Developer ID (stops the Mac permission re-prompts and Gatekeeper warning) and a Windows code-signing certificate (stops SmartScreen warning).
