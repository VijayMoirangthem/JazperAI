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
