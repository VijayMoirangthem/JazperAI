# Jasper Mobile V2 — Prompts: the Grok Bot–style chat app

How to use: open OpenCode in `D:\Projects\COOS`. Paste **the GROUND RULES block** once per session, then paste **one prompt at a time**, in order (V2-0 → V2-15, with the backend prompts B1–B3 where marked). Do not paste the next prompt until the previous one ends with every check green, a screenshot from the real phone, and a commit.
V1 (M0–M13) is finished: pairing, bot list, streaming chat, approvals, outbox, mascots and push all exist and the app runs on the founder's phone. **V2 is a redesign and a feature upgrade**: the app must look and behave like the Grok Bot phone app (screenshots in `docs/mobile/version2/reference/`), on top of the Jasper backend.

Product decisions already made by the founder (do not re-ask):
- The app is a **chat-first** app: a clean list of bots, a beautiful chat, a floating composer. Not a dashboard.
- **Light theme is the default** (white screens, black pills, soft grey bubbles). Dark stays available as an option.
- **No login for now.** The Sign in button signs the single founder in with one tap (details in B1/V2-3). Real user accounts come in a later version, so keep authentication behind a small interface that can be swapped.
- Brand is **Jasper**. Never write "Grok Bot" anywhere in the app. Use the reference only for look, layout and behaviour.
- Copying code, shapes, animation maths and ideas from `Project_References/OpenMausBot` is allowed and encouraged (founder rule in CLAUDE.md: no licence restrictions on this personal project). Keep a short log in `docs/mobile/version2/COPIED_FROM_OPENMAUSBOT.md` (file, what was taken) so it can be swapped later.

---
## The reference screens (what we are copying)
All images are in `docs/mobile/version2/reference/`. Open and study each one before the prompt that mentions it.
| File | What it shows | Used by |
|---|---|---|
| `01-splash-sign-in.png` | White welcome screen. Ten mascots floating around the edges (some cut off by the screen edge), centred wordmark, grey tagline, one black pill button "Sign in" at the bottom | V2-3 |
| `02-desktop-list-pinned-row-search.png`, `03-list-rows-compact.png` | The bot list: search field, a row of large pinned bots with names, a small group label, then conversation rows: mascot, bold name, grey role chip, one-line preview, time, blue unread dot, highlighted selected row | V2-4 |
| `04-marketing-trio-splash-create-home.png` | Three phones: welcome (Log in / Sign up), Create New Bot sheet, home list | V2-3, V2-4, V2-8 |
| `05-chat-finished-tasks-cards-reaction.png`, `08-chat-assistant-messages.png` | The chat: back circle, name pill with mascot, "…" circle, centred time stamp, grey bot bubbles, black user bubbles, file card (icon + title + domain), emoji reaction chip stuck to a bubble, floating composer with "+" and a mic | V2-5, V2-6, V2-7 |
| `06-home-pinned-row-and-list.png` | Home: profile avatar top-left, search and "+" circles top-right, pinned row (star badge on the favourite), conversation list with times | V2-4 |
| `07-plugins-sheet.png` | Bottom sheet "Plugins": back circle, search field, filter circle, Featured list with logos and "Added ✓" / "Add" chips, Team plugins | V2-10 |
| `09-create-new-bot-sheet.png` | Create New Bot sheet: big animated mascot preview, name field, 8 shapes, 12 colours, black "Create" button | V2-8 |

Design facts read from the screenshots (verify by sampling the real pixels, see V2-1):
- Home has **no bottom tab bar**. One screen: avatar, search, plus, pinned row, list.
- Top buttons are **white circles, 44 px, soft shadow**. Primary buttons are **black pills**. Secondary buttons are light-grey pills.
- Bot bubble `#F2F2F2` (about), user bubble near-black `#111111` with white text, radius about 20, grouped bubbles tighten their corners.
- Unread marker is a **blue dot** (about `#1A82FF`) on the right of the row. Role chip is a small rounded grey tag next to the name.
- Mascot shapes seen: cloud, round blob, circle, squircle, capsule/pill, drop, hexagon, triangle, 4-point star, donut. Mascot colours seen (12): white, brown, red, orange, amber, green, teal, blue, purple, pink, grey, black. Every mascot has the same face: **two slanted white pill eyes**.

---
## Facts about this machine and project (the previous session learned these the hard way — respect them)
```
- Windows 11, PowerShell/Git Bash. Project: D:\Projects\COOS\mobile. Phone: Android, adb id E6EY4X7PJNZ9ZTRG (arm64-v8a), package com.vjmoirangthem.mobile, USB connected.
- Expo SDK 58, React Native 0.88, React 19, Node 24. New architecture on. Hermes on.
- node_modules is a JUNCTION to D:\mn (very short paths are REQUIRED: Windows path limit breaks the C++ build). D:\node_modules is also a junction to D:\mn. D:\c is a junction to D:\Projects\COOS.
  * NEVER run `npm install`, `npx expo install` or `npm ci` without telling the founder first: npm replaces the junction with a real folder and breaks the build. If you must add a JS-only package, install it, then check `Get-Item mobile\node_modules | Select LinkType,Target` still says Junction -> D:\mn; if not, stop and report.
  * D:\mn contains a stale duplicate tree at D:\mn\node_modules. Do not touch it. metro.config.js folds it back (do not edit metro.config.js unless a prompt says so).
- Build the Android debug APK ONLY from D:\c\mobile\android:  .\gradlew.bat assembleDebug --no-daemon --console=plain   (7-18 minutes). Install: adb -s E6EY4X7PJNZ9ZTRG install -r android\app\build\outputs\apk\debug\app-debug.apk
  * A native rebuild is needed ONLY when a native module is added/removed or android/ or app.json plugins change. Pure TypeScript/JSX changes need NO rebuild: just reload. So do not add native libraries unless a prompt lists them.
- Run the app: from D:\c\mobile run `npx expo start --dev-client --port 8081` (background), then `adb -s E6EY4X7PJNZ9ZTRG reverse tcp:8081 tcp:8081`, wake the phone (`adb shell input keyevent KEYCODE_WAKEUP`; keep it awake with `adb shell svc power stayon usb`), then `adb shell am start -n com.vjmoirangthem.mobile/.MainActivity`.
- Screenshots: run from Git Bash (NOT PowerShell, it corrupts PNGs):  adb -s E6EY4X7PJNZ9ZTRG exec-out screencap -p > D:/scratch/name.png  then look at it. A black picture means the phone screen is asleep.
- Logs: adb -s E6EY4X7PJNZ9ZTRG logcat -c  then reproduce, then  adb logcat -d -v brief ReactNativeJS:V AndroidRuntime:E *:S
- expo-av is REMOVED (broken on RN 0.88). Audio uses expo-audio (createAudioPlayer, AudioModule.AudioRecorder, RecordingPresets, setAudioModeAsync({allowsRecording, playsInSilentMode})).
- Accessibility roles: React Native 0.88 REJECTS accessibilityRole="group|separator|region|status|dialog" (red screen). Use the `role="group"` prop instead. accessibilityRole is fine for button, link, header, image, switch, progressbar, alert, tab, list.
- expo-camera: use the named export `Camera` and `CameraView` (no default export).
- @babel/runtime is v8, react-devtools-core is stubbed by metro.config.js. Do not import react-devtools-core.
- Do not kill processes you did not start (other node/java processes on this PC belong to other work). Stop Metro/Gradle you started with `gradlew --stop` or by their window.
- Backend (FastAPI) lives in D:\Projects\COOS\backend\python; the phone surface is api/routes/remote.py mounted at /remote/v1. Run its tests with the project's normal test command and tell me which command you used.
```

