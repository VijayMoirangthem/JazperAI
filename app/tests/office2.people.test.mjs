import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMap } from "../src/office2/mapModel.ts";
import { toPeople, peopleSignature, homeRoom, planSeats, makeSimPeople, OPS_CREWS } from "../src/office2/people.ts";

const model = parseMap(JSON.parse(fs.readFileSync(new URL("../public/office2/map.json", import.meta.url), "utf8")));
const dir = { humans: [{ id: "founder", display_name: "Vijay" }] };
const bot = (slug, crew, enabled = true) => ({ slug, display_name: slug.toUpperCase(), role_title: "Engineer", crew, lifecycle: "active", enabled });

test("toPeople: humans first, disabled bots dropped, bots sorted by slug, missing input is empty", () => {
  const p = toPeople(dir, { bots: [bot("zed", "it"), bot("amy", "sre"), bot("off", "it", false)] });
  assert.deepEqual(p.map((x) => [x.slug, x.kind]), [["founder", "human"], ["amy", "bot"], ["zed", "bot"]]);
  assert.equal(p[0].role, "Founder");
  assert.equal(p[0].crew, "human");
  assert.deepEqual(toPeople(undefined, undefined), []);
});

test("homeRoom: humans -> founder, ops crews -> operations, everything else -> engineering", () => {
  assert.equal(homeRoom({ kind: "human", crew: "human" }), "founder");
  for (const c of OPS_CREWS) if (c !== "human") assert.equal(homeRoom({ kind: "bot", crew: c }), "operations", c);
  for (const c of ["it", "baeit", "rnd", "coreops", "unmapped", "whatever"]) assert.equal(homeRoom({ kind: "bot", crew: c }), "engineering", c);
});

test("planSeats with a realistic roster (founder + 51 bots): everyone has a distinct tile, founder sits in the founder room, 30 desks used", () => {
  const crews = ["l1", "coreops", "it", "baeit", "boardmint", "rnd", "people", "sre", "personal", "exec", "unmapped"];
  const bots = Array.from({ length: 51 }, (_, i) => bot(`b${String(i).padStart(2, "0")}`, crews[i % crews.length]));
  const people = toPeople(dir, { bots });
  const plan = planSeats(people, model.spots);
  assert.equal(plan.size, 52);
  assert.equal(new Set([...plan.values()].map((s) => `${s.x},${s.y}`)).size, 52);
  assert.equal(plan.get("founder").room, "founder");
  assert.equal(plan.get("founder").type, "seat");
  assert.equal([...plan.values()].filter((s) => s.type === "seat" && (s.room === "engineering" || s.room === "operations")).length, 30);
  assert.deepEqual([...planSeats(people, model.spots)].map(([k, s]) => [k, s.x, s.y]), [...plan].map(([k, s]) => [k, s.x, s.y])); // deterministic
});

test("planSeats never throws and always returns a spot, even with more people than spots", () => {
  const people = toPeople(dir, { bots: Array.from({ length: 119 }, (_, i) => bot(`x${i}`, "it")) });
  const plan = planSeats(people, model.spots);
  assert.equal(plan.size, 120);
  for (const s of plan.values()) assert.ok(s && Number.isInteger(s.x) && Number.isInteger(s.y));
  assert.equal(new Set([...plan.values()].map((s) => `${s.x},${s.y}`)).size >= 70, true);
});

test("makeSimPeople: stable slugs and rotating crews", () => {
  const s = makeSimPeople(10);
  assert.deepEqual(s.slice(0, 3).map((p) => p.slug), ["sim-01", "sim-02", "sim-03"]);
  assert.equal(s.length, 10);
  assert.ok(new Set(s.map((p) => p.crew)).size >= 5);
  assert.deepEqual(makeSimPeople(10), s);
  assert.ok(s.every((p) => p.kind === "bot"));
});

test("peopleSignature changes when a visible field changes and is stable otherwise", () => {
  const a = toPeople(dir, { bots: [bot("amy", "sre")] });
  const b = toPeople(dir, { bots: [bot("amy", "sre")] });
  const c = toPeople(dir, { bots: [{ ...bot("amy", "sre"), role_title: "Lead" }] });
  assert.equal(peopleSignature(a), peopleSignature(b));
  assert.notEqual(peopleSignature(a), peopleSignature(c));
});
