import test from "node:test";
import assert from "node:assert/strict";
import { canUseInteraction, interactionForPrefab, nearestInteraction } from "../src/office3/core/interactions.ts";

test("interaction resolver chooses the nearest usable object and enforces cooldowns", () => {
  const coffee = interactionForPrefab("counter-v1");
  assert.ok(coffee);
  const result = nearestInteraction([{ id: "far", prefab: "counter-v1", pos: [2, 0] }, { id: "near", prefab: "counter-v1", pos: [1, 0] }], [0, 0]);
  assert.equal(result?.target.id, "near");
  assert.equal(canUseInteraction(coffee, 1000, 3999, false), false);
  assert.equal(canUseInteraction(coffee, 1000, 4000, false), true);
  assert.equal(nearestInteraction([{ id: "far", prefab: "counter-v1", pos: [3, 0] }], [0, 0]), undefined);
});
