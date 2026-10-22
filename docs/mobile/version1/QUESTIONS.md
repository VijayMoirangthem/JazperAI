# Questions

## Open

- **Chat streaming has no 401 refresh.** `src/api/ndjson.ts` `streamChat()` (and `JasperClient.streamChat()`) sends the Bearer token but does not refresh it on a 401 the way `JasperClient.request()` does. A stream that starts after the access token expired fails with a system error instead of refreshing once. Fix needs a stream-aware refresh/retry helper; backend contract unchanged.
- **Thumbs up/down are local only.** M6 stores the phone's rating in SQLite because section 7 of the spec has no phone rating endpoint. Where should it go once one exists?

## Resolved / decisions

- **`expo-clipboard` added (M6).** React Native 0.88 removed the core `Clipboard` API, so "Copy" uses `expo-clipboard` (`src/utils/clipboard.ts`).
- **`expo-asset` added (M6).** `expo-sqlite` imports it at runtime; it was missing from the install, which would crash Metro/Jest. Installed with `npm install --legacy-peer-deps` because the SDK 58 tree has a `react@19.3.0` / `react-dom@19.3.1` peer conflict.
- **Session state is memory-only (M6 fix).** `useAuth` no longer persists to `localStorage` (absent on native and insecure). Credentials live only in `expo-secure-store`; the store keeps them in memory and rehydrates at launch via `/auth/refresh` + `/me`.
- **Route groups were nested one level too deep (M6 fix).** `app/(tabs/)/…` and `app/(auth/)/…` were committed with a stray `)` folder, so `(tabs)`/`(auth)` screens never matched. Moved to `app/(tabs)/` and `app/(auth)/`.
- **`zustand` install was missing `vanilla.d.ts` (M6 fix).** That made every store `any` and hid type errors from M4/M5. Restored the package files; `tsc` now type-checks the stores.
