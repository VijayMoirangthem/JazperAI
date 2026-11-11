# Reaching Jazper from your phone: own app vs Telegram (decision + how it works)

Short answer: **use both; they cover different needs.** Neither replaces the other.

| | Own Jasper app | Telegram bot |
|---|---|---|
| Install / updates | APK you build and install (Android build on Windows is fragile; see "Building") | Nothing to install: you already have Telegram |
| Works away from home | Only through a tunnel (`scripts/jasper-remote.ps1`, Cloudflare) that must be running | **Yes, with no tunnel**: the PC polls Telegram outbound, so there is no public address to keep up |
| Notifications / push | Needs push setup (Expo push registration exists) | Telegram's own push, reliable |
| Voice notes, photos | Mic/camera in-app | Telegram voice/photo messages (transcription not built yet) |
| Rich features | Approvals (Tier-3 actions), bot "office", cards, biometric lock, offline outbox | Plain text only; approvals not wired |
| Privacy | Stays between phone and your PC | Messages pass through Telegram's servers (bots are not end-to-end encrypted) |
| If the PC is off | Does not work | Does not work (the brain runs on the PC) |

**Recommendation:** Telegram for quick everyday access from anywhere (zero setup, no tunnel); the own app for approvals, the office view
and anything sensitive. Both talk to the **same brain** (`/api/chat2/stream`), so email, Drive, status, Hinglish/Hindi and memory behave
identically.

## Same brain everywhere

App, phone and Telegram all go through `chat2` -> Jasper's tool loop. Email questions are answered from the real mailbox by
`agents/email_fast.py` (never by the model), in English, Hindi or Hinglish.

## Building and installing the phone app (Windows)

* Release builds are standalone (JS bundled inside), so the phone does not need Metro. They are signed with the project's debug key,
  the same key as the app already on the phone, so the update installs in place and keeps your pairing.
* Windows' 260-character path limit breaks react-native-reanimated's native build under `D:\Projects\COOS\mobile`. Build with the helper
  init script that moves CMake staging folders to `D:\b`:
  `cd mobile\android && gradlew.bat assembleRelease -I D:\b\short-native-paths.gradle` (the script is a small file outside the repo; recreate
  it from `docs/` notes if lost: it sets `android.externalNativeBuild.cmake.buildStagingDirectory` per module).
* Do **not** alias the project to a drive letter with `subst`: your `node_modules` is a junction to `D:\mn`, and the React Native Gradle
  plugin fails with "different roots" when the project and `node_modules` are on different drives.
* Install: `adb install -r mobile\android\app\build\outputs\apk\release\app-release.apk`, then `adb reverse tcp:8000 tcp:8000` so the
  phone's `localhost:8000` is your PC while it is on USB. Away from the PC, pair through the tunnel QR instead.

## Known gaps

* Mobile unit tests: 209 pass, 40 fail (35 stale snapshots from the theme/React Native rename, 5 React-in-test-environment errors). Not caused by recent changes; not fixed.
* Telegram voice notes and photos are not transcribed/understood yet. Tier-3 approvals cannot be answered from Telegram yet.
* WhatsApp is not built (needs a Meta Business account + public webhook; see `docs/ROADMAP_NEXT_LEVEL.md`).
