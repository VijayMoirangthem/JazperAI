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
