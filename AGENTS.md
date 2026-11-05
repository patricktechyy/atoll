# Rules for AI agents (Claude, Codex, anyone) working on Atoll

Atoll ships on **Windows and macOS** from this one repo. The shared renderer now has a Rust/Tauri host under parity verification; the Electron host remains for regression checks and fallback. Read `RUST_MIGRATION.md` before changing either host.
These rules exist so a change made on either laptop, by either AI, works on both platforms.
`CLAUDE.md` imports this file, so Claude and Codex follow the same rules.

## Start of every session

1. `git status` and `git pull`. If the tree has uncommitted changes you did not make, or the pull conflicts, stop and ask the user. Do not overwrite their work.
2. Read `STATE.md`: what the last session changed and what is still **unverified on which OS**.
3. Check which OS you are on. Working on one OS does not narrow the requested platform scope. Record which tests actually ran on each OS, distinguish simulated checks from real OS verification, and list untested platforms in `STATE.md`. Never claim an OS works unless a test ran on it.

## Where things live

| Path | What |
| --- | --- |
| `app/` | Shared interface plus the retained Electron host: `main.js`, `preload.js`, `src/`, `renderer/`, `assets/`, `test/`. **Its `package.json` holds the one version number.** |
| `rust/src/platform.rs`, `app/src/platform.js` | Host capabilities: what each OS can do. Ask capabilities in shared UI instead of adding scattered platform checks. |
| `rust/` | Rust/Tauri host, native commands, capabilities, packaging and updater. `rust/Cargo.lock` pins dependencies; app version is read from `app/package.json`. |
| `app/renderer/rust-bridge.js` | Rust implementation of the public Electron bridge. Keep the 95-method contract and both OS implementations in sync. |
| `tools/prepare-rust.js` | Generates the shared Rust frontend and builds/copies native helpers; run before Cargo. |
| `app/src/updater.js` | Retained Electron updater; release-feed compatibility with `rust/src/updates.rs` is required. |
| `native/mac/` | macOS native code (`helper.m`, `platform.m`), `build.sh`, Mac-only QA scripts. |
| `native/win/` | Windows helper build (`build-helper.js`) and prebuilt fallbacks. The helper source is `app/src/helper/atoll-helper.cs`. |
| `tools/` | Release helpers. |
| `.github/workflows/` | CI (both OSes on every push) and Release. |
| `PARITY.md` | Which features differ per platform, and why. |
| `STATE.md` | Hand-off between sessions, laptops and AIs. |
| `CHANGELOG.md` | One `## x.y.z` section per release. It becomes the release notes and the in-app "What's new". |

## Rules

1. **Shared first.** Keep the shared interface and pure JavaScript algorithms in `app/`, and Rust desktop logic in `rust/`. Both hosts must stay aligned during migration. Put platform-specific implementations behind capabilities in each host and in `native/<os>/`; prefer shared behavior over duplicated UI logic.
2. **Both platforms by default.** All features, fixes, UI changes, performance improvements, and architecture migrations must support both Windows and macOS unless the user explicitly requests a platform-specific change. Working on one operating system does not narrow the scope. Documenting a new platform limitation does not itself authorize excluding that platform.

   Preserve existing documented OS differences in `PARITY.md`; platform-specific implementations may differ while providing equivalent behavior where supported. An explicit user request may narrow a change to one platform, but shared code must still avoid regressions on the other. Record any new user-requested platform exception and its reason in `PARITY.md`. The settings UI for a missing feature must be hidden or explained, never broken.
