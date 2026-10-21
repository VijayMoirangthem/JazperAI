# Office V3 - master prompt book (WorkAdventure workflow x DeskRPG look and feel)

Owner: founder. Implementer: Claude (or any agent that follows the PREAMBLE). Scope: turn the Office 3 (beta) spike into the real, living office.
Related docs: `README.md` (spike results), `../03_target_design.md` (Office 2 design, many modules are reused), `../COPIED_FROM_WORKADVENTURE.md` (copy log).

Rulebook (repo `CLAUDE.md`): Jazper AI is personal and local-only. **No licence or copying restrictions**: copy and adapt code and assets from `Project_References/` freely, log copies in `COPIED_FROM_WORKADVENTURE.md`. Prefer quality and speed. Do not add restrictions nobody asked for.

---

## 0. Product vision in one page

A living 3D office where **AI agents and humans are the same kind of citizen**:

- **From WorkAdventure we take the workflow**: a shared world with rooms and zones that carry behaviour (silent, focusable, restricted, meeting, broadcast), proximity bubbles that start conversations, right-click actions on a person (follow, visit card, message, go to), emotes, status (online / away / busy / do-not-disturb), a **map editor** (areas, entities, floors, undo, explorer), personal areas, tooltips, lockable meeting areas, an action bar, onboarding, moderation.
- **From DeskRPG we take the look and the office life**: stylised 3D miniature office, 50 looks, environments (trading company, agency, tech startup, executive suite, publisher) with finishes and lighting, **meeting mode with a cinematic camera and walls that fade**, "call an employee over", idle / gait / gesture motion, label layout that never overlaps, kanban boards, approvals and attention inbox, cron-driven work, view settings, frame benchmark.
- **Our own product layer**: agents are real backend bots (`/api/v1/bots`, `/ws/rpc` `agent-state-change`, `/comms/*`), their state drives where they stand and what they do; a founder (and later employees and interns) can walk in, talk to them, assign work, approve actions, and edit the building.

Non-goals for V3: video/voice calls (hook points only), mobile client, public internet exposure, payments.

## 1. Parity matrix (what must exist, where it comes from, where it lands)

Legend: WA = WorkAdventure, DR = DeskRPG, OUR = new. Phase = prompt group below.

### 1.1 Characters and customisation
| Capability | Source (read this) | Our target | Phase |
|---|---|---|---|
| 50 curated looks + gallery with thumbnails | DR `src/components/OfficeLookGallery.tsx`, `src/game/three/office-look-asset*`, `public/assets/characters/office/*.glb` | `LookGallery` modal, looks catalogue JSON | D |
| Layered custom woka (body, eyes, hair, clothes, hat, accessory) | WA `play/public/resources/customisation/*`, `src/pusher/data/woka.json`, `play/src/front/Components/Woka` | Tint + part swap on our GLBs: hair/outfit/skin colours, hats and glasses attached to bone anchors | D |
| Live 3D preview with turntable | DR `CharacterPreview.tsx`, `CharacterModelView.tsx` | `AppearanceEditor` | D |
| Body types, scale, name badge style | DR `office-appearance.ts` (`OfficeBodyType`) | `Appearance` schema (section 3.2) | D |
| Companions (pets) | WA `Components/Companion`, `SelectCompanion` | optional `Pet` entity following an owner | D (stretch) |
| Gait, idle motion, gestures (wave, nod, point), no-overlap labels | DR `gait.ts`, `idle-motion.ts`, `gltf-gestures.ts`, `label-layout.ts` | `motion/` module | F |
| Emotes (menu, floating icon) | WA `Components/EmoteMenu`, `Game/EmoteManager.ts` | `EmoteWheel` + billboard icon + matching animation | F |
| Status (online, away, busy, do-not-disturb, focus) | WA status stores (`Stores/`), `UsernameStatusDisplay.ts` | `Presence.status` + ring and badge | I, J |

### 1.2 Camera, view, controls
| Capability | Source | Target | Phase |
|---|---|---|---|
| Pan, zoom, follow, focus on area | WA `Game/CameraManager.ts`, `focusable`, `zoomMargin` | `CameraRig3D` (orbit target, damped) | B |
| **Rotate the screen** (snap 90 degrees and free orbit), tilt, presets (isometric, top-down, cinematic) | DR `meeting-camera.ts`, `ViewSettingsModal.tsx` | `CameraRig3D.rotate/preset` + keyboard Q/E | B |
| Walls that fade when they block the view | DR `meeting-wall-occlusion.ts`, `meeting-architecture-walls` | `WallOcclusion` (raycast to target, per-room cutaway toggle) | B |
| Meeting camera that follows the current speaker | DR `meeting-camera.ts`, `components/MeetingRoom.tsx` | `MeetingDirector` | F |
| Minimap | OUR (Office 2 `Minimap.tsx`) | 3D-aware minimap with room labels and camera cone | B |
| Day/night, lighting presets per environment | DR `office-lighting.ts`, `office-environment-theme.ts` | `LightingRig` + clock | B, G |
| Graphics quality tiers, frame benchmark | DR `frame-benchmark.ts` | `Quality` setting + benchmark page | L |

### 1.3 Interaction
| Capability | Source | Target | Phase |
|---|---|---|---|
| Click-to-move, WASD (camera-relative), sit and stand | WA `UserInput/*`, `Utils/PathfindingManager.ts`; DR `desk-seats` | `Navigator` + `SeatManager` | C |
| Right-click menu on a person (follow, visit card, message, go to, ...) | WA `Components/ActionsMenu/WokaMenu.svelte`, `ExplorerMenu.svelte`, `VisitCard`, `FollowMenu` | `ContextMenu` with action registry per target type | E |
| Hover outline, selection, box-select | DR `furniture-highlight.ts` | `Selection` service + outline pass | E |
| Proximity bubble, join and leave, lock a conversation | WA `Entity/ConversationBubble.ts`, back `Group.ts` (radius 48, min distance 64) | `ConversationManager` (reuse Office 2 `proximity.ts`) | F |
| Follow a person (WA "follow") | WA `FollowManager.ts`, `FollowMenu` | follow request, accept, leader and follower paths | F |
| Call an employee over; they walk to you, report, leave | DR README "Call Them" flow, `NpcDialog.tsx` | `CallOver` command | F |
| Silent zones, restricted zones, max users, lockable areas, tooltips, speaker and listener (megaphone) | WA `libs/map-editor/src/types.ts` property types | `ZoneRules` engine | F, G |
| Interact with objects (coffee, printer, whiteboard, vending, screen) | WA entities with `PropertyData`; DR furniture assets | `Interactable` registry with animations and effects | F |

### 1.4 World building
| Capability | Source | Target | Phase |
|---|---|---|---|
| Edit mode with tools: Area, Entity, Floor, Trash, Settings, Explorer | WA `Phaser/Game/MapEditor/Tools/*`, `libs/map-editor` (commands, undo) | `Builder` (section G) | G |
| Entity catalogue with categories and search, upload custom | WA `EntitiesCollectionsManager.ts` | `PrefabCatalog` from DeskRPG GLBs + ours | G |
| Environments (5 themes), finishes (floors, walls), thumbnails, picker | DR `office-environments.ts`, `office-finishes.ts`, `OfficeEnvironmentPicker.tsx`, `office-environment-thumbnails.json` | `Theme` presets and picker | G |
| Room layout modules (executive room, creative studio, lounge...) | DR `executive-room-layout.ts`, `creative-studio-layout.ts`, `office-layout-modules.ts` | `RoomTemplate` library | G |
| Personal areas (claimable desk) | WA `PersonalAreaPropertyData` | `Desk.owner` claim | G, I |
| Undo/redo, snapshots, validation (reachability) | WA command pattern; OUR `mapModel.ts` validation | `CommandStack`, `WorldValidator` | G |

### 1.5 Work and communication (DeskRPG layer on top of our agents)
| Capability | Source | Target | Phase |
|---|---|---|---|
| Chat by mention, group rooms, message lifecycle (queued, thinking, streaming, done) | DR `ChatPanel.tsx`, `mention-input`, `conversation` | deep link to Team Chat (exists), in-world bubbles | F, H |
| Kanban per office, cards shown on a board object | DR `components/kanban`, `office-kanban.ts` | `TaskBoard` prop fed by backend tasks | H |
| Approvals and attention inbox | DR `components/approvals`, `attention`; ours `/approvals`, `human-intervention-request` | raised hand + walk to the human, inbox drawer | H |
| Cron/scheduled work, meetings at fixed times | DR `components/cron` | `Schedule` director (stand-up at 10:00, lunch) | H |
| Meeting minutes | DR `MinutesModal.tsx` | minutes drawer for a finished meeting | H |
| Artifacts and connectors | DR `components/artifacts`, `connectors` | out of scope; link-outs only | - |

### 1.6 Humans and multi-user
| Capability | Source | Target | Phase |
|---|---|---|---|
| Accounts, roles, access control | DR (multiplayer, groups, role-based access), WA admin API, `RestrictedRightsPropertyData` | `Identity` + `Permissions` matrix | I |
| Presence and position sync, interest management | WA `back/src/Model/GameRoom.ts`, `Zone.ts`, `PositionNotifier.ts` | `OfficeServer` (FastAPI websocket) | I |
| Moderation (mute, kick, report) | WA `Components/Moderation` | admin actions + audit | I |
| Onboarding tour | WA `Components/Onboarding` | first-run tour per role | I, J |
| Locale | DR (ko, en, ja, zh) | i18n keys from day one | J |

