# Jasper Mobile — Build Plan (M0)

## Screens (from spec section 9)
| Route | Screen | Notes |
|-------|--------|-------|
| `(auth)/pair` | Pairing screen | Server URL, pairing code, device name, Scan QR |
| `(tabs)/chats` | Bot list (Chats tab) | Grouped FlashList, search, pull-to-refresh |
| `chat/[slug]` | Chat screen | Streaming, bubbles, composer, message actions |
| `bot/[slug]` | Bot ID card sheet | Read-only, opened from bot list long-press |
| `(tabs)/approvals` | Approvals tab | Polling, approve/deny with biometric for tier ≥ 3 |
| `thread/[id]` | Bot-to-bot thread viewer | Polling since_id, monospace tool/result |
| `(tabs)/activity` | Activity tab | SLO tiles + comms threads list |
| `(tabs)/settings` | Settings tab | Device info, unpair, app lock, notification toggles, server URL (read-only), version |

## Folder structure under `mobile/src`
```
src/
├── api/
│   ├── types.ts          # All request/response types for 15 endpoints
│   ├── client.ts         # JasperClient with auth, refresh, retry logic
│   ├── ndjson.ts         # Streaming reader (fetch + XHR fallback)
│   ├── ndjsonXhr.ts      # XHR fallback reader
│   └── __fixtures__/
│       └── chat.ndjson   # Sample stream lines from spec 7.4
├── auth/
│   ├── secureStore.ts    # expo-secure-store wrappers
│   └── useAuth.ts        # Zustand store for access token + device info
├── store/
│   ├── bots.ts           # Bot list + search + sqlite cache
│   ├── chat.ts           # Per-bot messages, send, streaming reducer
│   ├── approvals.ts      # Approvals list + polling
│   ├── activity.ts       # Status + threads
│   └── settings.ts       # App lock, notification toggles
├── db/
│   ├── chat.ts           # SQLite: messages, outbox
│   └── migrations.ts     # Schema versioning
├── screens/
│   ├── auth/
│   │   └── PairScreen.tsx
│   ├── tabs/
│   │   ├── ChatsScreen.tsx
│   │   ├── ApprovalsScreen.tsx
│   │   ├── ActivityScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── chat/
│   │   └── ChatScreen.tsx
│   ├── bot/
│   │   └── BotCardSheet.tsx
│   └── thread/
│       └── ThreadScreen.tsx
├── components/
│   ├── ui/               # Base components from M2
│   │   ├── Screen.tsx
│   │   ├── Text.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Chip.tsx
│   │   ├── Badge.tsx
│   │   ├── Divider.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Spinner.tsx
│   │   └── SheetModal.tsx
│   ├── chat/
│   │   ├── MessageBubble.tsx
│   │   ├── ToolChip.tsx
│   │   ├── UICard.tsx
│   │   ├── Composer.tsx
│   │   └── ThinkingIndicator.tsx
│   ├── bot/
│   │   └── Mascot.tsx
│   └── common/
│       └── ...
├── theme/
│   ├── tokens.ts         # Colours, radii, spacing, font sizes, mascot colours
│   └── index.ts
├── utils/
│   ├── markdown.ts       # Markdown-lite renderer
│   ├── date.ts           # Local time formatting
│   ├── hash.ts           # Slug -> mascot colour/body hash
│   ├── network.ts        # Network state helpers
│   └── sum.ts            # Placeholder (deleted after real tests)
├── notifications/
│   └── setup.ts          # Expo push token, channels, handlers
└── navigation/
    └── types.ts          # Expo-router param lists
```

