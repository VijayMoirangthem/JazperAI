import test from "node:test";
import assert from "node:assert/strict";
import { instantiateRoomTemplate, templateForRoomKind } from "../src/office3/core/roomTemplates.ts";

const meeting = { id: "meet", kind: "meet", rect: [4, 4, 12, 10] };
test("meeting template creates eight reachable-in-room seats", () => {
  const plan = instantiateRoomTemplate("meeting-8", meeting);
  assert.equal(plan.seats.length, 8);
  assert.equal(plan.objects[0].prefab, "conference-table-v1");
  assert.ok(plan.seats.every(seat => seat.pos[0] >= 4 && seat.pos[0] <= 12 && seat.pos[1] >= 4 && seat.pos[1] <= 10));
});
test("auto-furnish maps every room kind to a bounded template", () => {
  for (const kind of ["work", "meet", "tools", "social", "private", "transit"]) {
    const plan = instantiateRoomTemplate(templateForRoomKind(kind), { id: kind, kind, rect: [0, 0, 7, 7] });
    assert.ok(plan.objects.length > 0);
    assert.ok(plan.objects.every(item => item.pos[0] >= 0 && item.pos[0] <= 7 && item.pos[1] >= 0 && item.pos[1] <= 7));
  }
});