---

## 2. Target architecture (modules, all under `app/src/office3/`)

The spike is one file (`office3.ts`, about 330 lines). V3 splits it into small modules with a single typed **event bus** and a **world model** that is engine-independent (so unit tests run under `node --test`, same rule as Office 2: erasable TypeScript only, `.ts` import extensions in pure modules).

```
app/src/office3/
  core/                     PURE (node --test)
    world.ts                World schema, parse, validate, migrate (section 3.1)
    appearance.ts           Appearance schema, defaults, serialise (3.2)
    presence.ts             Presence model, status, roles, permissions matrix (3.3)
    navgrid.ts              walkable grid from world, doors, dynamic blockers, A* (reuses office2/pathfind)
    interactions.ts         declarative interaction registry (3.5), resolver
    conversations.ts        proximity groups, lock, leave (reuses office2/proximity)
    schedule.ts             time-of-day director rules (stand-up, lunch)
    commands.ts             undo/redo command stack for the builder
    bus.ts                  typed event bus (3.4)
  engine/                   three.js, browser only
    renderer.ts             renderer, resize, quality tiers, pause, dispose
    cameraRig.ts            orbit/rotate/zoom/follow/focus/presets
    lighting.ts             hemisphere + sun + room lights, day/night
    worldView.ts            floors, walls, doors, windows, instancing, wall occlusion
    prefabs.ts              GLB catalogue, loading, fitting, anchors, instancing
    actors.ts               character loading, merge-to-one-mesh, animation state machine, tint, attachments
    labels.ts               nameplates, bubbles, emote icons (collision-free layout)
    picking.ts              raycast, hover outline, selection, box-select
    fx.ts                   rings, halos, particles (coffee steam, sparkle), decals
    audio.ts                optional ambience and footsteps (L)
  systems/                  glue between core and engine (run in the render loop)
    navigator.ts            moves actors along paths, steering, sit/stand
    director.ts             state -> destination, schedule, call-over, follow, meetings
    interactor.ts           executes interactions between actors and objects
    sync.ts                 network client (I): local prediction, remote interpolation
  ui/                       React components (panels, modals, menus)
    ContextMenu.tsx  ActionBar.tsx  Roster.tsx  AppearanceEditor.tsx  LookGallery.tsx
    BuilderPanel.tsx  Inspector.tsx  Catalog.tsx  ThemePicker.tsx  ViewSettings.tsx
    ChatBubbleLayer.tsx  Toasts.tsx  Onboarding.tsx  HelpOverlay.tsx  Minimap3D.tsx
  office3.ts                (thin entry: wires modules, exposes handle + window.__office3Debug)
app/src/components/panels/Office3Panel.tsx   (React shell, keeps current route #office3)
backend/python/api/routes/office.py          (world, looks, presence, office websocket) - phase I and G persistence
```

**Dependency rule**: `core/` never imports three, DOM or React. `engine/` never imports React. `ui/` talks to the engine only through `office3.ts` handle and the bus. This is what keeps the 60-person performance budget testable.

**Performance budget (hard gates, measured by `e2e/tests/office3.spec.ts` and the benchmark page)**: 60 people (real roster) median >= 55 fps on this PC at quality "high", >= 45 fps at 120 people on "medium"; draw calls <= 800 at 120 people; no per-frame allocation in the actor loop; startup to interactive <= 4 s with warm cache.

## 3. Data contracts (write these first, everything else follows)

### 3.1 World (`world.json`, version 3)
```jsonc
{
  "version": 3, "id": "default", "name": "Sir Jazper HQ", "theme": "tech-startup",
  "size": { "w": 60, "h": 40, "tile": 1 },
  "floors": [ { "rect": [x1,y1,x2,y2], "material": "oak|carpet-blue|tile-light|...", "tint": "#hex?" } ],
  "walls":  [ { "from": [x,y], "to": [x,y], "height": 2.4, "style": "plaster|glass|brick", "doors": [ {"at":[x,y],"width":2,"kind":"open|glass|locked"} ], "windows": [ ... ] } ],
  "rooms":  [ { "id": "meeting", "label": "Meeting room", "rect": [..], "kind": "work|meet|tools|social|private|transit",
                "rules": { "silent": false, "focusable": true, "capacity": 12, "access": {"roles": ["founder","employee"]},
                           "tooltip": "", "ambience": "office|lounge|none", "light": {"preset":"warm","intensity":1} } } ],
  "objects": [ { "id": "o_123", "prefab": "workstation-v1", "pos": [x,y], "rot": 0, "scale": 1, "props": { "owner": "slug?", "label": "?" } } ],
  "seats":   [ { "id":"s1","room":"engineering","pos":[x,y],"facing":"up","owner":null } ],
  "spots":   [ { "id":"p1","room":"lounge","pos":[x,y],"facing":"down" } ],
  "spawn":   { "founder": [52,9], "default": [52,9] }
}
```
Migration: `core/world.ts` converts the Office 2 `map.json` (Tiled) to this schema once (`scripts/office3_migrate_world.mjs`); Office 2 keeps working untouched. Validation (throws readable errors): every seat/spot reachable from spawn, rooms do not overlap unless nested, doors lie on a wall, objects inside bounds, prefab ids exist in the catalogue, at least 24 seats in work rooms (configurable).

### 3.2 Appearance
```jsonc
{ "v": 1, "look": "office-ara", "bodyType": "a|b|c", "scale": 1.0,
  "tints": { "skin": "#e0ac8a", "hair": "#2b1d14", "top": "#3b82f6", "bottom": "#1f2937", "shoes": "#111827" },
  "parts": { "hair": "short-02|none", "hat": "cap-01|none", "glasses": "round|none", "badge": "lanyard|none" },
  "badge": { "style": "plate|floating|none", "showRole": true },
  "voice": "en-GB-RyanNeural" }
```
Source of truth per person lives in the backend (`/api/v1/office/appearance/{slug}`, JSON in Postgres `shared.office_appearance`); fallback `localStorage` when offline. Defaults come from `lookFor(slug, crew, kind)` so nothing breaks if no appearance is saved. Tint works on the merged vertex-colour mesh by **colour regions**: the merge step (`actors.ts prepare`) keeps a per-vertex `region` attribute (skin, hair, top, bottom, shoes, other) derived from the original material name or colour clustering, so tinting is a shader uniform per region, no re-merge.

### 3.3 Presence and permissions
```ts
type Role = "founder" | "admin" | "employee" | "intern" | "guest" | "agent";
type Status = "online" | "away" | "busy" | "dnd" | "focus" | "offline";
interface Presence { id: string; kind: "human" | "agent"; role: Role; status: Status; pos: [number, number]; facing: number; anim: string; room: string | null; since: number }
```
Permission matrix (single table in `core/presence.ts`, unit-tested): enter room kinds, edit world, edit others' appearance, assign agent work, approve tier N actions, moderate, see private rooms, see agent prompts. Founder can do everything; admin all but ownership; employee: work + chat + own appearance; intern: employee minus approvals and room edits, mentor pairing; guest: public rooms only, read-only; agent: policy-driven.

### 3.4 Event bus (names are contracts, tests assert on them)
`actor.spawn|despawn|move|arrive|state|anim`, `conv.join|leave|lock|unlock|bubble`, `select.change`, `ctx.open|action`, `emote`, `follow.request|accept|stop`, `call.request|arrive|done`, `meeting.start|speaker|end`, `edit.enter|exit|command|undo|redo`, `world.change|saved`, `net.connect|drop|rejoin`, `perf.sample`.

### 3.5 Interaction registry (declarative)
```ts
interface Interaction { id: string; between: ["actor"|"human"|"agent", "actor"|"object"|"zone"]; when: Condition; approach: { distance: number; facing: "toward"|"away"|"none" };
  sequence: Step[];  // ["face","wave","say:Hi","anim:nod","fx:sparkle","wait:1200","emit:call.done"]
  cooldownMs: number; permission?: string; }
```
Everything that "happens when two characters meet" is an entry here, not hard-coded in the loop.

---

## 4. PREAMBLE (paste in front of every prompt below)

```
Project: Sir Jazper AI, D:\Projects\COOS (Windows 11, founder only user). App: Vite + React 19 + TypeScript in app/, Electron shell in desktop/, backend FastAPI in backend/python (pinned: FastAPI 0.111, Starlette 0.37, Pydantic 2.7; never pip upgrade), e2e in e2e/ (Playwright drives the real Electron window).
Goal: Office V3 = the 3D office (app/src/office3, panel #office3). Read docs/virtualOffice/OfficeV3/README.md and PromptsofficeV3.md sections 1-3 first.
RULES
1. Rulebook in CLAUDE.md: no licence or copying restrictions; copy from Project_References/ freely and log copies in docs/virtualOffice/COPIED_FROM_WORKADVENTURE.md.
2. Another model edits this working tree concurrently (backend files show as modified). Stage ONLY the files you changed, by explicit path. Never git add -A, stash, reset --hard, checkout -- . . Commit on branch feature/office2 with the message given.
3. core/ is PURE: erasable TypeScript, relative imports with .ts, no three/DOM/React; every pure module has app/tests/office3.<name>.test.mjs run by node --test (add to the `test` script glob tests/office3.*.test.mjs once).
4. Typecheck with `cd app; npx tsc --noEmit -p tsconfig.office2.json` (extend its include list for new folders). Full `npx tsc --noEmit` takes 8+ minutes: run only before a phase is declared done, in the background.
5. e2e: `cd e2e; npx playwright test tests/office3.spec.ts -g "<name>"`. Backend must be up (http://127.0.0.1:8000/health/); if it is down because another model broke a file, do NOT touch their file: report and continue with unit tests.
6. Electron CSP lives in desktop/main.js (connect-src already allows ws://127.0.0.1:8000, blob:, data:). Any new origin goes there.
7. Performance budget (section 2) is a gate. Every phase ends with the perf test; a regression below budget blocks the phase.
8. No console.log, no `any`, no secrets in code or logs. Keep files < 400 lines; split before that.
9. Each prompt ends with: acceptance commands + expected output, screenshot path to eyeball, rollback (`git revert <sha>`). Update docs/virtualOffice/OfficeV3/PROGRESS.md (one row per prompt).
```

