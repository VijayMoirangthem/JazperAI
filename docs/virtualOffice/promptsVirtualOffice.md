# promptsVirtualOffice.md - ordered prompts for Nemotron

How to use: for each prompt, paste **PREAMBLE** first, then the prompt. Run prompts in order, one at a time. After each, Claude reviews with the **Reviewer checklist** at the end of this file. Verified-by-Claude artifacts (tests, art scripts, map layout) are embedded verbatim: create the file with exactly that content.

Design context lives in `docs/virtualOffice/03_target_design.md` (read the section named in each prompt). Decision: `02_decision_adr.md`.

## PREAMBLE (paste before every prompt)

```
You are implementing one small step of a plan. Project: Sir Jasper AI in D:\Projects\COOS (Windows 11, founder is the only user). Goal of the whole plan: a new 2D "Office 2" panel (Phaser 3.90, React 19, Vite) with rooms, avatars, live agent status, proximity chat. Old panel `office` stays untouched until the last prompt.

RULES
1. Create and modify files ONLY with the Write/Edit tools. Never use shell heredocs, echo/sed/Set-Content to write source files (they corrupted files before).
2. Touch ONLY the files the prompt lists. Another model is editing this working tree at the same time (backend/*.py, ChatPanel2.tsx and others show as modified in git status). Never touch, stage, stash, revert or reformat those.
3. Git: stay on branch feature/office2 (P01 creates it). Stage files by explicit path: `git add <path> <path>`. NEVER `git add -A`, `git add .`, `git stash`, `git reset --hard`, `git checkout -- .`. Before committing run `git status --short` and `git diff --cached --stat`; only the prompt's files may be staged. Use the exact commit message given.
4. Do not install or upgrade any package (npm or pip). Do not start docker containers. Do not delete anything unless the prompt says so; if you think something must be deleted, stop and ask.
5. Never print, log or commit secrets (.env, tokens, keys). Do not cat .env files.
6. Licence: never copy code or art from Project_References\workadventure (AGPL + Commons Clause). Our code is original.
7. Style: TypeScript strict, 2-space indent, double quotes, semicolons, no `any`, no console.log, short comments only where the why is not obvious.
8. Files in app/src/office2 marked PURE (types, hash, mapModel, pathfind, proximity, nameTags, look, camera, behavior, people, forms, avatarArt) must run under `node --test`: ERASABLE TypeScript only (no enum, no namespace, no constructor parameter properties, no "@/" alias), relative imports WITH the .ts extension (example: `import { hash } from "./hash.ts"`), no phaser/DOM/react imports.
9. Commands (Windows PowerShell, from D:\Projects\COOS): unit test of one file `cd app; node --test tests/office2.<name>.test.mjs`. Typecheck of our code `cd app; npx tsc --noEmit -p tsconfig.office2.json` (about 35 s). Do NOT run plain `npx tsc --noEmit` (8+ minutes). Browser test `cd e2e; npx playwright test tests/office2.spec.ts` (1-3 min, starts backend and renderer itself).
10. STOP RULE: if a command output differs from "Expected", a file you must read does not exist, or you would need to touch a file not listed: STOP, do not improvise, and report the command and its last 20 output lines. You get at most 2 attempts to fix your own mistake.
11. FINAL REPORT format: files changed (git diff --cached --stat), last 15 lines of each command run, commit sha, anything not done.
```

---

## P01 - branch, tsconfig, stub panel behind id `office2`

**Context**: add a new panel id `office2` next to `office`. It must not change `office`.
**Read**: `app/src/app/plugin-registry.ts` (the line with `id: "office"`), `app/src/app/page.tsx` (line with `const OfficePanel = lazy` and the line `office:         <OfficePanel />,`), `app/src/components/layout/Sidebar.tsx` (the `JAZPER_ORDER` array), `app/src/lib/panelPreload.ts`, `app/tsconfig.json`.
**Create**: `docs/virtualOffice/PROGRESS.md`, `app/tsconfig.office2.json`, `app/src/office2/types.ts`, `app/src/office2/hash.ts`, `app/src/components/panels/Office2Panel.tsx`.
**Modify**: `app/tsconfig.json`, `app/src/app/plugin-registry.ts`, `app/src/app/page.tsx`, `app/src/components/layout/Sidebar.tsx`, `app/src/lib/panelPreload.ts`.
**Do not touch**: everything else, especially OfficePanel.tsx.

Steps:
1. `git switch -c feature/office2` (if it exists: `git switch feature/office2`).
2. `app/tsconfig.json`: add `"allowImportingTsExtensions": true,` on the line after `"noEmit": true,`.
3. Create `app/tsconfig.office2.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "incremental": true, "tsBuildInfoFile": "./node_modules/.cache/tsc-office2.tsbuildinfo" },
  "include": ["src/office2", "src/components/office2", "src/components/panels/Office2Panel.tsx", "src/stores/chatIntentStore.ts"]
}
```
4. Create `docs/virtualOffice/PROGRESS.md` with a title and this table header only: `| prompt | commit | result | notes |` and `|---|---|---|---|`.
5. Create `app/src/office2/types.ts`:
```ts
/** Shared shapes for the Office 2 modules. Types only: this file has no runtime code. */
export type Pt = readonly [number, number];
export type Facing = "up" | "down" | "left" | "right";
export type Place = "desk" | "meeting" | "tools" | "lounge" | "founder";

export interface Area {
  room: string; label: string; kind: string;
  x: number; y: number; w: number; h: number; // tile units
  silent: boolean; focusable: boolean; capacity: number;
}
export interface Spot { type: "seat" | "spot"; room: string; slot: number; x: number; y: number; facing?: Facing; owner?: string }
export interface MapModel {
  width: number; height: number; tile: number;
  blocked: boolean[][]; // blocked[y][x]
  areas: Area[]; spots: Spot[];
  start: Pt;
  roomAt(x: number, y: number): string | null;
}

export interface Look { skin: number; outfit: number; hair: number; hairColor: number; accessory: number; shirtColor: string }

export interface Person { slug: string; name: string; role: string; crew: string; kind: "human" | "bot"; lifecycle?: string }
```
6. Create `app/src/office2/hash.ts`:
```ts
/** FNV-1a 32-bit string hash (same function as app/src/office/sprites.ts). Deterministic across runs. */
export const hash = (s: string): number => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
```
7. Create `app/src/components/panels/Office2Panel.tsx` (temporary stub, replaced in P05):
```tsx
"use client";

export function Office2Panel() {
  return (
    <div className="flex h-full min-h-[560px] flex-col p-3">
      <h2 className="text-lg font-semibold">Office 2 (work in progress)</h2>
    </div>
  );
}
```
8. `plugin-registry.ts`: add this line directly after the `id: "office"` line: `  { id: "office2",       label: "Office 2 (beta)", description: "New 2D office, work in progress", icon: Building2, group: "agent_os", system: "jazper" },`
9. `page.tsx`: after the `const OfficePanel = lazy(...)` line add `const Office2Panel = lazy(() => import("@/components/panels/Office2Panel").then((m) => ({ default: m.Office2Panel })));` and after the line `office:         <OfficePanel />,` add `    office2:        <Office2Panel />,`.
10. `Sidebar.tsx`: in `JAZPER_ORDER` insert `"office2",` right after `"office",`.
11. `panelPreload.ts`: add `  office2: () => import("@/components/panels/Office2Panel"),` after the `office:` line in `CODE`, and `  office2: ["/api/v1/directory/", "/api/v1/bots/"],` after the `office:` line in `DATA`.

**Commands and Expected**
```powershell
cd D:\Projects\COOS\app; npx tsc --noEmit -p tsconfig.office2.json   # Expected: no output
cd D:\Projects\COOS; Select-String -Path app\src\app\plugin-registry.ts -Pattern 'id: "office2"'   # Expected: 1 match
```
**Commit**: stage the 10 files listed above; message `office2: P01 scaffold (branch, tsconfig.office2, stub panel office2)`.
**Rollback**: `git revert --no-edit <sha>`.
**Stop and report if** tsc prints any error, or the registry line for `office` cannot be found.

---

## P02 - PNG helper and tile art (own procedural art)

**Context**: tile art is generated by our own script (no third-party art). Read `docs/virtualOffice/04_asset_plan.md` sections 2-3.
**Create**: `scripts/office2_png.mjs`, `scripts/office2_tiles.mjs`, `scripts/gen_office2_tiles.mjs`, `app/tests/office2.pngtiles.test.mjs`, `app/public/office2/tiles.png` (generated by running the script).
**Modify**: `app/package.json` (only the `"test"` script).
**Do not touch**: anything else.

1. `scripts/office2_png.mjs`:
```js
import zlib from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** rgba: Uint8Array/Buffer of width*height*4 bytes. Returns a Buffer holding a PNG file (8-bit RGBA, no interlace). */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Decode a PNG written by encodePng (test helper). Returns {width,height,rgba}. */
export function decodePng(buf) {
  let p = 8, width = 0, height = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (buf.readUInt32BE(p + 8 + len) !== crc32(buf.subarray(p + 4, p + 8 + len))) throw new Error(`bad crc in ${type}`);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { width, height, rgba };
}
```
2. `scripts/office2_tiles.mjs`:
```js
// Tile ids shared by gen_office2_tiles.mjs (draws them) and gen_office2_map.mjs (places them). Tileset image: 16 columns x 8 rows of 32 px; id = row * 16 + column + 1.
export const TILE_SIZE = 32;
export const TILE = {
  wood_a: 1, wood_b: 2, carpet_blue: 3, carpet_purple: 4, carpet_green: 5, tile_light: 6, tile_dark: 7, stone: 8,
  wall_cap: 16, wall_face: 17,
  desk_a: 32, desk_b: 33, bookshelf: 34, table: 35, machine: 36, rack: 37, reception_desk: 38, sofa: 39, vending: 40, plant: 41,
  chair: 64,
  plant_top: 96,
};
/** Furniture type (layout file) -> tile id. "desk" alternates desk_a/desk_b in the map generator. */
export const FURNITURE_TILE = {
  bookshelf: TILE.bookshelf, table: TILE.table, machine: TILE.machine, rack: TILE.rack,
  reception_desk: TILE.reception_desk, sofa: TILE.sofa, vending: TILE.vending, plant: TILE.plant,
};
```
3. `scripts/gen_office2_tiles.mjs`:
```js
// Draws app/public/office2/tiles.png (512x256 = 16x8 tiles of 32 px) with our own procedural pixel art. No third-party art.
// Run: node scripts/gen_office2_tiles.mjs      Deterministic: the same script always writes byte-identical output.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng } from "./office2_png.mjs";
import { TILE, TILE_SIZE as T } from "./office2_tiles.mjs";

const COLS = 16, ROWS = 8, W = COLS * T, H = ROWS * T;
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const noise = (x, y, s) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export function buildTiles() {
  const px = new Uint8Array(W * H * 4); // transparent black
  const tile = (id, draw) => {
    const ox = ((id - 1) % COLS) * T, oy = Math.floor((id - 1) / COLS) * T;
    const set = (x, y, c) => { if (x < 0 || y < 0 || x >= T || y >= T) return; const i = ((oy + y) * W + ox + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3]; };
    const r = (x, y, w, h, col) => { const c = typeof col === "string" ? rgb(col) : col; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    const disc = (cx, cy, rad, col) => { const c = rgb(col); for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad) set(cx + x, cy + y, c); };
    const shadow = (x, y, w) => r(x, y, w, 2, [0, 0, 0, 70]);
    draw({ r, disc, set, shadow, n: (x, y, s = 1) => noise(x, y, s + id) });
  };
  const floor = (id, base, dark, light) => tile(id, ({ r, n }) => {
    r(0, 0, T, T, base);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = n(x, y); if (v < 0.08) r(x, y, 1, 1, dark); else if (v > 0.95) r(x, y, 1, 1, light); }
  });
  const planks = (id, base, seam, light) => tile(id, ({ r, n }) => {
    r(0, 0, T, T, base);
    for (let row = 0; row < 4; row++) {
      r(0, row * 8 + 7, T, 1, seam); r(0, row * 8, T, 1, light);
      r((row % 2 ? 8 : 20), row * 8, 1, 7, seam);
      for (let k = 0; k < 6; k++) r(Math.floor(n(row, k) * 30), row * 8 + 2 + Math.floor(n(k, row) * 4), 3, 1, seam);
    }
  });
  const grid = (id, base, line, light) => tile(id, ({ r }) => { r(0, 0, T, T, base); r(0, 0, T, 1, line); r(0, 0, 1, T, line); r(1, 1, T - 1, 1, light); r(1, 1, 1, T - 1, light); });

  planks(TILE.wood_a, "#8a5a33", "#6b4223", "#9b6a3f");
  planks(TILE.wood_b, "#b58455", "#8f6439", "#c99967");
  floor(TILE.carpet_blue, "#1e3a8a", "#172e6e", "#2c4fb0");
  floor(TILE.carpet_purple, "#5b2a7a", "#47205f", "#7a3ca0");
  floor(TILE.carpet_green, "#1f6b4a", "#17543a", "#2c8a60");
  grid(TILE.tile_light, "#cbd5e1", "#94a3b8", "#e2e8f0");
  grid(TILE.tile_dark, "#334155", "#1e293b", "#475569");
  tile(TILE.stone, ({ r, n }) => { r(0, 0, T, T, "#6b7280"); for (let i = 0; i < 40; i++) r(Math.floor(n(i, 1) * T), Math.floor(n(i, 2) * T), 2, 1, n(i, 3) > 0.5 ? "#4b5563" : "#9ca3af"); r(0, 15, T, 1, "#4b5563"); r(15, 0, 1, T, "#4b5563"); });

  tile(TILE.wall_cap, ({ r }) => { r(0, 0, T, T, "#334155"); r(0, 0, T, 4, "#64748b"); r(0, 4, T, 1, "#1e293b"); r(0, T - 3, T, 3, "#1e293b"); });
  tile(TILE.wall_face, ({ r, n }) => {
    r(0, 0, T, T, "#cbd5e1"); r(0, 0, T, 3, "#e2e8f0");
    for (let i = 0; i < 24; i++) r(Math.floor(n(i, 1) * T), 3 + Math.floor(n(i, 2) * 18), 2, 1, "#b6c2d2");
    r(0, 22, T, 8, "#64748b"); r(0, 22, T, 1, "#94a3b8"); r(0, 30, T, 2, "#1e293b");
  });

  const desk = (id, screen) => tile(id, ({ r, shadow }) => {
    shadow(2, 28, 28);
    r(2, 12, 28, 14, "#9a6b3f"); r(2, 12, 28, 2, "#b3814d"); r(2, 24, 28, 3, "#6b4423");
    r(11, 2, 11, 9, "#0f172a"); r(12, 3, 9, 6, screen); r(13, 4, 3, 1, [255, 255, 255, 160]); r(15, 11, 3, 2, "#475569");
    r(10, 16, 12, 4, "#94a3b8"); r(10, 16, 12, 1, "#cbd5e1");
    r(24, 14, 4, 5, "#e2e8f0"); r(25, 15, 2, 1, "#94a3b8"); // paper
  });
  desk(TILE.desk_a, "#38bdf8"); desk(TILE.desk_b, "#4ade80");
  tile(TILE.bookshelf, ({ r, n }) => {
    r(0, 4, T, 26, "#5b3513"); r(0, 4, T, 2, "#7c4a1d");
    for (const row of [7, 17]) { r(1, row, T - 2, 9, "#3b2410"); for (let x = 2; x < T - 3; x += 3) { const h = 5 + Math.floor(n(x, row) * 4); r(x, row + 9 - h, 2, h, ["#dc2626", "#2563eb", "#16a34a", "#eab308", "#a855f7"][Math.floor(n(row, x) * 5)]); } }
    r(0, 28, T, 2, "#3b2410");
  });
  tile(TILE.table, ({ r }) => { r(0, 2, T, 28, "#7c4a1d"); r(0, 2, T, 2, "#a06a35"); r(0, 28, T, 2, "#4a2c10"); r(0, 2, 1, 28, "#8e5a2a"); r(T - 1, 2, 1, 28, "#5e3815"); });
  tile(TILE.machine, ({ r, shadow }) => {
    shadow(3, 29, 26);
    r(3, 4, 26, 25, "#334155"); r(3, 4, 26, 2, "#64748b"); r(3, 27, 26, 2, "#1e293b");
    r(6, 8, 20, 11, "#0b1220"); for (let i = 0; i < 4; i++) r(8, 10 + i * 2, 5 + i * 3, 1, "#22c55e");
    r(8, 22, 4, 3, "#22c55e"); r(15, 22, 4, 3, "#f59e0b"); r(22, 22, 3, 3, "#ef4444");
  });
  tile(TILE.rack, ({ r, n, shadow }) => {
    shadow(4, 29, 24);
    r(4, 2, 24, 27, "#1f2937"); r(4, 2, 24, 2, "#4b5563");
    for (let i = 0; i < 5; i++) { r(6, 5 + i * 5, 20, 4, "#374151"); r(7, 6 + i * 5, 2, 2, n(i, 5) > 0.5 ? "#22c55e" : "#38bdf8"); r(11, 7 + i * 5, 12, 1, "#111827"); }
  });
  tile(TILE.reception_desk, ({ r, shadow }) => {
    shadow(0, 29, T);
    r(0, 6, T, 12, "#e2e8f0"); r(0, 6, T, 2, "#f8fafc"); r(0, 18, T, 10, "#0ea5e9"); r(0, 18, T, 1, "#0369a1"); r(0, 26, T, 2, "#0369a1");
  });
  tile(TILE.sofa, ({ r, shadow }) => {
    shadow(1, 29, 30);
    r(1, 4, 30, 9, "#be123c"); r(1, 4, 30, 2, "#e11d48"); r(1, 12, 30, 15, "#9f1239"); r(1, 12, 30, 2, "#881337");
    r(0, 6, 3, 21, "#7f1130"); r(29, 6, 3, 21, "#7f1130"); r(15, 14, 1, 11, "#7f1130");
  });
  tile(TILE.vending, ({ r, n, shadow }) => {
    shadow(4, 30, 24);
    r(4, 1, 24, 29, "#b91c1c"); r(4, 1, 24, 2, "#ef4444"); r(7, 5, 18, 15, "#fef3c7");
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) r(8 + x * 4, 7 + y * 4, 3, 3, ["#16a34a", "#2563eb", "#eab308", "#a855f7"][Math.floor(n(x, y) * 4)]);
    r(10, 23, 12, 4, "#111827"); r(22, 22, 4, 2, "#fbbf24");
  });
  tile(TILE.plant, ({ r, disc, shadow }) => {
    shadow(9, 30, 14);
    r(10, 20, 12, 10, "#7c4a1d"); r(10, 20, 12, 2, "#a06a35"); r(10, 28, 12, 2, "#4a2c10");
    disc(16, 12, 9, "#15803d"); disc(12, 9, 5, "#16a34a"); disc(21, 8, 4, "#22c55e");
  });
  tile(TILE.chair, ({ r }) => { r(9, 4, 14, 5, "#1f2937"); r(9, 4, 14, 1, "#4b5563"); r(8, 9, 16, 14, "#334155"); r(8, 9, 16, 1, "#475569"); r(14, 23, 4, 4, "#111827"); r(9, 27, 14, 2, "#111827"); });
  tile(TILE.plant_top, ({ disc }) => { disc(16, 30, 8, "#15803d"); disc(11, 28, 4, "#16a34a"); disc(21, 27, 4, "#22c55e"); });
  return { width: W, height: H, rgba: px };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const { width, height, rgba } = buildTiles();
  const out = new URL("../app/public/office2/tiles.png", import.meta.url);
  fs.mkdirSync(new URL(".", out), { recursive: true });
  fs.writeFileSync(out, encodePng(width, height, rgba));
  console.log(`office2 tiles ${width}x${height}`);
}
```
4. `app/tests/office2.pngtiles.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { encodePng, decodePng } from "../../scripts/office2_png.mjs";
import { buildTiles } from "../../scripts/gen_office2_tiles.mjs";
import { TILE, TILE_SIZE } from "../../scripts/office2_tiles.mjs";

test("png helper: encode then decode returns the same pixels", () => {
  const px = new Uint8Array(7 * 5 * 4).map((_, i) => (i * 53) & 255);
  const d = decodePng(encodePng(7, 5, px));
  assert.deepEqual([d.width, d.height], [7, 5]);
  assert.equal(Buffer.compare(d.rgba, Buffer.from(px)), 0);
});

test("committed tiles.png is exactly what the generator produces (deterministic)", () => {
  const { width, height, rgba } = buildTiles();
  assert.deepEqual([width, height], [512, 256]);
  const onDisk = fs.readFileSync(new URL("../public/office2/tiles.png", import.meta.url));
  assert.equal(Buffer.compare(onDisk, encodePng(width, height, rgba)), 0);
});

const alphaStats = (img, id) => {
  const ox = ((id - 1) % 16) * TILE_SIZE, oy = Math.floor((id - 1) / 16) * TILE_SIZE;
  let opaque = 0, clear = 0;
  for (let y = 0; y < TILE_SIZE; y++) for (let x = 0; x < TILE_SIZE; x++) { const a = img.rgba[((oy + y) * img.width + ox + x) * 4 + 3]; if (a === 255) opaque++; if (a === 0) clear++; }
  return { opaque, clear };
};

test("floors and walls are fully opaque; furniture, decor and overlay are partly transparent; unused ids are empty", () => {
  const img = decodePng(fs.readFileSync(new URL("../public/office2/tiles.png", import.meta.url)));
  for (const name of ["wood_a", "wood_b", "carpet_blue", "carpet_purple", "carpet_green", "tile_light", "tile_dark", "stone", "wall_cap", "wall_face"]) {
    assert.equal(alphaStats(img, TILE[name]).opaque, TILE_SIZE * TILE_SIZE, name);
  }
  for (const name of ["desk_a", "desk_b", "bookshelf", "machine", "rack", "sofa", "vending", "plant", "chair", "plant_top"]) {
    const s = alphaStats(img, TILE[name]);
    assert.ok(s.opaque > 100 && s.clear > 50, `${name} opaque=${s.opaque} clear=${s.clear}`);
  }
  assert.equal(alphaStats(img, 120).clear, TILE_SIZE * TILE_SIZE);
});
```
5. `app/package.json`: in the `"test"` script append ` tests/office2.*.test.mjs` (a space and the glob) before the closing quote. Nothing else.