---
## GROUND RULES (paste first, in every new session)
```
You are upgrading the Jasper phone app in D:\Projects\COOS\mobile (React Native, Expo, TypeScript) from V1 to V2: a Grok Bot–style chat app. Read, in this order, before writing code: docs/mobile/version1/MOBILE_SPEC_V1.md, docs/mobile/version1/promptsMobileV2.md (this file: the "decisions", the "reference screens" table and the "facts about this machine"), then look at every image in docs/mobile/version2/reference/.
Rules you must follow without exception:
1. Do exactly what the current prompt asks. Do not add features, screens or libraries that are not listed. Do not change anything outside D:\Projects\COOS\mobile, docs\mobile and (only for prompts named B1/B2/B3) backend\python\api\routes\remote.py plus its tests.
2. The backend contract is section 7 of MOBILE_SPEC_V1.md PLUS the additions defined in prompts B1, B2 and B3 of this file. Never invent an endpoint, field or event. If something is missing or different, STOP, write the question in docs/mobile/version2/QUESTIONS.md and tell me. Do not guess.
3. The result must LOOK like the reference screenshots. After every UI prompt you must run the app on the real phone, take screenshots with the commands in "facts about this machine", compare them with the reference image named in the prompt, list every visible difference, and fix the differences that are not intentional before you finish. "It compiles" is not done. Save your screenshots to docs/mobile/version2/screens/<prompt-number>-<name>.png.
4. Work in small steps. After each step run the checks named in the prompt. Never leave the project in a failing state. `npm run check` (tsc + eslint + jest) must pass before every commit.
5. Never print, log, commit or hard-code a secret. The device secret lives only in expo-secure-store. No real values in .env files.
6. TypeScript strict. No `any` unless commented with the reason. Every exported function and component has explicit types. No hard-coded colours, radii, spacing or font sizes outside src/theme (from V2-1 onward).
7. Every new behaviour gets a test (jest) in the same commit; every new screen also gets a Maestro flow file under mobile/e2e (can be run later).
8. Do NOT add native dependencies unless the prompt lists them. Do NOT run npm/expo install without following the junction rule in "facts about this machine". Prefer pure TypeScript and what is already installed (react-native-reanimated, react-native-svg, react-native-safe-area-context, @shopify/flash-list, lucide-react-native, zustand, expo-sqlite, expo-audio, expo-camera, expo-image-picker, expo-document-picker, expo-clipboard, expo-secure-store, expo-local-authentication, expo-notifications).
9. UI text is plain English, short, friendly, no jargon, no "Grok". Support system font scaling. Every interactive element has an accessibility label and a 44 px minimum touch target. Respect reduce-motion (disable ambient animations).
10. Commit locally at the end of each prompt with the message "V2-<number>: <what>". Do not push. Do not delete files outside mobile/ and docs/mobile/.
11. When finished, print a short report: what you built, files changed, commands run, test results, the screenshot paths, the list of remaining visual differences from the reference (and why), anything unverified, anything you were unsure about.
```

---
## V2-0 — Audit, map and plan (no app code)
```
Goal: understand the gap between the current app and the reference, and write the plan. Do not change app code.
Steps:
1. Read the ground rules files and view all 9 images in docs/mobile/version2/reference/. For each image write down, in your own words, every UI element, size relation, colour, spacing and interaction you can see.
2. Study how OpenMausBot does the same things (read only): Project_References/OpenMausBot/src/components/{Sidebar*.tsx, SidebarThreadRow.tsx, ChatView.tsx, Composer.tsx, ComposerPlusMenu.tsx, message-menu.tsx, VoiceNoteBubble.tsx, ToolActivity.tsx, AttachmentGallery.tsx, NewBotDialog.tsx, PluginsPanel.tsx, Avatar.tsx, onboarding/WelcomeFlow.tsx}, shared/{mascot-bodies.ts, bot-avatar.ts}, src/lib/{bot-unread.ts, bottom-follow.ts}, src/hooks/use-unread-divider.ts, docs/ios-companion.md. These are web/Electron code: take the behaviour, the maths and the SVG data, not the DOM.
3. Audit the current mobile app (read only): app/**, src/components/**, src/store/**, src/db/**, src/api/client.ts, src/mascot/**. Write down what already exists and what is missing for each reference screen.
4. Create docs/mobile/version2/PLAN_V2.md with: (a) a table "reference screen -> current screen -> gap -> prompt that closes it"; (b) the new navigation: no tab bar, a single Home screen, stack screens `chat/[slug]`, `bot/[slug]`, `search`, `settings`, `approvals`, `activity`, `thread/[id]`, sheets for Create Bot / Plugins / Profile; (c) the new folder layout (src/theme with light+dark, src/components/mascot, src/components/home, src/components/chat, src/components/sheets); (d) a list of every V1 file that must change; (e) the data model additions: per-bot `look {body,color}`, `pinned`, `muted`, `lastReadMessageId`, message `reactions`, `searchIndex` (SQLite FTS5); (f) risks.
5. Create docs/mobile/version2/QUESTIONS.md (empty list) and docs/mobile/version2/COPIED_FROM_OPENMAUSBOT.md (empty table: file, what was taken).
Acceptance: the three files exist, PLAN_V2.md covers all 9 reference images and every V2 prompt. No code changed. Commit "V2-0: audit and plan".
```

---
## B1 — Backend: one-tap Sign in (no login yet)
```
Goal: let the phone sign the single founder in with one tap, safely, so the Sign in button works without a pairing code. This is temporary scaffolding for development until real accounts exist.
Rules: only edit backend/python/api/routes/remote.py (+ a new test file under backend/python/tests). Follow the existing code style. Read core/remote_guard.py first: any request that arrives through the public tunnel must still be refused outside /remote/v1, and the new endpoint must NOT be usable through the tunnel.
Steps:
1. Add `POST /remote/v1/auth/dev-signin` body `{name, platform, push_token?}` -> same response as /pair/complete: `{device_id, device_secret, access_token, expires_in}`. It creates a device row exactly like pair_complete does (reuse the same helper, do not duplicate the logic).
2. Safety gates (all must hold, otherwise 403 with a plain message): (a) the vault/env flag REMOTE_DEV_SIGNIN equals "1"; (b) the request comes from a loopback or private-LAN address (127.0.0.1, ::1, 10.x, 172.16-31.x, 192.168.x) AND has no `cf-connecting-ip` / `cf-access-*` / `x-forwarded-for` header (that means it came through the tunnel); (c) rate limit 5 per hour.
3. Write an audit entry ("remote-dev-signin") like the other remote actions.
4. Add a local-only helper `POST /remote/local/dev-signin/enable` and `/disable` (local_router, same guard as the others) that set/clear REMOTE_DEV_SIGNIN, so the founder can turn it on from the desktop. Default is OFF.
5. Tests: flag off -> 403; flag on + loopback -> 200 and the returned token works on GET /remote/v1/me; request with cf-connecting-ip -> 403; non-private address -> 403; rate limit -> 429. Also confirm the existing remote tests still pass.
6. Document in docs/mobile/version2/PLAN_V2.md (section "Sign in") how the founder turns it on, and the plan to replace it with real accounts later (the app only talks to an AuthProvider interface, see V2-3).
Acceptance: all remote tests pass (give the exact command and output summary). Commit "B1: dev sign-in endpoint".
```

