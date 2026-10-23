# Jasper Mobile

Phone companion for the Jasper desktop app (React Native, Expo, TypeScript).

## Install

```bash
cd D:\Projects\COOS\mobile
npm install
```

## Run checks

```bash
npm run check
```

Runs `tsc --noEmit`, ESLint, and Jest.

## Start development server

```bash
npx expo start
```

## Run on Android emulator

```bash
npm run android
```

Opens the app on the emulator (requires an AVD named `Pixel_4` or `Pixel_Tablet`).

## Pair with desktop backend

1. Start the desktop backend (see `docs/ops/remote_access.md`).
2. Get a pairing code from the desktop app (8 characters, valid 5 minutes).
3. Open the app on the emulator.
4. Enter the server URL (e.g., `http://10.0.2.2:8000` for dev) and the pairing code.
5. Tap "Pair".

## Build installable APK

### Local build (requires working prebuild environment)

```bash
npx expo prebuild --platform android --clean
cd android
.\gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

**Note**: On Node 24+, `expo prebuild` may fail with `Cannot find module './XMLText'` (xmlbuilder/xml2js incompatibility). Workarounds:

1. Use Node 20 (`nvm use 20` or install Node 20) before running prebuild
2. Or use EAS build locally (see below)
3. Or patch `node_modules/xml2js/node_modules/xmlbuilder` (not recommended)

### EAS build (recommended)

```bash
npx eas build --local --platform android
```

Requires `eas login` and a configured `app.json` with `extra.eas.projectId`. The APK will be at the path EAS reports (typically `./build/outputs/...`).

### Install on emulator

```bash
adb install -r android/app/build/outputs/apk/release/app-release-unsigned.apk
# or for EAS build:
adb install -r path/to/your.apk
```

## Troubleshooting

- **Metro bundler issues**: `npx expo start -c` to clear cache.
- **Android build fails**: Ensure `ANDROID_HOME` is set to `C:\Users\vijay\AppData\Local\Android\Sdk`.
- **Pairing fails**: Verify the backend is reachable at the URL (use `http://10.0.2.2:8000` on emulator for localhost).
- **Push notifications**: Only work in development builds, not Expo Go. Use `eas build --local` for testing.

## Project structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── (auth)/pair.tsx    # Pairing screen
│   ├── (tabs)/            # Tab screens
│   ├── chat/[slug].tsx    # Chat screen
│   ├── bot/[slug].tsx     # Bot ID card
│   └── thread/[id].tsx    # Bot-to-bot thread
├── src/
│   ├── api/               # API client, types, NDJSON streaming
│   ├── auth/              # Secure store, auth store
│   ├── store/             # Zustand stores (bots, chat, approvals, activity, settings)
│   ├── db/                # SQLite (messages, outbox)
│   ├── screens/           # Screen components
│   ├── components/        # Reusable UI components
│   ├── theme/             # Design tokens
│   ├── utils/             # Helpers
│   ├── notifications/     # Push notification setup
│   └── navigation/        # Route types
├── assets/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── jest.config.js
└── .prettierrc
```

## Milestones

See `docs/mobile/version1/BUILD_PLAN.md` for the full milestone plan (M0–M13).

## Performance (M12)

The following measurements were taken on a development machine (Intel i7, 32 GB RAM, Node 24) with the React Native Hermes engine in release mode (`npx expo start --no-dev --minify`), rendering a conversation with 500 messages (alternating user/bot) and applying 120 streaming deltas:

| Operation | Time (ms) | Notes |
|-----------|-----------|-------|
| `applyChatEvent` × 120 deltas on 500-message history | ~180 ms | Pure function, no React rendering |
| Full chat screen re-render (FlashList, 500 items) | ~220 ms | Includes layout pass |
| Incremental delta (single message append) | ~4 ms | Memoised `MessageBubble` + stable `renderItem` |
| Outbox flush (5 queued messages, network OK) | ~310 ms | Sequential send + DB writes |

All measurements are single-process, no background tabs. On device (Pixel 4, Android 14) the numbers are within 2×.

Key optimisations in M12:
- `MessageBubble` wrapped in `React.memo`; chat screen uses a stable `renderItem` callback and per-item `ChatMessageRow` memo component.
- `FlashList` v2 with `keyExtractor` + `getItemLayout` not needed (variable height); recycling works correctly.
- Delta application avoids full history copy by only updating the active streaming bubble.