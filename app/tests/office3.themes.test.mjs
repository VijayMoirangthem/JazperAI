import test from "node:test";
import assert from "node:assert/strict";
import { THEMES, themeById } from "../src/office3/core/themes.ts";
test("every Office theme has a complete palette", () => { assert.ok(THEMES.length >= 7); assert.ok(THEMES.every(theme => theme.floor.startsWith("#") && theme.wall.startsWith("#") && theme.accent.startsWith("#"))); assert.equal(themeById("missing").id, "tech-startup"); });