---

## 5. Roadmap and prompt index

| Release | Phases | Outcome |
|---|---|---|
| **V3.0 "alive"** | A foundation, B camera/view, C movement, D characters, E context menus/selection, F interactions, J shell (minimum) | You can walk around, rotate the view, right-click anybody, customise looks, watch agents meet and talk |
| **V3.1 "builder"** | G world builder, themes, catalogue | You can add rooms and objects, switch environments, undo/redo, save |
| **V3.2 "agent life"** | H work layer | Tasks, approvals, schedules, meetings with a director camera |
| **V3.3 "people"** | I humans and multi-user | Employees and interns can join with roles and permissions |
| **V3.4 "polish"** | K audio, L performance tiers, M persistence hardening, N test suite, O rollout | Production quality, default office switch |

Prompt IDs: `V3-<phase><n>`. Effort: S (< 1 h), M (1-3 h), L (3+ h). Run them in order inside a phase; phases A then B/C/D in parallel is fine, E needs C and B, F needs C and E.

---

# PHASE A - Foundation (do first)

## V3-A1 Split the spike into modules, keep behaviour identical (M)
**Goal**: no visual change; code moves to the architecture in section 2 so later work is small and testable.
**Read**: `app/src/office3/office3.ts`, `app/src/components/panels/Office3Panel.tsx`, `e2e/tests/office3.spec.ts`.
**Create**: `engine/renderer.ts`, `engine/worldView.ts`, `engine/prefabs.ts`, `engine/actors.ts`, `engine/labels.ts`, `systems/navigator.ts`, `systems/director.ts`, `core/bus.ts`; `office3.ts` becomes the wiring file (< 150 lines).
**Spec**: move code by responsibility: floor texture + walls + furniture fitting -> `worldView`/`prefabs`; `prepare()` (merge to one skinned mesh), clone, animation switch -> `actors`; label sprite code -> `labels`; path following + sit/stand -> `navigator`; `applyLive`/`route`/wander -> `director`. Introduce `bus.ts` (typed `on/emit/off`, no allocations on emit when there are no listeners). Handle API stays: `ready, setActive, sync, applyLive, stats, destroy`. Add `window.__office3Debug` = `{ actors(): {slug,x,z,anim,place,state}[], camera(): {x,y,z,tx,ty,tz}, quality(), bus: {count(name)} }`.
**Acceptance**: `cd app; npx tsc --noEmit -p tsconfig.office2.json` -> no output; `cd e2e; npx playwright test tests/office3.spec.ts` -> 2 passed and `o3-roster.json` fps within 10% of before; screenshot identical to `o3-roster.png` by eye.
**Rollback**: revert commit.

## V3-A2 World schema, loader and migration (M)
**Goal**: the building becomes data (section 3.1) instead of being derived from the Tiled file at runtime.
**Read**: `app/src/office2/mapModel.ts`, `scripts/office2_layout.mjs`, `app/public/office2/map.json`, section 3.1.
**Create**: `core/world.ts` (types, `parseWorld`, `validateWorld`, `migrateFromOffice2`), `scripts/office3_migrate_world.mjs` -> `app/public/office3/world.json`, `app/tests/office3.world.test.mjs`.
**Spec**: all rules in 3.1 including readable error messages (assert each in tests). `worldView` and `navgrid` read only `World`. Walls become segments with doors and windows (door gap 2 tiles). Room rules default (`silent:false`, `capacity` = number of seats/spots). Keep `blocked[y][x]` derivation in `core/navgrid.ts` (floors minus walls minus object footprints; footprints come from the prefab catalogue, section G1).
**Acceptance**: `node --test tests/office3.world.test.mjs` -> all pass (>= 12 tests: valid world, each validation error, round trip JSON, migration from Office 2 gives 9 rooms and 30 desk seats); Office 3 renders the same layout from `world.json`.

## V3-A3 Backend persistence for world and looks (M)
**Goal**: world and appearances survive restarts; no data in the repo.
**Read**: `backend/python/api/routes/bots.py` (style), `backend/python/core/` DB helpers (`aio.fetch/execute`), migrations folder used by the repo.
**Create**: `backend/python/api/routes/office.py` (include router at `/api/v1/office`), table creation in the repo's migration mechanism, `backend/python/tests/test_office_world.py`.
**Spec**: `GET/PUT /api/v1/office/world` (single active world + `GET /worlds`, `POST /worlds/{id}/activate`, `POST /snapshots` keeps last 20 versions, `GET /snapshots`), `GET/PUT /api/v1/office/appearance/{slug}` (validated against section 3.2, max 4 KB), `GET /api/v1/office/appearance` (all). Optimistic concurrency: world has `rev`; `PUT` with stale `rev` -> 409 with the current world. All writes audited via the existing audit helper. Pydantic 2.7 models only; no new dependencies.
**Acceptance**: `cd backend/python; ..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider tests/test_office_world.py` -> passed (>= 8 tests incl. 409 and 4 KB limit). Do not run the whole backend suite if another model has it broken; report instead.

## V3-A4 Typed event bus, debug hooks, perf harness (S)
**Goal**: observability for every later phase.
**Create**: perf sampler in `engine/renderer.ts` (fps median, p95 frame ms, draw calls, triangles, actor count, JS heap if available) publishing `perf.sample` each second; `window.__office3Stats` stays; `tests/office3.spec.ts` gets helper `measure(seconds)`; new e2e test `[V3] perf gate` asserting the budget in section 2 using `?bots=60&wander=1`.
**Acceptance**: the perf gate passes at quality "high" (add `quality` param now, only "high" exists).

---

# PHASE B - Camera, view and rendering controls

## V3-B1 CameraRig3D: orbit, rotate, tilt, zoom, pan, follow, focus (L)
**Goal**: full control of the view, including **rotating the screen**.
**Read**: DeskRPG `src/game/three/meeting-camera.ts`, WA `Game/CameraManager.ts`, current `OrbitControls` use in `office3.ts`.
**Create**: `engine/cameraRig.ts`, `core/cameraMath.ts` (pure: snap angles, clamp tilt, fit-room distance, easing) + test.
**Spec**: controls: left-drag pan on the ground plane (screen-space to world, not target drift), right-drag orbit, wheel zoom to cursor, middle-drag tilt only. Keyboard (when the canvas has focus only): `Q`/`E` rotate 90 degrees with 350 ms ease (snap), `Shift+Q/E` 15 degree steps, `R` reset, `F` follow selected/founder toggle, `1`-`9` focus the n-th focusable room (fit to room with margin = WA `zoomMargin`), `Home` founder, `T` cycle presets: **Isometric** (tilt 55, yaw 45, FOV 30), **Top-down** (tilt 90), **Cinematic** (tilt 25, FOV 45, slow drift), **Eye-level** (follow selected at 1.6 m, FOV 60). Limits: distance 6..110, tilt 12..90 degrees, never below floor, pan limited to world bounds + 10%. Smooth damping 0.12; `prefers-reduced-motion` disables drift and eases. Camera state persisted in `localStorage["office3.camera"]` and restored.
**Bus**: `camera.change` throttled to 10 Hz.
**Acceptance**: unit: `node --test tests/office3.cameraMath.test.mjs` (snap to nearest 90 from any yaw, clamp tilt, fit-room distance for 3 room sizes). e2e `[V3] camera`: press `E` four times -> yaw returns within 1 degree; `T` cycles four presets with distinct tilt values; wheel keeps distance in range; `Home` centres on founder. Screenshot `v3-camera-iso.png`, `v3-camera-top.png`.

## V3-B2 Wall occlusion and cutaway (M)
**Goal**: walls never hide the action (DeskRPG meeting-room behaviour).
**Read**: DeskRPG `meeting-wall-occlusion.ts`, `meeting-architecture-walls`.
**Create**: `engine/wallOcclusion.ts`, `core/occlusion.ts` (pure: which wall segments lie between camera and target rect) + test.
**Spec**: modes (setting): **Auto** (fade walls that are between the camera and the selected/followed actor or the focused room, opacity 0.12, 200 ms), **Cutaway** (all walls lowered to 0.5 m, window and door frames kept), **Full** (always full height). Instanced walls get per-instance opacity via a custom shader attribute (no per-wall material). Transparent walls do not write depth; sort after floor. Doors keep frames visible.
**Acceptance**: unit tests for the pure selection (camera at four yaws, wall segments in/out); e2e: select an actor in a walled room, rotate with `E`, screenshot proves no wall hides it; perf gate still passes.

