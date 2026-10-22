import test from "node:test";
import assert from "node:assert/strict";
import { cloneWorld, exportWorld, importWorld } from "../src/office3/core/worldTransfer.ts";
import world from "../public/office3/world.json" with { type: "json" };
test("worlds export, import and clone safely", () => { const copy = importWorld(exportWorld(world)); assert.equal(copy.id, world.id); const clone = cloneWorld(copy, "lab", "Lab"); assert.equal(clone.id, "lab"); assert.equal(clone.name, "Lab"); assert.equal(copy.id, world.id); });
