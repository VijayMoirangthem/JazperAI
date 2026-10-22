# Questions

## Open

- **Chat streaming has no 401 refresh.** `src/api/ndjson.ts` `streamChat()` (and `JasperClient.streamChat()`) sends the Bearer token but does not refresh it on a 401 the way `JasperClient.request()` does. A stream that starts after the access token expired fails with a system error instead of refreshing once. Fix needs a stream-aware refresh/retry helper; backend contract unchanged.
- **Thumbs up/down are local only.** M6 stores the phone's rating in SQLite because section 7 of the spec has no phone rating endpoint. Where should it go once one exists?
- **Attachment-only messages send `text: ""`.** Section 7.4 does not state whether an empty `text` is accepted when `attachments` is non-empty. The composer allows attachment-only sends; confirm the desktop accepts it (otherwise send a short placeholder text).
- **Voice note format on Android.** Recording uses `expo-av` `HIGH_QUALITY` (m4a on both platforms). Section 7.5 accepts wav/m4a/webm; confirm the transcription service handles Android's m4a output.
- **No EAS `projectId` yet.** `app.json` has no `extra.eas.projectId`, so `getExpoPushTokenAsync()` cannot return a token. Registration now no-ops (with a dev warning) until `eas init` / `eas build:configure` writes one. Real push acceptance tests need the project id.
- **Push payload shape is assumed.** Section 7.5 names the fields `type` (`approval|mail|feature|alert`) and optional `slug`; the client routes on those keys. Confirm the backend sends `slug` for mail/feature/alert (otherwise the tap falls back to the Chats tab).
- **Comms threads show slugs, not display names.** `GET /comms/threads` only carries `from_slug`/`to_slug`, so the Activity list titles use the slugs (`jasper -> messenger`). Mapping to display names would need a `/bots` lookup on this screen.
- **Since_id resets when a thread opens.** The thread screen starts at `since_id=0`, merges messages by id and advances `since_id` to the highest id seen. Re-opening the same thread keeps its messages until the screen closes; polling pauses on blur and while the app is backgrounded.
- **Foreground pushes never show a system banner.** `setNotificationHandler` returns `shouldShowBanner: false` because the app draws its own in-app banner. Background pushes still use the `approvals` / `general` Android channels.

## Resolved / decisions

- **`expo-clipboard` added (M6).** React Native 0.88 removed the core `Clipboard` API, so "Copy" uses `expo-clipboard` (`src/utils/clipboard.ts`).
- **`expo-asset` added (M6).** `expo-sqlite` imports it at runtime; it was missing from the install, which would crash Metro/Jest. Installed with `npm install --legacy-peer-deps` because the SDK 58 tree has a `react@19.3.0` / `react-dom@19.3.1` peer conflict.
- **Session state is memory-only (M6 fix).** `useAuth` no longer persists to `localStorage` (absent on native and insecure). Credentials live only in `expo-secure-store`; the store keeps them in memory and rehydrates at launch via `/auth/refresh` + `/me`.
- **Route groups were nested one level too deep (M6 fix).** `app/(tabs/)/…` and `app/(auth/)/…` were committed with a stray `)` folder, so `(tabs)`/`(auth)` screens never matched. Moved to `app/(tabs)/` and `app/(auth)/`.
- **`zustand` install was missing `vanilla.d.ts` (M6 fix).** That made every store `any` and hid type errors from M4/M5. Restored the package files; `tsc` now type-checks the stores.


- **`expo-file-system` added (M8).** Uses the SDK 58 `File`/`Paths` API (not the legacy API) to read text attachments and to write downloaded speech audio before playback. Installed with `npx expo install expo-file-system` then `npm install --legacy-peer-deps`.
- **Attachment `uri` is local only (M8).** `Attachment` carries an optional local `uri` for thumbnails; `toApiAttachment()` strips it before every chat stream request. Text-like files are read up to 200 000 characters; other files and images are sent as `{name, mime}` only.
- **Voice playback downloads chunks (M8).** `expo-av` `Audio.Sound` cannot send an Authorization header, so each sentence is fetched with `JasperClient.speakVoice()` (Blob), written to a cache mp3, played, then deleted. Text is split into chunks of at most 1 500 characters. Jasper uses `en-GB-RyanNeural`, other bots `en-US-AriaNeural`.
- **`expo-av` is deprecated upstream (M8).** The M8 prompt names `expo-av`, so voice recording and playback stay on it for v1; migrate to `expo-audio` after the milestone batch.
- **Activity polling runs only while visible (M10).** One poller refreshes `/status` + `/comms/threads` every 15 s while the Activity tab is focused; the thread poller refreshes every 3 s while the thread screen is focused. Both stop on blur and on app background, and never overlap an in-flight request (`src/utils/polling.ts`).
- **Budget shown as a percentage (M10).** `budget_remaining` is a fraction (`null` when there are no events, negative when overspent), so tiles render `62% remaining`, `No data`, or `-50% remaining`.
- **Settings persist in `expo-secure-store` (M9 fix).** `useSettings` previously used `localStorage`, which does not exist on native. It now uses an async zustand `StateStorage` backed by `expo-secure-store`, so notification toggles and app lock survive restarts.
- **Notification toggles map plural to singular (M9).** Settings keys are `approvals|mail|feature|alert`; push payload types are `approval|mail|feature|alert`. `isNotificationEnabled()` maps `approval` to the `approvals` key; unknown/missing types stay enabled.
- **Push registration retries once (M9).** `registerTokenWithRetry()` tries `POST /push/register` twice; a failed registration is silently skipped so chat still works. Duplicate tokens are not re-sent within a session.
- **Images stay display-only (M8).** Matches spec risk 3: thumbnails render in the bubble with "not readable by the AI" until a vision model is routed.