## V3-B3 LightingRig, day/night, per-room light (M)
**Goal**: warm, readable lighting like DeskRPG environments.
**Read**: DeskRPG `office-lighting.ts`, `office-environment-theme.ts`, `executive-surfaces.ts`.
**Create**: `engine/lighting.ts`, `core/dayclock.ts` (pure: time -> sun angle/colour/intensity, sky colour) + test.
**Spec**: hemisphere + one directional sun, soft shadows only for the focused room (shadow map 1024, camera frustum fitted to room) on quality "high"; room lights (point lights **limited to 6 active**, nearest to camera, others emissive decals); modes `Auto (real clock)`, `Day`, `Dusk`, `Night`, `Incident` (red pulse used by H3). Windows glow at night. Setting persisted.
**Acceptance**: pure tests for dayclock; e2e screenshots day/night; perf gate >= budget (shadows only on focused room).

## V3-B4 View settings modal and minimap (M)
**Create**: `ui/ViewSettings.tsx`, `ui/Minimap3D.tsx`.
**Spec**: modal (opens from the action bar and `V`): quality (low/medium/high/auto), wall mode, lighting mode, labels (all / near / hover only / off), label size, bubbles on/off, camera presets default, reduce motion, show grid, show fps HUD, language. Reads/writes one `ViewSettings` object in `localStorage["office3.view"]` with defaults; changes apply live (no reload). Minimap: 3D-aware top-down canvas (static floor render baked once from `worldView`), actor dots coloured by state/role, camera cone showing yaw and FOV, room labels, click = focus, drag = move camera, hover shows name.
**Acceptance**: e2e changes quality and wall mode and asserts `__office3Debug.quality()` and wall opacity; minimap click moves camera.

---

# PHASE C - Movement and input

## V3-C1 Navigator: click-to-move, camera-relative WASD, steering (L)
**Read**: Office 2 `walker.ts`, `pathfind.ts`, WA `Utils/PathfindingManager.ts`, DeskRPG `gait.ts`.
**Create**: `core/navgrid.ts` (grid from world + dynamic blockers), `core/steering.ts` (pure: smooth path following, corner rounding, separation from neighbours) + tests, `systems/navigator.ts`.
**Spec**: left click on floor = walk (ray to floor plane, snap to tile); ignore clicks that were drags (> 5 px). WASD/arrows move **relative to the camera yaw** (so rotating the screen keeps controls natural), diagonal allowed with corner cutting rules. Speed: walk 2.6 tiles/s, run (Shift) 4.5 tiles/s, animation speed scales. Avoid other actors by soft separation (radius 0.45) and re-plan when blocked > 600 ms; never stack on one tile: arrival picks the nearest free tile (reuse `nearestFree`). Path smoothing (string pulling) so walks are not grid-jagged. Max simultaneous bot walkers 8 (queue, extends Office 2 limit 4). Walk target marker (ring decal) for the founder.
**Acceptance**: unit tests: string-pulling keeps endpoints and never crosses blocked cells, separation never produces NaN, camera-relative mapping at 8 yaws; e2e: click far tile -> founder arrives (position within 0.3), WASD after `E` moves along rotated axes, 60 wandering bots keep perf gate.

## V3-C2 Seats, sit and stand, facing (M)
**Read**: DeskRPG `desk-seats` (folder), `office-chair-v1.glb` fit code in `office3.ts`.
**Create**: `core/seats.ts` (seat assignment, ownership, facing), `systems/seatManager.ts`.
**Spec**: actors approaching a seat align to the seat anchor (position + yaw), blend `walk -> sit` (0.25 s), stand up on leave (`sit -> idle`). Chair prefab rotates to face the desk and slides back 0.15 m when occupied. Seat ownership (`Desk.owner`) shown on hover and enforced for humans (agents may use any free seat when theirs is taken). Sofas, armchairs and meeting chairs are seats with `kind: "lounge"|"meeting"` and different sit poses (fallback: same pose, lower hips by 0.08).
**Acceptance**: unit tests for assignment (owner first, then free in room, then overflow) and facing from desk position; e2e: agents at desks are in `sit` anim with chair rotated toward desk (read from debug hook).

## V3-C3 Emotes, status, quick actions (S-M)
**Read**: WA `Components/EmoteMenu`, `Game/EmoteManager.ts`, status stores.
**Create**: `ui/EmoteWheel.tsx`, `engine/labels.ts` emote billboard, `core/emotes.ts` (id -> icon, animation, duration, cooldown).
**Spec**: emotes: wave, thumbs-up, clap, laugh, question, heart, coffee, thinking, sleep (9 + custom slot). Hotkeys `1`-`9` while holding `Alt`, or radial wheel on `B`. Plays gesture animation if the model has the clip (fallback: bounce) + floating icon above the head 2.5 s, visible to all. Status (`online/away/busy/dnd/focus`) changes the ring and badge; `away` automatic after 5 min idle (reuse Office 2 presence); `dnd`/`focus` suppress incoming call-overs and conversation joins (rules in F2). Agents emit emotes from the director (`done` -> clap, `error` -> sweat/question).
**Acceptance**: unit tests (cooldown, status effects); e2e: trigger emote, bubble present in `__office3Debug`, expires.

---

# PHASE D - Characters: look, customisation, motion

## V3-D1 Look catalogue and gallery (M)
**Read**: DeskRPG `OfficeLookGallery.tsx`, `office-environment-thumbnails.json`, `public/assets/characters/office/*.glb`, `src/game/three/office-look-asset*`.
**Create**: `scripts/office3_build_looks.mjs` -> `app/public/office3/looks/index.json` (id, file, gender tag, bodyType, palette regions, thumbnail), thumbnails PNG (render each GLB offscreen with three in the browser once via a hidden page `#office3?thumbs=1` and save with the Playwright helper), `ui/LookGallery.tsx`.
**Spec**: gallery grid 5x10 with search/filter (body type, style, "recently used"), hover = turntable on the thumbnail, click = apply to preview, double click = apply and close. Keyboard navigable.
**Acceptance**: index lists 50 looks with thumbnails; e2e opens gallery, picks look 7, `__office3Debug.actors()` reflects the new look id for that person.

## V3-D2 Appearance editor with colour regions, parts and live 3D preview (L)
**Read**: DeskRPG `CharacterPreview.tsx`, `CharacterModelView.tsx`, `office-appearance.ts`; WA customisation layers; section 3.2.
**Create**: `core/appearance.ts` (+ test: defaults, validation, size limit, serialise), `engine/actors.ts` region tint (shader `onBeforeCompile` adds `uniform vec3 uTint[6]` indexed by the `region` vertex attribute), `engine/attachments.ts` (hats, glasses, badge as small GLB or procedural meshes parented to head/chest bone anchors), `ui/AppearanceEditor.tsx` with its own mini three canvas (turntable, orbit, zoom).
**Spec**: tabs **Look** (gallery), **Colours** (skin, hair, top, bottom, shoes: swatches + HSL picker + "match crew colour" toggle), **Parts** (hat, glasses, hair style where the model supports swapping, badge), **Body** (body type, scale 0.85-1.15, height variance per person), **Name** (display name, title, badge style), **Voice** (TTS voice picker reusing the existing voice list), **Randomise**, **Reset**, **Copy from another person**. Live preview updates in < 100 ms. Save writes through `PUT /api/v1/office/appearance/{slug}`; the world updates immediately for the owner and via bus for others. Agents are editable by founder/admin; humans edit themselves.
**Quality**: tinted clones share geometry and the material is shared per (look, tint-hash) to preserve the draw-call budget; cap 40 distinct tint materials, beyond that quantise tints to a 12-step palette.
**Acceptance**: pure tests; e2e: change top colour to red -> actor material uniform equals the colour (debug hook returns tint), reload page, appearance persists from backend; perf gate holds with 60 distinct tints.

## V3-D3 Custom model import (L)
**Spec**: drag a `.glb` onto the editor: validate (size <= 8 MB, <= 20k triangles, has skeleton + clips named idle/walk/sit or map clips by a dialog), auto-scale to the standard height (from skeleton, section A1 lesson), auto-merge meshes with vertex colours, assign regions by colour clustering (user can adjust in a small paint tool: click a part, choose region), store under `storage/office/models/<hash>.glb` via `POST /api/v1/office/models` (size and type checked server-side, no path traversal, content-type verified by magic bytes), add to the catalogue as "Custom". Failure modes shown in the dialog (never silent).
**Acceptance**: backend tests for rejects (oversize, wrong magic, traversal name); e2e imports a small fixture GLB and spawns it.

## V3-D4 Motion polish (M)
**Read**: DeskRPG `gait.ts`, `idle-motion.ts`, `gltf-gestures.ts`, `miniature-actor.ts`.
**Create**: `engine/motion.ts` + `core/motionRules.ts` (pure: pick idle variation by seed, gait speed scaling, blend times) + test.
**Spec**: idle micro-motions (weight shift, look around, stretch) at random 4-9 s with per-actor seed; typing animation at desks when state is `working`, reading pose when `planning`, hand-raise when `waiting_human`, pacing when `waiting_tool`; gait cycle speed matches movement speed (no foot sliding), turn-in-place before walking when the target is > 60 degrees away; head look-at toward the conversation partner or the camera target when selected; blend graph with 0.2 s cross-fades and priority (gesture > locomotion > idle). Animation LOD: actors beyond 45 units or outside the frustum update at 10 Hz or not at all.
**Acceptance**: unit tests for rules; e2e screenshot sequence shows distinct poses for `working` vs `planning`; perf gate holds.