**Commands and Expected**
```powershell
cd D:\Projects\COOS; node scripts/gen_office2_tiles.mjs        # Expected: office2 tiles 512x256
cd app; node --test tests/office2.pngtiles.test.mjs            # Expected: "ℹ pass 3" and "ℹ fail 0"
npm test                                                        # Expected: "ℹ fail 0"
```
**Acceptance**: `app/public/office2/tiles.png` exists (about 3.7 KB). Claude looks at it.
**Commit**: stage `scripts/office2_png.mjs scripts/office2_tiles.mjs scripts/gen_office2_tiles.mjs app/tests/office2.pngtiles.test.mjs app/public/office2/tiles.png app/package.json`; message `office2: P02 PNG helper and procedural tileset`.
**Rollback**: revert the commit.
**Stop and report if** the test count differs or `npm test` shows a failure in an old test.

---

## P03 - office layout, Tiled map generator, map parser

**Context**: read `03_target_design.md` section 3 (map format). The layout below was verified by Claude: 9 rooms, 30 desk seats, every floor tile reachable.
**Create**: `scripts/office2_layout.mjs`, `scripts/gen_office2_map.mjs`, `scripts/preview_office2_map.mjs`, `app/src/office2/mapModel.ts` (PURE, you write it), `app/tests/office2.map.test.mjs`, `app/public/office2/map.json` (generated), `docs/virtualOffice/previews/map.png` (generated).
**Do not touch**: anything else.

