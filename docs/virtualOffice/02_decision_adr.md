# 02 - ADR: how do we "use WorkAdventure"?

Status: **proposed by Claude, awaiting founder approval** (2026-10-21). Evidence is in `01_workadventure_study.md`; facts below were measured or read on this machine.

## Decision

**Option C (Hybrid), implemented as: our own Phaser 3.88 code inside the existing `office` panel, adopting WorkAdventure's *conventions* (Tiled `area` objects with typed properties, `collides`, `start`, the 32x32 3x4 avatar sheet and frame order, layered avatars, proximity-group behaviour) - and no WorkAdventure source code, containers or assets.**
Option A is contained in C (C = A + deliberate format compatibility). Option B is rejected.

## Facts used

| Fact | Evidence |
|---|---|
| WorkAdventure `play/`, `back/` are **AGPL-3.0 + Commons Clause** | `play/LICENSE.txt` lines 1-12 and 679-691. "Sell" = offering for a fee a product/service that "consists, entirely or substantially, of the Software or the functionality of the Software". |
| Its shared libs (`map-editor`, `messages`, ...) are ISC | each `libs/*/package.json` |
| Room API cannot add/move/list players | `messages/protos/room-api.proto` lines 68-73: only `readVariable`, `listenVariable`, `saveVariable`, `broadcastEvent`, `listenToEvent` |
| Dev stack = 11 containers, plus LiveKit/Coturn for video; production wants 2 extra public hosts | `docker compose ... config --services` output; `docs/others/self-hosting/install.md` |
| This PC: 15.7 GB RAM, **0.3 GB free at measurement time**, 12 logical CPUs; Docker VM capped at 8.17 GB; already running `jasper-postgres`, `jasper-redis`, `jasper-minio`, `jasper-wal-shipper` | `Get-CimInstance Win32_OperatingSystem`, `docker info` |
| `docker compose config` works (renders, ~50 "variable not set" warnings: needs a filled `.env`) | run in `Project_References/workadventure` |
| WorkAdventure uses Phaser 4.2.0, we use 3.88.2 | `play/package.json`, `app/package.json` |
| Our event source already exists and is richer than what WA would give us | `backend/python/api/routes/rpc.py` (`agent-state-change` with `status_bubble`, `reason`), `core/contracts.py` `AgentStateChange` |

I did **not** start the WorkAdventure stack: with 0.3 GB free RAM it would have degraded the running app for no new information; the compose config, service list and licence were enough to decide.

## Options compared

| | A. Reimplement in our Phaser panel | B. Self-host WorkAdventure, embed, agents as bots | C. Hybrid (chosen) |
|---|---|---|---|
| Licence for personal use | clean | AGPL ok for private use | clean |
| Licence for a Baeit/Boardmint spin-off | clean | **Commons Clause forbids selling a product/service substantially consisting of WorkAdventure's functionality**; embedding it in a paid product is exactly that. Would need their commercial licence. | clean (no WA code) |
| RAM/CPU | ~0 extra | +11 containers (+LiveKit, Coturn) beside Postgres/Redis/MinIO on a machine with 0.3 GB free | ~0 extra |
| Agents as participants | native (our `/ws/rpc`) | **no API for it**; each agent must fake a human client over the pusher protocol (token, avatar, position stream) and still be mirrored from our bus | native |
| "Single window, one launcher, no cloud" | ok | breaks: needs reverse proxy, extra ports, OIDC, separate services to start/stop from `Jazper.exe` | ok |
| Look and interaction fidelity to WA | what we build | full | what we build, with maps/avatars compatible in format |
| Effort | medium-high | high (ops) + glue code + auth/style integration | medium-high (A plus small adapter) |
| Risk | scope creep | operational fragility, upgrade treadmill ("about once a month" per their install doc), licence trap | scope creep (controlled by prompts) |

## What we give up

* WorkAdventure's video/audio rooms (LiveKit/Jitsi), its map editor UI, multi-user presence between several real humans, Matrix chat, map-storage. None of these is needed: one founder, agents are text.
* Instant polish: WA has years of tuning (camera, bubbles, wokas). We will reach "good" by iterating, not "identical".
* Perfect map interchange: we adopt Tiled `area` objects and `collides`/`start`, but **not** `.wam` files or every property; maps authored for WA will load our geometry and rooms, not its scripts/Jitsi/website triggers.

## Guard rails (apply to every prompt)

1. Founder decision: personal local use only, so WorkAdventure code may be copied or adapted. Log each copy.
2. Personal-use decision (founder, 2026-10-21): copying WorkAdventure code and art is allowed. Every copy is logged in `COPIED_FROM_WORKADVENTURE.md`. Caveat kept on record: AGPL-3.0 + Commons Clause and CC-BY-SA 3.0/GPL 3.0 art apply if the app is ever distributed or sold (spin-off); the log tells us exactly what to replace.
3. Keep the old office reachable until the founder approves the switch.

## Fallback criteria (when to change course)

Re-open this ADR if **any** of these happens:

* After prompt P09 (movement + camera) the office cannot hold **>= 55 fps average with 60 avatars** on this machine, measured by `window.__officeFps` -> consider lowering effects first (Phaser `RenderTexture` bake of static layers, culling), then Pixi (already a dependency, `pixi.js ^8`), never Option B.
* The founder wants **several real humans** in the same office at once (needs a server-authoritative position service). Then evaluate B again - but only with a signed commercial licence or for strictly internal use, and only after checking the Commons Clause for the then-current plan.
* The founder decides to monetise the office itself (e.g. as a Boardmint feature): A/C stays valid precisely because it contains no WorkAdventure code; reconfirm asset licences (`04_asset_plan.md`) before shipping.
* A required interaction (e.g. voice rooms) cannot be done without WebRTC rooms: add LiveKit alone, not the WA stack.

## Founder questions

None blocking. One optional preference: whether the spin-off is likely; the plan already assumes **yes**, which is why it stays free of WA code and art.
