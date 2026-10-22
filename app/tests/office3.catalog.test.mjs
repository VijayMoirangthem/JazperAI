import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rotatedFootprint, validPrefab } from "../src/office3/core/catalog.ts";

test("catalogue contains the builder baseline", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../public/office3/catalog.json", import.meta.url), "utf8"));
  assert.ok(catalogue.length >= 60);
  assert.ok(new Set(catalogue.map(item => item.category)).size >= 8);
  assert.ok(catalogue.every(validPrefab));
  assert.deepEqual(rotatedFootprint([2, 1], 1), [1, 2]);
});