1. `scripts/office2_layout.mjs`:
```js
// Layout data for the Office 2 map (tile units, inclusive rectangles). Pure data: scripts/gen_office2_map.mjs paints it, tests verify it.
export const W = 60, H = 40;

// Rectangles [x1, y1, x2, y2] painted as wall: outer ring and room dividers.
export const WALLS = [
  [0, 0, 59, 0], [0, 39, 59, 39], [0, 0, 0, 39], [59, 0, 59, 39],
  [1, 14, 58, 14], [1, 18, 58, 18],
  [22, 1, 22, 13], [44, 1, 44, 13],
  [19, 19, 19, 38], [38, 19, 38, 38],
  [1, 28, 37, 28],
];
// Door tiles: wall tiles turned back into floor (always 2 tiles wide).
export const DOORS = [
  [10, 14], [11, 14], [33, 14], [34, 14], [51, 14], [52, 14],
  [22, 6], [22, 7], [44, 6], [44, 7],
  [9, 18], [10, 18], [28, 18], [29, 18], [48, 18], [49, 18],
  [19, 22], [19, 23], [38, 22], [38, 23],
  [9, 28], [10, 28], [28, 28], [29, 28],
  [38, 33], [38, 34],
];

// Rooms. rect = interior floor. floor = floor tile name from scripts/office2_tiles.mjs
export const AREAS = [
  { room: "engineering", label: "Engineering", kind: "work", rect: [1, 1, 21, 13], focusable: true, floor: "carpet_blue" },
  { room: "operations", label: "Operations", kind: "work", rect: [23, 1, 43, 13], focusable: true, floor: "carpet_green" },
  { room: "founder", label: "Founder office", kind: "private", rect: [45, 1, 58, 13], focusable: true, floor: "wood_a" },
  { room: "corridor", label: "Corridor", kind: "transit", rect: [1, 15, 58, 17], focusable: false, floor: "tile_light" },
  { room: "meeting", label: "Meeting room", kind: "meet", rect: [1, 19, 18, 27], focusable: true, floor: "carpet_purple" },
  { room: "tools", label: "Tools lab", kind: "tools", rect: [20, 19, 37, 27], focusable: true, floor: "tile_dark" },
  { room: "lounge", label: "Lounge", kind: "social", rect: [39, 19, 58, 38], focusable: true, floor: "wood_b" },
  { room: "server", label: "Server room", kind: "tools", rect: [1, 29, 18, 38], focusable: true, floor: "stone" },
  { room: "reception", label: "Reception", kind: "social", rect: [20, 29, 37, 38], focusable: true, floor: "tile_light" },
];

// Blocking furniture. One tile unless w/h are given (then a w x h block of that type).
export const FURNITURE = [
  ...[3, 7, 11, 15, 19].flatMap((x) => [3, 7, 11].map((y) => ({ type: "desk", x, y }))),
  ...[25, 29, 33, 37, 41].flatMap((x) => [3, 7, 11].map((y) => ({ type: "desk", x, y }))),
  { type: "desk", x: 52, y: 3 },
  { type: "bookshelf", x: 47, y: 1, w: 4, h: 1 }, { type: "bookshelf", x: 55, y: 1, w: 3, h: 1 },
  { type: "table", x: 6, y: 22, w: 8, h: 3 },
  ...[23, 27, 31, 35].flatMap((x) => [21, 25].map((y) => ({ type: "machine", x, y }))),
  ...[3, 5, 7, 9, 11, 13, 15, 17].map((x) => ({ type: "rack", x, y: 30 })),
  { type: "reception_desk", x: 27, y: 32, w: 4, h: 1 },
  { type: "sofa", x: 42, y: 23, w: 3, h: 1 }, { type: "sofa", x: 50, y: 23, w: 3, h: 1 },
  { type: "sofa", x: 42, y: 33, w: 3, h: 1 }, { type: "sofa", x: 50, y: 33, w: 3, h: 1 },
  { type: "vending", x: 57, y: 20 },
  ...[[2, 2], [21, 2], [24, 2], [43, 2], [46, 12], [57, 12], [2, 20], [18, 20], [21, 20], [36, 20], [40, 20], [57, 36], [40, 36], [21, 36], [36, 36], [2, 36]]
    .map(([x, y]) => ({ type: "plant", x, y })),
];

// Spots: "seat" = desk chair, "spot" = place to stand/sit. slot = stable order inside a room.
const seatsFor = (xs, room) => xs.flatMap((x, i) => [4, 8, 12].map((y, j) => ({ type: "seat", room, x, y, facing: "up", slot: i * 3 + j })));
export const SPOTS = [
  ...seatsFor([3, 7, 11, 15, 19], "engineering"),
  ...seatsFor([25, 29, 33, 37, 41], "operations"),
  { type: "seat", room: "founder", x: 52, y: 4, facing: "up", slot: 0 },
  { type: "spot", room: "founder", x: 50, y: 12, slot: 1 }, { type: "spot", room: "founder", x: 53, y: 12, slot: 2 },
  { type: "spot", room: "founder", x: 48, y: 8, slot: 3 }, { type: "spot", room: "founder", x: 55, y: 8, slot: 4 },
  ...[5, 7, 9, 11, 13].flatMap((x, i) => [{ type: "spot", room: "meeting", x, y: 21, facing: "down", slot: i }, { type: "spot", room: "meeting", x, y: 25, facing: "up", slot: 5 + i }]),
  { type: "spot", room: "meeting", x: 4, y: 23, facing: "right", slot: 10 }, { type: "spot", room: "meeting", x: 15, y: 23, facing: "left", slot: 11 },
  ...[23, 27, 31, 35].flatMap((x, i) => [{ type: "spot", room: "tools", x, y: 22, facing: "up", slot: i }, { type: "spot", room: "tools", x, y: 26, facing: "up", slot: 4 + i }]),
  ...[41, 45, 49, 53, 56].flatMap((x, i) => [21, 25, 31, 35].map((y, j) => ({ type: "spot", room: "lounge", x, y, slot: i * 4 + j }))),
  ...[24, 26, 32, 34, 22, 36].map((x, i) => ({ type: "spot", room: "reception", x, y: i < 4 ? 34 : 31, slot: i })),
  ...[4, 8, 12, 16].map((x, i) => ({ type: "spot", room: "server", x, y: 33, slot: i })),
  ...[3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 57].map((x, i) => ({ type: "spot", room: "corridor", x, y: 16, slot: i })),
];
export const START = [52, 9];
```
2. `scripts/gen_office2_map.mjs`:
```js
// Generates app/public/office2/map.json (Tiled JSON, orthogonal) from scripts/office2_layout.mjs.  Run: node scripts/gen_office2_map.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { W, H, WALLS, DOORS, AREAS, FURNITURE, SPOTS, START } from "./office2_layout.mjs";
import { TILE, TILE_SIZE, FURNITURE_TILE } from "./office2_tiles.mjs";

const T = TILE_SIZE;
const prop = (name, value) => ({ name, type: typeof value === "boolean" ? "bool" : Number.isInteger(value) && typeof value === "number" ? "int" : "string", value });

export function buildMap() {
  const blank = () => Array(W * H).fill(0);
  const floor = blank(), walls = blank(), furniture = blank(), decor = blank(), overlay = blank();
  const at = (x, y) => y * W + x;

  for (const a of AREAS) { const [x1, y1, x2, y2] = a.rect; for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) floor[at(x, y)] = TILE[a.floor]; }
  const wallSet = new Set();
  for (const [x1, y1, x2, y2] of WALLS) for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) wallSet.add(at(x, y));
  for (const [x, y] of DOORS) { wallSet.delete(at(x, y)); floor[at(x, y)] = TILE.tile_light; }
  for (const k of wallSet) { const x = k % W, y = Math.floor(k / W); walls[k] = wallSet.has(at(x, y + 1)) ? TILE.wall_cap : TILE.wall_face; }
  for (const f of FURNITURE) {
    for (let y = f.y; y < f.y + (f.h ?? 1); y++) for (let x = f.x; x < f.x + (f.w ?? 1); x++) {
      furniture[at(x, y)] = f.type === "desk" ? (((x >> 2) + (y >> 2)) % 2 === 0 ? TILE.desk_a : TILE.desk_b) : FURNITURE_TILE[f.type];
    }
    if (f.type === "plant") overlay[at(f.x, f.y - 1)] = TILE.plant_top;
  }
  for (const s of SPOTS) if (s.type === "seat") decor[at(s.x, s.y)] = TILE.chair;

  const tl = (id, name, data, collides) => ({
    id, name, type: "tilelayer", x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data,
    ...(collides ? { properties: [{ name: "collides", type: "bool", value: true }] } : {}),
  });
  let oid = 1;
  const zones = AREAS.map((a) => {
    const [x1, y1, x2, y2] = a.rect;
    return {
      id: oid++, name: a.room, type: "area", class: "area", x: x1 * T, y: y1 * T, width: (x2 - x1 + 1) * T, height: (y2 - y1 + 1) * T, rotation: 0, visible: true,
      properties: [prop("room", a.room), prop("label", a.label), prop("kind", a.kind), prop("focusable", a.focusable), prop("silent", false), prop("capacity", SPOTS.filter((s) => s.room === a.room).length)],
    };
  });
  const point = (name, cls, x, y, properties) => ({ id: oid++, name, type: cls, class: cls, x: x * T + T / 2, y: y * T + T / 2, width: 0, height: 0, point: true, rotation: 0, visible: true, properties });
  const spots = [
    point("start", "start", START[0], START[1], [prop("start", true)]),
    ...SPOTS.map((s) => point(`${s.room}-${s.slot}`, s.type, s.x, s.y, [prop("room", s.room), prop("slot", s.slot), ...(s.facing ? [prop("facing", s.facing)] : [])])),
  ];
  return {
    compressionlevel: -1, width: W, height: H, tilewidth: T, tileheight: T, infinite: false, orientation: "orthogonal", renderorder: "right-down",
    type: "map", version: "1.10", tiledversion: "1.10.2", nextlayerid: 8, nextobjectid: oid,
    layers: [
      tl(1, "floor", floor, false), tl(2, "walls", walls, true), tl(3, "furniture", furniture, true), tl(4, "decor", decor, false), tl(5, "overlay", overlay, false),
      { id: 6, name: "zones", type: "objectgroup", draworder: "topdown", opacity: 1, visible: true, x: 0, y: 0, objects: zones },
      { id: 7, name: "spots", type: "objectgroup", draworder: "topdown", opacity: 1, visible: true, x: 0, y: 0, objects: spots },
    ],
    tilesets: [{ firstgid: 1, name: "tiles", tilewidth: T, tileheight: T, tilecount: 128, columns: 16, image: "tiles.png", imagewidth: 512, imageheight: 256, margin: 0, spacing: 0 }],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const out = new URL("../app/public/office2/map.json", import.meta.url);
  fs.mkdirSync(new URL(".", out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(buildMap()));
  console.log(`office2 map ${W}x${H}: ${AREAS.length} areas, ${SPOTS.length} spots`);
}
```
3. `scripts/preview_office2_map.mjs`:
```js
// Renders app/public/office2/map.json + tiles.png to a single PNG so a human (or Claude) can look at the map without starting the app.
// Run: node scripts/preview_office2_map.mjs [outFile] [scale]     default outFile: docs/virtualOffice/previews/map.png, scale 1
import fs from "node:fs";
import { encodePng, decodePng } from "./office2_png.mjs";

const mapPath = new URL("../app/public/office2/map.json", import.meta.url);
const tilesPath = new URL("../app/public/office2/tiles.png", import.meta.url);
const outPath = process.argv[2] ?? new URL("../docs/virtualOffice/previews/map.png", import.meta.url);
const scale = Number(process.argv[3] ?? 1);

const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const tiles = decodePng(fs.readFileSync(tilesPath));
const T = map.tilewidth, cols = map.tilesets[0].columns;
const W = map.width * T, H = map.height * T;
const px = new Uint8Array(W * H * 4);
const blend = (i, r, g, b, a) => { const k = a / 255; px[i] = px[i] * (1 - k) + r * k; px[i + 1] = px[i + 1] * (1 - k) + g * k; px[i + 2] = px[i + 2] * (1 - k) + b * k; px[i + 3] = 255; };
for (const name of ["floor", "walls", "furniture", "decor", "overlay"]) {
  const layer = map.layers.find((l) => l.name === name);
  layer.data.forEach((gid, n) => {
    if (!gid) return;
    const sx = ((gid - 1) % cols) * T, sy = Math.floor((gid - 1) / cols) * T, dx = (n % map.width) * T, dy = Math.floor(n / map.width) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const s = ((sy + y) * tiles.width + sx + x) * 4;
      if (tiles.rgba[s + 3]) blend(((dy + y) * W + dx + x) * 4, tiles.rgba[s], tiles.rgba[s + 1], tiles.rgba[s + 2], tiles.rgba[s + 3]);
    }
  });
}
let out = { width: W, height: H, rgba: px };
if (scale > 1) {
  const w2 = W * scale, h2 = H * scale, big = new Uint8Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) big.set(px.subarray((Math.floor(y / scale) * W + Math.floor(x / scale)) * 4, (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4 + 4), (y * w2 + x) * 4);
  out = { width: w2, height: h2, rgba: big };
}
fs.mkdirSync(new URL("../docs/virtualOffice/previews/", import.meta.url), { recursive: true });
fs.writeFileSync(outPath, encodePng(out.width, out.height, out.rgba));
console.log(`preview ${out.width}x${out.height} -> ${outPath instanceof URL ? outPath.pathname : outPath}`);
```
4. `app/tests/office2.map.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMap } from "../src/office2/mapModel.ts";
import { buildMap } from "../../scripts/gen_office2_map.mjs";

const real = JSON.parse(fs.readFileSync(new URL("../public/office2/map.json", import.meta.url), "utf8"));

test("committed map.json is exactly what the generator produces", () => {
  assert.equal(JSON.stringify(real), JSON.stringify(buildMap()));
});

test("real map: size, rooms, seats, start", () => {
  const m = parseMap(real);
  assert.deepEqual([m.width, m.height, m.tile], [60, 40, 32]);
  const rooms = new Set(m.areas.map((a) => a.room));
  for (const r of ["engineering", "operations", "founder", "corridor", "meeting", "tools", "lounge", "server", "reception"]) assert.ok(rooms.has(r), r);
  assert.ok(m.spots.filter((s) => s.type === "seat").length >= 31);
  assert.deepEqual(m.start, [52, 9]);
  assert.equal(m.roomAt(52, 9), "founder");
  assert.equal(m.roomAt(5, 5), "engineering");
  assert.equal(m.roomAt(0, 0), null);
});

test("real map: walls and furniture block, floor does not", () => {
  const m = parseMap(real);
  assert.equal(m.blocked[0][0], true); // outer wall
  assert.equal(m.blocked[3][3], true); // desk
  assert.equal(m.blocked[4][3], false); // its chair
  assert.equal(m.blocked[14][10], false); // door gap
  assert.equal(m.blocked[14][5], true); // wall next to the door
});

test("real map: layers follow the contract", () => {
  assert.deepEqual(real.layers.map((l) => l.name), ["floor", "walls", "furniture", "decor", "overlay", "zones", "spots"]);
  const collides = real.layers.filter((l) => (l.properties ?? []).some((p) => p.name === "collides" && p.value === true)).map((l) => l.name);
  assert.deepEqual(collides, ["walls", "furniture"]);
  for (const l of real.layers.filter((l) => l.type === "tilelayer")) assert.equal(l.data.length, 60 * 40);
});

test("broken maps are rejected with a readable message", () => {
  const clone = () => JSON.parse(JSON.stringify(real));
  const noStart = clone(); noStart.layers.find((l) => l.name === "spots").objects = noStart.layers.find((l) => l.name === "spots").objects.filter((o) => o.class !== "start");
  assert.throws(() => parseMap(noStart), /no start point/);
  const noRoom = clone(); noRoom.layers.find((l) => l.name === "zones").objects = noRoom.layers.find((l) => l.name === "zones").objects.filter((o) => o.name !== "tools");
  assert.throws(() => parseMap(noRoom), /missing room 'tools'/);
  const blockedSpot = clone();
  const sp = blockedSpot.layers.find((l) => l.name === "spots").objects.find((o) => o.name === "engineering-0");
  blockedSpot.layers.find((l) => l.name === "furniture").data[Math.floor(sp.y / 32) * 60 + Math.floor(sp.x / 32)] = 32;
  assert.throws(() => parseMap(blockedSpot), /blocked/);
});
```
5. Write `app/src/office2/mapModel.ts` exporting `parseMap(json: unknown): MapModel` (types in `types.ts`). Contract:
   - `blocked[y][x]` is true where any tile layer that has the bool layer property `collides: true` has a non-zero gid.
   - `areas`: objects of the object layer `zones` with `class === "area"`; properties `room,label,kind,focusable,silent,capacity` read from the Tiled `properties` array (`[{name,type,value}]`); x,y,w,h converted from pixels to tiles (divide by `tilewidth`).
   - `spots`: point objects of layer `spots` with class `seat` or `spot` (properties `room`, `slot`, optional `facing` in up/down/left/right, optional `owner`); tile = floor(pixel / tilewidth). The object with class `start` (or property `start: true`) gives `start`.
   - `roomAt(x,y)`: the smallest area containing the tile, else null.
   - Throw `Error` with exactly these messages: `map has no start point (object with class 'start' in layer 'spots')`; `map is missing room '<id>'` for each of engineering, operations, meeting, tools, lounge, founder; `spot <room>-<slot> refers to unknown room '<room>'`; `spot <room>-<slot> at <x>,<y> is blocked or outside the map`; `start point is blocked`; `spot <room>-<slot> at <x>,<y> is not reachable from start` (4-neighbour flood fill from start); `need at least 24 work seats, found <n>` (seats whose room has kind `work`).

**Commands and Expected**
```powershell
cd D:\Projects\COOS; node scripts/gen_office2_map.mjs          # Expected: office2 map 60x40: 9 areas, 97 spots
node scripts/preview_office2_map.mjs                           # Expected: preview 1920x1280 -> .../docs/virtualOffice/previews/map.png
cd app; node --test tests/office2.map.test.mjs                 # Expected: "ℹ pass 5", "ℹ fail 0"
npx tsc --noEmit -p tsconfig.office2.json                      # Expected: no output
```
**Acceptance**: open `docs/virtualOffice/previews/map.png`: nine rooms (blue, green, wood, corridor, purple, dark, wood, grey, light) with desks, machines, racks, sofas.
**Commit**: stage the 8 files; message `office2: P03 layout, Tiled map generator and parser`.
**Stop and report if** the map test count or any message differs.

---

## P04 - pathfinding and behaviour rules (pure)

**Context**: read `03_target_design.md` sections 7 and 5 (movement).
**Create**: `app/src/office2/pathfind.ts`, `app/src/office2/behavior.ts`, `app/tests/office2.pathfind.test.mjs`, `app/tests/office2.behavior.test.mjs`.
**Do not touch**: `app/src/office/behavior.ts` (old, stays).

Tests (verbatim):
`app/tests/office2.pathfind.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { findPath, nearestFree } from "../src/office2/pathfind.ts";

// 5x5 grid, '#' = blocked
const grid = (rows) => rows.map((r) => [...r].map((c) => c === "#"));
const G = grid([
  ".....",
  ".###.",
  ".....",
  ".#.#.",
  ".....",
]);

test("shortest path length and shape (start excluded, goal included)", () => {
  const p = findPath(G, [0, 0], [4, 0]);
  assert.equal(p.length, 4);
  assert.deepEqual(p.at(-1), [4, 0]);
  const q = findPath(G, [0, 0], [4, 2]);
  assert.equal(q.length, 6); // 4 right + 2 down, around the wall block
});

test("never steps on a blocked tile and moves 1 tile at a time", () => {
  const p = findPath(G, [0, 4], [4, 0]);
  let prev = [0, 4];
  for (const [x, y] of p) {
    assert.equal(G[y][x], false);
    assert.equal(Math.abs(x - prev[0]) + Math.abs(y - prev[1]), 1);
    prev = [x, y];
  }
});

test("empty result: same tile, blocked goal, out of range, no route", () => {
  assert.deepEqual(findPath(G, [0, 0], [0, 0]), []);
  assert.deepEqual(findPath(G, [0, 0], [2, 1]), []);
  assert.deepEqual(findPath(G, [0, 0], [9, 9]), []);
  const walled = grid([".#.", ".#.", ".#."]);
  assert.deepEqual(findPath(walled, [0, 0], [2, 0]), []);
});

test("nearestFree skips blocked and occupied tiles", () => {
  assert.deepEqual(nearestFree(G, [1, 1], new Set()), [0, 1]);
  assert.deepEqual(nearestFree(G, [0, 0], new Set(["0,0"])), [1, 0]);
  const one = grid(["#.", "##"]);
  assert.equal(nearestFree(one, [0, 0], new Set(["1,0"])), null);
});
```
`app/tests/office2.behavior.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { placeFor, createWalkQueue, assignSpot } from "../src/office2/behavior.ts";

test("placeFor covers every AgentState from backend/python/core/contracts.py", () => {
  const table = {
    planning: "meeting", waiting_tool: "tools", testing: "tools", repairing: "tools",
    waiting_human: "founder", escalated: "founder",
    working: "desk", error: "desk", rolled_back: "desk", deprecated: "desk",
  };
  for (const [state, place] of Object.entries(table)) assert.equal(placeFor(state, 10), place, state);
  assert.equal(placeFor("idle", 12), "lounge");
  assert.equal(placeFor("idle", 11), "desk");
  assert.equal(placeFor("idle", 13), "desk");
  assert.equal(placeFor("idle", 22), "desk");
  assert.equal(placeFor("something-new", 10), "desk");
});

test("walk queue: at most 4 walk at once, FIFO promotion", () => {
  const q = createWalkQueue(4);
  const started = ["a", "b", "c", "d", "e", "f"].map((id) => q.request(id));
  assert.deepEqual(started, [true, true, true, true, false, false]);
  assert.deepEqual(q.waiting(), ["e", "f"]);
  assert.equal(q.request("a"), true); // already walking
  assert.equal(q.request("e"), false); // already waiting, not duplicated
  assert.deepEqual(q.waiting(), ["e", "f"]);
  assert.equal(q.finish("b"), "e");
  assert.deepEqual(q.active().sort(), ["a", "c", "d", "e"]);
  assert.equal(q.finish("a"), "f");
  assert.equal(q.finish("c"), null);
  assert.equal(q.finish("zzz"), null); // unknown id is harmless
});

test("walk queue: a waiting id that is removed never starts", () => {
  const q = createWalkQueue(1);
  q.request("a"); q.request("b"); q.request("c");
  assert.equal(q.finish("b"), null); // b leaves the queue
  assert.equal(q.finish("a"), "c");
});

test("assignSpot is stable per slug, skips taken spots, returns null when full", () => {
  const spots = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 }));
  const first = assignSpot(spots, new Set(), "forge");
  assert.deepEqual(assignSpot(spots, new Set(), "forge"), first);
  const second = assignSpot(spots, new Set([`${first.x},${first.y}`]), "forge");
  assert.notDeepEqual(second, first);
  const all = new Set(spots.map((s) => `${s.x},${s.y}`));
  assert.equal(assignSpot(spots, all, "forge"), null);
  assert.equal(assignSpot([], new Set(), "forge"), null);
});

test("ring colours: every state has one, unknown falls back to idle, attention states", async () => {
  const { ringColor, isAttention } = await import("../src/office2/behavior.ts");
  for (const s of ["idle", "planning", "working", "waiting_tool", "waiting_human", "testing", "repairing", "rolled_back", "escalated", "error", "deprecated"]) assert.equal(typeof ringColor(s), "number", s);
  assert.equal(ringColor("nope"), ringColor("idle"));
  assert.equal(ringColor("error"), 0xef4444);
  assert.equal(ringColor("working"), 0x22c55e);
  assert.equal(isAttention("error"), true);
  assert.equal(isAttention("escalated"), true);
  assert.equal(isAttention("waiting_human"), true);
  assert.equal(isAttention("working"), false);
});
```

