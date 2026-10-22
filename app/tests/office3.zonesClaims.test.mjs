import test from "node:test";
import assert from "node:assert/strict";
import { claimDesk, releaseDesk, validZone } from "../src/office3/core/zones.ts";
test("zones and personal desk claims validate", () => { const claims = claimDesk([], "desk-1", "founder"); assert.deepEqual(claims, [{ desk: "desk-1", person: "founder" }]); assert.equal(claimDesk(claims, "desk-1", "other"), null); assert.deepEqual(releaseDesk(claims, "founder"), []); assert.equal(validZone({ id: "quiet", room: "work", capacity: 4 }), true); });
