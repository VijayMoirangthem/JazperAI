# 06 — Plan V2 (the plan we follow from now)

Supersedes the P3 prototype slices in `Version1/PROMPTS_V1.md`; P0–P2 foundation work stands. Source patterns: `05_REFERENCE_ARCHITECTURE.md`. Decisions (founder): migrate to Electron + Vite + React 19; reuse OpenMausBot code selectively (attribution in `NOTICE`); personal-use licensing relaxed; **custom AI providers/models are first-class**; LLM today = Groq free tier (key already in `backend/python/.env`).

## Working rules (every phase)
1. Read the matching reference first; commit message names it. 2. Tests ship with the code (pytest / node:test / Playwright). 3. Verify on an isolated fixture. 4. One commit per prompt, push at phase end. 5. Update the tracker table below.

## Phases and prompts

### Phase A — Model providers (backend + settings UI)
- **A1 Provider/model registry**: tables `llm_providers`, `llm_models`, `llm_routing`; CRUD + test API; secrets only in the vault; seed Groq from current settings; tiered router built from the registry (per-tier fallback chains); chat/bots/directive use it. *Exit:* add a provider + model via API, route a call, fallback works (tests).
- **A2 Providers screen** (current Next UI, ported in Phase B): add/edit/test providers and models, tier routing editor.
- **A3 CLI engine provider** (Claude Code / Codex via subprocess, OpenMausBot ACP pattern). *Exit:* a bot answers via the CLI engine.

### Phase B — New renderer (Electron + Vite + React 19)
- **B1 Workspace scaffold**: `app/` pnpm workspace in OpenMausBot layout: `shared/` wire types (generated from backend JSON-Schema), `src/` renderer, `electron/` main/preload; dev/start scripts; smoke test.
- **B2 Shell migration**: sidebar, command palette, theme, settings container; port panels from `frontend/` one by one with a migration checklist (`docs/Version1/maps/panel_migration.md`).
- **B3 State + RPC**: typed store, `/ws/rpc` client (reuse `RpcClient`), api layer, notifications.
- **B4 Retire Next app** after parity checklist is green.

### Phase C — Chat v2 (OpenMausBot, LibreChat)
- **C1 Transcript core**: virtualised viewport, unread divider, day separators, delivery ticks.
- **C2 Composer**: attachments gallery/preview, drag-drop, @mentions, slash commands, voice-note record.
- **C3 Streaming + inline cards**: token streaming over RPC, ask card, approval card (HITL), tool-call/activity run, diff snapshot card.
- **C4 Rooms**: department channels, group routing via a **decision model** (fast classifier with confidence threshold + fallback to lead).
- **C5 Per-bot approval levels** (Ask / Auto-accept edits / Approve-for-me / Full) wired to the HITL engine.
- *Exit:* Playwright flows: 1-on-1, group, attachment, streaming, approval.

### Phase D — Streaming diff editor (continue, cline, Monaco)
- **D1** Monaco diff view fed by `diff-stream` hunks (port streamDiff algorithm). **D2** per-hunk accept/reject → branch manager. **D3** preview pane + HMR. **D4** LSP bridge.

### Phase E — Office v2 (Phaser + Tiled; age-of-agents, generative_agents, WorkAdventure as study)
- **E1** Sprite-sheet characters + animation, Tiled multi-room map, collision. **E2** proximity zones + presence. **E3** event-driven behaviours (meetings on delegation, schedules). **E4** room builder + add-employee flow + ID cards. *Exit:* 60 fps with 30 sprites measured.

### Phase F — Agent runtime depth
- **F1** Registry auto-load + durable supervisor (PG checkpointer in prod). **F2** Executives + 7 crews (crewAI). **F3** Tool bridge (`find_tool/use_tool`) + MCP hub (python-sdk) + Google/GitHub connectors. **F4** FinOps ledger + budgets. **F5** OTel tracing → Langfuse. **F6** Dev-loop graph + branch manager + gates.

### Phase G — Sandbox, memory, voice, hardening
- **G1** Docker sandbox (OpenHands study), AST repair with aider-style repo map. **G2** Memory v2 (mem0/letta study). **G3** Voice (faster-whisper, silero-vad, Kokoro/Piper). **G4** SRE: SLOs, chaos, backups drill, tenant spin-off, compliance matrix.

## Tracker
| Phase | Status |
|---|---|
| A1 | ☑ registry+API+tiered router+Groq live-verified (old Groq models were retired: now gpt-oss-20b/qwen3.8-27b/gpt-oss-120b) |
| A2 | ☑ AI Providers panel (Next UI; ports in B2) |
| A3 | ◐ CliProvider written, untested against a real CLI |
| B1 | ☑ app/ Vite+React19 workspace builds; Electron loads it with 0 console errors (reuses ../frontend/src via alias until B4); no shared/ wire types yet |
| B2–B4, C–G | ☐ |
| G2 | ☑ Memory v2: migration applied, tests pass, wired into chat2 _speak(), MemoryV2Panel registered |