Write the implementations so these tests pass. Exact exports:
- `pathfind.ts`: `findPath(blocked: boolean[][], from: Pt, to: Pt): Pt[]` (A*, 4-neighbour, path excludes start, `[]` if same tile / blocked or out-of-range goal / no route); `nearestFree(blocked, target: Pt, occupied: ReadonlySet<string>): Pt | null` (breadth-first rings, occupied keys are `"x,y"`). `Pt` comes from `./types.ts` (`import type`).
- `behavior.ts`: `placeFor(state: string, hour: number): Place` (table in `03_target_design.md` section 7; `Place` from types); `createWalkQueue(max = 4): WalkQueue` with `request(id): boolean`, `finish(id): string | null`, `active(): string[]`, `waiting(): string[]`; `assignSpot<T extends {x:number;y:number}>(spots: readonly T[], taken: ReadonlySet<string>, slug: string): T | null` (start index `hash(slug) % n` using `./hash.ts`, probe forward); `STATE_RING` (Record<string, number>): idle 0x64748b, working 0x22c55e, planning 0x38bdf8, waiting_human 0xf59e0b, error 0xef4444, testing 0xa855f7, waiting_tool 0x14b8a6, repairing 0xf97316, rolled_back 0xdc2626, escalated 0xfbbf24, deprecated 0x475569; `ringColor(state): number` (unknown -> idle); `isAttention(state): boolean` (error, waiting_human, escalated).

**Commands and Expected**
```powershell
cd D:\Projects\COOS\app
node --test tests/office2.pathfind.test.mjs    # Expected: ℹ pass 4, ℹ fail 0
node --test tests/office2.behavior.test.mjs    # Expected: ℹ pass 5, ℹ fail 0
npx tsc --noEmit -p tsconfig.office2.json      # Expected: no output
```
**Commit**: stage the 4 files; message `office2: P04 A* pathfinding, placement rules, walk queue`.

---

## P05 - scene v0: map on screen, panel, first browser test

**Context**: Phaser 3.90 is installed (`app/node_modules/phaser`). Read `03_target_design.md` sections 5 and 11.
**Create**: `app/src/office2/OfficeScene.ts`, `e2e/tests/office2.spec.ts`.
**Replace the stub**: `app/src/components/panels/Office2Panel.tsx`.
**Do not touch**: `e2e/tests/app.spec.ts`, old office files.

1. `app/src/office2/OfficeScene.ts` (this skeleton was type-checked by Claude; later prompts extend it in small edits):
```ts
import Phaser from "phaser";
import { parseMap } from "./mapModel.ts";
import type { MapModel } from "./types.ts";

export const T = 32;
/** Draw order bands. Avatars use their own y as depth (perspective), which is always below `overlay`. */
export const DEPTH = { tiles: 0, overlay: 1_000_000, halo: 1_050_000, tags: 1_100_000, ui: 1_200_000 } as const;

declare global {
  interface Window { __officeFps?: number; __officeFrameMs?: number; __officePeople?: number }
}

export class OfficeScene extends Phaser.Scene {
  model!: MapModel;

  constructor() { super("office2"); }

  preload() {
    this.load.tilemapTiledJSON("office2-map", "/office2/map.json");
    this.load.image("office2-tiles", "/office2/tiles.png");
  }

  create() {
    this.model = parseMap(this.cache.tilemap.get("office2-map").data);
    const map = this.make.tilemap({ key: "office2-map" });
    const tileset = map.addTilesetImage("tiles", "office2-tiles", T, T, 0, 0)!;
    for (const name of ["floor", "walls", "furniture", "decor"]) map.createLayer(name, tileset, 0, 0)?.setDepth(DEPTH.tiles);
    map.createLayer("overlay", tileset, 0, 0)?.setDepth(DEPTH.overlay);
    for (const a of this.model.areas) {
      if (a.kind === "transit") continue;
      this.add.text(a.x * T + 8, a.y * T + 6, a.label, { fontSize: "11px", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" })
        .setAlpha(0.75).setDepth(DEPTH.tags).setResolution(2);
    }
    this.cameras.main.setBounds(0, 0, this.model.width * T, this.model.height * T);
    this.fitWorld();
    this.scale.on("resize", () => this.fitWorld());
    window.__officeFps = 0;
    window.__officePeople = 0;
    this.time.addEvent({ delay: 1000, loop: true, callback: () => { window.__officeFps = Math.round(this.game.loop.actualFps); } });
  }

  /** Zoom so the whole world is visible and centre on it. */
  fitWorld() {
    const cam = this.cameras.main;
    const w = this.model.width * T, h = this.model.height * T;
    cam.setZoom(Math.min(cam.width / w, cam.height / h)).centerOn(w / 2, h / 2);
  }
}

export interface OfficeHandle {
  scene: OfficeScene;
  /** false pauses the render loop while the panel tab is hidden */
  setActive(active: boolean): void;
  destroy(): void;
}

export async function startOffice(host: HTMLElement): Promise<OfficeHandle> {
  const scene = new OfficeScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: host, backgroundColor: "#0b0f14", pixelArt: true, roundPixels: true, antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth || 800, height: host.clientHeight || 600 },
    scene,
  });
  return {
    scene,
    setActive: (active) => { if (active) game.loop.wake(); else game.loop.sleep(); },
    destroy: () => {
      game.destroy(true);
      window.__officeFps = undefined; window.__officeFrameMs = undefined; window.__officePeople = undefined;
    },
  };
}
```
2. Replace `app/src/components/panels/Office2Panel.tsx` with:
```tsx
"use client";

import { useEffect, useRef } from "react";
import { useViewActive } from "@/lib/viewActive";
import type { OfficeHandle } from "@/office2/OfficeScene";

export function Office2Panel() {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<OfficeHandle | null>(null);
  const active = useViewActive();
  const activeRef = useRef(active);
  activeRef.current = active;

  // One Phaser game per mount. Data changes later go through handle methods; the game is never rebuilt for them.
  useEffect(() => {
    let cancelled = false;
    let h: OfficeHandle | null = null;
    (async () => {
      const { startOffice } = await import("@/office2/OfficeScene");
      if (cancelled || !host.current) return;
      h = await startOffice(host.current);
      if (cancelled) { h.destroy(); return; }
      handle.current = h;
      if (!activeRef.current) h.setActive(false);
    })();
    return () => { cancelled = true; h?.destroy(); handle.current = null; };
  }, []);

  // hidden tab: stop the render loop (the panel stays mounted so coming back is instant)
  useEffect(() => { handle.current?.setActive(active); }, [active]);

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office2-host" className="absolute inset-0" />
    </div>
  );
}
```
3. `e2e/tests/office2.spec.ts` (later prompts append tests at the END of this file only):
```ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office 2 flows. Launch pattern copied from app.spec.ts (real Electron window). Each office2 prompt appends tests at the END of this file.
const root = path.resolve(__dirname, "../..");
const SHOTS = path.join(__dirname, "..", "test-results", "office2");

declare global {
  interface Window {
    __officeFps?: number; __officeFrameMs?: number; __officePeople?: number;
    __officeDebug?: {
      people(): { slug: string; x: number; y: number; state: string; place: string }[];
      tags(): { slug: string; x: number; y: number; w: number; h: number; visible: boolean }[];
      camera(): { x: number; y: number; zoom: number };
      groups(): string[][];
      bubbleOf(slug: string): { x: number; y: number; text: string } | null;
    };
  }
}

function launchEnv(): Record<string, string> {
  const env = { ...process.env, JASPER_E2E: "1" } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // even an empty value makes Electron run as plain Node
  return env;
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

async function openPanel(id: string, query = "") {
  await page.evaluate(([h, q]) => { window.location.hash = h + q; }, [id, query]);
}
async function shot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test.beforeAll(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "jasper-e2e-office2-"));
  app = await electron.launch({
    executablePath: path.join(root, "desktop/node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop"), `--user-data-dir=${userData}`],
    env: launchEnv(),
  });
  page = await app.firstWindow();
  await page.waitForURL(/localhost:5173/, { timeout: 90_000 });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  // Warm-up: the dev server optimizes dependencies on first visit and may reload the page.
  for (const id of ["team_chat", "office2"]) {
    await page.evaluate((h) => { window.location.hash = h; }, id);
    await page.waitForTimeout(4000);
    await page.waitForLoadState("load");
  }
  consoleErrors.length = 0;
}, 240_000);

test.afterAll(async () => { await app?.close(); });

test("[P05] office2 mounts one canvas and publishes fps", async () => {
  await openPanel("office2");
  await expect(page.locator('[data-testid="office2-host"] canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__officeFps ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await page.locator('[data-testid="office2-host"] canvas').count()).toBe(1);
  await shot("p05");
  expect(consoleErrors.filter((e) => !/favicon|DevTools|Download the React DevTools/.test(e))).toEqual([]);
});
```

**Commands and Expected**
```powershell
cd D:\Projects\COOS\app; npx tsc --noEmit -p tsconfig.office2.json   # Expected: no output
cd ..\e2e; npx playwright test tests/office2.spec.ts --list          # Expected: "Total: 1 test in 1 file"
npx playwright test tests/office2.spec.ts                            # Expected: 1 passed
npx playwright test tests/app.spec.ts -g "virtual office"            # Expected: 1 passed (old office unchanged)
```
**Acceptance**: `e2e/test-results/office2/p05.png` shows the whole 60x40 office with room names, no avatars yet.
**Commit**: stage `app/src/office2/OfficeScene.ts app/src/components/panels/Office2Panel.tsx e2e/tests/office2.spec.ts`; message `office2: P05 Phaser scene renders the Tiled map`.
**Stop and report if** the canvas count is not 1 or the old office test fails.

---

## P06 - avatar look and layered art

**Context**: read `03_target_design.md` section 4. Art is procedural and checked visually by Claude.
**Create**: `app/src/office2/look.ts` (PURE, you write it), `app/src/office2/avatarArt.ts`, `app/src/office2/avatarSheet.ts`, `scripts/preview_office2_avatars.mjs`, `app/tests/office2.look.test.mjs`, `docs/virtualOffice/previews/avatars.png` (generated).