## V3-D5 Name plates, role badges, labels that never overlap (S-M)
**Read**: DeskRPG `label-layout.ts`; Office 2 `nameTags.ts` and its tests (already verified, copy and adapt to screen space).
**Spec**: plates are screen-space sprites (constant pixel size), priority order founder > selected/hovered > attention > conversation members > others; `layoutTags` runs on projected positions at 5 Hz; levels of detail: far = coloured dot only, mid = first name, near = name + role + status icon; bubble above the plate; leader line when moved > 6 px; optional role colour band. Settings from V3-B4.
**Acceptance**: 120 crowded actors: no two visible plates intersect (assert from debug hook), plate count by LOD matches distance.

---

# PHASE E - Selection, right-click menus, shortcuts

## V3-E1 Picking, hover outline, selection, box-select (M)
**Read**: DeskRPG `furniture-highlight.ts`; three.js `Raycaster`, `OutlinePass` (examples) or a cheap inverted-hull shell.
**Create**: `engine/picking.ts`, `core/selection.ts` (pure set operations, modifiers) + test, `ui/SelectionBar.tsx`.
**Spec**: GPU-cheap picking: raycast against actor capsules (not skinned meshes) and object bounding boxes; hover shows outline + tooltip (name/role/state); click selects, `Ctrl/Shift` toggles, drag with `Shift` draws a box (screen rectangle -> selection of actors/objects inside), `Esc` clears, `Ctrl+A` selects all actors in the current room. Selection bar (bottom) shows count, quick actions (send to room, broadcast message, set emote, pause agents) for agents and move/rotate/delete for objects in edit mode.
**Acceptance**: pure tests for selection operations; e2e: box-select a room -> count equals actors in that room per debug hook; hover outline present only for hovered target.

## V3-E2 Context menu system with an action registry (L)
**Goal**: right-click options on characters, objects, rooms and floor, extensible.
**Read**: WA `Components/ActionsMenu/WokaMenu.svelte`, `ExplorerMenu.svelte`, `VisitCard`, `FollowMenu`, `Moderation`.
**Create**: `core/actions.ts` (pure registry: `{id,label,icon,targets,when(ctx),permission,run(ctx)}` + resolver by target type, role and state) + test, `ui/ContextMenu.tsx` (portal, keyboard nav, submenus, never off-screen, closes on Esc/blur/scroll/camera drag).
**Menu contents (registry entries)**:
- **Person (agent)**: View card, Chat (deep link to Team Chat), Mention in chat, Call over, Go to (walk next to them), Follow / Stop following, Look at (camera focus), Watch (camera follow), Wave / Emote > (submenu), Assign task... (opens a small task form posting to the existing chat/dispatch endpoint), Pause / Resume agent, Show activity (recent tool calls from `/comms`), Edit appearance, Edit profile (reuse Office 2 `EditDialog` logic), Set status/mood note, Copy slug, Disable (confirm).
- **Person (human)**: View visit card (name, role, status, bio, timezone), Message (private chat), Invite to conversation, Follow, Go to, Wave, Mute/Unmute (permission), Report... (permission: all, sends to admin), Promote/Demote (admin only), Kick (admin only).
- **Self**: Status >, Emote >, Appearance, Sit/Stand, Teleport to room >, Copy location link, Leave (go to spawn).
- **Object**: Use (if interactable, shows what it does), Inspect (properties), in edit mode: Move, Rotate 90, Duplicate, Delete, Properties, Lock.
- **Room/zone**: Focus camera, Rules (view), Invite everyone here, Start meeting here (H3), in edit mode: Edit room, Rename, Change floor, Delete.
- **Floor**: Walk here, Place marker/waypoint, Add object here (edit mode), Ping location (everyone sees a ripple).
**Spec**: actions are data; `run(ctx)` calls bus events or services, never touches three directly. Permissions come from `core/presence.ts`. Each entry has an automated visibility test.
**Acceptance**: unit tests: resolver returns the exact id list for (target x role x state) fixtures (>= 20 cases); e2e: right-click an agent -> menu visible with "View card", choose Chat -> hash `team_chat` and DM open; right-click floor -> "Walk here" moves founder.

## V3-E3 Keyboard shortcuts, command palette, help overlay (S-M)
**Create**: `core/shortcuts.ts` (pure map + conflict check + test), `ui/CommandPalette.tsx` (`Ctrl+K` inside the office: search people, rooms, actions, "go to X", "focus X", "call X"), `ui/HelpOverlay.tsx` (`?`).
**Spec**: shortcuts are rebindable (stored in settings), listed with the actions registry so the help overlay is generated; typing in inputs never triggers shortcuts (focus guard).
**Acceptance**: pure tests for conflicts; e2e: palette finds "forge", Enter walks camera to them.

---

# PHASE F - Interactions between characters (and with the world)

Design rule: every behaviour below is an entry in the interaction registry (3.5) with tests; the director only schedules and the interactor executes.

## V3-F1 Proximity conversations (WorkAdventure bubbles, 3D) (L)
**Read**: Office 2 `proximity.ts` + tests (reuse), WA `Entity/ConversationBubble.ts`, back `Model/Group.ts` (enter 64 px, group radius 48 px).
**Create**: `core/conversations.ts` (wraps `createProximity` with: lock, capacity 8, silent zones, dnd/focus exclusion, role rules; emits join/leave/merge/split) + test, `engine/fx.ts` bubble halo (soft translucent dome under the group + link lines), `systems/interactor.ts`.
**Spec (what happens when two characters meet)**:
1. **Approach**: two actors standing still within 2.0 tiles form a group (hysteresis 2.0 / 3.0). Walking actors never start a group, they may join on arrival. Silent zones and dnd/focus actors never join.
2. **Greeting sequence** (first join only, cooldown 10 min per pair): both turn toward each other (0.4 s), the one who arrived second waves, the other nods, optional emote; agents also say a short greeting bubble only if the pair has not spoken today (from `/comms` last message time).
3. **Conversation state**: group shows halo and a floating "..." when someone is typing/streaming (agent `thinking` state or human typing); members keep facing the group centroid (look-at), slight idle sway; the group can be **locked** by any human member (padlock icon; others cannot join; right-click > Lock/Unlock) or auto-locked for private rooms.
4. **Chat entry point**: the HUD chip "Talk to X" (exists in Office 2) opens Team Chat DM; for groups, "Talk to X, Y +N" opens the first member and prefills mentions. Agent-agent groups show **live transcript bubbles** pulled from `/comms/thread` (last 2 messages, 40 chars, auto-hide) so you can watch agents talking.
5. **Leave**: distance > 3.0 or a member starts walking away > 2 tiles: goodbye gesture (wave) if the conversation lasted > 20 s; halo shrinks and disappears; group dissolves when < 2 members.
**Acceptance**: pure tests for lock, capacity, silent, dnd exclusion, merge/split, greeting cooldown; e2e: walk founder next to a bot -> group event + chip; wave animation observed (debug anim name); walk away -> leave.

## V3-F2 Follow, Call over, Invite, Meet-me (M)
**Read**: WA `FollowManager.ts`, `Components/FollowMenu`, `MeetingInvitation`; DeskRPG "Call Them / walk to report" flow, `NpcDialog.tsx`.
**Spec**:
- **Follow**: request -> target accepts (humans: toast with Accept/Decline; agents: auto-accept unless `busy`) -> follower keeps 1.2 tiles behind, mirrors speed, stops on arrival or `Esc`; chain follow allowed up to 5; breaking the chain on blocked path with a toast.
- **Call over** (founder -> agent): agent finishes the current step (1-3 s), walks to within 1.5 tiles, faces the caller, raises a hand, a **report bubble** shows its latest task summary (from backend activity), then asks "Anything else?" with quick buttons (Chat, Assign, Dismiss). Dismiss -> agent returns to where it came from. Timeout 60 s.
- **Invite to conversation / meeting**: invitees get a toast and a pulsing ring; accepting walks them to the inviter's group.
- **Meet me at <room>**: broadcasts a destination; each invitee chooses accept/decline; agents follow the director rules (state `busy` declines with a reason bubble).
- dnd/focus statuses auto-decline with a small "busy" icon.
**Acceptance**: pure tests for the state machines (follow, call-over, invite) with fake clocks; e2e: call over an agent -> `call.arrive` observed within 40 s and report bubble present; dismiss -> agent returns to its prior tile.

## V3-F3 Zone rules engine (silent, restricted, capacity, tooltip, broadcast) (M)
**Read**: WA `libs/map-editor/src/types.ts` (Silent, Focusable, Tooltip, MaxUsersInArea, Lockable, RestrictedRights, SpeakerMegaphone, ListenerMegaphone, PlayAudio, OpenWebsite).
**Create**: `core/zoneRules.ts` (pure: evaluate rules for an actor entering/leaving a room, returns effects) + test, `systems/zones.ts`.
**Spec**: effects: block entry (restricted by role, capacity reached -> actor waits outside, bubble "Room full", humans get a toast), silent (no conversation joins, UI shows 🔇 badge), tooltip on entry (3 s), ambience change, **speaker/listener (megaphone)**: a speaker area broadcasts the speaker's text bubbles/announcement to all listener rooms (agent announcements: "Stand-up in 5 minutes"), open-website/embedded dashboard panel (opens an in-app panel, allow-listed origins only), lockable area (human can lock a meeting room: door shows red, others cannot enter).
**Acceptance**: pure tests per rule (>= 15 cases); e2e: enter a restricted room as `intern` fixture (use debug role override) -> blocked with toast.

