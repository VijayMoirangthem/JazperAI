import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lookFor, lookKey, LOOK_COUNTS, CREW_COLOR } from "../src/office2/look.ts";

const slugs = ["jasper", "scout", "forge", "atlas", "nova", "echo", "pixel", "quill", "sage", "bolt", "iris", "kite",
  "lumen", "mason", "nexus", "orion", "pilot", "quark", "rhea", "sol", "tango", "umber", "vega", "wren"];

test("LOOK_COUNTS matches the copied avatar parts", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../public/office2/woka/manifest.json", import.meta.url), "utf8"));
  for (const k of Object.keys(LOOK_COUNTS)) assert.equal(m[k].length, LOOK_COUNTS[k], k);
});

test("deterministic; crew only changes the shirt tint", () => {
  assert.deepEqual(lookFor("forge", "it", "bot"), lookFor("forge", "it", "bot"));
  const a = lookFor("forge", "it", "bot"), b = lookFor("forge", "sre", "bot");
  assert.equal(a.shirtColor, CREW_COLOR.it);
  assert.deepEqual({ ...a, shirtColor: "" }, { ...b, shirtColor: "" });
});

test("24 slugs give at least 22 distinct looks and every index is in range", () => {
  assert.ok(new Set(slugs.map((s) => lookKey(lookFor(s, "it", "bot")))).size >= 22);
  for (const s of slugs) {
    const l = lookFor(s, "nope", "bot");
    for (const k of Object.keys(LOOK_COUNTS)) assert.ok(l[k] >= (k === "hat" || k === "accessory" ? -1 : 0) && l[k] < LOOK_COUNTS[k], `${s}.${k}=${l[k]}`);
    assert.equal(l.shirtColor, CREW_COLOR.unmapped);
  }
});

test("humans never get a hat or accessory", () => {
  const l = lookFor("founder", "human", "human");
  assert.equal(l.hat, -1); assert.equal(l.accessory, -1);
});

test("override merges valid fields and ignores invalid ones", () => {
  const base = lookFor("forge", "it", "bot");
  const l = lookFor("forge", "it", "bot", { hair: 2, body: 99, hat: -1, clothes: 1.5, shirtColor: "#112233", eyes: -3 });
  assert.equal(l.hair, 2); assert.equal(l.hat, -1);
  assert.equal(l.body, base.body); assert.equal(l.clothes, base.clothes); assert.equal(l.eyes, base.eyes);
  assert.equal(l.shirtColor, "#112233");
  assert.equal(lookFor("forge", "it", "bot", { shirtColor: "red" }).shirtColor, CREW_COLOR.it);
});