1. `app/tests/office2.look.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { lookFor, lookKey, LOOK_RANGES, CREW_COLOR } from "../src/office2/look.ts";

const slugs = ["jasper", "scout", "forge", "atlas", "nova", "echo", "pixel", "quill", "sage", "bolt", "iris", "kite",
  "lumen", "mason", "nexus", "orion", "pilot", "quark", "rhea", "sol", "tango", "umber", "vega", "wren"];

test("deterministic: same input gives the same look, different crew only changes the shirt", () => {
  assert.deepEqual(lookFor("forge", "it", "bot"), lookFor("forge", "it", "bot"));
  const a = lookFor("forge", "it", "bot"), b = lookFor("forge", "sre", "bot");
  assert.equal(a.shirtColor, CREW_COLOR.it);
  assert.equal(b.shirtColor, CREW_COLOR.sre);
  assert.deepEqual({ ...a, shirtColor: "" }, { ...b, shirtColor: "" });
});

test("24 bot slugs produce at least 20 distinct looks", () => {
  const keys = new Set(slugs.map((s) => lookKey(lookFor(s, "it", "bot"))));
  assert.ok(keys.size >= 20, `only ${keys.size} distinct looks`);
});

test("every field stays inside LOOK_RANGES", () => {
  for (const s of slugs) {
    const l = lookFor(s, "unknown-crew", "bot");
    for (const k of Object.keys(LOOK_RANGES)) assert.ok(l[k] >= 0 && l[k] < LOOK_RANGES[k], `${s}.${k}=${l[k]}`);
    assert.equal(l.shirtColor, CREW_COLOR.unmapped);
  }
});

test("humans get the founder outfit (index 3)", () => {
  assert.equal(lookFor("founder", "human", "human").outfit, 3);
});

test("override merges valid fields and ignores invalid ones", () => {
  const base = lookFor("forge", "it", "bot");
  const l = lookFor("forge", "it", "bot", { hair: 2, skin: 99, accessory: -1, outfit: 1.5, shirtColor: "#112233", hairColor: "x" });
  assert.equal(l.hair, 2);
  assert.equal(l.skin, base.skin);
  assert.equal(l.accessory, base.accessory);
  assert.equal(l.outfit, base.outfit);
  assert.equal(l.hairColor, base.hairColor);
  assert.equal(l.shirtColor, "#112233");
  assert.equal(lookFor("forge", "it", "bot", { shirtColor: "red" }).shirtColor, CREW_COLOR.it);
});
```
2. `app/src/office2/avatarArt.ts`:
```ts
import type { Look } from "./types.ts";

/** Minimal drawing target: a canvas 2D wrapper in the browser, an RGBA buffer in node scripts/tests. Coordinates are 0..31 inside one 32x32 frame. */
export interface Surface { rect(x: number, y: number, w: number, h: number, color: string): void }
export type Dir = "down" | "left" | "right" | "up";
export const DIR_ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
export const FRAME = 32;

export const SKIN = ["#f5d0b0", "#e7b48a", "#c98a5e", "#9a6340", "#6b4128"] as const;
export const HAIR = ["#1f1a17", "#4b2e1b", "#8a5a2b", "#d6a24a", "#c8c8c8", "#5b3aa6"] as const;
export const HAIR_STYLES = 8, ACCESSORIES = 5, OUTFITS = 4; // outfits 0-2 for bots, 3 = founder

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** Multiply a #rrggbb colour (f < 1 darker, f > 1 lighter). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => clamp(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const mirror = (s: Surface): Surface => ({ rect: (x, y, w, h, c) => s.rect(FRAME - x - w, y, w, h, c) });
export const offset = (s: Surface, ox: number, oy: number): Surface => ({ rect: (x, y, w, h, c) => s.rect(ox + x, oy + y, w, h, c) });

const INK = "#111827";

function drawShadow(s: Surface) { s.rect(9, 27, 14, 3, "rgba(0,0,0,0.22)"); s.rect(11, 26, 10, 1, "rgba(0,0,0,0.12)"); }

/** body layer: legs, shoes, arms/hands (skin), neck and head */
function drawBody(s: Surface, look: Look, dir: Dir, step: number) {
  const skin = SKIN[look.skin], pants = look.outfit === 3 ? "#1e293b" : "#334155", shoe = "#0f172a";
  const sw = step - 1; // -1, 0, 1
  if (dir === "down" || dir === "up") {
    const lh = step === 0 ? 5 : 6, rh = step === 2 ? 5 : 6;
    s.rect(12, 21, 4, lh, pants); s.rect(16, 21, 4, rh, pants);
    s.rect(12, 21 + lh - 1, 4, 2, shoe); s.rect(16, 21 + rh - 1, 4, 2, shoe);
    s.rect(9, 14 - (sw < 0 ? 1 : 0), 2, 7, skin); s.rect(21, 14 - (sw > 0 ? 1 : 0), 2, 7, skin);
    s.rect(14, 11, 4, 2, shade(skin, 0.85));
    s.rect(11, 3, 10, 9, skin); s.rect(10, 6, 1, 3, skin); s.rect(21, 6, 1, 3, skin); // head + ears
    s.rect(11, 11, 10, 1, shade(skin, 0.85));
    if (dir === "down") { s.rect(13, 7, 2, 2, INK); s.rect(17, 7, 2, 2, INK); s.rect(15, 10, 2, 1, shade(skin, 0.7)); }
  } else {
    const m = dir === "left" ? mirror(s) : s;
    const back = sw === 0 ? 14 : 14 - sw * 2, front = sw === 0 ? 15 : 15 + sw * 2;
    m.rect(back, 21, 3, step === 1 ? 6 : 5, pants); m.rect(back, 21 + (step === 1 ? 6 : 5) - 1, 4, 2, shoe);
    m.rect(front, 21, 3, 6, pants); m.rect(front, 26, 4, 2, shoe);
    m.rect(14 - sw * 2, 14, 3, 7, skin); // arm swings with the step
    m.rect(14, 11, 4, 2, shade(skin, 0.85));
    m.rect(12, 3, 9, 9, skin); m.rect(11, 6, 1, 3, shade(skin, 0.9));
    m.rect(18, 7, 2, 2, INK); m.rect(21, 8, 1, 2, skin);
  }
}

/** outfit layer: torso + sleeves (colour from the crew), 4 cuts */
function drawOutfit(s: Surface, look: Look, dir: Dir, step: number) {
  const c = look.outfit === 3 ? "#0f1d3a" : look.shirtColor, dark = shade(c, 0.7), light = shade(c, 1.25), sw = step - 1;
  if (dir === "down" || dir === "up") {
    s.rect(11, 12, 10, 10, c); s.rect(11, 21, 10, 1, dark); s.rect(11, 12, 10, 1, light);
    s.rect(9, 13 - (sw < 0 ? 1 : 0), 2, 4, c); s.rect(21, 13 - (sw > 0 ? 1 : 0), 2, 4, c);
    if (look.outfit === 1) { // hoodie: hood ring + pocket
      s.rect(12, 11, 8, 2, dark); if (dir === "down") { s.rect(13, 17, 6, 3, dark); s.rect(15, 12, 1, 4, light); s.rect(17, 12, 1, 4, light); }
    } else if (look.outfit === 2) { // blazer: lapels
      if (dir === "down") { s.rect(15, 12, 2, 9, "#e2e8f0"); s.rect(12, 12, 3, 6, dark); s.rect(17, 12, 3, 6, dark); }
    } else if (look.outfit === 3 && dir === "down") { // founder suit + tie
      s.rect(14, 12, 4, 3, "#e2e8f0"); s.rect(15, 13, 2, 8, "#b91c1c"); s.rect(12, 12, 2, 8, "#1e2a4a"); s.rect(18, 12, 2, 8, "#1e2a4a");
    }
  } else {
    const m = dir === "left" ? mirror(s) : s;
    m.rect(12, 12, 8, 10, c); m.rect(12, 21, 8, 1, dark); m.rect(12, 12, 8, 1, light);
    m.rect(14 - sw * 2, 13, 3, 4, dark);
    if (look.outfit === 1) m.rect(12, 11, 7, 2, dark);
    if (look.outfit === 3) { m.rect(17, 13, 2, 8, "#b91c1c"); }
  }
}

/** hair layer: 8 styles */
function drawHair(s: Surface, look: Look, dir: Dir) {
  const c = HAIR[look.hairColor], d = shade(c, 0.7), l = shade(c, 1.3), st = look.hair % HAIR_STYLES;
  const front = dir === "down" || dir === "up";
  if (front) {
    const back = dir === "up";
    if (st === 7) { s.rect(11, 3, 10, back ? 8 : 1, c); return; } // bald-ish: thin top band
    s.rect(10, 2, 12, back ? 9 : 4, c); s.rect(10, 2, 12, 1, l);
    if (!back) { s.rect(10, 6, 2, st === 2 ? 8 : 3, c); s.rect(20, 6, 2, st === 2 ? 8 : 3, c); }
    if (st === 1 && !back) { s.rect(11, 5, 6, 2, c); s.rect(17, 5, 4, 1, d); } // side part
    if (st === 2) { s.rect(10, 6, 2, back ? 8 : 8, c); s.rect(20, 6, 2, 8, c); if (back) s.rect(11, 10, 10, 4, c); } // long
    if (st === 3) { s.rect(14, 0, 4, 3, c); s.rect(15, 0, 2, 1, l); } // bun
    if (st === 4) { s.rect(10, 2, 12, 2, c); } // buzz handled by short height
    if (st === 5) { s.rect(9, 2, 14, 5, c); s.rect(9, 6, 2, 3, c); s.rect(21, 6, 2, 3, c); } // curly/afro
    if (st === 6) { for (const x of [11, 14, 17, 20]) s.rect(x, 0, 2, 3, c); } // spiky
    s.rect(10, 4, 12, 1, d);
  } else {
    const m = dir === "left" ? mirror(s) : s;
    if (st === 7) { m.rect(12, 3, 7, 1, c); return; }
    m.rect(11, 2, 10, 4, c); m.rect(11, 2, 10, 1, l); m.rect(11, 5, 4, st === 2 ? 9 : 5, c);
    if (st === 3) m.rect(10, 1, 4, 4, c);
    if (st === 5) { m.rect(10, 1, 11, 6, c); }
    if (st === 6) for (const x of [12, 15, 18]) m.rect(x, 0, 2, 3, c);
    m.rect(11, 4, 10, 1, d);
  }
}

/** accessory layer: 0 none, 1 glasses, 2 headset, 3 cap, 4 badge on a lanyard */
function drawAccessory(s: Surface, look: Look, dir: Dir) {
  const a = look.accessory % ACCESSORIES, front = dir === "down" || dir === "up";
  if (a === 1 && dir !== "up") {
    if (front) { s.rect(12, 6, 3, 3, INK); s.rect(17, 6, 3, 3, INK); s.rect(13, 7, 1, 1, "#bae6fd"); s.rect(18, 7, 1, 1, "#bae6fd"); s.rect(15, 7, 2, 1, INK); }
    else { const m = dir === "left" ? mirror(s) : s; m.rect(17, 6, 4, 3, INK); m.rect(18, 7, 2, 1, "#bae6fd"); m.rect(12, 7, 5, 1, INK); }
  } else if (a === 2) {
    if (front) { s.rect(9, 5, 2, 5, "#1f2937"); s.rect(21, 5, 2, 5, "#1f2937"); s.rect(10, 2, 12, 1, "#374151"); if (dir === "down") s.rect(11, 9, 3, 1, "#374151"); }
    else { const m = dir === "left" ? mirror(s) : s; m.rect(14, 5, 3, 5, "#1f2937"); m.rect(12, 2, 8, 1, "#374151"); m.rect(18, 9, 3, 1, "#374151"); }
  } else if (a === 3) {
    if (front) { s.rect(10, 1, 12, 4, "#1d4ed8"); s.rect(9, 5, 14, 1, "#1e3a8a"); }
    else { const m = dir === "left" ? mirror(s) : s; m.rect(11, 1, 10, 4, "#1d4ed8"); m.rect(18, 5, 6, 1, "#1e3a8a"); }
  } else if (a === 4 && dir === "down") {
    s.rect(15, 12, 1, 6, "#e2e8f0"); s.rect(14, 18, 4, 3, "#f8fafc"); s.rect(15, 19, 2, 1, "#64748b");
  }
}

/** Draws one 32x32 frame (all layers, bottom to top). step: 0 left foot forward, 1 standing, 2 right foot forward. */
export function drawAvatarFrame(s: Surface, look: Look, dir: Dir, step: number): void {
  drawShadow(s);
  drawBody(s, look, dir, step);
  drawOutfit(s, look, dir, step);
  drawHair(s, look, dir);
  drawAccessory(s, look, dir);
}

/** Draws the full 96x128 sheet: columns = steps 0..2, rows = down, left, right, up. */
export function drawAvatarSheet(s: Surface, look: Look): void {
  for (const dir of ["down", "left", "right", "up"] as Dir[]) for (let step = 0; step < 3; step++) drawAvatarFrame(offset(s, step * FRAME, DIR_ROW[dir] * FRAME), look, dir, step);
}
```
3. `app/src/office2/avatarSheet.ts` (browser only):
```ts
import type Phaser from "phaser";
import { DIR_ROW, FRAME, drawAvatarFrame, drawAvatarSheet, type Dir, type Surface } from "./avatarArt.ts";
import { lookKey } from "./look.ts";
import type { Look } from "./types.ts";

export const DIRS: readonly Dir[] = ["down", "left", "right", "up"];

const ctxSurface = (ctx: CanvasRenderingContext2D): Surface => ({
  rect: (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); },
});

/** Texture key for a look. Same look -> same key, so avatars with equal looks share one texture. */
export const avatarKey = (look: Look): string => `av:${lookKey(look)}`;

/** Registers (once per look) a Phaser texture with 12 frames (3 per direction, row order down/left/right/up) and the animations
 *  `<key>:walk:<dir>` (frames 0,1,2,1 at 8 fps, looping) and `<key>:idle:<dir>` (the standing frame). Returns the texture key. */
export function ensureAvatar(scene: Phaser.Scene, look: Look): string {
  const key = avatarKey(look);
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement("canvas");
  canvas.width = FRAME * 3; canvas.height = FRAME * 4;
  drawAvatarSheet(ctxSurface(canvas.getContext("2d")!), look);
  const tex = scene.textures.addCanvas(key, canvas)!;
  for (let f = 0; f < 12; f++) tex.add(f, 0, (f % 3) * FRAME, Math.floor(f / 3) * FRAME, FRAME, FRAME);
  for (const dir of DIRS) {
    const row = DIR_ROW[dir] * 3;
    scene.anims.create({ key: `${key}:walk:${dir}`, frames: [0, 1, 2, 1].map((i) => ({ key, frame: row + i })), frameRate: 8, repeat: -1 });
    scene.anims.create({ key: `${key}:idle:${dir}`, frames: [{ key, frame: row + 1 }], frameRate: 1 });
  }
  return key;
}

/** Standing front view as a data URL for the ID card and dialogs, scaled up without smoothing. */
export function portraitUrl(look: Look, scale = 6): string {
  const frame = document.createElement("canvas");
  frame.width = FRAME; frame.height = FRAME;
  drawAvatarFrame(ctxSurface(frame.getContext("2d")!), look, "down", 1);
  const out = document.createElement("canvas");
  out.width = FRAME * scale; out.height = FRAME * scale;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 0, 0, out.width, out.height);
  return out.toDataURL();
}
```
4. `scripts/preview_office2_avatars.mjs`:
```js
// Renders a contact sheet of avatar looks to a PNG, without the app. Run: node scripts/preview_office2_avatars.mjs [outFile] [scale]
import fs from "node:fs";
import { encodePng } from "./office2_png.mjs";
import { drawAvatarSheet } from "../app/src/office2/avatarArt.ts";
import { lookFor } from "../app/src/office2/look.ts";

const out = process.argv[2] ?? new URL("../docs/virtualOffice/previews/avatars.png", import.meta.url);
const scale = Number(process.argv[3] ?? 3);
const slugs = ["jasper", "scout", "forge", "atlas", "nova", "echo", "pixel", "quill"];
const crews = ["l1", "coreops", "it", "baeit", "boardmint", "rnd", "people", "sre"];
const SW = 96, SH = 128, COLS = 4, ROWS = Math.ceil(slugs.length / COLS) + 1; // +1 row: the founder
const W = COLS * SW, H = ROWS * SH;
const px = new Uint8Array(W * H * 4);
const parse = (c) => {
  if (c[0] === "#") return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
  const m = c.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(Number(m[4]) * 255)];
};
const surfaceAt = (ox, oy) => ({
  rect(x, y, w, h, color) {
    const [r, g, b, a] = parse(color), k = a / 255;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const X = ox + x + i, Y = oy + y + j;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const p = (Y * W + X) * 4;
      px[p] = px[p] * (1 - k) + r * k; px[p + 1] = px[p + 1] * (1 - k) + g * k; px[p + 2] = px[p + 2] * (1 - k) + b * k; px[p + 3] = Math.max(px[p + 3], a);
    }
  },
});
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4; const v = ((x >> 4) + (y >> 4)) % 2 ? 58 : 66; px[p] = v; px[p + 1] = v + 6; px[p + 2] = v + 14; px[p + 3] = 255; }
slugs.forEach((slug, i) => drawAvatarSheet(surfaceAt((i % COLS) * SW, Math.floor(i / COLS) * SH), lookFor(slug, crews[i], "bot")));
drawAvatarSheet(surfaceAt(0, Math.ceil(slugs.length / COLS) * SH), lookFor("founder", "human", "human"));
let img = { width: W, height: H, rgba: px };
if (scale > 1) {
  const w2 = W * scale, h2 = H * scale, big = new Uint8Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const s = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4; big.set(px.subarray(s, s + 4), (y * w2 + x) * 4); }
  img = { width: w2, height: h2, rgba: big };
}
fs.mkdirSync(new URL("../docs/virtualOffice/previews/", import.meta.url), { recursive: true });
fs.writeFileSync(out, encodePng(img.width, img.height, img.rgba));
console.log(`avatars preview ${img.width}x${img.height}`);
```
5. Write `look.ts` so the test passes. Exports: `CREW_COLOR: Record<string,string>` = `{ l1:"#a855f7", coreops:"#38bdf8", it:"#22c55e", baeit:"#f97316", boardmint:"#eab308", rnd:"#ec4899", people:"#14b8a6", sre:"#ef4444", personal:"#60a5fa", exec:"#d946ef", unmapped:"#94a3b8", human:"#fbbf24" }`; `LOOK_RANGES = { skin: 5, outfit: 3, hair: 8, hairColor: 6, accessory: 5 } as const`; `FOUNDER_OUTFIT = 3`; `lookFor(slug, crew, kind: "human" | "bot", override?: Partial<Look>): Look`; `lookKey(look): string`. Each field of the base look = `hash(slug + ":" + field) % range` (hash from `./hash.ts`); humans get `outfit = 3`; `shirtColor = CREW_COLOR[crew] ?? CREW_COLOR.unmapped`; override fields are applied only if integer and inside range (outfit range is 4 for humans) and shirtColor only if `/^#[0-9a-fA-F]{6}$/`; `lookKey` = `${skin}.${outfit}.${hair}.${hairColor}.${accessory}.${shirtColor without #}`.

**Commands and Expected**
```powershell
cd D:\Projects\COOS\app; node --test tests/office2.look.test.mjs     # Expected: ℹ pass 5, ℹ fail 0
npx tsc --noEmit -p tsconfig.office2.json                            # Expected: no output
cd ..; node scripts/preview_office2_avatars.mjs                      # Expected: avatars preview 1152x1152
```
**Acceptance**: `docs/virtualOffice/previews/avatars.png` shows 8 bots + the founder, each with 3 columns (walk frames) and 4 rows (down, left, right, up), distinct hair/outfits/accessories.
**Commit**: stage the 6 files (including the png); message `office2: P06 layered avatar art and look rules`.

---

## P07 - people in the scene (roster -> avatars), simulated bots, debug hooks

**Context**: read `03_target_design.md` sections 6 and 10. Backend is not changed. There are 51 enabled bots plus the founder, so seats overflow into the lounge etc. by design.
**Create**: `app/src/office2/people.ts` (PURE, you write it), `app/tests/office2.people.test.mjs`, `app/src/office2/avatars.ts`.
**Modify**: `app/src/office2/OfficeScene.ts`, `app/src/components/panels/Office2Panel.tsx`, `e2e/tests/office2.spec.ts` (append only).

