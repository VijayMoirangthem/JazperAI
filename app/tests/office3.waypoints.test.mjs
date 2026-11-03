import test from "node:test";
import assert from "node:assert/strict";
import { parseWorld, navigationModel } from "../src/office3/core/world.ts";
import base from "../public/office3/world.json" with { type: "json" };

const withWp = (waypoints) => structuredClone({ ...base, waypoints });
const room = base.rooms[0].id;
test("valid waypoints parse and reach the navigation model", () => {
  const w = parseWorld(withWp([{ id: "wp-a", room, pos: [1, 1] }]));
  assert.deepEqual(navigationModel(w).waypoints, [{ id: "wp-a", room, x: 1, y: 1 }]);
});
test("worlds without waypoints still parse", () => { assert.deepEqual(navigationModel(parseWorld(structuredClone(base))).waypoints, []); });
test("bad waypoints are rejected", () => {
  assert.throws(() => parseWorld(withWp([{ id: "a", room: "nope", pos: [1, 1] }])), /unknown room/);
  assert.throws(() => parseWorld(withWp([{ id: "a", room, pos: [9999, 1] }])), /outside/);
  assert.throws(() => parseWorld(withWp([{ id: "a", room, pos: [1, 1] }, { id: "a", room, pos: [2, 1] }])), /duplicated/);
  assert.throws(() => parseWorld(withWp(Array.from({ length: 65 }, (_, i) => ({ id: "w" + i, room, pos: [1, 1] })))), /at most 64/);
});
