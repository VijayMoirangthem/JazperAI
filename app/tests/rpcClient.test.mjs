import test from "node:test";
import assert from "node:assert/strict";
import { RpcClient } from "../src/lib/rpcClient.ts";

class FakeSocket {
  static all = [];
  constructor() { this.sent = []; FakeSocket.all.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.onclose?.(); }
}
const ev = (seq) => ({ data: JSON.stringify({ method: "agent-state-change", seq, ts: "t", params: {} }) });

test("resume sends last seq, duplicates dropped, reconnects after close", async () => {
  FakeSocket.all.length = 0;
  const got = [];
  const c = new RpcClient({ url: "x", topics: ["agent-state-change"], onEvent: (e) => got.push(e.seq),
    socketFactory: () => new FakeSocket(), random: () => 0 });
  c.start();
  const s1 = FakeSocket.all[0];
  s1.onopen();
  assert.deepEqual(s1.sent[0].params.since, { "agent-state-change": 0 });
  for (const n of [1, 2, 3]) s1.onmessage(ev(n));
  s1.onclose(); // backend restart
  await new Promise((r) => setTimeout(r, 400));
  const s2 = FakeSocket.all[1];
  assert.ok(s2, "reconnected");
  s2.onopen();
  assert.deepEqual(s2.sent[0].params.since, { "agent-state-change": 3 });
  for (const n of [3, 4, 4, 5]) s2.onmessage(ev(n)); // replay overlap + duplicate
  assert.deepEqual(got, [1, 2, 3, 4, 5]); // no gaps, no duplicates
  c.stop();
});
