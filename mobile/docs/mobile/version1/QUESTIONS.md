# Open Questions for Mobile App

## EAS Project ID
- **Question**: `app.json` lacks `extra.eas.projectId`; push tokens are no-ops until this is set.
- **Impact**: Cannot test push notifications end-to-end; `registerForPushNotifications` resolves but tokens are not sent to backend.
- **Resolution**: Add `projectId` from EAS project when available.

## Idempotency key on chat stream
- **Question**: `ChatStreamRequest` (backend contract §7.3) has no `client_id` / idempotency field. The mobile app queues failed sends in SQLite `outbox` and uses the outbox `id` as a client-side deduplication key. If the same message is sent twice (e.g., user taps send while offline, then retries after reconnect), the backend will receive duplicate requests.
- **Impact**: Potential duplicate messages on the backend if network fails after request leaves phone but before response returns.
- **Proposed**: Add optional `client_id` to `ChatStreamRequest` and have backend deduplicate. Until then, client-side dedupe via outbox id + `sentOutboxIds` guard is best-effort.

## Streaming 401 handling
- **Question**: NDJSON streaming endpoint returns 401 on token expiry. Current code throws an error with `name = 'AuthRevokedError'` which triggers the unpaired banner and navigation to pair screen. But the stream may have already yielded partial deltas.
- **Impact**: Partial bot reply shown, then unpaired flow.
- **Resolution**: Backend should not return 401 mid-stream; refresh should happen before stream starts.

## Thumbs up/down persistence
- **Question**: Thumbs are stored only in Zustand (`thumbsByBot`). They are lost on app restart.
- **Impact**: User feedback not persisted.
- **Resolution**: Add `thumbs` table to SQLite or sync with backend.

## Missing bot card fields in Bot type
- **Question**: `Bot` type (backend contract) lacks `group_label`, `lifecycle`, `tools`, `source`, `memory_namespace`, `role_title`, `calls`, `errors`, `thumbs_up`, `thumbs_down`, `avg_latency_ms`, `created_at`, `started_at`, `last_active_at` which are present in `BotCardResponse`.
- **Impact**: `BotCardSheet` casts `Bot` to `BotCardResponse` for display. If backend ever diverges, this will break.
- **Resolution**: Unify types or add missing fields to `Bot`.

## Font scaling test coverage
- **Question**: The font-scale test mocks most dependencies and only renders 4 of 6 main screens (excludes ChatsScreen and BotCardSheet due to native module dependencies).
- **Impact**: Not a full guarantee that all screens render at 150%.
- **Resolution**: Run visual regression on device/emulator.

## React Native Reanimated in tests
- **Question**: `Mascot` uses `react-native-reanimated` which requires the native module. Jest mock for reanimated is not set up globally; tests that render `Mascot` must mock the component.
- **Impact**: Screen tests cannot include ChatsScreen or BotCardSheet without extensive mocking.
- **Resolution**: Add reanimated mock to jest setup or use `jest.mock` per test file.