1. `app/tests/office2.people.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMap } from "../src/office2/mapModel.ts";
import { toPeople, peopleSignature, homeRoom, planSeats, makeSimPeople, OPS_CREWS } from "../src/office2/people.ts";

const model = parseMap(JSON.parse(fs.readFileSync(new URL("../public/office2/map.json", import.meta.url), "utf8")));
const dir = { humans: [{ id: "founder", display_name: "Vijay" }] };
const bot = (slug, crew, enabled = true) => ({ slug, display_name: slug.toUpperCase(), role_title: "Engineer", crew, lifecycle: "active", enabled });

test("toPeople: humans first, disabled bots dropped, bots sorted by slug, missing input is empty", () => {
  const p = toPeople(dir, { bots: [bot("zed", "it"), bot("amy", "sre"), bot("off", "it", false)] });
  assert.deepEqual(p.map((x) => [x.slug, x.kind]), [["founder", "human"], ["amy", "bot"], ["zed", "bot"]]);
  assert.equal(p[0].role, "Founder");
  assert.equal(p[0].crew, "human");
  assert.deepEqual(toPeople(undefined, undefined), []);
});

test("homeRoom: humans -> founder, ops crews -> operations, everything else -> engineering", () => {
  assert.equal(homeRoom({ kind: "human", crew: "human" }), "founder");
  for (const c of OPS_CREWS) if (c !== "human") assert.equal(homeRoom({ kind: "bot", crew: c }), "operations", c);
  for (const c of ["it", "baeit", "rnd", "coreops", "unmapped", "whatever"]) assert.equal(homeRoom({ kind: "bot", crew: c }), "engineering", c);
});

test("planSeats with a realistic roster (founder + 51 bots): everyone has a distinct tile, founder sits in the founder room, 30 desks used", () => {
  const crews = ["l1", "coreops", "it", "baeit", "boardmint", "rnd", "people", "sre", "personal", "exec", "unmapped"];
  const bots = Array.from({ length: 51 }, (_, i) => bot(`b${String(i).padStart(2, "0")}`, crews[i % crews.length]));
  const people = toPeople(dir, { bots });
  const plan = planSeats(people, model.spots);
  assert.equal(plan.size, 52);
  assert.equal(new Set([...plan.values()].map((s) => `${s.x},${s.y}`)).size, 52);
  assert.equal(plan.get("founder").room, "founder");
  assert.equal(plan.get("founder").type, "seat");
  assert.equal([...plan.values()].filter((s) => s.type === "seat" && (s.room === "engineering" || s.room === "operations")).length, 30);
  assert.deepEqual([...planSeats(people, model.spots)].map(([k, s]) => [k, s.x, s.y]), [...plan].map(([k, s]) => [k, s.x, s.y])); // deterministic
});

test("planSeats never throws and always returns a spot, even with more people than spots", () => {
  const people = toPeople(dir, { bots: Array.from({ length: 119 }, (_, i) => bot(`x${i}`, "it")) });
  const plan = planSeats(people, model.spots);
  assert.equal(plan.size, 120);
  for (const s of plan.values()) assert.ok(s && Number.isInteger(s.x) && Number.isInteger(s.y));
  assert.equal(new Set([...plan.values()].map((s) => `${s.x},${s.y}`)).size >= 70, true);
});

test("makeSimPeople: stable slugs and rotating crews", () => {
  const s = makeSimPeople(10);
  assert.deepEqual(s.slice(0, 3).map((p) => p.slug), ["sim-01", "sim-02", "sim-03"]);
  assert.equal(s.length, 10);
  assert.ok(new Set(s.map((p) => p.crew)).size >= 5);
  assert.deepEqual(makeSimPeople(10), s);
  assert.ok(s.every((p) => p.kind === "bot"));
});

test("peopleSignature changes when a visible field changes and is stable otherwise", () => {
  const a = toPeople(dir, { bots: [bot("amy", "sre")] });
  const b = toPeople(dir, { bots: [bot("amy", "sre")] });
  const c = toPeople(dir, { bots: [{ ...bot("amy", "sre"), role_title: "Lead" }] });
  assert.equal(peopleSignature(a), peopleSignature(b));
  assert.notEqual(peopleSignature(a), peopleSignature(c));
});
```
2. `people.ts` exports (types `Person`, `Spot` from types.ts): `DirectoryLike`, `RosterLike` (interfaces: `{humans?: {id:string;display_name:string}[]}` and `{bots?: {slug,display_name,role_title,crew,lifecycle?,enabled}[]}`), `OPS_CREWS: ReadonlySet<string>` = personal, boardmint, people, sre, l1, human, exec; `toPeople(dir, roster): Person[]` (humans first with role "Founder", crew "human", kind "human"; then enabled bots sorted by slug); `peopleSignature(p): string` (JSON of slug,name,role,crew,kind,lifecycle); `homeRoom(p)`: human -> "founder", crew in OPS_CREWS -> "operations", else "engineering"; `planSeats(people, spots): Map<string, Spot>` (founder: seat in room founder; bot: `seat` in home room, else `seat` in the other work room, else any spot in rooms lounge, reception, server, corridor in that order; always via `assignSpot` from `./behavior.ts` with a shared taken-set; if everything is taken share a corridor spot, never throw); `makeSimPeople(n): Person[]` (slug `sim-01`.., name `Sim <i>`, role "Simulated agent", crews rotating it, baeit, rnd, sre, personal, boardmint, people, coreops, kind bot, lifecycle "active").
3. `avatars.ts` (browser): `export class AvatarLayer` created with `(scene: Phaser.Scene, model: MapModel)`. Method `sync(people: Person[], overrides: Record<string, Partial<Look>>)`: add/remove/update avatars (never rebuild existing ones); each avatar = `Phaser.GameObjects.Sprite` using `ensureAvatar(scene, look)` from `avatarSheet.ts`, origin (0.5, 0.9), placed at `(tx*32+16, ty*32+28)`, depth = its y, interactive (pointer cursor), plus a state ring `scene.add.ellipse(x, y, 20, 9, ringColor("idle"), 0.9)` below it at depth y-1. Home tile from `planSeats`. Public fields: `avatars: Map<string, Avatar>` with `Avatar = { person: Person; look: Look; sprite; ring; tile: Pt; home: Spot; state: string; place: Place; walking: boolean; facing: Dir }`. Method `setState(slug, state)` sets ring colour via `ringColor`. Emit `scene.events.emit("avatar-select", slug)` on click. If the page URL hash contains `gather=<room>` (example `#office2?bots=40&gather=lounge`), place every avatar on distinct free tiles around the centre of that room using `nearestFree` (ignore seats); this exists only to test crowding.
4. `OfficeScene.ts`: create `this.avatars = new AvatarLayer(this, this.model)`; add method `syncPeople(people: Person[])` that calls `avatars.sync(people, {})` and sets `window.__officePeople = avatars.avatars.size`. Add `OfficeHandle.syncPeople` delegating to it. Also define and install `window.__officeDebug` (type declared in `e2e/tests/office2.spec.ts`: people(), tags(), camera(), groups(), bubbleOf(), plus two extra functions you add to the declaration in the spec: `screenOf(slug): {x:number;y:number}|null` and `walkTo(slug,tx,ty): void`): `people()` returns `{slug,x,y,state,place}` for every avatar; `tags()` returns `[]`, `groups()` returns `[]`, `bubbleOf()` returns `null`, `camera()` returns `{x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom}`; `screenOf` converts avatar world position to page pixels with `cam.worldView`, zoom and the canvas `getBoundingClientRect()`; `walkTo` is a no-op until P10.
5. `Office2Panel.tsx`: add `const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";`, `useApi` (from `@/lib/swr`) for `${API}/api/v1/directory/` (`{ ttl: 30000, poll: 30000 }`) and `${API}/api/v1/bots/` (`{ ttl: 5000, poll: 5000 }`) exactly like `app/src/components/panels/OfficePanel.tsx` does; compute `people = toPeople(...)`, plus `makeSimPeople(n)` appended when the hash query has `bots=<n>` (read `window.location.hash`, e.g. `#office2?bots=40`); a `useEffect` keyed on `peopleSignature(people)` calls `handle.current?.syncPeople(people)` (and also once right after the game starts).
6. Append to `e2e/tests/office2.spec.ts` (and update the `declare global` block as in step 4):
```ts
test("[P07] people appear on distinct spots inside the world", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const people = await page.evaluate(() => window.__officeDebug!.people());
  expect(people.length).toBeGreaterThan(5);
  expect(people.every((p) => p.x > 0 && p.x < 1920 && p.y > 0 && p.y < 1280)).toBe(true);
  expect(new Set(people.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(people.length);
  await shot("p07");
});
```
**Commands and Expected**
```powershell
cd D:\Projects\COOS\app; node --test tests/office2.people.test.mjs   # Expected: ℹ pass 6, ℹ fail 0
npx tsc --noEmit -p tsconfig.office2.json                            # Expected: no output
cd ..\e2e; npx playwright test tests/office2.spec.ts                 # Expected: 2 passed
```
**Acceptance**: `p07.png` shows avatars at desks and in the lounge, none stacked.
**Commit**: stage all created/modified files; message `office2: P07 roster to avatars, seat planning, debug hooks`.

---

## P08 - name tags that never overlap

**Context**: read `03_target_design.md` section 5 (name tags).
**Create**: `app/src/office2/nameTags.ts` (PURE), `app/tests/office2.nametags.test.mjs`, `app/src/office2/tagLayer.ts`.
**Modify**: `app/src/office2/OfficeScene.ts`, `e2e/tests/office2.spec.ts` (append).

1. `app/tests/office2.nametags.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { layoutTags, tagVisible } from "../src/office2/nameTags.ts";

const rectOf = (t, w, h) => ({ x1: t.x - w / 2, x2: t.x + w / 2, y1: t.y, y2: t.y + h });
const intersects = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

test("12 tags requested at the same point end up with no overlapping rectangles", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: 100, y: 200, w: 40, h: 10, priority: i % 3 }));
  const out = layoutTags(items);
  assert.equal(out.length, 12);
  const rects = out.map((t) => rectOf(t, 40, 10));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(intersects(rects[i], rects[j]), false, `${i} vs ${j}`);
});

test("result keeps the input order and the highest priority stays where it asked", () => {
  const items = [
    { id: "low", x: 0, y: 0, w: 30, h: 8, priority: 0 },
    { id: "high", x: 0, y: 0, w: 30, h: 8, priority: 5 },
  ];
  const out = layoutTags(items);
  assert.deepEqual(out.map((t) => t.id), ["low", "high"]);
  assert.equal(out[1].y, 0);
  assert.equal(out[1].moved, 0);
  assert.ok(out[0].y < 0 && out[0].moved > 0); // pushed up
});

test("tags that do not collide are not moved", () => {
  const out = layoutTags([
    { id: "a", x: 0, y: 0, w: 30, h: 8, priority: 0 },
    { id: "b", x: 100, y: 0, w: 30, h: 8, priority: 0 },
  ]);
  assert.deepEqual(out.map((t) => t.moved), [0, 0]);
});

test("visibility rule: hidden below zoom 0.75 except hovered, selected, founder or attention states", () => {
  assert.equal(tagVisible(1, {}), true);
  assert.equal(tagVisible(0.5, {}), false);
  assert.equal(tagVisible(0.5, { hovered: true }), true);
  assert.equal(tagVisible(0.5, { selected: true }), true);
  assert.equal(tagVisible(0.5, { founder: true }), true);
  assert.equal(tagVisible(0.5, { state: "error" }), true);
  assert.equal(tagVisible(0.5, { state: "waiting_human" }), true);
  assert.equal(tagVisible(0.5, { state: "working" }), false);
});
```
2. `nameTags.ts` exports: `interface TagItem { id; x; y; w; h; priority }` (x = centre, y = top), `interface TagPos { id; x; y; moved }`, `layoutTags(items: readonly TagItem[], gap = 2): TagPos[]` (sort by priority desc then id; place one by one; while a tag overlaps an already placed one, move it UP to `hit.y - h - gap`; return in input order; `moved = requestedY - finalY`), `tagVisible(zoom, {hovered?, selected?, founder?, state?}): boolean` (true if zoom >= 0.75 or hovered/selected/founder or state in error, waiting_human, escalated).
3. `tagLayer.ts` (browser): `class TagLayer(scene)` keeps one `Phaser.GameObjects.Text` per avatar (first name, 10px, white text on `#0f172a` at 85% via `backgroundColor`, padding 3x1, `setResolution(2)`, depth `DEPTH.tags`) and a `Graphics` for leader lines. Tag scale is `1/zoom` so it stays the same size on screen. Every 200 ms (`scene.time.addEvent`) compute `layoutTags` in WORLD units (w,h = text size / zoom; anchor y = avatar.y - 40/zoom - h; priority: founder 3, attention states 2, selected 2, others 0) and store each tag's vertical offset; EVERY frame set tag position = avatar position + stored offset (so tags follow walking avatars). Visibility via `tagVisible(cam.zoom, ...)`. Draw a thin leader line when `moved > 6` px. Provide `snapshot()` returning `{slug,x,y,w,h,visible}[]` for the debug hook.
4. `OfficeScene.ts`: instantiate `TagLayer` after `AvatarLayer`, call its `update()` from `update()`, and make `__officeDebug.tags()` return `tags.snapshot()`.
5. Append to the spec:
```ts
test("[P08] no two visible name tags overlap, even in a crowd", async () => {
  await openPanel("office2", "?bots=40&gather=lounge");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(40);
  await page.waitForTimeout(1500);
  const tags = (await page.evaluate(() => window.__officeDebug!.tags())).filter((t) => t.visible);
  expect(tags.length).toBeGreaterThan(30);
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    const a = tags[i], b = tags[j];
    expect(Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) < Math.max(a.h, b.h), `${a.slug} overlaps ${b.slug}`).toBe(false);
  }
  await shot("p08");
});
```
**Commands and Expected**: `node --test tests/office2.nametags.test.mjs` -> `ℹ pass 4`; tsc office2 -> no output; `playwright test tests/office2.spec.ts` -> `3 passed`.
**Acceptance**: `p08.png` (crowded lounge): tags stacked upward, readable.
**Commit**: `office2: P08 collision-free name tags`.

---

## P09 - camera: follow, zoom, pan, room focus, minimap

**Context**: read `03_target_design.md` section 5 (camera, minimap).
**Create**: `app/src/office2/camera.ts` (PURE), `app/tests/office2.camera.test.mjs`, `app/src/office2/cameraRig.ts`, `app/src/components/office2/Minimap.tsx`.
**Modify**: `OfficeScene.ts`, `Office2Panel.tsx`, spec (append).

1. `app/tests/office2.camera.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { ZOOM_STEPS, stepZoom, clampCenter, worldToMini, miniToWorld, fitRect } from "../src/office2/camera.ts";

test("zoom steps are fixed and stepping clamps at both ends", () => {
  assert.deepEqual([...ZOOM_STEPS], [0.5, 0.75, 1, 1.5, 2, 3]);
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(3, 1), 3);
  assert.equal(stepZoom(0.5, -1), 0.5);
  assert.equal(stepZoom(1.2, 1), 1.5); // off-grid value snaps to the nearest step first (1.0 is nearest) then moves
});

test("clampCenter keeps the view inside the world and centres a view larger than the world", () => {
  assert.deepEqual(clampCenter(0, 0, 800, 600, 1, 1920, 1280), [400, 300]);
  assert.deepEqual(clampCenter(5000, 5000, 800, 600, 1, 1920, 1280), [1520, 980]);
  assert.deepEqual(clampCenter(960, 640, 800, 600, 2, 1920, 1280), [960, 640]);
  assert.deepEqual(clampCenter(10, 10, 4000, 3000, 1, 1920, 1280), [960, 640]);
});

test("minimap transform round-trips within one tile", () => {
  const world = { w: 1920, h: 1280 }, mini = { w: 160, h: 107 };
  for (const [x, y] of [[0, 0], [960, 640], [1919, 1279], [333, 777]]) {
    const [mx, my] = worldToMini(x, y, world, mini);
    const [wx, wy] = miniToWorld(mx, my, world, mini);
    assert.ok(Math.abs(wx - x) < 32 && Math.abs(wy - y) < 32);
  }
});

test("fitRect picks the largest step (max 2) that fits and centres on the rectangle", () => {
  const f = fitRect({ x: 0, y: 0, w: 560, h: 336 }, 1280, 720, 48);
  assert.equal(f.zoom, 1.5);
  assert.deepEqual([f.cx, f.cy], [280, 168]);
  assert.equal(fitRect({ x: 0, y: 0, w: 100, h: 100 }, 1280, 720, 48).zoom, 2);
  assert.equal(fitRect({ x: 0, y: 0, w: 5000, h: 4000 }, 1280, 720, 48).zoom, 0.5);
});
```
2. `camera.ts` exports: `ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3] as const`; `stepZoom(current, dir: 1 | -1)` (snap to the nearest step first, then move one step, clamp); `clampCenter(cx, cy, viewW, viewH, zoom, worldW, worldH): [number, number]` (keep the visible rectangle inside the world; a view larger than the world is centred); `worldToMini(x, y, world:{w,h}, mini:{w,h})` and `miniToWorld(...)`; `fitRect(r:{x,y,w,h}, viewW, viewH, pad = 48): {zoom, cx, cy}` (largest step <= fit and <= 2).
3. `cameraRig.ts` (browser): `class CameraRig(scene, model, getFounderSprite)`: follow founder (`cam.startFollow(sprite, true, 0.12, 0.12)`) ON at start; mouse wheel over the canvas = `stepZoom`; left-button drag while holding Space, or middle/right button drag = pan (stops follow); keys (listen with DOM `keydown` on the Phaser canvas parent `host`, which gets `tabIndex = 0` and focus on pointerdown, so typing in other panels never triggers them): `F` toggles follow, `Home` = follow founder + zoom 1, `+`/`-` zoom, `1`-`8` = `fitRect` focus on the n-th area with `focusable` (map order); always `clampCenter`. Methods used by UI: `zoomIn()`, `zoomOut()`, `home()`, `toggleFollow()`, `centerOn(x,y)`, `isFollowing()`.
4. `OfficeScene.ts`: create the rig in `create()` (remove the old `fitWorld` call on create: start at zoom 1 centred on the founder if there is one, else on the world centre; keep `fitWorld` only for the resize handler when zoom < fit), expose `rig` on `OfficeHandle`.
5. `Minimap.tsx`: a 160x107 canvas in the bottom-right corner of the panel; static background drawn once from `MapModel` (blocked tiles dark, floor tiles light, 2.67 px per tile), avatar dots (colour by state) and the camera rectangle redrawn 4 times per second from `handle.scene` snapshots; click -> `rig.centerOn(...)` via `miniToWorld`. Also four small buttons (+, -, home, follow) in the top-right corner calling the rig. Add both to `Office2Panel.tsx` as absolutely positioned overlays (do not put React children inside the Phaser host div).
6. Append to the spec:
```ts
test("[P09] wheel zoom stays within 0.5..3 and Home re-follows", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const box = (await page.locator('[data-testid="office2-host"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  const z = (await page.evaluate(() => window.__officeDebug!.camera())).zoom;
  expect(z).toBeLessThanOrEqual(3); expect(z).toBeGreaterThan(1);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.__officeDebug!.camera())).zoom).toBeGreaterThanOrEqual(0.5);
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Home");
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.__officeDebug!.camera())).zoom).toBe(1);
  await shot("p09");
});
test("[P09] minimap click recenters the camera", async () => {
  await page.locator('[data-testid="office2-minimap"]').click({ position: { x: 20, y: 80 } });
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => window.__officeDebug!.camera());
  expect(c.x).toBeLessThan(700);
});
```
(Give the minimap canvas `data-testid="office2-minimap"`.)
**Commands and Expected**: camera test `ℹ pass 4`; tsc office2 no output; playwright office2 spec `5 passed`.
**Commit**: `office2: P09 camera rig, zoom, pan, focus, minimap`.

