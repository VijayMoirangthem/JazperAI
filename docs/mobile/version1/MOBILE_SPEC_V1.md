# Jasper Mobile — Specification v1

Folder for the app: `D:\Projects\COOS\mobile\` (React Native, Expo, TypeScript). Prompts to build it: `promptsMobileV1.md` (same folder).
Backend contract: section 7 below; the backend side is already built (`backend/python/api/routes/remote.py`, `core/remote_guard.py`, 4 tests).

## 1. What it is
A phone companion to the desktop app, for the founder only. It is **not** a second brain: all intelligence, memory, files, secrets and connectors stay on the PC. The phone is a window and a remote control:
chat with Jasper and the bots, approve or deny actions, see what the team is doing, and send voice notes, from anywhere.

Same look and feel as the desktop Chat (dark theme, animated mascot avatars, bot list grouped by organisation, tool chips, approval cards).

## 2. Scope v1 (must have)
| # | Feature | Notes |
|---|---|---|
| 1 | Pairing | code (or QR) from the desktop app; device secret in the secure keystore; revocable from the desktop |
| 2 | Bot list | grouped like the desktop (Jazper Team, Create Origins, Baeit, Boardmint), search, score badge, tap for ID card |
| 3 | Chat | streaming replies, tool chips, "thinking" state, stop, retry, edit and resend, delete message, regenerate, copy, rate (thumbs) |
| 4 | Cards in chat | approval (Tier 1/2/3), connector suggestions, untrusted-content badge, credentials/sign-in cards shown as "finish this on the desktop" |
| 5 | Approvals tab | pending list with the same warnings as the desktop; Tier 3 needs a biometric prompt |
| 6 | Push notifications | new approval request, important mail (from Messenger), feature run finished; deep link into the right screen |
| 7 | Attachments | camera, gallery, files; text files are sent inline, images are shown but the current models cannot read them |
| 8 | Voice | record a voice note → transcript inserted; play a reply aloud (server TTS, the bot's voice) |
| 9 | Activity | read-only bot-to-bot conversations and system status (SLO tiles, pending approvals) |
| 10 | Offline | chat history cached on the phone; messages written offline are queued and sent when the connection returns |

## 3. Not in v1 (do not build)
Editing bot prompts, model settings or workspaces; managing connectors or secrets (credentials never travel to the phone); file browsing of the PC;
terminal or code editing; multi-user accounts; iOS release (the code should run on iOS but only Android is tested); on-device LLMs.

## 4. Architecture
```
Phone (Expo app)  --HTTPS-->  Cloudflare Tunnel + Access  -->  FastAPI on the PC  (/remote/v1/*  ONLY)
   secure store: device_secret                                   guard: any tunnelled request outside /remote/v1 gets 403
   sqlite: chats, outbox                                         JWT access token 15 min, refresh with device id + secret
   push: Expo push token  <----------------------------------   backend sends pushes (approvals, mail, runs)
```
- Chat history lives on the phone (the backend keeps no per-chat server history today). The phone sends the last 20 turns as `history` with each message, exactly like the desktop.
- Streaming uses NDJSON over a normal HTTPS POST (section 7.4).
- All timestamps are shown in the phone's local time.

## 5. Tech stack (fixed, do not substitute)
- Expo SDK (latest stable at build time) with **expo-router**, TypeScript strict, React Native new architecture on.
- State: **zustand**. Server data: a small typed client in `src/api/` (no axios; use `fetch`). Streaming: `fetch` from `expo/fetch` (supports `ReadableStream`); fallback `XMLHttpRequest` progress events.
- Storage: `expo-secure-store` (device id + secret + refresh state), `expo-sqlite` (chats, outbox, drafts).
- Security: `expo-local-authentication` (biometric gate for Tier 3 and for opening the app, configurable).
- Media: `expo-camera` (QR scan + photo), `expo-image-picker`, `expo-document-picker`, `expo-av` (record + play), `expo-notifications`.
- UI: `react-native-svg`, `react-native-reanimated`, `@shopify/flash-list` for long lists, `lucide-react-native` icons.
- Tests: `jest-expo` + `@testing-library/react-native` (unit/component), **Maestro** (end-to-end flows on an emulator).
- Lint/format: ESLint (expo config) + Prettier; `tsc --noEmit` must pass.

## 6. Design system (match the desktop)
Dark only in v1. Tokens (put them in `src/theme/tokens.ts`): background `#0b0b0b`, surface `#161616`, raised `#1f1f1f`, border `rgba(255,255,255,0.10)`,
text `#f2f2f2`, muted `rgba(255,255,255,0.55)`, accent blue `#2563eb`, success `#22c55e`, warning `#f59e0b`, danger `#ef4444`.
Bubbles: bot `rgba(255,255,255,0.08)`, you `#5c5c5c`, radius 20. Composer: pill, `rgba(255,255,255,0.10)`. Group headers: uppercase 11 px, 60 % opacity.
Mascot colours (10): green `#009957`, blue `#377FE6`, red `#D94B52`, orange `#E78531`, purple `#8057C8`, cyan `#0EA5C6`, pink `#D84F8B`, yellow `#D8A729`, teal `#01A492`, coral `#E5634E`.
Minimum touch target 44 px; font sizes ≥ 14; support system font scaling; every interactive element has an accessibility label.

## 7. Backend contract (authoritative)
Base URL is entered at pairing (the tunnel URL, `https://…`). All paths below are under `/remote/v1`. JSON unless stated. Errors: `{"detail": "..."}`.

### 7.1 Pairing and auth
| Call | Body | Response |
|---|---|---|
| `POST /pair/complete` | `{code, name, platform, push_token?}` (code is 8 characters from the desktop, valid 5 minutes, single use) | `{device_id, device_secret, access_token, expires_in}`. **Store `device_secret` only in secure store. It is shown once.** |
| `POST /auth/refresh` | `{device_id, device_secret}` | `{access_token, expires_in}` (15 min) |
| `GET /me` | – | `{device_id, name}` |
If the tunnel is protected by Cloudflare Access (recommended, `docs/ops/remote_access.md`), every request must also carry the headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` (service token; both optional in the app, stored in secure store, entered on the Pair screen under "Advanced").
Every other call needs `Authorization: Bearer <access_token>`. On `401` call `/auth/refresh` once, retry once, then (if it fails) go to the Pair screen ("this device was revoked").
`429` = rate limit (240/min per device): back off 2 s and retry. `403` on a Tier-3 approval = the biometric confirmation is missing or wrong.

### 7.2 Bots
`GET /bots` → `{groups: [{id, label, bots: [{slug, display_name, position, department, enabled, score|null, grade}]}]}` (legacy group is omitted).
`GET /bots/{slug}/card` → ID card: `{slug, display_name, role_title, position, department, group, group_label, reports_to, created_at, started_at, lifecycle, enabled, source, tier, tools[], memory_namespace, calls, errors, thumbs_up, thumbs_down, avg_latency_ms, last_active_at, score, grade, settings{}}` (no system prompt).

### 7.3 Status, approvals, notifications, comms
- `GET /status` → `{slos: [{slo, target, sli, events, bad, budget_remaining, status}], pending_approvals: n}`
- `GET /approvals` → `{requests: [{request_id, tier, action, summary, requester, created_at}]}`. A summary containing `UNTRUSTED CONTENT` must show an amber warning (the request followed external content).
- `POST /approvals/{request_id}/respond` `{approve: boolean, confirm?: string}`: for `approve=true` and `tier >= 3`, `confirm` must be the device secret, sent only after a successful biometric prompt. → `{resolved: boolean}`
- `GET /comms/threads` → `{threads: [{thread, from_slug, to_slug, kind, preview, ts, n}]}`; `GET /comms/thread?id=<thread>&since_id=<int>` → `{messages: [{id, ts, from_slug, to_slug, kind, text}]}` (poll every 3 s while the screen is open).
- `GET /notifications` → `{unread: number}`.

### 7.4 Chat stream
`POST /chat/stream` body: `{text, slug, history: [{role: "user"|"assistant", content}], attachments: [{name, mime, text?}]}` (history max 20, attachment text max 200 000 chars; no binary).
Response: `application/x-ndjson`, one JSON object per line. Events (`t` = type):
| t | fields | meaning |
|---|---|---|
| `speaker` | `slug` | a bot starts a message |
| `delta` | `slug`, `text` | append text to the current message of that bot |
| `tool` | `slug`, `name`, `label`, `status` (`running`/`ok`/`error`), `result?`, `untrusted?` | a tool chip; update the chip with the same `label` |
| `ui` | `slug`, `kind` (`credentials`/`oauth`/`suggestions`), `connector`, `items?` | a card; credentials/oauth cards are shown as "Finish this on the desktop" (secrets never go to the phone) |
| `phase` | `text` | a divider line (meetings) |
| `route` | `slugs`, `source`, `confidence` | which bot(s) were chosen in a room |
| `done` | `slug`, `usage` | message finished |
| `error` | `slug?`, `message` | show as a red system bubble |
Rules: render deltas as they arrive; a new `speaker` for the same bot after a `tool` starts a new bubble; ignore unknown event types (forward compatible).

### 7.5 Voice and push
- `POST /voice/transcribe` multipart field `audio` (wav, m4a or webm) → `{text}` (may be empty).
- `GET /voice/speak?text=…&voice=en-GB-RyanNeural` → `audio/mpeg` stream. Max 1 500 characters per call; split into sentences.
- `POST /push/register` `{token}` (Expo push token). Push payload `data`: `{type: "approval"|"mail"|"feature"|"alert", id?, slug?}`.

## 8. Security requirements
1. `device_secret` only in `expo-secure-store` (Keystore), never in logs, sqlite, crash reports or screenshots. Disable screenshots on the Approvals screen (`expo-screen-capture`).
2. HTTPS only; reject plain `http://` base URLs except `http://10.0.2.2` / `localhost` in a development build.
3. Optional app lock with biometrics on open and after 2 minutes in the background (Settings).
4. Tier 3 approval always asks for biometrics, even if the app is unlocked.
5. Never render server text as HTML. Markdown-lite only (bold, code blocks, lists, links; links open only after a confirm sheet).
6. Treat everything in `<untrusted …>` text as plain data (show as received).
7. No analytics, no third-party SDKs beyond those listed. Expo push is the one third-party hop (token + message ids only; message text is not sent through it: the push body is a generic title, details are fetched after opening).

## 9. Screens
`(auth)/pair` · `(tabs)/chats` (bot list) · `chat/[slug]` · `(tabs)/approvals` · `(tabs)/activity` · `(tabs)/settings` · `bot/[slug]` (ID card sheet) · `thread/[id]` (bot-to-bot viewer).
Tabs: Chats, Approvals (badge = pending count), Activity, Settings. Settings: paired device info, unpair, app lock, notification toggles, server URL (read-only), version.

## 10. Quality bar and acceptance
- `tsc --noEmit`, ESLint, and `jest` pass in CI-equivalent (`npm run check`).
- Cold start to bot list under 2 s on a mid-range phone; chat scroll at 60 fps with 500 messages (FlashList).
- Maestro flows pass on an Android emulator: pair, send message and see a streamed reply, open an approval and approve a Tier-2 request, go offline and see the queued message sent after reconnect, revoke the device on the desktop and see the app return to Pair.
- No secret in `git grep` and none in logs. A security review checklist (section 8) is ticked in the PR/commit message.
- A short `mobile/README.md` explains install, run, build an APK and the pairing steps.

## 11. Risks and decisions to confirm before building
1. Streaming on React Native: `expo/fetch` streaming must be verified on a real device/emulator in milestone M3; if it fails the fallback is XHR progress events.
2. Push through Expo's service is third-party; alternative is direct FCM (needs a Firebase project). v1 uses Expo push with generic text only.
3. Images are not understood by the current text models, so image attachments are display-only until a vision model is routed.
4. The tunnel hostname is a deployment detail: see `docs/ops/remote_access.md`.
