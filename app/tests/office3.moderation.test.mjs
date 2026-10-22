import test from "node:test";
import assert from "node:assert/strict";
import { canModerate, canViewRoom, validChatMessage, withinRateLimit } from "../src/office3/core/moderation.ts";
import { moodFor, rankFor } from "../src/office3/core/moods.ts";
test("Office moderation, privacy and agent presentation rules", () => { assert.equal(canViewRoom("guest", ["founder"]), false); assert.equal(canModerate("admin"), true); assert.equal(validChatMessage("hello"), true); assert.equal(validChatMessage(" "), false); assert.equal(withinRateLimit(Array(30).fill(99), 100), false); assert.equal(moodFor(1, 3, 1), "strained"); assert.equal(rankFor(100), "senior"); });
