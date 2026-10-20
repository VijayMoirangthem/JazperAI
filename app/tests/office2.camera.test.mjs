import test from "node:test";
import assert from "node:assert/strict";
import { ZOOM_STEPS, stepZoom, clampCenter, worldToMini, miniToWorld, fitRect } from "../src/office2/camera.ts";

test("zoom steps are fixed and stepping clamps at both ends", () => {
  assert.deepEqual([...ZOOM_STEPS], [0.5, 0.75, 1, 1.5, 2, 3]);
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(3, 1), 3);
  assert.equal(stepZoom(0.5, -1), 0.5);
  assert.equal(stepZoom(1.2, 1), 1.5); // off-grid value snaps to the nearest step first (1.0 is nearest) then moves
});

test("clampCenter keeps the view inside the world and centres a view larger than the world", () => {
  assert.deepEqual(clampCenter(0, 0, 800, 600, 1, 1920, 1280), [400, 300]);
  assert.deepEqual(clampCenter(5000, 5000, 800, 600, 1, 1920, 1280), [1520, 980]);
  assert.deepEqual(clampCenter(960, 640, 800, 600, 2, 1920, 1280), [960, 640]);
  assert.deepEqual(clampCenter(10, 10, 4000, 3000, 1, 1920, 1280), [960, 640]);
});

test("minimap transform round-trips within one tile", () => {
  const world = { w: 1920, h: 1280 }, mini = { w: 160, h: 107 };
  for (const [x, y] of [[0, 0], [960, 640], [1919, 1279], [333, 777]]) {
    const [mx, my] = worldToMini(x, y, world, mini);
    const [wx, wy] = miniToWorld(mx, my, world, mini);
    assert.ok(Math.abs(wx - x) < 32 && Math.abs(wy - y) < 32);
  }
});

test("fitRect picks the largest step (max 2) that fits and centres on the rectangle", () => {
  const f = fitRect({ x: 0, y: 0, w: 560, h: 336 }, 1280, 720, 48);
  assert.equal(f.zoom, 1.5);
  assert.deepEqual([f.cx, f.cy], [280, 168]);
  assert.equal(fitRect({ x: 0, y: 0, w: 100, h: 100 }, 1280, 720, 48).zoom, 2);
  assert.equal(fitRect({ x: 0, y: 0, w: 5000, h: 4000 }, 1280, 720, 48).zoom, 0.5);
});