## Milestone order (M1 → M13)
| # | Milestone | Focus |
|---|-----------|-------|
| M1 | Scaffold the Expo project | Expo + tooling + folder structure + npm scripts |
| M2 | Theme and base components | Design system tokens + UI kit + demo screen |
| M3 | API client, auth store, streaming | Typed client, NDJSON reader, 15+ unit tests |
| M4 | Pairing and session | Pair screen, QR scan, secure store, app lock |
| M5 | Bot list and ID card | FlashList, search, sqlite cache, ID card sheet |
| M6 | Chat screen (core) | SQLite, streaming reducer, bubbles, actions |
| M7 | Cards: approvals, suggestions, untrusted, desktop-only | UI cards in chat, Approvals tab, biometric gate |
| M8 | Attachments and voice | File pickers, voice record/transcribe, TTS playback |
| M9 | Push notifications and deep links | Expo push, routing, toggles, foreground banner |
| M10 | Activity tab | Status tiles, comms threads, thread viewer |
| M11 | Mascot avatars (stretch) | SVG mascots, states, chat header integration |
| M12 | Offline outbox, errors, accessibility, performance | Outbox queue, banners, a11y pass, FlashList tuning |
| M13 | End-to-end tests, release build, docs | Maestro flows, APK build, security checklist |

## 15 Endpoints with TypeScript response types

| # | Endpoint | Method | Response Type |
|---|----------|--------|---------------|
| 1 | `/pair/complete` | POST | `{ device_id: string; device_secret: string; access_token: string; expires_in: number }` |
| 2 | `/auth/refresh` | POST | `{ access_token: string; expires_in: number }` |
| 3 | `/me` | GET | `{ device_id: string; name: string }` |
| 4 | `/bots` | GET | `{ groups: { id: string; label: string; bots: { slug: string; display_name: string; position: string; department: string; enabled: boolean; score: number \| null; grade: string }[] }[] }` |
| 5 | `/bots/{slug}/card` | GET | `{ slug: string; display_name: string; role_title: string; position: string; department: string; group: string; group_label: string; reports_to: string; created_at: string; started_at: string; lifecycle: string; enabled: boolean; source: string; tier: number; tools: string[]; memory_namespace: string; calls: number; errors: number; thumbs_up: number; thumbs_down: number; avg_latency_ms: number; last_active_at: string; score: number \| null; grade: string; settings: Record<string, unknown> }` |
| 6 | `/status` | GET | `{ slos: { slo: string; target: number; sli: number; events: number; bad: number; budget_remaining: number; status: 'ok' \| 'breached' \| 'no-data' }[]; pending_approvals: number }` |
| 7 | `/approvals` | GET | `{ requests: { request_id: string; tier: number; action: string; summary: string; requester: string; created_at: string }[] }` |
| 8 | `/approvals/{request_id}/respond` | POST | `{ resolved: boolean }` |
| 9 | `/comms/threads` | GET | `{ threads: { thread: string; from_slug: string; to_slug: string; kind: string; preview: string; ts: string; n: number }[] }` |
| 10 | `/comms/thread` | GET | `{ messages: { id: number; ts: string; from_slug: string; to_slug: string; kind: 'ask' \| 'reply' \| 'tool' \| 'result' \| 'message' \| 'conclusion'; text: string }[] }` |
| 11 | `/notifications` | GET | `{ unread: number \| null }` |
| 12 | `/chat/stream` | POST | NDJSON stream of `ChatEvent` (discriminated union, see below) |
| 13 | `/voice/transcribe` | POST (multipart) | `{ text: string }` |
| 14 | `/voice/speak` | GET | `audio/mpeg` stream (binary) |
| 15 | `/push/register` | POST | `{ ok: true }` |

### ChatEvent discriminated union (for `/chat/stream`)
```ts
type ChatEvent =
  | { t: 'speaker'; slug: string }
  | { t: 'delta'; slug: string; text: string }
  | { t: 'tool'; slug: string; name: string; label: string; status: 'running' | 'ok' | 'error'; result?: unknown; untrusted?: boolean }
  | { t: 'ui'; slug: string; kind: 'credentials' | 'oauth' | 'suggestions'; connector: string; items?: { name: string; why: string; status: string }[] }
  | { t: 'phase'; text: string }
  | { t: 'route'; slugs: string[]; source: string; confidence: number }
  | { t: 'done'; slug: string; usage: Record<string, unknown> }
  | { t: 'error'; slug?: string; message: string }
  | { t: string; [k: string]: unknown }; // fallback: ignore unknown types
```