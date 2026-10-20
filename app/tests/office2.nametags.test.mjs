import test from "node:test";
import assert from "node:assert/strict";
import { layoutTags, tagVisible } from "../src/office2/nameTags.ts";

const rectOf = (t, w, h) => ({ x1: t.x - w / 2, x2: t.x + w / 2, y1: t.y, y2: t.y + h });
const intersects = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

test("12 tags requested at the same point end up with no overlapping rectangles", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: 100, y: 200, w: 40, h: 10, priority: i % 3 }));
  const out = layoutTags(items);
  assert.equal(out.length, 12);
  const rects = out.map((t) => rectOf(t, 40, 10));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(intersects(rects[i], rects[j]), false, `${i} vs ${j}`);
});

test("result keeps the input order and the highest priority stays where it asked", () => {
  const items = [
    { id: "low", x: 0, y: 0, w: 30, h: 8, priority: 0 },
    { id: "high", x: 0, y: 0, w: 30, h: 8, priority: 5 },
  ];
  const out = layoutTags(items);
  assert.deepEqual(out.map((t) => t.id), ["low", "high"]);
  assert.equal(out[1].y, 0);
  assert.equal(out[1].moved, 0);
  assert.ok(out[0].y < 0 && out[0].moved > 0); // pushed up
});

test("tags that do not collide are not moved", () => {
  const out = layoutTags([
    { id: "a", x: 0, y: 0, w: 30, h: 8, priority: 0 },
    { id: "b", x: 100, y: 0, w: 30, h: 8, priority: 0 },
  ]);
  assert.deepEqual(out.map((t) => t.moved), [0, 0]);
});

test("visibility rule: hidden below zoom 0.75 except hovered, selected, founder or attention states", () => {
  assert.equal(tagVisible(1, {}), true);
  assert.equal(tagVisible(0.5, {}), false);
  assert.equal(tagVisible(0.5, { hovered: true }), true);
  assert.equal(tagVisible(0.5, { selected: true }), true);
  assert.equal(tagVisible(0.5, { founder: true }), true);
  assert.equal(tagVisible(0.5, { state: "error" }), true);
  assert.equal(tagVisible(0.5, { state: "waiting_human" }), true);
  assert.equal(tagVisible(0.5, { state: "working" }), false);
});
