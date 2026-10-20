import test from "node:test";
import assert from "node:assert/strict";
import { findPath, nearestFree } from "../src/office2/pathfind.ts";

// 5x5 grid, '#' = blocked
const grid = (rows) => rows.map((r) => [...r].map((c) => c === "#"));
const G = grid([
  ".....",
  ".###.",
  ".....",
  ".#.#.",
  ".....",
]);

test("shortest path length and shape (start excluded, goal included)", () => {
  const p = findPath(G, [0, 0], [4, 0]);
  assert.equal(p.length, 4);
  assert.deepEqual(p.at(-1), [4, 0]);
  const q = findPath(G, [0, 0], [4, 2]);
  assert.equal(q.length, 6); // 4 right + 2 down, around the wall block
});

test("never steps on a blocked tile and moves 1 tile at a time", () => {
  const p = findPath(G, [0, 4], [4, 0]);
  let prev = [0, 4];
  for (const [x, y] of p) {
    assert.equal(G[y][x], false);
    assert.equal(Math.abs(x - prev[0]) + Math.abs(y - prev[1]), 1);
    prev = [x, y];
  }
});

test("empty result: same tile, blocked goal, out of range, no route", () => {
  assert.deepEqual(findPath(G, [0, 0], [0, 0]), []);
  assert.deepEqual(findPath(G, [0, 0], [2, 1]), []);
  assert.deepEqual(findPath(G, [0, 0], [9, 9]), []);
  const walled = grid([".#.", ".#.", ".#."]);
  assert.deepEqual(findPath(walled, [0, 0], [2, 0]), []);
});

test("nearestFree skips blocked and occupied tiles", () => {
  assert.deepEqual(nearestFree(G, [1, 1], new Set()), [0, 1]);
  assert.deepEqual(nearestFree(G, [0, 0], new Set(["0,0"])), [1, 0]);
  const one = grid(["#.", "##"]);
  assert.equal(nearestFree(one, [0, 0], new Set(["1,0"])), null);
});
