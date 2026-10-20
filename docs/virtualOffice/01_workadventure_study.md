# 01 - WorkAdventure study (verified by reading the code)

Source: `Project_References/workadventure` (shallow clone, HEAD `118dd84`, 2026-10-19). Paths below are relative to that folder.
Everything here was read in the repo; items marked **UNVERIFIED** were not confirmed from files and must not be relied on.

## 1. Architecture map (what runs where)

| Service | Path | Role |
|---|---|---|
| **play** (front + pusher) | `play/src/front` (browser, Phaser + Svelte), `play/src/pusher` (Node WS gateway), `play/src/room-api` (gRPC Room API) | The game client and the edge server that authenticates and fans out to `back`. |
| **back** | `back/src` (`RoomManager.ts`, `Model/GameRoom.ts`, `Model/Group.ts`, `Model/Zone.ts`) | Authoritative room state: who is where, who is in which proximity group, zones for position notification. |
| **map-storage** | `map-storage/` | Stores and serves `.wam` maps (the inline map-editor format) and uploaded assets. |
| **maps** | `maps/` (`starter/`, `Tuto/`, `assets/`) | Example Tiled maps and assets. |
| **libs** | `libs/map-editor` (zod schemas + `GameMap`, `WamFile`), `libs/messages`, `libs/room-api-clients/room-api-client-js`, `libs/math-utils`, `libs/store-utils`, `libs/shared-utils` | Shared code. Licence of these libs is **ISC** (see section 6). |
| infra | `docker-compose.yaml` (+ `.livekit`, `.no-synapse`, `.single-domain`), Traefik reverse proxy, Redis, uploader, icon server, OIDC mock, Synapse (Matrix chat) | Dev stack; production needs LiveKit + Coturn on separate public hosts (`docs/others/self-hosting/install.md`). |

Compose services (`docker compose -f docker-compose.yaml -f docker-compose.no-synapse.yaml config --services`): back, map-storage, maps, oidc-server-mock, redisinsight, reverse-proxy, uploader, icon, messages, play, redis = **11 containers**, without video (LiveKit) or TURN.
Protocol between browser and servers is protobuf (`messages/protos/*.proto`).

## 2. Front end (Phaser scene)

Directory `play/src/front/Phaser/` (WorkAdventure runs **Phaser 4.2.0**: `play/package.json`; we run 3.88.2 - same API family, differences must be checked when porting a pattern).

