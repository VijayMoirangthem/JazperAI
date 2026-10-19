import test from "node:test";
import assert from "node:assert/strict";

import { applyAccepted } from "../src/lib/applyHunks.ts";

const h = (id, s, n, patch) => ({ id, old_start: s, old_lines: n, patch });
test("accepts, rejects and orders hunks", () => {
  const orig = "a\nb\nc\nd\ne";
  const hunks = [h("h1", 3, 1, "-d\n+D\n"), h("h0", 1, 1, "-b\n+B1\n+B2\n")];
  assert.equal(applyAccepted(orig, hunks, new Set()), "a\nB1\nB2\nc\nD\ne");
  assert.equal(applyAccepted(orig, hunks, new Set(["h0"])), "a\nb\nc\nD\ne");
  assert.equal(applyAccepted(orig, hunks, new Set(["h0", "h1"])), orig);
});
