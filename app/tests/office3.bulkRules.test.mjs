import test from "node:test";
import assert from "node:assert/strict";
import { idleVariant, motionForState, needsTurnBeforeWalk } from "../src/office3/core/motionRules.ts";
import { validateCustomModel } from "../src/office3/core/customModel.ts";
import { conversationTitle, visibleConversationText } from "../src/office3/core/conversationChat.ts";
test("character, model and conversation rules", () => { assert.equal(motionForState("working"), "typing"); assert.ok(idleVariant("forge", 5)); assert.equal(needsTurnBeforeWalk(0, Math.PI), true); assert.equal(validateCustomModel("bad.glb", new Uint8Array([0, 0, 0, 0])), "The GLB file signature is invalid."); assert.equal(validateCustomModel("ok.glb", new Uint8Array([0x67, 0x6c, 0x54, 0x46])), null); assert.equal(conversationTitle(["A", "B", "C"]), "Talk to A, B +1"); assert.equal(visibleConversationText([{ from: "a", text: "x".repeat(50), at: 1 }])[0].text.length, 40); });
