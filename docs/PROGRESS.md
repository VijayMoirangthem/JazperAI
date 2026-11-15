# Jazper progress tracker

Single source of truth for the plan agreed on 2026-11-15. Updated with every commit (the commit hash is the proof).
**Status:** `todo` -> `doing` -> `built` (code + unit tests done) -> `verified` (checked live on the PC/phone).
We are in an *implementation-only* phase (the PC has little free RAM), so items stop at `built` and carry a **Live check** to run later.

Branch: `claude/resource-aware-agents`. Nothing here is merged or deployed.

## Phase 1: Speed
| # | Item | Status | Commit | Tests | Live check still needed |
|---|---|---|---|---|---|
| 1.1 | Fast path for plain chat: short prompt, no tool docs, low reasoning effort, guard + fallback to the tool loop | built | 6ddc20b | test_chatmode, test_plain_chat (48 tests) | reply quality, latency vs 0.7-1.2 s baseline |
| 1.2 | Speak while the reply streams: LiveSplitter hands out sentences as they complete (first one after >= 40 chars), SpeechPipeline downloads the next 2 chunks while one plays, markdown/links/emoji stripped before speaking, new message cuts off the old one | built | 77817db | liveSplitter (9), pipeline (8), clientVoice | first words about 1 s after the model starts; how it sounds |
| 1.3 | Smaller system prompt: tool loop prompt measured at ~2,260 tokens (40 tool descriptions = 1,370); now only the relevant area is described | built | 6ddc20b | test_chatmode, test_plain_chat | latency before/after on a tool turn |
| 1.4 | Lighter memory model: **evaluation tooling only; no migration applied** (needs the DB and ~3 GB free RAM). core/services/memory_eval.py (overlap, self-hit, score scale, threshold recalibration, verdict) + scripts/memory_model_eval.py (read-only, refuses without --yes / low RAM) + docs/MEMORY_MODEL.md with the guarded migration plan. Found: the memory thresholds are tuned for bge-m3 and must be recalibrated for any other model | built (tooling) | 8831154 | test_memory_eval (9) | run the script on your memories, then decide |
| 1.5 | Gmail: one batched request for all message metadata (was one per message) + sync marker at most every 5 min. Parallel *tool* calls deliberately not done: the tool protocol is one call per round by design; fast paths cover the common cases | built | e7764de | test_gmail_batch (5) | email latency vs 2.3-2.8 s |
| 1.6 | Faster backend start-up: measured import time 18-22 s -> 15-17 s (langgraph imported lazily) -> about 10 s with the DB down (triage ran ALTER TABLE at import; now on first use with retry). More is mostly third-party libraries; details in docs/PERFORMANCE.md | built | 96c5b8e | test_startup_cost (3); full non-db suite 572 passed | restart time on a normal day; with the DB up the gain is smaller |

## Phase 2: Reliability and visibility
| # | Item | Status | Commit | Tests | Live check still needed |
|---|---|---|---|---|---|
| 2.1 | Rotating backend log file storage/logs/jasper.log (timestamps, secrets redacted, stdlib warnings too) + GET /api/logs/problems (merged repeats). Screen for it comes with 2.2 | built | e7764de | test_logfile (9) | file appears after a restart |
| 2.2 | Self-check every minute (database, Redis, Google login, AI provider, speech, disk) with phone alert after 2 failures in a row, reminder every 6 h, recovery notice; model/speech health judged from real calls (no extra cost); alerts wait in memory while the DB is down; phone "System health" screen (Settings > System) | built | 8cc93b0 | test_selfcheck (13), health.test (4); DB-backed diagnostics test in test_remote skipped here (Postgres not running) | alert actually arrives; the DB-backed remote test |
| 2.3 | Alerts after a phone reboot: 15-minute background poll (Android WorkManager via expo-background-task, survives reboot) next to the live listener; Settings switch "Alerts when the app is closed" (off = no persistent notification, 15-min checks only). **Needs an app rebuild** (2 new native packages) | built | 040e2f7 | poll.test (5) | reboot the phone, wait <= 15 min |
| 2.4 | Approve/reject from the notification: Tier 2 gets Reject + Approve, Tier 3 gets Reject + Review (fingerprint stays in the app); backend adds tier to approval events | built | 040e2f7 | events.test, routing.test (8 new); remote e2e asserts tier (DB, skipped here) | tap the buttons on a real approval |
| 2.5 | Paired devices screen (Settings > Connection): list with last seen + "looks unused" hint, remove other devices (audited); GET/DELETE /remote/v1/devices | built | 040e2f7 | devices.test (3); backend test in test_remote (DB, skipped here) | remove a test device |

