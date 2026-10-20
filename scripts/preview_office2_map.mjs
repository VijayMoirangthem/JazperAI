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
