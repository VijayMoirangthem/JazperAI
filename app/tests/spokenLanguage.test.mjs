import test from "node:test";
import assert from "node:assert/strict";
import { detectSpokenLanguage, voiceForText } from "../src/voice/spokenLanguage.ts";

test("detects English, Hindi and Hinglish", () => {
  assert.equal(detectSpokenLanguage("All good. Connected: google-workspace."), "english");
  assert.equal(detectSpokenLanguage("आज का दिन अच्छा चल रहा है।"), "hindi");
  assert.equal(detectSpokenLanguage("Aaj ka din smooth chal raha hai, sab theek se manage ho raha hai."), "hinglish");
  assert.equal(detectSpokenLanguage("12:30 ???"), "english");
});

test("keeps the chosen voice for English and switches voice (keeping male/female) for Hindi and Hinglish", () => {
  assert.equal(voiceForText("en-GB-RyanNeural", "Everything is fine"), "en-GB-RyanNeural");
  assert.equal(voiceForText("en-GB-RyanNeural", "आज का दिन अच्छा है"), "hi-IN-MadhurNeural");
  assert.equal(voiceForText("en-US-AriaNeural", "आज का दिन अच्छा है"), "hi-IN-SwaraNeural");
  assert.equal(voiceForText("en-GB-RyanNeural", "Aaj ka din bahut accha hai"), "en-IN-PrabhatNeural");
  assert.equal(voiceForText("en-US-AriaNeural", "Aaj ka din bahut accha hai"), "en-IN-NeerjaNeural");
});
