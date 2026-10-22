# Office V3 verification backlog

Full application testing is intentionally deferred until feature implementation is complete.

## Per-prompt checks

- V3-A2: world migration unit tests; Office 3 loads `/office3/world.json`; 60-person perf gate.
- V3-A3: API world revision conflict, snapshots, appearance validation and audit rows.
- V3-A4: execute the 60-person high-quality perf gate and retain its screenshot/metrics.
- V3-A4 onward: record each prompt's required unit, API, Electron, visual, and performance checks here before marking it complete.
- V3-C1 follow-up: rotate through all camera presets and snap angles, then verify WASD/arrows move founder-relative to the screen-facing camera direction, including diagonal movement and blocked-tile fallback.
- V3-G3: validate template placement and auto-furnish across every room kind; Electron flow inserts “Meeting room 8”, saves, reloads, and confirms all eight seats are reachable; capture a builder screenshot.
- V3-G5: validate zone-rule persistence (including valid/invalid capacity, locks, role access, ambience and entry notes), selected-room spawn persistence/reload placement, founder desk-claim conflict handling, claim restoration after reload, and in-scene zone/desk indicators; include two-client permission coverage when multi-user verification begins.
- V3-G5 entry notes: save a room note in Builder, reload the world, enter that room, and verify the actor bubble displays the note; then verify silent/capacity behavior remains intact.
- V3-G5 role access: configure Founder-only and Member-only rooms, reload the world, and assert founder/bot fixtures are respectively allowed or blocked without bypassing capacity/silent behavior.
- V3-D2: visual/Electron validation of all five tint regions and each attachment, including lanyard/pin/no-badge choices; verify custom models without region attributes fall back safely, appearance reload persistence, and the 60-person tint-material performance gate.
- V3-H1: intercept the task board API in Electron, assert a task chip appears over its assignee, drag a card through every board status (and exercise the accessible status controls), confirm the persisted result/refreshed chip, then verify no label-overlap/performance regression at 60 actors.
- V3-H2: create a pending approval fixture, assert the waiting agent reaches the founder and raises a hand, then approve and deny separate fixtures to verify their acknowledgement bubble and return path; cover tier-3 re-auth once wired.
- V3-H3: use the fake stand-up clock to confirm every scheduled attendee receives a distinct reachable meeting seat before speaker rotation, then advance past the schedule window and confirm they return to desks; confirm speaker cadence, camera target, and highlight ring; create and resolve an alert fixture to validate incident lighting, banner, and tools-lab routing without disrupting a human-waiting agent.
- V3-D5: populate a 120-person dense scene and assert no visible label boxes intersect, priority labels remain visible, distance LOD transitions correctly, and performance stays within the roster budget.
- V3-D4 follow-up: capture working, planning, waiting-human, waiting-tool, and all three seeded idle variants; verify a state change clears the prior procedural tilt, seated actors remain grounded, and the far-actor motion throttle retains the performance budget.
- V3-I4: open a person and proximity-group conversation, send/reload/reopen to verify server persistence, then take the Office service offline to verify local fallback; run two clients and verify an open drawer receives another client's message within the three-second refresh window; complete typing, agent-stream bridging, authenticated role-gating, and private-room privacy validation.
- V3-I6: API-test malformed participant lists, nonparticipant senders, blank/overlong text, the 30-message/second limit, 30-day retention cleanup, founder/admin deletion and audit rows, forbidden nonmoderator deletion, and future authenticated moderator actions.
- V3-I2: run two and three-client websocket fixtures to verify adjacent-cell position visibility, distant-cell suppression, join/leave cleanup, speed rejection, initial roster hydration, outbound founder presence, resume/reconnect, and smooth remote interpolation in the scene.
- V3-I3: open a bot visit card, emit successive agent-state-change fixtures, and verify the card updates state/activity/timestamp without reopening; confirm founder cards remain stable and run the later multi-client profile check.
- V3-I7: open two builder clients; verify unknown-room locks are rejected, each client receives another editor's lock within four seconds, conflicting reservations remain disabled, release is reflected, and audit rows name the locked room/editor. Verify placement produces a remote cursor ring in the interested cell only, then expires within five seconds after activity stops.
- V3-G5 follow-up: save a desk claim, reload Office 3, verify the API world is used rather than the bundled fallback and the named desk plate renders at the claimed seat.
- V3-G6: force a stale-revision publish from a second builder client; verify the conflict summary reports the latest revision/counts, Reload theirs preserves no stale scene state, and Publish my additions merges draft objects/seats once without duplicating a seat.
- V3-G6 import/export: export the active world, re-import it, and confirm schema/2-MB failures are non-destructive; import a valid alternate world, reload the Office, and verify its rooms, seats, and theme render from the persisted API world.
- V3-G6 worlds: clone the active world with a valid unique ID, verify it starts inactive and is independently persisted, activate it from the builder switcher, reload Office, and confirm the selected world is rendered without changing the original.
- V3-L1: capture low/medium/high screenshots and metrics with 60 and 120 actors; verify far-actor update throttling, label modes, pixel ratio/shadow changes, and automatic-tier hysteresis over a sustained performance window.
- V3-J5: stop the backend during Office use and verify the offline banner/local controls, then restore it; force WebGL context loss in Electron and verify retry/fallback paths and a clean renderer rebuild.
- V3-J4: trigger rapid duplicate notifications and priority variants, confirm max-three/dedupe/auto-dismiss/keyboard accessibility, then validate DND suppression and background desktop approval notices when added.
- V3-J2: open the settings modal by button and V, verify each persisted setting reloads and applies live; confirm FPS HUD visibility, reduced-motion pose reset, keyboard focus/escape handling, and later cover account, controls, audio, language, privacy, and notification sections.
- V3-D1 follow-up: open the full 50-look gallery, exercise search/body/recent filters and keyboard selection, then verify the chosen look applies immediately, persists through the backend, and has its intended thumbnail/turntable rendering.
- V3-F4 follow-up: interact with each supported object and capture its corresponding effect and actor pose; verify effects/poses expire, remain within the particle/effect cap, and do not regress roster-frame performance.
- V3-H4: intercept task-board states for focused, happy, strained, and tired fixtures; assert plate mood/rank changes, then verify live backend outcome integration and cosmetic effects when lifecycle data is available.
- V3-M1: API-test oversized, malformed, wrong-collection-shape, invalid room kinds/partial overlaps, out-of-bounds, duplicate-room/object/place IDs, invalid-place, and invalid-spawn world writes; verify valid worlds still save with optimistic revision behavior, and a deliberately corrupted active row recovers the latest valid snapshot with a new revision/audit row.

## End-to-end release pass

1. Start Jazper with its renderer and backend healthy.
2. Run all Office 3 pure-module tests.
3. Run backend Office routes tests.
4. Run Office 3 Electron/Playwright specs and capture the prescribed screenshots.
5. Verify the 60-person high-quality and 120-person medium-quality performance gates.
6. Walk through the V3.0 “alive” definition manually.
7. Record exact commands, screenshots, metrics, and failures in PROGRESS.md.
