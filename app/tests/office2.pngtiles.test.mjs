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
