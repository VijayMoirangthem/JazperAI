import test from "node:test";
import assert from "node:assert/strict";
import { footprintCells, inWorldBounds, overlapsBlockingObject } from "../src/office3/core/builder.ts";

test("builder footprint guards prevent overlap and bounds escapes", () => {
  assert.deepEqual(footprintCells([2, 3], [2, 1]), [[2, 3], [3, 3]]);
  assert.equal(overlapsBlockingObject({ id: "b", pos: [1, 0], footprint: [2, 1], blocks: true }, [{ id: "a", pos: [0, 0], footprint: [2, 1], blocks: true }]), true);
  assert.equal(inWorldBounds([59, 39], [1, 1], [60, 40]), true);
  assert.equal(inWorldBounds([59, 39], [2, 1], [60, 40]), false);
});
