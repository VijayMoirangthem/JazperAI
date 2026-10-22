import test from "node:test";
import assert from "node:assert/strict";
import { roomSeatCount, splitWallForDoor } from "../src/office3/core/architecture.ts";
test("walls split around doors and room templates estimate seating", () => { assert.deepEqual(splitWallForDoor(10, 5), [{ from: 0, to: 4 }, { from: 6, to: 10 }]); assert.ok(roomSeatCount(8, 8) >= 8); });
