import test from "node:test";
import assert from "node:assert/strict";
import { SentenceSplitter, speakable, encodeWav } from "../src/voice/audio.ts";

test("sentences are emitted as soon as the next whitespace proves they ended", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Hello the"), []);
  assert.deepEqual(s.push("re. How are"), ["Hello there."]);
  assert.deepEqual(s.push(" you? Fine!"), ["How are you?"]);
  assert.equal(s.flush(), "Fine!");
});

test("decimals and mid-line dots do not split; newlines do", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Pi is 3.14 today.\nNext"), ["Pi is 3.14 today."]);
  assert.equal(s.flush(), "Next");
});

test("speakable strips markdown and code", () => {
  assert.equal(speakable("**Bold** and `x` and [link](http://a.b) ```js\ncode\n``` end"), "Bold and x and link code omitted end");
});

test("wav header is valid 16-bit mono PCM", () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16); // bits
  assert.equal(v.getUint32(40, true), 8); // 4 samples * 2 bytes
  assert.equal(v.getInt16(46, true), 16383); // 0.5
  assert.equal(wav.length, 44 + 8);
});
