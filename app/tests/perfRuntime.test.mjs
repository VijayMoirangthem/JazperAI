import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, createCoalescer, getPerf, scalePoll, setPerf, setScaledInterval, shouldSkipFrame, subscribePerf } from "../src/lib/perfRuntime.ts";

test("scalePoll stretches intervals, never shrinks them, and leaves 'no polling' alone", () => {
  assert.equal(scalePoll(5000, 3), 15000);
  assert.equal(scalePoll(5000, 1), 5000);
  assert.equal(scalePoll(5000, 0.2), 5000);          // scale below 1 is clamped: settings can only slow polling down
  assert.equal(scalePoll(false, 3), false);
  assert.equal(scalePoll(0, 3), 0);
  assert.equal(scalePoll(undefined, 3), undefined);
});

test("the default (first run) keeps today's behaviour", () => {
  assert.equal(DEFAULTS.poll_scale, 1);
  assert.equal(DEFAULTS.animations, "full");
  assert.equal(DEFAULTS.ui_update_ms, 100);
});

test("setPerf notifies subscribers and scalePoll follows the current scale", () => {
  let calls = 0;
  const off = subscribePerf(() => { calls++; });
  setPerf({ poll_scale: 3, animations: "off" });
  assert.equal(calls, 1);
  assert.equal(getPerf().animations, "off");
  assert.equal(scalePoll(2000), 6000);
  off();
  setPerf({ poll_scale: 1, animations: "full" });
  assert.equal(calls, 1);                            // unsubscribed
});

test("coalescer batches a burst into one flush after the window", async () => {
  const c = createCoalescer(() => 30);
  const seen = [];
  for (let i = 0; i < 50; i++) c.push(() => seen.push(i));
  assert.equal(seen.length, 0);                      // nothing yet: waiting for the window
  assert.equal(c.pending(), 50);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(seen.length, 50);
  assert.deepEqual(seen.slice(0, 3), [0, 1, 2]);     // order preserved
  c.push(() => seen.push("late"));
  c.flush();                                         // explicit flush runs immediately
  assert.equal(seen.at(-1), "late");
});

test("coalescer window is read at push time, so a settings change applies to the next burst", async () => {
  let ms = 500;
  const c = createCoalescer(() => ms);
  const seen = [];
  ms = 10;
  c.push(() => seen.push(1));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(seen, [1]);
});

test("FPS cap skips frames that arrive too soon and lets on-time frames through", () => {
  assert.equal(shouldSkipFrame(1000 + 5, 1000, 30), true);      // 5 ms after a frame at a 30 fps cap
  assert.equal(shouldSkipFrame(1000 + 34, 1000, 30), false);    // 34 ms >= 33.3 ms
  assert.equal(shouldSkipFrame(1000 + 16.7, 1000, 60), false);  // on-time 60 fps frame is not dropped
  assert.equal(shouldSkipFrame(1000 + 1, 1000, 0), false);      // 0 = uncapped
});

test("setScaledInterval fires on the scaled period", async () => {
  setPerf({ poll_scale: 1 });
  let n = 0;
  const id = setScaledInterval(() => { n++; }, 20);
  await new Promise((r) => setTimeout(r, 110));
  clearInterval(id);
  assert.ok(n >= 3 && n <= 6, `expected ~5 ticks at 20ms, got ${n}`);
  setPerf({ poll_scale: 5 });
  let m = 0;
  const id2 = setScaledInterval(() => { m++; }, 20);          // now 100 ms period
  await new Promise((r) => setTimeout(r, 130));
  clearInterval(id2);
  assert.ok(m >= 1 && m <= 2, `expected 1 tick at the scaled 100ms period, got ${m}`);
  setPerf({ poll_scale: 1 });
});
