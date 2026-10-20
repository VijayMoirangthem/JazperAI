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