---
## V2-1 — Design system v2 (light default, dark option)
```
Goal: replace the V1 dark-only tokens with a two-theme design system that matches the screenshots, and move every existing component onto it.
Reference: all images, especially 05, 06, 08 (light theme).
Steps:
1. Sample real colours: write a tiny node script scripts/sample-colors.mjs (no new dependency; use the `pngjs`-free approach: if no PNG reader is installed, ask in QUESTIONS.md and instead read colours by eye and mark them "approximate") that prints the pixel colours of: screen background, bot bubble, user bubble, role chip background and text, unread dot, "Added" chip, primary pill, circle button background, divider, muted text. Put the final values in src/theme/tokens.ts. Record the values and how you got them in docs/mobile/version2/PLAN_V2.md.
2. src/theme: `tokens.ts` with two palettes `light` and `dark` (same keys): background, surface, surfaceSunken, bubbleBot, bubbleUser, textOnBubbleUser, text, textMuted, textFaint, border, hairline, accentBlue (unread dot, links), success/successBg, warning, danger, black/white pills, chipBg/chipText, overlay, shadow presets (circleButton, sheet, composer, card). Radii: bubble 20, pill 999, card 16, sheet 28, circleButton 22. Spacing scale 4/8/12/16/20/24/32. Typography: large title 34/40 semibold, title 24, row title 17 semibold, body 16/22, preview 15 muted, caption 13, chip 12. Use the system font (San Francisco / Roboto) with the weights the screenshots show.
3. `ThemeProvider` + `useTheme()` (setting: system | light | dark, default system -> light if the system is light). Persist in the settings store. StatusBar style follows the theme. No component may import colours directly any more: they use `useTheme()` (or `makeStyles(theme => ...)`).
4. New shared primitives in src/components/ui: `CircleButton` (44 px white circle, soft shadow, icon from lucide, accessibility label required), `PillButton` (primary black, secondary grey, destructive, loading, disabled), `Chip` v2 (role chip), `UnreadDot`, `SectionLabel`, `ListRow`, `Sheet` (bottom sheet with drag handle, spring open/close via reanimated, backdrop tap closes, safe-area aware, max height, keyboard aware, Android back closes it), `Toast`, `Skeleton`. Keep the old exports working by re-pointing them at the new tokens.
5. Migrate all existing screens and components to the tokens. Delete the Theme Demo (app/index.tsx must become a redirect: signed-in -> Home, not signed-in -> Welcome; the real welcome arrives in V2-3, for now redirect to the existing pair screen).
6. Tests: tokens have identical keys in both palettes; useTheme switches; snapshots updated deliberately (run jest -u only for the snapshots you changed on purpose and say which).
7. On the phone take screenshots of Home, Chat and Settings in light and dark.
Acceptance: `npm run check` passes; screenshots show white backgrounds, grey/black bubbles and black pill buttons; dark mode still readable; no hard-coded colour left (prove it with a grep for `#[0-9a-fA-F]{3,8}` and `rgba(` outside src/theme and src/mascot, result must be empty). Commit "V2-1: design system v2".
```

---
## V2-2 — Mascot v2 (shapes, colours, face, animation)
```
Goal: the mascot is the soul of the app. Make it match the reference exactly and keep it cheap to render in long lists.
Reference: 01, 02, 04, 06, 09 (shapes and colours), 07 (mascots peeking at the edge).
Steps:
1. Read the current src/components/Mascot.tsx, src/mascot/bodies.ts, src/utils/mascot.ts, src/store/mascot.ts and Project_References/OpenMausBot/shared/mascot-bodies.ts + scripts/gen-mascot-bodies.ts + src/components/Avatar.tsx + mascot-preview.tsx.
2. Shapes: the picker in image 09 shows 8 shapes (circle, soft blob, squircle, capsule, triangle, hexagon, cloud, drop); other images also show a 4-point star and a donut. Make `MASCOT_BODY_IDS` = circle, blob, squircle, capsule, triangle, hexagon, cloud, drop, star, donut (keep `cursor`, `shield`, `diamond` ids for backward compatibility so saved looks never break, but hide them from the picker). Reuse the reference SVG paths where they exist; draw the missing ones (cloud, triangle, donut) as clean closed paths in the same 200x200 box with softly rounded corners. All bodies must hold the SAME face at the SAME size (the face anchor table must be re-solved so nothing clips).
3. Face: two slanted white pill eyes exactly as in the images (about 22x26 units each, tilted about 12 degrees outward, spread about 25 units). Donut: the face sits on the ring side or the hole is shown, copy the look from image 01/04.
4. Colours: 12 palette entries (white with a hairline border, brown, red, orange, amber, green, teal, blue, purple, pink, grey, black) exported as MASCOT_COLORS with a flat fill (the screenshots use flat, slightly glossy colour, no strong gradient: keep a very subtle top-left highlight only). Provide `mascotGradient(color)` that stays backwards compatible. Eyes become dark on the white mascot.
5. Animation (reanimated, UI thread): idle (slow blink every 3-6 s random per instance, tiny breathing scale 1.00-1.02), look-around (eyes drift left/right now and then), thinking (eyes up-left, gentle wobble), working (eyes squint, small bounce), alerting (eyes wide, quick pulse), happy (smile squint, one hop), sad. `state` prop as in V1. Ambient animation is OFF when `animated={false}`, when the list is scrolling fast, and when the system reduce-motion setting is on.
6. Performance: one shared animation clock for all idle mascots instead of one timer per instance; memoise SVG; a `MascotStatic` variant that renders a plain svg (no reanimated) for list rows far from the viewport; verify a list of 60 mascots scrolls at 60 fps (use the Perf monitor or measure frames, state the result).
7. New pieces: `MascotBadge` (star badge for the pinned/favourite bot, bottom-right, white ring), `MascotStatusDot` (orange dot for "needs attention" as on "Demo Orchestrator" in image 02), `MascotCluster` (floating decorative mascots used by the Welcome screen, accepts positions, sizes, rotation and a drift speed).
8. A temporary dev route app/dev/mascots.tsx (only in __DEV__) shows every shape x colour x state so you can see them all on the phone. Remove it from production builds.
9. Look storage: `look {body,color}` per bot in the mascot store, persisted. Default look for a bot with no saved look is derived deterministically from its slug (stable hash -> body+colour) so the list is colourful and never changes between launches.
10. Tests: every body id has a path and an anchor; default look is deterministic; the 12 colours exist; snapshot of Mascot in 3 states; reduce-motion disables the loop.
Acceptance: screenshots of the dev mascot grid next to images 04/09 look the same family; `npm run check` passes. Commit "V2-2: mascot v2".
```

---
## V2-3 — Welcome screen and one-tap Sign in
```
Goal: the first screen, exactly like image 01 (and the left phone of image 04, but with a single "Sign in" button), and a working one-tap sign in using endpoint B1.
Reference: 01, 04.
Steps:
1. Authentication seam: create src/auth/AuthProvider.ts with `interface AuthProvider { signIn(): Promise<Session>; signOut(): Promise<void>; restore(): Promise<Session | null> }` and two implementations: `DevOneTapAuth` (calls POST /remote/v1/auth/dev-signin with the phone model as name and platform android, stores the result exactly like the V1 pairing does: device secret in expo-secure-store only) and `PairingCodeAuth` (the existing V1 pairing flow, unchanged). The app picks DevOneTapAuth by default; Settings > Advanced > "Pair with a code" switches to PairingCodeAuth and is the way to connect through the tunnel. Nothing else in the app may know which provider is active.
2. Server address: read EXPO_PUBLIC_JASPER_URL (build-time) with this default for development on the connected phone: `http://localhost:8000` (the founder runs `adb reverse tcp:8000 tcp:8000`). Show the address read-only in Settings. Keep the V1 rule: HTTPS only except localhost/10.0.2.2 in development.
3. Welcome screen app/welcome.tsx: white background; wordmark "Jasper" (about 36 px, medium weight, centred slightly above the middle); tagline "Your team of always-on agents that finish the work." (grey, 2 lines, centred); black pill "Sign in" fixed near the bottom with safe-area padding and a soft shadow behind it as in image 01. Ten mascots (MascotCluster) float around the screen edges, some clipped by the edges, each with different shape, colour, size (about 36-72 px), rotation and a slow independent drift (a few pixels, 6-12 s loops). They never overlap the text or button. When reduce-motion is on they are still.
4. Sign in behaviour: tap -> button shows a spinner and "Signing in…" -> on success fade/scale transition to Home; on failure a calm inline message under the tagline ("Can't reach Jasper on your computer. Is it running?") with a "Try again" text button, plus a small link "Use a pairing code instead" that opens the V1 pair screen. Never show raw errors, tokens or URLs.
5. Launch routing in app/index.tsx: restore session -> Home; none -> Welcome. Sign out (Settings) clears secure store, local caches stay unless the user also chooses "Erase chats on this phone".
6. Entrance animation: mascots pop in with a staggered spring, text fades up, button slides up (about 600 ms total, skipped under reduce-motion).
7. Tests: AuthProvider contract tests with a fake client; routing test (session vs none); Welcome renders wordmark/tagline/button; failure path shows the friendly message. Add e2e/welcome-signin.yaml.
8. Manual test on the phone with the backend running and dev sign-in enabled (B1): tap Sign in and reach Home. Take screenshots of Welcome (idle and failure state: stop the backend to get it).
Acceptance: Welcome matches image 01 closely; sign in works end to end; no secret in logs (grep the logcat output). Commit "V2-3: welcome and one-tap sign in".
```

---
## V2-4 — Home: pinned row and conversation list
```
Goal: the Home screen from images 06 and 02/03: the main screen of the app.
Reference: 06, 02, 03, 04 (right phone).
Layout, top to bottom:
1. Header (safe-area aware): profile avatar button on the left (circle with the user's initial or photo; opens the Profile sheet in V2-12), on the right a search CircleButton and a plus CircleButton. A small attention chip appears next to them only when there is something pending: "N approvals" (amber dot) that opens the Approvals screen. There is NO bottom tab bar any more: remove the (tabs) layout and move the existing screens to stack routes without breaking the V1 approval and push-deep-link behaviour.
2. Pinned row: a horizontal row of large mascots (about 88-100 px) with the name under each (one line, ellipsis), the first/favourite one can carry the star badge, bots needing attention carry the orange status dot. It shows pinned bots only; if none are pinned, the row is hidden and a one-time hint card says "Long-press a bot to pin it here". Snap scrolling, no scrollbar.
3. Conversation list (FlashList): rows exactly like the images: mascot (about 48 px) on the left; to its right the bold name (17 px) followed on the same line by the grey role chip (the bot's `position`/`department`; hide the chip if empty; ellipsis if too long); under it a one-line grey preview of the last message (strip markdown, prefix "You: " for your own messages, show "Typing…"/"Working…" while a stream is running in the background, show an approval pending as "Needs your approval"); on the right the time (today: "12:12 PM"; yesterday: "Yesterday"; this week: weekday; older: date) and below or beside it a blue unread dot when unread. Group labels (small grey text like "mobile") separate groups: use the group_label the server sends. Sort inside a group by last activity, bots with no chat after bots with chats. Row height stays constant (about 76 px); the pressed row shows a light-grey highlight with rounded corners as in image 02/03.
4. Search: tapping the search circle expands a full-width search field at the top (Search icon, placeholder "Search", cancel text button) that filters bots live by name/role/last message. Global message search comes in V2-11; leave a clear seam.
5. Pull to refresh (calls GET /bots), skeleton rows while the very first load runs, offline state shows the cached list with a thin "Offline" notice, empty state ("No bots yet" + "Create a bot" pill that opens the Create Bot sheet, V2-8).
6. Long-press on a row or pinned mascot: context menu sheet (Pin/Unpin, Mark as read/unread, Mute/Unmute, View profile, Clear chat) with a light haptic if expo-haptics happens to be available, otherwise none. Pinned bots and mute flags persist locally (SQLite) and are reflected immediately.
7. Unread logic (port the idea from OpenMausBot src/lib/bot-unread.ts): per bot `lastReadMessageId`; a bot is unread when it has a bot message newer than that; opening the chat marks it read when the newest message is visible; a new message in a chat that is not open sets unread and bumps the app badge count (V2-13).
8. Data: previews and times come from the local SQLite chat tables (add a `bot_meta` table: slug, pinned, muted, lastReadMessageId, lastMessageAt, lastPreview). Update it whenever a message is saved. Never block rendering on the network.
9. Tests: unread calculation, preview formatting (markdown stripped, "You: "), time formatting for today/yesterday/week/older with an injected clock, sorting, pin/mute persistence, empty/offline states; component test for a row and the pinned item. Add e2e/home.yaml.
10. Phone: seed at least 8 bots with different looks (use the real backend bots), take screenshots, compare with 06 and 02, fix differences (spacing, font weights, chip colour, dot colour, time alignment).
Acceptance: Home looks like the reference; scrolling 100 rows is smooth; V1 approval/push flows still reach their screens (test the route mapping). Commit "V2-4: home".
```

---
## V2-5 — Chat screen (the heart of the app)
```
Goal: a chat that looks and feels like images 05 and 08, with all the behaviours of the desktop chat that make sense on a phone.
Reference: 05, 08. Behaviour reference: Project_References/OpenMausBot/src/components/ChatView.tsx, message-menu.tsx, ToolActivity.tsx, AttachmentGallery.tsx, src/lib/bottom-follow.ts, src/hooks/use-unread-divider.ts.
Header (floating over the content, safe-area aware, translucent white with blur-like soft shadow, no hard border): left a white circle back button; centre-left a white pill containing the bot's mascot (about 28 px, animated by state) and the bot's name (tap the pill to open the bot profile); right a white circle "…" button that opens the chat menu (Search in chat, Mute, View profile, Clear chat, Speak replies on/off).
Timeline:
1. Day/time separators: centred small grey text such as "Today 7:58 AM" shown at the start of the chat and whenever the gap between two messages is more than 30 minutes or the day changes ("Yesterday 4:20 PM", "Mon 9:02 AM", "12 Mar 2026 9:02 AM").
2. Bubbles: bot messages on the left in the grey bubble, yours on the right in the black bubble with white text, max width about 82 %, radius 20, consecutive bubbles from the same sender sit closer together (4 px) and square off the touching corners. No avatar next to bubbles (the header already shows who it is). Selectable text on long-press of a word range is NOT required; the message menu "Select text" opens a sheet with the text selectable.
3. Rich content inside the bubble list: (a) markdown-lite (bold, italic, inline code, code blocks with a language label and a copy button, lists, headings as bold lines, tables as horizontally scrollable grids, links); links do not open directly: they show the confirm sheet "Open link? <domain>" (security rule); (b) file/link cards as in image 05: a rounded grey card with a type icon (document, sheet, slide, pdf, image, generic), bold title, grey domain/size line; tap opens the link confirm sheet or the attachment viewer; (c) image attachments as rounded thumbnails (tap -> full-screen viewer with pinch zoom is NOT required, a simple viewer is enough); (d) voice notes as a bubble with play/pause and a waveform (V2-7); (e) V1 cards stay: approval card (Tier 1/2/3), connector suggestions, untrusted badge, "Finish this on the desktop" cards, tool chips.
4. Tool activity: while a bot works show ONE compact line under its bubble: "Working… 3 steps" with the mascot squinting; tapping expands to the list of tool chips (label + running/ok/error). When finished it collapses to "Used 3 tools" (tap to expand again).
5. Thinking state: before the first delta arrives show a bubble with three animated dots; the header mascot goes into the `thinking` state, then `working` while tools run, then a short `happy` hop when the message completes.
6. Reactions (image 05, thumbs-up chip stuck to the bubble's lower-left corner): long-press a bot message -> a floating emoji bar above it (👍 👎 ❤️ 😂 😮 🙏) plus the message menu below it (Copy, Reply with quote, Edit and resend [yours only], Regenerate [last bot message only], Speak, Select text, Delete). Choosing an emoji adds a small white chip with the emoji overlapping the bubble corner; tap it to remove. Store reactions locally (new `message_reactions` table). 👍/👎 on a bot message also call the existing rating mechanism V1 used (do not change the contract).
7. Streaming quality: batch deltas to at most 30 UI updates/second so scrolling stays smooth; keep the stream in a ref and flush on a timer; the list uses FlashList inverted-friendly logic with "follow" behaviour: stays pinned to the bottom while you are at the bottom, stops following the moment you scroll up, and then shows a floating "↓" pill with the number of new messages that scrolls to the bottom when tapped (port the idea of bottom-follow.ts). An "Unread" divider is drawn above the first unread message when you open a chat with unread messages (port use-unread-divider.ts).
8. Errors: a failed send shows the message with a small red "Not sent. Tap to retry" under it; stream errors show a calm red system bubble; offline queued messages show "Waiting for connection" in grey (V1 outbox continues to work).
9. Keyboard: composer rides on top of the keyboard with no flicker, the list keeps the last message visible, the header never jumps (use react-native-safe-area-context + KeyboardAvoidingView or the reanimated keyboard hooks; test on the real phone).
10. Performance: 500 messages must scroll at 60 fps; messages are memoised by id+version; markdown parsing is cached per message.
11. Tests: day-separator logic, bubble grouping, reaction storage, follow-bottom state machine, delta batching, tool-activity summary text, link confirm flow; component tests for bubble, card, separator; Maestro e2e/chat.yaml (send, stream, react, copy).
12. Phone: use a real bot, send a message, capture screenshots: empty chat, streaming with dots, finished with a card, reaction chip, long-press menu, tool activity expanded, scrolled-up with the "↓" pill, keyboard open. Compare with 05 and 08, fix differences.
Acceptance: the chat visibly matches the references; all V1 chat features (stop, retry, edit, delete, regenerate, copy, rate, speak) still work; `npm run check` passes. Commit "V2-5: chat".
```

---
## V2-6 — Composer v2 and attachments
```
Goal: the floating composer from images 05/08 and everything attached to it.
Reference: 05, 08, 06. Behaviour reference: OpenMausBot src/components/Composer.tsx, ComposerPlusMenu.tsx, ComposerAttachments.tsx, ComposerQueuedMessages.tsx.
1. Shape: a white floating pill (soft shadow, no hard border) pinned above the keyboard/safe area with a 12 px side margin. Left: a white 44 px circle "+" button. Middle: the text input with the grey placeholder "Ask {bot name}" (e.g. "Ask Chief of staff"). Right: a light-grey circle mic button. When the input has text (or there are attachments) the mic turns into a black circle send arrow with a small spring animation. While a reply is streaming the send button becomes a black circle with a stop square (stops the stream, V1 behaviour).
2. Input: multi-line auto-grow up to about 6 lines then scrolls inside; the pill grows into a rounded rectangle (radius stays 24); return key = new line (sending is only the button); paste works; system font scaling respected; the draft is saved per bot (SQLite `drafts` table, debounced 400 ms) and restored.
3. "+" menu: a small popover/sheet above the button with Camera (take a photo), Photo library, File. Each shows an icon (lucide) and a plain label. Permissions are requested only when the item is tapped with a friendly explanation if denied (with an "Open settings" button).
4. Attachments: chosen items appear as a horizontal strip ABOVE the pill: image thumbnails (64 px, rounded, small "x" circle to remove) and file chips (icon, name, size). Rules from V1 stay: text files are sent inline up to 200 000 characters, images are display-only with a quiet note "Jasper can't read pictures yet" (spec section 11.3), other binary files are refused with a clear message. Max 6 attachments.
5. Offline: when offline the send button still works, the message is queued (V1 outbox) and the composer shows a thin chip "Will send when you're back online".
6. Quote reply: when the user chose "Reply with quote" from the message menu, a small grey quote bar with an "x" appears above the pill; the quote is prefixed to the sent text as a markdown blockquote.
7. Haptics: none (no new native module). Animations: pill growth and button swap use reanimated layout transitions and respect reduce-motion.
8. Tests: draft save/restore, button state machine (idle/typing/streaming/recording), attachment rules (inline text, image note, refusal, max count), quote prefix, queue chip; component tests; e2e/composer.yaml.
9. Phone: screenshots idle, typing multi-line, with attachments, streaming (stop button), offline chip, plus menu open. Compare with 05/08.
Acceptance: composer matches the reference; keyboard never covers it; `npm run check` passes. Commit "V2-6: composer".
```

---
## V2-7 — Voice notes and read aloud
```
Goal: voice that feels native: record from the mic button, see a waveform, send or cancel; replies can be read aloud with the bot's voice.
Reference: OpenMausBot src/components/VoiceNoteBubble.tsx, VoiceSettings.tsx; images 05/08 (mic button).
Use expo-audio only (see facts). Keep V1's server contract: POST /remote/v1/voice/transcribe, GET /remote/v1/voice/speak.
1. Recording UI: tapping the mic turns the composer pill into a recording bar: red pulsing dot, elapsed time (m:ss), a live waveform (use the recorder's metering/level values; if metering is not available fall back to a smooth fake level and say so in the report), a grey "Cancel" (trash) button on the left and a black circle "Send" on the right. A mic permission denial shows the friendly settings message. Max 5 minutes (stops and offers send). Cancel discards the file immediately.
2. Sending: the audio is transcribed on the server, the transcript is inserted into the composer as text (V1 behaviour) and the user can edit then send. Setting "Send voice notes as text automatically" (off by default): when on the transcript is sent immediately and shown in the chat as a voice-note bubble (waveform + play + the transcript text under it, collapsible).
3. Voice-note bubble (yours): play/pause, scrubbable progress, duration, transcript toggle. Audio stays on the phone only (cache folder), never uploaded except for transcription.
4. Read aloud: speaker icon in the message menu and a small speaker button under the last bot message; plays chunks in order (V1 splitForSpeech), shows a tiny "speaking" animation on the header mascot (state happy/working loop) and a floating "Stop" pill. Setting "Read replies aloud automatically" (off by default). Only one audio source plays at a time; starting a recording stops playback; incoming phone calls/other audio interrupt cleanly.
5. Failure handling: transcription returns empty -> message "I couldn't hear anything. Try again."; offline -> "Voice needs a connection"; no raw errors.
6. Tests: recorder state machine with a fake recorder, one-audio-at-a-time rule, auto-send setting, empty transcript, chunking; e2e/voice.yaml (record and cancel).
7. Phone: record a short note, check transcript lands in the composer; play a reply aloud. Screenshots of the recording bar and the voice-note bubble.
Acceptance: voice works on the real phone or the report states exactly which part could not be verified and why. Commit "V2-7: voice".
```

---
## B2 — Backend: create a bot and save its look from the phone
```
Goal: let the phone create a bot and store its look (shape + colour) so desktop and phone share it.
Rules: edit only backend/python/api/routes/remote.py and add tests. Read api/routes/bots.py (BotIn, upsert, /{slug}/settings, /{slug}/org) and agents/registry.py first. Reuse them, do not duplicate logic.
1. `POST /remote/v1/bots` body `{display_name, role_title?, look?: {body, color}, instructions?}` -> creates the bot through registry.upsert with SAFE defaults decided by the server, never by the phone: slug derived from the name (lowercase, hyphens, unique suffix on clash), crew "mobile" (group label "mobile"), reports_to "jasper", tools = a minimal read-only set (list exactly which tool names; no shell, file-write, email-send, payment or secret tools), model tier "standard", prompt = a short template built from role_title/instructions (max 4 000 characters, stripped of control characters). Respond with the same public shape as GET /remote/v1/bots entries plus `look`.
2. `PUT /remote/v1/bots/{slug}/look` body `{body, color}` validated against the allowed ids/colours; stored in the bot settings JSON (use the existing settings mechanism) and returned by GET /bots and GET /bots/{slug}/card as `look` (null when unset).
3. `PATCH /remote/v1/bots/{slug}` body `{display_name?, role_title?}` rename/retitle only.
4. `DELETE /remote/v1/bots/{slug}` = disable (soft), never hard delete; refuse for built-in bots (jasper and any registry-flagged core bot) with 403.
5. Every call writes an audit entry. Rate limit creation to 10 per hour per device.
6. Tests for each endpoint including the refusals (built-in bots, invalid look, name too long, rate limit) and that a phone-created bot has no dangerous tools.
7. Update the contract table in docs/mobile/version2/PLAN_V2.md.
Acceptance: all remote and bots tests pass (exact command + summary). Commit "B2: create bot and look endpoints".
```

---
## V2-8 — Create New Bot sheet
```
Goal: image 09 as a working feature, plus the entry points.
Reference: 09, 04 (middle phone).
1. Sheet (uses the Sheet primitive from V2-1, opens from the plus CircleButton on Home and from the empty state): top-left grey circle "x", title "Create New Bot" (small, centred-left as in the image). Below: a large live mascot preview (about 150 px, `animated`, reacts: a happy hop every time the shape or colour changes). Under it a rounded grey name field with the placeholder "Name your bot" (centred text, 40 characters max, autofocus, return key "Done"). Under it the shape grid: 2 rows x 4 (circle, blob, squircle, capsule / triangle, hexagon, cloud, drop) drawn in the currently selected colour; the selected shape has a soft ring. Under it the colour palette: 2 rows (6 + 6) of 12 round swatches; the selected has a ring. Bottom: a full-width black pill "Create" (disabled until the name has at least 2 characters) that shows a spinner while creating.
2. Optional "Add a role" disclosure under the name field (collapsed by default): role/title (60 chars) and "What should it do?" multi-line (500 chars). These feed B2's role_title/instructions.
3. Flow: Create -> POST /remote/v1/bots (B2) -> save the look locally -> close the sheet -> navigate to the new bot's chat with a friendly first message from the bot ("Hi, I'm {name}. What should I help with first?" generated locally as a bot-side message marked `local`, not sent to the model) and a short confetti-free celebration: mascot hop. Failure -> inline friendly message, sheet stays open, nothing lost.
4. Random look: the first time the sheet opens, preselect a random shape and colour (not white) so the user sees something nice immediately; a small shuffle icon next to the preview re-rolls both.
5. Tests: validation, random look, request body, failure keeps the form, local first message is not sent to the server; component test; e2e/create-bot.yaml.
6. Phone: create a bot end to end against the real backend (B2 deployed). Screenshots of the sheet in default and filled state; compare with 09.
Acceptance: the sheet matches image 09; the new bot appears on Home with the chosen look and in the desktop roster. Commit "V2-8: create bot".
```

---
## V2-9 — Bot profile screen
```
Goal: tapping the name pill in a chat (or "View profile" anywhere) opens a clean profile that replaces the V1 ID-card sheet visually while keeping its data.
Reference: style of 09 and 06; data from GET /remote/v1/bots/{slug}/card.
1. Layout: a full-screen sheet/screen with a back CircleButton, a large animated mascot (about 120 px), the bot name (editable inline for bots the phone may rename; uses PATCH from B2), the role chip, and a row of three pill actions: Message, Pin/Unpin, Mute/Unmute.
2. Sections as rounded grey cards: About (role, group, reports to, created, status), Look (opens the same shape/colour pickers as V2-8 in place; saves via PUT .../look), Activity (calls, thumbs up/down, average reply time, last active, score badge with the V1 colour rule), Tools it can use (read-only list from the card), Plugins (compact list of connected plugins with link to V2-10), Notifications (per-bot mute), Danger zone (Clear chat on this phone, Archive bot [DELETE soft, only for phone-created bots]).
3. No system prompt is ever shown (the card does not contain it). Do not add prompt editing in V2.
4. Offline: show the last cached card with an "Offline" notice; actions that need the server are disabled with a reason.
5. Tests: formatting of stats, score colour, rename flow, archive refusal for built-in bots (button hidden), look save; component test; e2e/profile.yaml.
6. Phone screenshots: profile of a built-in bot and of a phone-created bot.
Acceptance: profile is clean, fast (cached first, refresh in background) and matches the app's style. Commit "V2-9: bot profile".
```

---
## B3 — Backend: read-only plugin catalogue for the phone
```
Goal: give the phone the data for the Plugins sheet without ever sending credentials.
Rules: edit remote.py and add tests only. Read api/routes/mcp_hub.py, api/routes/connections.py and core/mcp hub code first; reuse them.
1. `GET /remote/v1/connectors` -> `{featured: [...], team: [...], all: [...]}` where each item is `{id, name, description (max 140 chars), category, logo_key, connected: boolean, status: "added"|"available"|"needs_attention", tier_summary: "read"|"read_write"|"sensitive"}`. `logo_key` is a short stable key such as "gmail", "google-calendar", "google-drive", "slack" that the app maps to a bundled icon (no remote images). Featured = the connectors that are connected plus a small curated list; team = shared/team connectors.
2. `POST /remote/v1/connectors/{id}/request` -> records a request "founder wants {name} connected" and raises a desktop notification/approval-style item "Finish connecting {name} on this computer". Returns `{requested: true}`. Credentials and OAuth never go through the phone.
3. Never include secrets, env var values, commands or URLs in any response.
4. Tests: shape, no secret fields (assert on the serialised JSON), request creates the desktop item, unknown id -> 404, rate limit.
5. Update the contract table in PLAN_V2.md.
Acceptance: tests pass (exact command + summary). Commit "B3: connectors catalogue".
```

---
## V2-10 — Plugins sheet
```
Goal: image 07.
Reference: 07. Behaviour reference: OpenMausBot src/components/PluginsPanel.tsx.
1. Open from: the profile sheet ("Plugins"), the bot profile Plugins card, and the "Finish this on the desktop" connector cards in chat.
2. Layout (Sheet, tall): back CircleButton + title "Plugins"; a rounded white search field with a magnifier and the placeholder "Search plugins" plus a CircleButton with the filter icon on its right (filter popover: All, Added, Available; category list). Section label "Featured" with "View all" on the right; rows: 44 px logo tile (rounded square, white, soft border; bundled brand icons keyed by logo_key, fallback = first letter on a tinted tile), bold name, grey two-line description, and on the right a chip: green "✓ Added" (success colour on success background) or grey "Add". Then the "Team plugins" section the same way. "View all" opens the same list unfiltered in a full-height sheet.
3. Add: tapping "Add" on an available plugin opens a small confirm sheet "Finish connecting {name} on your computer?" with a black "Send to desktop" pill (calls POST .../request, B3) and then shows a toast "Sent. Finish it on your computer." and turns the chip into a grey "Requested". Tapping an Added row opens a read-only detail (what it can do, tier summary, "Manage on the desktop").
4. Loading: skeleton rows; offline: cached catalogue with the notice; empty search: friendly empty state.
5. Icons: create src/assets/plugins/ with simple SVG-based icons (react-native-svg) for at least gmail, google-calendar, google-drive, slack, notion, github, linear, stripe, plus a generic fallback. Draw them yourself as simple logos (no trademark images downloaded).
6. Tests: search/filter logic, chip state mapping, request flow, fallback tile; component test; e2e/plugins.yaml.
7. Phone screenshots compared with 07.
Acceptance: the sheet matches image 07 and never shows or accepts a credential. Commit "V2-10: plugins".
```

---
## V2-11 — Search (bots, messages, plugins)
```
Goal: fast global search that opens from the Home search circle (the Home inline filter from V2-4 becomes the first step of this screen).
Reference: 02 (search field style), 06.
1. SQLite FTS5 virtual table `message_fts` over message text + bot slug + bot name, kept in sync by triggers or by the save function; migration with a version bump and a safe rebuild if FTS5 is unavailable (fall back to LIKE and say so).
2. Screen app/search.tsx: search field with autofocus and Cancel, recent searches (last 8, clearable), grouped results: Bots (mascot rows), Messages (bot mascot, bot name, snippet with the match in bold, time), Plugins (from the cached catalogue). Debounce 150 ms; results appear in under 100 ms for 10 000 messages (measure and report).
3. Tapping a message result opens that chat scrolled to the message with a brief highlight; tapping a bot opens its chat; a plugin opens the Plugins detail.
4. In-chat search (from the chat "…" menu): a bar under the header with up/down arrows and "3 of 12"; matches highlighted in bubbles.
5. Tests: FTS query building (escaping quotes/operators), snippet highlighting, recents, scroll-to-message, fallback path; e2e/search.yaml.
6. Phone screenshots.
Acceptance: search is instant and correct; special characters never crash it. Commit "V2-11: search".
```

---
## V2-12 — Profile sheet, settings and navigation
```
Goal: replace the V1 settings tab with the profile sheet and settings screens, and finish the new navigation (no tab bar).
Reference: 06 (avatar button top-left), 02 (profile menu idea), OpenMausBot SidebarProfileMenu.tsx.
1. Profile sheet (tap the avatar on Home): header with avatar, name ("Vijay"), small grey line "Signed in on this phone"; list rows with icons: Plugins, Approvals (badge with pending count), Activity, Settings, Help; a black-outline "Sign out" pill at the bottom.
2. Settings screen (stack): Appearance (System/Light/Dark segmented control), Chat (Read replies aloud automatically, Send voice notes as text automatically, Show tool details by default), Notifications (the V1 toggles: approvals, mail, feature runs, alerts; quiet hours optional), Security (App lock with biometrics on open and after 2 minutes in the background; Tier 3 approvals always ask), Data (Erase chats on this phone, Export chat as text), Connection (server address read-only, device name, "Pair with a code" under Advanced, Cloudflare Access headers under Advanced as in V1), About (version, build, licences).
3. Approvals and Activity keep their V1 content but become stack screens opened from the profile sheet and the Home attention chip; Approvals keeps screenshot protection and the Tier 3 biometric rule untouched (write a test proving the Tier 3 path still requires the biometric result and sends `confirm`).
4. Deep links and push routing from V1 (`jasper://...`, notification taps) continue to work with the new routes: update src/notifications/routing.ts and its tests.
5. Android back button behaves sensibly everywhere (sheet closes first, then screen, Home exits the app).
6. Tests: settings persistence, theme switch applies immediately, sign out clears secure store and returns to Welcome, routing tests, Tier 3 test; e2e/settings.yaml.
7. Phone screenshots of the profile sheet and settings in light and dark.
Acceptance: no dead V1 tab routes remain (grep for `(tabs)`), every setting works, push deep links reach the right screen (simulate with adb: `adb shell am start -a android.intent.action.VIEW -d "jasper://..."`). Commit "V2-12: profile, settings, navigation".
```

---
## V2-13 — Unread, badges and notifications polish
```
Goal: the app tells the truth about what is new.
1. Unread counts per bot feed an app-icon badge number (expo-notifications badge API) and the blue dot on Home; muted bots never raise the badge or sound.
2. In-app banner for messages from other bots while you are in a chat (tap to jump), suppressed for the open chat.
3. Push payload routing (V1) now also marks the target chat as "has unread" and refreshes the preview in the background.
4. Notification channels (Android): Approvals (high), Messages (default), Mail (default), Runs (low), with clear names and descriptions; settings toggles map to the channels.
5. Background fetch is NOT added (no new native modules). When the app opens it syncs bots, previews and approvals once, then polls lightly (V1 polling helpers) only while foregrounded.
6. Tests: badge count maths with mute, banner suppression, channel mapping; e2e/notifications.yaml.
7. Phone: trigger a test notification with `adb shell am broadcast` or the backend push helper and capture the result.
Acceptance: counts are right after restart; muting works. Commit "V2-13: unread and notifications".
```

---
## V2-14 — Motion, polish, accessibility, performance
```
Goal: the "feels expensive" pass.
1. Transitions: stack push/pop with a subtle fade+slide (native stack defaults tuned), the mascot in the Home row scales into the chat header (a simple shared-scale effect is enough, no shared-element library), sheets use spring physics with a rubber-band drag, buttons have a 0.97 press scale, list rows have a soft press highlight.
2. Skeletons everywhere data loads (Home, chat history, plugins, profile); no spinners over empty white screens.
3. Empty and error states are friendly and illustrated with a mascot in the right state (sad for errors, happy for success, thinking for loading).
4. Accessibility: TalkBack pass through Welcome, Home, Chat, Create Bot, Plugins, Settings: every control labelled, logical order, no unlabeled icon buttons, text contrast >= 4.5:1 in both themes (add a jest test that checks token pairs), font scale 200 % does not break layouts (screenshot at the largest scale), reduce-motion honoured everywhere, announce streaming completion politely.
5. Performance budget (measure and write results in docs/mobile/version2/PERF.md): cold start to Home < 2 s on this phone, Home scroll with 200 rows 60 fps, chat with 500 messages 60 fps, memory after 10 minutes of use not growing. Fix what misses the budget (memoisation, FlashList overrides, mascot static mode).
6. Dead code: remove V1 components that are no longer used (list them first in the report).
7. Tests stay green; add a smoke test that mounts every screen with the theme in both modes.
Acceptance: PERF.md exists with real numbers; TalkBack walkthrough notes are in the report; screenshots at 200 % font scale. Commit "V2-14: polish".
```

---
## V2-15 — Final verification, docs and release candidate
```
Goal: prove V2 works on the real phone and leave good documentation. Do not build release/signed builds.
1. Run `npm run check` (tsc, eslint, jest) and the backend tests for remote.py. Report counts.
2. Rebuild a debug APK from scratch only if native files changed since the last build (state whether they did). Install on E6EY4X7PJNZ9ZTRG, start Metro, and walk the checklist below ON THE PHONE, saving a screenshot for each line in docs/mobile/version2/screens/final/:
   Welcome (idle) -> Sign in -> Home (pinned row + list + unread dots) -> long-press menu -> search -> open a chat -> send a message and watch it stream (dots, tool activity, finished card) -> react with an emoji -> copy, edit and resend, regenerate, delete -> attach a text file and a photo -> record a voice note -> read a reply aloud -> go offline (airplane mode via adb: `adb shell cmd connectivity airplane-mode enable`), send a message, go online and see it sent -> open bot profile -> change the look -> Create New Bot -> new bot chat -> Plugins sheet (request one) -> Approvals (approve a Tier 2, confirm that Tier 3 asks for the biometric) -> Settings (switch to dark and back, app lock) -> Sign out -> back to Welcome.
3. Compare the final screenshots of Welcome, Home, Chat, Create Bot and Plugins side by side with the reference images and write docs/mobile/version2/VISUAL_QA.md: per screen, "matches / differs because ...".
4. Security checklist (spec section 8) ticked with evidence: grep the repo and logcat for the device secret and tokens (none), screenshots disabled on Approvals, HTTPS rule, markdown/link confirm, no remote images, dev sign-in is off by default on the backend.
5. Update mobile/README.md (install, the junction/path-length setup, build, run on the phone, dev sign-in switch, how to run tests) and write docs/mobile/version2/RELEASE_NOTES_V2.md.
6. List everything that could NOT be verified and why (for example flows that need a second device or external accounts).
Acceptance: all green or an honest list of what is not; the founder can follow README.md from a clean checkout. Commit "V2-15: verification and docs".
```

---
## Review checklist for me (founder / Claude) after each prompt
1. Open the screenshots in `docs/mobile/version2/screens/` next to the reference image. Do they look like the same product? Check spacing, font weight, corner radii, colours, shadows.
2. `npm run check` output pasted in the report, with real numbers (tests passed, none skipped without a reason).
3. Run the app on the phone myself for the new feature; try to break it (rotate, background and return, airplane mode, huge font, dark mode, rapid taps).
4. `git diff --stat` touches only the allowed folders; no new native dependency unless the prompt listed one; `node_modules` is still a junction to `D:\mn`.
5. No secret, token or device id in logs or commits; no "Grok" text in the app.
6. The report lists remaining visual differences honestly, and every "unverified" item has a reason.

## Order and dependencies at a glance
`V2-0` → `B1` → `V2-1` → `V2-2` → `V2-3` → `V2-4` → `V2-5` → `V2-6` → `V2-7` → `B2` → `V2-8` → `V2-9` → `B3` → `V2-10` → `V2-11` → `V2-12` → `V2-13` → `V2-14` → `V2-15`.
Why this order: B1 makes sign in possible; the design system and mascot come before any screen so nothing is restyled twice; Home and Chat are the core; B2 must exist before Create Bot and the bot profile edits; B3 before Plugins; settings/navigation come after the screens they link to; polish and verification last.
