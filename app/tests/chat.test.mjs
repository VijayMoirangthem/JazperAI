import test from "node:test";
import assert from "node:assert/strict";
import { readNdjson } from "../src/chat/ndjson.ts";

const res = (chunks) => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))); c.close(); } }));

test("ndjson reader joins lines split across chunks and flushes the tail", async () => {
  const out = [];
  for await (const e of readNdjson(res(['{"t":"delta","te', 'xt":"a"}\n{"t":"done"}\n', '{"t":"x"}']))) out.push(e);
  assert.deepEqual(out, [{ t: "delta", text: "a" }, { t: "done" }, { t: "x" }]);
});
