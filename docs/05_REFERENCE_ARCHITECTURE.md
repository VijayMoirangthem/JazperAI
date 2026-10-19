# 05 — Reference architecture: what we adopt from the open-source projects

Status: **draft for founder review**. Written after cloning 26 reference repos into `Project_References/` (git-ignored). "Verified" means I read the file/dir named; "To study" means cloned but not yet read in depth — I will not claim patterns I have not read.

## 1. Why this document exists

The first implementation pass (P0–P3 slices) was built from the spec text alone. The backend foundation (tenancy/RLS, vault, audit chain, event bus, HITL) is sound, but the **user-facing pieces are prototypes**: Team Chat, Virtual Office and Live Agents are small, hand-rolled panels. The references below show what "state of the art" looks like for each area. From here on, every feature starts by reading the matching reference, and states in its commit which pattern it follows.

## 2. Reference register

| Area | Repo (in `Project_References/`) | Licence (checked in clone) | How we use it |
|---|---|---|---|
| Chat UI / desktop shell / approvals | **OpenMausBot** (`milind-soni`, 5k★, active) — matches the spec's "Open-Mouse-Bot / Grok-Bot" description | Apache-2.0 (`enterprise/` is separately licensed — never copy) | **Port patterns, may reuse Apache code with attribution (NOTICE).** Primary model for chat, shell, approvals |
| Chat UI | LibreChat | MIT | Port patterns |
| Chat UI | open-webui | Custom BSD-style with branding restriction | Study only |
| Agent orchestration | langgraph | MIT | Depend (already used) |
| Crews | crewAI | MIT (per GitHub) | Depend (P2-04) |
| Self-improvement (PIP) | hermes-agent, Hermes-Bot-Mode | MIT | Port patterns (P2-15) |
| Simulated agent life | generative_agents | Apache-2.0 | Port patterns (schedules/memory stream) |
| 2D office engine | phaser | MIT | Depend (already used) |
| Map tooling | tiled | Apache-2.0 | Depend on its JSON format |
| Office / proximity / rooms | workadventure | **No licence file in clone; self-hosting docs reference AGPL** | **Study only — no code copied** |
| Office UI ideas | age-of-agents, agent-of-empires | MIT | Port patterns |
| Editor | monaco-editor | MIT | Depend |
| Streaming diffs | continue (`core/diff/streamDiff.ts`, `core/edit/streamDiffLines.ts`), cline | Apache-2.0 | Port the algorithm (P3-04) |
| Repo understanding | aider (`aider/repomap.py`) | Apache-2.0 | Port the idea: tree-sitter tags + PageRank (networkx) ranked repo map (P4-02) |
| Sandbox / dev loop | OpenHands | MIT (verify `enterprise` dirs) | To study → P4-01 |
| Memory | mem0, letta | Apache-2.0 | To study → P1-10 follow-up |
| Observability | langfuse | MIT except `ee/` dirs | Study; export OTel to it (P2-10) |
| MCP | python-sdk, servers | MIT→Apache-2.0 transition | Depend on the SDK (P2-11) |
| Voice | faster-whisper, silero-vad, kokoro, piper | MIT / MIT / Apache-2.0 / MIT (verify: upstream Piper moved to GPL) | Depend (P3-15); check Piper licence before use |

## 3. Verified patterns worth adopting

