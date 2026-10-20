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
