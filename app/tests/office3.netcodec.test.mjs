import test from "node:test";
import assert from "node:assert/strict";
import { decodePosition, encodePosition, validMove } from "../src/office3/core/netcodec.ts";

test("Office position messages round-trip and reject invalid moves", () => {
  const message = { type: "move", x: 2, z: 3, facing: 0.5, anim: "walk", seq: 9 };
  assert.deepEqual(decodePosition(encodePosition(message)), message);
  assert.equal(decodePosition("{}"), null);
  assert.equal(validMove([0, 0], [4, 0], 1), true);
  assert.equal(validMove([0, 0], [7, 0], 1), false);
});
