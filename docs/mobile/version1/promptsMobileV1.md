# Jasper Mobile — Prompts for OpenCode (Nemotron 3 Ultra Free)

How to use: open OpenCode in `D:\Projects\COOS`. Paste **the ground rules block** first (once per session), then paste **one prompt at a time**, in order (M0 → M13).
Nothing is built yet (mobile/ only has a README): start at the GROUND RULES, then M0. Do not paste the next prompt until the previous one ends with all its checks green and a commit. Each prompt is self-contained.
The specification is `docs/mobile/version1/MOBILE_SPEC_V1.md`. The backend is finished: the app must follow section 7 of the spec exactly.

---
## GROUND RULES (paste first, in every new session)
```
You are building the Jasper phone app in D:\Projects\COOS\mobile (React Native, Expo, TypeScript). Read docs/mobile/version1/MOBILE_SPEC_V1.md completely before writing code.
Rules you must follow without exception:
1. Do exactly what the current prompt asks. Do not add features, screens or libraries that are not listed. Do not change anything outside D:\Projects\COOS\mobile and docs\mobile.
2. The backend contract is section 7 of the spec. Never invent an endpoint, field or event. If something you need is missing or different, STOP, write the question in docs/mobile/version1/QUESTIONS.md and tell me. Do not guess.
3. Work in small steps. After each step run the checks named in the prompt. If a check fails, fix it before moving on. Never leave the project in a failing state.
4. Never print, log, commit or hard-code a secret. The device secret lives only in expo-secure-store. Do not create .env files with real values.
5. TypeScript strict. No `any` unless commented with the reason. Every exported function and component has explicit types.
6. Every new behaviour gets a test (jest) in the same commit. UI text must be plain English.
7. Commit locally at the end of each prompt with a message "M<number>: <what>". Do not push. Do not run commands that delete files outside mobile/.
8. Windows 11 + PowerShell. Use `npx expo` commands. If a command asks a question, choose the default and tell me.
9. When finished, print a short report: what you built, the commands you ran, test results, anything unverified, anything you were unsure about.
```

---
## M0 — Read, plan, check the machine
```
Goal: confirm the environment and write a build plan. No app code yet.
Steps:
1. Read docs/mobile/version1/MOBILE_SPEC_V1.md and backend/python/api/routes/remote.py (read only).
2. Run and report: node --version, npm --version, npx expo --version, adb version, and whether an Android emulator exists (`emulator -list-avds`; the Android SDK is under C:\Users\vijay\AppData\Local\Android\Sdk). If something is missing, list it. Do not install anything big without telling me.
3. Create docs/mobile/version1/BUILD_PLAN.md with: the screens list, the folder structure you will create under mobile/src (api, auth, store, db, screens/components, theme, utils), the order of milestones M1..M13, and a table of the 15 endpoints from spec section 7 with the TypeScript type you will give each response.
4. Create docs/mobile/version1/QUESTIONS.md (empty list with a heading).
Acceptance: the two files exist; your report lists tool versions and any missing tools. Commit "M0: plan".
```

