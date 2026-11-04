# State and hand-off

Rewritten at the end of every session. Read it first; clear items from "Needs verifying" when you verify them.

**Last updated:** 2026-11-04, macOS (Claude Sonnet 5.5). Version in the repo: 0.11.4 (0.11.0 and 0.11.1 released; 0.11.2–0.11.4 are not released yet).

## Latest session: notch says "not playing" after changing song in Apple Music (0.11.4)

- Cause (reproduced): `native/mac/helper.m` put a player on a flat 60 s cooldown after ANY failed poll. Freezing Music for 4 s (`kill -STOP`) made one poll time out (-1712); the old helper then reported `active:false` and was still blind 30+ s later. Restarting the app or Fix permission restarts the helper, which is why those "fixed" it. A song change in Music (streamed tracks especially) can stall it like that.
- Fix: error-classified cooldown (1.5 s for timeouts/no track, 5 s not running, 30 s only for -1743/-1744 permission refusals), a failed script is dropped from the cache, the last good sample is held up to 8 s instead of emitting "not playing", the cover-art script now has a 3 s timeout (it had the 120 s default on the poll thread), repeated identical diag messages are rate-limited and now carry the error number.
- Verified on macOS: same freeze test on the patched helper → zero `active:false`, song reported again ~1 s after Music resumed (old helper: 60 s blackout). NOT verified: the exact trigger on the user's Mac (a manual song change in the real app, which I could not reproduce with skips or auto-advance), a stall longer than 8 s, and an automated test (the freeze test needs a live Music and is invasive, so it is not in CI).


## Latest session: translation + romanization broken, Apple Music permission keeps dropping (0.11.3)

- Translate/romanization: `translate.googleapis.com` answered HTTP 429 ("Sorry...") to `client=gtx` for every request, so both failed. `app/src/translate.js` now tries `client=dict-chrome-ex` (same response format, not throttled) then `gtx`, remembering the one that worked. Test: `app/test/translate-fallback.test.js`. Checked against the live endpoint with ja/ko/zh text (translation + romanization returned). NOT checked: the packaged app showing translated lyrics on screen, and whether Google throttles `dict-chrome-ex` later (it is unofficial; if it breaks again expect 429 again).
- Second translate bug (not throttling): Google's detected language for Traditional Chinese lyrics is `en` (simplified gives `zh-CN`), which made `same`/`skipped` true and hid the English line while pinyin stayed. `fixLanguage()` in `translate.js` overrides a Latin-language label when most letters are another script. Reproduced and re-checked against the live service with a 40-line made-up Chinese lyric (40/40 translated + romanized); tests in `translate-fallback.test.js`. NOT checked: the on-screen result for the user's actual song. Other Google mislabels may exist; offline translation/romanization was discussed but not built.
- Permission loss: confirmed from `log show` (tccd) that the Automation grant is stored under `app.atoll.notch` and was deleted/recreated several times today; the ad hoc build's designated requirement is its cdhash (`designated => cdhash H"…"`), which changes on every build/update. `native/mac/build.sh` now signs with `ATOLL_SIGN_IDENTITY` when set; the requirement then becomes identifier + certificate. Verified: two separate builds signed with the user's Apple Development certificate have the identical requirement and each satisfies the other's. NOT verified: that macOS keeps the grant across such builds in practice (needs a human to grant once, rebuild, check), and the CI/Release builds are still ad hoc (the certificate is in the user's keychain only), so in-app updates to a CI build go back to hash-based identity.


## Latest session: Mac "Fix permission" (0.11.2)

