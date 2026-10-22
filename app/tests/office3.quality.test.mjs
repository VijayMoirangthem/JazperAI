import test from "node:test";
import assert from "node:assert/strict";
import { qualityForP95, qualitySettings } from "../src/office3/core/quality.ts";
test("quality tier transitions use hysteresis", () => { assert.equal(qualityForP95(23, "high"), "medium"); assert.equal(qualityForP95(15, "medium"), "high"); assert.equal(qualityForP95(35, "medium"), "low"); assert.equal(qualitySettings("low").shadows, false); });
