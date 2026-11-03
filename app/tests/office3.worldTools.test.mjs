import test from "node:test";
import assert from "node:assert/strict";
import { diffObjects } from "../src/office3/core/worldDiff.ts";
import { parseJournal, saveJournal, loadJournal } from "../src/office3/core/historyStore.ts";
import { normalizeAsset } from "../src/office3/core/assetNormalize.ts";

const o = (id, x) => ({ id, prefab: "sofa-v1", pos: [x, 1], rot: 0, scale: 1, props: {} });
test("diffObjects finds added, removed and changed objects", () => {
  const d = diffObjects({ objects: [o("a", 1), o("b", 2), o("c", 3)] }, { objects: [o("a", 1), o("b", 5), o("d", 4)] });
  assert.deepEqual([d.added, d.removed, d.changed, d.unchanged], [["c"], ["d"], ["b"], 1]);
});
test("journal round-trips, rejects other worlds and corrupt data", () => {
  const mem = new Map();
  const st = { setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), getItem: k => mem.get(k) ?? null };
  const j = { version: 1, world: "w1", done: [{ id: "1", op: "add", before: null, after: { id: "a" } }], undone: [] };
  assert.equal(saveJournal(j, st), true);
  assert.equal(loadJournal("w1", st).done.length, 1);
  assert.equal(loadJournal("w2", st).done.length, 0);
  assert.equal(parseJournal("{not json", "w1").done.length, 0);
});
test("journal trims oversize history", () => {
  const mem = new Map();
  const st = { setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const big = Array.from({ length: 200 }, (_, i) => ({ id: String(i), op: "add", before: null, after: { pad: "x".repeat(2000) } }));
  saveJournal({ version: 1, world: "w", done: big, undone: [] }, st);
  assert.ok([...mem.values()][0].length <= 256 * 1024);
});
test("normalizeAsset scales to the footprint, grounds the model and extracts anchors", () => {
  const n = normalizeAsset({ min: [-1, 0.5, -0.5], max: [1, 1.5, 0.5] }, 1, [{ name: "seat_1", pos: [0, 1, 0] }, { name: "Anchor_Use", pos: [1, 1, 0] }, { name: "mesh", pos: [0, 0, 0] }]);
  assert.deepEqual(n.footprint, [2, 1]);
  assert.equal(n.scale, 1);
  assert.equal(n.offset[1], -0.5);
  assert.equal(n.seats.length, 1);
  assert.deepEqual(Object.keys(n.anchors), ["anchor_use"]);
  assert.throws(() => normalizeAsset({ min: [0, 0, 0], max: [0, 1, 1] }, 1));
});