**OpenMausBot** (`docs/*.md`, `server/`, `src/`, `electron/`):
- *Per-bot approval levels* (Ask / Auto-accept edits / Approve-for-me / Full access) passed through to the engine's own permission modes → replace our single global tier table with **per-agent approval level + per-action tier** (`docs/approval-levels.md`).
- *Progressive tool disclosure* (`find_tool` / `use_tool`): shrinks the tool catalogue sent each turn by 65–74% → adopt for the MCP hub to control token cost (`docs/agents-tool-bridge.md`).
- *Decision model*: a fast classifier chooses who answers in group rooms, with a confidence threshold and fallback to the lead → replaces our keyword-only router for group channels (`docs/decision-model.md`).
- *Secrets*: AES-256-GCM files with a 0600 key, tokens never returned by any route, refresh-token rotation, explicit `needs-sign-in` state → matches and extends our vault design.
- *Engineering discipline*: every component has a co-located test; `AGENTS.md` comment rules; isolated-fixture verification; i18n tests. We adopt the same bar (§5).
- *Chat UX hooks*: `use-transcript-viewport`, `use-unread-divider`, attachment gallery/preview, ask cards, activity panel, bot context menu — the concrete feature list our Team Chat must reach.
- *Desktop*: Electron + Vite + React 19 + pnpm workspaces, `shared/` wire types, packaged installers, ACP (Agent Client Protocol) integration tests for engines.

**continue** `streamDiff`: line-wise streaming Myers diff over an async line stream with indentation-mistake tolerance; emits old/new lines in hunk order → basis for our `diff-stream` hunks.

**aider** `repomap.py`: tree-sitter tag extraction + `networkx.pagerank` over a definition/reference graph to pick the most relevant symbols within a token budget → basis for the AST repair loop's context.

**workadventure** (study only): separate `front` (Phaser), `back`, `pusher`, `map-storage`, `room-api`, LiveKit for proximity audio/video, Tiled maps with scripting API — informs *architecture* of rooms and proximity chat; we write our own implementation.

## 4. Honest gap list against the references

| Our piece | Gap |
|---|---|
| Team Chat panel | No unread dividers, attachments, voice notes, token streaming, ask/approval cards inline, context menus, tests |
| Virtual Office | One hand-built map, circles not sprites, no rooms/proximity/pathing polish, no map editor flow (Tiled), no schedules |
| HITL engine | Global tier table only; no per-bot approval level; not wired to chat approval cards |
| Router | Keyword only; no decision model |
| Shell | Electron wraps the Next.js dev server; no Vite renderer, no installer, no e2e |
| Memory | No consolidation/forgetting study vs mem0/letta yet |

## 5. Engineering bar (adopted from the references)

1. Read the reference first; the commit message names it and the pattern.
2. Every new component/module ships with a co-located test; UI flows get Playwright.
3. Comments only for facts the code cannot say (OpenMausBot's `AGENTS.md` rule).
4. Verification runs against an isolated fixture, never the live data.
5. Licence gate: Apache/MIT code may be reused with NOTICE attribution; AGPL/custom/`ee`/`enterprise` code is study-only.

## 6. Revised build order (replaces the P3 prototype slices)

1. **R1 Chat v2** (OpenMausBot + LibreChat): transcript viewport, unread divider, attachments, ask/approval cards, streaming, per-bot approval level. Needs a decision on the renderer (see §7).
2. **R2 Streaming diff editor** (continue + cline + Monaco).
3. **R3 Office v2** (Phaser + Tiled; study workadventure/age-of-agents/generative_agents): sprite sheets, rooms, proximity, schedules.
4. **R4 Agent runtime depth**: crews (crewAI), decision model, tool bridge + MCP hub (python-sdk), per-bot approvals, FinOps, tracing (OTel→Langfuse).
5. **R5 Dev loop & sandbox** (OpenHands + aider repomap).
6. **R6 Memory v2** (mem0/letta study) and voice (faster-whisper, silero-vad, kokoro).

## 7. Decisions needed from the founder

1. **Renderer stack**: adopt OpenMausBot's *Electron + Vite + React 19 (pnpm workspace with `shared/` wire types)* and migrate the existing panels, or keep Next.js inside Electron? Recommendation: migrate — it is what the reference ships and what packaged installers need.
2. **Reuse level for OpenMausBot (Apache-2.0)**: port patterns only, or copy components with attribution? Recommendation: copy selectively with NOTICE, adapting to our backend.
3. **Engines**: OpenMausBot drives Claude/Codex CLIs per bot. We call the API directly. Do you want CLI-engine support too (uses your existing subscriptions)?
4. **Piper vs Kokoro** for TTS pending Piper licence check.
