// Generates app/public/office/map.json (Tiled JSON, orthogonal) + rooms.json. Edit ROOMS below, then: node scripts/gen_office_map.mjs
// Tile ids: 1 floor, 2 wall, 3 desk, 4 carpet, 5 table, 6 plant, 7 rug, 8 machine, 9 sofa. Collision: 2,3,5,6,8,9.
import fs from "node:fs";

const W = 40, H = 24;
const grid = Array.from({ length: H }, () => Array(W).fill(1));
const rect = (x1, y1, x2, y2, id) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x] = id; };

rect(20, 1, 38, 11, 4); // operations carpet
rect(28, 14, 38, 22, 7); // lounge rug
// outer walls + dividers
rect(0, 0, W - 1, 0, 2); rect(0, H - 1, W - 1, H - 1, 2); rect(0, 0, 0, H - 1, 2); rect(W - 1, 0, W - 1, H - 1, 2);
rect(0, 12, W - 1, 12, 2); rect(19, 1, 19, 11, 2); rect(13, 13, 13, 22, 2); rect(26, 13, 26, 22, 2);
// doors (floor gaps)
for (const [x, y] of [[8, 12], [9, 12], [19, 12], [20, 12], [33, 12], [34, 12], [19, 5], [19, 6], [13, 18], [13, 19], [26, 18], [26, 19]]) grid[y][x] = 1;
// desks
const engDesks = [3, 6, 9, 12, 15].flatMap((x) => [[x, 3], [x, 7]]);
const opsDesks = [23, 26, 29, 32, 35].flatMap((x) => [[x, 3], [x, 7]]);
for (const [x, y] of [...engDesks, ...opsDesks]) grid[y][x] = 3;
// meeting table
rect(4, 17, 9, 18, 5);
// tools lab machines
const machines = [[16, 15], [19, 15], [22, 15], [16, 20], [19, 20], [22, 20]];
for (const [x, y] of machines) grid[y][x] = 8;
// lounge: sofas + plants
rect(29, 16, 32, 16, 9); rect(29, 20, 32, 20, 9);
for (const [x, y] of [[37, 14], [37, 22], [27, 14], [14, 14], [1, 14], [1, 22], [24, 22]]) grid[y][x] = 6;

const data = grid.flat();
const map = {
  compressionlevel: -1, width: W, height: H, tilewidth: 32, tileheight: 32, infinite: false, orientation: "orthogonal",
  renderorder: "right-down", type: "map", version: "1.10", tiledversion: "1.10.2", nextlayerid: 2, nextobjectid: 1,
  layers: [{ id: 1, name: "office", type: "tilelayer", x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data }],
  tilesets: [{ firstgid: 1, name: "tiles", tilewidth: 32, tileheight: 32, tilecount: 9, columns: 9, image: "tiles.png", imagewidth: 288, imageheight: 32, margin: 0, spacing: 0 }],
};
const seat = ([x, y]) => [x, y + 1];
const rooms = {
  engineering: { name: "Engineering", rect: [1, 1, 18, 11], desks: engDesks.map(seat) },
  operations: { name: "Operations", rect: [20, 1, 38, 11], desks: opsDesks.map(seat) },
  meeting: { name: "Meeting room", rect: [1, 13, 12, 22], spots: [[3, 16], [5, 16], [7, 16], [9, 16], [3, 19], [5, 19], [7, 19], [9, 19], [11, 17]] },
  tools: { name: "Tools lab", rect: [14, 13, 25, 22], spots: machines.map(([x, y]) => [x, y + 1]) },
  lounge: { name: "Lounge", rect: [27, 13, 38, 22], spots: [[30, 17], [31, 18], [33, 17], [35, 18], [34, 21], [36, 19], [30, 21], [28, 19]] },
};
fs.mkdirSync("app/public/office", { recursive: true });
fs.writeFileSync("app/public/office/map.json", JSON.stringify(map));
fs.writeFileSync("app/public/office/rooms.json", JSON.stringify(rooms));
const blocked = new Set([2, 3, 5, 6, 8, 9]);
for (const [k, r] of Object.entries(rooms)) for (const [x, y] of [...(r.desks ?? []), ...(r.spots ?? [])]) if (blocked.has(grid[y][x])) throw new Error(`${k}: seat ${x},${y} is blocked`);
console.log(`office map ${W}x${H}: ${engDesks.length + opsDesks.length} desks, ${Object.keys(rooms).length} rooms`);