## Phase 3: Product features
| # | Item | Status | Commit | Tests | Live check still needed |
|---|---|---|---|---|---|
| 3.1 | Hindi/Hinglish for the deterministic fast paths: system status (already), usage, clear chat (confirmation in your language), Drive list/open/read/latest, smarter; Hinglish detector learned 25 more words. One brain: phone, main desktop chat (ChatPanel2) and /remote/v1 all use chat2. **Not migrated:** 3 older desktop panels (ChatPanel, CommandCenter, Gmail assistant) still call /api/chat/stream (UI refactor, not testable here) | built | 5b8a483 | test_fastpaths_hindi (27) + language tests | try the Hindi phrasings; decide whether to retire the 3 old panels |
| 3.2 | Hands-free voice: auto-stop when you stop speaking (SilenceDetector), mic reopens after each spoken reply, gives up after 8 s of silence (tap mic to resume), speech-language choice Auto/English/Hindi (backend ?language=), one "Voice conversation" switch. Interrupt = tap mic or send (voice barge-in skipped: the speaker would hear itself) | built | 77817db | silence (7), handsFree (8), clientVoice (+4), test_voice_stt (+1) | speak to it in Hindi/Hinglish; threshold 0.3 may need tuning to your room |
| 3.3 | Quality + speed test set: 60 read-only tasks (EN/Hinglish/Hindi, system, email, Drive, code, team, safety, honesty, speed) scored without a model; per-task and p50/p95 timings; run-to-run comparison; nightly 03:30 run that skips when the PC is busy and alerts on regression; GET /api/system/eval/latest; docs/EVALUATION.md | built | c23b930 | test_evalset (21) | **first live baseline run** (python -m evalset.runner) |
| 3.4 | Dev-loop on the phone. The loop itself was already covered (repair, 3 attempts, rollback, escalation, Tier-3 merge gate, sandbox: test_devloop*, test_feature_flow). Added: /remote/v1/features (list, detail with redacted diff, request merge = Tier-3 approval only, discard), approval card now lists files changed (+/-), phone screens Feature runs + diff view (EN diff colouring) | built | 0de1255 | test_features_phone (8), diff.test (4) | **run one real task on a throwaway repo** end to end and approve the merge from the phone |
| 3.5 | Web search keys + remaining connectors | blocked | | | needs YOUR accounts/keys: Tavily or Brave (search), then any of Slack/Notion/Stripe/HubSpot/Airtable/Todoist/Resend/Figma/Supabase/Sentry/Firecrawl/Apify. 2 of 16 already verified (context7, sequential-thinking). Add keys in Settings > Connectors, then ask Jasper to test each |

## Out of scope (decided)
Telegram, WhatsApp (own ecosystem only); Vision/Lens (no model that fits this PC).

## Baselines (measured 2026-11-13, phone path, warm backend)
"hi jasper" 0.7-1.2 s; status 0.2-0.3 s; "what time is it" 1.0-2.6 s; Kunal's email today 2.3-2.8 s (first after restart 15 s).
Model first-token about 0.5 s (Groq gpt-oss-20b). Details: `docs/PERFORMANCE.md`.