## V3-F4 Object interactions (M)
**Create**: catalogue of `Interactable`s in `core/interactions.ts`: **coffee machine** (walk, 3 s drink anim, steam fx, optional mood +), **printer** (paper fx when an agent runs a file tool), **whiteboard / task board** (shows real tasks, H1), **vending machine**, **water cooler** (spawns a social conversation spot), **sofa** (sit), **server rack** (blinking LEDs faster when `/ws` load high, lights red on `error`), **phone booth** (private conversation, auto-lock), **reception desk** (greets new humans, H4 onboarding).
**Spec**: each has `approach` point, `use` sequence, cooldown, who may use it (agents by state: idle agents wander to coffee/cooler with probability by schedule), effect. Hover tooltip "Use (E)". `E` key near an object uses it. Animations via procedural gestures when no clip exists (hand to mouth, typing). Effects via `fx.ts` particles with an upper bound of 150 live particles.
**Acceptance**: pure tests for the resolver (who can use what, cooldown); e2e: select founder, press `E` near a coffee machine -> `interaction.done` event.

## V3-F5 Agent-to-agent life (M)
**Read**: `backend/python/api/routes` comms (`/comms/threads`, `/comms/thread`), `agents/comms.py`, `docs/` for message kinds (ask, reply, tool, result, message, conclusion).
**Spec**: when a comms message goes from agent A to agent B: A walks to B (or both meet halfway if B is at a desk and idle), face-to-face, A's bubble shows the `ask` (40 chars), B replies with its bubble; a thin animated line connects A and B while the thread is active; when the thread has a `conclusion` they part ways. Rate limit: max 4 simultaneous agent-agent meetings; others queue as a small "waiting" badge. All driven by polling `/comms/threads` every 3 s (existing endpoint) and a `since_id` for the open thread. Click the line to open the thread viewer panel.
**Acceptance**: pure test: planner picks meeting spot and respects the cap; e2e with mocked comms response (route interception) -> two actors end within 2 tiles and bubble text matches.

---

# PHASE J - Application shell (minimum for V3.0; the rest in section 8)

## V3-J1 Action bar, roster drawer, toasts, onboarding (M)
**Read**: WA `Components/ActionBar`, `Toasts`, `Onboarding`, `ProximityNotification`.
**Create**: `ui/ActionBar.tsx` (bottom centre: Emotes, Status, Appearance, Roster, Chat, Edit mode (permission), Camera presets, View settings, Help), `ui/Roster.tsx` (left drawer: searchable list of everyone, grouped by room or crew, status dots, "go to / follow / call" buttons, filters: agents / humans / needs attention), `ui/Toasts.tsx` (stack, actions, auto-dismiss, aria-live), `ui/Onboarding.tsx` (first-run 5-step tour: move, rotate, right-click, emote, find someone; skipped flag in settings).
**Acceptance**: e2e: open roster, search "forge", click go-to -> camera focuses; tour shows once; a11y: all controls reachable by Tab with visible focus.

---

# PHASE G - World builder (WorkAdventure map editor x DeskRPG environments)

Edit mode is a **mode of the same scene**, not a separate app: `Tab` or the action bar toggles it (permission `world.edit`). Everything is a command on the command stack (undo/redo) and saved through `PUT /api/v1/office/world` with `rev` concurrency.

## V3-G1 Prefab catalogue and asset pipeline (L)
**Read**: DeskRPG `src/game/three/furniture-asset*`, `office-footprint.ts`, `public/assets/shared/**/README.md` + `build-report.json`, WA `EntitiesCollectionsManager.ts`.
**Create**: `scripts/office3_build_catalog.mjs` -> `app/public/office3/catalog.json` + normalised GLBs; `core/catalog.ts` (+ test); `engine/prefabs.ts` upgrades.
**Spec**: prefab record `{id, name, category, tags[], file, footprint:[w,d], height, anchor:[x,y,z], rotSteps:4, snap:"grid|wall|free", blocks:true|false, seats:[{pos,facing}], interact:[{id,approach,facing}], lights:[...], colourRegions?:[..], cost?:0}`. Pipeline: load GLB -> measure bbox -> normalise scale to real-world metres (a desk 1.5 m) -> compute footprint on the grid -> detect seat/interaction anchors from node names (`seat_*`, `use_*`) or manual JSON overrides -> write catalogue. Categories: Workstations, Seating, Tables, Meeting, Storage, Tech (server rack, bench, phone booth, beanbag), Lounge (sofas, armchairs, rugs), Plants and landscape, Decor, Architecture (walls, glass partitions, doors, windows, floors from DeskRPG `architecture/`), Appliances (coffee machine, printer, vending, water cooler: add procedural placeholders if no GLB), Screens (whiteboard, TV, kanban board). Missing categories are generated procedurally (box + material) with `placeholder:true` so the builder is complete from day one.
**Acceptance**: pure tests (footprint math, rotation of footprints, anchor parsing, schema); catalogue contains >= 60 prefabs with >= 8 categories; every prefab loads in a hidden test page without console errors.

## V3-G2 Builder shell: tools, grid, selection, undo/redo (L)
**Read**: WA `Phaser/Game/MapEditor/Tools/*` (Area, Entity, Floor, Trash, WAMSettings, Explorer) and `MapEditorModeManager.ts`, `libs/map-editor/src/Commands`.
**Create**: `core/commands.ts` (pure command stack: do/undo/redo, merge of consecutive moves, max 200, serialisable) + tests, `engine/builderOverlay.ts` (grid, ghost, handles, snapping guides, collision tint red/green), `ui/BuilderPanel.tsx` (tool palette), `ui/Inspector.tsx`.
**Tools** (hotkeys): **Select/Move** (V), **Object** (O: pick from catalogue, ghost follows cursor, `R` rotates 90 degrees, click places, `Shift` keeps placing), **Room** (W: drag a rectangle -> room with walls, choose door positions by clicking wall segments, name, kind), **Wall** (L: draw wall segments, doors, windows, glass partitions), **Floor** (F: paint rectangle or brush with material + tint), **Zone** (Z: rectangle with rules = WA areas), **Spot/Seat** (S), **Erase** (Del/X), **Measure** (M), **Explorer** (E: WA explorer, free fly camera + list of rooms), **Settings** (world name, size, theme, lighting, spawn). Cursor shows grid coordinates; snapping: grid 1.0 (hold `Alt` for 0.25), wall-snap for wall-mounted prefabs, align guides to neighbours.
**Inspector** (right drawer): object properties (position, rotation, scale, colour tint where supported, label, owner, locked), room properties (section 3.1 rules), multi-select edits.
**Rules**: never allow a command that makes any seat/spot unreachable (validator runs after each command; offending command shows an error toast and is reverted); objects cannot overlap blocking footprints; the founder spawn cannot be deleted.
**Acceptance**: pure tests: undo/redo round trip over 50 random commands equals the original world, merge of drag moves, validator blocks an unreachable seat; e2e `[V3] builder`: enter edit mode, place a plant, undo, redo, delete, exit; world `rev` increments only on Save.

## V3-G3 Rooms, walls, doors, windows, floors in depth (M)
**Spec**: wall styles (plaster, brick, glass, half-wall), thickness 0.2, height presets, doors (open gap, glass door, double door, locked door with role rule) with swing or slide animation and **auto-open when an actor approaches**; windows with sky/night glow; floor materials with PBR-lite parameters (roughness, tile pattern texture generated by canvas as in the spike) and per-room tint; room templates from DeskRPG layout modules (executive room, creative studio, lounge, meeting room 8/12, open space N desks, server room, phone booth, kitchenette) inserted as a group with a parametric size; "Auto-furnish" button: fills a room by template then the user adjusts.
**Acceptance**: pure tests for wall/door geometry (door width 2, wall splitting), template instantiation counts; e2e: insert "Meeting room 8" template -> 8 seats exist and are reachable.

## V3-G4 Themes and environments (M)
**Read**: DeskRPG `office-environments.ts`, `office-environment-theme.ts`, `office-finishes.ts`, `OfficeEnvironmentPicker.tsx`, `office-environment-thumbnails.json`.
**Create**: `core/themes.ts` (pure: theme = floor/wall palettes, lighting preset, prop set weights, sky, ambience) + test, `ui/ThemePicker.tsx` (cards with thumbnails rendered from the scene).
**Presets**: Trading company, Agency, Tech startup (default), Executive suite, Publisher, plus "Night owl" and "Blueprint" (wireframe). Switching a theme re-skins materials and lights without moving objects; optional "restyle objects" swaps prefab variants by tag.
**Acceptance**: pure tests: every theme has all palette keys; e2e: switch theme -> screenshot differs (pixel hash) and world layout unchanged.

## V3-G5 Zones, spawn points, personal desks, markers (M)
**Spec**: zone tool with WA-compatible property types (silent, focusable + zoom margin, tooltip, max users, lockable, restricted roles, speaker, listener, play ambience, open panel/website allow-list, highlight when someone is inside); desk claim (personal area): a human claims a free desk (name plate on desk, their avatar sits there by default); agent desks stay as seats; spawn points per role; waypoint markers for tours; pings. Zone overlay (toggle) tints and labels rooms by kind.
**Acceptance**: pure tests for property schema and claim rules (one desk per person, release on leave).

## V3-G6 Save, versions, import/export, multi-world (M)
**Spec**: autosave draft to `localStorage`, explicit **Save** publishes (409 handling with a diff dialog: "reload theirs / overwrite mine"), version history (last 20 snapshots, restore), export/import JSON (schema validated, size <= 2 MB), clone world, multiple worlds (e.g. "HQ", "Lab") with a world switcher; **Reset to default** keeps a backup snapshot first.
**Acceptance**: backend + pure tests; e2e: save -> reload -> same objects; restore a snapshot.

