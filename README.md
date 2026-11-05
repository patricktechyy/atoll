# Atoll

A living Dynamic Island for **Windows and macOS**: music with synced lyrics, timers, calendar, notifications, files,
clipboard history and system stats in your notch. Electron app, one codebase.

On a MacBook with a camera notch, Atoll stays joined to it: compact content sits in the visible wings,
and expanded pages grow down with their content below the camera. The layout adapts to the selected
display, so external monitors use the usual layout.

## Install

- **Windows:** download `Atoll-Setup-<version>.exe` from the latest [Release](../../releases/latest) and run it. Windows SmartScreen may warn because the installer is not code-signed: choose More info → Run anyway.
- **macOS (Apple Silicon):** download `Atoll-macOS-arm64.zip` from the latest Release, unzip, and drag `Atoll.app` to Applications. The app is not notarized, so macOS blocks the first launch: right-click `Atoll.app` → Open → Open, or run `xattr -dr com.apple.quarantine /Applications/Atoll.app` once. Atoll then asks for the permissions it needs (Automation for Music/Spotify, Calendar, Screen Recording).

## Updates

Atoll checks the GitHub Releases of this repository in the background (Settings → About → Update automatically),
downloads new versions and offers **Restart to update**. On macOS, installation waits for that button;
the default release build is ad hoc signed, so macOS may ask for permissions again after an update.

On Windows, Settings → About downloads updates in the background and offers **Restart to update**.
A downloaded update also installs when you quit Atoll. Use the Setup installer for Windows updates;
old portable builds and Windows versions through 0.11.5 need one manual installation of 0.11.6 or later
to pick up the repaired updater. Subsequent releases update from within Atoll.

## Develop

```bash
npm ci --prefix app
npm test                                    # unit tests (any OS)
bash native/mac/build.sh dist/Atoll.app     # macOS build (Xcode Command Line Tools)
npm run dist:win:dir --prefix app           # Windows unpacked build
```

Everything about how to work on this repo, including the rules for AI assistants and how both platforms are kept in
step, is in [AGENTS.md](AGENTS.md). Platform differences are listed in [PARITY.md](PARITY.md); the current
hand-off state is in [STATE.md](STATE.md).

## Releasing

1. Bump `version` in `app/package.json` and add a `## <version>` section to `CHANGELOG.md`.
2. Push. Wait for the **CI** workflow to be green on Windows and macOS.
3. GitHub → Releases → Draft a new release → create tag `v<version>` → Publish.
4. The **Release** workflow builds both platforms and attaches `Atoll-Setup-<version>.exe`, `latest.yml`,
   `Atoll-macOS-arm64.zip` and `latest-mac.json`. Installed apps find the new version through those files.

One-time repository setup: make the repository public (update checks read public Releases), and under
Settings → Actions → General → Workflow permissions choose **Read and write permissions**. The repository is expected
to be `patricktechyy/atoll`; if it is named differently, update `build.publish` and `repository` in `app/package.json`.

## License

MIT. Atoll bundles Electron and Chromium, whose licenses ship inside the app.
