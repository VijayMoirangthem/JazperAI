# 03 - Target design (our app)

Decision: see `02_decision_adr.md` (own Phaser 3.88 code, WorkAdventure conventions, no WA code or art).
Everything lives in a **new panel `office2`** until the founder approves the switch; the old `office` panel stays untouched until prompt P18.

## 1. Current state (read from the repo, to be kept working)

| Item | Where | Fact |
|---|---|---|
| Panel | `app/src/components/panels/OfficePanel.tsx` (247 lines) | Phaser game created inside a React effect; 40x24 tiles of 32 px; agents are 12x16 procedural sprites scaled x2; BFS walking; polling `useApi` for `/api/v1/directory/` and `/api/v1/bots/`. |
| Pure logic | `app/src/office/behavior.ts` (`placeFor`, `pickSpot`, `bfs`, `near`), `app/src/office/sprites.ts` (`CREW_COLOR`, `drawStrip`, `portrait`) | Tested by `app/tests/office.test.mjs` (node `--test`, imports `.ts` directly). |
| Map | `scripts/gen_office_map.mjs` -> `app/public/office/{map.json,rooms.json}` | Tile ids 1-9, collision by id set `{2,3,5,6,8,9}`, tiles drawn at runtime on a canvas. |
| Live events | `app/src/stores/liveAgentsStore.ts` + `app/src/lib/rpcClient.ts` | Zustand store `useLiveAgents`: `agents[slug] = {slug,state,bubble,reason,seq,ts}`; topic `agent-state-change` on `/ws/rpc`. |
| Backend | `backend/python/api/routes/directory.py` (`GET /api/v1/directory/` -> `{humans:[{id,display_name,...}], bots:[...]}`), `bots.py` (see section 6), `rpc.py` (`/ws/rpc`, `POST /ws/rpc/demo` emits a scripted sequence for jasper/scout/forge) | `AgentState` values (`core/contracts.py`): idle, planning, working, waiting_tool, waiting_human, testing, repairing, rolled_back, escalated, error, deprecated. The old ring table covers only the first seven plus error. |
| Registration | `app/src/app/plugin-registry.ts` line ~301 (`id: "office"`), `app/src/app/page.tsx` line 7 (lazy import) and 256 (`office: <OfficePanel />`), `app/src/components/layout/Sidebar.tsx` line 145 (`JAZPER_ORDER`) | Navigation is by `window.location.hash` = panel id. |
| Test hooks | `e2e/tests/app.spec.ts` "virtual office runs above 30 fps": reads `window.__officePeople` (>5) and `window.__officeFps` (>30) | The new panel must publish the same two globals. |

