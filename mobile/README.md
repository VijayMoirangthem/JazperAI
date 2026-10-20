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

```bash
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release-unsigned.apk`.

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