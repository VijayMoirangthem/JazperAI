# Questions

## Open

- **Chat streaming has no 401 refresh.** `src/api/ndjson.ts` `streamChat()` (and `JasperClient.streamChat()`) sends the Bearer token but does not refresh it on a 401 the way `JasperClient.request()` does. A stream that starts after the access token expired fails with a system error instead of refreshing once. Fix needs a stream-aware refresh/retry helper; backend contract unchanged.
- **Thumbs up/down are local only.** M6 stores the phone's rating in SQLite because section 7 of the spec has no phone rating endpoint. Where should it go once one exists?
- **Attachment-only messages send `text: ""`.** Section 7.4 does not state whether an empty `text` is accepted when `attachments` is non-empty. The composer allows attachment-only sends; confirm the desktop accepts it (otherwise send a short placeholder text).
- **Voice note format on Android.** Recording uses `expo-av` `HIGH_QUALITY` (m4a on both platforms). Section 7.5 accepts wav/m4a/webm; confirm the transcription service handles Android's m4a output.

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
- **Images stay display-only (M8).** Matches spec risk 3: thumbnails render in the bubble with "not readable by the AI" until a vision model is routed.