3. **Test before you finish.** Run `npm test` (unit tests, any OS). For Rust changes, prepare assets, run Cargo tests/clippy, build and run `test:rust:ui` in the actual OS WebView. Shared renderer changes also need the retained Electron UI regression checks; on macOS build and run `npm run test:ui` (see below). Add or update a meaningful test for the change. CI runs both hosts on both OSes after the user pushes.
4. **Never edit a built app.** Do not hand-edit anything inside `Atoll.app`, `dist/`, or an installed copy. Change the source, build, test.
5. **One version, one changelog.** Bump `app/package.json` `version` only; add a `## <version>` section to `CHANGELOG.md` for anything user-visible. Releases need both (CI checks).
6. **Keep the updater working.** Do not rename release assets (`Atoll-macOS-arm64.zip`, `latest-mac.json`, `Atoll-Setup-<version>.exe`, `latest.yml`) or change `appId`/`productName`/the GitHub owner and repo in `app/package.json` without updating `app/src/updater.js`, the workflows and `README.md` together. Changing `appId` or `productName` would orphan users' settings.
7. **Lyrics policy.** Lyrics come only from the app that is playing (Spotify or Apple Music, the user's own signed-in account). Do not add third-party lyric sites back.
8. **Commits are the user's.** Commit as the repo's configured identity (`git config user.name` / `user.email`, the user's GitHub noreply address) so GitHub lists the user as the contributor. Never change that config, never author as an AI. An AI may be credited only with a `Co-Authored-By` trailer.
9. **No secrets, no pushing.** Never commit tokens or personal data. Never `git push`, create releases, or touch GitHub settings yourself: the user does that in GitHub Desktop / the website.
10. **Be honest in your final message.** Say what you ran, on which OS, and what you could not verify (usually: the other OS, real Apple Music / Windows media sessions, OS permission prompts).

## Rust build and test commands

```bash
npm ci --prefix app
npm start --prefix app
npm test
npm run test:rust --prefix app
npm run build:rust --prefix app
# Set ATOLL_RUST_APP to the built .app / Atoll.exe, then:
npm run test:rust:ui --prefix app
```

See `RUST_MIGRATION.md` for native toolchain prerequisites, output paths, account migration and outstanding parity checks. A public-method contract check is not a substitute for native OS verification. Keep both the Rust and Electron hosts working while the migration is under verification.

## Build and test commands

```bash
npm ci --prefix app                  # once
npm test                             # unit tests, any OS, no app needed

# macOS
bash native/mac/build.sh dist/Atoll.app            # needs Xcode CLT; downloads the pinned Electron
ATOLL_APP="$PWD/dist/Atoll.app" npm run test:ui    # shared UI tests against the built app
ATOLL_APP="$PWD/dist/Atoll.app" npm run test:mac   # macOS-only tests

# Windows (PowerShell)
npm run dist:win:electron:dir --prefix app         # Electron unpacked app in dist\win-unpacked
$env:ATOLL_APP="$PWD\dist\win-unpacked\Atoll.exe"; npm run test:ui --prefix app; npm run test:win --prefix app
```

UI tests use Playwright. If it is not resolvable, set `ATOLL_PLAYWRIGHT_MODULE` to its folder. They run on a throwaway profile and never touch real settings. UI tests need a logged-in desktop session.

## End of every session

1. `npm test` (and the UI tests if you changed anything visible).
2. Update `CHANGELOG.md` and, if platform behavior changed, `PARITY.md`.
3. **Rewrite `STATE.md`**: what changed and, for Windows and macOS separately, which checks actually ran, their results, and what remains unverified. Label simulated checks explicitly. Preserve outstanding verification items until they have actually been verified on the relevant OS; an untested platform remains in scope.
4. Commit locally with a clear message. Tell the user to **Push** in GitHub Desktop (and to publish a Release if they want users to get it).

## Releasing (the user does this on github.com)

1. Version bumped, `CHANGELOG.md` section written, everything pushed, CI green on both OSes.
2. GitHub → Releases → Draft a new release → create tag `v<version>` → Publish.
3. The Release workflow builds both platforms and attaches the installer, the Mac zip and the update feeds. Installed apps pick it up within about 6 hours (or via Settings → About → Check for updates).
4. Before announcing a release that changed the updater itself, test the update path on both OSes with two consecutive tags.
