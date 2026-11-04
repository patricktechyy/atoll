# Changelog

Each release needs a `## <version>` section. It becomes the GitHub release notes and the in-app "What's new".

## 0.11.0 - 2026-11-04

- Atoll now updates itself on Windows and macOS. Settings → About shows the current version, checks in the background every few hours, downloads new versions and installs them when you choose Restart. Turn off "Update automatically" there if you prefer.
- Apple Calendar on Mac: Settings → Calendar → Apple Calendar shows events from every calendar on the Mac, or only the ones you tick. Windows keeps the iCal link.
- Lyrics now come only from the app that is playing: Spotify for Spotify, Apple Music for the Music app, through your own account. The free lyric sites are gone. Apple Music lyrics were empty for many accounts; this is fixed.
- Choose which monitor the notch lives on: Settings → Appearance → Position → Show on screen, or right-click the notch.
- Mac: the window buttons no longer overlap the logo in the setup guide and Settings.
- Side layout: opening Tasks from the menu goes to the Tasks page.
- Earlier 0.10.x changes (water reminders switch, lyric timing range, romanization, Apple Music timing, understood languages) are included.

First install of this version is manual (earlier versions cannot update themselves): Windows runs the installer, macOS replaces Atoll.app. On first launch macOS may need right-click → Open because the app is not notarized, and may ask for Automation, Calendar and Screen Recording again after each update.
