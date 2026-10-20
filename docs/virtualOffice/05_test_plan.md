# 05 - Test plan

Principle: logic is pure and tested in milliseconds with `node --test`; the browser is only used for what needs a browser (rendering, fps, flows). Each prompt ends with commands whose expected output is written in the prompt.

## 1. Test layers and commands (Windows, from `D:\Projects\COOS`)

| Layer | Command | Expected | Cost |
|---|---|---|---|
| New unit test file | `cd app && node --test tests/office2.<name>.test.mjs` | `# pass N`, `# fail 0` | ~1 s |
| All app unit tests | `cd app && npm test` | `# fail 0` (existing 5 files + new office2 files, once added to the `test` script) | seconds |
| Typecheck | `cd app && npx tsc --noEmit` | no output, exit 0. **Slow on this machine (minutes): run once per prompt, with a long timeout, never in a loop.** | minutes |
| Backend (only when a prompt touches Python - none in this plan) | `cd backend/python && ../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` | all passed | minutes |
| Electron e2e, one spec | `cd e2e && npx playwright test tests/office2.spec.ts` | `N passed`; `globalSetup` starts backend (:8000) and renderer (:5173) if they are not up and stops what it started | 1-3 min |
| Existing office guard | `cd e2e && npx playwright test tests/app.spec.ts -g "virtual office"` | `1 passed` (old office untouched until P18) | 1-3 min |
| Map generator determinism | `node scripts/gen_office2_map.mjs && git diff --stat -- app/public/office2/map.json` | second run produces no diff | ~1 s |

Windows rules for commands: use PowerShell or Git Bash exactly as written; never `rm -rf`; paths with backslashes only inside PowerShell.

## 2. Pure-logic unit tests (files to create, one per module)

| File | Must cover |
|---|---|
| `app/tests/office2.pngtiles.test.mjs` | PNG helper round trip; tiles.png size 512x256; generator is deterministic (two runs, equal SHA-256) |
| `app/tests/office2.map.test.mjs` | `parseMap` on the real `map.json`: rooms present, >= 24 work seats, all spots reachable from start, error messages for a broken map (missing room, blocked spot) |
| `app/tests/office2.pathfind.test.mjs` | shortest path length on a known grid, unreachable -> `[]`, start == goal -> `[]`, no path through blocked tiles, smoothing keeps endpoints |
| `app/tests/office2.look.test.mjs` | determinism, >= 20 distinct looks for 24 slugs, override merge, invalid override ignored |
| `app/tests/office2.nametags.test.mjs` | 12 tags at one point end with zero overlapping rectangles; tags keep their order; hidden-below-zoom rule |
| `app/tests/office2.proximity.test.mjs` | enter at <= 2, leave at > 3 (hysteresis), walking never starts a group, components merge/split, silent areas suppress |
| `app/tests/office2.camera.test.mjs` | zoom steps clamp, clamp to world bounds, minimap round trip (world -> mini -> world within 1 tile) |
| `app/tests/office2.behavior.test.mjs` | `placeFor` table incl. `escalated`, `deprecated`, `rolled_back`; walk queue max 4; stable spot assignment |

Add every new file to the `"test"` script in `app/package.json` in the same prompt that creates it.

## 3. Browser checks (Playwright via Electron, `e2e/tests/office2.spec.ts`)

The spec copies the launch pattern of `e2e/tests/app.spec.ts` (Electron from `desktop/node_modules/electron/dist/electron.exe`, fresh `--user-data-dir`, `JASPER_E2E=1`, `ELECTRON_RUN_AS_NODE` deleted) and warms the `office2` panel once before measuring. Helper: `openPanel("office2")` sets `window.location.hash`.

Hooks the app must expose (read with `page.evaluate`):

| Global | Meaning |
|---|---|
| `window.__officeFps` | 1 s average fps (already exists in the old panel; new panel keeps the name) |
| `window.__officeFrameMs` | p95 frame time of the last 120 frames |
| `window.__officePeople` | number of avatars |
| `window.__officeDebug` | object: `{ people(): {slug,x,y,state,place}[], tags(): {slug,x,y,w,h,visible}[], camera(): {x,y,zoom}, groups(): string[][], bubbleOf(slug): {x,y,text}|null }` - read-only snapshot functions used by tests |

Flows and assertions (one `test()` each, added by the prompt named in brackets):

1. [P05] panel mounts, `canvas` visible, `__officePeople` > 5, no console errors, screenshot `test-results/office2/p05.png`.
2. [P10] fps >= 30 while 40 synthetic bots are present (`#office2?bots=60&wander=1`), tightened to 55 in P16.
3. [P11] `POST http://127.0.0.1:8000/ws/rpc/demo` -> `jasper` ends in the meeting room area, bubble text equals the demo bubble.
4. [P08] name tags: with `?bots=40`, no two visible tags intersect (`__officeDebug.tags()`).
5. [P09] camera: wheel changes zoom within [0.5, 3]; `Home` restores follow.
6. [P12] proximity chip appears when founder is moved next to a bot (`__officeDebug` teleport helper only in `JASPER_E2E`), disappears when moved away.
7. [P13] chip click -> hash `team_chat` and the active channel label contains the bot name.
8. [P14] ID card shows fields from `/card`.
9. [P15] add `e2e-test-bot` -> avatar appears; edit role; disable it (cleanup in `afterAll`, via `DELETE /api/v1/bots/e2e-test-bot`).
10. [P18] old `office` hash id now loads the new panel and the original "virtual office runs above 30 fps" test still passes.

Screenshots are saved with `await page.screenshot({ path: "test-results/office2/<prompt>.png" })`; `e2e/test-results/` is git-ignored. The reviewer opens them (Claude can read PNGs) and the founder can eyeball them.

## 4. Performance measurement protocol (P16, 60 avatars)

1. Close other heavy apps; note free RAM (`Get-CimInstance Win32_OperatingSystem`).
2. `cd e2e && npx playwright test tests/office2.spec.ts -g "perf"`.
3. The test opens `#office2?bots=60&wander=1`, waits 10 s, samples `__officeFps` and `__officeFrameMs` once per second for 20 s at zoom 1, then zoom 2, and asserts median fps >= 55 and max p95 frame ms <= 20; writes the numbers to `test-results/office2/perf.json`.
4. If it fails: stop and report the numbers; do not "fix" by lowering avatar count.

## 5. Per-prompt gate

A prompt is accepted only when: its listed commands show the expected output; `git status` shows only the files named in the prompt; `git diff --stat` is within the stated size; old-office guard still passes (after P05); no secrets in the diff (`git diff | findstr /i "key token secret password"` shows nothing new); commit exists on branch `feature/office2` with the exact message given.

## 6. Reviewer checklist (Claude, after each prompt)

1. `git log -1 --stat` - files are exactly the allowed ones; size within limit.
2. No file under `Project_References/` staged; no image added without an `ATTRIBUTIONS.md` line.
3. Grep guards: `git diff main -- app/src | findstr /i "workadventure"` empty; no `any`-casts spam (`as any`) added; no `console.log` left.
4. Pure modules have no `import "phaser"`, no DOM, no `@/` alias (they must run under `node --test`).
5. Run the prompt's own commands myself once (fast ones always; tsc/e2e only for prompts marked [e2e]).
6. Open the screenshot when one is listed; compare with the acceptance sentence.
7. Check rollback works in principle: `git revert --no-edit <sha>` is clean (no later dependency) - or note the dependency.
8. Update `docs/virtualOffice/PROGRESS.md` (one line: prompt id, sha, pass/fail, notes).