| Concern | File(s) | What it does | Reuse for us |
|---|---|---|---|
| Main scene | `Game/GameScene.ts` (4816 lines) | Loads the Tiled map, builds layers, collision grid, spawns players, wires input, camera, zones, scripting. | Concept only. Far too large to port; our scene stays small and split into modules. |
| Map properties | `Game/GameMapPropertiesListener.ts` (1013 lines); property names in `libs/map-editor/src/types.ts` `enum GameMapProperties` (line 506) | Reacts when a player enters/leaves a layer or `area` object that carries properties: `start`, `exitUrl`, `silent`, `playAudio`, `jitsiRoom`, `openWebsite`, `focusable`, `zoomMargin`, `speakerMegaphone`, `listenerMegaphone`... | **Convention**: area objects + typed properties. We reimplement a small subset (`start`, `room`, `silent`, `focusable`, `chatRoom`, `label`). |
| Avatar ("Woka") | `Entity/Character.ts` (845), `Entity/RemotePlayer.ts`, `Player/Player.ts`, `Player/Animation.ts`, `Entity/PlayerTexturesLoadingManager.ts` | A Phaser `Container`; depth = `y + 16` (perspective sorting); 32x32 frames; sheet = 3 columns x 4 rows. | **Reuse the format**: walk frames `down [0,1,2,1]`, `left [3,4,5,4]`, `right [6,7,8,7]`, `up [9,10,11,10]` at 10 fps, idle = middle frame. |
| Layered look | `play/public/resources/customisation/{character_color,character_eyes,character_hairs,character_clothes,character_hats,character_accessories}`; `docs/others/self-hosting/wokas.md` | An avatar is a stack of PNG layers; clients send layer *names*, the server resolves URLs. | **Reuse the idea** (layers composed into one texture at load). Art itself: not usable (licence unverified, section 6). |
| Name tag | `Components/UsernameDisplay.ts`, `UsernameDisplaySizes.ts`, `UsernameStatusDisplay.ts` | Tag follows the character; separate DOM/text layer. Overlap handling was not examined. | Reimplement with our own anti-overlap (our known weakness). |
| Speech | `Entity/SpeechBubble.ts` (100 lines), `Entity/ThinkingCloud.ts`, `Game/Say/` | Bubble is a child of the character container, so it moves with it. | Same: bubble must be a child/anchored object, never a free-floating one. |
| Proximity bubble | `Entity/ConversationBubble.ts` (302 lines) | Purely visual "jelly" circle around a group, radius `MINIMUM_DISTANCE`, depth `DEPTH_CONVERSATION_BUBBLE_INDEX` (1,050,000). | Concept: a soft circle around people in conversation. |
| Proximity logic | `back/src/Model/Group.ts` (`groupRadius`), `back/src/Model/GameRoom.ts` (`computeDistanceBetweenPositions`); defaults in `docs/others/self-hosting/env-variables.md`: `MINIMUM_DISTANCE` 64 px, `GROUP_RADIUS` 48 px | **Server-side** grouping: users closer than the radius join/leave a group; the group starts a video/audio room. | We do it client-side on tile distance (already have `near()` in `app/src/office/behavior.ts`), plus hysteresis. |
| Pathfinding | `Utils/PathfindingManager.ts` (EasyStar, `easystarjs`) | A* on the collision grid; `moveTo()` walks a player; click-to-move in `UserInput/GameSceneUserInputHandler.ts`. | Reimplement: we have BFS; upgrade to A* with diagonal-free 4-neighbour + path smoothing; no new dependency needed. |
| Camera | `Game/CameraManager.ts` (824 lines), `Game/CameraZoomUtils.ts` | Follow target, zoom limits, focus on areas (`focusable`, `zoomMargin`). | Reimplement: follow, wheel zoom, drag pan, focus a room. |
| Depth constants | `Game/DepthIndexes.ts` | Tiles 0; characters = y; overlay 1,000,000; bubble 1,050,000; text 1,100,000; UI 1,200,000. | Copy the **idea** of named depth bands. |
| Minimap | none found (`grep -ri minimap` in `play/src/front` returned nothing) | - | Ours is original work. |

## 3. Map format

* **Tiled JSON** (orthogonal). Collision comes from a tile/layer boolean property `collides` (`GameMapProperties.COLLIDES`). Spawn = object or layer with `start` (`docs/map-building/tiled-editor/entry-exit.md`). Zones = objects of class `area` with properties (`docs/map-building/tiled-editor/special-zones.md`): e.g. boolean `silent`, string `playAudio`.
* **WAM** (`.wam`, inline map editor): a JSON file next to the Tiled map listing `areas` and `entities` with typed properties. Schemas are zod objects in `libs/map-editor/src/types.ts` (`AreaData`, `EntityData`, `WAMFileFormat`; property types such as `SilentPropertyData`, `FocusablePropertyData`, `JitsiRoomPropertyData`, `TooltipPropertyData`, `MaxUsersInAreaPropertyData`). Loader: `libs/map-editor/src/GameMap/WamFile.ts`, `GameMapAreas.ts`.
* Layer ordering: floor layers below, an overlay layer above characters (`floorLayer` convention, depth 1,000,000).
* Map storage service (`map-storage/`) exists to serve/edit `.wam`; we do not need it (maps are static files in `app/public/office/`).

## 4. Scripting and Room API (how outside code talks to a room)