---

# PHASE H - Agent life: work layer (DeskRPG office life on our backend)

## V3-H1 Task board, cards over heads, activity feed (L)
**Read**: DeskRPG `components/kanban/*`, `office-kanban.ts`; backend endpoints for tasks/dispatch (grep `task-dispatcher`, `/api/v1/` routes for tasks, features, `feature_flow`), `/ws/rpc` topics (`agent-state-change`, `execution-log`, `diff-stream`).
**Spec**: wall **task board** prop (in-world) shows columns Planned / Doing / Review / Done with the real tasks (cards read from the backend; if no task API exists, create `GET /api/v1/office/tasks` that aggregates dispatch + feature_flow state); clicking opens the full board modal (drag cards between columns -> backend). Over an agent's head a small **task chip** shows the current task title (40 chars) and a progress arc when known; hover shows details. Right-side **Activity feed** drawer streams `execution-log` and state changes ("Forge started testing"), filter by agent/room, click = focus camera on the actor.
**Acceptance**: e2e with intercepted API: card appears on the board and chip over the assignee; feed shows demo events from `POST /ws/demo`.

## V3-H2 Approvals and attention inbox in the world (M)
**Read**: `/approvals`, `human-intervention-request` topic, DeskRPG `components/approvals`, `attention`.
**Spec**: agent in `waiting_human`/`escalated` raises a hand (animation + exclamation icon), walks to the founder's room doorway spot (exists in Office 2 rules) and waits; click the icon or the agent -> approval card (tier chip, action, summary, UNTRUSTED CONTENT amber warning as in the mobile spec) with Approve/Deny calling the existing endpoint; Tier >= 3 requires re-auth (typed confirmation); resolved -> agent returns to work with a thumbs-up emote. Attention inbox drawer lists pending items with count badge on the action bar.
**Acceptance**: e2e: create approval via API test helper -> hand raised within 3 s -> approve -> agent returns.

## V3-H3 Director: schedules, stand-ups, incidents, meeting mode (L)
**Read**: DeskRPG `components/cron`, `MeetingRoom.tsx`, `meeting-camera.ts`, `meeting-wall-occlusion.ts`, `MinutesModal.tsx`; `core/schedule.ts` (new).
**Create**: `core/schedule.ts` (pure rules + test), `systems/director.ts` extensions, `engine/meetingCamera.ts`, `ui/MinutesDrawer.tsx`.
**Spec**:
- **Schedule** (editable list in settings): 09:30 stand-up (all `work` agents with state idle/working walk to the meeting room, sit; others stay), 12:00-13:00 lunch (idle agents to lounge), 18:00 desks empty (agents stand idle at desks, lights dim), cron jobs from the backend appear as calendar entries; any entry can be "Run now". Rules never move an agent that is mid-task with a human waiting.
- **Meeting mode** (DeskRPG): when >= 3 actors are seated in a meeting room: camera frames the room (`MeetingDirector`), walls between camera and room fade, camera cuts to the **current speaker** (from live bubbles) with dwell 2.5 s min and hold 1.5 s after speech (the two settings are in the view settings, as in DeskRPG `ViewSettingsModal`), speaker gets a highlight ring and a floating "speaking" icon, hand-raise queue order shown; framing options: wide / speaker / auto.
- **Minutes**: when a meeting ends, a drawer lists participants, duration, the transcript bubbles captured and agent conclusions; saved via `POST /api/v1/office/minutes` (new, small) and linked from the room.
- **Incident mode**: if an SLO breaches or an agent chain errors (backend `/status` or `error` bursts), lights pulse red, alarm icon on the server room, relevant agents move to the tools lab, banner "Incident: ..."; clears when green.
**Acceptance**: pure tests for schedule resolution with fake time zones/DST; e2e with a fake clock query param (`?now=09:29`) -> stand-up gathers agents; meeting camera test asserts camera target equals speaker position within tolerance.

## V3-H4 Moods, ranks and cosmetics for agents (S-M)
**Spec**: mood from recent outcomes (thumbs, errors, workload) shown as a small face above the plate and posture (slump/upright); lifecycle (probation -> active -> senior) adds visual rank (lanyard colour, desk plant); birthdays (bot `created_at` anniversaries) trigger confetti once a year. All optional, toggle in settings.

---

# PHASE I - Humans in the office (employees, interns, guests) and multi-user

Today there is one human (the founder) and no server-side presence. This phase makes the office **multi-user safe** without changing the single-user experience.

## V3-I1 Identity, roles and the permission matrix (M)
**Read**: `backend/python/core/directory.py` (humans list), WA `RestrictedRightsPropertyData`, DeskRPG role-based access docs; mobile pairing code (`api/routes/remote.py`) as the existing device-auth pattern.
**Create**: `core/presence.ts` (matrix, section 3.3) + test, backend `api/routes/people.py`: `POST /api/v1/people` (admin creates employee/intern/guest with role, display name, email optional), `POST /people/{id}/invite` (one-time code like pairing, 24 h), `POST /auth/login` (local PIN or password hash with argon2/bcrypt already in repo deps; if none, use `hashlib.scrypt` from stdlib), JWT-like short-lived tokens signed with the existing server secret, `GET /people`, `PUT /people/{id}/role`, `DELETE /people/{id}` (disable), audit rows for all of these.
**Rules**: the founder account is created from the existing `FOUNDER` directory entry and cannot be removed or demoted; role changes need admin; all permission checks server-side (the client matrix is only for UI).
**Acceptance**: backend tests: matrix per endpoint (>= 25 cases), invite single-use and expiry, role escalation attempts rejected, rate limit on login (5/min); pure tests mirror the matrix.

## V3-I2 Office server: presence, position sync, interest management (L)
**Read**: WA `back/src/Model/GameRoom.ts`, `Zone.ts`, `PositionNotifier.ts`, `Group.ts`; our `rpc.py` websocket pattern.
**Create**: `backend/python/api/routes/office_ws.py` (`/ws/office`), `systems/sync.ts` (client), `core/netcodec.ts` (pure: compact messages + test).
**Protocol** (JSON first, binary later if needed): client -> `hello{token, appearance}`, `move{x,z,facing,anim,seq}` at 10 Hz while moving, `status`, `emote`, `say{text}`, `interact{id}`, `zone.enter/leave` (server also derives it); server -> `welcome{self, world.rev, roster}`, `join/leave`, `pos{id,x,z,f,a,seq}` batched at 10 Hz per interest cell (grid 16x16 tiles, send neighbours only), `status`, `emote`, `conv.*`, `world.change{rev}`, `error{code}`.
**Authority**: server validates speed (<= 6 tiles/s), walls (reuses `navgrid` rules ported to Python or runs the same JS rules? decision: port the small grid check to Python, tested against shared fixtures), room access by role, rate limits (30 msgs/s), size limits. Agents are server-side actors driven by existing bot state: the office server publishes agent positions computed by the **director running on the server** (single source of truth) so that every client sees the same agent behaviour (V3.3 moves `director` logic to a shared pure module; clients run it for single-user fallback only).
**Client**: local prediction for self, snapshot interpolation (100 ms buffer) for others, reconnect with resume, offline mode = current single-user behaviour.
**Acceptance**: backend tests with two fake clients (join, move batching by interest, speed cheat rejected, wall cheat rejected, role gate); e2e with two browser contexts (second a plain Chromium page against the dev server) sees the first move.

## V3-I3 Human avatars, status and visit cards (M)
**Spec**: humans use the same appearance system (D2), name plate with role badge colour (employee blue, intern green, guest grey, admin purple, founder gold), status ring (online/away/busy/dnd/focus), **visit card** (name, role, title, bio 160 chars, timezone, local time, "working on", links) editable by the owner, privacy: bio and timezone optional. Presence rules: away after 5 min of no input, offline after 30 s without heartbeat (avatar fades and sits at their desk if claimed). Mentor pairing for interns (admin assigns a mentor; intern sees a dotted line and a "go to mentor" shortcut).
**Acceptance**: e2e two clients: status change visible on the other within 1 s; visit card opens from the right-click menu.

## V3-I4 Human-to-human and human-to-agent interaction (M)
**Spec (what happens when a real person meets someone)**:
- **Human meets human**: proximity group; greeting wave exchange; **private text chat** opens in a small docked bubble chat (messages stored server-side per conversation, retention 30 days, export by admin), typing indicator, delivery ticks; voice/video is a hook (`conv.media` capability flag, off).
- **Human meets agent**: same bubble; the human's message goes to the agent endpoint (existing chat stream) and the reply streams into the bubble; the agent's tools and approvals respect the **human's role** (an intern cannot trigger Tier >= 2 actions; the agent answers "I need approval from <founder>" and raises a hand to the founder instead).
- **Agent meets human arriving**: reception agent greets newcomers; onboarding tour offers to follow a mentor.
- **Human leaves a conversation**: summary toast "Chat saved".
- **DND / Focus**: others see a closed-door icon; `call over` and joins are declined automatically with a message.
**Acceptance**: backend tests for role-limited agent actions; e2e two clients chat in a bubble.