## M1 — Scaffold the Expo project
```
Goal: a running empty Expo app with tooling, tests and the folder structure.
Steps:
1. In D:\Projects\COOS run: npx create-expo-app@latest mobile --template blank-typescript  (if mobile/ already has files, keep README.md).
2. In mobile/ install exactly: expo-router, expo-secure-store, expo-sqlite, expo-local-authentication, expo-camera, expo-image-picker, expo-document-picker, expo-av, expo-notifications, expo-screen-capture, expo-constants, expo-linking, react-native-svg, react-native-reanimated, react-native-safe-area-context, react-native-screens, @shopify/flash-list, lucide-react-native, zustand. Use `npx expo install` so versions match the SDK.
3. Dev dependencies: jest-expo, @testing-library/react-native, @types/jest, eslint-config-expo, prettier, typescript.
4. Configure expo-router (app/ directory), tsconfig strict + path alias `@/*` -> `src/*`, ESLint, Prettier, and jest (jest-expo preset).
5. Create the folders from BUILD_PLAN.md with a one-line placeholder `index.ts` in each.
6. Add npm scripts: "check": "tsc --noEmit && eslint . && jest --ci", "start", "android".
7. Add a trivial test (src/utils/sum.test.ts) to prove jest runs, then delete it once real tests exist.
8. Write mobile/README.md: how to install, `npm run check`, `npx expo start`, running on the emulator.
Acceptance: `npm run check` passes; `npx expo start --android` opens the app on the emulator showing a blank screen without red errors. Commit "M1: scaffold".
```

## M2 — Theme and base components
```
Goal: the design system from spec section 6, as code, with tests.
Steps:
1. src/theme/tokens.ts: all colours, radii (bubble 20, card 16, pill 999), spacing scale (4,8,12,16,24), font sizes. Export a typed `theme` object and `MASCOT_COLORS` (10 names -> hex from the spec).
2. Components in src/components/ui: Screen (safe area, background), Text (variants: title, body, muted, caption), Button (primary, secondary, danger; loading state; min height 44), Card, Chip, Badge (score colours: >=80 green, >=60 amber, else red, null = grey "new"), Divider, EmptyState, Spinner, SheetModal (bottom sheet using react-native Modal).
3. Every component has accessibilityLabel/Role support and a jest render test (renders, shows children, calls onPress, disabled while loading).
4. Create a temporary screen app/index.tsx that renders one of each component so you can look at it on the emulator. Take no secrets, no network calls.
Acceptance: npm run check passes; the demo screen looks dark and consistent on the emulator. Commit "M2: theme and ui kit".
```

## M3 — API client, auth store, streaming
```
Goal: a typed client for spec section 7 and the NDJSON reader, fully unit-tested. No screens yet.
Steps:
1. src/api/types.ts: TypeScript types for every request/response in spec section 7, including a discriminated union `ChatEvent` for the stream events (speaker, delta, tool, ui, phase, route, done, error) plus an `{t: string}` fallback that is ignored.
2. src/auth/secureStore.ts: saveCredentials({baseUrl, deviceId, deviceSecret}), loadCredentials(), clearCredentials() using expo-secure-store. Never log values.
3. src/api/client.ts: class JasperClient with baseUrl + token handling. Methods for every endpoint in section 7. A single `request()` helper that: adds the Bearer header; on 401 calls refresh ONCE (deduplicate concurrent refreshes) then retries once; on 429 waits 2 s and retries once; throws typed errors (AuthRevokedError, RateLimitError, HttpError). Reject a baseUrl that is not https unless it is http://10.0.2.2 or http://localhost in a __DEV__ build.
4. src/api/ndjson.ts: `async function* readNdjson(response)` that reads a ReadableStream (use `fetch` from 'expo/fetch'), splits lines across chunk boundaries (a JSON object can be split between chunks), skips empty lines and lines that fail JSON.parse (count them), and yields parsed objects. Also export `streamChat(client, body, signal)` that yields ChatEvent and supports AbortController.
4b. `JasperClient` accepts optional extraHeaders (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) and adds them to every request; they are stored with the other credentials in secure store and never logged.
5. Fallback reader using XMLHttpRequest onprogress in src/api/ndjsonXhr.ts with the same output; `streamChat` uses the fallback only if the response has no readable body.
6. Tests (jest, mocked fetch): chunk boundaries (one object split in 3 chunks), unknown event types ignored, 401 -> refresh -> retry once, concurrent 401s trigger one refresh, 429 retry, http:// rejected in release, abort stops the stream. Put recorded sample lines (copy the examples from spec 7.4) into src/api/__fixtures__/chat.ndjson.
Acceptance: npm run check passes with at least 15 tests in src/api. Commit "M3: api client".
```

## M4 — Pairing and session
```
Goal: pair with the desktop and keep a session.
Steps:
1. Screen app/(auth)/pair.tsx: fields Server URL (https://…), Pairing code (8 chars, uppercase, only the allowed letters A-Z without I,O and digits 2-9), device name (default from expo-constants deviceName), and an "Advanced" section with two optional fields for the Cloudflare Access service token (client id, client secret). Button "Pair". Also a "Scan QR" button using expo-camera barcode scanning that fills the fields from a payload of the form jasper://pair?u=<url>&c=<code>.
2. On success: save credentials (secure store), store the access token in memory (zustand `useAuth`), navigate to (tabs). Show clear messages for "invalid or expired code", "cannot reach server", "server URL must start with https://".
3. App start: if credentials exist call /auth/refresh then /me; if refresh returns 401/invalid credentials, clear credentials and show Pair with the text "This phone was unpaired from the desktop."
4. Settings tab (placeholder screen is fine) shows device name and an "Unpair this phone" button that clears credentials and returns to Pair (the desktop revokes separately).
5. Optional app lock: setting `appLock` (default off) using expo-local-authentication: when on, require biometrics on cold start and after 2 minutes in background.
6. Tests: pairing form validation (code charset/length), success path stores credentials and calls navigate, failed path shows the right message, startup revoked path clears credentials.
Acceptance: npm run check passes; with the desktop backend running and a pairing code from the desktop (see docs/ops/remote_access.md; on the emulator use http://10.0.2.2:8000 in a dev build) the app pairs and shows the tabs. Commit "M4: pairing".
```

## M5 — Bot list and ID card
```
Goal: the Chats tab with the grouped bot list and the ID card sheet.
Steps:
1. src/store/bots.ts (zustand): load GET /bots, keep `groups`, `loading`, `error`, a `search` string; cache the last result in sqlite so the list appears instantly on start, then refresh in the background.
2. Chats tab: FlashList with sticky section headers (group label uppercase + count), rows: mascot avatar placeholder (coloured circle with initial for now), display name, position (one line), score Badge. Search box filters by name/position/department/slug. Pull to refresh.
3. Long-press (or info icon) on a row opens the bot ID card sheet using GET /bots/{slug}/card: show created, started, lifecycle, tier, group, department, reports_to, calls/errors/thumbs/latency, score + grade, tools list. Read-only.
4. Tapping a row navigates to chat/[slug] (placeholder screen for now).
5. Tests: store loads and caches, search filtering, ID card renders all fields and handles null score.
Acceptance: npm run check passes; the list matches the desktop grouping on the emulator. Commit "M5: bot list".
```

## M6 — Chat screen (core)
```
Goal: a full chat with streaming, local history and message actions.
Steps:
1. src/db/chat.ts with expo-sqlite: tables messages(id, bot_slug, role, from_slug, text, ts, status, tool_json, ui_json, attachments_json) and outbox(id, bot_slug, payload_json, created_at). Functions: list(bot, limit, beforeTs), insert, update, delete, clear(bot).
2. src/store/chat.ts (zustand): per-bot message arrays loaded from sqlite, `send(slug, text, attachments)` that: inserts the user message, builds history (last 20 non-tool, non-ui messages), calls streamChat, and applies events: speaker -> new bot message (streaming=true); delta -> append; tool -> upsert a tool chip message keyed by label; ui -> insert a card message; phase -> divider message; done -> streaming=false; error -> system message. Support stop (abort) and retry (resend last user message).
3. Screen chat/[slug]: header with avatar + name + position and a thinking indicator while streaming and no text yet; inverted FlashList of messages; bubbles per spec section 6 (bot left dark, you right grey), timestamps, markdown-lite renderer (bold **x**, inline code, fenced code blocks with monospace and copy, bullet lists, links with a confirm sheet before opening); tool chips (spinner / check / cross + label, "untrusted" badge when the event has `untrusted`); composer pill with multiline input, send button that becomes Stop while streaming.
4. Message actions on long-press: Copy, Delete; on your messages Edit (puts the text back in the composer and removes that message and everything after it), on the last bot message Regenerate (remove it and resend the previous user message), thumbs up/down (store locally for now; backend has no phone rating endpoint, do not call one).
5. Auto-scroll only if the user is at the bottom; show a "jump to latest" button otherwise.
6. Tests: event reducer (feed fixtures from __fixtures__/chat.ndjson and assert resulting messages), history building (excludes tool/ui), edit/regenerate semantics, sqlite round trip (use an in-memory mock).
Acceptance: npm run check passes; with the backend running, "hello" to Jasper on the emulator streams a reply token by token; killing the app and reopening shows the history. Commit "M6: chat".
```

## M7 — Cards: approvals, suggestions, untrusted, desktop-only
```
Goal: render `ui` cards and approval requests inside chat, and the Approvals tab.
Steps:
1. Card message types in chat: kind "suggestions" -> list of items (name, why, status chip); buttons are read-only labelled "Connect on desktop" (the phone never handles secrets). kind "credentials" and "oauth" -> a card that says "Finish this on your computer" with the connector name.
2. Approvals tab: GET /approvals (poll every 10 s while focused, plus on push). Each item shows tier chip, action, requester, summary, time. If the summary contains "UNTRUSTED CONTENT" show an amber warning above it ("This action was requested after reading external content. Check it is what you asked for.").
3. Buttons Approve / Deny -> POST /approvals/{id}/respond. For tier >= 3 and approve=true: run a biometric prompt with expo-local-authentication first; only on success send `confirm` = the device secret read from secure store. If no biometrics are enrolled show "Set up a fingerprint or face unlock to approve this on the phone". Deny never needs biometrics.
4. Disable screenshots on this tab (expo-screen-capture). Show the pending count as the tab badge.
5. Tests: warning shown only for the marker text, tier-3 flow calls biometrics before the request and never sends confirm for deny, no biometrics path, 403 shows the biometric message.
Acceptance: npm run check passes; create a Tier-2/3 request from the desktop chat (for example ask Jasper to create a bot) and approve it from the phone. Commit "M7: cards and approvals".
```

## M8 — Attachments and voice
```
Goal: send files/photos and voice notes; play replies aloud.
Steps:
1. Composer "+" menu: Camera (expo-image-picker), Gallery, Files (expo-document-picker). Text-like files (.txt .md .json .py .ts .js .csv .yml .html) are read as UTF-8 up to 200 000 characters and sent as {name, mime, text}. Other files and images are sent as {name, mime} only (no text) and shown in the bubble as a thumbnail/file chip with the note "not readable by the AI". Maximum 8 attachments, show removable chips before sending.
2. Voice note: press-and-hold or tap-to-record with expo-av (m4a). On stop: POST /voice/transcribe (multipart field `audio`), insert the returned text into the composer (do not auto-send), show errors clearly. Show a recording timer and a cancel button.
3. Speaker icon on bot messages: split the text into sentences (max 1 500 characters per call), request GET /voice/speak with the Authorization header (use expo-av Audio.Sound with a downloaded temp file, because Sound cannot send headers: download with FileSystem then play), queue sentences, a Stop control. The voice is the bot's voice: keep a local per-bot voice map with defaults from the spec section 7.5 (Jasper: en-GB-RyanNeural, others: en-US-AriaNeural unless chosen later).
4. Tests: file type detection, text read limits, attachment cap, sentence splitting (<=1 500 chars), transcribe error path.
Acceptance: npm run check passes; a text file attached to a message is understood by the bot; a recorded sentence appears as text; a reply can be played. Commit "M8: attachments and voice".
```

## M9 — Push notifications and deep links
```
Goal: pushes for approvals, mail and finished feature runs.
Steps:
1. src/notifications/setup.ts: request permission, get the Expo push token (expo-notifications; projectId from app config), POST /push/register {token} after pairing and after each token change. Android channel "approvals" (high importance) and "general".
2. Handle notification taps: data.type "approval" -> Approvals tab; "mail"/"feature"/"alert" with slug -> chat/[slug]; unknown -> Chats. Works from killed state (expo-router linking + useLastNotificationResponse).
3. Settings toggles per type (stored locally; the app simply ignores a type it has switched off when it receives it).
4. Foreground notifications show an in-app banner instead of a system alert.
5. Tests: routing table from data -> route, toggles respected, token registration retried once on failure.
Note: the backend push sender is implemented by the desktop team; until it exists you can test by sending a push manually from https://expo.dev/notifications with the token printed in dev builds. Never print the token in release builds.
Acceptance: npm run check passes; a manual test push opens the Approvals tab. Commit "M9: notifications".
```

## M10 — Activity tab
```
Goal: a read-only view of what the team is doing.
Steps:
1. Activity tab: top tiles from GET /status (SLO name, status chip ok/breached/no-data, budget remaining %, pending approvals) refreshed every 15 s while focused.
2. Below: bot conversations list from GET /comms/threads (title "a ⇄ b" or "Meeting · group", preview, time). Tap -> thread/[id] which polls GET /comms/thread?id=…&since_id=… every 3 s while open and shows messages with from -> to, kind (ask/reply/tool/result/message/conclusion) and text; tool/result messages in a monospace muted style.
3. Pause polling when the screen is not focused or the app is in the background.
4. Tests: poll interval logic with fake timers, since_id advancing, pause on blur.
Acceptance: npm run check passes; asking Jasper to check email on the desktop shows the Jasper -> Messenger -> Connector chain on the phone. Commit "M10: activity".
```

## M11 — Mascot avatars (stretch, do after M12 if time is short)
```
Goal: animated mascot avatars like the desktop (simplified).
Steps:
1. src/components/Mascot.tsx with react-native-svg: body shapes cursor, blob, circle, squircle, capsule, drop, shield, hexagon, diamond, star (copy the ten SVG paths from the desktop file app/src/mascot/mascot-bodies.ts, keys `body` path data; read only), gradient fill from the bot colour (lighten 55 % top, darken 42 % bottom), two eyes.
2. States driven by props: idle (slow blink), thinking (eyes look up-left, three dots), working (eyes narrowed, tiny bob), alerting (wide eyes, small shake), sad, happy. Use react-native-reanimated for blink/bob; keep it under 60 lines per state; 30 fps is fine.
3. Per-bot colour and body default from a hash of the slug (same hash function as desktop: hash = (hash*31 + charCode) >>> 0 starting at 7; colour = FALLBACK_COLORS[hash % 9] with the list green, orange, purple, cyan, pink, teal, coral, yellow, red; Jasper is blue/cursor). Allow overriding colour/body in the ID card sheet, stored locally.
4. Use it in bot rows (size 34), chat header (size 40, state from streaming: thinking before first delta, working while text streams, idle otherwise) and the thinking chip.
5. Performance: the list must still scroll at 60 fps (memoise, no animation for off-screen rows; animation only for the active chat header).
Acceptance: npm run check passes; visual check on the emulator. Commit "M11: mascots".
```

## M12 — Offline outbox, errors, accessibility, performance
```
Goal: robust behaviour on bad networks.
Steps:
1. Network state (expo-network or fetch failures): when sending fails with a network error, store the message in the outbox table and show it with a clock icon and "Waiting for connection"; a background retry loop (on connectivity regained and on app foreground) sends queued messages in order, one at a time, then removes them. Never send the same message twice (use the outbox id as an idempotency check on the client).
2. Global banners: "Cannot reach your computer" (network error), "Phone unpaired" (auth revoked), "Slow down" (429). A pull-to-refresh everywhere data is listed.
3. Accessibility pass: labels/roles on every control, support dynamic font scale up to 150 % without clipped text, contrast checked against tokens, VoiceOver/TalkBack order sensible. Add a test that renders the main screens with fontScale 1.5.
4. Performance pass: FlashList estimatedItemSize set, memoised bubbles, avoid re-render of the whole chat on each delta (update only the last message), measure with 500 messages and write the numbers in mobile/README.md.
5. Error boundary at the root with a "Something went wrong, restart" screen that never shows stack traces in release.
Tests: outbox ordering and no duplicates, retry on reconnect, error banners map from error types.
Acceptance: npm run check passes; with airplane mode a message queues and is sent after reconnect. Commit "M12: resilience".
```

## M13 — End-to-end tests, release build, docs
```
Goal: prove it works and make it installable.
Steps:
1. Install Maestro (https://maestro.mobile.dev) only if I confirm; otherwise write the flows and stop. Flows in mobile/e2e/*.yaml: pair (use a code passed as env var MAESTRO_PAIR_CODE and URL MAESTRO_URL), send a message and see a streamed reply, open Approvals and approve a pending Tier-2 request, airplane mode queue + resend, unpaired after desktop revoke.
2. Add `npm run e2e` that runs them.
3. Build an installable Android APK locally: `npx expo prebuild --platform android` then `cd android; .\gradlew assembleRelease` (or `eas build --local` if EAS is configured). Put the APK path in the README. Do not commit keystores or the android/ build outputs (add to .gitignore).
4. Security checklist: go through spec section 8 line by line in docs/mobile/version1/SECURITY_CHECKLIST.md marking each item verified with the file/test that proves it, or "not done" with the reason. Run `git grep -n -i "secret\|password\|token"` in mobile/src and explain every hit.
5. Update mobile/README.md (install, run, pair, build, troubleshooting) and docs/mobile/version1/BUILD_PLAN.md with what was actually built vs planned.
Acceptance: npm run check passes; APK installs on the emulator and pairs; the checklist is complete. Commit "M13: e2e and release".
```

---
## Review checklist for me (Claude/founder) after each milestone
1. `cd mobile; npm run check` passes. 2. App runs on the emulator against the real backend. 3. No new libraries beyond the list. 4. No secret in `git diff`. 5. The report states what is unverified.
If OpenCode drifts: paste "Stop. Re-read MOBILE_SPEC_V1.md section <n>. Undo anything not required by the current prompt, run npm run check, and report."