* **Iframe scripting API** (`play/src/iframe_api.ts`, docs `docs/developer/map-scripting/references/api-*.md`): runs *inside the browser* in a sandboxed iframe loaded by the map (`script` property). Can read players (`WA.players`), move the camera, open UI, listen to area enter/leave, set room/player variables.
* **Room API** (gRPC; `messages/protos/room-api.proto`, server `play/src/room-api/RoomApiServer.ts`, client `libs/room-api-clients/room-api-client-js`): **service `RoomApi` exposes exactly five RPCs** - `readVariable`, `listenVariable`, `saveVariable`, `broadcastEvent`, `listenToEvent` (proto lines 68-73). There is **no RPC to create, move or list players**.
* Therefore WorkAdventure has **no first-class non-human participant**. A bot must be a real client speaking the pusher WebSocket protocol (the repo has a `benchmark/` folder that probably simulates players; its code was not read), i.e. each agent would be a fake user needing a token, an avatar and position messages. (Only a search for `bot` in `back/src` and `play/src/pusher` was done; none found.)

## 5. Assets shipped in the repo

| Path | Content | Licence statement in the repo |
|---|---|---|
| `maps/Tuto/Attribution-tilesets.txt` | base tilesets (`tileset1.png`, `tileset2*.png`, `tileset3*.png`, `walls2.png`...) | "CC-BY-SA 3.0" **and** "GNU GPL 3.0", assets from hello@workadventu.re |
| `play/public/resources/characters/pipoya/` | 301 character sheets | `about.txt` says only "Files from Pipoya collection ... pipoya.itch.io/pipoya-free-rpg-character-sprites-32x32". **No licence text -> UNVERIFIED.** |
| `play/public/resources/customisation/*` | layered woka parts | no licence file found -> **UNVERIFIED** |
| `play/public/resources/objects/megaphone/LICENSE.md` | megaphone sounds | Mixkit Sound Effects Free License |

## 6. Licence facts (the evidence the ADR relies on)

* `play/LICENSE.txt` (same file pattern in `back/`, `desktop/`, `messages/`, `uploader/`): **GNU AGPL v3 "with the Commons Clause"**. Quote (line 679 onward): the grant "will not include ... the right to Sell the Software", where "Sell" means providing to third parties, *for a fee or other consideration*, "a product or service that consists, entirely or substantially, of the Software or the functionality of the Software". It also says Enterprise edition is licensed separately.
* `libs/map-editor`, `libs/messages`, `libs/math-utils`, `libs/shared-utils`, `libs/store-utils`, `libs/tailwind`, `libs/eslint-config`: `"license": "ISC"` in each `package.json` (permissive).
* `play`, `back`, `map-storage`: `"license": "SEE LICENSE IN LICENSE.txt"`. `map-storage/` has no LICENSE file at depth <= 3 -> treat as AGPL + Commons Clause (**UNVERIFIED**).
* Reading code to learn *ideas and file formats* does not create an obligation. **Copying or porting source from `play/`, `back/` creates AGPL + Commons Clause obligations** and must not be done.

## 7. Reuse matrix

| Part | Conceptually reusable | Must be reimplemented by us | Never copy |
|---|---|---|---|
| Tiled + `area` objects with properties | yes (format is just Tiled) | loader and property semantics | `GameMapPropertiesListener.ts` |
| 32x32 3x4 sheet, frame order, 10 fps | yes (a layout convention) | animation setup | `Animation.ts`, `Character.ts` |
| Layered avatar composition | yes | our own layer art + composer | woka/pipoya PNGs (licence) |
| Proximity groups | yes | client-side, tile-based, hysteresis | `Group.ts`, `ConversationBubble.ts` |
| Click-to-move + A* | yes | own A* over our grid | `PathfindingManager.ts` |
| Camera follow/zoom/focus | yes | own | `CameraManager.ts` |
| Room API / iframe API | no (needs the whole stack) | our `/ws/rpc` is the equivalent | - |
