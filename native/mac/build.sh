#!/bin/bash
# Build a local arm64 Atoll.app from the official Electron distribution.
#
#   bash native/mac/build.sh <output Atoll.app> [electron-vX.Y.Z-darwin-arm64.zip]
#
# Signing: ad hoc by default. An ad hoc app's only identity is its code hash, which changes with every build,
# so macOS drops the Automation (Music/Spotify), Calendar, Screen Recording and Accessibility permissions after
# each rebuild or update. To keep them, sign every build with the same certificate:
#   ATOLL_SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" bash native/mac/build.sh ...
# (list yours with: security find-identity -v -p codesigning). The permission then follows the certificate, not the hash.
#
# The output must not exist yet. Without a zip argument the matching Electron runtime is downloaded
# (or taken from ELECTRON_ZIP) and checked against the SHA-256 pinned in native/mac/electron-<version>.sha256.
# Needs macOS with Xcode Command Line Tools and Node.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
app="$root/app"
target="${1:?Usage: build.sh <output Atoll.app> [electron zip]}"
case "$target" in /*) ;; *) target="$PWD/$target" ;; esac
archive="${2:-${ELECTRON_ZIP:-}}"
sign_id="${ATOLL_SIGN_IDENTITY:--}"
sign() {
  if [ "$sign_id" = "-" ]; then codesign --force --sign - "$@"; else codesign --force --timestamp=none --sign "$sign_id" "$@"; fi
}
test ! -e "$target" || { echo "Output already exists: $target" >&2; exit 1; }

electron="$(node -p "require(process.argv[1]).devDependencies.electron" "$app/package.json")"
pin="$here/electron-$electron.sha256"
test -f "$pin" || { echo "No pinned checksum for Electron $electron. Add $pin (shasum -a 256 of the official zip)." >&2; exit 1; }
if [ -z "$archive" ]; then
  archive="$root/.cache/electron-v$electron-darwin-arm64.zip"
  if [ ! -f "$archive" ]; then
    mkdir -p "$root/.cache"
    curl -fL --retry 3 -o "$archive.part" "https://github.com/electron/electron/releases/download/v$electron/electron-v$electron-darwin-arm64.zip"
    mv "$archive.part" "$archive"
  fi
fi
test "$(shasum -a 256 "$archive" | cut -d' ' -f1)" = "$(tr -d '[:space:]' < "$pin")" || { echo "Electron checksum mismatch: $archive" >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ditto -x -k "$archive" "$stage"
bundle="$stage/Electron.app/Contents"
res="$bundle/Resources"
mkdir -p "$res/app/src" "$res/helper"
cp "$app"/{main.js,package.json,preload.js} "$res/app/"
cp -R "$app"/{renderer,assets} "$res/app/"
cp "$app"/src/*.js "$res/app/src/"
cp -R "$app"/src/vendor "$res/app/src/"
cp "$stage/LICENSES.chromium.html" "$res/"
cp "$stage/LICENSE" "$res/Electron-LICENSE"
cp "$root/LICENSE" "$res/Atoll-LICENSE"
clang -arch arm64 -mmacosx-version-min=13.0 -O2 -fobjc-arc -framework AppKit -framework ApplicationServices -framework ImageIO -framework AudioToolbox -framework CoreAudio -framework Carbon "$here/helper.m" -o "$res/helper/atoll-mac"
headers="${NODE_INCLUDE_DIR:-$(node -p "require('path').resolve(process.execPath, '../../include/node')")}"
clang -arch arm64 -mmacosx-version-min=13.0 -O2 -bundle -undefined dynamic_lookup -I"$headers" -fobjc-arc -framework AppKit -framework EventKit -framework CoreGraphics "$here/platform.m" -o "$res/helper/platform.node"
sign "$res/helper/platform.node"
mv "$bundle/MacOS/Electron" "$bundle/MacOS/Atoll"
plist="$bundle/Info.plist"
for key in CFBundleName CFBundleDisplayName CFBundleExecutable; do plutil -replace "$key" -string Atoll "$plist"; done
plutil -replace CFBundleIdentifier -string app.atoll.notch "$plist"
version="$(node -p 'require(process.argv[1]).version' "$app/package.json")"
plutil -replace CFBundleShortVersionString -string "$version" "$plist"
plutil -replace CFBundleVersion -string "$version" "$plist"
plutil -replace LSUIElement -bool true "$plist"
plutil -replace NSAppleEventsUsageDescription -string 'Atoll reads playback position and controls Music and Spotify for synced lyrics.' "$plist"
plutil -replace NSCalendarsFullAccessUsageDescription -string 'Atoll reads your calendar events to show your agenda and meeting reminders.' "$plist"
plutil -replace NSCalendarsUsageDescription -string 'Atoll reads your calendar events to show your agenda and meeting reminders.' "$plist"
sips -s format icns "$app/assets/icon.png" --out "$res/electron.icns" >/dev/null
sign "$res/helper/atoll-mac"
for framework in "$bundle"/Frameworks/*.framework; do sign "$framework"; done
for helper in "$bundle"/Frameworks/*.app; do sign "$helper"; done
sign "$stage/Electron.app"
codesign --verify --deep --strict "$stage/Electron.app"
if [ "$sign_id" != "-" ]; then
  codesign -d -r- "$stage/Electron.app" 2>&1 | grep -q 'certificate' || { echo "Signed with $sign_id but the designated requirement is not certificate-based; permissions would not persist." >&2; exit 1; }
fi
mkdir -p "$(dirname "$target")"
mv "$stage/Electron.app" "$target"
touch "$target"
echo "Built $target ($version), signed: $([ "$sign_id" = "-" ] && echo "ad hoc (permissions reset on every build)" || echo "$sign_id")"
