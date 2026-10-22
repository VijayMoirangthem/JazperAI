import test from "node:test";
import assert from "node:assert/strict";
import { planAgentMeetings } from "../src/office3/core/agentMeetings.ts";

test("agent meeting planner respects the active meeting cap", () => {
  const actors = [{ slug: "a", tile: [0, 0] }, { slug: "b", tile: [4, 2] }];
  const threads = [{ id: "a|b", from: "a", to: "b", kind: "ask", text: "Please review this implementation" }];
  assert.deepEqual(planAgentMeetings(threads, actors, 0), [{ thread: "a|b", from: "a", to: "b", point: [2, 1], text: "Please review this implementation" }]);
  assert.deepEqual(planAgentMeetings(threads, actors, 4), []);
});
