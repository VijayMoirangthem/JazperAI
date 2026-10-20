import test from "node:test";
import assert from "node:assert/strict";
import { placeFor, createWalkQueue, assignSpot } from "../src/office2/behavior.ts";

test("placeFor covers every AgentState from backend/python/core/contracts.py", () => {
  const table = {
    planning: "meeting", waiting_tool: "tools", testing: "tools", repairing: "tools",
    waiting_human: "founder", escalated: "founder",
    working: "desk", error: "desk", rolled_back: "desk", deprecated: "desk",
  };
  for (const [state, place] of Object.entries(table)) assert.equal(placeFor(state, 10), place, state);
  assert.equal(placeFor("idle", 12), "lounge");
  assert.equal(placeFor("idle", 11), "desk");
  assert.equal(placeFor("idle", 13), "desk");
  assert.equal(placeFor("idle", 22), "desk");
  assert.equal(placeFor("something-new", 10), "desk");
});

test("walk queue: at most 4 walk at once, FIFO promotion", () => {
  const q = createWalkQueue(4);
  const started = ["a", "b", "c", "d", "e", "f"].map((id) => q.request(id));
  assert.deepEqual(started, [true, true, true, true, false, false]);
  assert.deepEqual(q.waiting(), ["e", "f"]);
  assert.equal(q.request("a"), true); // already walking
  assert.equal(q.request("e"), false); // already waiting, not duplicated
  assert.deepEqual(q.waiting(), ["e", "f"]);
  assert.equal(q.finish("b"), "e");
  assert.deepEqual(q.active().sort(), ["a", "c", "d", "e"]);
  assert.equal(q.finish("a"), "f");
  assert.equal(q.finish("c"), null);
  assert.equal(q.finish("zzz"), null); // unknown id is harmless
});

test("walk queue: a waiting id that is removed never starts", () => {
  const q = createWalkQueue(1);
  q.request("a"); q.request("b"); q.request("c");
  assert.equal(q.finish("b"), null); // b leaves the queue
  assert.equal(q.finish("a"), "c");
});

test("assignSpot is stable per slug, skips taken spots, returns null when full", () => {
  const spots = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 }));
  const first = assignSpot(spots, new Set(), "forge");
  assert.deepEqual(assignSpot(spots, new Set(), "forge"), first);
  const second = assignSpot(spots, new Set([`${first.x},${first.y}`]), "forge");
  assert.notDeepEqual(second, first);
  const all = new Set(spots.map((s) => `${s.x},${s.y}`));
  assert.equal(assignSpot(spots, all, "forge"), null);
  assert.equal(assignSpot([], new Set(), "forge"), null);
});

test("ring colours: every state has one, unknown falls back to idle, attention states", async () => {
  const { ringColor, isAttention } = await import("../src/office2/behavior.ts");
  for (const s of ["idle", "planning", "working", "waiting_tool", "waiting_human", "testing", "repairing", "rolled_back", "escalated", "error", "deprecated"]) assert.equal(typeof ringColor(s), "number", s);
  assert.equal(ringColor("nope"), ringColor("idle"));
  assert.equal(ringColor("error"), 0xef4444);
  assert.equal(ringColor("working"), 0x22c55e);
  assert.equal(isAttention("error"), true);
  assert.equal(isAttention("escalated"), true);
  assert.equal(isAttention("waiting_human"), true);
  assert.equal(isAttention("working"), false);
});