## V3-I5 Onboarding a new employee or intern (M)
**Spec**: admin creates the account (I1) -> invite code on screen/clipboard -> new person opens the invite link -> picks look (D1/D2) -> guided tour (move, rotate, right-click, find your desk) -> claims or is assigned a desk (G5) -> meets the reception agent and their mentor (scripted F2 sequence) -> checklist panel (read handbook, meet three agents, send first message). Interns get a visible "Intern" badge, a restricted action set, and a daily summary toast. Offboarding: admin disables -> avatar leaves through the door with a wave, desk released, data retained per policy.
**Acceptance**: e2e script runs the whole path with a fixture account.

## V3-I6 Moderation, privacy, safety, audit (M)
**Spec**: mute/unmute chat, kick, temporary room lock, report flow, block list per user; every admin action audited (existing audit helper); **no screen capture or content from private rooms** is ever sent to people without access (server-side filtering of bubbles and chats by room/role); rate limiting and message length caps; profanity filter off by default (hook only); data export/delete for a person (GDPR-style, local); logs contain no message bodies.
**Acceptance**: backend tests: privacy filter (non-member never receives private-room bubbles), kick revokes session, audit rows present.

## V3-I7 Collaborative world editing (S-M)
**Spec**: only roles with `world.edit` can enter edit mode; edit lock per room (one editor at a time, others see a lock chip), live cursors of editors, `world.change` pushes new `rev` and clients patch without reload (diff by object id), 409 flow from G6. Observers see changes appear with a quick sparkle.
**Acceptance**: backend test for lock/rev; e2e two clients: A places a plant, B sees it.

---

# PHASE K - Audio and ambience (optional, after V3.2)
**Spec**: footsteps (surface-dependent, volume by distance), room ambience crossfade by zone, UI sounds, door sounds, emote sounds, **TTS bubbles** (reuse the existing voice pipeline: speaking indicator + subtitles; only for the selected/near conversation), master and category volumes, mute on window blur. WebAudio positional with a cap of 8 voices. Assets: CC0 packs (log in `COPIED_FROM_WORKADVENTURE.md`).
**Acceptance**: unit tests for the mixer rules; e2e asserts no audio context errors and mute persistence.

# PHASE L - Performance tiers and scalability
**L1 Quality tiers** (M): `low` (no shadows, no MSAA, pixel ratio 1, labels dots only, anim 10 Hz beyond 20 units), `medium`, `high`, `auto` (adjusts from the rolling p95 frame time with hysteresis, never flaps more than once per 30 s). **L2 Instancing/LOD** (L): far actors (> 45 units) become instanced low-poly capsules with colour, medium range uses the merged mesh without attachments, near full detail; instanced plants/chairs/desks (`InstancedMesh` per prefab with per-instance tint); frustum + room culling; texture atlas for labels (one `CanvasTexture` page, sprites sample sub-rects) to cut 120 draw calls. **L3 Benchmark page** `#office3?bench=1` (port of DeskRPG `frame-benchmark.ts`): scripted camera path + 120 actors, outputs JSON (fps median/p95/p99, draw calls, tri count, heap) and a PNG; stored in `e2e/test-results/office3/bench-*.json` and compared to a committed baseline (+-15%).
**Targets**: 60 people >= 55 fps (high), 120 people >= 45 fps (medium), 200 people >= 30 fps (low) on this PC.

# PHASE M - Persistence and data hardening
Schema migrations for world/appearance/people tables (version column, forward-only migrations with tests), nightly snapshot of the world into the existing backup job, import validation, size limits, corrupted-world recovery (fallback to last good snapshot with a toast), localStorage quota guards, cleanup of orphaned custom models.

# PHASE N - Test strategy (what "done" means)
- **Unit (`node --test`)**: every `core/` module; target >= 90% of branches in schedule, zoneRules, actions resolver, conversations, commands, presence matrix.
- **Backend (`pytest`)**: office routes, people/auth, office_ws (two fake clients), privacy filter, migrations.
- **e2e (Playwright + Electron)**: one spec per phase named `office3.<phase>.spec.ts`, each with screenshots under `e2e/test-results/office3/`; a **smoke** tag (`@smoke`: mount, perf gate, context menu, builder place/undo) that runs in < 3 minutes.
- **Visual regression**: key screenshots hashed with a tolerance (blur then compare) to catch broken lighting/occlusion; baseline in `e2e/baselines/` updated only deliberately.
- **Perf gate**: part of smoke (section 2 budget).
- **Soak**: 30-minute run with 60 wandering bots: heap growth < 20 MB, no dropped websocket, fps stable.
- **Accessibility**: keyboard path for every menu, focus rings, aria-live toasts, reduced motion, colour-blind safe status icons (shape + colour).

# PHASE O - Rollout
1. Feature flag `office.default` = `office3` in settings, old panels stay reachable (Office 2 and the original) for one release.
2. Switch the left-rail "Virtual Office" icon to Office 3 after the founder says "approve office 3"; keep the other two under "Experimental".
3. Docs: update `README.md` (this folder) with controls cheat-sheet and admin guide; `PROGRESS.md` complete.
4. Rollback = flip the flag; no data migration is destructive.

---

# 8. Shell extras and cross-cutting prompts

| ID | Title | Spec summary | Effort |
|---|---|---|---|
| V3-J2 | Settings centre | one modal: Account, Appearance, View, Controls (rebind), Audio, Notifications, Language, Privacy, About; all settings typed in `core/settings.ts` with migration + test | M |
| V3-J3 | i18n | `t(key)` with `en` now and `ko`, `ja`, `zh` later (DeskRPG parity); keys in `ui/i18n/en.json`; ESLint-free check script that fails on hard-coded UI strings in `ui/` | M |
| V3-J4 | Toast and notification policy | priorities, dedupe, max 3 visible, do-not-disturb aware, desktop notification when window unfocused for approvals only | S |
| V3-J5 | Error and offline UX | WebGL unavailable fallback (DeskRPG `WebglUnavailable.tsx`: offer Office 2), context loss recovery, backend down banner, reconnect backoff | S |
| V3-J6 | Touch and trackpad | pinch zoom, two-finger rotate, long-press = right-click; no mobile layout yet | S |
| V3-J7 | Photo mode | hide UI, hide labels, free camera, save PNG to `Pictures`, optional transparent background | S |
| V3-J8 | Guided tours and tooltips | contextual tips per feature (first use), dismissed state persisted | S |

# 9. "What if a real person joins tomorrow" - end-to-end walkthrough (acceptance story)
1. Founder opens Settings > People > Add employee "Asha" (role employee), copies the invite code.
2. Asha opens Jazper (same machine or LAN, depending on the deployment decision below), enters the code, chooses a look in the gallery, tints the jacket, saves.
3. Asha appears at reception; the reception agent turns, waves and says hello; a toast offers the tour; she follows a mentor along a dotted path to her claimed desk and sits down.
4. The founder sees Asha's plate (employee blue, status online) and right-clicks: Message, Invite to conversation, Call over.
5. Asha walks to the lounge; a proximity bubble forms with two agents; she types "status of the audit?" in the bubble; the agent replies, and because Asha is an employee the agent refuses a Tier-3 action and raises a hand to the founder instead.
6. Asha sets Focus: doors icon on her plate; the founder's call-over is auto-declined with a message.
7. Admin locks the meeting room for a private review; Asha sees a red door and cannot enter.
8. Asha leaves (offline): avatar fades at her desk; chat history remains; the founder exports her activity log.

**Deployment decision needed from the founder before phase I** (current default: LAN-only, no cloud): (a) same-PC only (single user + guests on the same machine is pointless, so phase I would stay dormant), (b) LAN server on the founder's PC (Windows firewall rule, HTTPS via local CA or plain http on trusted LAN), (c) Cloudflare tunnel as in `docs/ops/remote_access.md` for remote employees. Default recommendation: (b) first, design the protocol so (c) works unchanged.

# 10. Risk register for V3
| Risk | Mitigation |
|---|---|
| Draw calls/skinning cost with 120+ actors | L1-L3, merged meshes (done), instancing for far actors, animation LOD, hard perf gate every phase |
| Scope explosion (this book is large) | Release train in section 5; each release is shippable; V3.0 is the only one needed to be "alive" |
| Another model editing the tree | explicit-path staging, small commits, no shared-file edits except through hunks |
| Tinting breaks the merged-mesh optimisation | region attribute + uniform array; cap distinct materials; quantise tints |
| Server authority vs prototype speed | phase I after V3.2; client-only mode always works |
| Privacy leaks in a multi-user office | server-side filtering (I6), role matrix tests, no bodies in logs |
| Asset licensing for a future spin-off | founder rule: no restrictions; keep the copy log so replacement is possible later |
| WebGL context loss / GPU differences | J5 recovery, quality tiers, benchmark baseline per machine |
| Builder corrupts the world | validator on every command, snapshots, restore, 409 flow |

# 11. Definition of done for "Version 3 is alive" (V3.0)
- Rotate (Q/E, orbit, presets), pan, zoom, follow, focus rooms, wall fade, minimap, day/night.
- Walk by click and by WASD relative to the camera; agents sit, stand, walk and gesture believably.
- Right-click menus on characters, objects, rooms and floor with the actions in V3-E2.
- Appearance editor (gallery, colours, parts, preview, persistence) and name plates that never overlap.
- Proximity conversations with greeting, lock, chat entry point and live agent-to-agent transcript bubbles; call over, follow, invite.
- Action bar, roster, toasts, onboarding, view settings, help overlay.
- Perf gate green: 60 people >= 55 fps; all e2e specs for phases A-F and J1 green; docs updated.
