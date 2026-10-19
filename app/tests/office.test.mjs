import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { placeFor, pickSpot, bfs, near } from "../src/office/behavior.ts";

test("state decides the place; idle follows the lunch schedule", () => {
  assert.equal(placeFor("planning", 10), "meeting");
  assert.equal(placeFor("testing", 10), "tools");
  assert.equal(placeFor("working", 10), "desk");
  assert.equal(placeFor("idle", 12), "lounge");
  assert.equal(placeFor("idle", 15), "desk");
});

test("spots: first free, then shared", () => {
  const spots = [[1, 1], [2, 2]];
  assert.deepEqual(pickSpot(spots, new Set(["1,1"]), (s) => s.join(",")), [2, 2]);
  assert.deepEqual(pickSpot(spots, new Set(["1,1", "2,2"]), (s) => s.join(","), 3), [2, 2]);
});

test("every room spot on the generated map is reachable from every other room", () => {
  const map = JSON.parse(fs.readFileSync(new URL("../public/office/map.json", import.meta.url)));
  const rooms = JSON.parse(fs.readFileSync(new URL("../public/office/rooms.json", import.meta.url)));
  const W = map.width, data = map.layers[0].data, bl = new Set([2, 3, 5, 6, 8, 9]);
  const blocked = Array.from({ length: map.height }, (_, y) => Array.from({ length: W }, (_, x) => bl.has(data[y * W + x])));
  const origin = rooms.engineering.desks[0];
  for (const r of Object.values(rooms)) for (const p of [...(r.desks ?? []), ...(r.spots ?? [])]) {
    assert.ok(bfs(blocked, origin, p).length > 0 || (origin[0] === p[0] && origin[1] === p[1]), `unreachable ${p}`);
  }
  assert.ok(near([1, 1], [2, 2]) && !near([1, 1], [9, 9]));
});