- Why: every Mac build/update has a new ad hoc code fingerprint; macOS then refuses the new build while System Settings still lists Atoll as allowed (seen on the user's Mac: Calendar stopped working after the 0.11.1 update).
- What: `app/src/mac-permissions.js` (`tccutil reset <service> app.atoll.notch`, never "All"), IPC `mac:fix` in `main.js` (Settings window only; re-requests after the reset), buttons in Settings → System (Calendar, Screen Recording, Accessibility, Automation) and Settings → Calendar. Tests: `app/test/mac-permissions.test.js` (unit) and `app/test/mac-permission-fix.test.js` (packaged, Mac; the app records the command under `ATOLL_TEST` instead of running `tccutil`, because test builds share the real bundle id).
- Verified on macOS: both tests. NOT verified: a real reset on a real stale permission and the macOS prompts that follow (needs a human); Automation re-prompt after the helper restart; Screen Recording / Accessibility buttons were deliberately not clicked in tests.
- Not fixed: the cause. A stable signing certificate would stop the fingerprint changing (see PARITY.md, Signing).

## Earlier session: building this repo

- Built this repo from the old `Atoll Workspace` folder (which held the Windows runtime and the Mac `Atoll.app` around one shared `resources/app`).
- Added the in-app updater (`app/src/updater.js`), Settings → About UI, `app/src/platform.js` capabilities, CI and Release workflows, release tools, `AGENTS.md`/`PARITY.md`/this file.
- Carried over all changes made on the Mac up to 0.10.11: Apple Calendar (EventKit), lyrics only from the playing app (LRCLIB/NetEase removed), Apple storefront fix, Mac window-button spacing in Setup/Settings, monitor selector, side-mode "open Tasks" fix.
- Tests made portable (shared launcher `app/test/launch.js`; they run the built app on either OS). `package.json` test scripts now list only files that exist.

## Verified (macOS, this session)

- `npm test` (unit), and `npm run test:ui` + `node app/test/apple-calendar-ui.test.js` + `native/mac/qa/workflows-qa.cjs` + `native/mac/qa/qa.cjs` against `dist/Atoll.app` built with `native/mac/build.sh`.
- Updater end to end on macOS against a local fake feed: verified update installs and relaunches as the new version; a corrupted download is refused; a read-only install falls back to the releases page.

## Needs verifying on WINDOWS (nothing below has ever run on Windows)

- The shared test suite and `win-smoke` PASSED on the GitHub Windows runner (2026-11-04). Still unverified on a real Windows laptop.
- `npm run dist:win:dir` / `dist:win` (electron-builder): `native/win/build-helper.js` was recreated from `app/src/native.js` (`buildHelper`) and has never run. Prebuilt helpers in `native/win/prebuilt/` are used as fallback (CI does not yet require a fresh compile: `ATOLL_REQUIRE_FRESH_HELPER=0`).
- `app/test/win-smoke.test.js` (written without a Windows machine).
- electron-updater path: install `Atoll-Setup-0.11.0.exe` from the v0.11.0 release, then Settings → About → Check for updates should find 0.11.1 and Restart should install it. The release assets (`latest.yml`, installer, blockmap) exist; the Windows updater code path itself has never run on a real Windows machine.
- Windows app after this session's shared-code changes: lyrics routing (Apple Music for Windows app id `AppleInc.AppleMusic…` must map to Apple Music), display selector, calendar settings (ICS only, Apple row hidden), About page.
- Upgrade from the old portable folder to the installer keeps settings in `%APPDATA%\Atoll` (same `appId`/`productName`); confirm on the first real install.
- `app/test/reminders-settings-ui.test.js` is a leftover browser-level test needing a Chrome path; not in any suite. Decide to fix or delete.

## Needs verifying on macOS

- Real Apple Music and Spotify lyric fetching with signed-in accounts (verified once by hand at 0.10.9 for Apple Music).
- Real Apple Calendar permission grant and real events (UI is tested with a stubbed reader; the EventKit query runs unauthorized in tests).
- DONE 2026-11-04: Release workflow produced all six assets for v0.11.0 and v0.11.1, and the installed Mac app updated itself from 0.11.0 to 0.11.1 through Settings → About (checked by the user on a real Mac).
- CI flake: `app/test/task-time-ui.test.js` failed once on the macos-14 runner at its first click (panel control never visible) with the same code that passed the run before. Not reproduced locally. Tests now use `openTab()` in `app/test/launch.js` (re-sends the open command, waits for the control, prints page/app state on failure). If it fails again, read that printed state.
- `native/mac/qa/qa.cjs` has failed once on the first launch of some fresh builds and passes on rerun; cause not found.
- First CI run: Windows build, shared UI tests and Windows smoke test passed; the macOS-only step failed because the Mac QA scripts could not find Playwright (fixed: they now resolve it from `app/`). CI is now green on both OSes (run on commit f4ceb3f: unit tests, macOS build + UI + Mac tests, Windows build + UI + smoke).

## Open items for the user

- Create the GitHub repo (the code assumes `patricktechyy/atoll`, public). If the name differs, change `build.publish` and `repository` in `app/package.json`. In the repo's Settings → Actions → General, set Workflow permissions to **Read and write**.
- Existing 0.10.x users have no updater: they must install 0.11.0 by hand once.
- Optional later: Apple Developer ID (stops the Mac permission re-prompts and Gatekeeper warning) and a Windows code-signing certificate (stops SmartScreen warning).