---

## P10 - movement: click-to-move, keyboard, walking animation, load hook

**Context**: read `03_target_design.md` section 5 (movement). Uses P04 `findPath`, `nearestFree`, `createWalkQueue`.
**Create**: `app/src/office2/walker.ts`.
**Modify**: `avatars.ts`, `OfficeScene.ts`, `Office2Panel.tsx` only if needed, spec (append).

1. `walker.ts` (browser): `class Walker(scene, model, avatars)` with `walkTo(slug, tx, ty): boolean` (A* from the avatar's current logical tile; if the target is blocked use `nearestFree`; returns false if no path), `stop(slug)`, `update(deltaMs)` called from `OfficeScene.update`. Movement is per-frame, not tweens: 140 ms per tile, linear, sprite plays `<key>:walk:<dir>` while moving and `<key>:idle:<dir>` when done; facing from the step delta; avatar `walking` flag and `tile` (target tile) updated; depth = y each frame; ring follows. Avatars never block each other. Bot-initiated walks (everything except the founder) go through `createWalkQueue(4)`: `request(slug)` false -> wait; on arrival call `finish(slug)` and start the returned slug.
2. Founder input: left click on the floor (pointer up, moved < 5 px, not Space, not over an avatar) -> `walkTo(founder, tile)`; if it returns false show a toast event `scene.events.emit("toast", "Can't go there")` (the panel shows it for 2 s in a small box). Keyboard (DOM keydown/keyup on the focused host, same focus rule as P09): arrows/WASD move the founder one tile at a time while held, ignoring blocked tiles.
3. `__officeDebug.walkTo(slug, tx, ty)` now calls the walker.
4. Load hook: if the hash has `wander=1`, every sim bot picks a random free spot (`model.spots`) every 4-8 s and walks there (through the queue).
5. Append to the spec:
```ts
test("[P10] founder walks on click; 60 wandering bots keep fps above 30", async () => {
  await openPanel("office2", "?bots=60&wander=1");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 40_000 }).toBeGreaterThan(60);
  const before = (await page.evaluate(() => window.__officeDebug!.people())).find((p) => p.slug === "founder" || p.slug.startsWith("vij")) ?? (await page.evaluate(() => window.__officeDebug!.people()))[0];
  await page.evaluate(([s]) => window.__officeDebug!.walkTo(s as string, 52, 12), [before.slug]);
  await page.waitForTimeout(3000);
  const after = (await page.evaluate(() => window.__officeDebug!.people())).find((p) => p.slug === before.slug)!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
  await page.waitForTimeout(8000);
  const fps = await page.evaluate(() => window.__officeFps ?? 0);
  expect(fps).toBeGreaterThan(30);
  await shot("p10");
});
```
**Commands and Expected**: tsc office2 no output; playwright office2 spec `6 passed`.
**Commit**: `office2: P10 walking, click-to-move, keyboard, wander load hook`.
**Note**: if fps <= 30, STOP and report the number; do not optimise here (P16 does).

---

## P11 - live agent state: ring colour, anchored bubbles, walking to rooms

**Context**: read `03_target_design.md` sections 6-7. Store `app/src/stores/liveAgentsStore.ts` (`useLiveAgents`: `agents[slug] = {slug,state,bubble,reason,seq,ts}`; `connect(url)` returns an unsubscribe fn). The old panel connects with `useEffect(() => connect(WS_URL), [connect])` where `WS_URL = API.replace(/^http/, "ws") + "/ws/rpc"`.
**Create**: `app/src/office2/liveBridge.ts`, `app/src/office2/bubbles.ts`.
**Modify**: `avatars.ts`, `OfficeScene.ts`, `Office2Panel.tsx`, spec (append).

1. `liveBridge.ts` (browser): `bindLive(scene: { applyLive(a: Record<string, LiveAgent>): void }): () => void` subscribes to `useLiveAgents`, calls `applyLive` once immediately and then at most once per animation frame (coalesce), returns the unsubscribe.
2. `bubbles.ts` (browser): `class BubbleLayer(scene)`: one bubble per avatar (Text 10px, dark text on `#e2e8f0`, padding 4x2, `setResolution(2)`, small triangle tail via Graphics, depth `DEPTH.tags + 1`). `show(slug, text)`, `hide(slug)`, `update()` each frame sets position to the avatar's `(x, y - 44)` (anchored: same frame as the avatar). Text = first 40 chars plus "…" if longer. Snapshot for the debug hook: `bubbleOf(slug) -> {x,y,text}|null`.
3. `OfficeScene.applyLive(live)`: for each avatar with a live record: `avatars.setState`, bubble = `live.bubble ?? live.reason`; show when state is not idle and text non-empty; hide after 8 s unless `isAttention(state)`; compute destination `place = placeFor(state, new Date().getHours())`; when `place` changed: `desk` -> avatar `home` tile; `meeting|tools|lounge|founder` -> `assignSpot` among spots with `type: "spot"` of that room (room id equals place; `founder` room spots) excluding tiles of other avatars (current and target); if none free use corridor spots; then `walker.walkTo`. Re-run `applyLive` every 60 s (hour changes). `deprecated`: sprite alpha 0.5.
4. `Office2Panel.tsx`: connect the store exactly as the old panel does and call `bindLive(handle.scene)` once the game is up; unsubscribe on cleanup.
5. `__officeDebug.bubbleOf` returns the bubble snapshot; `people()` includes `place`.
6. Append to the spec:
```ts
test("[P11] demo events move agents and the bubble stays glued to its avatar", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  await page.evaluate(() => {
    const seen: string[] = []; (window as unknown as { __seen: string[] }).__seen = seen;
    setInterval(() => {
      const d = window.__officeDebug!;
      for (const p of d.people()) {
        seen.push(`${p.slug}:${p.place}`);
        const b = d.bubbleOf(p.slug);
        if (b) { seen.push(`bubble:${p.slug}:${b.text}`); if (Math.abs(b.x - p.x) > 1.5) seen.push(`DETACHED:${p.slug}`); }
      }
    }, 50);
  });
  void fetch("http://127.0.0.1:8000/ws/rpc/demo", { method: "POST" });
  await page.waitForTimeout(6000);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen).toContain("jasper:meeting");
  expect(seen).toContain("forge:tools");
  expect(seen.some((s) => s.startsWith("bubble:jasper:Planning"))).toBe(true);
  expect(seen.filter((s) => s.startsWith("DETACHED"))).toEqual([]);
  await shot("p11");
});
```
**Commands and Expected**: tsc office2 no output; playwright office2 spec `7 passed`; `cd e2e; npx playwright test tests/app.spec.ts -g "virtual office"` -> `1 passed`.
**Commit**: `office2: P11 live state, bubbles, room routing`.
**Stop and report if** `jasper`/`forge` are not in the roster (check `GET http://127.0.0.1:8000/api/v1/bots/`).

---

## P12 - proximity groups, halos, "talk" chip

**Context**: read `03_target_design.md` section 8.
**Create**: `app/src/office2/proximity.ts` (PURE), `app/tests/office2.proximity.test.mjs`, `app/src/office2/halos.ts`, `app/src/components/office2/ProximityChip.tsx`.
**Modify**: `OfficeScene.ts`, `Office2Panel.tsx`, spec (append).

1. `app/tests/office2.proximity.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { createProximity } from "../src/office2/proximity.ts";

const P = (id, x, y, walking = false, silent = false) => ({ id, tile: [x, y], walking, silent });

test("two people standing within 2 tiles form a group and emit join events", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  const r = prox.update([P("a", 0, 0), P("b", 2, 0), P("c", 9, 9)]);
  assert.deepEqual(r.groups, [["a", "b"]]);
  assert.deepEqual(r.events.map((e) => [e.type, e.id, e.groupId]), [["join", "a", "a"], ["join", "b", "a"]]);
});

test("hysteresis: stays linked at distance 3, leaves at 4, does not re-link at 3", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  prox.update([P("a", 0, 0), P("b", 2, 0)]);
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 3, 0)]).groups, [["a", "b"]]);
  const gone = prox.update([P("a", 0, 0), P("b", 4, 0)]);
  assert.deepEqual(gone.groups, []);
  assert.deepEqual(gone.events.map((e) => [e.type, e.id]), [["leave", "a"], ["leave", "b"]]);
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 3, 0)]).groups, []); // 3 is not enough to START a group
});

test("walking people never start a group; they link once they stop", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 1, 0, true)]).groups, []);
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 1, 0, false)]).groups, [["a", "b"]]);
});

test("chains merge into one component and split when the middle person leaves", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  const together = prox.update([P("a", 0, 0), P("b", 2, 0), P("c", 4, 0)]);
  assert.deepEqual(together.groups, [["a", "b", "c"]]);
  const split = prox.update([P("a", 0, 0), P("b", 9, 9), P("c", 4, 0)]);
  assert.deepEqual(split.groups, []);
});

test("silent people never link and drop out of an existing group", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 1, 0, false, true)]).groups, []);
  prox.update([P("a", 0, 0), P("b", 1, 0)]);
  assert.deepEqual(prox.update([P("a", 0, 0), P("b", 1, 0, false, true)]).groups, []);
});

test("a person who disappears from the input leaves the group", () => {
  const prox = createProximity({ enter: 2, leave: 3 });
  prox.update([P("a", 0, 0), P("b", 1, 0)]);
  const r = prox.update([P("a", 0, 0)]);
  assert.deepEqual(r.groups, []);
  assert.ok(r.events.some((e) => e.type === "leave" && e.id === "b"));
});
```
2. `proximity.ts` exports: `ProxPerson {id; tile: Pt; walking: boolean; silent?: boolean}`, `ProxEvent {type:"join"|"leave"; id; groupId: string|null}`, `ProxResult {groups: string[][]; events: ProxEvent[]}`, `Proximity {update(people): ProxResult}`, `createProximity(opts: {enter: number; leave: number}): Proximity`. Rules: Manhattan distance; a pair links when distance <= enter and neither is walking, stays linked while distance <= leave; silent people never link and are dropped; groups = connected components of links with size >= 2, ids sorted, groups sorted by first id; `groupId` = first id; events compare membership with the previous call (join when an id enters any group, leave when it leaves all).
3. `halos.ts` (browser): `class Halos(scene)`: every 250 ms feed `createProximity({enter: 2, leave: 3})` with all avatars (`walking`, and `silent` = the area at its tile has `silent: true`); draw per group a translucent circle (fill `0x60a5fa`, alpha 0.12, radius = max distance from centroid + 28 px) and thin link lines (existing look: `0x60a5fa`, alpha 0.5) at depth `DEPTH.halo`. Expose `groups(): string[][]` and call a callback `onChange(founderGroup: string[])` when the founder's group members change.
4. `ProximityChip.tsx`: bottom-centre overlay, visible only when the founder has >= 1 bot neighbour: text `Talk to <Name>` (one bot) or `Talk to <Name>, <Name2> +N`; a button calling `onTalk(slug)` for the first bot. `data-testid="office2-chip"`. (The chat navigation is wired in P13; here `onTalk` logs nothing and does nothing.)
5. `__officeDebug.groups()` returns `halos.groups()`.
6. Append to the spec:
```ts
test("[P12] chip appears next to a bot and disappears when moving away", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const people = await page.evaluate(() => window.__officeDebug!.people());
  const me = people[0];
  const bot = people.slice(1).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  await page.evaluate(([s, x, y]) => window.__officeDebug!.walkTo(s as string, x as number, y as number), [me.slug, Math.floor(bot.x / 32), Math.floor(bot.y / 32)]);
  await expect(page.locator('[data-testid="office2-chip"]')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(([s]) => window.__officeDebug!.walkTo(s as string, 52, 9), [me.slug]);
  await expect(page.locator('[data-testid="office2-chip"]')).toBeHidden({ timeout: 40_000 });
  await shot("p12");
});
```
**Commands and Expected**: proximity test `ℹ pass 6`; tsc office2 no output; playwright office2 spec `8 passed`.
**Commit**: `office2: P12 proximity groups, halos, talk chip`.

---

## P13 - chip opens Team Chat on the right DM

**Context**: Team Chat is `app/src/components/panels/ChatPanel2.tsx`; its active channel is local state `const [active, setActive] = useState<Channel>(...)` and DM ids are `dm:<slug>`. **Gate**: run `git diff --stat -- app/src/components/panels/ChatPanel2.tsx`. If it shows changes (another model is editing it), STOP and report; the founder must commit or park those first.
**Create**: `app/src/stores/chatIntentStore.ts`.
**Modify**: `app/src/components/panels/ChatPanel2.tsx` (about 5 lines), `app/src/components/panels/Office2Panel.tsx`, spec (append).

1. `chatIntentStore.ts`:
```ts
import { create } from "zustand";

export interface ChatIntent { id: string; label: string; kind: "dm" | "room" | "comms"; crew?: string }

interface ChatIntentState {
  intent: ChatIntent | null;
  open: (i: ChatIntent) => void;
  consume: () => void;
}

/** "Open this channel in Team Chat" request from other panels (Office 2 proximity chip, ID card). */
export const useChatIntent = create<ChatIntentState>((set) => ({
  intent: null,
  open: (i) => set({ intent: { ...i } }),
  consume: () => set({ intent: null }),
}));
```
2. `ChatPanel2.tsx`: add `import { useChatIntent } from "@/stores/chatIntentStore";` and, directly below the `const [active, setActive] = useState<Channel>(...)` line:
```tsx
  const intent = useChatIntent((s) => s.intent);
  useEffect(() => {
    if (!intent) return;
    setActive({ id: intent.id, label: intent.label, kind: intent.kind, crew: intent.crew });
    useChatIntent.getState().consume();
  }, [intent]);
```
(`useEffect` is already imported in that file.)
3. `Office2Panel.tsx`: `onTalk(slug)` -> `useChatIntent.getState().open({ id: "dm:" + slug, label: <display name>, kind: "dm", crew })` then `window.location.hash = "team_chat"`.
4. Append to the spec:
```ts
test("[P13] talk chip opens the DM in Team Chat", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const people = await page.evaluate(() => window.__officeDebug!.people());
  const me = people[0];
  const bot = people.slice(1).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  await page.evaluate(([s, x, y]) => window.__officeDebug!.walkTo(s as string, x as number, y as number), [me.slug, Math.floor(bot.x / 32), Math.floor(bot.y / 32)]);
  await page.locator('[data-testid="office2-chip"]').click({ timeout: 40_000 });
  await expect(page.locator('[data-testid="chat-panel"] header span.font-semibold').first()).toContainText(new RegExp(bot.slug.split("-")[0], "i"), { timeout: 15_000 });
});
```
**Commands and Expected**: tsc office2 no output; `npx tsc --noEmit -p tsconfig.json` is NOT required; playwright office2 spec `9 passed`; `npx playwright test tests/chat_org.spec.ts` -> all passed (Team Chat unchanged).
**Commit**: stage the 4 files; `office2: P13 proximity chip deep-links into Team Chat`.

---

## P14 - ID card drawer

**Context**: `GET /api/v1/bots/{slug}/card` returns the bot fields (`slug, display_name, role_title, crew, reports_to, enabled, lifecycle, department, position, tier, tools[], settings{}`), plus `group_label, prompt, memory_namespace`, and score fields. Show only keys that exist.
**Create**: `app/src/components/office2/IdCard.tsx`.
**Modify**: `Office2Panel.tsx`, `OfficeScene.ts` (expose select events), spec (append).

1. `IdCard.tsx`: right-hand drawer (width 320) with `data-testid="office2-idcard"`. Props `{ person, look, state, bubble, onClose, onChat, onFocus, onFollow }`. Fetch the card with `useApi` for bots; humans show name, role, state only. Show: portrait (`portraitUrl(look)` from `avatarSheet.ts`, `image-rendering: pixelated`), name, role, crew badge (colour from `CREW_COLOR`), live state with ring colour dot, lifecycle, department/position, reports to, tier, memory namespace, number of tools, `settings.model` if present, current bubble/reason, and a "Show prompt" toggle revealing the first 280 characters of `prompt` (hidden by default). Buttons: Chat (same as P13 `onTalk`), Focus (camera `fitRect` on the avatar's room), Follow (camera follows that avatar), Close.
2. `OfficeScene`: on `avatar-select` the panel stores `selected` slug; selected avatar gets a white 1-px ring; clicking empty floor clears selection only if no walk target was set.
3. Append to the spec:
```ts
test("[P14] clicking an avatar opens its ID card with data from /card", async () => {
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const people = await page.evaluate(() => window.__officeDebug!.people());
  const target = people.find((p) => p.slug === "forge") ?? people[1];
  await page.evaluate(([s]) => window.__officeDebug!.walkTo(s as string, 0, 0), [target.slug]).catch(() => undefined);
  const pos = (await page.evaluate(([s]) => window.__officeDebug!.screenOf(s as string), [target.slug]))!;
  const responded = page.waitForResponse((r) => r.url().includes(`/api/v1/bots/${target.slug}/card`) && r.status() === 200);
  await page.mouse.click(pos.x, pos.y - 10);
  await responded;
  await expect(page.locator('[data-testid="office2-idcard"]')).toBeVisible();
  await shot("p14");
});
```
(If `walkTo(…,0,0)` side effects annoy you, remove that line: it is only there to make sure the target is on screen; instead call the camera Home first.)
**Commands and Expected**: tsc office2 no output; spec `10 passed`.
**Commit**: `office2: P14 ID card`.

---

## P15 - add / edit employee, appearance picker

**Context**: read `03_target_design.md` section 9. Endpoints: `PUT /api/v1/bots/` (body `slug,display_name,role_title,crew,prompt,reports_to,tools,model_policy`), `PUT /api/v1/bots/{slug}/org`, `DELETE /api/v1/bots/{slug}`. After an edit, re-read the card and keep `tools`, `reports_to`, `model_policy.default_tier = tier` from it.
**Create**: `app/src/office2/forms.ts` (PURE), `app/tests/office2.forms.test.mjs`, `app/src/components/office2/EditDialog.tsx`, `app/src/office2/lookStore.ts`.
**Modify**: `Office2Panel.tsx`, `IdCard.tsx` (Edit and Disable buttons), `avatars.ts` only if needed, spec (append).

1. `app/tests/office2.forms.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { slugify, validateEmployee, SLUG_RE } from "../src/office2/forms.ts";

test("slugify", () => {
  assert.equal(slugify("Forge Bot 2"), "forge-bot-2");
  assert.equal(slugify("  Åsa & Co. "), "sa-co");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("a".repeat(60)).length, 40);
  assert.equal(slugify("ab-" + "c".repeat(60)).endsWith("-"), false);
  assert.ok(SLUG_RE.test(slugify("QA Sim Bot")));
});

const ok = { slug: "qa-bot", name: "QA Bot", role: "Tester", crew: "baeit", prompt: "You are QA Bot." };

test("validateEmployee: a good form passes in both modes", () => {
  assert.equal(validateEmployee(ok, ["forge"], "add"), null);
  assert.equal(validateEmployee(ok, ["qa-bot"], "edit"), null);
});

test("validateEmployee: first problem wins, with a readable sentence", () => {
  assert.equal(validateEmployee({ ...ok, name: "  " }, [], "add"), "Name is required.");
  assert.match(validateEmployee({ ...ok, slug: "A" }, [], "add"), /^Slug must be/);
  assert.match(validateEmployee({ ...ok, slug: "-x" }, [], "add"), /^Slug must be/);
  assert.equal(validateEmployee(ok, ["qa-bot"], "add"), "That slug is already taken.");
  assert.equal(validateEmployee({ ...ok, role: "" }, [], "add"), "Role is required.");
  assert.equal(validateEmployee({ ...ok, crew: "" }, [], "add"), "Crew is required.");
  assert.equal(validateEmployee({ ...ok, prompt: " " }, [], "add"), "Prompt is required.");
});
```
2. `forms.ts` exports: `SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/`; `slugify(name)` (lowercase, runs of non a-z0-9 -> "-", trim "-", max 40, no trailing "-"); `EmployeeForm {slug,name,role,crew,prompt}`; `validateEmployee(form, existingSlugs, mode: "add"|"edit"): string | null` returning the FIRST failing message among exactly: `Name is required.`, `Slug must be 2-63 characters: a-z, 0-9, dot, underscore or dash, starting with a letter or digit.`, `That slug is already taken.` (add mode only), `Role is required.`, `Crew is required.`, `Prompt is required.`.
3. `lookStore.ts` (browser): `readLooks(): Record<string, Partial<Look>>` and `writeLook(slug, partial)` using `localStorage["office2.looks"]` inside try/catch (never throw).
4. `EditDialog.tsx`: modal (add or edit). Fields: name, slug (auto from name in add mode, read-only in edit), role, crew (select from `CREW_COLOR` keys except human), prompt (default `You are <name>, <role> in the <crew> crew of Sir Jasper AI. Be concise and concrete.`), appearance picker (5 slots with previous/next buttons for skin, outfit, hair, hair colour, accessory, live `portraitUrl` preview, writes `writeLook`). Submit: `validateEmployee`; show the API error text inline when the request fails; never close on failure. Add: `PUT /api/v1/bots/` with defaults `reports_to: "jasper"`, `tools: []`, `model_policy: {default_tier: "standard"}`. Edit: as in Context. After success call `handle.syncPeople` through a re-fetch of the roster and pass `readLooks()` as overrides (change `OfficeScene.syncPeople(people, overrides)` accordingly). Disable button in the ID card: `window.confirm` then `DELETE`.
5. Append to the spec (cleans up its own bot):
```ts
test("[P15] add, edit and disable an employee", async () => {
  const API = "http://127.0.0.1:8000";
  await openPanel("office2");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 30_000 }).toBeGreaterThan(5);
  const before = await page.evaluate(() => window.__officePeople ?? 0);
  await page.getByRole("button", { name: /add employee/i }).click();
  await page.getByPlaceholder("Name").fill("E2E Test Bot");
  await page.getByPlaceholder("Role").fill("Tester");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 20_000 }).toBe(before + 1);
  const card = await (await fetch(`${API}/api/v1/bots/e2e-test-bot/card`)).json();
  expect(card.role_title).toBe("Tester");
  await shot("p15");
  await fetch(`${API}/api/v1/bots/e2e-test-bot`, { method: "DELETE" }); // cleanup
});
```
(The panel header gets an "Add employee" button; inputs use placeholders `Name`, `Slug`, `Role`; submit button text `Add`.)
**Commands and Expected**: forms test `ℹ pass 3`; tsc office2 no output; spec `11 passed`.
**Commit**: `office2: P15 add/edit employee and appearance picker`.
**Stop and report if** the edit re-submission would drop fields you cannot read from `/card` (list them).

---

## P16 - performance gate (60 avatars)

**Context**: read `05_test_plan.md` section 4. Target (design section 11): median fps >= 55 and p95 frame time <= 20 ms with 60 wandering avatars at zoom 1 and 2, measured in Electron.
**Modify**: `OfficeScene.ts` (frame-time hook, optimisations), spec (append).
1. Publish `window.__officeFrameMs` = p95 of the last 120 frame deltas (update once per second).
2. Append:
```ts
test("[P16] perf: 60 wandering avatars", async () => {
  await openPanel("office2", "?bots=60&wander=1");
  await expect.poll(() => page.evaluate(() => window.__officePeople ?? 0), { timeout: 40_000 }).toBeGreaterThan(60);
  const run = async () => { const f: number[] = [], m: number[] = []; for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); f.push(await page.evaluate(() => window.__officeFps ?? 0)); m.push(await page.evaluate(() => window.__officeFrameMs ?? 0)); } f.sort((a, b) => a - b); return { fps: f[10], p95: Math.max(...m) }; };
  await page.waitForTimeout(10_000);
  const z1 = await run();
  await page.locator('[data-testid="office2-host"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("+"); await page.keyboard.press("+");
  const z2 = await run();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, "perf.json"), JSON.stringify({ z1, z2 }));
  expect(z1.fps).toBeGreaterThanOrEqual(55); expect(z2.fps).toBeGreaterThanOrEqual(55);
  expect(z1.p95).toBeLessThanOrEqual(20); expect(z2.p95).toBeLessThanOrEqual(20);
});
```
3. Run it. If it passes, commit. If not, apply ONE of these at a time and re-run: (a) bake `floor`, `walls`, `furniture`, `decor` into one `RenderTexture` at start and hide the four layers; (b) run tag layout at 5 Hz only when any avatar moved (already designed); (c) disable avatar ring redraw when state unchanged. After two rounds still failing: STOP and report the numbers in `perf.json`.
**Commands and Expected**: spec all passed (`12 passed`); `e2e/test-results/office2/perf.json` has fps >= 55.
**Commit**: `office2: P16 frame-time metric and performance gate`.

---

## P17 - presence, docs

**Create**: `docs/virtualOffice/ATTRIBUTIONS.md` (text: `No third-party assets are used. All art is generated by scripts/gen_office2_tiles.mjs and app/src/office2/avatarArt.ts.`).
**Modify**: `OfficeScene.ts`, `Office2Panel.tsx`, `docs/virtualOffice/PROGRESS.md`, spec (append).
1. Presence: the founder avatar shows `away` (alpha 0.5 and a "zzz" bubble) when the panel has been hidden (`useViewActive()` false) or the window unfocused for more than 5 minutes (threshold overridable with hash param `awayMs=<n>` for tests); back to normal on activity. Implemented as `handle.setPresence("present" | "away")`.
2. Append to the spec a test that opens `#office2?awayMs=1500`, switches to `team_chat` for 3 s, comes back and expects `bubbleOf(founder).text === "zzz"` to have appeared (poll via the 50 ms recorder pattern of P11) and gone again after a click on the host.
3. Fill `PROGRESS.md` rows for P01-P16 from `git log --oneline`.
**Commands and Expected**: tsc office2 no output; spec `13 passed`; `cd app; npm test` -> `ℹ fail 0`.
**Commit**: `office2: P17 presence and docs`.

---

## P18 - switch-over and cleanup (**FOUNDER GATE**)

Do NOT start until the founder has written in the chat: `approve office switch`. If that sentence is not in front of you, STOP.
**Modify**: `app/src/app/page.tsx`, `app/src/app/plugin-registry.ts`, `app/src/components/layout/Sidebar.tsx`, `app/src/lib/panelPreload.ts`, `app/package.json`.
**Delete with `git rm`** (founder approval covers exactly these): `app/src/components/panels/OfficePanel.tsx`, `app/src/office/behavior.ts`, `app/src/office/sprites.ts`, `app/tests/office.test.mjs`, `scripts/gen_office_map.mjs`, `app/public/office/map.json`, `app/public/office/rooms.json`.
1. Before deleting run `Select-String -Path app\src\*,app\src\*\*,app\src\*\*\* -Pattern 'office/behavior|office/sprites|OfficePanel|public/office/'` equivalent via the Grep tool; if any file other than the ones being deleted or edited here matches, STOP and report.
2. `page.tsx`: delete the `OfficePanel` lazy line; change `office:         <OfficePanel />,` to `office:         <Office2Panel />,`; delete the `office2:` map line. `plugin-registry.ts`: delete the `office2` entry (keep `office`, maybe rename its description to "2D office with live agents"). `Sidebar.tsx`: remove `"office2",`. `panelPreload.ts`: point `office:` at `Office2Panel` and delete the two `office2` lines. `app/package.json`: remove ` tests/office.test.mjs` from the test script.
3. In `e2e/tests/office2.spec.ts` replace the `"office2"` panel id with `"office"` everywhere (`openPanel("office")`, warm-up list).
**Commands and Expected**
```powershell
cd D:\Projects\COOS\app; npm test                      # Expected: ℹ fail 0
npx tsc --noEmit -p tsconfig.office2.json              # Expected: no output
cd ..\e2e; npx playwright test tests/app.spec.ts -g "virtual office"   # Expected: 1 passed (now the new office)
npx playwright test tests/office2.spec.ts              # Expected: 13 passed
```
Full `npx tsc --noEmit` (8+ min) once here, in the background, redirected to a file: `Start-Process powershell -ArgumentList '-NoProfile','-Command','cd D:\Projects\COOS\app; npx tsc --noEmit > ..\tsc-full.log 2>&1'`; Expected: `tsc-full.log` empty (do not commit it).
**Commit**: `office: switch to Office 2, remove the old office`. **Rollback**: `git revert --no-edit <sha>` restores the old panel and files.

---

## Reviewer checklist (Claude, after each prompt)

1. `git log -1 --stat`: only the prompt's files; size roughly <= 150 changed lines (generated files excepted).
2. Nothing from `Project_References/` staged; `git diff main -- app/src | findstr /i workadventure` is empty; no new image without an `ATTRIBUTIONS.md` line.
3. PURE modules contain no `import "phaser"`, no DOM, no `@/`; no `any`, no `console.log`.
4. Re-run the prompt's fast commands (unit tests, tsc office2); run e2e only for prompts that added a test (and P16).
5. Open the screenshot / preview PNG named in Acceptance and compare with the sentence.
6. `git status` shows no other-model files staged; `git revert --no-edit <sha>` would be clean.
7. Add a line to `docs/virtualOffice/PROGRESS.md` (prompt, sha, pass/fail, notes).
8. Two failed attempts on one prompt: Claude takes that prompt over.

## Dry-run record (what Claude verified before handing these over)

- Pure modules (pathfind, behavior, proximity, nameTags, look, camera, mapModel, people, forms) and the three tile/map scripts: reference implementations written in a scratch folder passed all embedded tests (45 tests) and `tsc` with the app's compiler options.
- Layout: 9 rooms, 30 desk seats, 97 spots, every floor tile reachable from the start tile.
- Browser: a spike loaded the generated `map.json`, `tiles.png` and composed avatars in Phaser 3.90 and rendered correctly (headless software rendering gave only ~27-31 fps with 40 avatars; the real gate is measured in Electron in P16).
- `playwright test tests/office2.spec.ts --list` accepts the spec skeleton; `tsc -p tsconfig.office2.json` takes about 35 s versus 8.5 min for the full project.
- NOT verified (cannot be without implementing): P07-P17 browser code. Their e2e assertions are the check.
