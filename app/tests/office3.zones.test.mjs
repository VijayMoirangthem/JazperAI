import test from "node:test";
import assert from "node:assert/strict";
import { evaluateZoneEntry } from "../src/office3/core/zoneRules.ts";
test("zone rules block and decorate entries", function () { assert.deepEqual(evaluateZoneEntry({capacity:1}, "member", 1), ["block"]); assert.deepEqual(evaluateZoneEntry({silent:true,tooltip:"Quiet"}, "member", 0), ["allow","silent","tooltip"]); });