**Known weaknesses to fix** (from the founder's screenshot): flat tiles; tiny characters; overlapping name labels; speech bubble detached from owner; no zoom/pan/follow; no minimap; no zones logic; no real proximity chat; minimal ID card.

## 2. Module layout (new)

Pure logic = plain `.ts` files that `node --test` can import directly: **erasable TypeScript only** (no `enum`, no `namespace`, no constructor parameter properties, no `@/` path alias, relative imports with the `.ts` extension). Browser-only code (Phaser, DOM, React) lives in other files and is never imported by tests.

```
app/src/office2/                    (all new)
  types.ts          shared interfaces (Person, Look, Area, MapModel, LiveState)       pure
  mapModel.ts       Tiled JSON -> MapModel (collision grid, areas, spawns, seats)      pure
  pathfind.ts       A* on the grid (4-neighbour) + path smoothing                      pure
  proximity.ts      groups with enter/leave hysteresis                                 pure
  nameTags.ts       anti-overlap layout of tags                                        pure
  look.ts           Look from slug/crew/override (deterministic)                       pure
  camera.ts         zoom steps, clamping, minimap transforms                           pure
  behavior.ts       placeFor / pickSpot (moved copy of office/behavior.ts + new rules) pure
  avatarArt.ts      draws the layer art into canvases                                  browser
  avatarSheet.ts    composes layers into one 96x128 Phaser texture per person          browser
  OfficeScene.ts    the Phaser scene                                                   browser
  liveBridge.ts     subscribes useLiveAgents -> scene commands                         browser
app/src/components/panels/Office2Panel.tsx   React shell: HUD, ID card, add/edit dialogs
app/src/components/office2/                  IdCard.tsx, EditDialog.tsx, ProximityChip.tsx, Minimap.tsx
app/src/stores/chatIntentStore.ts            "open DM with X" request, consumed by ChatPanel2
app/public/office2/                          map.json (Tiled), tiles.png, areas.json (derived, optional)
scripts/gen_office2_map.mjs, gen_office2_tiles.mjs   generators for our own art and map
app/tests/office2.*.test.mjs                 unit tests (add each to the `test` script in app/package.json)
e2e/tests/office2.spec.ts                    Playwright/Electron flows
```

## 3. Map format (Tiled JSON, WorkAdventure conventions)

World: **60 x 40 tiles of 32 px** (1920 x 1280 px). Files: `app/public/office2/map.json` (Tiled "orthogonal" JSON, `tilewidth` 32) and `tiles.png`.

Layers, bottom to top:

| Layer | Type | Properties | Meaning |
|---|---|---|---|
| `floor` | tilelayer | - | floors, carpets, rugs |
| `walls` | tilelayer | `collides: true` (bool layer property, as in WorkAdventure) | walls, doors are gaps |
| `furniture` | tilelayer | `collides: true` | desks, tables, machines, sofas, plants |
| `decor` | tilelayer | - | non-blocking items (mats, paper, floor signs) |
| `overlay` | tilelayer | - | drawn **above** characters (e.g. top of doorframes, plant leaves) |
| `zones` | objectgroup | - | rectangles with `class: "area"` |
| `spots` | objectgroup | - | point objects with `class: "seat"` or `"spot"` |

`area` objects (rectangle) - custom properties:

| property | type | required | meaning |
|---|---|---|---|
| `room` | string | yes | id: `engineering`, `operations`, `meeting`, `tools`, `lounge`, `founder`, `reception`, `server` |
| `label` | string | yes | text shown on the floor/minimap |
| `kind` | string | yes | `work` / `meet` / `tools` / `social` / `private` / `transit` |
| `silent` | bool | no | no proximity chat chip here (WorkAdventure `silent`) |
| `focusable` | bool | no | camera may zoom to fit it (WorkAdventure `focusable`) |
| `capacity` | int | no | soft limit for spot assignment |

`seat` / `spot` points: properties `room` (string), `slot` (int, stable order), `facing` (`up|down|left|right`, optional), `owner` (string slug, optional - reserved desk). A point named `start` with property `start: true` is the founder's spawn (WorkAdventure `start`).

Loader contract (`mapModel.ts`): `parseMap(json): MapModel` where

```ts
interface Area { room: string; label: string; kind: string; x: number; y: number; w: number; h: number; silent: boolean; focusable: boolean; capacity: number } // tile units
interface Spot { room: string; slot: number; x: number; y: number; facing?: "up"|"down"|"left"|"right"; owner?: string; type: "seat"|"spot" } // tile units
interface MapModel { width: number; height: number; tile: number; blocked: boolean[][]; areas: Area[]; spots: Spot[]; start: [number, number]; roomAt(x: number, y: number): string | null }
```

Validation rules (throw `Error` with a readable message): every `room` used by a spot exists as an area; every spot tile is not blocked; every spot reachable from `start`; at least 24 seats in `work` rooms; rooms `meeting`, `tools`, `lounge`, `founder` exist.

## 4. Avatars

* Frame 32 x 32; sheet 96 x 128 (3 columns x 4 rows). Row order and frames follow WorkAdventure's convention: row 0 down, row 1 left, row 2 right, row 3 up; walk cycle frames `[0,1,2,1]` at 8-10 fps, idle = frame 1 of the current row.
* **Layers** (each a 96 x 128 canvas in the same grid): `body` (5 skin tones), `outfit` (3 cuts x crew colour from `CREW_COLOR`, plus accent for lifecycle: probation = lanyard), `hair` (8 styles x 6 colours), `accessory` (none, glasses, headset, cap, badge). Founder gets a distinct outfit.
* `look.ts`: `lookFor(slug, crew, kind, override?) -> Look` = `{skin, outfit, hair, hairColor, accessory, shirtColor}`, deterministic from `hash(slug)` (reuse `hash` from `app/src/office/sprites.ts` by copying it), override from `localStorage["office2.looks"]` (JSON map slug -> partial Look). Same input -> same output (tested).
* `avatarSheet.ts`: composes the layers for one `Look` into one canvas, registers one Phaser texture `av_<slug>_<lookKey>`, defines the 12 frames, and four walk + four idle animations created **once per texture**. Texture is rebuilt only if the `Look` changes.
* Art source for v1 is procedural (`avatarArt.ts`), later optionally replaced by PNG layer packs (`04_asset_plan.md`).
* Draw order inside one avatar `Container`: shadow ellipse, status ring (flat ellipse under the feet), sprite, status bubble (child), name tag handled separately (below).

## 5. Rendering, camera, input

* Phaser config: `pixelArt: true`, `roundPixels: true`, `antialias: false`, `scale.mode = RESIZE` (fills the panel, no letter-boxing), background `#0b0f14`.
* Depth bands (named constants, from the WA idea): tiles 0; avatars = `y` (feet) ; overlay 1_000_000; proximity halos 1_050_000; name tags 1_100_000; world UI 1_200_000. Bubbles are children of the avatar container but rendered on the tag layer through `container.setDepth` in the same band so they never sink behind furniture.
* Static layers are baked: tile layers rendered once to a `RenderTexture`/layer with culling on; per-frame work only for avatars (<= 40) and tags.
* **Camera** (`camera.ts` + scene): follow the founder avatar (toggle `F`), wheel zoom with zoom steps `[0.5, 0.75, 1, 1.5, 2, 3]`, right/middle-drag or Space+drag pan (cancels follow), double-click a room name on the minimap or press `1-8` to focus a room (`focusable` areas), camera bounds = world, `Home` = re-centre on founder, `+`/`-` zoom.
* **Minimap** (`Minimap.tsx`, a small canvas in the HUD corner, 160 x 107 px): static map thumbnail baked once, avatar dots coloured by state, camera rectangle; click to jump the camera.
* **Movement**: click on floor = path to that tile (A*, `pathfind.ts`); arrow keys/WASD = tile-step movement for the founder; walking speed 140 ms per tile for everyone; arrival faces `facing` of the spot; path blocked by another avatar standing on the target -> nearest free tile. Bots never block each other for more than 1 s (they re-plan once, then give up and share the spot).
* **Name tags** (`nameTags.ts`): world-anchored but *size constant on screen*; layout function takes `{id, x, y, w, h, priority}` list and returns non-overlapping positions (stack upward, 2 px gap, max 3 iterations); tags are hidden below zoom 0.75 except for the hovered, selected, the founder, and agents with `error`/`waiting_human`; a leader line is drawn if a tag moved more than 6 px.

## 6. Data flow

```
Browser (Office2Panel)
  useApi GET /api/v1/directory/   (humans)             --> Person[] kind=human
  useApi GET /api/v1/bots/        (enabled bots)       --> Person[] kind=bot   (poll 5 s, as today)
  useLiveAgents  <-- /ws/rpc topic agent-state-change   (slug, state, bubble, reason)
        |
        v   liveBridge.ts (diffs, ignores unknown slugs)
  OfficeScene: spawn/despawn people, apply state -> ring colour, bubble, destination room by placeFor()
        |
  proximity.ts (every 250 ms) --> groups --> halo drawing + ProximityChip (React)
        |
  click avatar --> IdCard (GET /api/v1/bots/{slug}/card)
  ProximityChip "Talk" --> chatIntentStore.open({id:"dm:<slug>", label, kind:"dm", crew}) ; location.hash = "team_chat"
  Add / Edit dialog --> PUT /api/v1/bots/ (upsert), PUT /{slug}/org, PUT /{slug}/prompt, DELETE /{slug}, POST /{slug}/enable
```

The scene is rebuilt **never** on data refresh: `Office2Panel` computes a roster signature; the scene gets `syncPeople(list)` and diffs (add/remove/update). (The old panel destroys and recreates the whole game on every roster change; that is a bug source.)

Backend endpoints used (all exist, none is changed by this plan):

| Use | Endpoint | Shape |
|---|---|---|
| humans | `GET /api/v1/directory/` | `{humans:[{id,display_name,...}], bots:[...]}` |
| roster | `GET /api/v1/bots/` | `{bots:[{slug,display_name,role_title,crew,lifecycle,enabled,...}]}` |
| ID card | `GET /api/v1/bots/{slug}/card` | bot fields + `group,group_label,prompt,prompt_is_default,memory_namespace,settings,tool_options` + score fields (display only keys that exist) |
| create/update | `PUT /api/v1/bots/` | body `BotIn`: `slug` (`^[a-z0-9][a-z0-9._-]{1,62}$`), `display_name`, `role_title`, `crew`, `prompt` (required), `reports_to`, `tools`, `model_policy` |
| placement | `PUT /api/v1/bots/{slug}/org` | `{org_group?, department?, position?}` |
| prompt | `PUT /api/v1/bots/{slug}/prompt` | `{prompt}` |
| disable / enable | `DELETE /api/v1/bots/{slug}`, `POST /api/v1/bots/{slug}/enable` | - |
| live events | `/ws/rpc` subscribe `["agent-state-change"]` | `params: {agent_slug,to_state,status_bubble,reason}` |
| demo events | `POST /ws/rpc/demo` | scripted jasper/scout/forge sequence for tests |

Appearance overrides are stored in `localStorage` in v1 (single-user, single-machine). Moving them to the backend is explicitly **out of scope** (the founder may ask later; `look.ts` isolates the storage).

## 7. Behaviour rules (`behavior.ts`)

`placeFor(state, hour, ctx)`:

| state | place |
|---|---|
| planning | meeting room (stands around the table) |
| waiting_tool, testing, repairing | tools lab |
| working | own desk |
| waiting_human | the founder's room doorway spot (so the founder sees who needs them) |
| error, rolled_back | own desk, red ring, tag always visible |
| escalated | same as waiting_human (needs the founder), amber ring |
| deprecated | desk, grey ring, 50% alpha |
| idle | desk; 12:00-13:00 local = lounge; after 20:00 stays at desk (no ghost walking) |

Rules: an agent is moved only when `place` changes; at most **4 agents walk at once** (queue the rest, FIFO) to avoid stampedes; spots are assigned stably by `hash(slug)`; if all spots in a room are taken, the overflow stands in the adjacent `transit` area (never stacked on the same tile).

## 8. Proximity (`proximity.ts`)

* Input: list of `{id, tile:[x,y], walking:boolean}`; params `enter=2`, `leave=3` (Manhattan tiles), `silentAreas`.
* Output: groups `string[][]` (connected components), stable `groupId` (smallest slug) and `events` `{type:"join"|"leave", id, groupId}` with hysteresis so a person on the border does not flicker.
* Walking avatars never *start* a group, they can join one on arrival.
* Rendering: a soft translucent halo circle under each group (alpha 0.15, radius to cover members), thin link lines between members (existing look).
* **Entry point to chat**: when the founder is in a group of >= 1 bot, `ProximityChip` appears above the founder: "Talk to Forge" (1 bot) or "Talk to Forge, Scout +1" (groups -> opens the first member's DM and lists the others as `@mentions` prefilled). Click -> `chatIntentStore.open(...)` and `location.hash = "team_chat"`.

## 9. ID card and add/edit

* Click an avatar -> right-side drawer `IdCard` (replaces the tiny card): large portrait from the composed sheet (idle frame, x6), name, role, crew badge, state with colour, lifecycle, department/position, reports to, current bubble/reason, memory namespace, model tier, score (if present), tools count, buttons: **Chat**, **Edit**, **Focus camera**, **Follow**, **Disable**.
* **Add employee**: full form (slug auto-suggested from name; validated against the regex above; crew select from `CREW_COLOR`; role; prompt prefilled; appearance picker with live preview of 5 slots). Calls `PUT /api/v1/bots/` then `syncPeople`.
* **Edit**: same form pre-filled from `/card`; submits the changed parts only (`PUT /api/v1/bots/` for name/role/crew/prompt together because `BotIn` requires the full body; `PUT .../org` for placement). Appearance changes are local only.
* Errors from the API are shown inline (never swallowed); the dialog stays open.

## 10. Presence / humans

* Humans come from `directory.humans` (today one: the founder). Founder avatar = controllable, gold ring, own room "Founder office", always has the camera follow ON at start.
* "Presence": the founder avatar is shown `away` (dimmed, "zzz" bubble) when the panel's `useViewActive()` is false for > 5 min or the window loses focus for > 5 min; returns on focus. No network presence in v1.
* More humans: rendered as static avatars at their desk with ring colour grey unless the directory later supplies a state; no remote position streaming (see ADR fallback criteria).

## 11. Performance budget

* Target: **median >= 55 fps and p95 frame time <= 20 ms with 60 avatars** (the real roster is 51 bots + the founder) on this machine (i5-13420H, integrated GPU), 1280 x 720 panel at zoom 1 and zoom 2. Published as `window.__officeFps` (1 s average, as today) plus `window.__officeFrameMs` (p95 of the last 120 frames) and `window.__officePeople`.
* Per frame budget: scene update <= 4 ms. No per-frame allocations in the update loop; tag layout runs at 5 Hz or when positions changed; proximity at 4 Hz; minimap redraw at 4 Hz.
* Load test hook: query `#office2?bots=60&wander=1` makes the scene add synthetic bots (slug `sim-01`...) cycling states every 2 s - only when `window.__JASPER_E2E` or `?bots=` is present; never in normal runs.
* `game.loop.sleep()` when the panel is hidden (existing pattern with `useViewActive`).

## 12. Acceptance criteria per feature

| # | Feature | Criterion (observable) |
|---|---|---|
| F1 | Map | `parseMap` accepts `public/office2/map.json`; >= 8 rooms; every seat/spot reachable from `start`; unit test green. |
| F2 | Look | 24 distinct bots show >= 20 distinct looks; same slug always the same look (unit test + screenshot). |
| F3 | Avatars | 32 px, 4 directions, 4-frame walk, no flicker when turning; screenshot at zoom 2 shows hair/outfit/accessory layers. |
| F4 | Name tags | 12 avatars on one tile -> no two tag rectangles intersect (unit test); screenshot of the lounge with 8+ agents has no overlapping labels. |
| F5 | Bubbles | Bubble is a child of its avatar: moving the avatar moves the bubble the same frame (Playwright reads positions). |
| F6 | Live | `POST /ws/rpc/demo` makes `jasper` walk to the meeting room, `forge` to the tools lab, and ring colours match `STATE_RING`. |
| F7 | Camera | follow, wheel zoom between 0.5 and 3, drag pan, room focus via `1-8`, bounds respected, minimap click recenters. |
| F8 | Movement | click-to-move and WASD; path never crosses blocked tiles; unreachable click does nothing and shows a brief "can't go there" toast. |
| F9 | Proximity | founder 2 tiles from a bot -> chip within 0.5 s; 4 tiles away -> chip gone; border jitter does not flicker (unit test). |
| F10 | Chat link | clicking the chip lands on Team Chat with the DM selected (Playwright asserts the channel label). |
| F11 | ID card | opens with data from `/card`; shows portrait, state, lifecycle, department, model tier; Chat/Edit/Focus buttons work. |
| F12 | Add/edit | adding `qa-bot` makes an avatar appear without reloading the scene; editing the role updates the card; duplicate slug shows the API error inline. |
| F13 | Perf | 60 avatars: `__officeFps >= 55` and `__officeFrameMs <= 20` in the Electron check. |
| F14 | Regression | old `office` panel and its test untouched until P18; `npm test`, `tsc`, backend tests unchanged. |
