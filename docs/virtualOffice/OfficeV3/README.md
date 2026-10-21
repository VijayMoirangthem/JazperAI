# Office 3 (beta) - 3D office spike (DeskRPG approach)

Status 2026-10-21: **works, kept.** Panel "Office 3 (beta)" in the left rail (hash `#office3`). Office 2 (2D) and the old office are untouched.

## What it is
- three.js scene (`app/src/office3/office3.ts`, panel `app/src/components/panels/Office3Panel.tsx`), same data and logic as Office 2:
  map (`/office2/map.json`), people, seat planning, A* paths, live agent states (`/ws/rpc`), `placeFor` room routing.
- Art from DeskRPG (CC0 Quaternius characters + furniture GLBs), copied to `app/public/office3/` and logged in `COPIED_FROM_WORKADVENTURE.md`.
  50 animated looks (idle / walk / sit), chosen per agent by slug hash.
- Camera: left-drag pan, right-drag rotate, wheel zoom. HUD shows fps, people, draw calls, triangles.
- URL params: `#office3?bots=60&wander=1` adds simulated bots that walk around (load test).

## Measured (Electron, this PC, headless-free real window)
| case | fps | draw calls | triangles |
|---|---|---|---|
| real roster (60 people) | 51-67 | 586 | 625k |
| 120 people walking | 34-44 | 751 | 948k |
First version (unmerged characters) ran 120 people at 13 fps with 3295 draw calls. Fix: each character ships as ~16 flat-colour skinned primitives; `prepare()` bakes colours into vertex colours and merges them into ONE skinned mesh (1 draw call per person).

## Findings / gotchas
- Electron CSP blocked GLB textures (`connect-src` lacked `blob:`/`data:`); fixed in `desktop/main.js`. Same file also needed `ws://127.0.0.1:8000` (live events).
- Quaternius bases are "miniature" (about 0.8 units tall); we scale to `CHAR_H = 2.1` for a stylised look. Bounding boxes of the unmerged parts are unreliable, merged mesh bbox is fine.
- Demo endpoint is `POST /ws/demo`.

## Tests
`cd e2e; npx playwright test tests/office3.spec.ts` (2 tests: real roster + 60 wandering). Screenshots in `e2e/test-results/office3/`.

## Next ideas (not done)
1. Click a character -> ID card, proximity chip, chat link (reuse the Office 2 React components; they need the avatar API swapped).
2. Status bubbles above heads, sit/stand transitions, wave on arrival, hand-raise when `waiting_human` (idea from Claude-Office).
3. Better lighting/shadows for the focused room only, nicer walls (glass partitions from DeskRPG `architecture/`), plants/rugs per room.
4. Camera follow the founder; click-to-move; minimap.
5. Instance far-away characters (LOD) if more than ~80 people are ever needed.
